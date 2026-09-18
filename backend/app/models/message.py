from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class Message(SQLModel, table=True):
    """One plain-text message in a MessageThread. No attachments — documents
    belong to the quotation, not the conversation."""

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: int = Field(foreign_key="messagethread.id", index=True)
    sender_id: int = Field(foreign_key="user.id", index=True)
    body: str
    read: bool = False
    created_at: datetime = Field(default_factory=now_ph)
