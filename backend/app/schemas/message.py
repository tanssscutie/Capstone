from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MessageThreadOut(BaseModel):
    id: int
    requirement_id: int
    requirement_ref_code: str
    awarded_quotation_id: int

    # Personalized: whichever side of the thread the viewer ISN'T.
    counterparty_id: int
    counterparty_name: str

    last_message_preview: str
    last_message_at: Optional[datetime]
    unread: bool
    # The transaction is completed (or did not push through): the thread stays
    # as a record and nobody can post in it.
    read_only: bool = False


class MessageOut(BaseModel):
    id: int
    thread_id: int
    sender_id: int
    body: str
    is_system: bool = False
    # Set when the message carries a file — fetch it from
    # GET /messages/threads/{thread_id}/messages/{id}/file.
    attachment_filename: Optional[str] = None
    attachment_size: Optional[int] = None
    created_at: datetime
    read: bool


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
