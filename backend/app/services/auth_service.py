from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlmodel import Session

from app.core.config import settings
from app.core.database import engine
from app.core.security import get_password_hash, verify_password, create_access_token
from app.repositories.user_repository import get_user_by_mobile, create_user, get_user
from app.models.user import User
from app.schemas.auth import UserCreate, Token, PasswordChange, MobileNumberChange, NotificationPreferences


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