from typing import Optional, List
from datetime import datetime, time

from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header
from app.services.cloudinary_service import upload_booking_message_image
from PIL import Image, UnidentifiedImageError
from io import BytesIO
from tempfile import NamedTemporaryFile
import os





router = APIRouter(tags=["bookings"])



ALLOWED_BOOKING_MESSAGE_IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
ALLOWED_BOOKING_MESSAGE_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_BOOKING_MESSAGE_IMAGE_SIZE = 8 * 1024 * 1024
MAX_BOOKING_MESSAGE_IMAGE_DIMENSION = 4096


def _validate_booking_message_image(contents: bytes) -> tuple[int, int]:
    try:
        with Image.open(BytesIO(contents)) as img:
            img_format = (img.format or "").upper()
            width, height = img.size
            img.verify()
    except UnidentifiedImageError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid image.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read uploaded image.",
        )

    if img_format not in ALLOWED_BOOKING_MESSAGE_IMAGE_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image format. Allowed: JPEG, PNG, WEBP.",
        )

    if width > MAX_BOOKING_MESSAGE_IMAGE_DIMENSION or height > MAX_BOOKING_MESSAGE_IMAGE_DIMENSION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image dimensions are too large.",
        )

    return int(width), int(height)


def _require_current_provider(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
) -> models.Provider:
    if not current_user.is_provider:
        raise HTTPException(
            status_code=403, detail="Only providers can access this endpoint",
        )

    provider = crud.get_provider_by_user_id(db, current_user.id)
    if not provider:
        raise HTTPException(
            status_code=403,
            detail=(
                "You do not have an active provider profile. Contact support or an admin."
            ),
        )

    provider = crud.enforce_auto_lock_if_unpaid(db, provider)
    return provider


