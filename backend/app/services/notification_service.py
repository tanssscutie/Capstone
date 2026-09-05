from typing import List

from sqlmodel import Session

from app.core.database import engine
from app.models.notification import Notification
from app.repositories import notification_repository as repo
from app.schemas.notification import NotificationOut


class NotificationNotFound(Exception):
    pass


class NotOwner(Exception):
    pass


def _to_out(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id, type=n.type, title=n.title, detail=n.detail, urgent=n.urgent, read=n.read, created_at=n.created_at,
    )


class NotificationService:
    def list_for_user(self, user_id: int) -> List[NotificationOut]:
        with Session(engine) as session:
            return [_to_out(n) for n in repo.list_for_user(session, user_id)]

    def mark_read(self, user_id: int, notification_id: int) -> None:
        with Session(engine) as session:
            n = repo.get(session, notification_id)
            if not n:
                raise NotificationNotFound()
            if n.user_id != user_id:
                raise NotOwner()
            repo.mark_read(session, n)

    def mark_all_read(self, user_id: int) -> None:
        with Session(engine) as session:
            repo.mark_all_read(session, user_id)


notification_service = NotificationService()
