from datetime import date, datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class BusinessDocument(SQLModel, table=True):
    """A single uploaded verification document (DTI cert, SEC cert, BIR COR,
    or Mayor's/Business Permit) belonging to a user's onboarding.

    Since AI-based extraction is out of scope for now, the declared_* fields
    are entered by the business owner at upload time. Rule-based validation
    then checks these fields for internal consistency, valid identifier
    format, and expiry — it does not confirm authenticity at the issuing
    source (DTI/SEC/BIR itself), which is an explicit limitation of the
    system.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    doc_type: str  # DTI | SEC | BIR | MAYORS_PERMIT
    file_path: str

    declared_owner_name: str
    declared_business_name: str
    declared_id_number: str
    declared_expiry_date: Optional[date] = None

    # pass = internally consistent, valid format, not expired
    # flagged = failed one or more rule checks, needs admin review
    validation_status: str = "pending"  # pending | pass | flagged
    validation_notes: str = ""  # human-readable reasons when flagged

    # AI document check (document_extraction_service): expected | other_document
    # (the business confirmed a mismatch) | not_checked (Gemini unavailable).
    # Advisory for the reviewing administrator — never verifies on its own.
    ai_check: str = Field(default="not_checked", max_length=20)
    ai_check_note: Optional[str] = Field(default=None, max_length=400)
    # Identity check (VALID_ID / SELFIE_WITH_ID only): which ID, the name read
    # from it, whether that name matches the contact person, and whether the
    # selfie's face matches the ID. declared_id_number holds only the last 4.
    id_type: Optional[str] = Field(default=None, max_length=40)
    id_name: Optional[str] = Field(default=None, max_length=200)
    id_match: Optional[str] = Field(default=None, max_length=10)  # match | partial | mismatch | unchecked
    face_match: Optional[str] = Field(default=None, max_length=10)  # match | mismatch | unchecked
    uploaded_at: datetime = Field(default_factory=now_ph)