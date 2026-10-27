from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field

from app.core.clock import now_ph


class OrderUpdate(SQLModel, table=True):
    """One step on an awarded requirement's order timeline (fulfillment_service):
    the supplier's "Mark as completed" (delivered; older rows may hold the retired
    in_production / out_for_delivery), the buyer's confirm, and the system's
    auto-confirm or Unconfirmed."""

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    status: str  # in_production | out_for_delivery | delivered | completed | unconfirmed | not_pushed_through
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")  # None = TrustLink (scheduler)
    actor_role: str  # buyer | supplier | system
    note: Optional[str] = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=now_ph)
