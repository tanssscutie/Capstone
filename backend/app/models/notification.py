from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class Notification(SQLModel, table=True):
    """An alert delivered to one user (REQUIREMENT_CLOSING, DECISION, VERIFICATION,
    MESSAGE_RECEIVED, QUESTION_ASKED, QUESTION_ANSWERED — see AlertType on the
    frontend). Created by whichever service action causes it: the closing-soon
    scheduler pass, award, admin_review, send_message, or ask/answer_question.
    Deliberately nothing for an individual quotation submission — the buyer is
    never notified of one, only the running count they can pull on demand."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    type: str
    title: str
    detail: str
    urgent: bool = False
    read: bool = False

    # Internal-only idempotency key, never exposed via NotificationOut — lets the
    # closing-soon scheduler check "has this requirement's owner already been
    # alerted" without a second table. Other notification types are each created
    # exactly once, at the event that causes them, so they leave this unset.
    related_requirement_id: Optional[int] = Field(default=None, index=True)

    created_at: datetime = Field(default_factory=datetime.utcnow)
