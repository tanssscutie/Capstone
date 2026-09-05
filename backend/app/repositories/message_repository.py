from typing import List, Optional

from sqlmodel import Session, select, func

from app.models.message import Message
from app.models.message_thread import MessageThread


def create_thread(session: Session, requirement_id: int, buyer_id: int, business_id: int) -> MessageThread:
    thread = MessageThread(requirement_id=requirement_id, buyer_id=buyer_id, business_id=business_id)
    session.add(thread)
    session.commit()
    session.refresh(thread)
    return thread


def get_thread(session: Session, thread_id: int) -> Optional[MessageThread]:
    return session.get(MessageThread, thread_id)


def get_thread_for_business(session: Session, requirement_id: int, business_id: int) -> Optional[MessageThread]:
    statement = (
        select(MessageThread)
        .where(MessageThread.requirement_id == requirement_id)
        .where(MessageThread.business_id == business_id)
    )
    return session.exec(statement).first()


def list_threads_for_user(session: Session, user_id: int) -> List[MessageThread]:
    statement = select(MessageThread).where(
        (MessageThread.buyer_id == user_id) | (MessageThread.business_id == user_id)
    )
    return list(session.exec(statement).all())


def list_messages(session: Session, thread_id: int) -> List[Message]:
    statement = select(Message).where(Message.thread_id == thread_id).order_by(Message.created_at.asc())
    return list(session.exec(statement).all())


def latest_message(session: Session, thread_id: int) -> Optional[Message]:
    statement = (
        select(Message)
        .where(Message.thread_id == thread_id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    return session.exec(statement).first()


def has_unread(session: Session, thread_id: int, viewer_id: int) -> bool:
    statement = (
        select(func.count())
        .select_from(Message)
        .where(Message.thread_id == thread_id)
        .where(Message.sender_id != viewer_id)
        .where(Message.read == False)  # noqa: E712
    )
    return session.exec(statement).one() > 0


def create_message(session: Session, thread_id: int, sender_id: int, body: str) -> Message:
    message = Message(thread_id=thread_id, sender_id=sender_id, body=body)
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def mark_thread_read(session: Session, thread_id: int, viewer_id: int) -> None:
    statement = (
        select(Message)
        .where(Message.thread_id == thread_id)
        .where(Message.sender_id != viewer_id)
        .where(Message.read == False)  # noqa: E712
    )
    for message in session.exec(statement).all():
        message.read = True
        session.add(message)
    session.commit()
