import json
import os
import re
import uuid
from datetime import date, datetime, timedelta
from app.core.file_validation import check_contents, validate_upload
from app.core.clock import now_ph
from typing import List, Optional, Tuple

from fastapi.concurrency import run_in_threadpool
from fastapi import HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.core.categories import OTHER_ITEM_CODE, items_for
from app.core.database import engine
from app.core import file_crypto
from app.models.business_document import BusinessDocument
from app.models.user import User
from app.models.verification_review import VerificationReview
from app.repositories import business_repository as repo
from app.repositories import notification_repository as notif_repo
from app.schemas.business import OfferedItem, OnboardingSubmit, VerificationStatusOut, DocumentUploadOut, DocumentExtractionOut, DashboardStatsOut, AdminFlaggedBusinessOut, AdminStatsOut, AdminBusinessOut, PublicBusinessProfileOut
from app.schemas.business import AdminMarketplaceOut, AdminNeedsActionOut, AdminReviewRecordOut, AdminTrustOut, LabelCount
from app.services import document_extraction_service, profile_privacy
from app.services import matching_service

UPLOAD_ROOT = os.path.join("uploads", "documents")

VALID_DOC_TYPES = {"DTI", "SEC", "BIR", "MAYORS_PERMIT"}

# Lenient identifier-format checks. These confirm the *shape* of an
# identifier is plausible, not that it was actually issued — the system
# has no live integration with the DTI/SEC/BIR/LGU registries (see the
# study's limitations).
ID_FORMAT_PATTERNS = {
    "DTI": re.compile(r"^\d{6,15}$"),
    "SEC": re.compile(r"^[A-Za-z0-9\-]{6,20}$"),
    "BIR": re.compile(r"^\d{3}-\d{3}-\d{3}(-\d{3,5})?$"),
    "MAYORS_PERMIT": re.compile(r"^[A-Za-z0-9\-\/]{4,30}$"),
}

# Minimum document set required before a business can be auto-verified.
# DTI *or* SEC (sole proprietors vs corporations) plus BIR registration.
REQUIRED_FOR_TIER_1 = {"BIR"}
REQUIRED_ONE_OF_TIER_1 = {"DTI", "SEC"}
TIER_3_AWARD_THRESHOLD = 10


def _normalize(text: str) -> str:
    return " ".join(text.strip().upper().split())


# Scans and photos of permits/IDs (the picker allows images and PDF).
DOCUMENT_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}


def _mime(file: UploadFile) -> str:
    """The upload's type, from its name when the browser sent a generic one."""
    import mimetypes

    sent = (file.content_type or "").lower()
    if sent and sent != "application/octet-stream":
        return sent
    return (mimetypes.guess_type(file.filename or "")[0] or "").lower()


def _offered_item_names(user: User) -> list[str]:
    """offered_items is JSON [{code, other_text}] — the item names, for the profile."""
    from app.core.categories import CATEGORY_TREE

    names = {i["code"]: i["name"] for c in CATEGORY_TREE for i in c["items"]}
    try:
        rows = json.loads(user.offered_items or "[]")
    except (TypeError, ValueError):
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        name = (r.get("other_text") or "").strip() or names.get(r.get("code") or "", "")
        if name and name != "Other" and name not in out:
            out.append(name)
    return out


def _ai_check_note(check) -> str | None:
    """What the reviewing administrator sees next to the AI check."""
    if check.verdict == "other_document":
        note = f"The business confirmed it's the right document. AI saw: {check.detected_type or 'a different document'}. {check.reason}"
    elif check.verdict == "expected":
        note = check.reason
    else:
        note = "Not auto-checked — the AI check wasn't available for this file."
    return (note or "").strip()[:400] or None


