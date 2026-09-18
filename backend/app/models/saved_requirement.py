from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class SavedRequirement(SQLModel, table=True):
    """A business's personal bookmark on a requirement it's considering —
    visible only to the business that saved it, never to the requirement's
    owner or anyone else."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    created_at: datetime = Field(default_factory=now_ph)
