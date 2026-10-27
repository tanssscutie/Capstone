from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class PortfolioItem(SQLModel, table=True):
    """A photo of a seller's past work shown on their profile — a printed
    tarpaulin, a packaging run — for Panel Suggestion #7: something a buyer
    can look at to judge a supplier without ratings (portfolio_service).

    The image is encrypted at rest like every other upload (file_crypto) and
    served only to signed-in users, through an access-checked endpoint."""

    id: Optional[int] = Field(default=None, primary_key=True)
    business_id: int = Field(foreign_key="user.id", index=True)
    file_path: str
    original_filename: str = Field(max_length=255)
    caption: str = Field(max_length=140)
    # One of the business's category items (app/core/categories.py), optional.
    item_code: Optional[str] = Field(default=None, max_length=60)
    created_at: datetime = Field(default_factory=now_ph)
