from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class BusinessReport(SQLModel, table=True):
    """A business reporting another one — a fake supplier, a scam, an abusive
    buyer — for an administrator to review (report_service).

    Confidential: the reported business is never told who reported it, or
    that a report exists. Reviewing a report only records the admin's
    decision; acting on it (re-verification, deactivation) goes through the
    admin's existing business tools.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    reporter_id: int = Field(foreign_key="user.id", index=True)
    reported_id: int = Field(foreign_key="user.id", index=True)
    reason: str = Field(max_length=30)  # see report_service.REASONS
    details: str = Field(sa_type=Text)
    # Optional: the requirement it happened on, when there is one.
    related_requirement_id: Optional[int] = Field(default=None, foreign_key="requirement.id")

    # open -> resolved (action taken) | dismissed (no violation found)
    status: str = Field(default="open", max_length=12, index=True)
    admin_notes: Optional[str] = Field(default=None, sa_type=Text)
    reviewed_by: Optional[int] = Field(default=None, foreign_key="user.id")
    reviewed_at: Optional[datetime] = None

    created_at: datetime = Field(default_factory=now_ph)
