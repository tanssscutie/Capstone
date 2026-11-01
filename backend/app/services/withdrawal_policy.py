"""Strikes for withdrawing a sealed quotation (supplier-initiated only).

1st withdrawal: warning. 2nd: suspended for 7 days. 3rd: banned and referred
to an administrator for investigation (a report lands in the admin Reports
queue; the admin can lift the ban from the Businesses page).

Withdrawals the system makes — a ban winding down, a cancelled requirement —
don't count; only RequirementService.withdraw_quotation calls record().
Every sanction goes through moderation_service, so it's on the account's
moderation history and the supplier is alerted (and emailed).
"""
from typing import Optional

from sqlmodel import Session, select

from app.models.business_report import BusinessReport
from app.models.user import User

SUSPEND_ACTION = "suspend_7"
CONSEQUENCES = {
    1: ("warning", "Warning — recorded on your account."),
    2: ("suspension", "Your account will be suspended for 7 days."),
    3: ("ban", "Your account will be banned and referred to an administrator for investigation. "
               "Your other sealed quotations will be withdrawn."),
}


def next_consequence(withdrawals_so_far: int) -> dict:
    n = min(withdrawals_so_far + 1, 3)
    kind, text = CONSEQUENCES[n]
    return {"withdrawals_so_far": withdrawals_so_far, "next_number": withdrawals_so_far + 1, "next": kind, "message": text}


def _system_admin_id(session: Session, fallback: int) -> int:
    admin = session.exec(select(User).where(User.is_admin == True).order_by(User.id)).first()  # noqa: E712
    return admin.id if admin else fallback


def record(session: Session, user_id: int, requirement_id: Optional[int], ref_code: str) -> None:
    """Count one withdrawal and apply its sanction. Commits."""
    from app.services.moderation_service import moderation_service  # local: avoids an import cycle

    user = session.get(User, user_id)
    if not user:
        return
    user.withdrawal_count = (user.withdrawal_count or 0) + 1
    session.add(user)
    session.commit()
    n = user.withdrawal_count
    admin_id = _system_admin_id(session, user_id)
    where = f" on {ref_code}" if ref_code else ""

    if n == 1:
        moderation_service.apply(session, admin_id, user_id, "warn",
                                 f"Automatic: you withdrew a sealed quotation{where}. "
                                 "A second withdrawal suspends your account for 7 days; a third bans it.")
    elif n == 2:
        moderation_service.apply(session, admin_id, user_id, SUSPEND_ACTION,
                                 f"Automatic: second withdrawn quotation{where}. A third withdrawal bans your account.")
    else:
        report = BusinessReport(
            reporter_id=admin_id, reported_id=user_id, reason="MANIPULATION",
            details=f"Automatic: {n} sealed quotations withdrawn (latest{where}). "
                    "The account was banned pending investigation — lift it from Businesses if it was legitimate.",
            related_requirement_id=requirement_id,
        )
        session.add(report)
        session.commit()
        session.refresh(report)
        moderation_service.apply(session, admin_id, user_id, "ban",
                                 f"Automatic: {n} withdrawn quotations. An administrator will investigate.",
                                 report_id=report.id)
