from datetime import datetime

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    type: str  # REQUIREMENT_CLOSING | DECISION | VERIFICATION | MESSAGE_RECEIVED | QUESTION_ASKED | QUESTION_ANSWERED
    title: str
    detail: str
    urgent: bool
    read: bool
    created_at: datetime
