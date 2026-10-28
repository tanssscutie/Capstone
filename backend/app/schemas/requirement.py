from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from app.core.clock import now_ph


class SpecRow(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=200)
    # The ATTRIBUTES id (app/core/categories.py) for a template row, or for a
    # custom row the buyer matched to one ("Ito ba ay …?"). Null on the buyer's
    # own rows and on requirements posted before attribute ids existed.
    attribute_id: Optional[str] = Field(default=None, max_length=60)
    # value in its standard unit (app/core/units.py). Set by the server on
    # create, never taken from the client; value stays as the buyer typed it.
    normalized_value: Optional[str] = None
    normalized_unit: Optional[str] = None


class LineItem(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class CategorySuggestionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    scope: str = Field(default="", max_length=3000)


class CategorySuggestionOut(BaseModel):
    """Assistive category suggestion — a hint only. The buyer picks the
    category themselves from the same fixed pill list either way; this never
    writes anything and the field this feeds stays a normal, freely-editable
    choice."""
    category: Optional[str] = None


class DetailDraftSpec(BaseModel):
    label: str = Field(default="", max_length=100)
    value: str = Field(default="", max_length=200)


class DetailDraftRequest(BaseModel):
    """Step 1 of Post a requirement, as typed so far — for "Write with AI".
    Everything is optional: the buyer may press it early."""
    category: str = Field(default="", max_length=100)
    item: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=200)
    specifications: List[DetailDraftSpec] = Field(default=[], max_length=40)
    quantity: str = Field(default="", max_length=200)
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    strict_budget: bool = False
    current_text: str = Field(default="", max_length=3000)


class DetailDraftOut(BaseModel):
    """A suggested Detail (scope) text. Never saved — the buyer edits it."""
    text: str
    source: str  # ai | template
    message: str


class RequirementCreate(BaseModel):
    # "Request a quote" from a seller's profile: those sellers get an invite
    # alert. The requirement stays public and sealed — not a private deal.
    invited_business_ids: List[int] = Field(default_factory=list, max_length=5)
    category: str = Field(min_length=2, max_length=100)
    # One of the category's items (app/core/categories.py) — its merged specs
    # decide which specifications are required; checked in
    # requirement_service.create. "other" = general + category specs only.
    item_code: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=5, max_length=200)
    scope: str = Field(min_length=10, max_length=3000)
    specifications: List[SpecRow] = []
    quantity: str = Field(min_length=1, max_length=200)
    # Indicative budget — required on create (both ends, above zero).
    price_min: float = Field(gt=0)
    price_max: float = Field(gt=0)
    # Off = indicative budget (suppliers may go above it, with a reason).
    strict_budget: bool = False

    city: str = Field(min_length=2, max_length=120)
    # Street / building / unit number. With barangay + zip_code the server
    # composes the full address line (app/core/addresses.py).
    site_address: str = Field(min_length=1, max_length=200)
    # Must be one of the city's PSGC barangays. Optional only for older clients —
    # Post a Requirement always sends both.
    barangay: Optional[str] = Field(default=None, max_length=120)
    zip_code: Optional[str] = Field(default=None, pattern=r"^\d{4}$")
    delivery_start: Optional[datetime] = None
    delivery_end: Optional[datetime] = None

    # Qualifying documents respondents should attach to their quotation, e.g.
    # ["PCAB License", "Sanitary Permit"] — see Requirement.required_documents.
    # Required (min 1) at the buyer's explicit choice — enforced here too,
    # not just in the frontend form, so it can't be bypassed by calling the
    # API directly.
    # May be empty: registration papers (DTI/SEC, BIR 2303, Mayor's Permit) are
    # already verified by TrustLink at onboarding, so a job may need nothing more.
    required_documents: List[str] = []

    closes_at: datetime

    @model_validator(mode="after")
    def _check_budget(self):
        if self.price_max < self.price_min:
            raise ValueError("price_max can't be less than price_min")
        return self

    @model_validator(mode="after")
    def _check_delivery_window(self):
        # Compared by calendar day in PHT (see app/core/clock.py) — a delivery
        # starting today is fine, one starting yesterday is not.
        today = now_ph().date()
        if self.delivery_start and self.delivery_start.date() < today:
            raise ValueError("delivery_start can't be a date that has already passed")
        if self.delivery_end and self.delivery_end.date() < today:
            raise ValueError("delivery_end can't be a date that has already passed")
        if self.delivery_start and self.delivery_end and self.delivery_end < self.delivery_start:
            raise ValueError("delivery_end can't be before delivery_start")
        return self


class AttachmentOut(BaseModel):
    id: int
    filename: str
    # Set only for a quotation attachment that satisfies one of the
    # requirement's required_documents — always None for a requirement's own
    # attachments, and for a quotation's general/unlabeled ones.
    document_label: Optional[str] = None
    uploaded_at: datetime


