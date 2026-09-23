from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field

from app.core.clock import now_ph


class EmailVerification(SQLModel, table=True):
    """A pending email-ownership check for one user. The row's existence IS
    the "not verified yet" state: register creates it, a successful
    verify_email deletes it, and login is refused while it exists.

    Modelled as a row instead of a User.email_verified column on purpose —
    the database has no migration tooling (create_all only creates missing
    tables, never adds columns), so a new column would break every existing
    deployment until someone ran an ALTER TABLE by hand. This way every
    account that predates OTP, and every Google sign-up (Google has already
    proven the address), simply has no row and counts as verified."""
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    # HMAC of the code, never the code itself — see auth_service._hash_otp.
    otp_hash: str
    expires_at: datetime
    attempts: int = 0
    last_sent_at: datetime = Field(default_factory=now_ph)
