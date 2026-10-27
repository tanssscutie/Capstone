"""Account moderation by administrators: warn, suspend, ban, lift.

Enforcement lives in app/core/account_access.py — a suspension or ban takes
effect on the user's very next request. Every action is recorded as a
ModerationAction and the user is told by alert (and email) what happened and
why; they are never told who reported them.

A ban also winds down what the account had in flight, so nobody keeps
waiting on it: its open requirements are cancelled (their sealed quotations
voided unopened, respondents alerted) and its sealed quotations withdrawn.
"""
from datetime import timedelta
from typing import List, Optional

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.database import engine
from app.models.moderation_action import ModerationAction
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import notification_repository as notif_repo
from app.schemas.business import ModerationActionOut

SUSPEND_DAYS = {"suspend_7": 7, "suspend_30": 30}


def history(session: Session, user_id: int) -> List[ModerationActionOut]:
    rows = session.exec(
        select(ModerationAction).where(ModerationAction.user_id == user_id).order_by(ModerationAction.created_at.desc())
    ).all()
    return [ModerationActionOut(action=r.action, reason=r.reason, until=r.until, created_at=r.created_at) for r in rows]


class ModerationService:
    def apply(self, session: Session, admin_id: int, user_id: int, action: str, reason: str,
              report_id: Optional[int] = None) -> None:
        """action: warn | suspend_7 | suspend_30 | ban | lift. Commits."""
        user = session.get(User, user_id)
        if not user or user.is_admin:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")
        reason = reason.strip()
        until = None

        if action == "warn":
            title, detail = "Warning from TrustLink", f"An administrator reviewed activity on your account: {reason}"
        elif action in SUSPEND_DAYS:
            until = now_ph() + timedelta(days=SUSPEND_DAYS[action])
            user.suspended_until = until
            when = until.strftime("%b %d, %Y").replace(" 0", " ")
            title, detail = "Your account is suspended", f"Suspended until {when}. Reason: {reason}"
        elif action == "ban":
            user.banned_at = now_ph()
            user.is_active = False
            title, detail = "Your account has been banned", f"Reason: {reason}"
        elif action == "lift":
            if not (user.suspended_until or user.banned_at or not user.is_active):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This account isn't suspended or banned")
            user.suspended_until = None
            user.banned_at = None
            user.is_active = True
            title, detail = "Your account is active again", f"An administrator lifted the restriction. {reason}"
        else:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown action")

        session.add(user)
        session.add(ModerationAction(user_id=user_id, admin_id=admin_id, report_id=report_id,
                                     action="suspend" if action in SUSPEND_DAYS else action, reason=reason, until=until))
        session.commit()

        # Emailed too (VERIFICATION is in EMAIL_ALERT_TYPES) — a banned or
        # suspended user can't open the app to read an in-app alert.
        notif_repo.create_if_allowed(session, user_id=user_id, type_="VERIFICATION", category="activity",
                                     title=title, detail=detail, urgent=action != "lift")
        if action == "ban":
            self._wind_down(user_id)

    @staticmethod
    def _wind_down(user_id: int) -> None:
        from app.services.requirement_service import requirement_service  # local: avoids an import cycle

        with Session(engine) as session:
            open_reqs = session.exec(select(Requirement).where(
                Requirement.owner_id == user_id, Requirement.status == "open")).all()
            sealed = session.exec(select(Quotation).where(
                Quotation.business_id == user_id, Quotation.status == "sealed")).all()
            req_ids = [r.id for r in open_reqs]
            for q in sealed:
                requirement_service._withdraw_row(session, q, user_id)
        for rid in req_ids:
            requirement_service.cancel(rid, user_id)

    def lift(self, admin_id: int, user_id: int, reason: str) -> None:
        with Session(engine) as session:
            self.apply(session, admin_id, user_id, "lift", reason or "Restriction lifted.")


moderation_service = ModerationService()
