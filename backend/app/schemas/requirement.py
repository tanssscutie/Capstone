from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SpecRow(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=200)


class RequirementCreate(BaseModel):
    category: str = Field(min_length=2, max_length=100)
    title: str = Field(min_length=5, max_length=200)
    scope: str = Field(min_length=10, max_length=3000)
    specifications: List[SpecRow] = []
    quantity: str = Field(min_length=1, max_length=200)
    price_min: Optional[float] = Field(default=None, ge=0)
    price_max: Optional[float] = Field(default=None, ge=0)

    city: str = Field(min_length=2, max_length=120)
    site_address: Optional[str] = Field(default=None, max_length=300)
    delivery_start: Optional[datetime] = None
    delivery_end: Optional[datetime] = None

    closes_at: datetime


class AttachmentOut(BaseModel):
    id: int
    filename: str
    uploaded_at: datetime


class PosterOut(BaseModel):
    id: int
    business_name: str  # casual name given at registration — see registered_name below
    # The exact name from onboarding (matches the DTI/SEC certificate). Null until
    # the business completes onboarding. Prefer this over business_name wherever a
    # business's name is shown to someone else — mapPosterToBusiness on the frontend
    # falls back to business_name only when this is null, same as a viewer's own name.
    registered_name: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    is_verified: bool
    tier: int
    member_since_year: int
    requirements_posted_count: int
    verified_since: Optional[str] = None  # e.g. "Nov 2025"
    requirements_awarded_count: int = 0  # times this business's posted requirements reached an award


class RequirementOut(BaseModel):
    id: int
    ref_code: str
    title: str
    tags: List[str]
    poster: PosterOut

    category: str
    scope: str
    specifications: List[SpecRow]
    quantity: str
    price_min: Optional[float]
    price_max: Optional[float]

    city: str
    site_address: Optional[str]
    location: str
    site_access_hours: str = ""
    site_access_notes: str = ""
    delivery_start: Optional[datetime]
    delivery_end: Optional[datetime]
    attachments: List[AttachmentOut] = []

    match_note: Optional[str]
    status: str
    quotations_count: int
    latest_quotation_at: Optional[datetime]
    closes_at: datetime

    # Personalized: only set when the viewer already has a sealed quotation
    # on this requirement, so the feed can show "Sealed" instead of letting
    # them submit a second one that just silently withdraws the first.
    my_active_quotation_ref: Optional[str] = None
    created_at: datetime
    awarded_quotation_id: Optional[int] = None

    # Personalized: whether the viewer has bookmarked this requirement. False for
    # an anonymous/no-viewer lookup, same as my_active_quotation_ref above.
    is_saved: bool = False


# ---------- sealed quotation submission ----------

class QuotationCreate(BaseModel):
    # Required and > 0 — matches the frontend's own "ready" gate (ack1 && ack2 &&
    # total > 0), enforced here too so a quotation can never be sealed empty
    # regardless of what actually called this endpoint.
    total_price: float = Field(gt=0)
    delivery_lead_time: Optional[str] = Field(default=None, max_length=100)
    payment_terms: Optional[str] = Field(default=None, max_length=100)
    validity_period: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)


class QuotationSealedReceipt(BaseModel):
    """What a business gets back immediately after submitting — proof the
    submission was recorded, without revealing anything about other
    submissions or when the requirement will actually release."""
    quotation_id: int  # so the client can attach files to it afterward
    quotation_ref: str
    submitted_at: datetime
    truncated_hash: str
    ledger_entry_number: int
    sealed_until: datetime


# ---------- post-release comparison view ----------

class QuotationDetailOut(BaseModel):
    id: int
    quotation_ref: str
    business: PosterOut
    total_price: Optional[float]
    delivery_lead_time: Optional[str]
    payment_terms: Optional[str]
    validity_period: Optional[str]
    notes: str
    status: str  # released | withdrawn | voided | shortlisted | awarded | not_selected
    shortlisted: bool = False
    submitted_at: datetime
    integrity_status: Optional[str]  # valid | flagged | None (not yet released)
    attachments: List[AttachmentOut] = []


