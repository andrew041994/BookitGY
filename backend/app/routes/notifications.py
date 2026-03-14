from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db
from app.security import get_current_user_from_header
from app.services import push_notifications

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


@router.post("/notifications/push-tokens/register")
def register_push_token(
    payload: schemas.PushTokenRegisterRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        row = push_notifications.upsert_push_token(
            db,
            user_id=current_user.id,
            expo_push_token=payload.expo_push_token,
            platform=payload.platform,
            device_id=payload.device_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"id": row.id, "is_active": row.is_active}


@router.post("/notifications/push-tokens/deactivate")
def deactivate_push_token(
    payload: schemas.PushTokenDeactivateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        updated = push_notifications.deactivate_push_token(
            db,
            user_id=current_user.id,
            expo_push_token=payload.expo_push_token,
            device_id=payload.device_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"updated": updated}
