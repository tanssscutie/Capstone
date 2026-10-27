"""Post-release document requests to shortlisted respondents (Panel Suggestion #3).

After release the buyer may ask a shortlisted respondent for one more
supporting document — a sample photo, a certificate, a company profile —
before deciding. The respondent uploads it against that request.

What this deliberately does NOT do:
- touch the quotation itself. Price and every other sealed field stay locked
  (Suggestion #4); the request only adds evidence beside it, so the
  quotation's integrity hash is never affected.
- say "shortlisted" to the respondent. The alert reads "the buyer requested a
  document"; shortlisting itself stays the buyer's private working note.

Requests can only be made while the requirement is released and undecided
(status "closed"), on a shortlisted quotation. Uploads stay open through a
pending Notice of Award, so a buyer who awards while waiting still gets it.
Both events are written to the ledger; the upload entry records the file's
SHA-256, so a later swap of the file on disk is detectable.
"""
import hashlib
import os
import uuid
from typing import List, Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.core import file_crypto
from app.core.clock import now_ph
from app.core.database import engine
from app.models.quotation_document_request import QuotationDocumentRequest
from app.models.user import User
from app.repositories import notification_repository as notif_repo
from app.repositories import requirement_repository as repo
from app.schemas.requirement import DocumentRequestCreate, DocumentRequestOut
from app.services.requirement_service import NotOwner, RequirementNotFound, _log

UPLOAD_ROOT = os.path.join("uploads", "document_requests")

MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"}
# Open (pending) requests per quotation — keeps a buyer from burying a
# respondent in paperwork; cancelled and answered ones don't count.
MAX_PENDING_PER_QUOTATION = 5

UPLOAD_OPEN_STATUSES = ("closed", "award_pending")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _to_out(r: QuotationDocumentRequest) -> DocumentRequestOut:
    return DocumentRequestOut(
        id=r.id,
        requirement_id=r.requirement_id,
        quotation_id=r.quotation_id,
        document_label=r.document_label,
        note=r.note,
        status=r.status,
        filename=r.original_filename,
        response_note=r.response_note,
        created_at=r.created_at,
        submitted_at=r.submitted_at,
    )