@router.post("/bookings")
def create_booking_for_me(
    booking_in: schemas.BookingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        booking = crud.create_booking(
            db, customer_id=current_user.id, booking=booking_in
        )
        if not booking:
            raise ValueError("Could not create booking")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        # bad time, slot already taken, etc.
        raise HTTPException(status_code=400, detail=str(e))

    return booking


@router.get("/bookings/me")
def list_my_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    return crud.list_bookings_for_customer(db, current_user.id)


@router.get("/providers/me/bookings")
def list_provider_bookings(
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    if start and end:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
            end_date = datetime.strptime(end, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid start/end format. Use YYYY-MM-DD.",
            )

        if end_date < start_date:
            raise HTTPException(
                status_code=400,
                detail="end must be greater than or equal to start",
            )

        range_start = datetime.combine(start_date, time.min)
        range_end = datetime.combine(end_date, time.max)
        return crud.list_bookings_for_provider(
            db,
            provider.id,
            range_start=range_start,
            range_end=range_end,
        )

    return crud.list_bookings_for_provider(db, provider.id)


@router.get("/providers/me/billing/bookings")
def list_provider_billable_bookings(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    from app import crud as live_crud

    return live_crud.get_billable_bookings_for_provider(db, provider.id)


@router.get(
    "/providers/me/billing/history", response_model=List[schemas.BillOut]
)
def list_provider_billing_history(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_bills_for_provider(db, provider.id)


@router.post("/providers/me/bookings/{booking_id}/confirm")
def confirm_booking_as_provider(
    booking_id: int,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
 ):
    try:
        ok = crud.confirm_booking_for_provider(
            db, booking_id=booking_id, provider_id=provider.id
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"status": "confirmed"}


@router.post("/providers/me/bookings/{booking_id}/cancel")
def cancel_booking_as_provider(
    booking_id: int,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    try:
        ok = crud.cancel_booking_for_provider(
            db, booking_id=booking_id, provider_id=provider.id
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if not ok:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"status": "cancelled"}


# @router.post("/bookings/{booking_id}/cancel")
# def cancel_booking_as_customer(
#     booking_id: int,
#     db: Session = Depends(get_db),
#     authorization: Optional[str] = Header(None),
# ):
#     user = get_current_user_from_header(authorization, db)

#     ok = crud.cancel_booking_for_customer(
#         db, booking_id=booking_id, customer_id=user.id
#     )
#     if not ok:
#         raise HTTPException(status_code=404, detail="Booking not found")

#     return {"status": "cancelled"}

@router.post("/bookings/{booking_id}/cancel")
def cancel_my_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    """
    Allow a customer to cancel their own booking.

    - Only the customer who owns the booking can cancel it.
    - Sets status='cancelled' if currently 'confirmed' or 'pending'.
    """
    try:
        booking = crud.cancel_booking_for_customer(db, booking_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    return booking


@router.get("/providers/me/bookings/today")
def list_my_todays_bookings(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_todays_bookings_for_provider(db, provider.id)


@router.get("/providers/me/bookings/upcoming")
def list_my_upcoming_bookings(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_upcoming_bookings_for_provider(db, provider.id)


@router.post("/bookings/messages/attachments")
async def upload_booking_message_attachment(
    booking_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        context = crud.get_booking_chat_context(
            db,
            booking_id=booking_id,
            user_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    if context is None:
        raise HTTPException(status_code=404, detail="Booking not found")

    if file.content_type not in ALLOWED_BOOKING_MESSAGE_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image attachments are allowed.",
        )

    contents = await file.read()
    if len(contents) > MAX_BOOKING_MESSAGE_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image file is too large. Maximum size is 8 MB.",
        )

    width, height = _validate_booking_message_image(contents)

    try:
        with NamedTemporaryFile(delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to buffer uploaded file",
        )

    try:
        upload_result = upload_booking_message_image(tmp_path)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload image",
        )
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    image_url = upload_result.get("secure_url") if isinstance(upload_result, dict) else str(upload_result)

    if not image_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image upload did not return a valid URL",
        )

    return {
        "attachment_type": "image",
        "file_url": image_url,
        "mime_type": file.content_type,
        "file_size_bytes": len(contents),
        "width": width,
        "height": height,
    }


@router.get(
    "/bookings/{booking_id}/messages",
    response_model=schemas.BookingMessagesResponse,
)
def get_booking_messages(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        payload = crud.list_booking_messages(
            db,
            booking_id=booking_id,
            user_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    if payload is None:
        raise HTTPException(status_code=404, detail="Booking not found")

    return payload


@router.post(
    "/bookings/messages",
    response_model=schemas.BookingMessageOut,
)
def send_booking_message(
    payload: schemas.MessageSendRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        message = crud.send_booking_message(
            db,
            booking_id=payload.booking_id,
            sender_user_id=current_user.id,
            text=payload.text,
            attachment=payload.attachment,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if message is None:
        raise HTTPException(status_code=404, detail="Booking not found")

    context = crud.get_booking_chat_context(
        db,
        booking_id=payload.booking_id,
        user_id=current_user.id,
    )

    return {
        "id": message.id,
        "sender_user_id": message.sender_user_id,
        "sender_role": context["sender_role"],
        "text": message.text,
        "created_at": message.created_at,
        "read_at": message.read_at,
        "attachment": message.attachment,
    }


@router.post("/bookings/messages/read")
def mark_booking_messages_read(
    payload: schemas.MarkMessagesReadRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        updated = crud.mark_booking_messages_read(
            db,
            booking_id=payload.booking_id,
            user_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    if updated is None:
        raise HTTPException(status_code=404, detail="Booking not found")

    return {"updated": updated}


@router.post(
    "/bookings/{booking_id}/rating",
    response_model=schemas.BookingRatingOut,
    status_code=status.HTTP_201_CREATED,
)
def create_booking_rating(
    booking_id: int,
    payload: schemas.BookingRatingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    if current_user.is_provider:
        raise HTTPException(status_code=403, detail="Only clients can create ratings.")

    try:
        rating = crud.create_booking_rating(
            db,
            booking_id=booking_id,
            requester_user_id=current_user.id,
            stars=payload.stars,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    if rating is None:
        raise HTTPException(status_code=404, detail="Booking not found")

    return rating


@router.get(
    "/bookings/{booking_id}/rating",
    response_model=schemas.BookingRatingOut,
)
def get_booking_rating(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        rating = crud.get_booking_rating_for_user(db, booking_id=booking_id, user=current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    if rating is None:
        raise HTTPException(status_code=404, detail="Rating not found")

    return rating
