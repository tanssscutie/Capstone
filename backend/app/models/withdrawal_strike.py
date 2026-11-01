from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


class WithdrawalStrike(SQLModel, table=True):
    """A supplier withdrew its sealed quotation on a requirement and didn't
    replace it before closing (withdrawal_policy). Recorded at closing, one per
    (supplier, requirement); counted over the last 90 days."""

    __table_args__ = (UniqueConstraint("user_id", "requirement_id", name="uq_strike_user_requirement"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    created_at: datetime = Field(default_factory=now_ph)
