from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class RequirementAttachment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    file_path: str
    original_filename: str
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)