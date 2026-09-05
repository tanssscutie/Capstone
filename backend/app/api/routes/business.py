import os
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.core.database import get_session
from app.core.security import get_current_user, require_admin
from app.models.user import User
from app.schemas.business import (
    OnboardingSubmit,
    DocumentUploadOut,
    VerificationStatusOut,
    AdminReviewAction,
    DashboardStatsOut,
    AdminFlaggedBusinessOut,
    AdminStatsOut,
    AdminBusinessOut,
    PublicBusinessProfileOut,
)
from app.services.business_service import business_service

router = APIRouter()


@router.post("/onboarding", status_code=status.HTTP_204_NO_CONTENT)
def submit_onboarding(payload: OnboardingSubmit, current_user: User = Depends(get_current_user)):
    business_service.submit_onboarding(current_user.id, payload)


@router.post("/documents", response_model=DocumentUploadOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    doc_type: str = Form(...),
    declared_owner_name: str = Form(...),
    declared_business_name: str = Form(...),
    declared_id_number: str = Form(...),
    declared_expiry_date: Optional[date] = Form(default=None),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    return await business_service.upload_document(
        user_id=current_user.id,
        doc_type=doc_type,
        declared_owner_name=declared_owner_name,
        declared_business_name=declared_business_name,
        declared_id_number=declared_id_number,
        declared_expiry_date=declared_expiry_date,
        file=file,
    )


@router.post("/submit-for-verification", response_model=VerificationStatusOut)
def submit_for_verification(current_user: User = Depends(get_current_user)):
    return business_service.submit_for_verification(current_user.id)


@router.get("/verification-status", response_model=VerificationStatusOut)
def get_verification_status(current_user: User = Depends(get_current_user)):
    return business_service.get_status(current_user.id)


@router.get("/dashboard-stats", response_model=DashboardStatsOut)
def get_dashboard_stats(current_user: User = Depends(get_current_user)):
    return business_service.get_dashboard_stats(current_user.id)


@router.get("/{business_id}/profile", response_model=PublicBusinessProfileOut)
def get_public_profile(business_id: int, _current_user: User = Depends(get_current_user)):
    return business_service.get_public_profile(business_id)


# ---------- admin ----------

@router.get("/admin/whoami", status_code=status.HTTP_204_NO_CONTENT)
def admin_whoami(_admin: User = Depends(require_admin)):
    """Existence check for the admin frontend's auth guard — 204 if the
    caller is an admin, 403 (raised by require_admin) otherwise."""
    return None


@router.get("/admin/flagged", response_model=List[AdminFlaggedBusinessOut])
def list_flagged(session: Session = Depends(get_session), _admin: User = Depends(require_admin)):
    return business_service.list_flagged(session)


@router.get("/admin/businesses", response_model=List[AdminBusinessOut])
def list_all_businesses(_admin: User = Depends(require_admin)):
    return business_service.list_all_businesses()


@router.get("/admin/stats", response_model=AdminStatsOut)
def get_admin_stats(_admin: User = Depends(require_admin)):
    return business_service.get_admin_stats()


@router.get("/admin/documents/{document_id}/file")
def get_document_file(document_id: int, _admin: User = Depends(require_admin)):
    document = business_service.get_document_for_admin(document_id)
    filename = os.path.basename(document.file_path)
    return FileResponse(document.file_path, filename=filename)


@router.post("/admin/{user_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def review_user(
    user_id: int,
    payload: AdminReviewAction,
    _admin: User = Depends(require_admin),
):
    business_service.admin_review(user_id, payload.approve, payload.notes)