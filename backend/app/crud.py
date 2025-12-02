import os
from datetime import datetime, timedelta, date
from dateutil import tz
from decimal import Decimal
from typing import Optional, List
from sqlalchemy import func
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from twilio.rest import Client
import requests
import hashlib
from sqlalchemy import func
from . import models, schemas
from typing import Optional
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv(), override=False)



# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

LOCAL_TZ = tz.gettz("America/Guyana")

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

def validate_coordinates(lat: Optional[float], long: Optional[float]) -> None:
    if lat is not None:
        if not (-90.0 <= lat <= 90.0):
            raise ValueError("Latitude must be between -90 and 90 degrees")

    if long is not None:
        if not (-180.0 <= long <= 180.0):
            raise ValueError("Longitude must be between -180 and 180 degrees")


def send_push(to_token: Optional[str], title: str, body: str) -> None:
    if not to_token:
        return

    payload = {
        "to": to_token,
        "sound": "default",
        "title": title,
        "body": body,
    }

    try:
        requests.post(EXPO_PUSH_URL, json=payload, timeout=5)
    except Exception as e:
        print(f"Push error: {e}")

def hash_password(password: str) -> str:
    """Return a secure hash for the given plaintext password."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify that a plaintext password matches a stored hash."""
    return pwd_context.verify(plain, hashed)


def now_local_naive():
    """
    Current Guyana local time, returned as a *naive* datetime so it
    matches the DB columns and other code that uses naive datetimes.
    """
    return datetime.now(LOCAL_TZ).replace(tzinfo=None)



# ---------------------------------------------------------------------------
# provider dashboard
# ---------------------------------------------------------------------------

def get_provider_by_user_id(db: Session, user_id: int):
    return db.query(models.Provider).filter(models.Provider.user_id == user_id).first()

def create_provider_for_user(db: Session, user: models.User):
    """Create a provider for this user and assign an account number."""
    provider = models.Provider(
        user_id=user.id,
        bio="",
        account_number=generate_account_number_for_email(user.email),
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider

def list_providers(db: Session, profession: Optional[str] = None):
    """
    Public list of providers for the client search screen.
    Optionally filter by profession name (case-insensitive).
    Returns a list of ProviderListItem structures.
    """
    # Base query joining providers → users
    q = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
    )

    # Optional filter by profession
    if profession:
        q = (
            q.join(
                models.ProviderProfession,
                models.ProviderProfession.provider_id == models.Provider.id,
            )
            .filter(models.ProviderProfession.name.ilike(f"%{profession}%"))
        )

    rows = q.all()

    results = []
    for provider, user in rows:
        professions = get_professions_for_provider(db, provider.id)

        results.append(
            {
                "provider_id": provider.id,
                "name": user.full_name or "",
                "location": user.location or "",
                "lat": user.lat,
                "long": user.long,
                "bio": provider.bio or "",
                "professions": professions,
            }
        )

    return results


def list_services_for_provider(db: Session, provider_id: int):
    return (
        db.query(models.Service)
        .filter(models.Service.provider_id == provider_id)
        .order_by(models.Service.id.asc())
        .all()
    )

def create_service_for_provider(db: Session, provider_id: int, service_in: schemas.ServiceCreate):
    svc = models.Service(
        provider_id=provider_id,
        name=service_in.name,
        description=service_in.description,
        price_gyd=service_in.price_gyd,
        duration_minutes=service_in.duration_minutes,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc

def get_service_for_provider(
    db: Session, service_id: int, provider_id: int
) -> Optional[models.Service]:
    return (
        db.query(models.Service)
        .filter(
            models.Service.id == service_id,
            models.Service.provider_id == provider_id,
        )
        .first()
    )

def delete_service_for_provider(
    db: Session, service_id: int, provider_id: int
) -> bool:
    svc = get_service_for_provider(db, service_id, provider_id)
    if not svc:
        return False
    db.delete(svc)
    db.commit()
    return True

def get_or_create_provider_for_user(db: Session, user_id: int) -> models.Provider:
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.user_id == user_id)
        .first()
    )

    if provider:
        if not provider.account_number:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            provider.account_number = generate_account_number_for_email(user.email)
            db.commit()
            db.refresh(provider)
        return provider

    user = db.query(models.User).filter(models.User.id == user_id).first()
    return create_provider_for_user(db, user)

