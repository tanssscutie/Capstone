import json
import logging
from datetime import datetime, timedelta
from typing import List

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, select

from app.core import addresses, file_crypto
from app.core.categories import ATTRIBUTES, OTHER_ITEM_CODE, get_item_specs, item_name, validate_item_specs
from app.core.units import normalize as normalize_units
from app.core.config import settings
from app.core.database import engine
from app.core.clock import now_ph, to_ph_naive
from app.models.requirement import Requirement
from app.models.requirement_attachment import RequirementAttachment
from app.models.saved_requirement import SavedRequirement
from app.models.quotation import Quotation
from app.models.quotation_attachment import QuotationAttachment
from app.models.ledger_entry import LedgerEntry
from app.models.user import User
from app.models.transaction_closeout import TransactionCloseout
from app.repositories import requirement_repository as repo
from app.repositories import ledger_repository as ledger_repo
from app.repositories import notification_repository as notif_repo
from app.repositories import message_repository as msg_repo
from app.services import ledger_service
from app.services import matching_service
from app.schemas.requirement import (
    RequirementCreate,
    RequirementOut,
    PosterOut,
    SpecRow,
    LineItem,
    AttachmentOut,
    QuotationCreate,
    SpecResponseIn,
    SpecResponseOut,
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

logger = logging.getLogger("trustlink.requirements")


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


class AlreadyQuoted(Exception):
    """Raised on submit_quotation when this business already has a sealed
    quotation on this requirement — withdraw it first, then resubmit."""


class CannotQuoteOwnRequirement(Exception):
    """Raised on submit_quotation when the caller is the requirement's own
    owner. Normally unreachable now that only buyers post and only sellers
    quote (see security.require_seller), but a business whose account type
    was backfilled to seller may still own requirements it posted before the
    buyer/seller split — this keeps it from quoting on those."""


class AlreadyAwarded(Exception):
    pass


class AlreadyDecided(Exception):
    """Raised when an action (shortlist, close-without-award) requires the
    requirement to still be awaiting a decision, but it's already awarded or
    already closed without one."""


class InvalidQuotation(Exception):
    pass


class NoAwardPending(Exception):
    """Raised on accept_award/decline_award when this requirement has no
    outstanding Notice of Award to respond to."""


class NotAwardCandidate(Exception):
    """Raised on accept_award/decline_award when the caller isn't the
    business the pending Notice of Award was sent to."""


class HasActiveQuotations(Exception):
    """Raised when trying to extend a closing time after quotes exist."""


class QuestionNotFound(Exception):
    pass


class NotEnoughQuotations(Exception):
    """Raised on award when fewer than MIN_QUOTATIONS_TO_RELEASE quotations released."""


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
    # How long a proposed winner has to accept or decline a Notice of Award
    # before it auto-declines (see expire_due_award_notices).
    AWARD_RESPONSE_WINDOW_DAYS = 3

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
            display_name=owner.display_name,
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
            item_code=req.item_code,
            item_name=item_name(req.category, req.item_code),
            scope=req.scope,
            specifications=[SpecRow(**s) for s in json.loads(req.specifications_json or "[]")],
            quantity=req.quantity,
            price_min=req.price_min,
            price_max=req.price_max,
            city=req.city,
            site_address=req.site_address,
            barangay=req.barangay,
            zip_code=req.zip_code,
            auto_extended_at=req.auto_extended_at,
            location=req.location,
            site_access_hours=req.site_access_hours,
            site_access_notes=req.site_access_notes,
            required_documents=[d for d in req.required_documents.split(",") if d],
            delivery_start=req.delivery_start,
            delivery_end=req.delivery_end,
            attachments=[AttachmentOut(id=a.id, filename=a.original_filename, uploaded_at=a.uploaded_at) for a in attachments],
            match_note=self._match_note(req, viewer),
            status=req.status,
            quotations_count=quotations_count,
            latest_quotation_at=latest_q_at,
            closes_at=req.closes_at,
            released_at=req.released_at,
            created_at=req.created_at,
            awarded_quotation_id=req.awarded_quotation_id,
            award_response_deadline=req.award_response_deadline,
            my_active_quotation_ref=my_active_ref,
            is_saved=is_saved,
        )

    def _match_note(self, req: Requirement, viewer: User | None) -> str | None:
        """Rule-based relevance explanation — NOT the semantic/vector
        matching from the study's specific objective 4. This is a
        deliberately simple placeholder (category + location + keyword
        overlap) that gives an honest reason rather than a fabricated one,
        while the embeddings-based matcher remains future work."""
        if not viewer or viewer.role != "seller" or not viewer.industry_category:
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
            pairs = [(r, self._to_out(session, r, viewer)) for r in reqs]

            # Feed ordering: match first, then closing time — never popularity
            # or recency (Specific Objective #4 / Scope: Semantic Matching).
            # The match-boost only applies to a seller — a buyer isn't looking
            # for work matching their own capabilities, so their feed is
            # ordered by closing time alone.
            wants_work = viewer is not None and viewer.role == "seller"
            if wants_work and viewer and viewer.capability_embedding:
                # Real vector-database ranking, not the rule-based match_note
                # text (that stays as the honest, legible "why" shown on the
                # card — see _match_note's own docstring on why it's kept
                # separate). A requirement Qdrant never indexed (0.0, missing
                # from the dict) just sorts as no-boost, not an error.
                scores = matching_service.rank_requirement_ids(
                    viewer.capability_embedding, [r.id for r, _ in pairs],
                )
                pairs.sort(key=lambda pair: (-scores.get(pair[0].id, 0.0), pair[1].closes_at))
            elif wants_work:
                # No embedding yet (e.g. onboarding not completed) — fall back
                # to the same rule-based ordering used before this feature,
                # rather than an unordered/closing-time-only feed.
                pairs.sort(key=lambda pair: (pair[1].match_note is None, pair[1].closes_at))
            else:
                pairs.sort(key=lambda pair: pair[1].closes_at)
            return [out for _, out in pairs]

    def get_by_id(self, requirement_id: int, viewer_id: int | None = None) -> RequirementOut:
        """A single requirement's full detail, personalized the same way
        list_open's rows are (my_active_quotation_ref, is_saved) — used by
        requirement.tsx and submit-quotation.tsx instead of the client-side
        requirementsCache, which only ever had what a list endpoint returned."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            viewer = session.get(User, viewer_id) if viewer_id else None
            return self._to_out(session, req, viewer)

    def list_closing_soon(self, viewer_id: int | None = None) -> List[RequirementOut]:
        with Session(engine) as session:
            viewer = session.get(User, viewer_id) if viewer_id else None
            reqs = repo.list_closing_soon(session)
            return [self._to_out(session, r, viewer) for r in reqs]

    # ---------- create ----------

    @staticmethod
    def _checked_specs(data: RequirementCreate) -> list[dict]:
        """The rows to store: validated against the item's merged specs
        (plain-string 422s, worded like the frontend's), each with its
        value normalized to the standard unit where it has one."""
        category = data.category.strip()
        try:
            validate_item_specs(category, data.item_code, [s.model_dump() for s in data.specifications], data.quantity)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        units = {s["id"]: s["unit"] for s in get_item_specs(category, data.item_code)}
        rows = []
        for s in data.specifications:
            if s.attribute_id and s.attribute_id not in ATTRIBUTES:
                raise HTTPException(status_code=422, detail=f"Unknown specification \"{s.attribute_id}\".")
            default_unit = units.get(s.attribute_id) or (ATTRIBUTES[s.attribute_id]["unit"] if s.attribute_id else None)
            normalized = normalize_units(s.value, default_unit)
            rows.append({
                "label": s.label.strip(),
                "value": s.value.strip(),
                "attribute_id": s.attribute_id,
                "normalized_value": normalized[0] if normalized else None,
                "normalized_unit": normalized[1] if normalized else None,
            })
        return rows

    def create(self, owner_id: int, data: RequirementCreate) -> RequirementOut:
        specs = self._checked_specs(data)
        with Session(engine) as session:
            ref_code = repo.next_ref_code(session)

            # Structured address: the barangay must be one of the city's (PSGC),
            # and a ZIP is required alongside it.
            barangay = None
            if data.barangay and data.barangay.strip():
                record = addresses.find_barangay(data.city.strip(), data.barangay)
                if not record:
                    raise HTTPException(status_code=422, detail=f"Pick a barangay in {data.city.strip()} from the list.")
                barangay = record["name"]
                if not data.zip_code:
                    raise HTTPException(status_code=422, detail="Add the ZIP code for the delivery address.")
            site_address = addresses.compose_site_address(data.site_address, barangay, data.zip_code)

            location = data.city.strip()
            if site_address:
                location = f"{location} — {site_address}"

            req = Requirement(
                ref_code=ref_code,
                title=data.title,
                tags=data.category.strip().upper(),
                owner_id=owner_id,
                category=data.category.strip(),
                item_code=data.item_code,
                scope=data.scope.strip(),
                specifications_json=json.dumps(specs),
                quantity=data.quantity.strip(),
                price_min=data.price_min,
                price_max=data.price_max,
                city=data.city.strip(),
                site_address=site_address or None,
                barangay=barangay,
                zip_code=data.zip_code if barangay else None,
                location=location,
                required_documents=",".join(d.strip() for d in data.required_documents if d.strip()),
                delivery_start=to_ph_naive(data.delivery_start) if data.delivery_start else None,
                delivery_end=to_ph_naive(data.delivery_end) if data.delivery_end else None,
                closes_at=to_ph_naive(data.closes_at),
                embedding=matching_service.embed_to_json(
                    matching_service.requirement_matching_text(data.category, data.title, data.scope)
                ),
            )
            created = repo.create_requirement(session, req)
            matching_service.upsert_requirement_vector(created.id, created.embedding)
            invited = self._alert_invited_sellers(session, created, data.invited_business_ids)
            self._alert_matching_sellers(session, created, exclude_ids=frozenset(invited))
            return self._to_out(session, created)

    @staticmethod
    def _seller_offers_item(seller: User, item_code: str | None) -> bool:
        """A seller who picked items must offer this one (or "Other"); one who
        never picked any (older accounts) matches on category alone."""
        try:
            codes = {i.get("code") for i in json.loads(seller.offered_items or "[]")}
        except (ValueError, TypeError, AttributeError):
            codes = set()
        if not codes or not item_code or item_code == OTHER_ITEM_CODE:
            return True
        return item_code in codes or OTHER_ITEM_CODE in codes

    def matching_sellers(self, session: Session, req: Requirement) -> List[User]:
        """Panel Suggestion #2 (cold start): any verified seller in the
        requirement's category qualifies — no history needed — as long as
        they offer the item. Same rule as who sees it near the top of the feed."""
        category = (req.category or "").strip().lower()
        if not category:
            return []
        sellers = session.exec(
            select(User).where(
                User.role == "seller",
                User.is_active == True,  # noqa: E712
                User.is_verified == True,  # noqa: E712
                User.verification_status == "verified",
                User.id != req.owner_id,
            )
        ).all()
        return [
            u for u in sellers
            if (u.industry_category or "").strip().lower() == category and self._seller_offers_item(u, req.item_code)
        ]

    def _alert_invited_sellers(self, session: Session, req: Requirement, invited_ids: List[int]) -> List[int]:
        """"Request a quote": an invite alert to each invited seller who could
        quote anyway — verified, active, same category, not the buyer. Up
        to 5. Inviting changes nothing else: still public, still sealed."""
        alerted: List[int] = []
        try:
            owner = session.get(User, req.owner_id)
            buyer = (owner.display_name or owner.registered_name or owner.business_name) if owner else "A buyer"
            category = (req.category or "").strip().lower()
            for uid in list(dict.fromkeys(invited_ids or []))[:5]:
                u = session.get(User, uid)
                if (not u or u.id == req.owner_id or u.role != "seller" or not u.is_active or u.is_admin
                        or not (u.is_verified and u.verification_status == "verified")
                        or (u.industry_category or "").strip().lower() != category):
                    continue
                notif_repo.create_if_allowed(
                    session, user_id=u.id, type_="REQUIREMENT_MATCH", category="activity",
                    title=f"{buyer} invited you to quote",
                    detail=f"{req.ref_code} · {req.title} — open to every matching supplier, sealed until closing.",
                    urgent=True, related_requirement_id=req.id,
                )
                alerted.append(u.id)
        except Exception:
            session.rollback()
            logger.exception("Could not send invite alerts for requirement %s", req.id)
        return alerted

    def _alert_matching_sellers(self, session: Session, req: Requirement, exclude_ids: frozenset = frozenset()) -> int:
        """One "new requirement that matches you" alert per matching seller,
        the moment a requirement is published (and again if its closing is
        extended for too few quotations, skipping exclude_ids — those who
        already quoted). Never fails the post itself."""
        try:
            sellers = [s for s in self.matching_sellers(session, req) if s.id not in exclude_ids]
            item = item_name(req.category, req.item_code) if req.item_code and req.item_code != OTHER_ITEM_CODE else None
            closes = req.closes_at.strftime("%b %d, %I:%M %p").replace(" 0", " ")
            detail = f"{req.ref_code} · {req.title} — {req.city or req.location} · closes {closes}"
            for seller in sellers:
                notif_repo.create_if_allowed(
                    session,
                    user_id=seller.id,
                    type_="REQUIREMENT_MATCH",
                    category="activity",
                    title=f"New {item or req.category} requirement that matches your business",
                    detail=detail,
                    related_requirement_id=req.id,
                )
            return len(sellers)
        except Exception:
            session.rollback()
            logger.exception("Could not send match alerts for requirement %s", req.id)
            return 0

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
            # Encrypted at rest, same as business documents (file_crypto);
            # read back only through the access-checked *_file methods below.
            with open(full_path, "wb") as f:
                f.write(file_crypto.encrypt_bytes(contents))

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
                    item_code=req.item_code,
                    item_name=item_name(req.category, req.item_code),
                    scope=req.scope,
                    specifications=[SpecRow(**s) for s in json.loads(req.specifications_json or "[]")],
                    quantity=req.quantity,
                    required_documents=[d for d in req.required_documents.split(",") if d],
                    status=req.status,
                    city=req.city,
                    price_min=req.price_min,
                    price_max=req.price_max,
                    quotations_count=repo.count_quotations_for_requirement(session, req.id),
                    closes_at=req.closes_at,
                    released_at=req.released_at,
                    awarded_quotation_id=req.awarded_quotation_id,
                    award_response_deadline=req.award_response_deadline,
                    created_at=req.created_at,
                    fulfillment_status=self._order_status(session, req),
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

            req.closes_at = to_ph_naive(new_closes_at)
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
            req.cancelled_at = now_ph()
            updated = repo.update_requirement(session, req)

            _log(session, "CANCELLED", requirement_id, None, owner_id, {
                "requirement_id": requirement_id, "voided_count": len(actives),
            })

            for q in actives:
                notif_repo.create_if_allowed(
                    session,
                    user_id=q.business_id,
                    type_="REQUIREMENT_CANCELLED",
                    category="activity",
                    title="Requirement cancelled",
                    detail=f"{req.ref_code} · {req.title} was cancelled by the buyer. Your sealed quotation was voided unopened.",
                )

            return self._to_out(session, updated)

    # ---------- sealed submission ----------

    @staticmethod
    def _checked_spec_responses(req: Requirement, responses: List[SpecResponseIn]) -> list[dict]:
        """The rows to seal: exactly one answer per specification row of the
        requirement, in its order, attribute_id copied from the requirement
        (never from the client). 422 on a missing, extra or duplicate answer,
        or a "doesn't comply" without what's offered instead."""
        rows = json.loads(req.specifications_json or "[]")
        by_label: dict[str, SpecResponseIn] = {}
        for r in responses:
            label = r.label.strip()
            if label in by_label:
                raise HTTPException(status_code=422, detail=f"\"{label}\" is answered more than once.")
            if not any(row["label"].strip() == label for row in rows):
                raise HTTPException(status_code=422, detail=f"\"{label}\" isn't one of this requirement's specifications.")
            by_label[label] = r
        out = []
        for row in rows:
            label = row["label"].strip()
            answer = by_label.get(label)
            if not answer:
                raise HTTPException(status_code=422, detail=f"Confirm whether you meet {label}.")
            offered = (answer.offered or "").strip()
            if not answer.complies and not offered:
                raise HTTPException(status_code=422, detail=f"Say what you're offering instead for {label}.")
            out.append({
                "label": label,
                "attribute_id": row.get("attribute_id"),
                "complies": answer.complies,
                "offered": None if answer.complies else offered,
            })
        return out

    @staticmethod
    def _spec_responses_out(q: Quotation) -> List[SpecResponseOut]:
        return [SpecResponseOut(**r) for r in json.loads(q.spec_responses)] if q.spec_responses else []

    def submit_quotation(self, requirement_id: int, business_id: int, data: QuotationCreate) -> QuotationSealedReceipt:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id == business_id:
                raise CannotQuoteOwnRequirement()
            if req.status != "open" or req.closes_at <= now_ph():
                raise RequirementNotOpen()

            # One sealed quotation per business per requirement — no silent
            # replace. A business that wants to change its bid must withdraw
            # its existing one first (an explicit action, visible on the
            # ledger as its own WITHDRAWN entry), then submit again.
            existing = repo.get_active_quotation(session, requirement_id, business_id)
            if existing:
                raise AlreadyQuoted()

            line_items_json = json.dumps([li.model_dump() for li in data.line_items]) if data.line_items else ""
            spec_responses = self._checked_spec_responses(req, data.spec_responses)

            payload = {
                "requirement_id": requirement_id,
                "business_id": business_id,
                "total_price": data.total_price,
                "line_items": [li.model_dump() for li in data.line_items],
                "delivery_lead_time": data.delivery_lead_time,
                "payment_terms": data.payment_terms,
                "validity_period": data.validity_period,
                "notes": data.notes or "",
            }
            # Only when there are any — _release_one recomputes it the same way.
            if spec_responses:
                payload["spec_responses"] = spec_responses
            prev_hash = ledger_repo.get_last_hash(session)
            entry_hash = ledger_service.compute_hash(prev_hash, payload)

            quotation = Quotation(
                requirement_id=requirement_id,
                business_id=business_id,
                total_price=data.total_price,
                line_items=line_items_json,
                delivery_lead_time=data.delivery_lead_time,
                payment_terms=data.payment_terms,
                validity_period=data.validity_period,
                notes=data.notes or "",
                spec_responses=json.dumps(spec_responses) if spec_responses else None,
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

    async def upload_quotation_attachment(
        self, requirement_id: int, quotation_id: int, business_id: int, file: UploadFile, document_label: str | None = None,
    ) -> AttachmentOut:
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
            if req.status != "open" or req.closes_at <= now_ph() or quotation.status != "sealed":
                raise RequirementNotOpen()

            import os
            import uuid

            upload_dir = os.path.join("uploads", "quotations", str(quotation_id))
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(file.filename or "")[1] or ".bin"
            saved_name = f"{uuid.uuid4().hex}{ext}"
            full_path = os.path.join(upload_dir, saved_name)

            contents = await file.read()
            # Encrypted at rest, same as business documents (file_crypto);
            # read back only through the access-checked *_file methods below.
            with open(full_path, "wb") as f:
                f.write(file_crypto.encrypt_bytes(contents))

            attachment = QuotationAttachment(
                quotation_id=quotation_id,
                file_path=full_path,
                original_filename=file.filename or saved_name,
                document_label=document_label.strip() if document_label and document_label.strip() else None,
            )
            created = repo.add_quotation_attachment(session, attachment)
            return AttachmentOut(
                id=created.id,
                filename=created.original_filename,
                document_label=created.document_label,
                uploaded_at=created.uploaded_at,
            )

    # ---------- attachment downloads ----------

    @staticmethod
    def _read_attachment(path: str, filename: str) -> tuple[bytes, str]:
        import os

        if not path or not os.path.exists(path):
            raise RequirementNotFound()
        with open(path, "rb") as f:
            # Lenient: files uploaded before encryption was added are plain.
            return file_crypto.decrypt_bytes_lenient(f.read()), filename or os.path.basename(path)

    def requirement_attachment_file(self, requirement_id: int, attachment_id: int) -> tuple[bytes, str]:
        """A requirement's own attachments (drawings, reference photos) are part
        of the posting, so any signed-in business that can open the
        requirement can open them."""
        with Session(engine) as session:
            attachment = session.get(RequirementAttachment, attachment_id)
            if not attachment or attachment.requirement_id != requirement_id:
                raise RequirementNotFound()
            return self._read_attachment(attachment.file_path, attachment.original_filename)

    def quotation_attachment_file(self, requirement_id: int, quotation_id: int, attachment_id: int, viewer_id: int) -> tuple[bytes, str]:
        """Sealed like the quotation it belongs to: the respondent can always
        open their own; the buyer (and admins) only once it has released.
        Nobody else, ever — same rule as list_quotations_view."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            quotation = repo.get_quotation(session, quotation_id)
            attachment = session.get(QuotationAttachment, attachment_id)
            if (not req or not quotation or not attachment or quotation.requirement_id != requirement_id
                    or attachment.quotation_id != quotation_id):
                raise RequirementNotFound()
            if quotation.business_id != viewer_id:
                viewer = session.get(User, viewer_id)
                is_buyer_side = req.owner_id == viewer_id or bool(viewer and viewer.is_admin)
                if not is_buyer_side:
                    raise NotOwner()
                if quotation.status != "released":
                    raise RequirementNotReleased()
            return self._read_attachment(attachment.file_path, attachment.original_filename)

    # ---------- withdraw ----------

    def withdraw_quotation(self, requirement_id: int, business_id: int) -> None:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.status != "open" or req.closes_at <= now_ph():
                raise RequirementNotOpen()

            existing = repo.get_active_quotation(session, requirement_id, business_id)
            if not existing:
                raise NoActiveQuotation()

            self._withdraw_row(session, existing, business_id)

    def _withdraw_row(self, session: Session, quotation: Quotation, actor_id: int) -> None:
        quotation.status = "withdrawn"
        quotation.withdrawn_at = now_ph()
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
                # Feedback: an award must come from a real comparison. Short
                # of the minimum, quotations are never opened — the closing
                # is extended once, then the requirement is archived.
                active = repo.list_active_quotations(session, req.id)
                if len(active) >= settings.MIN_QUOTATIONS_TO_RELEASE:
                    self._release_one(session, req)
                    released_count += 1
                elif req.auto_extended_at is None:
                    self._auto_extend(session, req, active)
                else:
                    self._archive_insufficient(session, req, active)
        return released_count

    def _auto_extend(self, session: Session, req: Requirement, active: list) -> None:
        minimum = settings.MIN_QUOTATIONS_TO_RELEASE
        req.closes_at = max(req.closes_at, now_ph()) + timedelta(days=settings.AUTO_EXTEND_DAYS)
        req.auto_extended_at = now_ph()
        repo.update_requirement(session, req)
        _log(session, "AUTO_EXTENDED", req.id, None, None, {
            "requirement_id": req.id, "quotations": len(active), "minimum": minimum,
            "new_closes_at": req.closes_at.isoformat(),
        })
        closes = req.closes_at.strftime("%b %d, %I:%M %p").replace(" 0", " ")
        notif_repo.create_if_allowed(
            session, user_id=req.owner_id, type_="DECISION", category="activity",
            title="Closing extended — not enough quotations yet",
            detail=(f"{req.ref_code} · {req.title} got {len(active)} of the {minimum} quotations needed, "
                    f"so it stays open until {closes}. Quotations stay sealed."),
            urgent=True, related_requirement_id=req.id,
        )
        for q in active:
            notif_repo.create_if_allowed(
                session, user_id=q.business_id, type_="DECISION", category="activity",
                title="Closing extended",
                detail=f"{req.ref_code} · {req.title} now closes {closes}. Your quotation stays sealed.",
                related_requirement_id=req.id,
            )
        self._alert_matching_sellers(session, req, exclude_ids=frozenset(q.business_id for q in active))

    def _archive_insufficient(self, session: Session, req: Requirement, active: list) -> None:
        """Still short after the extension: archived, every quotation voided
        unopened — no price is ever revealed."""
        minimum = settings.MIN_QUOTATIONS_TO_RELEASE
        for q in active:
            q.status = "voided"
            repo.update_quotation(session, q)
        req.status = "insufficient_quotations"
        repo.update_requirement(session, req)
        _log(session, "ARCHIVED_INSUFFICIENT", req.id, None, None, {
            "requirement_id": req.id, "quotations": len(active), "minimum": minimum,
        })
        notif_repo.create_if_allowed(
            session, user_id=req.owner_id, type_="CLOSED_NO_AWARD", category="activity",
            title="Archived — not enough quotations",
            detail=(f"{req.ref_code} · {req.title} closed with {len(active)} of the {minimum} quotations needed, "
                    "so none were opened. Use \"Use Previous Requirement\" to post it again."),
            urgent=True, related_requirement_id=req.id,
        )
        for q in active:
            notif_repo.create_if_allowed(
                session, user_id=q.business_id, type_="CLOSED_NO_AWARD", category="activity",
                title="Requirement archived",
                detail=f"{req.ref_code} · {req.title} didn't get enough quotations. Yours was voided unopened.",
                related_requirement_id=req.id,
            )

    def _release_one(self, session: Session, req: Requirement) -> None:
        actives = repo.list_active_quotations(session, req.id)

        for q in actives:
            payload = {
                "requirement_id": q.requirement_id,
                "business_id": q.business_id,
                "total_price": q.total_price,
                "line_items": json.loads(q.line_items) if q.line_items else [],
                "delivery_lead_time": q.delivery_lead_time,
                "payment_terms": q.payment_terms,
                "validity_period": q.validity_period,
                "notes": q.notes,
            }
            # Same rule as submit_quotation: the key exists only when the
            # quotation has spec responses, so a quotation sealed before they
            # existed recomputes exactly the hash it was sealed with — and an
            # edited or deleted spec_responses column flags it.
            if q.spec_responses:
                payload["spec_responses"] = json.loads(q.spec_responses)
            submitted_entry = ledger_repo.get_entry(session, q.ledger_entry_id) if q.ledger_entry_id else None
            if submitted_entry:
                recomputed = ledger_service.compute_hash(submitted_entry.prev_hash, payload)
                q.integrity_status = "valid" if recomputed == q.submission_hash else "flagged"
            else:
                # Should not happen in normal operation — no ledger record
                # to check against, so we can't vouch for it.
                q.integrity_status = "flagged"

            q.status = "released"
            q.released_at = now_ph()
            repo.update_quotation(session, q)

        req.status = "closed"
        req.released_at = now_ph()
        repo.update_requirement(session, req)

        _log(session, "RELEASED", req.id, None, None, {
            "requirement_id": req.id, "released_count": len(actives),
        })

        notif_repo.create_if_allowed(
            session,
            user_id=req.owner_id,
            type_="REQUIREMENT_RELEASED",
            category="activity",
            title="Quotations released",
            detail=f"{req.ref_code} · {req.title} — {len(actives)} quotation{'s' if len(actives) != 1 else ''} released and ready to review.",
            urgent=True,
            related_requirement_id=req.id,
        )
        # Every respondent learns the posting closed — not whether they won.
        for q in actives:
            notif_repo.create_if_allowed(
                session,
                user_id=q.business_id,
                type_="REQUIREMENT_RELEASED",
                category="activity",
                title="Quotations opened",
                detail=f"{req.ref_code} · {req.title} — closed and opened. The buyer is reviewing quotations.",
                related_requirement_id=req.id,
            )

    # ---------- post-release view ----------

    def list_quotations_view(self, requirement_id: int, viewer_id: int) -> RequirementQuotationsView:
        """Every respondent's price, notes and attachments — so only the
        requirement's owner (and admins) may ever see it, sealed or released.
        Any other business, a respondent included, gets NotOwner: competitors
        reading each other's released prices would undo sealed bidding.
        A respondent sees their own quotation via list_my_quotations."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != viewer_id:
                viewer = session.get(User, viewer_id)
                if not (viewer and viewer.is_admin):
                    raise NotOwner()

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
                        display_name=business.display_name,
                        city=business.city,
                        province=business.province,
                        is_verified=business.is_verified,
                        tier=business.tier,
                        member_since_year=business.created_at.year,
                        requirements_posted_count=posted_count,
                    ),
                    total_price=q.total_price,
                    line_items=[LineItem(**li) for li in json.loads(q.line_items)] if q.line_items else [],
                    delivery_lead_time=q.delivery_lead_time,
                    payment_terms=q.payment_terms,
                    validity_period=q.validity_period,
                    notes=q.notes,
                    spec_responses=self._spec_responses_out(q),
                    status=self._owner_view_status(req, q),
                    shortlisted=q.shortlisted,
                    submitted_at=q.created_at,
                    integrity_status=q.integrity_status,
                    attachments=[
                        AttachmentOut(id=a.id, filename=a.original_filename, document_label=a.document_label, uploaded_at=a.uploaded_at)
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

            actor_ids = {e.actor_id for e in visible if e.actor_id is not None}
            actors = {u.id: u for u in session.exec(select(User).where(User.id.in_(actor_ids)))} if actor_ids else {}

            entries = [
                LedgerEntryOut(
                    id=e.id,
                    sequence=e.id,
                    event_type=e.event_type,
                    requirement_id=e.requirement_id,
                    quotation_id=e.quotation_id,
                    actor_id=e.actor_id,
                    actor_name=(
                        (actors[e.actor_id].display_name or actors[e.actor_id].registered_name or actors[e.actor_id].business_name)
                        if e.actor_id in actors
                        else None
                    ),
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
        if req.status == "award_pending":
            # Nothing is decided yet — only the proposed candidate's own row
            # changes; every other released quotation still reads exactly
            # like it did before the notice went out.
            return "award_pending" if req.awarded_quotation_id == q.id else "released"
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
        if req.status == "award_pending":
            return "award_pending" if req.awarded_quotation_id == q.id else "released"
        if req.status == "awarded":
            return "awarded" if req.awarded_quotation_id == q.id else "not_awarded"
        return "released"

    @staticmethod
    def _seller_progress(session: Session, req: Requirement, q: Quotation) -> dict:
        """The next-step facts My Quotations shows for this seller's quotation."""
        out = {"award_response_deadline": None, "thread_id": None, "closeout_state": None, "closeout_awaiting_me": False,
               "fulfillment_status": None}
        if req.awarded_quotation_id != q.id:
            return out
        if req.status == "award_pending":
            out["award_response_deadline"] = req.award_response_deadline
        if req.status == "awarded":
            thread = msg_repo.get_thread_for_business(session, req.id, q.business_id)
            out["thread_id"] = thread.id if thread else None
            rows = session.exec(select(TransactionCloseout).where(TransactionCloseout.requirement_id == req.id)).all()
            final = next((r for r in rows if r.status == "confirmed"), None)
            pending = next((r for r in rows if r.status == "pending"), None)
            out["closeout_state"] = final.outcome if final else "pending" if pending else "open"
            out["closeout_awaiting_me"] = bool(pending and pending.proposed_by_role == "buyer")
            out["fulfillment_status"] = final.outcome if final else req.fulfillment_status
        return out

    @staticmethod
    def _order_status(session: Session, req: Requirement) -> Optional[str]:
        """Same rule as fulfillment_service.effective_status, for list views."""
        if req.status != "awarded":
            return None
        final = session.exec(select(TransactionCloseout).where(
            TransactionCloseout.requirement_id == req.id, TransactionCloseout.status == "confirmed")).first()
        return final.outcome if final else req.fulfillment_status

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
                    **self._seller_progress(session, req, q),
                    total_price=q.total_price,
                    line_items=[LineItem(**li) for li in json.loads(q.line_items)] if q.line_items else [],
                    delivery_lead_time=q.delivery_lead_time,
                    payment_terms=q.payment_terms,
                    validity_period=q.validity_period,
                    notes=q.notes,
                    spec_responses=self._spec_responses_out(q),
                    submitted_at=q.created_at,
                    integrity_status=q.integrity_status,
                    attachments=[
                        AttachmentOut(id=a.id, filename=a.original_filename, document_label=a.document_label, uploaded_at=a.uploaded_at)
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
                        display_name=owner.display_name,
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
        """Sends a Notice of Award — proposes a winner, doesn't confirm one.
        Nothing is final and no other respondent is told they lost until the
        proposed business explicitly accepts (accept_award). A decline, or
        letting award_response_deadline pass, reverts this back to 'closed'
        so the buyer can propose someone else — see decline_award and
        expire_due_award_notices."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status in ("awarded", "award_pending"):
                raise AlreadyAwarded()
            if req.status != "closed":
                raise RequirementNotReleased()

            quotation = repo.get_quotation(session, quotation_id)
            if not quotation or quotation.requirement_id != requirement_id or quotation.status != "released":
                raise InvalidQuotation()
            released = [q for q in repo.list_all_quotations_for_requirement(session, requirement_id) if q.status == "released"]
            if len(released) < settings.MIN_QUOTATIONS_TO_RELEASE:
                raise NotEnoughQuotations()

            req.status = "award_pending"
            req.awarded_quotation_id = quotation_id
            req.award_response_deadline = now_ph() + timedelta(days=self.AWARD_RESPONSE_WINDOW_DAYS)
            updated = repo.update_requirement(session, req)

            _log(session, "AWARD_NOTICE_SENT", requirement_id, quotation_id, owner_id, {
                "requirement_id": requirement_id,
                "quotation_id": quotation_id,
                "candidate_business_id": quotation.business_id,
                "response_deadline": req.award_response_deadline.isoformat(),
            })

            # Only the candidate is told — every other released respondent
            # still doesn't know a decision is even in motion, same as they
            # never knew how many quotations existed while sealed. Telling
            # them "not selected" now, only to reopen the pick if this one
            # declines, would be a real, visible flip-flop.
            notif_repo.create_if_allowed(
                session,
                user_id=quotation.business_id,
                type_="DECISION",
                category="activity",
                title="You've been proposed as the winner",
                detail=(
                    f"{req.ref_code} · {req.title} — respond within "
                    f"{self.AWARD_RESPONSE_WINDOW_DAYS} days to accept or decline."
                ),
                urgent=True,
            )

            return self._to_out(session, updated)

    def accept_award(self, requirement_id: int, business_id: int) -> RequirementOut:
        """The proposed winner confirms — this is the only path that finalizes
        an award. Only now do the other released respondents learn they lost."""
        with Session(engine) as session:
            req, quotation = self._get_award_pending_or_raise(session, requirement_id, business_id)

            req.status = "awarded"
            req.award_response_deadline = None
            req.fulfillment_status = "awarded"
            req.fulfillment_updated_at = now_ph()
            req.fulfillment_reminders = 0
            updated = repo.update_requirement(session, req)

            # The Tier 3 award count just changed for this business — tier is
            # otherwise only recomputed on a document upload/re-verification,
            # which confirming an award isn't. Local import: business_service
            # doesn't import this module, so no cycle, but keeping the import
            # here (not at module level) matches this file's existing
            # convention for cross-service calls (see _match_note's req_repo).
            from app.services.business_service import business_service
            business_service.recompute_tier(business_id)

            _log(session, "AWARDED", requirement_id, quotation.id, business_id, {
                "requirement_id": requirement_id,
                "quotation_id": quotation.id,
                "awarded_business_id": business_id,
            })

            notif_repo.create_if_allowed(
                session,
                user_id=req.owner_id,
                type_="DECISION",
                category="activity",
                title="Award accepted",
                detail=f"Your Notice of Award for {req.ref_code} · {req.title} was accepted.",
            )
            for q in repo.list_all_quotations_for_requirement(session, requirement_id):
                if q.status != "released" or q.id == quotation.id:
                    continue
                notif_repo.create_if_allowed(
                    session,
                    user_id=q.business_id,
                    type_="DECISION",
                    category="activity",
                    title="Not selected this time",
                    detail=f"{req.ref_code} · {req.title} was awarded to another business.",
                )

            self._open_award_thread(session, req, quotation)

            return self._to_out(session, updated)

    @staticmethod
    def _award_message_body(req: Requirement, quotation: Quotation, buyer: User | None, supplier: User | None) -> str:
        def contact(user: User | None) -> str:
            if not user:
                return "—"
            name = user.contact_person or user.display_name or user.registered_name or user.business_name
            mobile = user.contact_mobile or user.mobile_number
            return f"{name} · {mobile}" if mobile else name

        price = f"₱{quotation.total_price:,.2f}" if quotation.total_price is not None else "the quoted amount"
        return (
            f"The award for {req.ref_code} · {req.title} is confirmed. "
            f"Quotation QT-{quotation.id:06d} was awarded at {price}.\n\n"
            "You can now coordinate delivery and payment here.\n"
            f"Buyer contact: {contact(buyer)}\n"
            f"Supplier contact: {contact(supplier)}\n\n"
            "Reminder: TrustLink does not handle payment, delivery, or contracts — both parties settle these directly."
        )

    def _open_award_thread(self, session: Session, req: Requirement, quotation: Quotation) -> None:
        """Post-procurement messaging opens only now, for the confirmed winner
        (Panel Suggestion #3), starting with one system message. Idempotent:
        reuses an existing thread (including one an older database opened at
        release) and never adds a second system message — so it is also what
        backfill_award_threads runs for awards that are missing one.

        The award is already committed when this runs, so a failure here is
        logged rather than raised — the winner must not see "could not accept"
        for an award that did go through."""
        try:
            thread = msg_repo.get_thread_for_business(session, req.id, quotation.business_id)
            if not thread:
                thread = msg_repo.create_thread(session, requirement_id=req.id, buyer_id=req.owner_id, business_id=quotation.business_id)
            if any(m.is_system for m in msg_repo.list_messages(session, thread.id)):
                return
            body = self._award_message_body(req, quotation, session.get(User, req.owner_id), session.get(User, quotation.business_id))
            msg_repo.create_message(session, thread.id, quotation.business_id, body, is_system=True)
        except Exception:
            session.rollback()
            logger.exception("Could not open the award thread for requirement %s", req.id)

    def backfill_award_threads(self) -> int:
        """Gives every awarded requirement its winner thread and system message
        if it lacks one — e.g. awards accepted before this feature, or while the
        message column was still too short. Run at startup; returns how many
        requirements it touched, purely for the log."""
        touched = 0
        with Session(engine) as session:
            for req in session.exec(select(Requirement).where(Requirement.status == "awarded")).all():
                quotation = repo.get_quotation(session, req.awarded_quotation_id) if req.awarded_quotation_id else None
                if not quotation:
                    continue
                thread = msg_repo.get_thread_for_business(session, req.id, quotation.business_id)
                if thread and any(m.is_system for m in msg_repo.list_messages(session, thread.id)):
                    continue
                self._open_award_thread(session, req, quotation)
                touched += 1
        return touched

    def decline_award(self, requirement_id: int, business_id: int) -> RequirementOut:
        """The proposed winner turns it down. Reverts to 'closed' rather than
        deciding anything final — the buyer picks again from the same
        released list, same as if they hadn't awarded yet."""
        with Session(engine) as session:
            req, quotation = self._get_award_pending_or_raise(session, requirement_id, business_id)
            return self._revert_award_pending(session, req, quotation, actor_id=business_id)

    def expire_due_award_notices(self) -> int:
        """Called by the scheduler. A Notice of Award nobody responded to
        within the window is treated exactly like a decline — the clock
        acts in the candidate's place, same reasoning as release being
        clock-triggered rather than person-triggered."""
        expired_count = 0
        with Session(engine) as session:
            due = repo.list_award_pending_requirements_past_deadline(session)
            for req in due:
                quotation = repo.get_quotation(session, req.awarded_quotation_id) if req.awarded_quotation_id else None
                if not quotation:
                    continue  # defensive: shouldn't happen, but never crash the sweep over one row
                self._revert_award_pending(session, req, quotation, actor_id=None)
                expired_count += 1
        return expired_count

    def _get_award_pending_or_raise(self, session: Session, requirement_id: int, business_id: int):
        req = repo.get_requirement(session, requirement_id)
        if not req:
            raise RequirementNotFound()
        if req.status != "award_pending" or not req.awarded_quotation_id:
            raise NoAwardPending()
        quotation = repo.get_quotation(session, req.awarded_quotation_id)
        if not quotation or quotation.business_id != business_id:
            raise NotAwardCandidate()
        return req, quotation

    def _revert_award_pending(self, session: Session, req: Requirement, quotation: "Quotation", actor_id: int | None) -> RequirementOut:
        req.status = "closed"
        req.awarded_quotation_id = None
        req.award_response_deadline = None
        updated = repo.update_requirement(session, req)

        _log(session, "AWARD_DECLINED", req.id, quotation.id, actor_id, {
            "requirement_id": req.id,
            "quotation_id": quotation.id,
            "declined_by_business_id": quotation.business_id,
            "auto_expired": actor_id is None,
        })

        notif_repo.create_if_allowed(
            session,
            user_id=req.owner_id,
            type_="DECISION",
            category="activity",
            title="Award declined",
            detail=(
                f"{req.ref_code} · {req.title} — the proposed winner "
                f"{'did not respond in time' if actor_id is None else 'declined the award'}. "
                "You can propose another respondent."
            ),
            urgent=True,
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
                    type_="CLOSED_NO_AWARD",
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
        never gets the same "closing soon" alert twice for one requirement.

        Everyone who saved it gets one too (_notify_savers), so a bookmark doesn't
        quietly close on them."""
        notified = 0
        with Session(engine) as session:
            soon = repo.list_open_requirements_closing_within(session, self.CLOSING_SOON_WINDOW_HOURS)
            for req in soon:
                hours_left = max(1, round((req.closes_at - now_ph()).total_seconds() / 3600))
                notified += self._notify_savers(session, req, hours_left)
                if notif_repo.exists_for_requirement(session, req.owner_id, "REQUIREMENT_CLOSING", req.id):
                    continue
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

    def _notify_savers(self, session: Session, req: Requirement, hours_left: int) -> int:
        """One alert per saver: not the owner, and not anyone who already quoted."""
        savers = session.exec(select(SavedRequirement.user_id).where(SavedRequirement.requirement_id == req.id)).all()
        sent = 0
        for user_id in set(savers):
            if user_id == req.owner_id or repo.get_active_quotation(session, req.id, user_id):
                continue
            if notif_repo.exists_for_requirement(session, user_id, "REQUIREMENT_CLOSING", req.id):
                continue
            notif_repo.create_if_allowed(
                session,
                user_id=user_id,
                type_="REQUIREMENT_CLOSING",
                category="activity",
                title="A requirement you saved closes soon",
                detail=f"{req.ref_code} · {req.title} · {hours_left} hour{'s' if hours_left != 1 else ''} remaining",
                urgent=hours_left <= 6,
                related_requirement_id=req.id,
            )
            sent += 1
        return sent


requirement_service = RequirementService()