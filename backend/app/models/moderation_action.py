from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class ModerationAction(SQLModel, table=True):
    """Audit trail of every action an administrator takes on an account —
    warn, suspend, ban, lift (moderation_service). Kept even after a
    suspension lapses or is lifted."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    admin_id: int = Field(foreign_key="user.id")
    report_id: Optional[int] = Field(default=None, foreign_key="businessreport.id")
    action: str = Field(max_length=12)  # warn | suspend | ban | lift
    reason: str = Field(sa_type=Text)
    until: Optional[datetime] = None  # suspensions only
    created_at: datetime = Field(default_factory=now_ph)
