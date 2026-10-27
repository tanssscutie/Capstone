from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class Message(SQLModel, table=True):
    """One message in a MessageThread: text, and/or one attached file.

    Attachments exist because the thread is post-award coordination (artwork,
    layouts, specs) — the quotation's own documents still live on the
    quotation. The file is encrypted at rest (file_crypto); attachment_sha256
    is of the plaintext. Only the thread's two parties (and admins) can fetch it.

    is_system marks the platform's own award-confirmation message (see
    RequirementService._open_award_thread). Its sender_id is the business that
    accepted the award — the actor who triggered it — so the buyer sees it as
    unread; the UI shows it as "TrustLink", never as that business typing it."""

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: int = Field(foreign_key="messagethread.id", index=True)
    sender_id: int = Field(foreign_key="user.id", index=True)
    # TEXT, not the VARCHAR(255) a bare `str` gets on MySQL — MessageCreate allows
    # 2000 characters, and the award system message alone runs past 255.
    body: str = Field(sa_type=Text)
    is_system: bool = False
    attachment_path: Optional[str] = None
    attachment_filename: Optional[str] = None
    attachment_size: Optional[int] = None
    attachment_sha256: Optional[str] = None
    read: bool = False
    created_at: datetime = Field(default_factory=now_ph)
