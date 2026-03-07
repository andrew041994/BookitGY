from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db
from app.security import get_current_user_from_header

router = APIRouter(tags=["notifications"])


@router.get("/notifications/me", response_model=schemas.NotificationsResponse)
def get_my_notifications(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    notifications = crud.list_notifications_for_user(db, user_id=current_user.id)
    return {"notifications": notifications}


@router.get(
    "/notifications/me/unread-count",
    response_model=schemas.NotificationUnreadCountResponse,
)
def get_my_notification_unread_count(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    unread_count = crud.get_unread_notification_count(db, user_id=current_user.id)
    return {"unread_count": unread_count}


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    marked = crud.mark_notification_read(
        db,
        notification_id=notification_id,
        user_id=current_user.id,
    )
    if not marked:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.patch("/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    updated = crud.mark_all_notifications_read(db, user_id=current_user.id)
    return {"ok": True, "updated": updated}
