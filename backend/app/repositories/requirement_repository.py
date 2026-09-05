from datetime import datetime, timedelta
from typing import List, Optional

from sqlmodel import Session, select, func

from app.models.requirement import Requirement
from app.models.requirement_attachment import RequirementAttachment
from app.models.quotation import Quotation
from app.models.quotation_attachment import QuotationAttachment
from app.models.saved_requirement import SavedRequirement
from app.models.clarification_question import ClarificationQuestion
from app.models.user import User


def list_open_requirements(session: Session, limit: int = 50) -> List[Requirement]:
    statement = (
        select(Requirement)
        .where(Requirement.status == "open")
        .order_by(Requirement.created_at.desc())
        .limit(limit)
    )
    return list(session.exec(statement).all())


def list_closing_soon(session: Session, limit: int = 5) -> List[Requirement]:
    statement = (
        select(Requirement)
        .where(Requirement.status == "open")
        .where(Requirement.closes_at >= datetime.utcnow())
        .order_by(Requirement.closes_at.asc())
        .limit(limit)
    )
    return list(session.exec(statement).all())


def list_open_requirements_past_closing(session: Session) -> List[Requirement]:
    """Requirements the system clock says should release right now."""
    statement = (
        select(Requirement)
        .where(Requirement.status == "open")
        .where(Requirement.closes_at <= datetime.utcnow())
    )
    return list(session.exec(statement).all())


def get_requirement(session: Session, requirement_id: int) -> Optional[Requirement]:
    return session.get(Requirement, requirement_id)


def create_requirement(session: Session, requirement: Requirement) -> Requirement:
    session.add(requirement)
    session.commit()
    session.refresh(requirement)
    return requirement


def update_requirement(session: Session, requirement: Requirement) -> Requirement:
    session.add(requirement)
    session.commit()
    session.refresh(requirement)
    return requirement


def count_requirements_by_owner(session: Session, owner_id: int) -> int:
    statement = select(func.count()).select_from(Requirement).where(Requirement.owner_id == owner_id)
    return session.exec(statement).one()


def count_requirements_by_owner_and_status(session: Session, owner_id: int, req_status: str) -> int:
    statement = (
        select(func.count())
        .select_from(Requirement)
        .where(Requirement.owner_id == owner_id)
        .where(Requirement.status == req_status)
    )
    return session.exec(statement).one()


# ---------- quotations ----------

def create_quotation(session: Session, quotation: Quotation) -> Quotation:
    session.add(quotation)
    session.commit()
    session.refresh(quotation)
    return quotation


def update_quotation(session: Session, quotation: Quotation) -> Quotation:
    session.add(quotation)
    session.commit()
    session.refresh(quotation)
    return quotation


def get_quotation(session: Session, quotation_id: int) -> Optional[Quotation]:
    return session.get(Quotation, quotation_id)


def get_active_quotation(session: Session, requirement_id: int, business_id: int) -> Optional[Quotation]:
    statement = (
        select(Quotation)
        .where(Quotation.requirement_id == requirement_id)
        .where(Quotation.business_id == business_id)
        .where(Quotation.status == "sealed")
    )
    return session.exec(statement).first()


def list_active_quotations(session: Session, requirement_id: int) -> List[Quotation]:
    statement = (
        select(Quotation)
        .where(Quotation.requirement_id == requirement_id)
        .where(Quotation.status == "sealed")
    )
    return list(session.exec(statement).all())


def count_active_quotations(session: Session, requirement_id: int) -> int:
    statement = (
        select(func.count())
        .select_from(Quotation)
        .where(Quotation.requirement_id == requirement_id)
        .where(Quotation.status == "sealed")
    )
    return session.exec(statement).one()


def list_all_quotations_for_requirement(session: Session, requirement_id: int) -> List[Quotation]:
    """Full history — released, withdrawn, voided — used for the
    post-release comparison view. Nothing is ever deleted."""
    statement = (
        select(Quotation)
        .where(Quotation.requirement_id == requirement_id)
        .order_by(Quotation.created_at.asc())
    )
    return list(session.exec(statement).all())


def count_quotations_for_requirement(session: Session, requirement_id: int) -> int:
    """Total ever submitted (any status) — used for the feed's display count."""
    statement = (
        select(func.count())
        .select_from(Quotation)
        .where(Quotation.requirement_id == requirement_id)
    )
    return session.exec(statement).one()


def latest_quotation_at(session: Session, requirement_id: int):
    statement = (
        select(Quotation.created_at)
        .where(Quotation.requirement_id == requirement_id)
        .order_by(Quotation.created_at.desc())
        .limit(1)
    )
    return session.exec(statement).first()


def count_awarded_quotations_for_business(session: Session, business_id: int) -> int:
    """How many times this business WON an award as a supplier — the
    correct signal for trust tier, as opposed to how many of their own
    posted requirements (as a buyer) reached an award."""
    statement = (
        select(func.count())
        .select_from(Quotation)
        .join(Requirement, Quotation.requirement_id == Requirement.id)
        .where(Quotation.business_id == business_id)
        .where(Requirement.awarded_quotation_id == Quotation.id)
    )
    return session.exec(statement).one()


def count_quotations_by_business(session: Session, business_id: int) -> int:
    """All-time count, any status — used for the activity stats card."""
    statement = select(func.count()).select_from(Quotation).where(Quotation.business_id == business_id)
    return session.exec(statement).one()


