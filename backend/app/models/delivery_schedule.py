from datetime import date, datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class DeliverySchedule(SQLModel, table=True):
    """The delivery date of an awarded order, agreed after the award — see
    delivery_schedule_service. The buyer proposes a date; the awarded supplier
    confirms it, or declines with a reason and optionally suggests another.

    One row per proposal, so declined and withdrawn dates stay on record. The
    latest "confirmed" row is the agreed date; a later confirmed proposal
    (a reschedule) replaces it.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)

    delivery_date: date
    proposed_by: int = Field(foreign_key="user.id")
    note: Optional[str] = Field(default=None, max_length=500)

    # pending -> confirmed (the supplier agreed)
    # pending -> declined  (the supplier can't make it — reason, maybe another date)
    # pending -> withdrawn (the buyer took it back)
    status: str = "pending"
    responded_by: Optional[int] = Field(default=None, foreign_key="user.id")
    decline_reason: Optional[str] = Field(default=None, max_length=500)
    suggested_date: Optional[date] = None

    created_at: datetime = Field(default_factory=now_ph)
    responded_at: Optional[datetime] = None
