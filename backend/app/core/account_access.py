# Whether an account may use TrustLink right now — checked on every request
# (security.get_current_user) and at every sign-in path (password login,
# email verification, Google), so a ban or suspension takes effect at once,
# even for someone already signed in.
from typing import Optional

from app.core.clock import now_ph


def blocked_reason(user) -> Optional[str]:
    """None when the account may sign in; otherwise the message to show."""
    if user.banned_at is not None:
        return "This account has been banned for violating TrustLink's rules. Contact support@trustlink.ph if you think this is a mistake."
    if not user.is_active:
        return "This account has been deactivated. Contact support@trustlink.ph for help."
    if user.suspended_until is not None and user.suspended_until > now_ph():
        until = user.suspended_until.strftime("%b %d, %Y %I:%M %p").replace(" 0", " ")
        return f"This account is suspended until {until}. Contact support@trustlink.ph if you think this is a mistake."
    return None