def next_ref_code(session: Session) -> str:
    statement = select(func.count()).select_from(Requirement)
    count = session.exec(statement).one()
    return f"RQ-{600 + count + 1}"


def list_quotations_by_business(session: Session, business_id: int) -> List[Quotation]:
    statement = (
        select(Quotation)
        .where(Quotation.business_id == business_id)
        .order_by(Quotation.created_at.desc())
    )
    return list(session.exec(statement).all())


# ---------- attachments ----------

def add_attachment(session: Session, attachment: RequirementAttachment) -> RequirementAttachment:
    session.add(attachment)
    session.commit()
    session.refresh(attachment)
    return attachment


def list_attachments(session: Session, requirement_id: int) -> List[RequirementAttachment]:
    statement = (
        select(RequirementAttachment)
        .where(RequirementAttachment.requirement_id == requirement_id)
        .order_by(RequirementAttachment.uploaded_at.asc())
    )
    return list(session.exec(statement).all())


def add_quotation_attachment(session: Session, attachment: QuotationAttachment) -> QuotationAttachment:
    session.add(attachment)
    session.commit()
    session.refresh(attachment)
    return attachment


def list_quotation_attachments(session: Session, quotation_id: int) -> List[QuotationAttachment]:
    statement = (
        select(QuotationAttachment)
        .where(QuotationAttachment.quotation_id == quotation_id)
        .order_by(QuotationAttachment.uploaded_at.asc())
    )
    return list(session.exec(statement).all())


# ---------- "My Requirements" ----------

def list_requirements_by_owner(session: Session, owner_id: int) -> List[Requirement]:
    statement = (
        select(Requirement)
        .where(Requirement.owner_id == owner_id)
        .order_by(Requirement.created_at.desc())
    )
    return list(session.exec(statement).all())


# ---------- platform-wide (admin) ----------

def count_all_requirements(session: Session) -> int:
    return session.exec(select(func.count()).select_from(Requirement)).one()


def count_open_requirements(session: Session) -> int:
    statement = select(func.count()).select_from(Requirement).where(Requirement.status == "open")
    return session.exec(statement).one()


def count_all_quotations(session: Session) -> int:
    return session.exec(select(func.count()).select_from(Quotation)).one()


def list_all_requirements(session: Session) -> List[Requirement]:
    """Every requirement ever posted, newest first — the admin's full
    listing, as opposed to list_open_requirements' feed-facing slice."""
    statement = select(Requirement).order_by(Requirement.created_at.desc())
    return list(session.exec(statement).all())


def list_open_requirements_closing_within(session: Session, hours: int) -> List[Requirement]:
    """Open requirements whose closing time falls inside the next `hours` —
    the closing-soon scheduler's candidate set for a REQUIREMENT_CLOSING alert."""
    now = datetime.utcnow()
    threshold = now + timedelta(hours=hours)
    statement = (
        select(Requirement)
        .where(Requirement.status == "open")
        .where(Requirement.closes_at > now)
        .where(Requirement.closes_at <= threshold)
    )
    return list(session.exec(statement).all())


# ---------- saved requirements (personal bookmarks) ----------

def is_saved(session: Session, user_id: int, requirement_id: int) -> bool:
    statement = (
        select(func.count())
        .select_from(SavedRequirement)
        .where(SavedRequirement.user_id == user_id)
        .where(SavedRequirement.requirement_id == requirement_id)
    )
    return session.exec(statement).one() > 0


def save_requirement(session: Session, user_id: int, requirement_id: int) -> None:
    if is_saved(session, user_id, requirement_id):
        return
    session.add(SavedRequirement(user_id=user_id, requirement_id=requirement_id))
    session.commit()


def unsave_requirement(session: Session, user_id: int, requirement_id: int) -> None:
    statement = (
        select(SavedRequirement)
        .where(SavedRequirement.user_id == user_id)
        .where(SavedRequirement.requirement_id == requirement_id)
    )
    row = session.exec(statement).first()
    if row:
        session.delete(row)
        session.commit()


def list_saved_requirements(session: Session, user_id: int) -> List[Requirement]:
    statement = (
        select(Requirement)
        .join(SavedRequirement, SavedRequirement.requirement_id == Requirement.id)
        .where(SavedRequirement.user_id == user_id)
        .order_by(SavedRequirement.created_at.desc())
    )
    return list(session.exec(statement).all())


# ---------- pre-closing clarification Q&A ----------

def create_question(session: Session, requirement_id: int, asker_id: int, question: str) -> ClarificationQuestion:
    row = ClarificationQuestion(requirement_id=requirement_id, asker_id=asker_id, question=question)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_question(session: Session, question_id: int) -> Optional[ClarificationQuestion]:
    return session.get(ClarificationQuestion, question_id)


def list_questions(session: Session, requirement_id: int) -> List[ClarificationQuestion]:
    statement = (
        select(ClarificationQuestion)
        .where(ClarificationQuestion.requirement_id == requirement_id)
        .order_by(ClarificationQuestion.created_at.asc())
    )
    return list(session.exec(statement).all())


def answer_question(session: Session, question: ClarificationQuestion, answer: str) -> ClarificationQuestion:
    question.answer = answer
    question.answered_at = datetime.utcnow()
    session.add(question)
    session.commit()
    session.refresh(question)
    return question