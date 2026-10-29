"""Creating and promoting administrator accounts — used by
scripts/create_admin.py and the super admin's Admin team page."""
from typing import Optional

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.privacy import PRIVACY_POLICY_VERSION
from app.core.security import get_password_hash
from app.models.user import User

ROLES = ("admin", "super_admin")
MIN_PASSWORD = 8


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def create_admin(session: Session, name: str, email: str, password: str, role: str = "admin",
                 mobile: Optional[str] = None) -> User:
    """A new administrator account. No business role, no onboarding; consent to
    the Privacy Notice is recorded now, since the account is created for them."""
    name, email = (name or "").strip(), (email or "").strip().lower()
    if role not in ROLES:
        raise _bad("Role must be admin or super_admin")
    if len(name) < 2:
        raise _bad("Give the administrator a name")
    if "@" not in email:
        raise _bad("Enter a valid email address")
    if len(password or "") < MIN_PASSWORD:
        raise _bad(f"The password needs at least {MIN_PASSWORD} characters")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with that email already exists")
    if mobile and session.exec(select(User).where(User.mobile_number == mobile)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with that mobile number already exists")
    user = User(business_name=name, email=email, mobile_number=mobile or None, hashed_password=get_password_hash(password),
                is_admin=True, admin_role=role, privacy_consent_at=now_ph(),
                privacy_policy_version=PRIVACY_POLICY_VERSION, password_changed_at=now_ph())
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def promote(session: Session, user: User, role: str) -> User:
    """Makes an existing account an administrator with this role. A business
    account can't be turned into an admin — admins are separate accounts."""
    if role not in ROLES:
        raise _bad("Role must be admin or super_admin")
    if not user.is_admin and user.role in ("buyer", "seller"):
        raise _bad("That is a business account — create a separate admin account instead")
    user.is_admin = True
    user.admin_role = role
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