class PosterOut(BaseModel):
    id: int
    business_name: str  # casual name given at registration — see registered_name below
    # The exact name from onboarding (matches the DTI/SEC certificate). Null until
    # the business completes onboarding. Prefer this over business_name wherever a
    # business's name is shown to someone else — mapPosterToBusiness on the frontend
    # falls back to business_name only when this is null, same as a viewer's own name.
    registered_name: Optional[str] = None
    # Optional trading name — prefer this over both registered_name and
    # business_name when set. See User.display_name.
    display_name: Optional[str] = None
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
    # Null on requirements posted before items existed.
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    scope: str
    specifications: List[SpecRow]
    quantity: str
    price_min: Optional[float]
    price_max: Optional[float]
    strict_budget: bool = False

    city: str
    site_address: Optional[str]
    barangay: Optional[str] = None
    zip_code: Optional[str] = None
    auto_extended_at: Optional[datetime] = None
    location: str
    site_access_hours: str = ""
    site_access_notes: str = ""
    required_documents: List[str] = []
    delivery_start: Optional[datetime]
    delivery_end: Optional[datetime]
    attachments: List[AttachmentOut] = []

    match_note: Optional[str]
    status: str
    quotations_count: int
    latest_quotation_at: Optional[datetime]
    closes_at: datetime
    released_at: Optional[datetime] = None

    # Personalized: only set when the viewer already has a sealed quotation
    # on this requirement, so the feed can show "Sealed" instead of letting
    # them submit a second one that just silently withdraws the first.
    my_active_quotation_ref: Optional[str] = None
    created_at: datetime
    awarded_quotation_id: Optional[int] = None
    # Set only while status == 'award_pending' — when the proposed winner's
    # response window closes. None once accepted, declined, or expired.
    award_response_deadline: Optional[datetime] = None

    # Personalized: whether the viewer has bookmarked this requirement. False for
    # an anonymous/no-viewer lookup, same as my_active_quotation_ref above.
    is_saved: bool = False


# ---------- sealed quotation submission ----------

class SpecResponseIn(BaseModel):
    """A respondent's answer to one of the requirement's specification rows."""
    # Matches the requirement's row by label — labels are unique per requirement.
    label: str = Field(min_length=1, max_length=100)
    complies: bool
    # What's quoted instead — required when complies is false. For the
    # preferred brand, the equivalent brand offered.
    offered: Optional[str] = Field(default=None, max_length=200)


class SpecResponseOut(BaseModel):
    label: str
    attribute_id: Optional[str] = None
    complies: bool
    offered: Optional[str] = None


class QuotationCreate(BaseModel):
    # Required and > 0 — matches the frontend's own "ready" gate (ack1 && ack2 &&
    # total > 0), enforced here too so a quotation can never be sealed empty
    # regardless of what actually called this endpoint.
    total_price: float = Field(gt=0)
    # Optional itemized breakdown behind total_price — when present, total_price
    # must still be the correct sum (the frontend computes it that way; not
    # re-validated server-side since rounding on the client is display-only).
    line_items: List[LineItem] = []
    delivery_lead_time: Optional[str] = Field(default=None, max_length=100)
    payment_terms: Optional[str] = Field(default=None, max_length=100)
    validity_period: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)
    # Required when total_price is above the buyer's indicative budget.
    over_budget_reason: Optional[str] = Field(default=None, max_length=300)
    # One answer per specification row of the requirement — all of them, no
    # more (checked in requirement_service.submit_quotation). Empty for a
    # requirement with no specifications.
    spec_responses: List[SpecResponseIn] = []


class QuotationDraftLine(BaseModel):
    description: str
    quantity: float
    unit_price: float  # 0 = no price suggested (template draft)


class QuotationDraftSpec(BaseModel):
    label: str
    complies: bool
    offered: Optional[str] = None


class QuotationDraftOut(BaseModel):
    """A first draft for the Submit Quotation form (quotation_draft_service).
    Never saved, never on the ledger — the seller reviews and seals it."""
    source: str  # ai | template (no prices)
    message: str
    line_items: List[QuotationDraftLine] = []
    spec_responses: List[QuotationDraftSpec] = []
    lead_time_weeks: int
    payment_terms: str
    validity_days: int
    notes: str = ""


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
    line_items: List[LineItem] = []
    delivery_lead_time: Optional[str]
    payment_terms: Optional[str]
    validity_period: Optional[str]
    notes: str
    over_budget_reason: Optional[str] = None
    # Empty on quotations submitted before spec responses existed.
    spec_responses: List[SpecResponseOut] = []
    status: str  # released | withdrawn | voided | shortlisted | award_pending | awarded | not_selected
    shortlisted: bool = False
    submitted_at: datetime
    integrity_status: Optional[str]  # valid | flagged | None (not yet released)
    attachments: List[AttachmentOut] = []


class RequirementQuotationsView(BaseModel):
    requirement_status: str  # open | closed | cancelled | award_pending | awarded | closed_no_award
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
    event_type: str  # SUBMITTED | WITHDRAWN | RELEASED | CANCELLED | AWARDED | CLOSED_NO_AWARD
    requirement_id: int
    quotation_id: Optional[int]
    actor_id: Optional[int]
    actor_name: Optional[str] = None  # resolved for display — None for system-triggered entries (RELEASED)
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


