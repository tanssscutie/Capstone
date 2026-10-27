from datetime import datetime

from sqlmodel import SQLModel, Field

from app.core.clock import now_ph


class EmailChangeOtp(SQLModel, table=True):
    """A pending email change: the code was sent to `new_email`, and the
    account's email only changes once that code comes back (PUT /auth/email).
    Separate from PasswordChangeOtp so a password change in progress and an
    email change in progress never overwrite each other's code."""
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    new_email: str = Field(max_length=255)
    # HMAC of the code, never the code itself — see auth_service._hash_otp.
    otp_hash: str
    expires_at: datetime
    attempts: int = 0
    last_sent_at: datetime = Field(default_factory=now_ph)
