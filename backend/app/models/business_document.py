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

    uploaded_at: datetime = Field(default_factory=now_ph)