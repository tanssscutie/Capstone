"""Admin team (super admins only): list administrators, create one, change
a role, disable or re-enable, and reset a password.

Never leaves the platform without an active super admin: the last one can't
be demoted or disabled. Nobody disables their own account here.
"""
import secrets
from typing import List, Optional

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.database import engine
from app.core.security import get_password_hash
from app.models.user import User
from app.services import admin_accounts, admin_audit


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _out(u: User) -> dict:
    return {"id": u.id, "name": u.business_name, "email": u.email, "mobile_number": u.mobile_number,
            "admin_role": u.admin_role or "admin", "is_active": u.is_active, "created_at": u.created_at,
            "password_changed_at": u.password_changed_at}


class AdminTeamService:
    def _admin(self, session: Session, user_id: int) -> User:
        u = session.get(User, user_id)
        if not u or not u.is_admin:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Administrator not found")
        return u

    @staticmethod
    def _other_active_supers(session: Session, user_id: int) -> int:
        return len(session.exec(select(User.id).where(
            User.is_admin == True, User.admin_role == "super_admin", User.is_active == True,  # noqa: E712
            User.id != user_id)).all())

    def list(self) -> List[dict]:
        with Session(engine) as session:
            admins = session.exec(select(User).where(User.is_admin == True).order_by(User.created_at, User.id)).all()  # noqa: E712
            return [_out(u) for u in admins]

    def create(self, actor_id: int, name: str, email: str, password: str, role: str, mobile: Optional[str]) -> dict:
        with Session(engine) as session:
            u = admin_accounts.create_admin(session, name, email, password, role, mobile)
            self._audit(session, actor_id, "admin_created", u, f"{u.business_name} <{u.email}> as {u.admin_role}")
            return _out(u)

    def set_role(self, actor_id: int, user_id: int, role: str) -> dict:
        with Session(engine) as session:
            u = self._admin(session, user_id)
            if role not in admin_accounts.ROLES:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Role must be admin or super_admin")
            if u.admin_role == "super_admin" and role != "super_admin" and not self._other_active_supers(session, u.id):
                raise _conflict("This is the last active super admin — make someone else a super admin first")
            before = u.admin_role
            admin_accounts.promote(session, u, role)
            self._audit(session, actor_id, "admin_role_changed", u, f"{before} → {role}")
            return _out(u)

    def set_active(self, actor_id: int, user_id: int, active: bool) -> dict:
        with Session(engine) as session:
            u = self._admin(session, user_id)
            if not active:
                if u.id == actor_id:
                    raise _conflict("You can't disable your own account")
                if u.admin_role == "super_admin" and not self._other_active_supers(session, u.id):
                    raise _conflict("This is the last active super admin — it can't be disabled")
            u.is_active = active
            session.add(u)
            session.commit()
            session.refresh(u)
            self._audit(session, actor_id, "admin_enabled" if active else "admin_disabled", u, None)
            return _out(u)

    def reset_password(self, actor_id: int, user_id: int) -> dict:
        """A new temporary password, shown once to the super admin to hand over."""
        with Session(engine) as session:
            u = self._admin(session, user_id)
            temporary = secrets.token_urlsafe(9)
            u.hashed_password = get_password_hash(temporary)
            u.password_changed_at = now_ph()
            session.add(u)
            session.commit()
            self._audit(session, actor_id, "admin_password_reset", u, None)
            return {"id": u.id, "temporary_password": temporary}

    @staticmethod
    def _audit(session: Session, actor_id: int, action: str, target: User, details: Optional[str]) -> None:
        admin_audit.record(session, actor_id, action, target_user_id=target.id,
                           details=details or f"{target.business_name} <{target.email}>")


admin_team_service = AdminTeamService()
