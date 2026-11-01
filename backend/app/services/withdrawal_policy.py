"""Withdrawn quotations that weren't replaced.

Withdrawing and resubmitting before closing is how a supplier fixes a mistake
in a sealed quotation, so that never counts. What counts is a withdrawal with
nothing in its place when the requirement closes (released or archived) —
the supplier backed out. Those are recorded at closing (record_closing) and
counted over the last 90 days:

1st: recorded (shows on the profile's Track record), with an alert.
2nd: a formal warning on the account (moderation history, alert + email).
3rd and on: a report in the admin Reports queue; an administrator reviews the
     account and decides — dismiss, warn, suspend or ban. Nothing is
     suspended or banned automatically.
"""
from datetime import timedelta
from typing import Iterable

from sqlmodel import Session, func, select

from app.core.clock import now_ph
from app.models.business_report import BusinessReport
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.models.withdrawal_strike import WithdrawalStrike
from app.repositories import notification_repository as notif_repo

WINDOW_DAYS = 90
AUTO_REPORT_PREFIX = "Automatic:"

CONSEQUENCES = {
    1: ("recorded", "It's recorded on your profile's Track record."),
    2: ("warning", "You'll receive a formal warning on your account."),
    3: ("review", "Your account will be sent to an administrator for review — they decide whether to warn, suspend or ban."),
}


def _recent(session: Session, user_id: int) -> int:
    since = now_ph() - timedelta(days=WINDOW_DAYS)
    return session.exec(select(func.count()).select_from(WithdrawalStrike).where(
        WithdrawalStrike.user_id == user_id, WithdrawalStrike.created_at >= since)).one()


def preview(session: Session, user_id: int) -> dict:
    """What withdrawing (and not resubmitting) one more quotation would do."""
    so_far = _recent(session, user_id)
    kind, text = CONSEQUENCES[min(so_far + 1, 3)]
    return {"withdrawals_so_far": so_far, "next_number": so_far + 1, "next": kind, "message": text,
            "window_days": WINDOW_DAYS}


def _system_admin_id(session: Session, fallback: int) -> int:
    admin = session.exec(select(User).where(User.is_admin == True).order_by(User.id)).first()  # noqa: E712
    return admin.id if admin else fallback


def record_closing(session: Session, req: Requirement, active_business_ids: Iterable[int]) -> int:
    """At closing: a strike for every supplier with a withdrawn quotation here
    and no active one in its place. Returns how many were recorded."""
    from app.services.moderation_service import moderation_service  # local: avoids an import cycle

    active = set(active_business_ids)
    withdrawn = session.exec(select(Quotation.business_id).where(
        Quotation.requirement_id == req.id, Quotation.status == "withdrawn")).all()
    recorded = 0
    for user_id in sorted(set(withdrawn) - active):
        user = session.get(User, user_id)
        if not user or user.banned_at:  # a ban's own wind-down withdrew it
            continue
        if session.exec(select(WithdrawalStrike).where(
                WithdrawalStrike.user_id == user_id, WithdrawalStrike.requirement_id == req.id)).first():
            continue
        session.add(WithdrawalStrike(user_id=user_id, requirement_id=req.id))
        session.commit()
        recorded += 1
        n = _recent(session, user_id)
        where = f"{req.ref_code} · {req.title}"

        if n == 1:
            notif_repo.create_if_allowed(
                session, user_id=user_id, type_="VERIFICATION", category="activity",
                title="Withdrawn quotation recorded",
                detail=(f"{where} closed without a quotation from you after you withdrew. It's on your Track record. "
                        f"A second within {WINDOW_DAYS} days brings a formal warning."),
                related_requirement_id=req.id,
            )
        elif n == 2:
            moderation_service.apply(
                session, _system_admin_id(session, user_id), user_id, "warn",
                f"{AUTO_REPORT_PREFIX} 2 quotations withdrawn and not replaced within {WINDOW_DAYS} days "
                f"(latest: {req.ref_code}). A third sends your account to an administrator for review.",
            )
        else:
            already_open = session.exec(select(BusinessReport).where(
                BusinessReport.reported_id == user_id, BusinessReport.status == "open",
                BusinessReport.details.startswith(AUTO_REPORT_PREFIX))).first()
            if not already_open:
                session.add(BusinessReport(
                    reporter_id=_system_admin_id(session, user_id), reported_id=user_id, reason="OTHER",
                    details=(f"{AUTO_REPORT_PREFIX} {n} quotations withdrawn and not replaced within {WINDOW_DAYS} days "
                             f"(latest: {req.ref_code}). Review the account and decide: dismiss, warn, suspend or ban."),
                    related_requirement_id=req.id,
                ))
                session.commit()
            notif_repo.create_if_allowed(
                session, user_id=user_id, type_="VERIFICATION", category="activity",
                title="Your account is under review",
                detail=(f"{n} quotations withdrawn and not replaced within {WINDOW_DAYS} days. "
                        "An administrator will review your account."),
                urgent=True, related_requirement_id=req.id,
            )
    return recorded
