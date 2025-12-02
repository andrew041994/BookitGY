from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header



router = APIRouter()


router = APIRouter(tags=["bookings"])


@router.post("/bookings")
def create_booking_for_me(
    booking_in: schemas.BookingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    try:
        booking = crud.create_booking(db, booking_in, customer_id=current_user.id)
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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    provider = crud.get_or_create_provider_for_user(db, current_user.id)
    return crud.list_bookings_for_provider(db, provider.id)


@router.post("/providers/me/bookings/{booking_id}/confirm")
def confirm_booking_as_provider(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    provider = crud.get_or_create_provider_for_user(db, current_user.id)
    ok = crud.confirm_booking_for_provider(
        db, booking_id=booking_id, provider_id=provider.id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"status": "confirmed"}


@router.post("/providers/me/bookings/{booking_id}/cancel")
def cancel_booking_as_provider(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    provider = crud.get_or_create_provider_for_user(db, current_user.id)
    ok = crud.cancel_booking_for_provider(
        db, booking_id=booking_id, provider_id=provider.id
    )
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
    booking = crud.cancel_booking_for_customer(db, booking_id, current_user.id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    return booking


@router.get("/providers/me/bookings/today")
def list_my_todays_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    provider = crud.get_or_create_provider_for_user(db, current_user.id)
    return crud.list_todays_bookings_for_provider(db, provider.id)


@router.get("/providers/me/bookings/upcoming")
def list_my_upcoming_bookings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    provider = crud.get_or_create_provider_for_user(db, current_user.id)
    return crud.list_upcoming_bookings_for_provider(db, provider.id)

