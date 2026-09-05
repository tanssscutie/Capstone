from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class LedgerEntry(SQLModel, table=True):
    """One append-only record in the platform's hash chain.

    Every entry links to the previous one via prev_hash, so altering an
    older row (without recomputing every entry after it) breaks the chain
    and is detectable. entry_hash = SHA256(prev_hash + canonical_payload).

    This is tamper-EVIDENT, not tamper-PROOF: an operator with full
    database access could still rewrite the whole chain from that point
    forward. Anchoring the chain root outside the platform is future work
    (see the study's limitations).
    """

    id: Optional[int] = Field(default=None, primary_key=True)  # doubles as the "ledger entry number"

    event_type: str  # SUBMITTED | WITHDRAWN | RELEASED | CANCELLED | AWARDED
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    quotation_id: Optional[int] = Field(default=None, foreign_key="quotation.id", index=True)

    # None for system-triggered events (RELEASED) — the release is
    # triggered by the clock, not a person, so there is no human actor.
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")

    prev_hash: str
    entry_hash: str
    payload_json: str  # canonical JSON of what was hashed, kept for audit

    created_at: datetime = Field(default_factory=datetime.utcnow)