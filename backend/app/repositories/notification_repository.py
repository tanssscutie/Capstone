from typing import List, Optional

from sqlmodel import Session, select, func

from app.models.notification import Notification
from app.models.user import User


def create_if_allowed(
    session: Session,
    user_id: int,
    type_: str,
    category: str,
    title: str,
    detail: str,
    urgent: bool = False,
    related_requirement_id: Optional[int] = None,
) -> Optional[Notification]:
    """Same as create(), but checks the recipient's notification preferences
    first and silently skips creation if they've turned that category off.
    category is "messages" (direct messages) or "activity" (everything else)."""
    user = session.get(User, user_id)
    if user is not None:
        if category == "messages" and not user.notify_messages:
            return None
        if category == "activity" and not user.notify_activity:
            return None
    return create(session, user_id, type_, title, detail, urgent, related_requirement_id)


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
