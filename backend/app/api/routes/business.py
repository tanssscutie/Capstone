import mimetypes
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlmodel import Session

from app.core.database import get_session
from app.core.security import require_verified, get_current_user, require_admin
from app.models.user import User
from app.schemas.business import (
    BusinessSearchOut,
    ProfileDetailsIn,
    CompletedWorkOut,
    ShowcaseIn,
    ReportSuggestionOut,
    LiftRestriction,
    MyReportOut,
    PortfolioItemOut,
    AdminReportOut,
    ReportCreate,
    ReportReview,
    OnboardingSubmit,
    DocumentUploadOut,
    DocumentExtractionOut,
    VerificationStatusOut,
    AdminReviewAction,
    DashboardStatsOut,
    AdminFlaggedBusinessOut,
    AdminStatsOut,
    AdminBusinessOut,
    PublicBusinessProfileOut,
    ProfileVisibilityIn,
    ChangeRequestIn,
    ChangeRequestOut,
    AdminChangeRequestOut,
    ChangeRequestReview,
)
from app.services.business_service import business_service
from app.services.report_service import report_service
from app.services.moderation_service import moderation_service
from app.services.portfolio_service import portfolio_service
from app.services.profile_media_service import profile_media_service
from app.services.change_request_service import change_request_service

router = APIRouter()


@router.post("/onboarding", status_code=status.HTTP_204_NO_CONTENT)
def submit_onboarding(payload: OnboardingSubmit, current_user: User = Depends(get_current_user)):
    business_service.submit_onboarding(current_user.id, payload)


@router.post("/change-requests", response_model=ChangeRequestOut, status_code=status.HTTP_201_CREATED)
def create_change_request(payload: ChangeRequestIn, current_user: User = Depends(get_current_user)):
    """Ask an administrator to change a locked business detail (1–3 business days)."""
    return change_request_service.create(current_user.id, payload)


@router.get("/change-requests/mine", response_model=List[ChangeRequestOut])
def my_change_requests(current_user: User = Depends(get_current_user)):
    return change_request_service.mine(current_user.id)


