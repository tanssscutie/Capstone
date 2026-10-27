import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("trustlink.email")


class EmailSendError(Exception):
    """The SMTP server refused or was unreachable — callers decide whether
    that's fatal (resend) or not (register, where the user can just resend)."""


def send_email(to: str, subject: str, body: str) -> None:
    if not settings.SMTP_HOST:
        # Dev mode: no SMTP configured, so surface the message where the
        # developer can read it instead of silently dropping it.
        logger.warning("SMTP not configured — email to %s not sent.\nSubject: %s\n%s", to, subject, body)
        return

    sender = settings.SMTP_FROM or settings.SMTP_USERNAME
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        # 30s, not 10: Gmail's handshake + login + send can take ~8s on a slow
        # connection, and a timeout here is swallowed at sign-up (the user just
        # never receives a code), so err on the side of waiting.
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as smtp:
            smtp.starttls()
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        logger.exception("Failed to send email to %s", to)
        raise EmailSendError(str(exc)) from exc


def send_otp_email(to: str, code: str) -> None:
    send_email(
        to,
        f"Your {settings.PROJECT_NAME} verification code",
        f"Your {settings.PROJECT_NAME} verification code is: {code}\n\n"
        f"It expires in {settings.OTP_EXPIRE_MINUTES} minutes. "
        "If you didn't create an account, you can ignore this email.",
    )


def send_password_change_otp_email(to: str, code: str) -> None:
    send_email(
        to,
        f"Your {settings.PROJECT_NAME} password change code",
        f"Your {settings.PROJECT_NAME} password change code is: {code}\n\n"
        f"It expires in {settings.OTP_EXPIRE_MINUTES} minutes. "
        "If you didn't ask to change your password, ignore this email and "
        "consider changing your password — someone may have access to your account.",
    )


def send_password_reset_otp_email(to: str, code: str) -> None:
    send_email(
        to,
        f"Your {settings.PROJECT_NAME} password reset code",
        f"Your {settings.PROJECT_NAME} password reset code is: {code}\n\n"
        f"It expires in {settings.OTP_EXPIRE_MINUTES} minutes. "
        "If you didn't ask to reset your password, you can safely ignore this email — "
        "your password has not been changed.",
    )


# Alert emails go out on a small worker pool: an SMTP round-trip can take
# several seconds (see send_email's timeout), and the action that raised the
# alert — an award, a new posting — must not wait on it, let alone fail.
_alert_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="alert-email")


def _send_quietly(to: str, subject: str, body: str) -> None:
    try:
        send_email(to, subject, body)
    except Exception:
        logger.exception("Alert email to %s failed (the in-app alert still exists)", to)


def send_alert_email(to: str, title: str, detail: str, related_requirement_id: Optional[int] = None) -> None:
    """Queues the email copy of an in-app alert and returns immediately."""
    link = (f"{settings.FRONTEND_URL}/requirement?id={related_requirement_id}"
            if related_requirement_id else f"{settings.FRONTEND_URL}/alerts")
    body = (
        f"{title}\n\n{detail}\n\n"
        f"Open it on {settings.PROJECT_NAME}: {link}\n\n"
        "—\n"
        f"You're getting this because email alerts are on in your {settings.PROJECT_NAME} "
        "Account Settings → Notifications. Turn off \"Email\" there to stop them."
    )
    _alert_pool.submit(_send_quietly, to, f"[{settings.PROJECT_NAME}] {title}", body)
