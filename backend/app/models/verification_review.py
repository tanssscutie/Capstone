from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class VerificationReview(SQLModel, table=True):
    """One administrator decision on a business's verification
    (business_service.admin_review): who decided, what, and when. Kept for
    every review, so a business reviewed twice has two rows.

    submitted_at is copied from the business at the time of the decision, so
    review times stay measurable after the business resubmits."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    admin_id: int = Field(foreign_key="user.id")
    approved: bool
    # The status the business ended up with: verified, rejected, or submitted
    # (approved, but a required document is still missing).
    result_status: str = Field(max_length=20)
    notes: Optional[str] = Field(default=None, max_length=1000)
    submitted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=now_ph)
