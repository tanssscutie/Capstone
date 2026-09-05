from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class Requirement(SQLModel, table=True):
    """A business requirement/opportunity posted by a user.

    Status lifecycle: open -> closed (released) -> awarded
                                                  -> closed_no_award
                       open -> cancelled
    'open' is the sealed submission window; no party (including the buyer)
    can see quotation content while a requirement is open. 'closed' means
    the system clock has passed closes_at and all sealed quotes for it were
    released simultaneously. 'awarded' means the buyer picked a winner from
    the released list. 'closed_no_award' means the buyer reviewed the
    released quotations and declined all of them — a final decision, same as
    'awarded', just with no winner. 'cancelled' means the buyer pulled it
    before closing, voiding all sealed quotes unopened.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    ref_code: str = Field(index=True, unique=True)
    title: str
    tags: str = ""  # comma-separated, e.g. "CONSTRUCTION,CLOSING SOON" — [0] is the category

    owner_id: int = Field(foreign_key="user.id", index=True)

    category: str = ""
    scope: str = ""
    specifications_json: str = "[]"  # JSON list of {"label": str, "value": str}
    quantity: str = ""

    price_min: Optional[float] = None
    price_max: Optional[float] = None

    city: str = ""
    site_address: Optional[str] = None
    location: str  # display string derived from city (+ site_address) at creation
    site_access_hours: str = ""  # e.g. "Mon-Sat, 7:00 AM - 6:00 PM" — editable any time, never locked
    site_access_notes: str = ""  # e.g. gate codes, warehouse status — same, never locked

    delivery_start: Optional[datetime] = None
    delivery_end: Optional[datetime] = None

    match_note: Optional[str] = None

    status: str = Field(default="open", index=True)  # open | closed | cancelled | awarded | closed_no_award
    closes_at: datetime
    released_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    awarded_quotation_id: Optional[int] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)