@router.post("/documents/extract", response_model=DocumentExtractionOut)
async def extract_document_fields(
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    return await business_service.extract_document_fields(doc_type=doc_type, file=file)


@router.post("/documents", response_model=DocumentUploadOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    doc_type: str = Form(...),
    declared_owner_name: str = Form(...),
    declared_business_name: str = Form(...),
    declared_id_number: str = Form(...),
    declared_expiry_date: Optional[date] = Form(default=None),
    file: UploadFile = File(...),
    # The AI check said it looks like a different document and the business
    # confirmed it's right anyway (409 otherwise).
    confirm_mismatch: bool = Form(default=False),
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
        confirm_mismatch=confirm_mismatch,
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
def get_public_profile(
    business_id: int,
    view_as: Optional[str] = Query(default=None, alias="as"),
    current_user: User = Depends(get_current_user),
):
    """?as=public|verified: the owner previewing their profile as others see
    it ("View as others"). Ignored for anyone else."""
    return business_service.get_public_profile(business_id, current_user.id, view_as)


@router.put("/profile/visibility")
def update_profile_visibility(payload: ProfileVisibilityIn, current_user: User = Depends(get_current_user)):
    """Who sees which profile section. Badge, tier and track record stay public."""
    return business_service.update_profile_visibility(current_user.id, payload.sections)


# ---------- admin ----------

@router.put("/profile/details", status_code=status.HTTP_204_NO_CONTENT)
def update_profile_details(payload: ProfileDetailsIn, current_user: User = Depends(get_current_user)):
    """Headline, About, website and Facebook links (http/https only)."""
    profile_media_service.update_details(current_user.id, payload.headline, payload.about,
                                         payload.website_url, payload.facebook_url)


@router.post("/profile/{kind}", status_code=status.HTTP_204_NO_CONTENT)
async def upload_profile_image(kind: str, file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """kind = avatar (512 square) | cover (1600x400) — see profile_media_service."""
    await profile_media_service.set_image(current_user.id, kind, file)


@router.delete("/profile/{kind}", status_code=status.HTTP_204_NO_CONTENT)
def remove_profile_image(kind: str, current_user: User = Depends(get_current_user)):
    profile_media_service.remove_image(current_user.id, kind)


@router.get("/{business_id}/avatar")
def profile_avatar(business_id: int, current_user: User = Depends(get_current_user)):
    return Response(content=profile_media_service.image(business_id, "avatar"), media_type="image/jpeg",
                    headers={"Cache-Control": "private, no-cache"})


@router.get("/{business_id}/cover")
def profile_cover(business_id: int, current_user: User = Depends(get_current_user)):
    return Response(content=profile_media_service.image(business_id, "cover"), media_type="image/jpeg",
                    headers={"Cache-Control": "private, no-cache"})


@router.get("/portfolio/suggestions", response_model=List[CompletedWorkOut])
def completed_work_suggestions(current_user: User = Depends(get_current_user)):
    """Your completed orders not yet shown on your profile."""
    return portfolio_service.completed_work(current_user.id, showcased=False)


@router.post("/portfolio/showcase/{requirement_id}", status_code=status.HTTP_204_NO_CONTENT)
def set_showcase(requirement_id: int, payload: ShowcaseIn, current_user: User = Depends(get_current_user)):
    portfolio_service.set_showcase(current_user.id, requirement_id, payload.show)


@router.get("/{business_id}/completed-work", response_model=List[CompletedWorkOut])
def completed_work(business_id: int, current_user: User = Depends(get_current_user)):
    """Completed orders this supplier chose to show in Past work. No prices.
    Empty when the owner limited who sees them (profile privacy)."""
    if not business_service.section_visible(business_id, current_user.id, "completed_orders"):
        return []
    return portfolio_service.completed_work(business_id, showcased=True)


@router.get("/{business_id}/portfolio", response_model=List[PortfolioItemOut])
def list_portfolio(business_id: int, current_user: User = Depends(get_current_user)):
    return portfolio_service.list(business_id)


@router.get("/{business_id}/portfolio/{item_id}/image")
def portfolio_image(business_id: int, item_id: int, current_user: User = Depends(get_current_user)):
    # Re-encoded as JPEG on upload (portfolio_service._shrink). Cacheable per
    # session only — it's behind the login.
    return Response(content=portfolio_service.image(business_id, item_id), media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.post("/portfolio", response_model=PortfolioItemOut, status_code=status.HTTP_201_CREATED)
async def add_portfolio_item(
    file: UploadFile = File(...),
    caption: str = Form(...),
    item_code: Optional[str] = Form(default=None),
    current_user: User = Depends(get_current_user),
):
    return await portfolio_service.add(current_user.id, file, caption, item_code)


@router.delete("/portfolio/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_portfolio_item(item_id: int, current_user: User = Depends(get_current_user)):
    portfolio_service.remove(current_user.id, item_id)


@router.post("/{business_id}/report", status_code=status.HTTP_201_CREATED)
def report_business(business_id: int, payload: ReportCreate, current_user: User = Depends(require_verified)):
    """Report a business for an admin to review. Confidential — see report_service."""
    report_service.create(current_user.id, business_id, payload)
    return {"detail": "Thanks — our team will review this report."}


@router.get("/reports/mine", response_model=List[MyReportOut])
def my_reports(current_user: User = Depends(get_current_user)):
    return report_service.list_mine(current_user.id)


@router.get("/reports/suggestions", response_model=List[ReportSuggestionOut])
def report_suggestions(current_user: User = Depends(get_current_user)):
    """Businesses you've dealt with — suggestions at the top of the Reports page."""
    return report_service.suggestions(current_user.id)


@router.get("/search", response_model=List[BusinessSearchOut])
def search_businesses(q: str = "", current_user: User = Depends(require_verified)):
    """Find a business to report by name (the Reports page)."""
    return report_service.search(current_user.id, q)


@router.post("/admin/users/{user_id}/lift", status_code=status.HTTP_204_NO_CONTENT)
def lift_restriction(user_id: int, payload: LiftRestriction, admin: User = Depends(require_admin)):
    moderation_service.lift(admin.id, user_id, payload.notes or "")


@router.get("/admin/reports", response_model=List[AdminReportOut])
def list_reports(_admin: User = Depends(require_admin)):
    return report_service.list_for_admin()


@router.post("/admin/reports/{report_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def review_report(report_id: int, payload: ReportReview, admin: User = Depends(require_admin)):
    report_service.review(report_id, admin.id, payload)


@router.get("/admin/change-requests", response_model=List[AdminChangeRequestOut])
def list_change_requests(_admin: User = Depends(require_admin)):
    return change_request_service.list_for_admin()


@router.post("/admin/change-requests/{request_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def review_change_request(request_id: int, payload: ChangeRequestReview, admin: User = Depends(require_admin)):
    change_request_service.review(request_id, admin.id, payload)


@router.get("/admin/whoami", status_code=status.HTTP_204_NO_CONTENT)
def admin_whoami(_admin: User = Depends(require_admin)):
    """Existence check for the admin frontend's auth guard — 204 if the
    caller is an admin, 403 (raised by require_admin) otherwise."""
    return None


@router.get("/admin/system-status")
def admin_system_status(_admin: User = Depends(require_admin)):
    """Admin Settings: the platform rules in force and which services are
    switched on — read-only, they're set in the server configuration (.env).
    Booleans only: no key or password ever leaves the server."""
    from app.core.config import settings
    from app.services import withdrawal_policy

    return {
        "min_quotations_to_release": settings.MIN_QUOTATIONS_TO_RELEASE,
        "auto_extend_days": settings.AUTO_EXTEND_DAYS,
        "withdrawal_window_days": withdrawal_policy.WINDOW_DAYS,
        "ai_enabled": bool(settings.GEMINI_API_KEY),
        "email_enabled": bool(settings.SMTP_HOST),
        "files_encrypted": bool(settings.FILE_ENCRYPTION_KEY),
    }


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
    # Decrypted here, not streamed straight off disk — the file is encrypted
    # at rest (see business_service._save_file / file_crypto).
    content, filename = business_service.get_document_bytes_for_admin(document_id)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/admin/{user_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def review_user(
    user_id: int,
    payload: AdminReviewAction,
    _admin: User = Depends(require_admin),
):
    business_service.admin_review(user_id, payload.approve, payload.notes)
