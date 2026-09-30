from pydantic import BaseModel, Field
from typing import Literal, Optional

# Admin isn't a choice here — admin accounts are is_admin, never self-registered.
AccountRole = Literal["buyer", "seller"]


class UserCreate(BaseModel):
    business_name: str = Field(min_length=2, max_length=120)
    mobile_number: str = Field(min_length=7, max_length=20)
    # A lightweight shape check, not full RFC validation — good enough to
    # catch a typo'd address without pulling in an extra dependency.
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)
    role: AccountRole


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