from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    type: str  # REQUIREMENT_CLOSING | DECISION | VERIFICATION | MESSAGE_RECEIVED | QUESTION_ASKED | QUESTION_ANSWERED
    title: str
    detail: str
    urgent: bool
    read: bool
    created_at: datetime
    # The requirement this alert is about, when there is one — lets the header's
    # alerts popover open it directly.
    related_requirement_id: Optional[int] = None
