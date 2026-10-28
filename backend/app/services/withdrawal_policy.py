"""Withdrawn sealed quotations — protects sealed bidding from price fishing.

Every withdrawal counts, the moment it happens, even when the supplier
resubmits before closing: withdrawing is how a supplier could probe and
re-price, so each one needs a reason and is on the record. Counted over the
last 90 days:

1st: a formal warning on the account.
2nd: the account is flagged "subject for suspension" — an automatic report in
     the admin Reports queue with Suspend 7 days pre-selected.
3rd and on: flagged "subject for ban" — the same report, now with Ban
     pre-selected.

An administrator always makes the decision; nothing is suspended or banned
automatically. Every strike sends the supplier an alert and an email, whatever
their notification settings. The reason, details and proof are seen only by
administrators — never by the buyer.
"""
import os
import uuid
from datetime import timedelta
from typing import List, Optional

from sqlmodel import Session, func, select

from app.core import file_crypto
from app.core.clock import now_ph
from app.core.file_validation import validate_upload
from app.models.business_report import BusinessReport
from app.models.requirement import Requirement
from app.models.user import User
from app.models.withdrawal_strike import WithdrawalStrike
from app.repositories import notification_repository as notif_repo

WINDOW_DAYS = 90
AUTO_REPORT_PREFIX = "Automatic:"
REPORT_REASON = "WITHDRAWALS"

# Suggested reasons, so a supplier doesn't have to think one up. "Other" needs
# a short explanation; the rest take an optional one.
REASONS = {
    "pricing_error": "Pricing or computation error",
    "cost_changed": "Supplier or material cost changed",
    "stock_unavailable": "Stock or material no longer available",
    "cannot_meet": "Can't meet the quantity or timeline",
    "wrong_details": "Wrong details or attachment submitted",
    "other": "Other",
}
LEGACY_REASON_LABEL = "Not given (before reasons were required)"
DETAILS_MAX = 500
OTHER_DETAILS_MIN = 10
PROOF_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
PROOF_MAX_BYTES = 10 * 1024 * 1024

CONSEQUENCES = {
    1: ("warning", "You'll receive a formal warning on your account."),
    2: ("suspension", "Your account will be flagged as subject for suspension. An administrator reviews it and decides."),
    3: ("ban", "Your account will be flagged as subject for a ban. An administrator reviews it and decides."),
}
RECOMMENDED = {2: "suspend_7", 3: "ban"}


class InvalidWithdrawalReason(ValueError):
    pass


def reason_label(code: str) -> str:
    return REASONS.get(code, LEGACY_REASON_LABEL)


def _recent(session: Session, user_id: int) -> int:
    since = now_ph() - timedelta(days=WINDOW_DAYS)
    return session.exec(select(func.count()).select_from(WithdrawalStrike).where(
        WithdrawalStrike.user_id == user_id, WithdrawalStrike.created_at >= since)).one()


def recent_strikes(session: Session, user_id: int) -> List[WithdrawalStrike]:
    since = now_ph() - timedelta(days=WINDOW_DAYS)
    return list(session.exec(select(WithdrawalStrike).where(
        WithdrawalStrike.user_id == user_id, WithdrawalStrike.created_at >= since,
    ).order_by(WithdrawalStrike.created_at.desc())).all())


def preview(session: Session, user_id: int) -> dict:
    """What withdrawing one more quotation would do — shown before confirming."""
    so_far = _recent(session, user_id)
    kind, text = CONSEQUENCES[min(so_far + 1, 3)]
    return {"withdrawals_so_far": so_far, "next_number": so_far + 1, "next": kind, "message": text,
            "window_days": WINDOW_DAYS,
            "reasons": [{"code": c, "label": l} for c, l in REASONS.items()]}


def check_reason(reason_code: str, reason_details: Optional[str]) -> Optional[str]:
    """The cleaned details, or InvalidWithdrawalReason with the message to show."""
    if reason_code not in REASONS:
        raise InvalidWithdrawalReason("Pick a reason for withdrawing.")
    details = (reason_details or "").strip() or None
    if details and len(details) > DETAILS_MAX:
        raise InvalidWithdrawalReason(f"Keep the explanation under {DETAILS_MAX} characters.")
    if reason_code == "other" and len(details or "") < OTHER_DETAILS_MIN:
        raise InvalidWithdrawalReason(f"Explain the reason in at least {OTHER_DETAILS_MIN} characters.")
    return details


def save_proof(user_id: int, filename: Optional[str], contents: bytes) -> str:
    """Validates and stores an optional proof file, encrypted. Returns its path."""
    ext = validate_upload(filename, contents, PROOF_EXTENSIONS, PROOF_MAX_BYTES)
    folder = os.path.join("uploads", "withdrawals", str(user_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4().hex}{ext}")
    with open(path, "wb") as f:
        f.write(file_crypto.encrypt_bytes(contents))
    return path


def _system_admin_id(session: Session, fallback: int) -> int:
    admin = session.exec(select(User).where(User.is_admin == True).order_by(User.id)).first()  # noqa: E712
    return admin.id if admin else fallback


def record(session: Session, req: Requirement, quotation_id: int, user_id: int, reason_code: str,
           reason_details: Optional[str], proof_path: Optional[str] = None,
           proof_filename: Optional[str] = None) -> int:
    """A strike for this withdrawal, then its consequence. Returns the count
    within the window, this one included."""
    from app.services.moderation_service import moderation_service  # local: avoids an import cycle

    session.add(WithdrawalStrike(
        user_id=user_id, requirement_id=req.id, quotation_id=quotation_id, reason_code=reason_code,
        reason_details=reason_details, proof_path=proof_path, proof_filename=proof_filename,
    ))
    session.commit()
    n = _recent(session, user_id)
    where = f"{req.ref_code} · {req.title}"
    why = reason_label(reason_code)
    admin_id = _system_admin_id(session, user_id)

    if n == 1:
        moderation_service.apply(
            session, admin_id, user_id, "warn",
            f"{AUTO_REPORT_PREFIX} you withdrew your sealed quotation on {where} (reason: {why}). "
            f"A second withdrawal within {WINDOW_DAYS} days flags your account as subject for suspension.",
            always_notify=True,
        )
        return n

    stage = "suspension" if n == 2 else "ban"
    recommended = RECOMMENDED[min(n, 3)]
    details = (f"{AUTO_REPORT_PREFIX} {n} quotations withdrawn within {WINDOW_DAYS} days "
               f"(latest: {req.ref_code}, reason: {why}). Subject for {stage} — review the withdrawals "
               "and decide: dismiss, warn, suspend or ban.")
    report = session.exec(select(BusinessReport).where(
        BusinessReport.reported_id == user_id, BusinessReport.status == "open",
        BusinessReport.reason == REPORT_REASON)).first()
    if report:
        # One open review per account — it just moves up a stage.
        report.details = details
        report.recommended_action = recommended
        report.related_requirement_id = req.id
    else:
        report = BusinessReport(reporter_id=admin_id, reported_id=user_id, reason=REPORT_REASON, details=details,
                                related_requirement_id=req.id, recommended_action=recommended)
    session.add(report)
    session.commit()
    notif_repo.create_if_allowed(
        session, user_id=user_id, type_="VERIFICATION", category="activity",
        title=f"Your account is subject for {stage}",
        detail=(f"You withdrew your sealed quotation on {where} (reason: {why}) — {n} withdrawals within "
                f"{WINDOW_DAYS} days. An administrator will review your account and decide."),
        urgent=True, related_requirement_id=req.id, always=True,
    )
    return n
