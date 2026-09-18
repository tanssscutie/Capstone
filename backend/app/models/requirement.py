from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class Requirement(SQLModel, table=True):
    """A business requirement/opportunity posted by a user.

    Status lifecycle: open -> closed (released) -> award_pending -> awarded
                                                                  -> closed_no_award
                       open -> cancelled
    'open' is the sealed submission window; no party (including the buyer)
    can see quotation content while a requirement is open. 'closed' means
    the system clock has passed closes_at and all sealed quotes for it were
    released simultaneously. 'award_pending' means the buyer picked a winner
    (a Notice of Award) but that business hasn't accepted or declined it yet
    — nothing is final, and no other respondent has been told they lost.
    'awarded' means the picked business accepted the notice. A decline (or
    letting award_response_deadline pass unanswered) reverts the requirement
    straight back to 'closed' so the buyer can propose someone else — award
    is never final until accepted. 'closed_no_award' means the buyer
    reviewed the released quotations and declined all of them — a final
    decision, same weight as 'awarded', just with no winner. 'cancelled'
    means the buyer pulled it before closing, voiding all sealed quotes
    unopened.
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

    # Qualifying documents the buyer wants each respondent to attach to their
    # sealed quotation (e.g. "PCAB License", "Sanitary Permit") — comma-separated,
    # same convention as tags/capabilities. Optional; a respondent who doesn't
    # attach one for each label just submits without it, same as any other
    # attachment — this isn't a hard submission gate, only a declared request
    # the frontend surfaces so a respondent knows what's expected.
    required_documents: str = ""

    # Semantic matching (Specific Objective #4) — JSON-encoded embedding
    # vector of category + title + scope, computed once at creation (these
    # fields are locked after publish, so it never needs recomputing). Empty
    # if the local embedding model was unavailable at creation time — see
    # matching_service.py.
    embedding: str = Field(default="", sa_type=Text)

    status: str = Field(default="open", index=True)  # open | closed | cancelled | award_pending | awarded | closed_no_award
    closes_at: datetime
    released_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    # The candidate winner while status == 'award_pending', and the confirmed
    # one once status == 'awarded' — same column for both, since a pending
    # notice and a confirmed award are the same "who currently holds this"
    # fact at different points of the same decision.
    awarded_quotation_id: Optional[int] = None
    # Set when a Notice of Award goes out (status -> 'award_pending'), cleared
    # on accept, decline, or expiry. The scheduler auto-declines any notice
    # still pending once this passes — see requirement_service.expire_due_award_notices.
    award_response_deadline: Optional[datetime] = None

    created_at: datetime = Field(default_factory=now_ph)