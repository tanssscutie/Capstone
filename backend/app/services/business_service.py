import os
import re
import uuid
from datetime import date, datetime, timedelta
from app.core.clock import now_ph
from typing import List, Tuple

from fastapi import HTTPException, UploadFile, status
from sqlmodel import Session

from app.core.database import engine
from app.core import file_crypto
from app.models.business_document import BusinessDocument
from app.models.user import User
from app.repositories import business_repository as repo
from app.repositories import notification_repository as notif_repo
from app.schemas.business import OnboardingSubmit, VerificationStatusOut, DocumentUploadOut, DocumentExtractionOut, DescriptionSuggestionOut, DashboardStatsOut, AdminFlaggedBusinessOut, AdminStatsOut, AdminBusinessOut, PublicBusinessProfileOut
from app.services import document_extraction_service
from app.services import profile_assistant_service
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


class BusinessService:
    # ---------- onboarding ----------

    def submit_onboarding(self, user_id: int, data: OnboardingSubmit) -> None:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            user.registered_name = data.registered_name.strip()
            user.display_name = data.display_name.strip() if data.display_name and data.display_name.strip() else None
            user.business_type = data.business_type.strip()
            user.industry_category = data.industry_category.strip()
            user.city = data.city.strip()
            user.province = data.province.strip()
            user.contact_person = data.contact_person.strip()
            user.contact_mobile = data.contact_mobile.strip()
            user.capabilities = ",".join(c.strip() for c in data.capabilities if c.strip())
            user.service_areas = ",".join(a.strip() for a in data.service_areas if a.strip())
            user.signup_intent = data.signup_intent
            user.business_description = data.business_description.strip() if data.business_description and data.business_description.strip() else None
            # Semantic matching (Specific Objective #4) — recomputed whenever
            # capabilities/service areas/category change, since those are
            # exactly what a business's matching embedding is built from.
            user.capability_embedding = matching_service.embed_to_json(
                matching_service.business_matching_text(user.industry_category, data.capabilities, data.service_areas)
            )
            user.onboarding_completed = True
            if user.verification_status == "unverified":
                user.verification_status = "pending"

            repo.update_user(session, user)

    # ---------- document upload + validation ----------

    def suggest_description(self, data) -> DescriptionSuggestionOut:
        description = profile_assistant_service.suggest_description(
            data.business_type, data.industry_category, data.capabilities,
            data.service_areas, data.city, data.province,
        )
        return DescriptionSuggestionOut(description=description)

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
        id_number = document_extraction_service.extract_id_number(
            doc_type, contents, file.content_type or ""
        )
        return DocumentExtractionOut(id_number=id_number)

    async def upload_document(
        self,
        user_id: int,
        doc_type: str,
        declared_owner_name: str,
        declared_business_name: str,
        declared_id_number: str,
        declared_expiry_date: date | None,
        file: UploadFile,
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

            saved_path = await self._save_file(user_id, doc_type, file)

            document = BusinessDocument(
                user_id=user_id,
                doc_type=doc_type,
                file_path=saved_path,
                declared_owner_name=declared_owner_name.strip(),
                declared_business_name=declared_business_name.strip(),
                declared_id_number=declared_id_number.strip(),
                declared_expiry_date=declared_expiry_date,
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

    async def _save_file(self, user_id: int, doc_type: str, file: UploadFile) -> str:
        user_dir = os.path.join(UPLOAD_ROOT, str(user_id))
        os.makedirs(user_dir, exist_ok=True)

        ext = os.path.splitext(file.filename or "")[1] or ".bin"
        filename = f"{doc_type}_{uuid.uuid4().hex}{ext}"
        full_path = os.path.join(user_dir, filename)

        contents = await file.read()
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

    def admin_review(self, user_id: int, approve: bool, notes: str | None) -> None:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

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
                signup_intent=user.signup_intent,
                business_description=user.business_description,
            )

    def get_public_profile(self, business_id: int) -> PublicBusinessProfileOut:
        from app.repositories import requirement_repository as req_repo

        with Session(engine) as session:
            user = session.get(User, business_id)
            if not user:
                raise HTTPException(status_code=404, detail="Business not found")
            return PublicBusinessProfileOut(
                id=user.id,
                registered_name=user.registered_name or user.business_name,
                display_name=user.display_name,
                business_type=user.business_type,
                industry_category=user.industry_category,
                city=user.city,
                province=user.province,
                business_description=user.business_description,
                capabilities=[c for c in (user.capabilities or "").split(",") if c],
                service_areas=[a for a in (user.service_areas or "").split(",") if a],
                is_verified=user.is_verified,
                tier=user.tier,
                verification_date=user.verification_date,
                member_since_year=user.created_at.year,
                requirements_posted_count=req_repo.count_requirements_by_owner(session, user.id),
                requirements_awarded_count=req_repo.count_awarded_quotations_for_business(session, user.id),
            )

    def list_flagged(self, session: Session) -> List[AdminFlaggedBusinessOut]:
        users = repo.list_flagged_users(session)
        out = []
        for user in users:
            documents = repo.list_documents_for_user(session, user.id)
            out.append(AdminFlaggedBusinessOut(
                user_id=user.id,
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
            return [
                AdminBusinessOut(
                    user_id=user.id,
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
        from datetime import timedelta
        from app.repositories import requirement_repository as req_repo
        from app.schemas.business import RegistrationsByDay

        with Session(engine) as session:
            since = now_ph() - timedelta(days=7)
            by_day = repo.registrations_by_day(session, since)

            return AdminStatsOut(
                total_businesses=repo.count_all_users(session),
                verified_businesses=repo.count_verified_users(session),
                pending_review_count=len(repo.list_flagged_users(session)),
                total_requirements=req_repo.count_all_requirements(session),
                open_requirements=req_repo.count_open_requirements(session),
                total_quotations=req_repo.count_all_quotations(session),
                registrations_last_7_days=[RegistrationsByDay(date=d, count=c) for d, c in by_day],
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
            len([c for c in (user.capabilities or "").split(",") if c]) >= 3,
            len([a for a in (user.service_areas or "").split(",") if a]) >= 1,
            bool(doc_types & REQUIRED_ONE_OF_TIER_1),
            "BIR" in doc_types,
            "MAYORS_PERMIT" in doc_types,
        ]
        return round(100 * sum(checklist) / len(checklist))

    def _tier_hint(self, session: Session, user: User, doc_types: set) -> str:
        if user.tier >= 3:
            return "You've reached the highest trust tier."
        if user.tier == 1:
            return "Add your Mayor's permit to work toward Tier 3."

        from app.repositories import requirement_repository as req_repo
        awarded = req_repo.count_awarded_quotations_for_business(session, user.id)
        remaining = max(0, TIER_3_AWARD_THRESHOLD - awarded)
        if remaining == 0:
            return "You qualify for Tier 3 — it will apply on your next award."
        return f"Reach Tier 3 by completing {remaining} more awarded requirement{'s' if remaining != 1 else ''}."


business_service = BusinessService()