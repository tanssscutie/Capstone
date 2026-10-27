from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select, func
from sqlalchemy import case

from app.models.transaction_closeout import TransactionCloseout
from app.models.business_document import BusinessDocument
from app.models.user import User
from app.models.requirement import Requirement
from app.models.quotation import Quotation


def profile_activity_counts(session: Session, business_id: int, *, include_sealed: bool, now: datetime) -> dict:
    """Count records once, not ledger events or attachment joins.

    An award is the confirmed requirement's selected released quotation;
    pending notices and shortlist flags are not awards. Other viewers only
    see supplier activity after the deadline AND after the sealed window.
    Withdrawals/voids before the deadline remain hidden even if cancelled.
    """
    def count_if(condition):
        return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)

    valid_requirements = ("open", "closed", "cancelled", "award_pending", "awarded", "closed_no_award",
                          "insufficient_quotations")
    confirmed_awards = select(Requirement.id).join(
        Quotation, Quotation.id == Requirement.awarded_quotation_id,
    ).where(
        Requirement.status == "awarded",
        Quotation.requirement_id == Requirement.id,
        Quotation.status == "released",
    )
    posted, awarded, cancelled = session.exec(
        select(
            func.count(),
            count_if(Requirement.id.in_(confirmed_awards)),
            count_if((Requirement.status == "cancelled") & Requirement.cancelled_at.is_not(None)),
        ).where(Requirement.owner_id == business_id, Requirement.status.in_(valid_requirements))
    ).one()

    statement = select(
        func.count(),
        count_if((Requirement.status == "awarded") &
                 (Requirement.awarded_quotation_id == Quotation.id) &
                 (Quotation.status == "released")),
        count_if((Quotation.status == "withdrawn") & Quotation.withdrawn_at.is_not(None)),
    ).select_from(Quotation).join(Requirement, Requirement.id == Quotation.requirement_id).where(
        Quotation.business_id == business_id,
        Quotation.status.in_(("sealed", "released", "withdrawn", "voided")),
        Requirement.status.in_(valid_requirements),
    )
    if not include_sealed:
        statement = statement.where(
            Requirement.status != "open", Requirement.closes_at <= now,
            Quotation.status != "sealed",
        )
    submitted, won, withdrawn = session.exec(statement).one()

    # Transactions both parties confirmed closed (closeout_service), as either
    # the buyer or the awarded supplier. Already past release, so never sealed.
    completed, not_pushed = session.exec(
        select(
            count_if(TransactionCloseout.outcome == "completed"),
            count_if(TransactionCloseout.outcome == "not_pushed_through"),
        ).select_from(TransactionCloseout)
        .join(Requirement, Requirement.id == TransactionCloseout.requirement_id)
        .join(Quotation, Quotation.id == Requirement.awarded_quotation_id)
        .where(
            TransactionCloseout.status == "confirmed",
            Requirement.status == "awarded",
            (Requirement.owner_id == business_id) | (Quotation.business_id == business_id),
        )
    ).one()
    return dict(
        requirements_posted_count=posted, requirements_awarded_count=awarded,
        requirements_cancelled_count=cancelled, quotations_submitted_count=submitted,
        quotations_awarded_count=won, quotations_withdrawn_count=withdrawn,
        transactions_completed_count=completed, transactions_not_pushed_through_count=not_pushed,
    )


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


def count_users_by_role(session: Session, role: str) -> int:
    statement = select(func.count()).select_from(User).where(User.is_admin == False, User.role == role)  # noqa: E712
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
