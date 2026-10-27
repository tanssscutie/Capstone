from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class TransactionCloseout(SQLModel, table=True):
    """One party's claim about how an awarded transaction ended, and the other
    party's answer — see closeout_service.

    Deliberately not post-award tracking (out of the study's scope): TrustLink
    records only that BOTH parties agree the deal was completed, or agree it
    did not push through. Nothing about delivery, payment or receipts.

    One row per proposal, so a rejected or withdrawn claim stays on record.
    At most one row per requirement is ever "confirmed"; that row is the
    transaction's final outcome.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)

    outcome: str  # completed | not_pushed_through
    proposed_by: int = Field(foreign_key="user.id")
    proposed_by_role: str  # buyer | supplier
    note: Optional[str] = Field(default=None, max_length=500)

    # pending -> confirmed (the other party agreed — final)
    # pending -> rejected  (the other party said "not yet", with a reason)
    # pending -> withdrawn (the proposer took it back)
    status: str = "pending"
    responded_by: Optional[int] = Field(default=None, foreign_key="user.id")
    response_note: Optional[str] = Field(default=None, max_length=500)

    created_at: datetime = Field(default_factory=now_ph)
    responded_at: Optional[datetime] = None
