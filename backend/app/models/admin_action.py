from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class AdminAction(SQLModel, table=True):
    """One thing an administrator did — the admin audit log (admin_audit).
    Append-only: nothing in the app edits or deletes these rows."""

    id: Optional[int] = Field(default=None, primary_key=True)
    admin_id: int = Field(foreign_key="user.id", index=True)
    action: str = Field(max_length=40, index=True)  # see admin_audit.ACTION_LABELS
    target_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    details: Optional[str] = Field(default=None, max_length=1000)
    created_at: datetime = Field(default_factory=now_ph, index=True)
