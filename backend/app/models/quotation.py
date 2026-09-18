from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class Quotation(SQLModel, table=True):
    """A single quotation submitted against a requirement.

    Content stays sealed (invisible to every party, including the buyer)
    while status == 'sealed'. It only becomes readable once the platform's
    release job flips it to 'released' at the requirement's closing time —
    never earlier, and never triggered by a person.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    business_id: int = Field(foreign_key="user.id", index=True)

    # Sealed content. total_price is always the authoritative grand total,
    # kept even when line_items is set so every consumer (award comparison,
    # ledger hash payload) can keep reading one number. line_items is the
    # optional itemized breakdown behind it — JSON-encoded list of
    # {"description": str, "quantity": float, "unit_price": float} — empty
    # string when the respondent chose "Total price only".
    total_price: Optional[float] = None
    line_items: str = Field(default="", max_length=4000)
    delivery_lead_time: Optional[str] = None
    payment_terms: Optional[str] = None
    validity_period: Optional[str] = None
    notes: str = ""

    # sealed -> released (normal path)
    # sealed -> withdrawn (business pulled it back before closing)
    # sealed -> voided (requirement was cancelled by the buyer)
    status: str = "sealed"

    # Owner's private working note on a released quotation, cleared once the
    # requirement reaches a final decision (awarded or closed without award).
    # Never surfaced to the respondent — visible to the owner only.
    shortlisted: bool = False

    # Set only at release: "valid" if the recomputed hash matches what was
    # recorded at submission time, "flagged" if it doesn't (tamper-evident).
    integrity_status: Optional[str] = None

    # Hash captured at submission time (before any possibility of edits),
    # used to re-verify integrity at release. See LedgerEntry for the full
    # chained record this was written into.
    submission_hash: str
    ledger_entry_id: Optional[int] = None  # the SUBMITTED entry's id ("ledger entry number")

    created_at: datetime = Field(default_factory=now_ph)
    withdrawn_at: Optional[datetime] = None
    released_at: Optional[datetime] = None