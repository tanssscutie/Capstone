from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.services.notification_service import notification_service, NotificationNotFound, NotOwner
from app.schemas.notification import NotificationOut

router = APIRouter()


@router.get("", response_model=List[NotificationOut])
def list_mine(current_user=Depends(get_current_user)):
    return notification_service.list_for_user(current_user.id)


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(notification_id: int, current_user=Depends(get_current_user)):
    try:
        notification_service.mark_read(current_user.id, notification_id)
    except NotificationNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    except NotOwner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your notification")


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(current_user=Depends(get_current_user)):
    notification_service.mark_all_read(current_user.id)
