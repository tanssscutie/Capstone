from datetime import datetime

from sqlmodel import SQLModel, Field

from app.core.clock import now_ph


class PasswordChangeOtp(SQLModel, table=True):
    """A pending "confirm it's you" code for one user's password change. Unlike
    EmailVerification, this row does not block login — it only exists between
    "send me a code" (POST /auth/password/request-otp) and a successful
    PUT /auth/password, which deletes it. A separate table keeps the two
    meanings apart: the existence of an EmailVerification row means "not
    verified yet", so reusing it here would lock the user out of their own
    account.

    Also backs the logged-out "forgot password" flow (POST /auth/password/forgot
    + POST /auth/password/reset) — same table, same one-pending-code-per-user
    shape, just a different HMAC purpose prefix (see auth_service._hash_otp)
    so a code minted for one flow can't be replayed against the other. The two
    flows share a row per user rather than getting one each, since only one of
    them can plausibly be in progress at a time and both end by emailing the
    same address on file."""
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    # HMAC of the code, never the code itself — see auth_service._hash_otp.
    otp_hash: str
    expires_at: datetime
    attempts: int = 0
    last_sent_at: datetime = Field(default_factory=now_ph)