class BusinessService:
    # ---------- onboarding ----------

    def submit_onboarding(self, user_id: int, data: OnboardingSubmit) -> None:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            # After onboarding, identity and contact are locked: what's on file
            # stays, whatever was sent (change_request_service handles changes).
            # A field still empty on file (older accounts) can be filled in.
            locked = user.onboarding_completed

            def keep(field: str, sent):
                current = getattr(user, field)
                return current if locked and current else sent

            category = keep("industry_category", data.industry_category or user.industry_category)
            if not category:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Pick your business category.",
                )
            offered_items = self._validate_offered_items(user, category, data.offered_items)
            if user.role == "seller":
                capabilities = [c for c in data.capabilities if c.strip()]
                service_areas = [a for a in data.service_areas if a.strip()]
                if len(capabilities) < 3 or not service_areas:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Sellers need at least 3 capabilities and 1 service area — they're how buyers' requirements get matched to you.",
                    )

            user.registered_name = keep("registered_name", data.registered_name.strip())
            if not locked:
                user.display_name = data.display_name.strip() if data.display_name and data.display_name.strip() else None
            user.business_type = keep("business_type", data.business_type.strip())
            user.industry_category = category
            user.offered_items = offered_items
            user.city = keep("city", data.city.strip())
            user.province = keep("province", data.province.strip())
            user.contact_person = keep("contact_person", data.contact_person.strip())
            user.contact_mobile = keep("contact_mobile", data.contact_mobile.strip())
            user.capabilities = ",".join(c.strip() for c in data.capabilities if c.strip())
            user.service_areas = ",".join(a.strip() for a in data.service_areas if a.strip())
            user.business_description = data.business_description.strip() if data.business_description and data.business_description.strip() else None
            # Semantic matching (Specific Objective #4) — recomputed whenever
            # capabilities/service areas/category change, since those are
            # exactly what a business's matching embedding is built from.
            user.capability_embedding = matching_service.embed_to_json(
                matching_service.business_matching_text(user.industry_category, data.capabilities, data.service_areas)
            )
            user.onboarding_completed = True
            # Only a first submission moves the status. Editing the profile later
            # (category and offered items included) never touches verification.
            if user.verification_status == "unverified":
                user.verification_status = "pending"

            repo.update_user(session, user)

    @staticmethod
    def _validate_offered_items(user: User, category: str, items: List[OfferedItem]) -> Optional[str]:
        """JSON for User.offered_items. A seller needs at least one item from
        their category; a buyer isn't asked, so anything sent is dropped."""
        if user.role != "seller":
            return None
        if not items:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Pick at least one item you offer.",
            )
        valid_codes = {i["code"] for i in items_for(category)}
        stored, seen = [], set()
        for item in items:
            if item.code not in valid_codes:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"\"{item.code}\" isn't an item in {category}.",
                )
            if item.code in seen:
                continue
            seen.add(item.code)
            other_text = (item.other_text or "").strip() if item.code == OTHER_ITEM_CODE else ""
            if item.code == OTHER_ITEM_CODE and not other_text:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Describe the other item you offer.",
                )
            stored.append({"code": item.code, "other_text": other_text or None})
        return json.dumps(stored)

    @staticmethod
    def _offered_items_out(user: User) -> List[OfferedItem]:
        return [OfferedItem(**i) for i in json.loads(user.offered_items or "[]")]

    # ---------- document upload + validation ----------

    async def extract_document_fields(self, doc_type: str, file: UploadFile) -> DocumentExtractionOut:
        """Assistive Document Extraction — see document_extraction_service.py.
        Stateless: doesn't touch the database, doesn't require onboarding to
        be complete yet (it runs *during* the DOCUMENTS step, before that's
        even submitted)."""
        doc_type = doc_type.strip().upper()
        if doc_type not in VALID_DOC_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"doc_type must be one of {sorted(VALID_DOC_TYPES)}",
            )
        contents = await file.read()
        # The Gemini call is blocking (up to ~30s worst case). Run it on a worker
        # thread: called directly inside this async handler it froze the whole
        # server — every other request, including the other documents' own
        # extractions, queued behind it.
        check = await run_in_threadpool(
            document_extraction_service.check_business_document, doc_type, contents, _mime(file)
        )
        return DocumentExtractionOut(id_number=check.id_number, verdict=check.verdict, message=check.message)

    async def upload_document(
        self,
        user_id: int,
        doc_type: str,
        declared_owner_name: str,
        declared_business_name: str,
        declared_id_number: str,
        declared_expiry_date: date | None,
        file: UploadFile,
        confirm_mismatch: bool = False,
    ) -> DocumentUploadOut:
        doc_type = doc_type.strip().upper()
        if doc_type not in VALID_DOC_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"doc_type must be one of {sorted(VALID_DOC_TYPES)}",
            )

        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            if not user.onboarding_completed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Complete business onboarding before uploading documents",
                )

            contents = await file.read()
            ext = validate_upload(file.filename, contents, DOCUMENT_EXTENSIONS, 10 * 1024 * 1024)
            # The AI document check, enforced here and not only in the form: a
            # clear non-document is refused, a different document needs the
            # business to confirm. Usually a cache hit from the pick-time check.
            check = await run_in_threadpool(
                document_extraction_service.check_business_document, doc_type, contents, _mime(file)
            )
            if check.verdict == "not_a_document":
                raise HTTPException(status_code=422, detail=check.message)
            if check.verdict == "other_document" and not confirm_mismatch:
                raise HTTPException(status_code=409, detail=check.message)
            saved_path = self._save_bytes(user_id, doc_type, contents, ext)

            document = BusinessDocument(
                user_id=user_id,
                doc_type=doc_type,
                file_path=saved_path,
                declared_owner_name=declared_owner_name.strip(),
                declared_business_name=declared_business_name.strip(),
                declared_id_number=declared_id_number.strip(),
                declared_expiry_date=declared_expiry_date,
                ai_check=check.verdict if check.verdict in ("expected", "other_document") else "not_checked",
                ai_check_note=_ai_check_note(check),
            )

            status_result, notes = self._validate_document(session, user, document)
            document.validation_status = status_result
            document.validation_notes = notes

            if status_result == "flagged":
                notif_repo.create_if_allowed(
                    session,
                    user_id=user_id,
                    type_="DOCUMENT_FLAGGED",
                    category="activity",
                    title=f"{doc_type} needs a second look",
                    detail=f"Your {doc_type} document was flagged for review: {notes}",
                )

            created = repo.add_document(session, document)
            result = DocumentUploadOut(**created.model_dump())

            # Re-evaluate the user's overall verification status now that a
            # new document is on file. This commits again, which would
            # expire `created`'s attributes — so we already captured the
            # response above.
            self._recompute_verification(session, user)

            return result

    def _save_bytes(self, user_id: int, doc_type: str, contents: bytes, ext: str) -> str:
        user_dir = os.path.join(UPLOAD_ROOT, str(user_id))
        os.makedirs(user_dir, exist_ok=True)
        filename = f"{doc_type}_{uuid.uuid4().hex}{ext}"
        full_path = os.path.join(user_dir, filename)

        # Encrypted at rest (Fernet) — the file on disk is never the raw upload.
        # See app.core.file_crypto and get_document_bytes_for_admin, which
        # decrypts it back on the one path that ever reads it again.
        with open(full_path, "wb") as f:
            f.write(file_crypto.encrypt_bytes(contents))

        return full_path

    def _validate_document(self, session: Session, user: User, document: BusinessDocument) -> Tuple[str, str]:
        reasons: List[str] = []

        # 1. Identifier format
        pattern = ID_FORMAT_PATTERNS.get(document.doc_type)
        if pattern and not pattern.match(document.declared_id_number.strip()):
            reasons.append(f"{document.doc_type} identifier does not match the expected format")

        # 2. Expiry
        if document.declared_expiry_date and document.declared_expiry_date < date.today():
            reasons.append("Document is past its declared expiry date")

        # 3. Business name should match the registered onboarding name
        if user.registered_name and _normalize(document.declared_business_name) != _normalize(user.registered_name):
            reasons.append("Business name on document does not match the registered onboarding name")

        # 4. Owner name should be consistent across a business's own documents
        existing_docs = repo.list_documents_for_user(session, user.id) if user.id else []
        owner_names = {_normalize(d.declared_owner_name) for d in existing_docs}
        owner_names.add(_normalize(document.declared_owner_name))
        if len(owner_names) > 1:
            reasons.append("Owner name is inconsistent with a previously uploaded document")

        if reasons:
            return "flagged", "; ".join(reasons)
        return "pass", ""

    # ---------- verification status + trust tier ----------

    def _missing_documents(self, session: Session, user: User) -> List[str]:
        """Document types still needed before this business can submit.
        A flagged document still counts as supplied — it's on us to review
        it, not on them to re-upload."""
        documents = repo.list_documents_for_user(session, user.id)
        supplied = {d.doc_type for d in documents}

        missing = []
        if not (supplied & REQUIRED_ONE_OF_TIER_1):
            missing.append("DTI_OR_SEC")
        for doc_type in REQUIRED_FOR_TIER_1:
            if doc_type not in supplied:
                missing.append(doc_type)
        return missing

    def submit_for_verification(self, user_id: int) -> VerificationStatusOut:
        """The formal hand-off. Before this, the business is still assembling
        their application; after it, they're waiting on review."""
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            if not user.onboarding_completed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Complete business onboarding before submitting",
                )
            if user.verification_status in ("submitted", "under_review", "verified"):
                # Already submitted — return current state rather than
                # resetting their place in the queue.
                return self.get_status(user_id)

            missing = self._missing_documents(session, user)
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Upload your required documents before submitting: " + ", ".join(missing),
                )

            user.submitted_at = now_ph()
            repo.update_user(session, user)
            self._recompute_verification(session, user)

            return self.get_status(user_id)

    def _recompute_verification(self, session: Session, user: User) -> None:
        """Decides how far along the review pipeline a business is — but
        never sets 'verified' itself. Every document passing its automated
        checks (format, expiry, name match) is not the same as a human
        having actually looked at the submission: that only ever happens
        through an explicit admin decision in admin_review(), even when
        nothing was flagged. Automated checks exist to surface obvious
        problems for the admin to see, not to substitute for their sign-off."""
        documents = repo.list_documents_for_user(session, user.id)
        passing_types = {d.doc_type for d in documents if d.validation_status == "pass"}
        flagged_exists = any(d.validation_status == "flagged" for d in documents)

        # Not yet submitted: they're still preparing, so the status only
        # reflects how far along they are.
        if not user.submitted_at:
            if user.onboarding_completed:
                user.verification_status = "pending"
            else:
                user.verification_status = "unverified"
            repo.update_user(session, user)
            return

        if user.verification_status == "verified":
            # Already verified by an admin — a later document (e.g. a Mayor's
            # Permit upload working toward Tier 2/3) can only raise the trust
            # tier here, never move status backward or demand a second sign-off
            # for the original verification.
            has_required = bool(passing_types & REQUIRED_ONE_OF_TIER_1) and REQUIRED_FOR_TIER_1.issubset(passing_types)
            if has_required:
                previous_tier = user.tier
                user.tier = self._compute_tier(session, user, passing_types)
                if user.tier > previous_tier:
                    notif_repo.create_if_allowed(
                        session,
                        user_id=user.id,
                        type_="TIER_UPGRADE",
                        category="activity",
                        title=f"You're now Tier {user.tier}",
                        detail=f"Your trust tier moved up from Tier {previous_tier} to Tier {user.tier}.",
                    )
                repo.update_user(session, user)
            return

        # Not yet verified: automated checks only ever place the business in
        # the admin's review queue, either as 'submitted' (nothing flagged)
        # or 'under_review' (something needs a closer look) — never straight
        # to 'verified'.
        user.verification_status = "under_review" if flagged_exists else "submitted"
        user.is_verified = False
        repo.update_user(session, user)

    def recompute_tier(self, user_id: int) -> None:
        """Re-checks the trust tier for an event that isn't a document
        upload — namely, a Notice of Award being confirmed, which is when
        the Tier 3 award count actually changes. _recompute_verification is
        otherwise only ever called from the document-upload/admin-review
        path, so without this, a business could cross the Tier 3 threshold
        by winning and simply never be moved up until they happened to
        upload an unrelated document afterward."""
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                return
            self._recompute_verification(session, user)

    def _compute_tier(self, session: Session, user: User, passing_types: set) -> int:
        # Tier reflects which documents were verified and how many times
        # this business has WON as a supplier — not delivery quality, since
        # the platform observes nothing after an award.
        from app.repositories import requirement_repository as req_repo

        tier = 1
        if "MAYORS_PERMIT" in passing_types:
            tier = 2
        awarded = req_repo.count_awarded_quotations_for_business(session, user.id)
        if tier == 2 and awarded >= TIER_3_AWARD_THRESHOLD:
            tier = 3
        return tier

    def admin_review(self, user_id: int, approve: bool, notes: str | None, admin_id: int) -> None:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            submitted_at = user.submitted_at

            documents = repo.list_documents_for_user(session, user_id)
            for d in documents:
                if d.validation_status == "flagged":
                    if approve:
                        d.validation_status = "pass"
                        d.validation_notes = ""
                    elif notes:
                        d.validation_notes = notes
                    session.add(d)
            session.commit()

            if approve:
                # This is the one and only place a business becomes 'verified' —
                # _recompute_verification() deliberately never sets it, since a
                # document merely passing its automated checks isn't the same
                # as an admin actually signing off on it.
                passing_types = {
                    d.doc_type for d in repo.list_documents_for_user(session, user_id) if d.validation_status == "pass"
                }
                has_required = bool(passing_types & REQUIRED_ONE_OF_TIER_1) and REQUIRED_FOR_TIER_1.issubset(passing_types)
                if has_required:
                    was_verified = user.verification_status == "verified"
                    previous_tier = user.tier
                    user.verification_status = "verified"
                    user.is_verified = True
                    if not was_verified:
                        user.verification_date = now_ph()
                        user.recheck_date = user.verification_date + timedelta(days=365)
                    user.tier = self._compute_tier(session, user, passing_types)
                    repo.update_user(session, user)
                    if was_verified and user.tier > previous_tier:
                        notif_repo.create_if_allowed(
                            session,
                            user_id=user.id,
                            type_="TIER_UPGRADE",
                            category="activity",
                            title=f"You're now Tier {user.tier}",
                            detail=f"Your trust tier moved up from Tier {previous_tier} to Tier {user.tier}.",
                        )
                else:
                    # Approving the flagged documents wasn't enough on its own —
                    # a required document type is still missing entirely.
                    user.verification_status = "submitted"
                    user.is_verified = False
                    repo.update_user(session, user)
                detail = (
                    "Your business is now verified."
                    if user.verification_status == "verified"
                    else f"Your submitted documents were reviewed. Status: {user.verification_status}."
                )
                notif_repo.create_if_allowed(session, user_id=user_id, type_="VERIFICATION", category="activity", title="Verification update", detail=detail)
            else:
                # A rejection is a decision, not a derived state, so it isn't
                # recomputed from the documents.
                user.verification_status = "rejected"
                user.is_verified = False
                repo.update_user(session, user)
                notif_repo.create_if_allowed(
                    session,
                    user_id=user_id,
                    type_="VERIFICATION",
                    category="activity",
                    title="Verification rejected",
                    detail=notes or "Your submission was rejected. Contact support for details.",
                    urgent=True,
                )

            # Audit: which administrator decided, what, and when.
            session.add(VerificationReview(
                user_id=user_id, admin_id=admin_id, approved=approve, result_status=user.verification_status,
                notes=(notes or "").strip()[:1000] or None, submitted_at=submitted_at,
            ))
            session.commit()
            from app.services import admin_audit
            admin_audit.record(session, admin_id, "verification_approved" if approve else "verification_rejected",
                               target_user_id=user_id, details=f"Result: {user.verification_status}"
                               + (f". Notes: {notes.strip()}" if notes and notes.strip() else ""))

    # ---------- read ----------

    def get_status(self, user_id: int) -> VerificationStatusOut:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            documents = repo.list_documents_for_user(session, user_id)
            return VerificationStatusOut(
                verification_status=user.verification_status,
                is_verified=user.is_verified,
                tier=user.tier,
                submitted_at=user.submitted_at,
                verification_date=user.verification_date,
                recheck_date=user.recheck_date,
                onboarding_completed=user.onboarding_completed,
                documents=[DocumentUploadOut(**d.model_dump()) for d in documents],
                has_submitted=user.submitted_at is not None,
                missing_documents=self._missing_documents(session, user),
                registered_name=user.registered_name,
                display_name=user.display_name,
                business_type=user.business_type,
                industry_category=user.industry_category,
                city=user.city,
                province=user.province,
                contact_person=user.contact_person,
                contact_mobile=user.contact_mobile,
                capabilities=[c for c in (user.capabilities or "").split(",") if c],
                service_areas=[a for a in (user.service_areas or "").split(",") if a],
                business_description=user.business_description,
                offered_items=self._offered_items_out(user),
            )

    def get_public_profile(self, business_id: int, viewer_id: int, view_as: str | None = None) -> PublicBusinessProfileOut:
        with Session(engine) as session:
            viewer = session.get(User, viewer_id)
            if not viewer or not viewer.is_active:
                raise HTTPException(status_code=403, detail="Active account required")
            user = session.get(User, business_id)
            if not user or user.is_admin or not user.is_active:
                raise HTTPException(status_code=404, detail="Business not found")
            # Who's looking — the owner previewing "View as others" counts as that audience.
            who = profile_privacy.audience(viewer, user, view_as)
            privileged = who in ("owner", "admin")
            hidden = profile_privacy.hidden_sections(user, who)
            # Panel Suggestion #7.6: contact person + mobile are shown so
            # businesses can trust who they deal with. Limited to verified
            # viewers so unverified sign-ups can't harvest numbers — and to
            # whatever the owner allows on top of that.
            contacts_visible = (privileged or who == "verified") and "contact" not in hidden
            verified = user.is_verified and user.verification_status == "verified"
            documents = repo.list_documents_for_user(session, business_id)
            registration_types = sorted({
                d.doc_type for d in documents
                if d.doc_type in REQUIRED_ONE_OF_TIER_1 and d.validation_status == "pass"
            })
            return PublicBusinessProfileOut(
                id=user.id,
                role=user.role,
                registered_name=user.registered_name or user.business_name,
                display_name=user.display_name,
                business_type=user.business_type,
                industry_category=user.industry_category,
                city=user.city,
                province=user.province,
                business_description=None if "about" in hidden else user.business_description,
                capabilities=[] if "offered_items" in hidden else [c for c in (user.capabilities or "").split(",") if c],
                service_areas=[] if "service_areas" in hidden else [a for a in (user.service_areas or "").split(",") if a],
                offered_items=[] if "offered_items" in hidden else _offered_item_names(user),
                hidden_sections=hidden,
                visibility=profile_privacy.load(user) if who == "owner" else None,
                viewing_as=who if viewer.id == user.id and who != "owner" else None,
                is_verified=verified,
                tier=user.tier,
                verification_date=user.verification_date if verified else None,
                member_since_year=user.created_at.year,
                member_since=user.created_at,
                verification_status=user.verification_status if not user.is_verified or verified else "unverified",
                registration_document_types=registration_types,
                includes_sealed_activity=privileged,
                contact_details_visible=contacts_visible,
                contact_person=user.contact_person if contacts_visible else None,
                contact_mobile=user.contact_mobile if contacts_visible else None,
                has_avatar=bool(user.avatar_path),
                has_cover=bool(user.cover_path),
                headline=user.headline,
                website_url=None if "links" in hidden else user.website_url,
                facebook_url=None if "links" in hidden else user.facebook_url,
                years_in_business=user.years_in_business if user.role == "seller" else None,
                **repo.profile_activity_counts(session, user.id, include_sealed=privileged, now=now_ph()),
            )

    def section_visible(self, business_id: int, viewer_id: int, section: str) -> bool:
        """Profile privacy for the pieces served by their own endpoints (completed work)."""
        with Session(engine) as session:
            viewer = session.get(User, viewer_id)
            owner = session.get(User, business_id)
            if not viewer or not owner:
                return False
            return section not in profile_privacy.hidden_sections(owner, profile_privacy.audience(viewer, owner))

    def update_profile_visibility(self, user_id: int, choices: dict) -> dict:
        try:
            full = profile_privacy.check(choices)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            user.profile_visibility = json.dumps(full)
            session.add(user)
            session.commit()
            return full

    def list_flagged(self, session: Session) -> List[AdminFlaggedBusinessOut]:
        users = repo.list_flagged_users(session)
        out = []
        for user in users:
            documents = repo.list_documents_for_user(session, user.id)
            out.append(AdminFlaggedBusinessOut(
                user_id=user.id,
                role=user.role,
                business_name=user.business_name,
                mobile_number=user.mobile_number,
                registered_name=user.registered_name,
                business_type=user.business_type,
                industry_category=user.industry_category,
                city=user.city,
                province=user.province,
                contact_person=user.contact_person,
                contact_mobile=user.contact_mobile,
                submitted_at=user.submitted_at,
                documents=[DocumentUploadOut(**d.model_dump()) for d in documents],
            ))
        return out

    def list_all_businesses(self) -> List[AdminBusinessOut]:
        with Session(engine) as session:
            users = repo.list_all_users(session)
            last_review = {}
            for r in session.exec(select(VerificationReview).order_by(VerificationReview.created_at, VerificationReview.id)).all():
                last_review[r.user_id] = r
            admin_names = {u.id: u.business_name for u in session.exec(select(User).where(User.is_admin == True)).all()}  # noqa: E712

            def review_out(user_id: int) -> Optional[AdminReviewRecordOut]:
                r = last_review.get(user_id)
                if not r:
                    return None
                return AdminReviewRecordOut(admin_name=admin_names.get(r.admin_id, f"Admin #{r.admin_id}"),
                                            approved=r.approved, result_status=r.result_status, reviewed_at=r.created_at)

            return [
                AdminBusinessOut(
                    user_id=user.id,
                    role=user.role,
                    business_name=user.business_name,
                    mobile_number=user.mobile_number,
                    registered_name=user.registered_name,
                    business_type=user.business_type,
                    industry_category=user.industry_category,
                    city=user.city,
                    province=user.province,
                    onboarding_completed=user.onboarding_completed,
                    verification_status=user.verification_status,
                    is_verified=user.is_verified,
                    tier=user.tier,
                    submitted_at=user.submitted_at,
                    created_at=user.created_at,
                    documents=[DocumentUploadOut(**d.model_dump()) for d in repo.list_documents_for_user(session, user.id)],
                    suspended_until=user.suspended_until,
                    banned_at=user.banned_at,
                    last_review=review_out(user.id),
                )
                for user in users
            ]

    def get_document_for_admin(self, document_id: int) -> BusinessDocument:
        with Session(engine) as session:
            document = repo.get_document(session, document_id)
            if not document or not os.path.isfile(document.file_path):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
            return document

    def get_document_bytes_for_admin(self, document_id: int) -> Tuple[bytes, str]:
        """Decrypted file content + the original filename, for the one route
        that ever serves a document's actual bytes back (admin review)."""
        document = self.get_document_for_admin(document_id)
        with open(document.file_path, "rb") as f:
            encrypted = f.read()
        return file_crypto.decrypt_bytes_lenient(encrypted), os.path.basename(document.file_path)

    def get_admin_stats(self) -> AdminStatsOut:
        from app.services.report_service import report_service
        from datetime import timedelta
        from app.repositories import requirement_repository as req_repo
        from app.schemas.business import RegistrationsByDay

        with Session(engine) as session:
            since = now_ph() - timedelta(days=7)
            by_day = repo.registrations_by_day(session, since)

            return AdminStatsOut(
                total_businesses=repo.count_all_users(session),
                total_buyers=repo.count_users_by_role(session, "buyer"),
                total_sellers=repo.count_users_by_role(session, "seller"),
                verified_businesses=repo.count_verified_users(session),
                pending_review_count=len(repo.list_flagged_users(session)),
                open_reports_count=report_service.count_open(session),
                total_requirements=req_repo.count_all_requirements(session),
                open_requirements=req_repo.count_open_requirements(session),
                total_quotations=req_repo.count_all_quotations(session),
                registrations_last_7_days=[RegistrationsByDay(date=d, count=c) for d, c in by_day],
                needs_action=self._needs_action(session),
                marketplace=self._marketplace(session),
                trust=self._trust(session),
            )

    # Dashboard aggregates: rows are loaded and grouped in Python, not with
    # SQL date/group functions, so the same code runs on MySQL and on the
    # tests' SQLite. Fine at this platform's size.

    @staticmethod
    def _order_due(session: Session, req) -> Optional[datetime]:
        from datetime import time
        from app.services import delivery_schedule_service as delivery

        agreed = delivery.agreed_date(session, req.id)
        return datetime.combine(agreed, time(23, 59)) if agreed else req.delivery_end

    def _needs_action(self, session: Session) -> AdminNeedsActionOut:
        from app.models.business_report import BusinessReport
        from app.models.delivery_schedule import DeliverySchedule
        from app.models.profile_change_request import ProfileChangeRequest
        from app.models.requirement import Requirement
        from app.services.fulfillment_service import FINAL, effective_status
        from app.services.withdrawal_policy import REPORT_REASON

        now = now_ph()
        queue = repo.list_flagged_users(session)
        waited = [now - u.submitted_at for u in queue if u.submitted_at]
        queue_ids = [u.id for u in queue]
        docs = session.exec(select(BusinessDocument).where(BusinessDocument.user_id.in_(queue_ids))).all() if queue_ids else []
        reports = session.exec(select(BusinessReport).where(BusinessReport.status == "open")).all()
        awarded = session.exec(select(Requirement).where(Requirement.status == "awarded")).all()
        overdue = unconfirmed = 0
        for req in awarded:
            state = effective_status(session, req)
            if state == "unconfirmed":
                unconfirmed += 1
            elif state not in FINAL:
                due = self._order_due(session, req)
                if due and due < now:
                    overdue += 1
        return AdminNeedsActionOut(
            verification_queue=len(queue),
            oldest_waiting_days=max(waited).days if waited else None,
            documents_different=sum(1 for d in docs if d.ai_check == "other_document"),
            documents_not_checked=sum(1 for d in docs if d.ai_check == "not_checked"),
            open_reports=len(reports),
            withdrawal_flags=sum(1 for r in reports if r.reason == REPORT_REASON),
            pending_change_requests=len(session.exec(
                select(ProfileChangeRequest.id).where(ProfileChangeRequest.status == "pending")).all()),
            awards_awaiting_supplier=len(session.exec(
                select(Requirement.id).where(Requirement.status == "award_pending")).all()),
            delivery_dates_awaiting_reply=len(session.exec(
                select(DeliverySchedule.id).where(DeliverySchedule.status == "pending")).all()),
            overdue_orders=overdue,
            unconfirmed_orders=unconfirmed,
        )

    def _marketplace(self, session: Session) -> AdminMarketplaceOut:
        from collections import Counter
        from app.models.quotation import Quotation
        from app.models.requirement import Requirement
        from app.services.fulfillment_service import effective_status

        today = now_ph().date()
        reqs = session.exec(select(Requirement)).all()
        by_status = Counter(r.status for r in reqs)
        quotes = session.exec(select(Quotation.status)).all()
        active_quotes = sum(1 for s in quotes if s not in ("withdrawn", "voided"))
        awarded = [r for r in reqs if r.status == "awarded"]
        completed = sum(1 for r in awarded if effective_status(session, r) == "completed")

        def top(values) -> List[LabelCount]:
            counts = Counter(v.strip() for v in values if v and v.strip())
            return [LabelCount(label=k, count=c) for k, c in counts.most_common(5)]

        return AdminMarketplaceOut(
            open=by_status["open"],
            closing_today=sum(1 for r in reqs if r.status == "open" and r.closes_at.date() == today),
            released=by_status["closed"],
            award_pending=by_status["award_pending"],
            awarded=by_status["awarded"],
            archived_insufficient=by_status["insufficient_quotations"],
            closed_no_award=by_status["closed_no_award"],
            cancelled=by_status["cancelled"],
            avg_quotations_per_requirement=round(active_quotes / len(reqs), 1) if reqs else 0.0,
            posted=len(reqs),
            reached_release=sum(1 for r in reqs if r.released_at),
            reached_award=len(awarded),
            completed=completed,
            completion_rate=round(completed / len(awarded), 3) if awarded else None,
            top_categories=top(r.category for r in reqs),
            top_cities=top(r.city for r in reqs),
        )

    def _trust(self, session: Session) -> AdminTrustOut:
        from collections import Counter
        from datetime import timedelta
        from app.models.withdrawal_strike import WithdrawalStrike

        now = now_ph()
        reviews = session.exec(select(VerificationReview)).all()
        timed = [(r.created_at - r.submitted_at).total_seconds() / 3600 for r in reviews if r.submitted_at]
        businesses = [u for u in session.exec(select(User).where(User.is_admin == False)).all()]  # noqa: E712
        tiers = Counter(u.tier for u in businesses if u.verification_status == "verified")
        return AdminTrustOut(
            reviews_total=len(reviews),
            approval_rate=round(sum(1 for r in reviews if r.approved) / len(reviews), 3) if reviews else None,
            avg_review_hours=round(sum(timed) / len(timed), 1) if timed else None,
            tiers=[LabelCount(label=f"Tier {t}", count=tiers.get(t, 0)) for t in (1, 2, 3)],
            withdrawals_90_days=len(session.exec(select(WithdrawalStrike.id).where(
                WithdrawalStrike.created_at >= now - timedelta(days=90))).all()),
            suspended=sum(1 for u in businesses if u.suspended_until and u.suspended_until > now and not u.banned_at),
            banned=sum(1 for u in businesses if u.banned_at),
        )

    # ---------- dashboard stats (home sidebar) ----------

    def get_dashboard_stats(self, user_id: int) -> DashboardStatsOut:
        from app.repositories import requirement_repository as req_repo

        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            documents = repo.list_documents_for_user(session, user_id)
            doc_types = {d.doc_type for d in documents}

            return DashboardStatsOut(
                requirements_posted_count=req_repo.count_requirements_by_owner(session, user_id),
                quotations_submitted_count=req_repo.count_quotations_by_business(session, user_id),
                requirements_awarded_count=req_repo.count_awarded_quotations_for_business(session, user_id),
                member_since_year=user.created_at.year,
                profile_completion_pct=self._profile_completion(user, doc_types),
                tier_hint=self._tier_hint(session, user, doc_types),
            )

    def _profile_completion(self, user: User, doc_types: set) -> int:
        checklist = [
            bool(user.registered_name),
            bool(user.business_type),
            bool(user.industry_category),
            bool(user.city and user.province),
            bool(user.contact_person and user.contact_mobile),
        ]
        # Capabilities/service areas only count toward a seller's profile —
        # a buyer isn't asked for them (see submit_onboarding).
        if user.role != "buyer":
            checklist += [
                len([c for c in (user.capabilities or "").split(",") if c]) >= 3,
                len([a for a in (user.service_areas or "").split(",") if a]) >= 1,
            ]
        checklist += [
            bool(doc_types & REQUIRED_ONE_OF_TIER_1),
            "BIR" in doc_types,
            "MAYORS_PERMIT" in doc_types,
        ]
        return round(100 * sum(checklist) / len(checklist))

    def _tier_hint(self, session: Session, user: User, doc_types: set) -> str:
        if user.tier >= 3:
            return "You've reached the highest trust tier."
        if user.tier == 1:
            return (
                "Add your Mayor's permit to reach Tier 2."
                if user.role == "buyer"
                else "Add your Mayor's permit to work toward Tier 3."
            )
        if user.role == "buyer":
            # Tier 3 counts awards won as a supplier, which a buyer account
            # never receives — Tier 2 is as far as a buyer goes.
            return "Tier 2 is the highest tier for buyer accounts."

        from app.repositories import requirement_repository as req_repo
        awarded = req_repo.count_awarded_quotations_for_business(session, user.id)
        remaining = max(0, TIER_3_AWARD_THRESHOLD - awarded)
        if remaining == 0:
            return "You qualify for Tier 3 — it will apply on your next award."
        return f"Reach Tier 3 by completing {remaining} more awarded requirement{'s' if remaining != 1 else ''}."


business_service = BusinessService()
