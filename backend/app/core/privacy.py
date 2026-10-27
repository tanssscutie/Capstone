# Data Privacy Act of 2012 (RA 10173) consent.
#
# The notice itself lives in the frontend (features/legal/PrivacyNotice.tsx);
# this is the version a user agreed to, stored on their account with the time
# (User.privacy_consent_at / privacy_policy_version). Bump it whenever the
# notice changes in substance — accounts that agreed to an older version are
# then asked again on their next visit (needs_privacy_consent).
PRIVACY_POLICY_VERSION = "2026-10-28"


def needs_privacy_consent(user) -> bool:
    """True for a business account that hasn't agreed to the current notice.
    Admin accounts are run by the platform itself and aren't asked."""
    if user.is_admin:
        return False
    return user.privacy_consent_at is None or user.privacy_policy_version != PRIVACY_POLICY_VERSION