def delete_service(db: Session, provider_id: int, service_id: int) -> bool:
    """
    Backwards-compatible wrapper for deleting a service for a provider.
    Called as crud.delete_service(db, provider.id, service_id) from routes.
    """
    return delete_service_for_provider(
        db=db,
        service_id=service_id,
        provider_id=provider_id,
    )

def update_provider_location(db: Session, provider_id: int, lat: float, long: float):
    provider = db.query(models.Provider).filter(models.Provider.id == provider_id).first()
    if not provider:
        return None

    provider.lat = lat
    provider.long = long

    db.commit()
    db.refresh(provider)
    return provider


def generate_account_number_for_email(email: str) -> str:
    """
    Deterministic account number linked to email.
    Example: ACC-1A2B3C4D
    """
    normalized = (email or "").strip().lower()
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:8].upper()
    return f"ACC-{digest}"


# ---------------------------------------------------------------------------
# Twilio / WhatsApp helper
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Twilio / WhatsApp helper
# ---------------------------------------------------------------------------

twilio_client = None
if os.getenv("TWILIO_ACCOUNT_SID"):
    print("[WhatsApp debug] TWILIO_ACCOUNT_SID is set")
    twilio_client = Client(
        os.getenv("TWILIO_ACCOUNT_SID"),
        os.getenv("TWILIO_AUTH_TOKEN"),
    )
else:
    print("[WhatsApp debug] TWILIO_ACCOUNT_SID is NOT set")

FROM_NUMBER = os.getenv("TWILIO_WHATSAPP_FROM")
print(f"[WhatsApp debug] FROM_NUMBER = {FROM_NUMBER!r}")


def send_whatsapp(to: str, body: str) -> None:
    """Send a WhatsApp message, or log a preview if Twilio isn't configured."""
    print(
        "[WhatsApp debug] send_whatsapp called with: "
        f"client={bool(twilio_client)}, FROM={FROM_NUMBER!r}, to={to!r}"
    )

    if not twilio_client or not to or not FROM_NUMBER:
        print(f"[WhatsApp Preview] To {to}: {body}")
        return

    try:
        msg = twilio_client.messages.create(from_=FROM_NUMBER, body=body, to=to)
        print(f"[WhatsApp debug] Twilio message SID: {msg.sid}")
    except Exception as e:
        print(f"WhatsApp error: {e}")


def notify_booking_created(
    customer: Optional[models.User],
    provider_user: Optional[models.User],
    service: models.Service,
    booking: models.Booking,
) -> None:
    """Send all notifications for a newly confirmed booking.

    - WhatsApp to customer (if configured)
    - WhatsApp to provider (if configured)
    - Push to customer (if configured)
    - Push to provider (if configured)
    """
    if not (customer and provider_user):
        return

    # Customer: one confirmation message
    if customer.whatsapp:
        send_whatsapp(
            customer.whatsapp,
            (
                "Booking confirmed!\n"
                f"{service.name} with {provider_user.full_name}\n"
                f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}\n"
                f"GYD {service.price_gyd}"
            ),
        )

    # Provider: one "new booking" message
    if provider_user.whatsapp:
        send_whatsapp(
            provider_user.whatsapp,
            (
                "New booking!\n"
                f"{customer.full_name} booked {service.name}\n"
                f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}"
            ),
        )

    # Push notifications (one each)
    send_push(
        customer.expo_push_token,
        "Booking confirmed",
        f"{service.name} with {provider_user.full_name} on "
        f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}",
    )

    send_push(
        provider_user.expo_push_token,
        "New booking",
        f"{customer.full_name} booked {service.name} on "
        f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}",
    )




