from typing import List

from sqlmodel import Session

from app.core.database import engine
from app.models.message_thread import MessageThread
from app.models.user import User
from app.repositories import message_repository as repo
from app.repositories import requirement_repository as req_repo
from app.repositories import notification_repository as notif_repo
from app.schemas.message import MessageThreadOut, MessageOut


class ThreadNotFound(Exception):
    pass


class NotParticipant(Exception):
    pass


class MessageService:
    def _to_thread_out(self, session: Session, thread: MessageThread, viewer_id: int) -> MessageThreadOut:
        req = req_repo.get_requirement(session, thread.requirement_id)
        counterparty_id = thread.business_id if viewer_id == thread.buyer_id else thread.buyer_id
        counterparty = session.get(User, counterparty_id)
        latest = repo.latest_message(session, thread.id)
        return MessageThreadOut(
            id=thread.id,
            requirement_id=thread.requirement_id,
            requirement_ref_code=req.ref_code if req else "",
            awarded_quotation_id=(req.awarded_quotation_id if req and req.awarded_quotation_id else 0),
            counterparty_id=counterparty_id,
            counterparty_name=counterparty.business_name if counterparty else "—",
            last_message_preview=latest.body if latest else "",
            last_message_at=latest.created_at if latest else None,
            unread=repo.has_unread(session, thread.id, viewer_id),
        )

    def list_threads(self, user_id: int) -> List[MessageThreadOut]:
        with Session(engine) as session:
            threads = repo.list_threads_for_user(session, user_id)
            out = [self._to_thread_out(session, t, user_id) for t in threads]
            out.sort(key=lambda t: t.last_message_at or t.id, reverse=True)  # type: ignore[arg-type]
            return out

    def _require_participant(self, session: Session, thread_id: int, user_id: int) -> MessageThread:
        thread = repo.get_thread(session, thread_id)
        if not thread:
            raise ThreadNotFound()
        if user_id not in (thread.buyer_id, thread.business_id):
            raise NotParticipant()
        return thread

    def list_messages(self, thread_id: int, user_id: int) -> List[MessageOut]:
        with Session(engine) as session:
            self._require_participant(session, thread_id, user_id)
            messages = repo.list_messages(session, thread_id)
            return [
                MessageOut(id=m.id, thread_id=m.thread_id, sender_id=m.sender_id, body=m.body, created_at=m.created_at, read=m.read)
                for m in messages
            ]

    def send_message(self, thread_id: int, user_id: int, body: str) -> MessageOut:
        with Session(engine) as session:
            thread = self._require_participant(session, thread_id, user_id)
            m = repo.create_message(session, thread_id, user_id, body.strip())

            recipient_id = thread.business_id if user_id == thread.buyer_id else thread.buyer_id
            sender = session.get(User, user_id)
            req = req_repo.get_requirement(session, thread.requirement_id)
            preview = m.body if len(m.body) <= 80 else f"{m.body[:80]}…"
            notif_repo.create_if_allowed(
                session,
                user_id=recipient_id,
                type_="MESSAGE_RECEIVED",
                category="messages",
                title=f"New message from {sender.business_name if sender else 'a business'}",
                detail=f"{req.ref_code if req else ''} · {preview}".strip(" ·"),
            )

            return MessageOut(id=m.id, thread_id=m.thread_id, sender_id=m.sender_id, body=m.body, created_at=m.created_at, read=m.read)

    def mark_read(self, thread_id: int, user_id: int) -> None:
        with Session(engine) as session:
            self._require_participant(session, thread_id, user_id)
            repo.mark_thread_read(session, thread_id, user_id)


message_service = MessageService()
