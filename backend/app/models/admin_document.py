from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class AdminDocument(SQLModel, table=True):
    """A supporting file an administrator uploaded to the admin Documents
    page (admin_library_service): interview data, thesis chapters, the
    survey, anything else. Admin-only. The file is encrypted at rest
    (file_crypto) like every other upload; file_path never leaves the server."""

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(max_length=200)
    category: str = Field(max_length=20)  # interview_data | thesis | survey | other
    filename: str = Field(max_length=255)  # the original name, for display and download
    file_path: str = Field(max_length=500)
    size_bytes: int
    uploaded_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=now_ph)
