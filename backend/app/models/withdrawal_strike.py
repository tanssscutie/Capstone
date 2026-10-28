from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class WithdrawalStrike(SQLModel, table=True):
    """One withdrawn sealed quotation (withdrawal_policy). Recorded the moment
    the supplier withdraws — a withdraw-and-resubmit counts too — with the
    reason they gave; counted over the last 90 days.

    The reason, details and proof are for administrators only: never shown to
    the buyer or other suppliers, so nothing about a sealed quotation leaks."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    quotation_id: Optional[int] = Field(default=None, foreign_key="quotation.id")
    # withdrawal_policy.REASONS; "unspecified" on strikes from before reasons were asked.
    reason_code: str = Field(default="unspecified", max_length=30)
    reason_details: Optional[str] = Field(default=None, sa_type=Text)
    # Optional proof, encrypted at rest (file_crypto) like every other upload.
    proof_path: Optional[str] = Field(default=None, max_length=500)
    proof_filename: Optional[str] = Field(default=None, max_length=255)
    created_at: datetime = Field(default_factory=now_ph)
