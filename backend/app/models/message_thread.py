from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


class MessageThread(SQLModel, table=True):
    """Created automatically the instant a requirement's sealed quotations release
    (see RequirementService._release_one) — one per (requirement, business) whose
    quotation actually released. There is no "start a chat" action anywhere in the
    product; a thread's existence IS the record that this business's quotation
    released on this requirement, so the buyer can talk to them about it — before,
    not only after, an award is decided."""

    __table_args__ = (UniqueConstraint("requirement_id", "business_id", name="uq_thread_requirement_business"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    buyer_id: int = Field(foreign_key="user.id", index=True)
    business_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
