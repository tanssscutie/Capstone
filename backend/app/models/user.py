from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlalchemy import Text
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    # Registration (login credentials)
    business_name: str  # display name shown at registration
    # Both optional: a Google sign-up has neither until it completes its
    # profile (see auth_service.complete_profile) — a mobile+password sign-up
    # has both from the start and never touches google_id.
    mobile_number: Optional[str] = Field(default=None, index=True, unique=True)
    hashed_password: Optional[str] = None
    google_id: Optional[str] = Field(default=None, index=True, unique=True)
    # Required at mobile+password registration (see UserCreate), filled in by
    # Google sign-up automatically. Unique so "log in with mobile or email"
    # (auth_service.authenticate_user_and_get_token) never has to guess which
    # account a shared address belongs to.
    email: Optional[str] = Field(default=None, index=True, unique=True)
    is_active: bool = True
    is_admin: bool = False
    # Account type, fixed at sign-up: a "buyer" posts requirements and awards
    # them, a "seller" (supplier) browses open requirements and submits
    # quotations — never both on one account. Admins are is_admin accounts and
    # leave this null. Also null for a brand-new Google sign-up until it picks
    # one on the complete-profile screen (see auth_service.complete_profile).
    # Added after launch, so existing databases get the column from
    # database._migrate_user_role at startup rather than from create_all.
    role: Optional[str] = Field(default=None, max_length=10)  # buyer | seller
    # Seller-only, asked at sign-up (see schemas.auth.YearsInBusiness).
    # Added after launch — existing databases get the column from
    # database._migrate_user_years_in_business at startup.
    years_in_business: Optional[str] = Field(default=None, max_length=20)
    # Seller-only: the items of their industry_category they offer, JSON list
    # of {"code": str, "other_text": str | null} (codes from app/core/categories.py).
    # Added after launch — existing databases get the column from
    # database._migrate_user_offered_items at startup.
    offered_items: Optional[str] = Field(default=None, sa_type=Text)

    # Business onboarding (filled in during the onboarding step, separate
    # from registration — see BusinessDocument for the supporting files)
    registered_name: Optional[str] = None  # exact name as on DTI/SEC certificate
    # Optional public-facing name shown instead of registered_name wherever a
    # business's name appears to someone else (requirement cards, business
    # profile) — e.g. a shorter trading name. Never shown if unset.
    display_name: Optional[str] = None
    business_type: Optional[str] = None
    industry_category: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    contact_person: Optional[str] = None
    contact_mobile: Optional[str] = None  # business contact; may differ from the login number
    # Short public-facing bio shown on the business's profile — optional,
    # written by the business itself.
    business_description: Optional[str] = None
    capabilities: str = ""    # comma-separated free text, used as matching input
    service_areas: str = ""   # comma-separated free text (cities/provinces)
    # Semantic matching (Specific Objective #4) — JSON-encoded embedding
    # vector of category + capabilities + service areas, recomputed whenever
    # those change (see business_service.submit_onboarding). Empty until
    # onboarding is submitted, or if the local embedding model is
    # unavailable — matching_service falls back to closing-time-only
    # ordering either way, same convention as every other AI feature here.
    capability_embedding: str = Field(default="", sa_type=Text)
    onboarding_completed: bool = False
    # Superseded by `role` — kept only because existing databases have this
    # as a NOT NULL column, so the model must keep supplying a value on insert.
    # Nothing reads it anymore except the one-time role backfill.
    signup_intent: str = "BOTH"  # FIND_SUPPLIERS | FIND_WORK | BOTH

    # Notification preferences, editable from Account Settings. "activity" covers
    # everything except direct messages: verification updates, clarification Q&A,
    # award decisions, closing-soon reminders.
    notify_messages: bool = True
    notify_activity: bool = True
    # Also email the important activity alerts (see notification_repository.
    # EMAIL_ALERT_TYPES). Only ever on top of notify_activity, never instead.
    notify_email: bool = True
    # RA 10173 consent: when this account agreed to the Privacy Notice, and to
    # which version of it (app/core/privacy.py). Null = never agreed (accounts
    # from before consent was asked) — they're asked on their next visit.
    privacy_consent_at: Optional[datetime] = None
    privacy_policy_version: Optional[str] = Field(default=None, max_length=20)
    # Moderation (report_service): a suspension lifts itself once the time
    # passes; a ban also sets is_active=False. Enforced on every request —
    # see app/core/account_access.py.
    suspended_until: Optional[datetime] = None
    banned_at: Optional[datetime] = None

    # Verification (derived from BusinessDocument cross-validation + admin review)
    verification_status: str = "unverified"  # unverified | pending | submitted | under_review | verified | rejected
    submitted_at: Optional[datetime] = None
    verification_date: Optional[datetime] = None
    recheck_date: Optional[datetime] = None
    is_verified: bool = False   # kept in sync with verification_status == "verified"
    tier: int = 1               # trust tier 1-3, computed from verified docs + awards

    created_at: datetime = Field(default_factory=now_ph)
    @property
    def needs_privacy_consent(self) -> bool:
        """Read by UserRead (GET /auth/me) so the frontend can send the
        account to complete-profile — see app/core/privacy.py."""
        from app.core.privacy import needs_privacy_consent

        return needs_privacy_consent(self)
