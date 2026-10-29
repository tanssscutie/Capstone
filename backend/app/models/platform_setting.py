from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class PlatformSetting(SQLModel, table=True):
    """A platform rule a super admin changed from the admin console — it
    overrides the server's .env default until reset (app/core/platform_settings.py).
    One row per key; no row = the default applies."""

    key: str = Field(primary_key=True, max_length=60)
    value: str = Field(max_length=500)
    updated_by: Optional[int] = Field(default=None, foreign_key="user.id")
    updated_at: datetime = Field(default_factory=now_ph)
