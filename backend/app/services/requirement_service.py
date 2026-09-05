import json
from datetime import datetime
from typing import List, Optional

from fastapi import UploadFile
from sqlmodel import Session

from app.core.database import engine
from app.models.requirement import Requirement
from app.models.requirement_attachment import RequirementAttachment
from app.models.quotation import Quotation
from app.models.quotation_attachment import QuotationAttachment
from app.models.ledger_entry import LedgerEntry
from app.models.user import User
from app.repositories import requirement_repository as repo
from app.repositories import ledger_repository as ledger_repo
from app.repositories import notification_repository as notif_repo
from app.repositories import message_repository as msg_repo
from app.services import ledger_service
from app.schemas.requirement import (
    RequirementCreate,
    RequirementOut,
    PosterOut,
    SpecRow,
    AttachmentOut,
    QuotationCreate,
    QuotationSealedReceipt,
    QuotationDetailOut,
    RequirementQuotationsView,
    MyQuotationOut,
    MyRequirementOut,
    AdminRequirementOut,
    LedgerEntryOut,
    RequirementLedgerView,
    ClarificationQuestionOut,
    SiteNotesUpdate,
)


class RequirementNotFound(Exception):
    pass


class RequirementNotOpen(Exception):
    """Raised when an action requires status == 'open' but it isn't."""


class RequirementNotReleased(Exception):
    """Raised when an action (award) requires status == 'closed'."""


class NotOwner(Exception):
    pass


class NoActiveQuotation(Exception):
    pass


class AlreadyAwarded(Exception):
    pass


class AlreadyDecided(Exception):
    """Raised when an action (shortlist, close-without-award) requires the
    requirement to still be awaiting a decision, but it's already awarded or
    already closed without one."""


class InvalidQuotation(Exception):
    pass


class HasActiveQuotations(Exception):
    """Raised when trying to extend a closing time after quotes exist."""


class QuestionNotFound(Exception):
    pass


def _log(session: Session, event_type: str, requirement_id: int, quotation_id, actor_id, payload: dict) -> LedgerEntry:
    prev_hash = ledger_repo.get_last_hash(session)
    entry_hash = ledger_service.compute_hash(prev_hash, payload)
    entry = LedgerEntry(
        event_type=event_type,
        requirement_id=requirement_id,
        quotation_id=quotation_id,
        actor_id=actor_id,
        prev_hash=prev_hash,
        entry_hash=entry_hash,
        payload_json=ledger_service.canonicalize(payload),
    )
    return ledger_repo.append(session, entry)


