from datetime import datetime
from app.core.clock import now_ph
from typing import Optional

from sqlmodel import SQLModel, Field


class QuotationAttachment(SQLModel, table=True):
    """A supporting file (method statement, certificate, past work, etc.) attached
    to a sealed quotation — sealed alongside it, released with it. Mirrors
    RequirementAttachment exactly; the two are kept as separate tables rather than
    one polymorphic one so a quotation's attachments never accidentally leak
    through a query scoped to requirement_id."""

    id: Optional[int] = Field(default=None, primary_key=True)
    quotation_id: int = Field(foreign_key="quotation.id", index=True)
    file_path: str
    original_filename: str
    # Which of the requirement's required_documents (Requirement.required_documents)
    # this satisfies, e.g. "PCAB License" — None for a general/free attachment not
    # tied to any specific requested document.
    document_label: Optional[str] = None
    uploaded_at: datetime = Field(default_factory=now_ph)
