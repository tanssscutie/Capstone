from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class ProfileChangeRequest(SQLModel, table=True):
    """A business asking an administrator to change a locked business detail
    (registered name, category, location, contact — see
    change_request_service.LOCKED_FIELDS). Those fields can't be edited directly
    once onboarding is done, so a verified identity can't be swapped quietly.

    changes_json: {"field": {"from": old, "to": new}, ...} — the old values are
    kept as they were when the request was made."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    changes_json: str = Field(sa_type=Text)
    reason: str = Field(max_length=500)
    status: str = Field(default="pending", max_length=20)  # pending | approved | rejected
    admin_id: Optional[int] = Field(default=None, foreign_key="user.id")
    admin_notes: Optional[str] = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=now_ph)
    reviewed_at: Optional[datetime] = None