# ---------------------------------------------------------------------------
# User CRUD + authentication
# ---------------------------------------------------------------------------

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """Create a new user with hashed password."""
    hashed = hash_password(user.password)
    db_user = models.User(
        **user.dict(exclude={"password"}),
        hashed_password=hashed,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def get_user_by_email(db: Session, email: str):
    """Return user by email, or None if not found."""
    return db.query(models.User).filter(models.User.email == email).first()


def authenticate_user(db: Session, email: str, password: str):
    """
    Authenticate a user by email + password.

    Returns:
        - user object if credentials are valid
        - None if invalid
    """
    user = get_user_by_email(db, email)
    if not user:
        return None

    if not verify_password(password, user.hashed_password):
        return None

    return user

def update_user(
    db: Session,
    user_id: int,
    user_update: schemas.UserUpdate,
) -> Optional[models.User]:
    """
    Partially update a user using fields from UserUpdate.
    Only fields that are actually provided (exclude_unset=True) are changed.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return None

    # Only apply fields that were sent in the request
    update_data = user_update.dict(exclude_unset=True)

    # Explicit whitelist of user fields that may be updated from the API
    ALLOWED_USER_FIELDS = {
        "full_name",
        "whatsapp",
        "location",
        "avatar_url",
    }

    for field, value in update_data.items():
        if field in ALLOWED_USER_FIELDS:
            setattr(user, field, value)


    db.commit()
    db.refresh(user)
    return user



# ---------------------------------------------------------------------------
# Promotion CRUD
# ---------------------------------------------------------------------------

def get_promotion(db: Session, provider_id: int):
    return (
        db.query(models.Promotion)
        .filter(models.Promotion.provider_id == provider_id)
        .first()
    )


def upsert_promotion(db: Session, provider_id: int, free_total: int):
    promo = get_promotion(db, provider_id)
    if promo:
        promo.free_bookings_total = free_total
        # Ensure used count isn't above new total
        if free_total < promo.free_bookings_used:
            promo.free_bookings_used = free_total
    else:
        promo = models.Promotion(
            provider_id=provider_id,
            free_bookings_total=free_total,
            free_bookings_used=0,
        )
        db.add(promo)

    db.commit()
    db.refresh(promo)
    return promo


# ---------------------------------------------------------------------------
# Booking with promotion + lock check
# ---------------------------------------------------------------------------

def create_booking(
    db: Session,
    customer_id: int,
    booking: schemas.BookingCreate,
) -> Optional[models.Booking]:
    """
    Create a new booking for a customer.

    Flow:
    1. Validate service / provider.
    2. Validate that the selected slot is not already booked.
    3. Create booking (confirmed).
    4. Dispatch notifications (single helper).
    """

    # Load service
    service = (
        db.query(models.Service)
        .filter(models.Service.id == booking.service_id)
        .first()
    )
    if not service:
        return None

    # Load provider
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == service.provider_id)
        .first()
    )
    if not provider:
        return None

    # Load provider user
    provider_user = (
        db.query(models.User)
        .filter(models.User.id == provider.user_id)
        .first()
    )
    if not provider_user:
        return None

    # Compute end time
    end_time = booking.start_time + timedelta(
        minutes=service.duration_minutes
    )

    # Check overlapping bookings
    overlap = (
        db.query(models.Booking)
        .filter(models.Booking.service_id == booking.service_id)
        .filter(
            models.Booking.start_time < end_time,
            models.Booking.end_time > booking.start_time,
        )
        .first()
    )

    if overlap:
        # This slot is taken
        return None

    # Create booking
    new_booking = models.Booking(
        customer_id=customer_id,
        service_id=service.id,
        start_time=booking.start_time,
        end_time=end_time,
        status="confirmed",
    )

    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)

    # Load customer
    customer = (
        db.query(models.User)
        .filter(models.User.id == customer_id)
        .first()
    )

    # Dispatch all notifications in one place
    notify_booking_created(customer, provider_user, service, new_booking)

    return new_booking




# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

def generate_monthly_bills(db: Session, month: date):
    """
    Generate or update bills for all providers for the given month.

    - Only counts bookings that are:
        * confirmed
        * belong to this provider
        * have ALREADY ENDED (end_time <= now)
        * have end_time inside [first_of_month, first_of_next_month)
    - Safe to run multiple times (updates existing unpaid bill instead of duplicating).
    """
    providers = db.query(models.Provider).all()

    # First day of this month
    start = date(month.year, month.month, 1)

    # First day of the next month
    if month.month == 12:
        next_month = date(month.year + 1, 1, 1)
    else:
        next_month = date(month.year, month.month + 1, 1)

    start_dt = datetime(start.year, start.month, start.day)
    end_dt = datetime(next_month.year, next_month.month, next_month.day)

    now = datetime.utcnow()

    # Don't count future appointments that haven't ended yet
    period_end = min(end_dt, now)

    for prov in providers:
        # Total value of all completed confirmed bookings in this period
        total = (
            db.query(func.sum(models.Service.price_gyd))
            .join(models.Booking)
            .filter(
                models.Booking.service_id == models.Service.id,
                models.Service.provider_id == prov.id,
                models.Booking.status == "confirmed",
                models.Booking.end_time >= start_dt,
                models.Booking.end_time < period_end,
            )
            .scalar()
            or 0
        )

        # 10% platform fee on completed bookings
        fee = Decimal("0.1") * Decimal(str(total))

        # If there's nothing to bill and no existing bill, skip
        existing_bill = (
            db.query(models.Bill)
            .filter(
                models.Bill.provider_id == prov.id,
                models.Bill.month == start,
            )
            .first()
        )
        if not existing_bill and total == 0:
            continue

        # Bill due on the 15th of the following month
        due = datetime(next_month.year, next_month.month, 15, 23, 59)

        if existing_bill:
            # Don't overwrite already-paid bills
            if existing_bill.is_paid:
                continue

            existing_bill.total_gyd = total
            existing_bill.fee_gyd = fee
            existing_bill.due_date = due
        else:
            bill = models.Bill(
                provider_id=prov.id,
                month=start,
                total_gyd=total,
                fee_gyd=fee,
                due_date=due,
            )
            db.add(bill)

    db.commit()





def get_provider_fees_due(db: Session, provider_id: int) -> float:
    """
    Sum of all unpaid fees for this provider, in GYD.
    Assumes Bill.fee_gyd is only populated after appointments have finished.
    """
    total = (
        db.query(func.coalesce(func.sum(models.Bill.fee_gyd), 0))
        .filter(
            models.Bill.provider_id == provider_id,
            models.Bill.is_paid == False,  # unpaid only
        )
        .scalar()
    )
    return float(total or 0.0)


def list_bookings_for_provider(db: Session, provider_id: int):
    """Return upcoming bookings for this provider (from now onwards)."""
    now = datetime.utcnow()

    rows = (
        db.query(
            models.Booking.id,
            models.Booking.start_time,
            models.Booking.end_time,
            models.Booking.status,
            models.Service.name.label("service_name"),
            models.User.full_name.label("customer_name"),
        )
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(
            models.Provider.id == provider_id,
            models.Booking.start_time >= now,
        )
        .order_by(models.Booking.start_time.asc())
        .all()
    )

    return [
        {
            "id": r.id,
            "service_name": r.service_name,
            "customer_name": r.customer_name,
            "start_time": r.start_time,
            "end_time": r.end_time,
            "status": r.status,
        }
        for r in rows
    ]

def list_bookings_for_customer(db: Session, customer_id: int):
    """
    Return all bookings for this customer, newest first.
    """
    user = (
        db.query(models.User)
        .filter(models.User.id == customer_id)
        .first()
    )

    if not user:
        return []

    rows = (
        db.query(models.Booking, models.Service)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .filter(models.Booking.customer_id == customer_id)
        .order_by(models.Booking.start_time.desc())
        .all()
    )

    results: list[schemas.BookingWithDetails] = []

    for booking, service in rows:
        provider_name = ""
        provider_location = ""
        provider_lat = None
        provider_long = None

        if service:
            provider = (
                db.query(models.Provider)
                .filter(models.Provider.id == service.provider_id)
                .first()
            )
            if provider:
                provider_user = (
                    db.query(models.User)
                    .filter(models.User.id == provider.user_id)
                    .first()
                )
                if provider_user:
                    provider_name = provider_user.full_name or ""
                    provider_location = provider_user.location or ""
                    provider_lat = provider_user.lat
                    provider_long = provider_user.long

        results.append(
            schemas.BookingWithDetails(
                id=booking.id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=booking.status,
                service_name=service.name if service else "",
                service_duration_minutes=service.duration_minutes if service else 0,
                service_price_gyd=(
                    float(service.price_gyd or 0.0)
                    if service and service.price_gyd is not None
                    else 0.0
                ),
                customer_name=user.full_name or "",
                customer_phone=user.phone or "",
                provider_name=provider_name,
                provider_location=provider_location,
                provider_lat=provider_lat,
                provider_long=provider_long,
            )
        )

    return results



def cancel_booking_for_customer(
    db: Session, booking_id: int, customer_id: int
) -> Optional[models.Booking]:
    """
    Cancel a booking for a given customer.

    Returns the updated booking or None if not found / not owned by customer.
    """
    booking = (
        db.query(models.Booking)
        .filter(
            models.Booking.id == booking_id,
            models.Booking.customer_id == customer_id,
        )
        .first()
    )

    if not booking:
        return None

    # Only allow cancellation from certain states
    if booking.status not in ("confirmed", "pending"):
        return booking  # already cancelled/completed, no-op

    booking.status = "cancelled"
    db.commit()
    db.refresh(booking)
    return booking




def cancel_booking_for_provider(
    db: Session, booking_id: int, provider_id: int
) -> bool:

    booking = (
        db.query(models.Booking)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .filter(
            models.Booking.id == booking_id,
            models.Provider.id == provider_id,
        )
        .first()
    )

    if not booking:
        return False

    service = (
        db.query(models.Service)
        .filter(models.Service.id == booking.service_id)
        .first()
    )

    customer = (
        db.query(models.User)
        .filter(models.User.id == booking.customer_id)
        .first()
    )

    booking.status = "cancelled"
    db.commit()
    db.refresh(booking)

    if customer and service:
        send_whatsapp(
            customer.whatsapp,
            (
                "❌ Your appointment was cancelled by the provider.\n"
                f"Service: {service.name}\n"
                f"Time: {booking.start_time.strftime('%d %b %Y at %I:%M %p')}"
            ),
        )

        send_push(
            customer.expo_push_token,
            "Appointment cancelled",
            f"Your provider cancelled {service.name} "
            f"scheduled for {booking.start_time.strftime('%d %b %Y at %I:%M %p')}",
        )

    return True


def get_or_create_working_hours_for_provider(db: Session, provider_id: int):
    """
    Return a list of 7 working-hours rows for this provider.
    If none exist yet, create closed rows with default times.
    """
    rows = (
        db.query(models.ProviderWorkingHours)
        .filter(models.ProviderWorkingHours.provider_id == provider_id)
        .order_by(models.ProviderWorkingHours.weekday.asc())
        .all()
    )

    if len(rows) == 0:
        # create default 7 days, all closed
        defaults = []
        for weekday in range(7):
            wh = models.ProviderWorkingHours(
                provider_id=provider_id,
                weekday=weekday,
                is_closed=True,
                start_time="09:00",
                end_time="17:00",
            )
            db.add(wh)
            defaults.append(wh)
        db.commit()
        for wh in defaults:
            db.refresh(wh)
        rows = defaults

    return rows

def set_working_hours_for_provider(db: Session, provider_id: int, hours_list):
    """
    hours_list is a list of dicts with keys:
    weekday, is_closed, start_time, end_time
    """
    existing = {
        wh.weekday: wh
        for wh in db.query(models.ProviderWorkingHours)
        .filter(models.ProviderWorkingHours.provider_id == provider_id)
        .all()
    }

    for item in hours_list:
        weekday = item["weekday"]
        is_closed = item.get("is_closed", True)
        start_time = item.get("start_time")
        end_time = item.get("end_time")

        wh = existing.get(weekday)
        if wh is None:
            wh = models.ProviderWorkingHours(
                provider_id=provider_id,
                weekday=weekday,
            )
            db.add(wh)

        wh.is_closed = is_closed
        wh.start_time = start_time
        wh.end_time = end_time

    db.commit()

    # return updated rows
    rows = (
        db.query(models.ProviderWorkingHours)
        .filter(models.ProviderWorkingHours.provider_id == provider_id)
        .order_by(models.ProviderWorkingHours.weekday.asc())
        .all()
    )
    return rows

def get_professions_for_provider(db: Session, provider_id: int) -> List[str]:
    rows = (
        db.query(models.ProviderProfession)
        .filter(models.ProviderProfession.provider_id == provider_id)
        .order_by(models.ProviderProfession.id.asc())
        .all()
    )
    return [r.name for r in rows]


def set_professions_for_provider(
    db: Session, provider_id: int, professions: List[str]
) -> List[str]:
    """
    Replace this provider's profession list with the given values.
    Deduplicates and strips empty strings.
    """
    # Remove existing professions
    db.query(models.ProviderProfession).filter(
        models.ProviderProfession.provider_id == provider_id
    ).delete()

    cleaned: List[str] = []
    for name in professions or []:
        if not name:
            continue
        n = name.strip()
        if not n:
            continue
        # case-insensitive dedupe
        if any(existing.lower() == n.lower() for existing in cleaned):
            continue
        cleaned.append(n)

    for name in cleaned:
        db.add(models.ProviderProfession(provider_id=provider_id, name=name))

    db.commit()

    rows = (
        db.query(models.ProviderProfession)
        .filter(models.ProviderProfession.provider_id == provider_id)
        .order_by(models.ProviderProfession.id.asc())
        .all()
    )
    return [r.name for r in rows]


def get_provider_availability(
    db: Session,
    provider_id: int,
    service_id: int,
    days: int = 14,
):
    """
    Compute availability for a provider for a given service over the next `days`.
    Returns a list of dicts:
    {
      "date": date,
      "slots": [datetime, datetime, ...]
    }
    """

    # Make sure the service exists and belongs to this provider
    service = (
        db.query(models.Service)
        .filter(
            models.Service.id == service_id,
            models.Service.provider_id == provider_id,
        )
        .first()
    )
    if not service:
        raise ValueError("Service not found for this provider")

    # Load working hours (creates defaults if missing)
    working_hours = get_or_create_working_hours_for_provider(db, provider_id)

    # Map weekday -> working hours row (only open days with valid times)
    wh_by_weekday = {}
    for wh in working_hours:
        if wh.is_closed:
            continue
        if not wh.start_time or not wh.end_time:
            continue
        wh_by_weekday[wh.weekday] = wh

    availability = []

    now = now_local_naive()   # ⬅ use Guyana local “now”

    slot_duration = timedelta(minutes=service.duration_minutes)

    for offset in range(days):
        day_date = (now + timedelta(days=offset)).date()
        weekday = day_date.weekday()

        wh = wh_by_weekday.get(weekday)
        if not wh:
            # Closed or no hours for this weekday
            continue

        # Parse "HH:MM"
        try:
            start_hour, start_minute = map(int, (wh.start_time or "09:00").split(":"))
            end_hour, end_minute = map(int, (wh.end_time or "17:00").split(":"))
        except ValueError:
            # Bad time format – skip this day
            continue

        day_start = datetime(day_date.year, day_date.month, day_date.day, start_hour, start_minute)
        day_end = datetime(day_date.year, day_date.month, day_date.day, end_hour, end_minute)

        # Don't offer slots in the past for *today*
        if day_date == now.date() and now > day_start:
            # Round "now" down to nearest minute
            day_start = now.replace(second=0, microsecond=0)

        # Get existing confirmed bookings for this provider on that day
        bookings = (
            db.query(models.Booking)
            .join(models.Service, models.Booking.service_id == models.Service.id)
            .filter(
                models.Service.provider_id == provider_id,
                models.Booking.start_time >= day_start,
                models.Booking.start_time < day_end,
                models.Booking.status == "confirmed",
            )
            .all()
        )

        def overlaps(slot_start, slot_end, booking):
            # True if times intersect
            return not (slot_end <= booking.start_time or slot_start >= booking.end_time)

        slot_start = day_start
        slots_for_day = []

        while slot_start + slot_duration <= day_end:
            slot_end = slot_start + slot_duration

            # Check for overlap with any existing booking
            conflict = False
            for b in bookings:
                if overlaps(slot_start, slot_end, b):
                    conflict = True
                    break

            if not conflict:
                slots_for_day.append(slot_start)

            # Step forward by the service duration (so slots line up)
            slot_start += slot_duration

        if slots_for_day:
            availability.append(
                {
                    "date": day_date,
                    "slots": slots_for_day,
                }
            )

    return availability


def list_todays_bookings_for_provider(db: Session, provider_id: int):
    """
    All *confirmed* bookings for this provider whose start_time is today.
    """
    now = now_local_naive()   # ⬅ Guyana local date for “today”
    start_of_day = datetime(now.year, now.month, now.day)
    end_of_day = start_of_day + timedelta(days=1)

    q = (
        db.query(models.Booking, models.Service, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(
            models.Service.provider_id == provider_id,
            models.Booking.start_time >= start_of_day,
            models.Booking.start_time < end_of_day,
            models.Booking.status == "confirmed",
        )
        .order_by(models.Booking.start_time)
    )

    results = []
    for booking, service, customer in q.all():
        results.append(
            schemas.BookingWithDetails(
                id=booking.id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=booking.status,
                service_name=service.name,
                service_duration_minutes=service.duration_minutes,
                service_price_gyd=service.price_gyd or 0.0,
                customer_name=customer.full_name or "",
                customer_phone=customer.phone or "",
            )
        )
    return results


def list_upcoming_bookings_for_provider(
    db: Session,
    provider_id: int,
    days_ahead: int = 7,
):
    """
    All confirmed bookings for this provider from *tomorrow* up to N days in the future.
    """
    now = now_local_naive()   # ⬅ Guyana local date for “today”
    start = now + timedelta(days=1)
    start_of_tomorrow = datetime(start.year, start.month, start.day)
    end = start_of_tomorrow + timedelta(days=days_ahead)

    q = (
      db.query(models.Booking, models.Service, models.User)
      .join(models.Service, models.Booking.service_id == models.Service.id)
      .join(models.User, models.Booking.customer_id == models.User.id)
      .filter(
          models.Service.provider_id == provider_id,
          models.Booking.start_time >= start_of_tomorrow,
          models.Booking.start_time < end,
          models.Booking.status == "confirmed",
      )
      .order_by(models.Booking.start_time)
    )

    results = []
    for booking, service, customer in q.all():
        results.append(
            schemas.BookingWithDetails(
                id=booking.id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=booking.status,
                service_name=service.name,
                service_duration_minutes=service.duration_minutes,
                service_price_gyd=service.price_gyd or 0.0,
                customer_name=customer.full_name or "",
                customer_phone=customer.phone or "",
            )
        )
    return results


def update_provider(
    db: Session,
    provider_id: int,
    provider_update: schemas.ProviderUpdate,
) -> Optional[models.Provider]:
    """
    Partially update a provider using fields from ProviderUpdate.
    Only fields that are actually provided (exclude_unset=True) are changed.
    """
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .first()
    )
    if not provider:
        return None

    update_data = provider_update.dict(exclude_unset=True)

    # professions is handled via the ProviderProfession join table,
    # so for now we ignore it here (or you can add custom logic).
    professions = update_data.pop("professions", None)

    for field, value in update_data.items():
        if hasattr(provider, field):
            setattr(provider, field, value)

    db.commit()
    db.refresh(provider)
    return provider


# def cancel_booking_for_provider(
#     db: Session, booking_id: int, provider_id: int
# ) -> bool:
#     """
#     Mark a booking as cancelled if it belongs to this provider.
#     """
#     booking = (
#         db.query(models.Booking)
#         .join(models.Service, models.Booking.service_id == models.Service.id)
#         .filter(
#             models.Booking.id == booking_id,
#             models.Service.provider_id == provider_id,
#         )
#         .first()
#     )
#     if not booking:
#         return False

#     booking.status = "cancelled"
#     db.commit()
#     return True



