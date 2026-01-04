from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header





router = APIRouter(tags=["bookings"])


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
     provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_bookings_for_provider(db, provider.id)


@router.get("/providers/me/billing/bookings")
def list_provider_billable_bookings(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.get_billable_bookings_for_provider(db, provider.id)


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

