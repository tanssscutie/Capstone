from typing import Optional

from sqlmodel import Session, select

from app.models.ledger_entry import LedgerEntry
from app.services.ledger_service import GENESIS_HASH


def append(session: Session, entry: LedgerEntry) -> LedgerEntry:
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def get_last_hash(session: Session) -> str:
    statement = select(LedgerEntry).order_by(LedgerEntry.id.desc()).limit(1)
    last = session.exec(statement).first()
    return last.entry_hash if last else GENESIS_HASH


def get_entry(session: Session, entry_id: int) -> Optional[LedgerEntry]:
    return session.get(LedgerEntry, entry_id)


def list_for_requirement(session: Session, requirement_id: int):
    statement = (
        select(LedgerEntry)
        .where(LedgerEntry.requirement_id == requirement_id)
        .order_by(LedgerEntry.id.asc())
    )
    return list(session.exec(statement).all())