class RequirementQuotationsView(BaseModel):
    requirement_status: str  # open | closed | cancelled | awarded | closed_no_award
    sealed_count: Optional[int] = None       # present only while status == "open"
    quotations: Optional[List[QuotationDetailOut]] = None  # present once released
    awarded_quotation_id: Optional[int] = None


# ---------- ledger ----------

class LedgerEntryOut(BaseModel):
    """One entry in the platform's tamper-evident hash chain, scoped to what
    the requesting viewer is allowed to see (see requirement_service.list_ledger).
    Never carries payload_json — that's the raw audit record, not something
    to expose over the API; the hash itself is what proves integrity."""
    id: int
    sequence: int  # same as `id` — the entry's position in the global chain,
    # kept as a separate field so the frontend doesn't need to know that.
    event_type: str  # SUBMITTED | WITHDRAWN | RELEASED | CANCELLED | AWARDED
    requirement_id: int
    quotation_id: Optional[int]
    actor_id: Optional[int]
    prev_hash: str
    entry_hash: str
    created_at: datetime


class RequirementLedgerView(BaseModel):
    requirement_id: int
    entries: List[LedgerEntryOut]


class ExtendClosingRequest(BaseModel):
    new_closes_at: datetime


class SiteNotesUpdate(BaseModel):
    site_access_hours: str = Field(default="", max_length=255)
    site_access_notes: str = Field(default="", max_length=500)


class AwardRequest(BaseModel):
    quotation_id: int


# ---------- pre-closing clarification Q&A ----------

class ClarificationQuestionOut(BaseModel):
    id: int
    requirement_id: int
    asker_id: int
    asker_name: str
    question: str
    answer: Optional[str]
    answered_at: Optional[datetime]
    created_at: datetime


class QuestionCreate(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class AnswerCreate(BaseModel):
    answer: str = Field(min_length=1, max_length=1000)


# ---------- "My Requirements" tracking page ----------

class MyRequirementOut(BaseModel):
    """Lighter-weight than RequirementOut — the owner's own list view
    doesn't need poster info (it's always them) or a match note."""
    id: int
    ref_code: str
    title: str
    category: str
    scope: str = ""
    specifications: List[SpecRow] = []
    quantity: str = ""
    status: str  # open | closed | cancelled | awarded
    city: str
    price_min: Optional[float]
    price_max: Optional[float]
    quotations_count: int
    closes_at: datetime
    released_at: Optional[datetime]
    awarded_quotation_id: Optional[int] = None
    created_at: datetime


# ---------- admin: every requirement on the platform ----------

class AdminRequirementOut(BaseModel):
    """Like MyRequirementOut, plus who posted it — the admin's roster spans
    every business, so the owner isn't implicit the way it is on "mine"."""
    id: int
    ref_code: str
    title: str
    category: str
    status: str  # open | closed | cancelled | awarded
    city: str
    price_min: Optional[float]
    price_max: Optional[float]
    quotations_count: int
    closes_at: datetime
    released_at: Optional[datetime]
    awarded_quotation_id: Optional[int] = None
    created_at: datetime

    owner_id: int
    owner_business_name: str


# ---------- "My Quotations" tracking page ----------

class MyQuotationOut(BaseModel):
    quotation_id: int
    quotation_ref: str
    status: str  # sealed | released | withdrawn | voided
    outcome: str  # sealed | released | awarded | not_awarded | withdrawn | voided
    total_price: Optional[float]
    delivery_lead_time: Optional[str]
    payment_terms: Optional[str]
    validity_period: Optional[str]
    notes: str
    submitted_at: datetime
    integrity_status: Optional[str]
    attachments: List[AttachmentOut] = []

    requirement_id: int
    requirement_ref_code: str
    requirement_title: str
    requirement_location: str
    requirement_status: str  # open | closed | cancelled | awarded | closed_no_award
    closes_at: datetime
    released_at: Optional[datetime]
    poster: PosterOut