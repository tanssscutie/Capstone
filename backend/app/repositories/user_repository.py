from sqlmodel import Session, select
from app.models.user import User


def get_user_by_mobile(session: Session, mobile_number: str):
    statement = select(User).where(User.mobile_number == mobile_number)
    result = session.exec(statement).first()
    return result


def get_user_by_email(session: Session, email: str):
    statement = select(User).where(User.email == email)
    result = session.exec(statement).first()
    return result


def get_user(session: Session, user_id: int):
    return session.get(User, user_id)


def create_user(session: Session, user: User):
    session.add(user)
    session.commit()
    session.refresh(user)
    return user