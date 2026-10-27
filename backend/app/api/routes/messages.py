import mimetypes
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.core.security import get_current_user
from app.services.message_service import message_service, ThreadNotFound, NotParticipant
from app.schemas.message import MessageThreadOut, MessageOut, MessageCreate

router = APIRouter()


def _handle_errors(exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, ThreadNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    if isinstance(exc, NotParticipant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant in this thread")
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Something went wrong")


@router.get("/threads", response_model=List[MessageThreadOut])
def list_threads(current_user=Depends(get_current_user)):
    return message_service.list_threads(current_user.id)


@router.get("/threads/{thread_id}", response_model=List[MessageOut])
def list_messages(thread_id: int, current_user=Depends(get_current_user)):
    try:
        return message_service.list_messages(thread_id, current_user.id)
    except Exception as exc:
        _handle_errors(exc)


@router.post("/threads/{thread_id}", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(thread_id: int, payload: MessageCreate, current_user=Depends(get_current_user)):
    try:
        return message_service.send_message(thread_id, current_user.id, payload.body)
    except Exception as exc:
        _handle_errors(exc)


@router.post("/threads/{thread_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(thread_id: int, current_user=Depends(get_current_user)):
    try:
        message_service.mark_read(thread_id, current_user.id)
    except Exception as exc:
        _handle_errors(exc)


@router.post("/threads/{thread_id}/attachments", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_attachment(
    thread_id: int,
    file: UploadFile = File(...),
    body: Optional[str] = Form(default=None),
    current_user=Depends(get_current_user),
):
    """One file per message, with optional text — see message_service.send_attachment."""
    try:
        return await message_service.send_attachment(thread_id, current_user.id, file, body)
    except Exception as exc:
        _handle_errors(exc)


@router.get("/threads/{thread_id}/messages/{message_id}/file")
def get_attachment(thread_id: int, message_id: int, current_user=Depends(get_current_user)):
    try:
        content, filename = message_service.get_attachment(thread_id, message_id, current_user.id)
    except Exception as exc:
        _handle_errors(exc)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    # Headers are latin-1 only — strip anything else from the filename.
    safe_name = filename.encode("ascii", "ignore").decode().replace('"', "") or "file"
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'inline; filename="{safe_name}"'})
