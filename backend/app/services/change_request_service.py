"""Locked business details and "Request a change".

Once onboarding is done, the identity and contact fields below can't be
edited directly (business_service.submit_onboarding keeps them) — a verified
business could otherwise swap its name or contact after earning trust. The
business asks an administrator instead: one pending request per account,
with a reason, reviewed in 1–3 business days. Approving applies the values;
rejecting needs a note and changes nothing.
"""
import json
from typing import Dict, List

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.categories import CATEGORIES
from app.core.clock import now_ph
from app.core.database import engine
from app.models.profile_change_request import ProfileChangeRequest
from app.models.user import User
from app.repositories import notification_repository as notif_repo
from app.schemas.business import AdminChangeRequestOut, ChangeRequestIn, ChangeRequestOut, ChangeRequestReview
from app.services import matching_service

# field -> (label, min length, max length); same limits as OnboardingSubmit.
LOCKED_FIELDS: Dict[str, tuple] = {
    "registered_name": ("Registered business name", 2, 200),
    "display_name": ("Display name", 0, 200),
    "business_type": ("Business type", 2, 100),
    "industry_category": ("Business category", 2, 100),
    "city": ("City", 2, 100),
    "province": ("Province", 2, 100),
    "contact_person": ("Contact person", 2, 120),
    "contact_mobile": ("Contact mobile", 7, 20),
}
REVIEW_NOTE = "An administrator reviews it in 1–3 business days."


def _err(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _validate(user: User, changes: Dict[str, str]) -> Dict[str, dict]:
    if not changes:
        raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick at least one detail to change.")
    out: Dict[str, dict] = {}
    for field, raw in changes.items():
        if field not in LOCKED_FIELDS:
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, f"\"{field}\" can't be changed this way.")
        label, lo, hi = LOCKED_FIELDS[field]
        value = (raw or "").strip()
        if not (lo <= len(value) <= hi):
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{label} must be {lo}–{hi} characters.")
        if field == "industry_category" and value not in CATEGORIES:
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Business category must be one of: {', '.join(CATEGORIES)}")
        if field == "contact_mobile" and not all(ch.isdigit() or ch in "+ -()" for ch in value):
            raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "Contact mobile can only have digits, spaces and + - ( ).")
        current = getattr(user, field) or ""
        if value == current:
            continue
        out[field] = {"from": current, "to": value}
    if not out:
        raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "That's the same as what's on file — nothing to change.")
    return out


def _out(r: ProfileChangeRequest) -> ChangeRequestOut:
    return ChangeRequestOut(
        id=r.id, status=r.status, changes=json.loads(r.changes_json), reason=r.reason,
        admin_notes=r.admin_notes, created_at=r.created_at, reviewed_at=r.reviewed_at,
    )


class ChangeRequestService:
    def create(self, user_id: int, data: ChangeRequestIn) -> ChangeRequestOut:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user or not user.onboarding_completed:
                raise _err(status.HTTP_409_CONFLICT, "Finish onboarding first — until then you can edit these details directly.")
            pending = session.exec(select(ProfileChangeRequest).where(
                ProfileChangeRequest.user_id == user_id, ProfileChangeRequest.status == "pending")).first()
            if pending:
                raise _err(status.HTTP_409_CONFLICT, "You already have a change request under review. " + REVIEW_NOTE)
            reason = data.reason.strip()
            if len(reason) < 10:
                raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tell the administrator why (at least 10 characters).")
            changes = _validate(user, data.changes)
            row = ProfileChangeRequest(user_id=user_id, changes_json=json.dumps(changes), reason=reason[:500])
            session.add(row)
            session.commit()
            session.refresh(row)
            notif_repo.create_if_allowed(
                session, user_id=user_id, type_="VERIFICATION", category="activity",
                title="Change request received",
                detail=f"{', '.join(LOCKED_FIELDS[f][0] for f in changes)}. {REVIEW_NOTE}",
            )
            return _out(row)

    def mine(self, user_id: int) -> List[ChangeRequestOut]:
        with Session(engine) as session:
            rows = session.exec(select(ProfileChangeRequest).where(ProfileChangeRequest.user_id == user_id)
                                .order_by(ProfileChangeRequest.id.desc())).all()
            return [_out(r) for r in rows]

    def list_for_admin(self) -> List[AdminChangeRequestOut]:
        with Session(engine) as session:
            rows = session.exec(select(ProfileChangeRequest).order_by(ProfileChangeRequest.id.desc())).all()
            # Pending first, then the most recent decisions.
            rows = sorted(rows, key=lambda r: r.status != "pending")
            out = []
            for r in rows:
                user = session.get(User, r.user_id)
                base = _out(r)
                out.append(AdminChangeRequestOut(
                    **base.model_dump(), user_id=r.user_id,
                    business_name=(user.registered_name or user.business_name) if user else "—",
                    verification_status=user.verification_status if user else "",
                ))
            return out

    def review(self, request_id: int, admin_id: int, data: ChangeRequestReview) -> None:
        with Session(engine) as session:
            row = session.get(ProfileChangeRequest, request_id)
            if not row:
                raise _err(status.HTTP_404_NOT_FOUND, "Change request not found")
            if row.status != "pending":
                raise _err(status.HTTP_409_CONFLICT, "This request was already reviewed")
            notes = (data.notes or "").strip()
            if not data.approve and len(notes) < 5:
                raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say why it's rejected — the business sees this note.")
            user = session.get(User, row.user_id)
            changes = json.loads(row.changes_json)
            if data.approve and user:
                for field, change in changes.items():
                    value = change["to"]
                    setattr(user, field, (value or None) if field == "display_name" else value)
                if "industry_category" in changes:
                    # Offered items belong to a category; the seller picks them again.
                    user.offered_items = None
                    user.capability_embedding = matching_service.embed_to_json(matching_service.business_matching_text(
                        user.industry_category,
                        [c for c in (user.capabilities or "").split(",") if c],
                        [a for a in (user.service_areas or "").split(",") if a],
                    ))
                session.add(user)
            row.status = "approved" if data.approve else "rejected"
            row.admin_id = admin_id
            row.admin_notes = notes[:500] or None
            row.reviewed_at = now_ph()
            session.add(row)
            session.commit()
            labels = ", ".join(LOCKED_FIELDS[f][0] for f in changes if f in LOCKED_FIELDS)
            from app.services import admin_audit
            admin_audit.record(session, admin_id, "change_request_approved" if data.approve else "change_request_rejected",
                               target_user_id=row.user_id, details=f"Request #{row.id}: {labels}"
                               + (f". Notes: {notes}" if notes else ""))
            if data.approve:
                detail = f"Updated: {labels}."
                if "industry_category" in changes:
                    detail += " Pick the items you offer again in Business details."
            else:
                detail = f"Not changed: {labels}. {notes}"
            notif_repo.create_if_allowed(
                session, user_id=row.user_id, type_="VERIFICATION", category="activity",
                title="Change request approved" if data.approve else "Change request rejected",
                detail=detail, urgent=not data.approve,
            )


change_request_service = ChangeRequestService()
