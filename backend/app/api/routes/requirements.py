from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.security import get_current_user, require_admin, require_verified
from app.models.user import User
from app.services import requirement_service as req_service_module
from app.services.requirement_service import requirement_service
from app.schemas.requirement import (
    RequirementCreate,
    RequirementOut,
    QuotationCreate,
    QuotationSealedReceipt,
    RequirementQuotationsView,
    ExtendClosingRequest,
    AwardRequest,
    MyQuotationOut,
    MyRequirementOut,
    AdminRequirementOut,
    AttachmentOut,
    RequirementLedgerView,
    ClarificationQuestionOut,
    QuestionCreate,
    AnswerCreate,
    SiteNotesUpdate,
)

router = APIRouter()


def _handle_service_errors(exc: Exception):
    E = req_service_module
    if isinstance(exc, E.RequirementNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    if isinstance(exc, E.NotOwner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the requirement's owner can do this")
    if isinstance(exc, E.RequirementNotOpen):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This requirement is no longer open")
    if isinstance(exc, E.RequirementNotReleased):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Quotations haven't released yet")
    if isinstance(exc, E.NoActiveQuotation):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You have no active quotation to withdraw")
    if isinstance(exc, E.AlreadyAwarded):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This requirement has already been awarded")
    if isinstance(exc, E.AlreadyDecided):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This requirement has already reached a final decision")
    if isinstance(exc, E.InvalidQuotation):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That quotation can't be awarded")
    if isinstance(exc, E.HasActiveQuotations):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Closing time can only be extended while no quotation has been submitted",
        )
    if isinstance(exc, E.QuestionNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Something went wrong")


@router.get("", response_model=List[RequirementOut])
def list_requirements(current_user=Depends(get_current_user)):
    return requirement_service.list_open(current_user.id)


@router.get("/closing-soon", response_model=List[RequirementOut])
def list_closing_soon(current_user=Depends(get_current_user)):
    return requirement_service.list_closing_soon(current_user.id)


@router.get("/mine/quotations", response_model=List[MyQuotationOut])
def list_my_quotations(current_user=Depends(get_current_user)):
    return requirement_service.list_my_quotations(current_user.id)


@router.get("/mine", response_model=List[MyRequirementOut])
def list_my_requirements(current_user=Depends(get_current_user)):
    return requirement_service.list_my_requirements(current_user.id)


@router.get("/admin/all", response_model=List[AdminRequirementOut])
def list_all_requirements_admin(_admin: User = Depends(require_admin)):
    return requirement_service.list_all_requirements()


@router.get("/saved", response_model=List[RequirementOut])
def list_saved(current_user=Depends(get_current_user)):
    return requirement_service.list_saved(current_user.id)


@router.post("/{requirement_id}/save", status_code=status.HTTP_204_NO_CONTENT)
def save_requirement(requirement_id: int, current_user=Depends(get_current_user)):
    try:
        requirement_service.save(requirement_id, current_user.id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/unsave", status_code=status.HTTP_204_NO_CONTENT)
def unsave_requirement(requirement_id: int, current_user=Depends(get_current_user)):
    try:
        requirement_service.unsave(requirement_id, current_user.id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("", response_model=RequirementOut, status_code=status.HTTP_201_CREATED)
def create_requirement(payload: RequirementCreate, current_user=Depends(require_verified)):
    return requirement_service.create(owner_id=current_user.id, data=payload)


@router.post("/{requirement_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(requirement_id: int, file: UploadFile = File(...), current_user=Depends(require_verified)):
    try:
        return await requirement_service.upload_attachment(requirement_id, current_user.id, file)
    except Exception as exc:
        _handle_service_errors(exc)


@router.patch("/{requirement_id}/extend", response_model=RequirementOut)
def extend_closing(requirement_id: int, payload: ExtendClosingRequest, current_user=Depends(require_verified)):
    try:
        return requirement_service.extend_closing(requirement_id, current_user.id, payload.new_closes_at)
    except Exception as exc:
        _handle_service_errors(exc)


@router.patch("/{requirement_id}/site-notes", response_model=RequirementOut)
def update_site_notes(requirement_id: int, payload: SiteNotesUpdate, current_user=Depends(require_verified)):
    try:
        return requirement_service.update_site_notes(requirement_id, current_user.id, payload)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/cancel", response_model=RequirementOut)
def cancel_requirement(requirement_id: int, current_user=Depends(require_verified)):
    try:
        return requirement_service.cancel(requirement_id, current_user.id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/quotations", response_model=QuotationSealedReceipt, status_code=status.HTTP_201_CREATED)
def submit_quotation(requirement_id: int, payload: QuotationCreate, current_user=Depends(require_verified)):
    try:
        return requirement_service.submit_quotation(
            requirement_id=requirement_id, business_id=current_user.id, data=payload
        )
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/quotations/{quotation_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_quotation_attachment(
    requirement_id: int, quotation_id: int, file: UploadFile = File(...), current_user=Depends(require_verified)
):
    try:
        return await requirement_service.upload_quotation_attachment(requirement_id, quotation_id, current_user.id, file)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/quotations/withdraw", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_quotation(requirement_id: int, current_user=Depends(require_verified)):
    try:
        requirement_service.withdraw_quotation(requirement_id, current_user.id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.get("/{requirement_id}/quotations", response_model=RequirementQuotationsView)
def list_quotations(requirement_id: int, current_user=Depends(get_current_user)):
    try:
        return requirement_service.list_quotations_view(requirement_id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.get("/{requirement_id}/ledger", response_model=RequirementLedgerView)
def get_ledger(requirement_id: int, current_user=Depends(get_current_user)):
    try:
        return requirement_service.list_ledger(requirement_id, current_user.id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/award", response_model=RequirementOut)
def award(requirement_id: int, payload: AwardRequest, current_user=Depends(require_verified)):
    try:
        return requirement_service.award(requirement_id, current_user.id, payload.quotation_id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/quotations/{quotation_id}/shortlist", status_code=status.HTTP_204_NO_CONTENT)
def shortlist_quotation(requirement_id: int, quotation_id: int, current_user=Depends(require_verified)):
    try:
        requirement_service.set_shortlist(requirement_id, quotation_id, current_user.id, True)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/quotations/{quotation_id}/unshortlist", status_code=status.HTTP_204_NO_CONTENT)
def unshortlist_quotation(requirement_id: int, quotation_id: int, current_user=Depends(require_verified)):
    try:
        requirement_service.set_shortlist(requirement_id, quotation_id, current_user.id, False)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/close-without-award", response_model=RequirementOut)
def close_without_award(requirement_id: int, current_user=Depends(require_verified)):
    try:
        return requirement_service.close_without_award(requirement_id, current_user.id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.get("/{requirement_id}/questions", response_model=List[ClarificationQuestionOut])
def list_questions(requirement_id: int, current_user=Depends(get_current_user)):
    try:
        return requirement_service.list_questions(requirement_id)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/questions", response_model=ClarificationQuestionOut, status_code=status.HTTP_201_CREATED)
def ask_question(requirement_id: int, payload: QuestionCreate, current_user=Depends(require_verified)):
    try:
        return requirement_service.ask_question(requirement_id, current_user.id, payload.question)
    except Exception as exc:
        _handle_service_errors(exc)


@router.post("/{requirement_id}/questions/{question_id}/answer", response_model=ClarificationQuestionOut)
def answer_question(requirement_id: int, question_id: int, payload: AnswerCreate, current_user=Depends(require_verified)):
    try:
        return requirement_service.answer_question(requirement_id, question_id, current_user.id, payload.answer)
    except Exception as exc:
        _handle_service_errors(exc)