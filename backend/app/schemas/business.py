from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class OnboardingSubmit(BaseModel):
    registered_name: str = Field(min_length=2, max_length=200)
    business_type: str = Field(min_length=2, max_length=100)
    industry_category: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=2, max_length=100)
    province: str = Field(min_length=2, max_length=100)
    contact_person: str = Field(min_length=2, max_length=120)
    contact_mobile: str = Field(min_length=7, max_length=20)
    capabilities: List[str] = Field(min_length=3, max_length=8)
    service_areas: List[str] = Field(min_length=1)
    signup_intent: Literal["FIND_SUPPLIERS", "FIND_WORK", "BOTH"] = "BOTH"


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
    business_type: Optional[str] = None
    industry_category: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    contact_person: Optional[str] = None
    contact_mobile: Optional[str] = None
    capabilities: List[str] = []
    service_areas: List[str] = []
    signup_intent: str = "BOTH"


class PublicBusinessProfileOut(BaseModel):
    """A business's public-facing profile — what any other logged-in business
    can see about them (e.g. "View buyer profile" from a requirement, or a
    respondent's card once quotations release). Deliberately excludes the
    login mobile number, contact person/mobile, and everything document- or
    admin-facing — those stay private to the business itself and to admin."""
    id: int
    registered_name: Optional[str]
    business_type: Optional[str]
    industry_category: Optional[str]
    city: Optional[str]
    province: Optional[str]
    capabilities: List[str] = []
    service_areas: List[str] = []
    is_verified: bool
    tier: int
    verification_date: Optional[datetime]
    member_since_year: int
    requirements_posted_count: int
    requirements_awarded_count: int


class AdminReviewAction(BaseModel):
    approve: bool
    notes: Optional[str] = Field(default=None, max_length=500)


class AdminFlaggedBusinessOut(BaseModel):
    user_id: int
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


class AdminStatsOut(BaseModel):
    total_businesses: int
    verified_businesses: int
    pending_review_count: int
    total_requirements: int
    open_requirements: int
    total_quotations: int
    registrations_last_7_days: List[RegistrationsByDay]