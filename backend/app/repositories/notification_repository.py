from typing import List, Optional

from sqlmodel import Session, select, func

from app.models.notification import Notification
from app.models.user import User

# The alerts worth an email: decisions and new opportunities someone would
# act on. Chat messages, Q&A, closing reminders and tier changes stay in-app
# only, so the inbox isn't flooded.
EMAIL_ALERT_TYPES = frozenset({
    "DECISION",                # Notice of Award, award accepted/declined, not selected, document requests, close-out
    "REQUIREMENT_MATCH",       # new requirement in the seller's category
    "REQUIREMENT_RELEASED",    # the buyer's quotations are ready to review
    "REQUIREMENT_CANCELLED",
    "CLOSED_NO_AWARD",
    "VERIFICATION",            # approved / rejected
    "DOCUMENT_FLAGGED",
})


def create_if_allowed(
    session: Session,
    user_id: int,
    type_: str,
    category: str,
    title: str,
    detail: str,
    urgent: bool = False,
    related_requirement_id: Optional[int] = None,
    always: bool = False,
) -> Optional[Notification]:
    """Same as create(), but checks the recipient's notification preferences
    first and silently skips creation if they've turned that category off.
    category is "messages" (direct messages) or "activity" (everything else).

    An alert in EMAIL_ALERT_TYPES is also emailed — after it's saved, in the
    background — when the recipient has an email address and email alerts on.

    always=True skips the preferences, in-app and email alike: notices about
    the account's own standing (withdrawal strikes) must reach the user."""
    user = session.get(User, user_id)
    if user is not None and not always:
        if category == "messages" and not user.notify_messages:
            return None
        if category == "activity" and not user.notify_activity:
            return None
    notification = create(session, user_id, type_, title, detail, urgent, related_requirement_id)
    if user is not None and user.email and (user.notify_email or always) and type_ in EMAIL_ALERT_TYPES:
        from app.services import email_service  # local: keeps the repository layer import-light

        email_service.send_alert_email(user.email, title, detail, related_requirement_id)
    return notification


def create(
    session: Session,
    user_id: int,
    type_: str,
    title: str,
    detail: str,
    urgent: bool = False,
    related_requirement_id: Optional[int] = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type=type_,
        title=title,
        detail=detail,
        urgent=urgent,
        related_requirement_id=related_requirement_id,
    )
    session.add(notification)
    session.commit()
    session.refresh(notification)
    return notification


def list_for_user(session: Session, user_id: int) -> List[Notification]:
    statement = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
    )
    return list(session.exec(statement).all())


def get(session: Session, notification_id: int) -> Optional[Notification]:
    return session.get(Notification, notification_id)


def mark_read(session: Session, notification: Notification) -> Notification:
    notification.read = True
    session.add(notification)
    session.commit()
    session.refresh(notification)
    return notification


def mark_all_read(session: Session, user_id: int) -> None:
    statement = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .where(Notification.read == False)  # noqa: E712
    )
    for notification in session.exec(statement).all():
        notification.read = True
        session.add(notification)
    session.commit()


def exists_for_requirement(session: Session, user_id: int, type_: str, related_requirement_id: int) -> bool:
    statement = (
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id)
        .where(Notification.type == type_)
        .where(Notification.related_requirement_id == related_requirement_id)
    )
    return session.exec(statement).one() > 0
