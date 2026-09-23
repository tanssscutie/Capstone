from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select

from app.core.config import settings
from app.core.database import get_session
from app.services.auth_service import auth_service, GoogleAuthError
from app.schemas.auth import (
    UserCreate,
    UserRead,
    Token,
    PasswordChange,
    MobileNumberChange,
    NotificationPreferences,
    CompleteProfile,
    VerifyEmail,
    ResendOtp,
    ForgotPassword,
    ResetPassword,
)
from app.core.security import get_current_user

router = APIRouter()


@router.post("/register", response_model=UserRead)
def register(user_in: UserCreate):
    user = auth_service.create_user(user_in)
    return user


@router.post("/verify-email", response_model=Token)
def verify_email(data: VerifyEmail):
    """Completes sign-up: a correct code clears the pending check and
    returns a login token, so the user goes straight to home."""
    return auth_service.verify_email(data.email, data.code)


@router.post("/resend-otp")
def resend_otp(data: ResendOtp):
    auth_service.resend_otp(data.email)
    return {"detail": "If that account is awaiting verification, a new code has been sent."}


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    token = auth_service.authenticate_user_and_get_token(form_data.username, form_data.password)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return token


@router.get("/me", response_model=UserRead)
def read_me(current_user=Depends(get_current_user)):
    return current_user


@router.get("/google/login")
def google_login():
    """Full-page redirect (not an API call) to Google's consent screen."""
    return RedirectResponse(auth_service.build_google_auth_url())


@router.get("/google/callback")
async def google_callback(code: str):
    """Google redirects the browser here after consent. We exchange the code,
    find-or-create the account, then hand off to the frontend's own callback
    route with our JWT in the URL — the frontend stores it exactly like a
    normal login and decides where to go next (home vs. complete-profile)."""
    try:
        token, needs_mobile_number = await auth_service.handle_google_callback(code)
    except GoogleAuthError as exc:
        error_params = urlencode({"googleError": str(exc)})
        return RedirectResponse(f"{settings.FRONTEND_URL}/login?{error_params}")
    params = urlencode({"token": token.access_token, "needsMobile": str(needs_mobile_number).lower()})
    return RedirectResponse(f"{settings.FRONTEND_URL}/auth-callback?{params}")


@router.post("/complete-profile", response_model=UserRead)
def complete_profile(data: CompleteProfile, current_user=Depends(get_current_user)):
    return auth_service.complete_profile(current_user.id, data.mobile_number)


@router.post("/password/request-otp")
def request_password_change_otp(current_user=Depends(get_current_user)):
    """Step 1 of a password change: emails a 6-digit code to the account's
    address. PUT /auth/password then requires it."""
    auth_service.request_password_change_otp(current_user.id)
    return {"detail": "We sent a code to your email."}


@router.put("/password")
def change_password(data: PasswordChange, current_user=Depends(get_current_user)):
    auth_service.change_password(current_user.id, data)
    return {"detail": "Password updated"}


@router.post("/password/forgot")
def forgot_password(data: ForgotPassword):
    """Step 1 of a signed-out password reset: emails a 6-digit code if the
    address belongs to a mobile+password account. Always answers the same
    way regardless — see auth_service.request_password_reset_otp."""
    auth_service.request_password_reset_otp(data.email)
    return {"detail": "If that email has an account, we sent a reset code to it."}


@router.post("/password/reset")
def reset_password(data: ResetPassword):
    """Step 2: the code from /password/forgot lets a signed-out caller set a
    new password directly, no current password needed."""
    auth_service.reset_password(data.email, data.code, data.new_password)
    return {"detail": "Password updated. You can now log in."}


@router.put("/mobile-number", response_model=UserRead)
def change_mobile_number(data: MobileNumberChange, current_user=Depends(get_current_user)):
    return auth_service.change_mobile_number(current_user.id, data)


@router.put("/notification-preferences", response_model=UserRead)
def update_notification_preferences(data: NotificationPreferences, current_user=Depends(get_current_user)):
    return auth_service.update_notification_preferences(current_user.id, data)
