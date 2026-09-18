from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.config import settings
from app.core.database import engine
from app.core.security import get_password_hash, verify_password, create_access_token
from app.repositories.user_repository import get_user_by_mobile, create_user, get_user
from app.models.user import User
from app.schemas.auth import UserCreate, Token, PasswordChange, MobileNumberChange, NotificationPreferences

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


class GoogleAuthError(Exception):
    """Google's own token/userinfo exchange failed — never our own bug, so
    the route redirects back to login with a message instead of a 500."""


class AuthService:
    def __init__(self):
        pass

    def create_user(self, user_in: UserCreate):
        with Session(engine) as session:
            existing = get_user_by_mobile(session, user_in.mobile_number)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account with this mobile number already exists",
                )
            user = User(
                business_name=user_in.business_name,
                mobile_number=user_in.mobile_number,
                hashed_password=get_password_hash(user_in.password),
            )
            return create_user(session, user)

    def authenticate_user_and_get_token(self, mobile_number: str, password: str) -> Optional[Token]:
        with Session(engine) as session:
            user = get_user_by_mobile(session, mobile_number)
            if not user:
                return None
            if not verify_password(password, user.hashed_password):
                return None
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            token = create_access_token({"sub": str(user.id)}, expires_delta=access_token_expires)
            return Token(access_token=token)

    def build_google_auth_url(self) -> str:
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "online",
            "prompt": "select_account",
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    async def handle_google_callback(self, code: str) -> tuple[Token, bool]:
        """Exchanges the authorization code for Google's tokens, reads the
        profile off them, and finds-or-creates the matching User. Returns our
        own JWT plus whether this account still needs a mobile number (true
        for a brand-new Google sign-up, false for a returning one)."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_resp = await client.post(GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            })
            if token_resp.status_code != 200:
                raise GoogleAuthError("Could not exchange the authorization code with Google")
            google_access_token = token_resp.json().get("access_token")

            userinfo_resp = await client.get(
                GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {google_access_token}"}
            )
            if userinfo_resp.status_code != 200:
                raise GoogleAuthError("Could not fetch your Google profile")
            info = userinfo_resp.json()

        google_id = info.get("sub")
        if not google_id:
            raise GoogleAuthError("Google did not return an account id")
        email = info.get("email")
        name = info.get("name") or email or "Google Business"

        with Session(engine) as session:
            user = session.exec(select(User).where(User.google_id == google_id)).first()
            if not user:
                user = User(business_name=name, google_id=google_id, email=email)
                session.add(user)
                session.commit()
                session.refresh(user)

            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            jwt_token = create_access_token({"sub": str(user.id)}, expires_delta=access_token_expires)
            return Token(access_token=jwt_token), user.mobile_number is None

    def complete_profile(self, user_id: int, mobile_number: str) -> User:
        """One-time mobile number for a Google sign-up. Refuses once a number
        is already on file — that's PUT /auth/mobile-number's job instead,
        which re-verifies the account's password (this endpoint never asks
        for one, since a Google-only account doesn't have one)."""
        with Session(engine) as session:
            user = get_user(session, user_id)
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
            if user.mobile_number:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Mobile number is already set. Use Account Settings to change it.",
                )
            existing = get_user_by_mobile(session, mobile_number)
            if existing and existing.id != user_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this mobile number already exists")
            user.mobile_number = mobile_number
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    def change_password(self, user_id: int, data: PasswordChange) -> None:
        with Session(engine) as session:
            user = get_user(session, user_id)
            if not user or not verify_password(data.current_password, user.hashed_password):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
            user.hashed_password = get_password_hash(data.new_password)
            session.add(user)
            session.commit()

    def change_mobile_number(self, user_id: int, data: MobileNumberChange) -> User:
        with Session(engine) as session:
            user = get_user(session, user_id)
            if not user or not verify_password(data.current_password, user.hashed_password):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
            existing = get_user_by_mobile(session, data.new_mobile_number)
            if existing and existing.id != user_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this mobile number already exists")
            user.mobile_number = data.new_mobile_number
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    def update_notification_preferences(self, user_id: int, data: NotificationPreferences) -> User:
        with Session(engine) as session:
            user = get_user(session, user_id)
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
            user.notify_messages = data.notify_messages
            user.notify_activity = data.notify_activity
            session.add(user)
            session.commit()
            session.refresh(user)
            return user


auth_service = AuthService()