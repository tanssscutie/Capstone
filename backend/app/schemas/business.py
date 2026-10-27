from datetime import date, datetime
from typing import Literal, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.categories import CATEGORIES


class OfferedItem(BaseModel):
    """One item a seller offers — a code from app/core/categories.py, plus
    the seller's own wording when the code is "other"."""
    code: str = Field(min_length=1, max_length=60)
    other_text: Optional[str] = Field(default=None, max_length=100)


class OnboardingSubmit(BaseModel):
    registered_name: str = Field(min_length=2, max_length=200)
    # Optional public-facing trading name — shown instead of registered_name
    # wherever a business's name appears to someone else. Blank/omitted means
    # registered_name is used everywhere, same as before this field existed.
    display_name: Optional[str] = Field(default=None, max_length=200)
    business_type: str = Field(min_length=2, max_length=100)
    # Optional: it's asked at registration, so onboarding only sends it when
    # the business changes it ("Palitan") or never had one (accounts from
    # before registration asked, Google sign-ups). Omitted keeps what's on
    # file — see business_service.submit_onboarding.
    industry_category: Optional[str] = None
    city: str = Field(min_length=2, max_length=100)
    province: str = Field(min_length=2, max_length=100)
    contact_person: str = Field(min_length=2, max_length=120)
    contact_mobile: str = Field(min_length=7, max_length=20)
    # Required (3-8 capabilities, 1+ service area) for sellers only — they
    # drive matching sellers to requirements, which a buyer never needs. See
    # business_service.submit_onboarding.
    capabilities: List[str] = Field(default=[], max_length=8)
    service_areas: List[str] = []
    # Optional public-facing bio, typed by the business — blank is fine.
    business_description: Optional[str] = Field(default=None, max_length=500)
    # Seller-only, at least one — validated against the category in
    # business_service.submit_onboarding. Ignored for a buyer.
    offered_items: List[OfferedItem] = []

    @field_validator("industry_category")
    @classmethod
    def _check_category(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if value not in CATEGORIES:
            raise ValueError(f"industry_category must be one of: {', '.join(CATEGORIES)}")
        return value


class DocumentUploadOut(BaseModel):
    id: int
    doc_type: str
    declared_owner_name: str
    declared_business_name: str
    declared_id_number: str
    declared_expiry_date: Optional[date]
    validation_status: str
    validation_notes: str
    uploaded_at: datetime


class DocumentExtractionOut(BaseModel):
    """Assistive Document Extraction's result — a suggestion only. None means
    nothing was confidently found (no key configured, unreadable image, or
    the model genuinely couldn't find it); the frontend leaves the field as
    the business typed it either way. See document_extraction_service.py."""
    id_number: Optional[str] = None


class VerificationStatusOut(BaseModel):
    verification_status: str
    is_verified: bool
    tier: int
    submitted_at: Optional[datetime] = None
    verification_date: Optional[datetime]
    recheck_date: Optional[datetime]
    onboarding_completed: bool
    documents: List[DocumentUploadOut]

    # True once the business has formally submitted — the point after which
    # they're waiting on us rather than us waiting on them.
    has_submitted: bool = False
    # Document types still needed before they can submit.
    missing_documents: List[str] = []

    # Echoed back so a returning business can resume onboarding without
    # relying on anything cached in the browser — business_type in
    # particular decides whether DTI or SEC registration is asked for.
    registered_name: Optional[str] = None
    display_name: Optional[str] = None
    business_type: Optional[str] = None
    industry_category: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    contact_person: Optional[str] = None
    contact_mobile: Optional[str] = None
    capabilities: List[str] = []
    service_areas: List[str] = []
    business_description: Optional[str] = None
    offered_items: List[OfferedItem] = []


class PublicBusinessProfileOut(BaseModel):
    """Authenticated profile with safe verification metadata and aggregates.

    Contact details are shown to verified viewers, the owner and administrators.
    Document contents, identifiers, credentials and quotation content are
    never included. Public supplier counts exclude sealed activity.
    """
    id: int
    role: Optional[str] = None  # buyer | seller
    registered_name: Optional[str]
    display_name: Optional[str]
    business_type: Optional[str]
    industry_category: Optional[str]
    city: Optional[str]
    province: Optional[str]
    business_description: Optional[str] = None
    capabilities: List[str] = []
    service_areas: List[str] = []
    is_verified: bool
    tier: int
    verification_date: Optional[datetime]
    member_since_year: int
    requirements_posted_count: int
    requirements_awarded_count: int
    member_since: datetime
    verification_status: str
    registration_document_types: List[str] = []
    quotations_submitted_count: int
    quotations_awarded_count: int
    requirements_cancelled_count: int
    quotations_withdrawn_count: int
    # Confirmed by both parties (closeout_service), as buyer or as supplier.
    transactions_completed_count: int = 0
    transactions_not_pushed_through_count: int = 0
    includes_sealed_activity: bool = False
    contact_details_visible: bool = False
    contact_person: Optional[str] = None
    contact_mobile: Optional[str] = None


class AdminReviewAction(BaseModel):
    approve: bool
    notes: Optional[str] = Field(default=None, max_length=500)


class AdminFlaggedBusinessOut(BaseModel):
    user_id: int
    role: Optional[str] = None  # buyer | seller
    business_name: str
    mobile_number: str
    registered_name: Optional[str]
    business_type: Optional[str]
    industry_category: Optional[str]
    city: Optional[str]
    province: Optional[str]
    contact_person: Optional[str]
    contact_mobile: Optional[str]
    submitted_at: Optional[datetime]
    documents: List[DocumentUploadOut]


class AdminBusinessOut(BaseModel):
    """One row of the admin's full business roster — every registered
    business, not just the ones currently waiting on review."""
    user_id: int
    role: Optional[str] = None  # buyer | seller
    business_name: str
    mobile_number: str
    registered_name: Optional[str]
    business_type: Optional[str]
    industry_category: Optional[str]
    city: Optional[str]
    province: Optional[str]
    onboarding_completed: bool
    verification_status: str
    is_verified: bool
    tier: int
    submitted_at: Optional[datetime]
    created_at: datetime
    documents: List[DocumentUploadOut] = []
    suspended_until: Optional[datetime] = None
    banned_at: Optional[datetime] = None


class DashboardStatsOut(BaseModel):
    requirements_posted_count: int
    quotations_submitted_count: int
    requirements_awarded_count: int  # times this business won as a supplier
    member_since_year: int
    profile_completion_pct: int
    tier_hint: str


class RegistrationsByDay(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class PortfolioItemOut(BaseModel):
    """One portfolio photo; the image itself is GET /business/{id}/portfolio/{item}/image."""
    id: int
    caption: str
    item_code: Optional[str]
    item_name: Optional[str]
    created_at: datetime


class ReportCreate(BaseModel):
    reason: Literal["FAKE_BUSINESS", "FRAUD", "NOT_HONORED", "MISLEADING", "SPAM", "MANIPULATION", "ABUSIVE", "OTHER"]
    details: str = Field(min_length=10, max_length=1000)
    related_requirement_id: Optional[int] = None


class ReportReview(BaseModel):
    # dismiss = no violation. Anything else resolves the report AND acts on the
    # reported account (moderation_service) — so it needs a reason.
    action: Literal["dismiss", "warn", "suspend_7", "suspend_30", "ban"]
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("notes")
    @classmethod
    def _strip(cls, v):
        return v.strip() if v else v

    @model_validator(mode="after")
    def _needs_reason(self):
        if self.action != "dismiss" and (not self.notes or len(self.notes) < 3):
            raise ValueError("Write the reason the business will be told")
        return self


class LiftRestriction(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=1000)


class ModerationActionOut(BaseModel):
    action: str  # warn | suspend | ban | lift
    reason: str
    until: Optional[datetime]
    created_at: datetime


class MyReportOut(BaseModel):
    """A report the signed-in business filed. No admin notes — those are internal."""
    id: int
    reported_name: str
    reason_label: str
    status: str  # open | resolved | dismissed
    created_at: datetime
    reviewed_at: Optional[datetime]


class BusinessSearchOut(BaseModel):
    id: int
    name: str
    role: Optional[str]
    category: Optional[str]
    city: Optional[str]


class ReportSuggestionOut(BusinessSearchOut):
    relation: str            # "supplier" (quoted on your requirement) | "buyer" (you quoted on theirs)
    context: str             # "REQ-1 · Tarpaulin"
    dealt_at: Optional[datetime]


class AdminReportOut(BaseModel):
    id: int
    reason: str
    reason_label: str
    details: str
    status: str  # open | resolved | dismissed
    admin_notes: Optional[str]
    created_at: datetime
    reviewed_at: Optional[datetime]
    reporter_id: int
    reporter_name: str
    reported_id: int
    reported_name: str
    reported_role: Optional[str]
    reported_verification_status: Optional[str]
    # Open reports against the same business, this one included.
    reported_open_reports: int
    related_requirement_id: Optional[int]
    related_requirement_ref: Optional[str]
    reported_suspended_until: Optional[datetime] = None
    reported_banned: bool = False
    reported_history: List[ModerationActionOut] = []


class AdminStatsOut(BaseModel):
    total_businesses: int
    total_buyers: int
    total_sellers: int
    verified_businesses: int
    pending_review_count: int
    open_reports_count: int = 0
    total_requirements: int
    open_requirements: int
    total_quotations: int
    registrations_last_7_days: List[RegistrationsByDay]
