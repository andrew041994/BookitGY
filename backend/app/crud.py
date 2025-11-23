from datetime import datetime, timedelta, date
from decimal import Decimal
import os
from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from twilio.rest import Client

from . import models, schemas


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

def hash_password(password: str) -> str:
    """Return a secure hash for the given plaintext password."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify that a plaintext password matches a stored hash."""
    return pwd_context.verify(plain, hashed)



# ---------------------------------------------------------------------------
# provider dashboard
# ---------------------------------------------------------------------------

def get_provider_by_user_id(db: Session, user_id: int):
    return db.query(models.Provider).filter(models.Provider.user_id == user_id).first()

def create_provider_for_user(db: Session, user: models.User):
    provider = models.Provider(user_id=user.id, bio="")
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider

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

def get_or_create_provider_for_user(db: Session, user_id: int):
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.user_id == user_id)
        .first()
    )
    if provider:
        return provider

    provider = models.Provider(user_id=user_id, bio="")
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


# ---------------------------------------------------------------------------
# Twilio / WhatsApp helper
# ---------------------------------------------------------------------------

twilio_client = None
if os.getenv("TWILIO_ACCOUNT_SID"):
    twilio_client = Client(
        os.getenv("TWILIO_ACCOUNT_SID"),
        os.getenv("TWILIO_AUTH_TOKEN"),
    )

FROM_NUMBER = os.getenv("TWILIO_WHATSAPP_FROM")


def send_whatsapp(to: str, body: str) -> None:
    """Send a WhatsApp message, or log a preview if Twilio isn't configured."""
    if not twilio_client or not to or not FROM_NUMBER:
        print(f"[WhatsApp Preview] To {to}: {body}")
        return

    try:
        twilio_client.messages.create(from_=FROM_NUMBER, body=body, to=to)
    except Exception as e:
        print(f"WhatsApp error: {e}")


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

def create_booking(db: Session, booking: schemas.BookingCreate, customer_id: int):
    service = (
        db.query(models.Service)
        .filter(models.Service.id == booking.service_id)
        .first()
    )
    if not service:
        raise ValueError("Service not found")

    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == service.provider_id)
        .first()
    )
    if not provider:
        raise ValueError("Provider not found")

    provider_user = (
        db.query(models.User)
        .filter(models.User.id == provider.user_id)
        .first()
    )

    # Check if provider is locked (unpaid bill past due)
    overdue = (
        db.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.is_paid.is_(False),
            models.Bill.due_date < datetime.utcnow(),
        )
        .first()
    )
    if overdue:
        raise ValueError("Provider account is locked due to unpaid bill")

    # Apply promotion
    promo = get_promotion(db, provider.id)
    fee_applied = Decimal("0.1") * Decimal(str(service.price_gyd))
    if promo and promo.free_bookings_used < promo.free_bookings_total:
        fee_applied = Decimal("0")
        promo.free_bookings_used += 1

    # Create booking
        # Make sure this time slot is still free for this provider
    proposed_start = booking.start_time
    proposed_end = booking.start_time + timedelta(minutes=service.duration_minutes)

    overlapping = (
        db.query(models.Booking)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .filter(
            models.Service.provider_id == provider.id,
            models.Booking.status == "confirmed",
            # overlap: existing.start < proposed_end AND existing.end > proposed_start
            models.Booking.start_time < proposed_end,
            models.Booking.end_time > proposed_start,
        )
        .first()
    )

    if overlapping:
        # Another booking already grabbed this slot
        raise ValueError("This time slot has just been booked. Please choose another time.")


    end_time = booking.start_time + timedelta(minutes=service.duration_minutes)
    db_booking = models.Booking(
        customer_id=customer_id,
        service_id=booking.service_id,
        start_time=booking.start_time,
        end_time=end_time,
        status="confirmed",
    )
    db.add(db_booking)
    db.commit()
    db.refresh(db_booking)

    # WhatsApp notifications
    customer = (
        db.query(models.User)
        .filter(models.User.id == customer_id)
        .first()
    )

    if customer and provider_user:
        send_whatsapp(
            customer.whatsapp,
            (
                "Booking confirmed!\n"
                f"{service.name} with {provider_user.full_name}\n"
                f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}\n"
                f"GYD {service.price_gyd}"
            ),
        )
        send_whatsapp(
            provider_user.whatsapp,
            (
                "New booking!\n"
                f"{customer.full_name} booked {service.name}\n"
                f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}"
            ),
        )

    return db_booking


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

def generate_monthly_bills(db: Session, month: date):
    """Generate bills for all providers for the given month."""
    providers = db.query(models.Provider).all()

    for prov in providers:
        start = month.replace(day=1)
        end = (month.replace(day=1) + timedelta(days=32)).replace(day=1)

        total = (
            db.query(func.sum(models.Service.price_gyd))
            .join(models.Booking)
            .filter(
                models.Booking.service_id == models.Service.id,
                models.Booking.start_time >= start,
                models.Booking.start_time < end,
                models.Booking.status == "confirmed",
                models.Service.provider_id == prov.id,
            )
            .scalar()
            or 0
        )

        fee = Decimal("0.1") * Decimal(str(total))
        due = datetime(end.year, end.month, 15, 23, 59)

        bill = models.Bill(
            provider_id=prov.id,
            month=start,
            total_gyd=total,
            fee_gyd=fee,
            due_date=due,
        )
        db.add(bill)

        provider_user = (
            db.query(models.User)
            .filter(models.User.id == prov.user_id)
            .first()
        )
        if provider_user:
            send_whatsapp(
                provider_user.whatsapp,
                (
                    f"New bill for {start.strftime('%B %Y')}\n"
                    f"Total bookings: GYD {total}\n"
                    f"Your fee (10%): GYD {fee}\n"
                    f"Due: 15 {end.strftime('%B %Y')}"
                ),
            )

    db.commit()


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

def cancel_booking_for_provider(db: Session, booking_id: int, provider_id: int) -> bool:
    """
    Set a booking's status to 'cancelled' if it belongs to this provider.
    Returns True if updated, False if not found.
    """
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

    booking.status = "cancelled"
    db.commit()
    db.refresh(booking)
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

    now = datetime.utcnow()
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
    now = datetime.utcnow()
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
    now = datetime.utcnow()
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


def cancel_booking_for_provider(
    db: Session, booking_id: int, provider_id: int
) -> bool:
    """
    Mark a booking as cancelled if it belongs to this provider.
    """
    booking = (
        db.query(models.Booking)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .filter(
            models.Booking.id == booking_id,
            models.Service.provider_id == provider_id,
        )
        .first()
    )
    if not booking:
        return False

    booking.status = "cancelled"
    db.commit()
    return True



