from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from typing import Literal, Optional

from app.core.categories import CATEGORIES

# Admin isn't a choice here — admin accounts are is_admin, never self-registered.
AccountRole = Literal["buyer", "seller"]

# Seller-only, picked at sign-up. Stored as these codes; the labels
# ("Less than 1 year", "1–3 years", ...) live in the frontend.
YearsInBusiness = Literal["LESS_THAN_1", "1_TO_3", "4_TO_6", "7_PLUS"]


class UserCreate(BaseModel):
    business_name: str = Field(min_length=2, max_length=120)
    mobile_number: str = Field(min_length=7, max_length=20)
    # A lightweight shape check, not full RFC validation — good enough to
    # catch a typo'd address without pulling in an extra dependency.
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)
    role: AccountRole
    # A buyer's primary procurement category, or a seller's business
    # category — same list either way, and it seeds User.industry_category
    # so onboarding starts with it already filled in.
    industry_category: str
    years_in_business: Optional[YearsInBusiness] = None
    # RA 10173: the box under the form. Must be true — there's no account
    # without agreeing to the Privacy Notice.
    accept_privacy: bool = False

    @model_validator(mode="after")
    def _check_privacy(self):
        if not self.accept_privacy:
            raise ValueError("You need to agree to the Privacy Notice to create an account")
        return self

    @model_validator(mode="after")
    def _check_role_fields(self):
        if self.industry_category not in CATEGORIES:
            raise ValueError(f"industry_category must be one of: {', '.join(CATEGORIES)}")
        if self.role == "seller" and self.years_in_business is None:
            raise ValueError("years_in_business is required for a seller account")
        if self.role == "buyer":
            # Not asked of buyers; never store a stray value sent anyway.
            self.years_in_business = None
        return self


class UserRead(BaseModel):
    id: int
    business_name: str
    # Null until a Google sign-up completes its profile (see /auth/complete-profile).
    mobile_number: Optional[str] = None
    email: Optional[str] = None
    is_admin: bool = False
    # buyer | seller — null for admins and for a Google sign-up that hasn't
    # completed its profile yet.
    role: Optional[str] = None
    notify_messages: bool = True
    notify_activity: bool = True
    notify_email: bool = True
    # The frontend sends an account here (complete-profile) while it's true.
    needs_privacy_consent: bool = False
    privacy_consent_at: Optional[datetime] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    sub: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=8, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)
    # 6-digit code emailed by POST /auth/password/request-otp.
    code: str = Field(pattern=r"^\d{6}$")


class MobileNumberChange(BaseModel):
    new_mobile_number: str = Field(min_length=7, max_length=20)
    current_password: str = Field(min_length=8, max_length=72)


class NotificationPreferences(BaseModel):
    notify_messages: bool
    notify_activity: bool
    # Defaulted so a client that predates the email toggle doesn't switch it off.
    notify_email: bool = True


class VerifyEmail(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    code: str = Field(pattern=r"^\d{6}$")


class ResendOtp(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class ForgotPassword(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class ResetPassword(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    new_password: str = Field(min_length=8, max_length=72)
    # 6-digit code emailed by POST /auth/password/forgot.
    code: str = Field(pattern=r"^\d{6}$")


class CompleteProfile(BaseModel):
    """First-time mobile number and account type for a Google sign-up — see
    auth_service.complete_profile. Not for changing an existing number;
    that's PUT /auth/mobile-number (password-verified). Either field may be
    omitted if the account already has it (e.g. an older Google account that
    has a number but predates buyer/seller accounts)."""
    mobile_number: Optional[str] = Field(default=None, min_length=7, max_length=20)
    role: Optional[AccountRole] = None
    # Required (true) while the account hasn't agreed to the current Privacy Notice.
    accept_privacy: Optional[bool] = None