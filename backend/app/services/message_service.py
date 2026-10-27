import hashlib
import os
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from sqlmodel import Session

from app.core import file_crypto
from app.core.database import engine
from app.models.message import Message
from app.models.message_thread import MessageThread
from app.models.user import User
from app.repositories import message_repository as repo
from app.repositories import requirement_repository as req_repo
from app.repositories import notification_repository as notif_repo
from app.schemas.message import MessageThreadOut, MessageOut


UPLOAD_ROOT = os.path.join("uploads", "messages")
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Coordination files: documents, sheets, images, and artwork sources. No
# archives or executables.
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".ai", ".psd",
}


def _message_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id, thread_id=m.thread_id, sender_id=m.sender_id, body=m.body, is_system=m.is_system,
        attachment_filename=m.attachment_filename, attachment_size=m.attachment_size,
        created_at=m.created_at, read=m.read,
    )


def _preview(m: Optional[Message]) -> str:
    if not m:
        return ""
    if m.attachment_filename and not m.body:
        return f"Sent a file: {m.attachment_filename}"
    return m.body


class ThreadNotFound(Exception):
    pass


class NotParticipant(Exception):
    pass


def _is_open(session: Session, thread: MessageThread) -> bool:
    """Only the confirmed winner's thread is usable: the requirement is
    awarded and its awarded quotation belongs to this thread's business."""
    req = req_repo.get_requirement(session, thread.requirement_id)
    if not req or req.status != "awarded" or not req.awarded_quotation_id:
        return False
    awarded = req_repo.get_quotation(session, req.awarded_quotation_id)
    return awarded is not None and awarded.business_id == thread.business_id


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
            last_message_preview=_preview(latest),
            last_message_at=latest.created_at if latest else None,
            unread=repo.has_unread(session, thread.id, viewer_id),
        )

    def _notify_recipient(self, session: Session, thread: MessageThread, sender_id: int, text: str) -> None:
        recipient_id = thread.business_id if sender_id == thread.buyer_id else thread.buyer_id
        sender = session.get(User, sender_id)
        req = req_repo.get_requirement(session, thread.requirement_id)
        preview = text if len(text) <= 80 else f"{text[:80]}…"
        notif_repo.create_if_allowed(
            session,
            user_id=recipient_id,
            type_="MESSAGE_RECEIVED",
            category="messages",
            title=f"New message from {sender.business_name if sender else 'a business'}",
            detail=f"{req.ref_code if req else ''} · {preview}".strip(" ·"),
        )

    def list_threads(self, user_id: int) -> List[MessageThreadOut]:
        with Session(engine) as session:
            threads = [t for t in repo.list_threads_for_user(session, user_id) if _is_open(session, t)]
            out = [self._to_thread_out(session, t, user_id) for t in threads]
            # last_message_at is a datetime for a thread with at least one
            # message, None for a thread nobody has posted in yet (opened
            # at release, per SYSTEM_PROCESS.md — every released respondent
            # gets one, whether or not either side ever writes into it).
            # `t.last_message_at or t.id` used to fall back to an int in
            # that case, and sorting a list containing both datetimes and
            # ints raises TypeError the moment one of each appears together
            # — datetime.min keeps the sort key a single type throughout.
            out.sort(key=lambda t: (t.last_message_at or datetime.min, t.id), reverse=True)
            return out

    def _require_participant(self, session: Session, thread_id: int, user_id: int) -> MessageThread:
        thread = repo.get_thread(session, thread_id)
        if not thread:
            raise ThreadNotFound()
        if user_id not in (thread.buyer_id, thread.business_id):
            raise NotParticipant()
        if not _is_open(session, thread):
            raise ThreadNotFound()
        return thread

    def list_messages(self, thread_id: int, user_id: int) -> List[MessageOut]:
        with Session(engine) as session:
            self._require_participant(session, thread_id, user_id)
            messages = repo.list_messages(session, thread_id)
            return [
                _message_out(m)
                for m in messages
            ]

    def send_message(self, thread_id: int, user_id: int, body: str) -> MessageOut:
        with Session(engine) as session:
            thread = self._require_participant(session, thread_id, user_id)
            m = repo.create_message(session, thread_id, user_id, body.strip())
            self._notify_recipient(session, thread, user_id, m.body)

            return _message_out(m)

    async def send_attachment(self, thread_id: int, user_id: int, file: UploadFile, body: Optional[str]) -> MessageOut:
        """One file per message, with optional text. Validated before anything
        touches disk; stored encrypted."""
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"That file type isn't allowed. Use one of: {', '.join(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))}",
            )
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is empty")
        if len(contents) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Files can be up to 10 MB")
        text = (body or "").strip()[:2000]

        with Session(engine) as session:
            thread = self._require_participant(session, thread_id, user_id)
            thread_dir = os.path.join(UPLOAD_ROOT, str(thread.id))
            os.makedirs(thread_dir, exist_ok=True)
            full_path = os.path.join(thread_dir, f"{uuid.uuid4().hex}{ext}")
            with open(full_path, "wb") as f:
                f.write(file_crypto.encrypt_bytes(contents))

            m = repo.create_message(
                session, thread.id, user_id, text,
                attachment_path=full_path,
                attachment_filename=os.path.basename(file.filename or f"file{ext}")[:255],
                attachment_size=len(contents),
                attachment_sha256=hashlib.sha256(contents).hexdigest(),
            )
            self._notify_recipient(session, thread, user_id, _preview(m))
            return _message_out(m)

    def get_attachment(self, thread_id: int, message_id: int, user_id: int) -> Tuple[bytes, str]:
        with Session(engine) as session:
            viewer = session.get(User, user_id)
            thread = repo.get_thread(session, thread_id)
            if not thread:
                raise ThreadNotFound()
            if not (viewer and viewer.is_admin):
                self._require_participant(session, thread_id, user_id)
            m = session.get(Message, message_id)
            if not m or m.thread_id != thread_id or not m.attachment_path or not os.path.exists(m.attachment_path):
                raise ThreadNotFound()
            with open(m.attachment_path, "rb") as f:
                return file_crypto.decrypt_bytes(f.read()), m.attachment_filename or os.path.basename(m.attachment_path)

    def mark_read(self, thread_id: int, user_id: int) -> None:
        with Session(engine) as session:
            self._require_participant(session, thread_id, user_id)
            repo.mark_thread_read(session, thread_id, user_id)


message_service = MessageService()
