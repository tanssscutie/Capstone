from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select, func

from app.models.business_document import BusinessDocument
from app.models.user import User
from app.models.requirement import Requirement


def add_document(session: Session, document: BusinessDocument) -> BusinessDocument:
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def list_documents_for_user(session: Session, user_id: int) -> List[BusinessDocument]:
    statement = (
        select(BusinessDocument)
        .where(BusinessDocument.user_id == user_id)
        .order_by(BusinessDocument.uploaded_at.desc())
    )
    return list(session.exec(statement).all())


def get_document(session: Session, document_id: int) -> Optional[BusinessDocument]:
    return session.get(BusinessDocument, document_id)


def count_awarded_requirements(session: Session, owner_id: int) -> int:
    # "Awarded" is modeled as a requirement owned by this user whose status
    # has moved to "closed" with an award recorded (status field doubles as
    # the marker for the pilot; a dedicated awarded_to column can be added
    # once the award flow is built).
    statement = (
        select(func.count())
        .select_from(Requirement)
        .where(Requirement.owner_id == owner_id)
        .where(Requirement.status == "awarded")
    )
    return session.exec(statement).one()


def list_flagged_users(session: Session) -> List[User]:
    """The admin review queue — every business waiting on a verification
    decision. Includes 'submitted' (documents cleared every automated
    check) as well as 'under_review' (something got flagged): verification
    is never automatic, so a clean submission still needs an explicit
    admin sign-off before it becomes 'verified', same as a flagged one."""
    statement = select(User).where(User.verification_status.in_(["submitted", "under_review"]))
    return list(session.exec(statement).all())


def list_all_users(session: Session) -> List[User]:
    """Every registered business, newest first — the admin's full roster,
    as opposed to list_flagged_users' narrower review-queue slice."""
    statement = (
        select(User).where(User.is_admin == False).order_by(User.created_at.desc())  # noqa: E712
    )
    return list(session.exec(statement).all())


def count_all_users(session: Session) -> int:
    statement = select(func.count()).select_from(User).where(User.is_admin == False)  # noqa: E712
    return session.exec(statement).one()


def count_verified_users(session: Session) -> int:
    statement = select(func.count()).select_from(User).where(User.is_verified == True)  # noqa: E712
    return session.exec(statement).one()


def registrations_by_day(session: Session, since: datetime) -> List[tuple]:
    """Raw (date, count) pairs — grouped in Python rather than SQL to stay
    portable between SQLite (dev/test) and MySQL (production) without a
    dialect-specific date-truncation function."""
    statement = select(User.created_at).where(User.created_at >= since).where(User.is_admin == False)  # noqa: E712
    rows = session.exec(statement).all()
    counts: dict = {}
    for created_at in rows:
        day = created_at.strftime("%Y-%m-%d")
        counts[day] = counts.get(day, 0) + 1
    return sorted(counts.items())


def update_user(session: Session, user: User) -> User:
    session.add(user)
    session.commit()
    session.refresh(user)
    return user