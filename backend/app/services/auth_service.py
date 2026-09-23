import hashlib
import hmac
import logging
import secrets
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.config import settings
from app.core.database import engine
from app.core.security import get_password_hash, verify_password, create_access_token
from app.repositories.user_repository import get_user_by_mobile, get_user_by_email, create_user, get_user
from app.models.user import User
from app.models.email_verification import EmailVerification
from app.models.password_change_otp import PasswordChangeOtp
from app.schemas.auth import UserCreate, Token, PasswordChange, MobileNumberChange, NotificationPreferences
from app.services.email_service import (
    EmailSendError,
    send_otp_email,
    send_password_change_otp_email,
    send_password_reset_otp_email,
)

logger = logging.getLogger("trustlink.auth")

PASSWORD_OTP_PURPOSE = "password-change:"
# Deliberately distinct from PASSWORD_OTP_PURPOSE even though both flows share
# the same PasswordChangeOtp row per user — a code emailed for one flow must
# not verify in the other (e.g. a code sent while logged in for a change
# should not double as a reset code usable by anyone who intercepts it).
PASSWORD_RESET_OTP_PURPOSE = "password-reset:"

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
            email = user_in.email.strip().lower()
            if get_user_by_email(session, email):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account with this email already exists",
                )
            user = User(
                business_name=user_in.business_name,
                mobile_number=user_in.mobile_number,
                email=email,
                hashed_password=get_password_hash(user_in.password),
            )
            user = create_user(session, user)
            try:
                self._issue_otp(session, user)
            except EmailSendError:
                # The account exists either way; the verify screen's "Resend
                # code" retries, so a flaky SMTP server shouldn't 500 sign-up.
                pass
            return user

    @staticmethod
    def _hash_otp(user_id: int, code: str, purpose: str = "") -> str:
        # Keyed with SECRET_KEY and bound to the user id, so a leaked row
        # can't be brute-forced offline without the key (a bare hash of a
        # 6-digit code falls to a million guesses instantly). `purpose` keeps
        # a code minted for one flow (e.g. a password change) from validating
        # in another; the default is the sign-up flow's original format.
        return hmac.new(settings.SECRET_KEY.encode(), f"{purpose}{user_id}:{code}".encode(), hashlib.sha256).hexdigest()

    def _issue_otp(self, session: Session, user: User) -> None:
        """Creates or replaces the user's pending verification with a fresh
        6-digit code and emails it. Replacing resets the attempt counter, so
        a resend is also how a locked-out user gets back in."""
        code = f"{secrets.randbelow(10**6):06d}"
        now = now_ph()
        pending = session.get(EmailVerification, user.id)
        if pending is None:
            pending = EmailVerification(user_id=user.id, otp_hash="", expires_at=now)
        pending.otp_hash = self._hash_otp(user.id, code)
        pending.expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        pending.attempts = 0
        pending.last_sent_at = now
        session.add(pending)
        session.commit()
        send_otp_email(user.email, code)

    def verify_email(self, email: str, code: str) -> Token:
        """Checks the code and, on success, clears the pending row and logs
        the user in. Every "no such account / nothing pending" case reports
        the same message as a wrong code so this can't be used to probe
        which emails have accounts."""
        invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")
        with Session(engine) as session:
            user = get_user_by_email(session, email.strip().lower())
            pending = session.get(EmailVerification, user.id) if user else None
            if not user or not pending:
                raise invalid
            if pending.attempts >= settings.OTP_MAX_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many incorrect attempts. Request a new code.",
                )
            if pending.expires_at <= now_ph():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This code has expired. Request a new one.",
                )
            if not hmac.compare_digest(pending.otp_hash, self._hash_otp(user.id, code)):
                pending.attempts += 1
                session.add(pending)
                session.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect code")

            session.delete(pending)
            session.commit()
            expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            return Token(access_token=create_access_token({"sub": str(user.id)}, expires_delta=expires))

    def resend_otp(self, email: str) -> None:
        """Silent no-op for unknown emails and already-verified accounts, for
        the same anti-probing reason as verify_email."""
        with Session(engine) as session:
            user = get_user_by_email(session, email.strip().lower())
            pending = session.get(EmailVerification, user.id) if user else None
            if not user or not pending:
                return
            wait = (pending.last_sent_at + timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS) - now_ph()).total_seconds()
            if wait > 0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Please wait {int(wait) + 1} seconds before requesting another code.",
                )
            try:
                self._issue_otp(session, user)
            except EmailSendError:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="We couldn't send the email right now. Please try again shortly.",
                )

    def authenticate_user_and_get_token(self, identifier: str, password: str) -> Optional[Token]:
        """identifier is whatever the business typed into the single login
        field — their mobile number or their email, either one works. Tried
        as an email first when it contains "@" (mobile numbers never do),
        otherwise as a mobile number."""
        with Session(engine) as session:
            if "@" in identifier:
                user = get_user_by_email(session, identifier.strip().lower())
            else:
                user = get_user_by_mobile(session, identifier.strip())
            if not user:
                return None
            if not verify_password(password, user.hashed_password):
                return None
            # Only reached with the right password, so it's safe to tell them
            # which email to verify. The code from sign-up may have expired
            # by now; refresh it so the verify screen isn't a dead end.
            pending = session.get(EmailVerification, user.id)
            if pending:
                if pending.expires_at <= now_ph():
                    try:
                        self._issue_otp(session, user)
                    except EmailSendError:
                        pass
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"code": "EMAIL_NOT_VERIFIED", "email": user.email},
                )
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
            if not user and email:
                # Same person, different door in: they already have a
                # mobile+password account under this email (email is unique),
                # so link this Google identity to it instead of trying to
                # INSERT a second row with a duplicate email — that would
                # just hit the unique constraint and 500. Same account, same
                # mobile number and password still work afterward too.
                user = get_user_by_email(session, email.strip().lower())
                if user:
                    user.google_id = google_id
                    session.add(user)
                    # Google just proved they own this address, so a pending
                    # OTP check for it is moot. The password on that
                    # never-verified account was set by whoever typed the
                    # address at sign-up — possibly not its owner — so drop it
                    # rather than let them keep a way into the real owner's
                    # account.
                    pending = session.get(EmailVerification, user.id)
                    if pending:
                        session.delete(pending)
                        user.hashed_password = None
                    session.commit()
                    session.refresh(user)
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

    def request_password_change_otp(self, user_id: int) -> None:
        """Emails the signed-in user a code they must enter to change their
        password. Sent to the address on the account, never one supplied by
        the caller, so a stolen session token alone can't redirect it."""
        with Session(engine) as session:
            user = get_user(session, user_id)
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
            if not user.email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Your account has no email address to send a code to.",
                )
            now = now_ph()
            pending = session.get(PasswordChangeOtp, user.id)
            if pending:
                wait = (pending.last_sent_at + timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS) - now).total_seconds()
                if wait > 0:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail=f"Please wait {int(wait) + 1} seconds before requesting another code.",
                    )
            else:
                pending = PasswordChangeOtp(user_id=user.id, otp_hash="", expires_at=now)
            code = f"{secrets.randbelow(10**6):06d}"
            pending.otp_hash = self._hash_otp(user.id, code, PASSWORD_OTP_PURPOSE)
            pending.expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
            pending.attempts = 0
            pending.last_sent_at = now
            session.add(pending)
            session.commit()
            try:
                send_password_change_otp_email(user.email, code)
            except EmailSendError:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="We couldn't send the email right now. Please try again shortly.",
                )

    def change_password(self, user_id: int, data: PasswordChange) -> None:
        with Session(engine) as session:
            user = get_user(session, user_id)
            if not user or not verify_password(data.current_password, user.hashed_password):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
            pending = session.get(PasswordChangeOtp, user.id)
            if not pending:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Request a code first — we'll email it to you.",
                )
            if pending.attempts >= settings.OTP_MAX_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many incorrect attempts. Request a new code.",
                )
            if pending.expires_at <= now_ph():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This code has expired. Request a new one.",
                )
            if not hmac.compare_digest(pending.otp_hash, self._hash_otp(user.id, data.code, PASSWORD_OTP_PURPOSE)):
                pending.attempts += 1
                session.add(pending)
                session.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect code")

            user.hashed_password = get_password_hash(data.new_password)
            session.add(user)
            session.delete(pending)
            session.commit()

    def request_password_reset_otp(self, email: str) -> None:
        """Step 1 of the logged-out 'forgot password' flow: emails a reset
        code to the account's address if — and only if — one exists and it's
        a mobile+password account (a Google-only account has no password to
        reset). Unknown emails and Google-only accounts get the exact same
        silent, generic response as a real match, for the same
        anti-enumeration reason as resend_otp."""
        with Session(engine) as session:
            user = get_user_by_email(session, email.strip().lower())
            if not user or not user.hashed_password:
                return
            now = now_ph()
            pending = session.get(PasswordChangeOtp, user.id)
            if pending:
                wait = (pending.last_sent_at + timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS) - now).total_seconds()
                if wait > 0:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail=f"Please wait {int(wait) + 1} seconds before requesting another code.",
                    )
            else:
                pending = PasswordChangeOtp(user_id=user.id, otp_hash="", expires_at=now)
            code = f"{secrets.randbelow(10**6):06d}"
            pending.otp_hash = self._hash_otp(user.id, code, PASSWORD_RESET_OTP_PURPOSE)
            pending.expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
            pending.attempts = 0
            pending.last_sent_at = now
            session.add(pending)
            session.commit()
            try:
                send_password_reset_otp_email(user.email, code)
            except EmailSendError:
                # Swallow rather than surface a 503: doing so would tell a
                # caller "that email matched an account, and sending just
                # failed" — an oracle this endpoint is otherwise careful to
                # avoid. Asking again (the frontend's "Resend code") retries.
                pass

    def reset_password(self, email: str, code: str, new_password: str) -> None:
        """Step 2: the code from request_password_reset_otp lets a signed-out
        caller set a brand-new password with no current password required —
        that's the point of 'forgot' password. Every failure reports the same
        'Invalid or expired code' message as a wrong code, so this can't be
        used to probe which emails have accounts either."""
        invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")
        with Session(engine) as session:
            user = get_user_by_email(session, email.strip().lower())
            pending = session.get(PasswordChangeOtp, user.id) if user else None
            if not user or not pending:
                raise invalid
            if pending.attempts >= settings.OTP_MAX_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many incorrect attempts. Request a new code.",
                )
            if pending.expires_at <= now_ph():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This code has expired. Request a new one.",
                )
            if not hmac.compare_digest(pending.otp_hash, self._hash_otp(user.id, code, PASSWORD_RESET_OTP_PURPOSE)):
                pending.attempts += 1
                session.add(pending)
                session.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect code")

            user.hashed_password = get_password_hash(new_password)
            session.add(user)
            session.delete(pending)
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