class RequirementService:
    # ---------- read / list ----------

    def _to_out(self, session: Session, req: Requirement, viewer: User | None = None) -> RequirementOut:
        owner = session.get(User, req.owner_id)
        posted_count = repo.count_requirements_by_owner(session, req.owner_id)
        awarded_count = repo.count_requirements_by_owner_and_status(session, req.owner_id, "awarded")
        quotations_count = repo.count_quotations_for_requirement(session, req.id)
        latest_q_at = repo.latest_quotation_at(session, req.id)

        poster = PosterOut(
            id=owner.id,
            business_name=owner.business_name,
            registered_name=owner.registered_name,
            city=owner.city,
            province=owner.province,
            is_verified=owner.is_verified,
            tier=owner.tier,
            member_since_year=owner.created_at.year,
            requirements_posted_count=posted_count,
            requirements_awarded_count=awarded_count,
            verified_since=owner.verification_date.strftime("%b %Y") if owner.verification_date else None,
        )

        attachments = repo.list_attachments(session, req.id)

        my_active_ref = None
        is_saved = False
        if viewer:
            my_active_q = repo.get_active_quotation(session, req.id, viewer.id)
            if my_active_q:
                my_active_ref = f"QT-{my_active_q.id:06d}"
            is_saved = repo.is_saved(session, viewer.id, req.id)

        return RequirementOut(
            id=req.id,
            ref_code=req.ref_code,
            title=req.title,
            tags=[t for t in req.tags.split(",") if t],
            poster=poster,
            category=req.category,
            scope=req.scope,
            specifications=[SpecRow(**s) for s in json.loads(req.specifications_json or "[]")],
            quantity=req.quantity,
            price_min=req.price_min,
            price_max=req.price_max,
            city=req.city,
            site_address=req.site_address,
            location=req.location,
            site_access_hours=req.site_access_hours,
            site_access_notes=req.site_access_notes,
            delivery_start=req.delivery_start,
            delivery_end=req.delivery_end,
            attachments=[AttachmentOut(id=a.id, filename=a.original_filename, uploaded_at=a.uploaded_at) for a in attachments],
            match_note=self._match_note(req, viewer),
            status=req.status,
            quotations_count=quotations_count,
            latest_quotation_at=latest_q_at,
            closes_at=req.closes_at,
            created_at=req.created_at,
            awarded_quotation_id=req.awarded_quotation_id,
            my_active_quotation_ref=my_active_ref,
            is_saved=is_saved,
        )

    def _match_note(self, req: Requirement, viewer: User | None) -> str | None:
        """Rule-based relevance explanation — NOT the semantic/vector
        matching from the study's specific objective 4. This is a
        deliberately simple placeholder (category + location + keyword
        overlap) that gives an honest reason rather than a fabricated one,
        while the embeddings-based matcher remains future work."""
        if not viewer or not viewer.industry_category:
            return None

        req_tags = [t for t in req.tags.split(",") if t]
        primary_category = req_tags[0] if req_tags else None

        reasons = []
        if primary_category and primary_category.upper() == viewer.industry_category.upper():
            reasons.append("Same category as your business")

        service_areas = [a.strip().lower() for a in (viewer.service_areas or "").split(",") if a.strip()]
        if service_areas and any(area in req.location.lower() or req.location.lower() in area for area in service_areas):
            reasons.append(f"the site is in {req.location} — your service area")

        capabilities = [c.strip() for c in (viewer.capabilities or "").split(",") if c.strip()]
        matched_caps = [c for c in capabilities if c.lower() in req.title.lower()]

        if not reasons and not matched_caps:
            return None

        sentence = ", and ".join(reasons) if reasons else ""
        sentence = sentence[0].upper() + sentence[1:] if sentence else ""
        if matched_caps:
            cap_clause = f"Your profile lists {matched_caps[0].lower()}."
            sentence = f"{sentence}. {cap_clause}" if sentence else cap_clause
        elif sentence:
            sentence += "."
        return sentence or None

    def list_open(self, viewer_id: int | None = None) -> List[RequirementOut]:
        with Session(engine) as session:
            viewer = session.get(User, viewer_id) if viewer_id else None
            reqs = repo.list_open_requirements(session)
            out = [self._to_out(session, r, viewer) for r in reqs]

            # Feed ordering: match first, then closing time. The match-boost only
            # applies for a viewer here to find work (FIND_WORK/BOTH, or no signup_intent
            # recorded) — a FIND_SUPPLIERS-only viewer isn't looking for their own
            # capability match, so their feed is ordered by closing time alone.
            wants_work = viewer is None or viewer.signup_intent != "FIND_SUPPLIERS"
            if wants_work:
                out.sort(key=lambda r: (r.match_note is None, r.closes_at))
            else:
                out.sort(key=lambda r: r.closes_at)
            return out

    def list_closing_soon(self, viewer_id: int | None = None) -> List[RequirementOut]:
        with Session(engine) as session:
            viewer = session.get(User, viewer_id) if viewer_id else None
            reqs = repo.list_closing_soon(session)
            return [self._to_out(session, r, viewer) for r in reqs]

    # ---------- create ----------

    def create(self, owner_id: int, data: RequirementCreate) -> RequirementOut:
        with Session(engine) as session:
            ref_code = repo.next_ref_code(session)

            location = data.city.strip()
            if data.site_address and data.site_address.strip():
                location = f"{location} — {data.site_address.strip()}"

            req = Requirement(
                ref_code=ref_code,
                title=data.title,
                tags=data.category.strip().upper(),
                owner_id=owner_id,
                category=data.category.strip(),
                scope=data.scope.strip(),
                specifications_json=json.dumps([s.model_dump() for s in data.specifications]),
                quantity=data.quantity.strip(),
                price_min=data.price_min,
                price_max=data.price_max,
                city=data.city.strip(),
                site_address=data.site_address.strip() if data.site_address else None,
                location=location,
                delivery_start=data.delivery_start,
                delivery_end=data.delivery_end,
                closes_at=data.closes_at,
            )
            created = repo.create_requirement(session, req)
            return self._to_out(session, created)

    # ---------- attachments ----------

    async def upload_attachment(self, requirement_id: int, owner_id: int, file: UploadFile) -> AttachmentOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()

            import os
            import uuid

            upload_dir = os.path.join("uploads", "requirements", str(requirement_id))
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(file.filename or "")[1] or ".bin"
            saved_name = f"{uuid.uuid4().hex}{ext}"
            full_path = os.path.join(upload_dir, saved_name)

            contents = await file.read()
            with open(full_path, "wb") as f:
                f.write(contents)

            attachment = RequirementAttachment(
                requirement_id=requirement_id,
                file_path=full_path,
                original_filename=file.filename or saved_name,
            )
            created = repo.add_attachment(session, attachment)
            return AttachmentOut(id=created.id, filename=created.original_filename, uploaded_at=created.uploaded_at)

    # ---------- "My Requirements" ----------

    def list_my_requirements(self, owner_id: int) -> List[MyRequirementOut]:
        with Session(engine) as session:
            reqs = repo.list_requirements_by_owner(session, owner_id)
            out = []
            for req in reqs:
                out.append(MyRequirementOut(
                    id=req.id,
                    ref_code=req.ref_code,
                    title=req.title,
                    category=req.category,
                    scope=req.scope,
                    specifications=[SpecRow(**s) for s in json.loads(req.specifications_json or "[]")],
                    quantity=req.quantity,
                    status=req.status,
                    city=req.city,
                    price_min=req.price_min,
                    price_max=req.price_max,
                    quotations_count=repo.count_quotations_for_requirement(session, req.id),
                    closes_at=req.closes_at,
                    released_at=req.released_at,
                    awarded_quotation_id=req.awarded_quotation_id,
                    created_at=req.created_at,
                ))
            return out

    # ---------- saved requirements (personal bookmarks) ----------

    def save(self, requirement_id: int, user_id: int) -> None:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            repo.save_requirement(session, user_id, requirement_id)

    def unsave(self, requirement_id: int, user_id: int) -> None:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            repo.unsave_requirement(session, user_id, requirement_id)

    def list_saved(self, user_id: int) -> List[RequirementOut]:
        with Session(engine) as session:
            viewer = session.get(User, user_id)
            reqs = repo.list_saved_requirements(session, user_id)
            return [self._to_out(session, r, viewer) for r in reqs]

    # ---------- admin: every requirement on the platform ----------

    def list_all_requirements(self) -> List[AdminRequirementOut]:
        with Session(engine) as session:
            reqs = repo.list_all_requirements(session)
            out = []
            for req in reqs:
                owner = session.get(User, req.owner_id)
                out.append(AdminRequirementOut(
                    id=req.id,
                    ref_code=req.ref_code,
                    title=req.title,
                    category=req.category,
                    status=req.status,
                    city=req.city,
                    price_min=req.price_min,
                    price_max=req.price_max,
                    quotations_count=repo.count_quotations_for_requirement(session, req.id),
                    closes_at=req.closes_at,
                    released_at=req.released_at,
                    awarded_quotation_id=req.awarded_quotation_id,
                    created_at=req.created_at,
                    owner_id=req.owner_id,
                    owner_business_name=owner.business_name if owner else "—",
                ))
            return out

    # ---------- extend closing ----------

    def extend_closing(self, requirement_id: int, owner_id: int, new_closes_at: datetime) -> RequirementOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status != "open":
                raise RequirementNotOpen()
            if repo.count_active_quotations(session, requirement_id) > 0:
                raise HasActiveQuotations()

            req.closes_at = new_closes_at
            updated = repo.update_requirement(session, req)
            return self._to_out(session, updated)

    # ---------- site notes (never locked — informational, not a bidding term) ----------

    def update_site_notes(self, requirement_id: int, owner_id: int, data: SiteNotesUpdate) -> RequirementOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()

            req.site_access_hours = data.site_access_hours.strip()
            req.site_access_notes = data.site_access_notes.strip()
            updated = repo.update_requirement(session, req)
            return self._to_out(session, updated)

    # ---------- cancel ----------

    def cancel(self, requirement_id: int, owner_id: int) -> RequirementOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status != "open":
                raise RequirementNotOpen()

            actives = repo.list_active_quotations(session, requirement_id)
            for q in actives:
                q.status = "voided"
                repo.update_quotation(session, q)

            req.status = "cancelled"
            req.cancelled_at = datetime.utcnow()
            updated = repo.update_requirement(session, req)

            _log(session, "CANCELLED", requirement_id, None, owner_id, {
                "requirement_id": requirement_id, "voided_count": len(actives),
            })

            return self._to_out(session, updated)

    # ---------- sealed submission ----------

    def submit_quotation(self, requirement_id: int, business_id: int, data: QuotationCreate) -> QuotationSealedReceipt:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.status != "open" or req.closes_at <= datetime.utcnow():
                raise RequirementNotOpen()

            # Resubmission: silently withdraw any prior active quote from
            # this business first, then record the new one. History of the
            # withdrawal stays visible via the ledger and the old row.
            existing = repo.get_active_quotation(session, requirement_id, business_id)
            if existing:
                self._withdraw_row(session, existing, business_id)

            payload = {
                "requirement_id": requirement_id,
                "business_id": business_id,
                "total_price": data.total_price,
                "delivery_lead_time": data.delivery_lead_time,
                "payment_terms": data.payment_terms,
                "validity_period": data.validity_period,
                "notes": data.notes or "",
            }
            prev_hash = ledger_repo.get_last_hash(session)
            entry_hash = ledger_service.compute_hash(prev_hash, payload)

            quotation = Quotation(
                requirement_id=requirement_id,
                business_id=business_id,
                total_price=data.total_price,
                delivery_lead_time=data.delivery_lead_time,
                payment_terms=data.payment_terms,
                validity_period=data.validity_period,
                notes=data.notes or "",
                status="sealed",
                submission_hash=entry_hash,
            )
            created = repo.create_quotation(session, quotation)

            entry = LedgerEntry(
                event_type="SUBMITTED",
                requirement_id=requirement_id,
                quotation_id=created.id,
                actor_id=business_id,
                prev_hash=prev_hash,
                entry_hash=entry_hash,
                payload_json=ledger_service.canonicalize(payload),
            )
            saved_entry = ledger_repo.append(session, entry)

            created.ledger_entry_id = saved_entry.id
            created = repo.update_quotation(session, created)

            # No notification to the owner here, deliberately — the buyer is never
            # alerted of an individual submission, not even that one arrived, only
            # who and how many. They can still see the running sealed_count on the
            # requirement itself (RequirementQuotationsView) whenever they check it;
            # that's a pull, not a push, so it never signals *when* one landed.

            return QuotationSealedReceipt(
                quotation_id=created.id,
                quotation_ref=f"QT-{created.id:06d}",
                submitted_at=created.created_at,
                truncated_hash=entry_hash[-12:],
                ledger_entry_number=saved_entry.id,
                sealed_until=req.closes_at,
            )

    # ---------- quotation attachments ----------

    async def upload_quotation_attachment(self, requirement_id: int, quotation_id: int, business_id: int, file: UploadFile) -> AttachmentOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()

            quotation = repo.get_quotation(session, quotation_id)
            if not quotation or quotation.requirement_id != requirement_id:
                raise RequirementNotFound()
            if quotation.business_id != business_id:
                raise NotOwner()
            # Same window as withdraw/resubmit — attachments are part of the sealed
            # submission, so they can't be added once it's no longer sealed.
            if req.status != "open" or req.closes_at <= datetime.utcnow() or quotation.status != "sealed":
                raise RequirementNotOpen()

            import os
            import uuid

            upload_dir = os.path.join("uploads", "quotations", str(quotation_id))
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(file.filename or "")[1] or ".bin"
            saved_name = f"{uuid.uuid4().hex}{ext}"
            full_path = os.path.join(upload_dir, saved_name)

            contents = await file.read()
            with open(full_path, "wb") as f:
                f.write(contents)

            attachment = QuotationAttachment(
                quotation_id=quotation_id,
                file_path=full_path,
                original_filename=file.filename or saved_name,
            )
            created = repo.add_quotation_attachment(session, attachment)
            return AttachmentOut(id=created.id, filename=created.original_filename, uploaded_at=created.uploaded_at)

    # ---------- withdraw ----------

    def withdraw_quotation(self, requirement_id: int, business_id: int) -> None:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.status != "open" or req.closes_at <= datetime.utcnow():
                raise RequirementNotOpen()

            existing = repo.get_active_quotation(session, requirement_id, business_id)
            if not existing:
                raise NoActiveQuotation()

            self._withdraw_row(session, existing, business_id)

    def _withdraw_row(self, session: Session, quotation: Quotation, actor_id: int) -> None:
        quotation.status = "withdrawn"
        quotation.withdrawn_at = datetime.utcnow()
        repo.update_quotation(session, quotation)

        _log(session, "WITHDRAWN", quotation.requirement_id, quotation.id, actor_id, {
            "quotation_id": quotation.id,
        })

    # ---------- pre-closing clarification Q&A ----------
    # Public, unsealed — a question and its answer are visible to every respondent,
    # unlike a quotation. Only usable while the requirement is still open: this is a
    # "can I bid on this correctly" channel, not a negotiation, and it has nothing to
    # do with pricing, so there's no integrity concern in it staying open the whole
    # time the requirement is.

    def _question_out(self, session: Session, q) -> ClarificationQuestionOut:
        asker = session.get(User, q.asker_id)
        return ClarificationQuestionOut(
            id=q.id,
            requirement_id=q.requirement_id,
            asker_id=q.asker_id,
            asker_name=asker.business_name if asker else "—",
            question=q.question,
            answer=q.answer,
            answered_at=q.answered_at,
            created_at=q.created_at,
        )

    def list_questions(self, requirement_id: int) -> List[ClarificationQuestionOut]:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            return [self._question_out(session, q) for q in repo.list_questions(session, requirement_id)]

    def ask_question(self, requirement_id: int, asker_id: int, question: str) -> ClarificationQuestionOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.status != "open":
                raise RequirementNotOpen()

            row = repo.create_question(session, requirement_id, asker_id, question.strip())

            notif_repo.create_if_allowed(
                session,
                user_id=req.owner_id,
                type_="QUESTION_ASKED",
                category="activity",
                title="A business asked a question",
                detail=f"{req.ref_code} · {req.title}",
            )

            return self._question_out(session, row)

    def answer_question(self, requirement_id: int, question_id: int, owner_id: int, answer: str) -> ClarificationQuestionOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status != "open":
                raise RequirementNotOpen()

            question = repo.get_question(session, question_id)
            if not question or question.requirement_id != requirement_id:
                raise QuestionNotFound()

            updated = repo.answer_question(session, question, answer.strip())

            # Published to all respondents — everyone with a currently sealed quotation
            # on this requirement, not just the asker, matching how the question itself
            # is public rather than a private reply.
            preview = updated.answer if len(updated.answer) <= 80 else f"{updated.answer[:80]}…"
            notified = {q.business_id for q in repo.list_active_quotations(session, requirement_id)}
            for business_id in notified:
                notif_repo.create_if_allowed(
                    session,
                    user_id=business_id,
                    type_="QUESTION_ANSWERED",
                    category="activity",
                    title="A clarification question was answered",
                    detail=f"{req.ref_code} · {req.title}: {preview}",
                )

            return self._question_out(session, updated)

    # ---------- release (system-clock triggered, no human actor) ----------

    def release_due_requirements(self) -> int:
        """Called by the scheduler. Returns how many requirements were
        released, purely so the caller can log it."""
        released_count = 0
        with Session(engine) as session:
            due = repo.list_open_requirements_past_closing(session)
            for req in due:
                self._release_one(session, req)
                released_count += 1
        return released_count

    def _release_one(self, session: Session, req: Requirement) -> None:
        actives = repo.list_active_quotations(session, req.id)

        for q in actives:
            payload = {
                "requirement_id": q.requirement_id,
                "business_id": q.business_id,
                "total_price": q.total_price,
                "delivery_lead_time": q.delivery_lead_time,
                "payment_terms": q.payment_terms,
                "validity_period": q.validity_period,
                "notes": q.notes,
            }
            submitted_entry = ledger_repo.get_entry(session, q.ledger_entry_id) if q.ledger_entry_id else None
            if submitted_entry:
                recomputed = ledger_service.compute_hash(submitted_entry.prev_hash, payload)
                q.integrity_status = "valid" if recomputed == q.submission_hash else "flagged"
            else:
                # Should not happen in normal operation — no ledger record
                # to check against, so we can't vouch for it.
                q.integrity_status = "flagged"

            q.status = "released"
            q.released_at = datetime.utcnow()
            repo.update_quotation(session, q)

            # One-to-one messaging opens at release, not at award — the buyer can talk
            # to any respondent whose quotation actually released, not only the one
            # eventually awarded. get_thread_for_business guards against ever creating
            # a second thread for the same (requirement, business) pair.
            if not msg_repo.get_thread_for_business(session, req.id, q.business_id):
                msg_repo.create_thread(session, requirement_id=req.id, buyer_id=req.owner_id, business_id=q.business_id)

        req.status = "closed"
        req.released_at = datetime.utcnow()
        repo.update_requirement(session, req)

        _log(session, "RELEASED", req.id, None, None, {
            "requirement_id": req.id, "released_count": len(actives),
        })

    # ---------- post-release view ----------

    def list_quotations_view(self, requirement_id: int) -> RequirementQuotationsView:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()

            if req.status == "open":
                count = repo.count_active_quotations(session, requirement_id)
                return RequirementQuotationsView(requirement_status="open", sealed_count=count)

            rows = repo.list_all_quotations_for_requirement(session, requirement_id)
            details = []
            for q in rows:
                business = session.get(User, q.business_id)
                posted_count = repo.count_requirements_by_owner(session, business.id)
                details.append(QuotationDetailOut(
                    id=q.id,
                    quotation_ref=f"QT-{q.id:06d}",
                    business=PosterOut(
                        id=business.id,
                        business_name=business.business_name,
                        registered_name=business.registered_name,
                        city=business.city,
                        province=business.province,
                        is_verified=business.is_verified,
                        tier=business.tier,
                        member_since_year=business.created_at.year,
                        requirements_posted_count=posted_count,
                    ),
                    total_price=q.total_price,
                    delivery_lead_time=q.delivery_lead_time,
                    payment_terms=q.payment_terms,
                    validity_period=q.validity_period,
                    notes=q.notes,
                    status=self._owner_view_status(req, q),
                    shortlisted=q.shortlisted,
                    submitted_at=q.created_at,
                    integrity_status=q.integrity_status,
                    attachments=[
                        AttachmentOut(id=a.id, filename=a.original_filename, uploaded_at=a.uploaded_at)
                        for a in repo.list_quotation_attachments(session, q.id)
                    ],
                ))

            return RequirementQuotationsView(
                requirement_status=req.status,
                quotations=details,
                awarded_quotation_id=req.awarded_quotation_id,
            )


            # ---------- ledger ----------

    def list_ledger(self, requirement_id: int, viewer_id: int) -> RequirementLedgerView:
        """Scoped view of this requirement's slice of the hash chain.

        - The owner sees the full chain for their requirement, but only once
          it's no longer open — while it's open, revealing WHO has
          submitted/withdrawn (or when) would leak sealed-bidding activity
          the same way an early quotations list would.
        - A respondent sees only entries where they were the actor (their
          own SUBMITTED/WITHDRAWN events), never other businesses' rows.
        - Anyone else (never owned or quoted on this requirement) sees an
          empty chain rather than a 403, consistent with how the rest of
          this API treats read access.
        """
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()

            all_entries = ledger_repo.list_for_requirement(session, requirement_id)

            if req.owner_id == viewer_id:
                visible = [] if req.status == "open" else all_entries
            else:
                visible = [e for e in all_entries if e.actor_id == viewer_id]

            entries = [
                LedgerEntryOut(
                    id=e.id,
                    sequence=e.id,
                    event_type=e.event_type,
                    requirement_id=e.requirement_id,
                    quotation_id=e.quotation_id,
                    actor_id=e.actor_id,
                    prev_hash=e.prev_hash,
                    entry_hash=e.entry_hash,
                    created_at=e.created_at,
                )
                for e in visible
            ]
            return RequirementLedgerView(requirement_id=requirement_id, entries=entries)

    # ---------- owner's post-release view ----------

    def _owner_view_status(self, req: Requirement, q: Quotation) -> str:
        """QuotationDetailOut.status for the owner's quotations list — reflects
        the real outcome (awarded/not_selected/shortlisted), not just the
        quotation's own released/withdrawn/voided row status."""
        if q.status != "released":
            return q.status
        if req.status == "awarded":
            return "awarded" if req.awarded_quotation_id == q.id else "not_selected"
        if req.status == "closed_no_award":
            return "not_selected"
        return "shortlisted" if q.shortlisted else "released"

    # ---------- "My Quotations" ----------

    def _outcome_for(self, req: Requirement, q: Quotation) -> str:
        if q.status == "withdrawn":
            return "withdrawn"
        if q.status == "voided":
            return "voided"
        if q.status == "sealed":
            return "sealed"
        # status == "released" from here on
        if req.status == "closed_no_award":
            return "not_awarded"
        if req.status == "awarded":
            return "awarded" if req.awarded_quotation_id == q.id else "not_awarded"
        return "released"

    def list_my_quotations(self, business_id: int) -> List[MyQuotationOut]:
        with Session(engine) as session:
            quotations = repo.list_quotations_by_business(session, business_id)
            out = []
            for q in quotations:
                req = repo.get_requirement(session, q.requirement_id)
                if not req:
                    continue  # defensive: shouldn't happen, but never crash the list over one row
                owner = session.get(User, req.owner_id)
                posted_count = repo.count_requirements_by_owner(session, req.owner_id)

                out.append(MyQuotationOut(
                    quotation_id=q.id,
                    quotation_ref=f"QT-{q.id:06d}",
                    status=q.status,
                    outcome=self._outcome_for(req, q),
                    total_price=q.total_price,
                    delivery_lead_time=q.delivery_lead_time,
                    payment_terms=q.payment_terms,
                    validity_period=q.validity_period,
                    notes=q.notes,
                    submitted_at=q.created_at,
                    integrity_status=q.integrity_status,
                    attachments=[
                        AttachmentOut(id=a.id, filename=a.original_filename, uploaded_at=a.uploaded_at)
                        for a in repo.list_quotation_attachments(session, q.id)
                    ],
                    requirement_id=req.id,
                    requirement_ref_code=req.ref_code,
                    requirement_title=req.title,
                    requirement_location=req.location,
                    requirement_status=req.status,
                    closes_at=req.closes_at,
                    released_at=req.released_at,
                    poster=PosterOut(
                        id=owner.id,
                        business_name=owner.business_name,
                        registered_name=owner.registered_name,
                        city=owner.city,
                        province=owner.province,
                        is_verified=owner.is_verified,
                        tier=owner.tier,
                        member_since_year=owner.created_at.year,
                        requirements_posted_count=posted_count,
                    ),
                ))
            return out

    def award(self, requirement_id: int, owner_id: int, quotation_id: int) -> RequirementOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status == "awarded":
                raise AlreadyAwarded()
            if req.status != "closed":
                raise RequirementNotReleased()

            quotation = repo.get_quotation(session, quotation_id)
            if not quotation or quotation.requirement_id != requirement_id or quotation.status != "released":
                raise InvalidQuotation()

            req.status = "awarded"
            req.awarded_quotation_id = quotation_id
            updated = repo.update_requirement(session, req)

            _log(session, "AWARDED", requirement_id, quotation_id, owner_id, {
                "requirement_id": requirement_id,
                "quotation_id": quotation_id,
                "awarded_business_id": quotation.business_id,
            })

            for q in repo.list_all_quotations_for_requirement(session, requirement_id):
                if q.status != "released":
                    continue
                won = q.id == quotation_id
                notif_repo.create_if_allowed(
                    session,
                    user_id=q.business_id,
                    type_="DECISION",
                    category="activity",
                    title="You won this requirement" if won else "Not selected this time",
                    detail=(
                        f"Your quotation on {req.ref_code} · {req.title} was awarded."
                        if won
                        else f"{req.ref_code} · {req.title} was awarded to another business."
                    ),
                    urgent=won,
                )

            return self._to_out(session, updated)

    def set_shortlist(self, requirement_id: int, quotation_id: int, owner_id: int, shortlisted: bool) -> None:
        """Owner's private working note on one released quotation — purely a
        comparison aid, not written to the ledger, and never visible to the
        respondent. Locked once the requirement reaches a final decision."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status != "closed":
                raise RequirementNotReleased()

            quotation = repo.get_quotation(session, quotation_id)
            if not quotation or quotation.requirement_id != requirement_id or quotation.status != "released":
                raise InvalidQuotation()

            quotation.shortlisted = shortlisted
            repo.update_quotation(session, quotation)

    def close_without_award(self, requirement_id: int, owner_id: int) -> RequirementOut:
        """The buyer reviewed every released quotation and chose to award none
        of them — a final decision, same weight as award(), just with no
        winner. Every released respondent is notified, same as a loss."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status in ("awarded", "closed_no_award"):
                raise AlreadyDecided()
            if req.status != "closed":
                raise RequirementNotReleased()

            req.status = "closed_no_award"
            updated = repo.update_requirement(session, req)

            _log(session, "CLOSED_NO_AWARD", requirement_id, None, owner_id, {
                "requirement_id": requirement_id,
            })

            for q in repo.list_all_quotations_for_requirement(session, requirement_id):
                if q.status != "released":
                    continue
                notif_repo.create_if_allowed(
                    session,
                    user_id=q.business_id,
                    type_="DECISION",
                    category="activity",
                    title="Not selected this time",
                    detail=f"{req.ref_code} · {req.title} was closed without an award.",
                )

            return self._to_out(session, updated)

    # ---------- closing-soon alert (system-clock triggered, no human actor) ----------

    CLOSING_SOON_WINDOW_HOURS = 24

    def notify_closing_soon(self) -> int:
        """Called by the scheduler. Alerts an open requirement's owner once — the
        first tick that finds it inside the closing window creates the notification;
        every later tick skips it via notif_repo.exists_for_requirement, so the owner
        never gets the same "closing soon" alert twice for one requirement."""
        notified = 0
        with Session(engine) as session:
            soon = repo.list_open_requirements_closing_within(session, self.CLOSING_SOON_WINDOW_HOURS)
            for req in soon:
                if notif_repo.exists_for_requirement(session, req.owner_id, "REQUIREMENT_CLOSING", req.id):
                    continue
                hours_left = max(1, round((req.closes_at - datetime.utcnow()).total_seconds() / 3600))
                notif_repo.create_if_allowed(
                    session,
                    user_id=req.owner_id,
                    type_="REQUIREMENT_CLOSING",
                    category="activity",
                    title="Your requirement is closing soon",
                    detail=f"{req.ref_code} · {req.title} · {hours_left} hour{'s' if hours_left != 1 else ''} remaining",
                    urgent=hours_left <= 6,
                    related_requirement_id=req.id,
                )
                notified += 1
        return notified


requirement_service = RequirementService()