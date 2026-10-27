from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


class MessageThread(SQLModel, table=True):
    """Post-procurement messaging (Panel Suggestion #3): created only when the
    proposed winner accepts the Notice of Award (RequirementService.accept_award),
    one per awarded (requirement, business), opened with a system message. There
    is no "start a chat" action anywhere in the product.

    Databases from before this rule may still hold threads opened at release for
    respondents that never won — message_service hides and refuses those."""

    __table_args__ = (UniqueConstraint("requirement_id", "business_id", name="uq_thread_requirement_business"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    buyer_id: int = Field(foreign_key="user.id", index=True)
    business_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=now_ph)
