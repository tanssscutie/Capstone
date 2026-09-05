from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class ClarificationQuestion(SQLModel, table=True):
    """A public question about an OPEN requirement — visible to every respondent,
    unlike a sealed quotation. Only askable/answerable while the requirement is
    still open; see RequirementService.ask_question / answer_question."""

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    asker_id: int = Field(foreign_key="user.id", index=True)
    question: str
    answer: Optional[str] = None
    answered_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