class DocumentRequestService:
    def _get_request(self, session: Session, requirement_id: int, request_id: int) -> QuotationDocumentRequest:
        row = session.get(QuotationDocumentRequest, request_id)
        if not row or row.requirement_id != requirement_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document request not found")
        return row

    def list_for_quotation(self, requirement_id: int, quotation_id: int, viewer_id: int) -> List[DocumentRequestOut]:
        """The buyer sees every request on the quotation, cancelled ones too;
        the respondent only the ones still asked of them. Anyone else is
        refused — unlike most reads here, this one names a business's
        shortlisted status, so it isn't public."""
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            quotation = repo.get_quotation(session, quotation_id)
            if not req or not quotation or quotation.requirement_id != requirement_id:
                raise RequirementNotFound()
            viewer = session.get(User, viewer_id)
            is_owner = req.owner_id == viewer_id
            is_admin = bool(viewer and viewer.is_admin)
            if not (is_owner or is_admin or quotation.business_id == viewer_id):
                raise NotOwner()

            statement = (
                select(QuotationDocumentRequest)
                .where(QuotationDocumentRequest.quotation_id == quotation_id)
                .order_by(QuotationDocumentRequest.created_at.asc())
            )
            rows = list(session.exec(statement).all())
            if not (is_owner or is_admin):
                rows = [r for r in rows if r.status != "cancelled"]
            return [_to_out(r) for r in rows]

    def create(self, requirement_id: int, quotation_id: int, owner_id: int, data: DocumentRequestCreate) -> DocumentRequestOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            if req.status != "closed":
                raise _conflict("Documents can only be requested after release and before a decision is made")

            quotation = repo.get_quotation(session, quotation_id)
            if not quotation or quotation.requirement_id != requirement_id:
                raise RequirementNotFound()
            if quotation.status != "released" or not quotation.shortlisted:
                raise _conflict("Shortlist this quotation first before requesting documents from it")

            label = data.document_label.strip()
            if len(label) < 2:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name the document you need")

            pending = session.exec(
                select(QuotationDocumentRequest)
                .where(QuotationDocumentRequest.quotation_id == quotation_id)
                .where(QuotationDocumentRequest.status == "pending")
            ).all()
            if len(pending) >= MAX_PENDING_PER_QUOTATION:
                raise _conflict(f"You already have {MAX_PENDING_PER_QUOTATION} open requests on this quotation — wait for a reply or cancel one")

            note = data.note.strip() if data.note and data.note.strip() else None
            row = QuotationDocumentRequest(
                requirement_id=requirement_id,
                quotation_id=quotation_id,
                business_id=quotation.business_id,
                requested_by=owner_id,
                document_label=label,
                note=note,
            )
            session.add(row)
            session.commit()
            session.refresh(row)

            _log(session, "DOCUMENT_REQUESTED", requirement_id, quotation_id, owner_id, {
                "requirement_id": requirement_id,
                "quotation_id": quotation_id,
                "document_request_id": row.id,
                "document_label": label,
            })

            notif_repo.create_if_allowed(
                session,
                user_id=quotation.business_id,
                type_="DECISION",
                category="activity",
                title="The buyer requested a document",
                detail=f"{req.ref_code} · {req.title} — {label}",
                urgent=True,
                related_requirement_id=requirement_id,
            )
            return _to_out(row)

    def cancel(self, requirement_id: int, request_id: int, owner_id: int) -> DocumentRequestOut:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            if req.owner_id != owner_id:
                raise NotOwner()
            row = self._get_request(session, requirement_id, request_id)
            if row.status != "pending":
                raise _conflict("Only a request that hasn't been answered yet can be cancelled")

            row.status = "cancelled"
            row.cancelled_at = now_ph()
            session.add(row)
            session.commit()
            session.refresh(row)
            return _to_out(row)

    async def upload(
        self, requirement_id: int, request_id: int, business_id: int, file: UploadFile, response_note: Optional[str] = None,
    ) -> DocumentRequestOut:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Upload a PDF, Word document, or image ({', '.join(sorted(ALLOWED_EXTENSIONS))})",
            )
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is empty")
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Files can be up to 10 MB")
        note = response_note.strip()[:500] if response_note and response_note.strip() else None

        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            row = self._get_request(session, requirement_id, request_id)
            if row.business_id != business_id:
                raise NotOwner()
            if row.status == "cancelled":
                raise _conflict("The buyer cancelled this request")
            if req.status not in UPLOAD_OPEN_STATUSES:
                raise _conflict("This requirement already reached a final decision")

            request_dir = os.path.join(UPLOAD_ROOT, str(row.quotation_id))
            os.makedirs(request_dir, exist_ok=True)
            full_path = os.path.join(request_dir, f"{row.id}_{uuid.uuid4().hex}{ext}")
            with open(full_path, "wb") as f:
                f.write(file_crypto.encrypt_bytes(contents))

            previous_path = row.file_path
            digest = hashlib.sha256(contents).hexdigest()
            replaced = row.status == "submitted"
            row.status = "submitted"
            row.file_path = full_path
            row.original_filename = os.path.basename(file.filename or f"document{ext}")
            row.file_sha256 = digest
            row.response_note = note
            row.submitted_at = now_ph()
            session.add(row)
            session.commit()
            session.refresh(row)

            if previous_path and previous_path != full_path and os.path.exists(previous_path):
                os.remove(previous_path)

            _log(session, "DOCUMENT_SUBMITTED", requirement_id, row.quotation_id, business_id, {
                "requirement_id": requirement_id,
                "quotation_id": row.quotation_id,
                "document_request_id": row.id,
                "file_sha256": digest,
                "replaced": replaced,
            })

            notif_repo.create_if_allowed(
                session,
                user_id=req.owner_id,
                type_="DECISION",
                category="activity",
                title="Requested document received",
                detail=f"{req.ref_code} · {req.title} — {row.document_label}",
                related_requirement_id=requirement_id,
            )
            return _to_out(row)

    def get_file(self, requirement_id: int, request_id: int, viewer_id: int) -> Tuple[bytes, str]:
        with Session(engine) as session:
            req = repo.get_requirement(session, requirement_id)
            if not req:
                raise RequirementNotFound()
            row = self._get_request(session, requirement_id, request_id)
            viewer = session.get(User, viewer_id)
            if not (req.owner_id == viewer_id or row.business_id == viewer_id or (viewer and viewer.is_admin)):
                raise NotOwner()
            if row.status != "submitted" or not row.file_path or not os.path.exists(row.file_path):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No file has been uploaded for this request")
            with open(row.file_path, "rb") as f:
                encrypted = f.read()
            return file_crypto.decrypt_bytes(encrypted), row.original_filename or os.path.basename(row.file_path)


document_request_service = DocumentRequestService()
