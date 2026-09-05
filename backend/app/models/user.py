from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    # Registration (login credentials)
    business_name: str  # display name shown at registration
    mobile_number: str = Field(index=True, unique=True)
    hashed_password: str
    is_active: bool = True
    is_admin: bool = False

    # Business onboarding (filled in during the onboarding step, separate
    # from registration — see BusinessDocument for the supporting files)
    registered_name: Optional[str] = None  # exact name as on DTI/SEC certificate
    business_type: Optional[str] = None
    industry_category: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    contact_person: Optional[str] = None
    contact_mobile: Optional[str] = None  # business contact; may differ from the login number
    capabilities: str = ""    # comma-separated free text, used as matching input
    service_areas: str = ""   # comma-separated free text (cities/provinces)
    onboarding_completed: bool = False
    # What this business said brought them here, from onboarding's first question.
    # Every verified business can post AND quote regardless of this — it's not an
    # account type, just a hint for ordering their own open-requirements feed:
    # FIND_WORK/BOTH get their category/capability matches surfaced first, then
    # everyone (including FIND_SUPPLIERS-only) is ordered by closing time.
    signup_intent: str = "BOTH"  # FIND_SUPPLIERS | FIND_WORK | BOTH

    # Notification preferences, editable from Account Settings. "activity" covers
    # everything except direct messages: verification updates, clarification Q&A,
    # award decisions, closing-soon reminders.
    notify_messages: bool = True
    notify_activity: bool = True

    # Verification (derived from BusinessDocument cross-validation + admin review)
    verification_status: str = "unverified"  # unverified | pending | submitted | under_review | verified | rejected
    submitted_at: Optional[datetime] = None
    verification_date: Optional[datetime] = None
    recheck_date: Optional[datetime] = None
    is_verified: bool = False   # kept in sync with verification_status == "verified"
    tier: int = 1               # trust tier 1-3, computed from verified docs + awards

    created_at: datetime = Field(default_factory=datetime.utcnow)