class CloseoutProposeIn(BaseModel):
    outcome: str = Field(pattern="^(completed|not_pushed_through)$")
    note: Optional[str] = Field(default=None, max_length=500)


class CloseoutRespondIn(BaseModel):
    confirm: bool
    note: Optional[str] = Field(default=None, max_length=500)


class CloseoutProposalOut(BaseModel):
    id: int
    outcome: str  # completed | not_pushed_through
    proposed_by_role: str  # buyer | supplier
    note: Optional[str]
    status: str  # pending | confirmed | rejected | withdrawn
    response_note: Optional[str]
    created_at: datetime
    responded_at: Optional[datetime]


class CloseoutOut(BaseModel):
    requirement_id: int
    # open: awarded, nothing proposed yet (or the last claim was rejected/withdrawn)
    # pending: one party proposed, waiting on the other
    # completed | not_pushed_through: confirmed by both — final
    state: str
    viewer_role: str  # buyer | supplier | admin
    pending: Optional[CloseoutProposalOut] = None
    awaiting_viewer: bool = False
    final: Optional[CloseoutProposalOut] = None
    history: List[CloseoutProposalOut] = []


class OrderUpdateOut(BaseModel):
    status: str
    actor_role: str  # buyer | supplier | system
    note: Optional[str]
    created_at: datetime


class FulfillmentOut(BaseModel):
    """Order status of an awarded requirement (fulfillment_service)."""
    requirement_id: int
    # awarded | delivered (marked completed, awaiting the buyer) | completed | not_pushed_through | unconfirmed
    status: str
    viewer_role: str  # buyer | supplier | admin
    # seller_update | buyer_confirm | None (finished, or waiting on a "did not push through" answer)
    next_action: Optional[str] = None
    next_action_by: Optional[str] = None  # buyer | supplier
    next_status: Optional[str] = None  # the supplier's next step
    auto_confirm_at: Optional[datetime] = None  # while delivered
    auto_confirmed: bool = False
    timeline: List[OrderUpdateOut] = []
    closeout: Optional[CloseoutOut] = None  # "did not push through" proposals


class FulfillmentUpdateIn(BaseModel):
    status: str
    note: Optional[str] = Field(default=None, max_length=500)


class FulfillmentConfirmIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class DocumentRequestCreate(BaseModel):
    document_label: str = Field(min_length=2, max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)


class DocumentRequestOut(BaseModel):
    id: int
    requirement_id: int
    quotation_id: int
    document_label: str
    note: Optional[str]
    status: str  # pending | submitted | cancelled
    filename: Optional[str]
    response_note: Optional[str]
    created_at: datetime
    submitted_at: Optional[datetime]


# ---------- "My Requirements" tracking page ----------

class MyRequirementOut(BaseModel):
    """Lighter-weight than RequirementOut — the owner's own list view
    doesn't need poster info (it's always them) or a match note."""
    id: int
    ref_code: str
    title: str
    category: str
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    scope: str = ""
    specifications: List[SpecRow] = []
    quantity: str = ""
    required_documents: List[str] = []
    status: str  # open | closed | cancelled | award_pending | awarded | closed_no_award
    city: str
    price_min: Optional[float]
    price_max: Optional[float]
    quotations_count: int
    closes_at: datetime
    released_at: Optional[datetime]
    awarded_quotation_id: Optional[int] = None
    award_response_deadline: Optional[datetime] = None
    created_at: datetime
    fulfillment_status: Optional[str] = None  # once awarded — see FulfillmentOut.status


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
    outcome: str  # sealed | released | award_pending | awarded | not_awarded | withdrawn | voided
    # "What happens next" on My Quotations:
    award_response_deadline: Optional[datetime] = None  # while this quotation's award is pending
    thread_id: Optional[int] = None  # the award conversation, once awarded
    # Close-out once awarded: open | pending | completed | not_pushed_through
    closeout_state: Optional[str] = None
    closeout_awaiting_me: bool = False  # the buyer proposed it; this seller has to confirm
    # Order status once awarded (fulfillment_service) — see FulfillmentOut.status
    fulfillment_status: Optional[str] = None
    total_price: Optional[float]
    line_items: List[LineItem] = []
    delivery_lead_time: Optional[str]
    payment_terms: Optional[str]
    validity_period: Optional[str]
    notes: str
    over_budget_reason: Optional[str] = None
    spec_responses: List[SpecResponseOut] = []
    submitted_at: datetime
    integrity_status: Optional[str]
    attachments: List[AttachmentOut] = []

    requirement_id: int
    requirement_ref_code: str
    requirement_title: str
    requirement_location: str
    requirement_status: str  # open | closed | cancelled | award_pending | awarded | closed_no_award
    closes_at: datetime
    released_at: Optional[datetime]
    poster: PosterOut