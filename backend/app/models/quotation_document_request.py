from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class QuotationDocumentRequest(SQLModel, table=True):
    """A buyer asking a shortlisted respondent for one more supporting document
    after release (sample photo, certificate, company profile...) — Panel
    Suggestion #3. Kept apart from QuotationAttachment on purpose: those are
    part of the sealed, hashed submission; this is post-release follow-up and
    never touches the quotation's price or its integrity hash.

    One request = one document = at most one file. Re-uploading replaces the
    file while the requirement is still undecided.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    requirement_id: int = Field(foreign_key="requirement.id", index=True)
    quotation_id: int = Field(foreign_key="quotation.id", index=True)
    # Denormalized from the quotation so access checks don't need a join.
    business_id: int = Field(foreign_key="user.id", index=True)
    requested_by: int = Field(foreign_key="user.id")

    document_label: str = Field(max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)

    # pending -> submitted (respondent uploaded the file)
    # pending -> cancelled (buyer withdrew the request before it was answered)
    status: str = "pending"

    # Set once the respondent uploads. The file is encrypted at rest, same as
    # business documents (file_crypto); file_sha256 is of the plaintext and is
    # what the DOCUMENT_SUBMITTED ledger entry records.
    file_path: Optional[str] = None
    original_filename: Optional[str] = None
    file_sha256: Optional[str] = None
    response_note: Optional[str] = Field(default=None, max_length=500)

    created_at: datetime = Field(default_factory=now_ph)
    submitted_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
