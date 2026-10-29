"""Admin Documents page — supporting files, project notes, data sets.
Mounted under /business (tag "business"); every route is admin-only.
See admin_library_service."""
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from pydantic import BaseModel

from app.core.security import require_admin
from app.models.user import User
from app.services.admin_library_service import admin_library_service

router = APIRouter()


class NoteOut(BaseModel):
    name: str
    content: str


@router.get("/admin/library")
def list_admin_documents(_admin: User = Depends(require_admin)):
    """Supporting files uploaded by administrators, newest first."""
    return admin_library_service.list()


@router.post("/admin/library", status_code=status.HTTP_201_CREATED)
async def upload_admin_document(
    title: str = Form(...),
    category: str = Form(...),
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
):
    """Upload a supporting file (.xlsx, .csv, .pdf, .png, .jpg, .docx; up to 25 MB), encrypted at rest."""
    return await admin_library_service.upload(admin.id, title, category, file)


@router.get("/admin/library/{document_id}/file")
def get_admin_document_file(document_id: int, _admin: User = Depends(require_admin)):
    content, filename, media_type = admin_library_service.file(document_id)
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"})


@router.get("/admin/library/{document_id}/table")
def get_admin_document_table(document_id: int, _admin: User = Depends(require_admin)):
    """A .xlsx / .csv as rows per sheet, for the in-app table view."""
    return admin_library_service.table(document_id)


@router.delete("/admin/library/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_document(document_id: int, _admin: User = Depends(require_admin)):
    admin_library_service.delete(document_id)


@router.get("/admin/notes", response_model=List[str])
def list_notes(_admin: User = Depends(require_admin)):
    """The project notes that can be read here (a fixed whitelist)."""
    return admin_library_service.note_names()


@router.get("/admin/notes/{name}", response_model=NoteOut)
def get_note(name: str, _admin: User = Depends(require_admin)):
    return admin_library_service.note(name)


@router.get("/admin/datasets")
def get_datasets(_admin: User = Depends(require_admin)):
    """Reference data: categories → items → specs, NCR addresses, market rules,
    withdrawal reasons, document types, profile visibility levels."""
    return admin_library_service.datasets()
