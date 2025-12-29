import os
from datetime import datetime, timedelta, date, timezone
from dateutil import tz
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List
from sqlalchemy import func, cast, String, case
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from passlib.context import CryptContext
from twilio.rest import Client
import requests
import hashlib
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
DEFAULT_SERVICE_CHARGE_PERCENTAGE = Decimal("10.0")


def normalized_booking_status_value(status: str | None) -> str:
    normalized = (status or "").strip().lower()
    if normalized == "canceled":
        return "cancelled"
    return normalized


def normalized_booking_status_expr():
    raw_status = func.lower(
        func.trim(func.coalesce(cast(models.Booking.status, String), ""))
    )
    return case((raw_status == "canceled", "cancelled"), else_=raw_status)

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

def _normalize_display_name(name: Optional[str]) -> Optional[str]:
    if name is None:
        return None
    cleaned = name.strip().lower()
    return cleaned or None


def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def get_display_name(user: Optional[models.User]) -> str:
    if not user:
        return ""
    return user.username or user.email or ""


def set_username_from_full_name(
    db: Session,
    user: models.User,
    full_name: Optional[str],
) -> None:
    normalized = _normalize_display_name(full_name)
    if not normalized:
        return

    if user.username == normalized:
        return

    existing = get_user_by_username(db, normalized)
    if existing and existing.id != user.id:
        raise ValueError("Username already taken")

    user.username = normalized

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

def get_provider_for_user(db: Session, user_id: int):
    """
    Backwards-compatible alias for fetching a provider by user_id.
    Used by the profile routes (e.g. /providers/me/profile).
    """
    return get_provider_by_user_id(db, user_id)


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
        services = [svc.name for svc in list_services_for_provider(db, provider.id)]

        results.append(
            {
                "provider_id": provider.id,
                "name": get_display_name(user),
                "location": user.location or "",
                "lat": user.lat,
                "long": user.long,
                "bio": provider.bio or "",
                "professions": professions,
                "services": services,
                "avatar_url": provider.avatar_url,
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
                f"{service.name} with {get_display_name(provider_user)}\n"
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
                f"{get_display_name(customer)} booked {service.name}\n"
                f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}"
            ),
        )

    # Push notifications (one each)
    send_push(
        customer.expo_push_token,
        "Booking confirmed",
        f"{service.name} with {get_display_name(provider_user)} on "
        f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}",
    )

    send_push(
        provider_user.expo_push_token,
        "New booking",
        f"{get_display_name(customer)} booked {service.name} on "
        f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}",
    )




# ---------------------------------------------------------------------------
# User CRUD + authentication
# ---------------------------------------------------------------------------

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """Create a new user with hashed password."""
    hashed = hash_password(user.password)
    user_data = user.dict(exclude={"password"})
    user_data["username"] = normalize_username(user.username)
    db_user = models.User(
        **user_data,
        hashed_password=hashed,
        is_email_verified=False,
    )
    db.add(db_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(db_user)
    return db_user


def get_user_by_email(db: Session, email: str):
    """Return user by email, or None if not found."""
    if not email:
        return None
    normalized = email.strip().lower()
    return (
        db.query(models.User)
        .filter(func.lower(models.User.email) == normalized)
        .first()
    )


def get_user_by_id(db: Session, user_id: int):
    """Return user by id, or None if not found."""
    return db.query(models.User).filter(models.User.id == user_id).first()


def get_user_by_username(db: Session, username: str):
    """Return user by username, or None if not found."""
    normalized = normalize_username(username)
    return (
        db.query(models.User)
        .filter(func.lower(models.User.username) == normalized)
        .first()
    )


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


def verify_user_email(db: Session, user: models.User) -> models.User:
    """Mark a user's email as verified."""
    user.is_email_verified = True
    user.email_verified_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
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
        "whatsapp",
        "location",
        "avatar_url",
    }

    for field, value in update_data.items():
        if field in ALLOWED_USER_FIELDS:
            setattr(user, field, value)

    if "full_name" in update_data:
        set_username_from_full_name(db, user, update_data.get("full_name"))

    db.commit()
    db.refresh(user)
    return user

def set_user_password(db: Session, user: models.User, new_password: str) -> models.User:
    """Update a user's password with a freshly hashed value."""

    user.hashed_password = hash_password(new_password)
    db.commit()
    db.refresh(user)
    return user


def set_user_password_reset(
    db: Session,
    user: models.User,
    new_password: str,
) -> models.User:
    """Update a user's password and mark the reset timestamp."""

    user.hashed_password = hash_password(new_password)
    user.password_reset_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def invalidate_password_reset_tokens(
    db: Session,
    user_id: int,
) -> int:
    """Mark all unused password reset tokens as used for a given user."""
    now = datetime.now(timezone.utc)
    tokens = (
        db.query(models.PasswordResetToken)
        .filter(
            models.PasswordResetToken.user_id == user_id,
            models.PasswordResetToken.used_at.is_(None),
        )
        .all()
    )
    for token in tokens:
        token.used_at = now
    if tokens:
        db.commit()
    return len(tokens)


def create_password_reset_token(
    db: Session,
    user_id: int,
    token_hash: str,
    expires_at: datetime,
) -> models.PasswordResetToken:
    token = models.PasswordResetToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def get_password_reset_token_by_hash(
    db: Session,
    token_hash: str,
) -> Optional[models.PasswordResetToken]:
    return (
        db.query(models.PasswordResetToken)
        .filter(models.PasswordResetToken.token_hash == token_hash)
        .first()
    )


def mark_password_reset_token_used(
    db: Session,
    token: models.PasswordResetToken,
) -> models.PasswordResetToken:
    token.used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(token)
    return token

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


def create_bill_credit(db: Session, provider_id: int, amount_gyd: float):
    credit = models.BillCredit(
        provider_id=provider_id,
        amount_gyd=Decimal(str(amount_gyd or 0)),
    )
    db.add(credit)
    db.commit()
    db.refresh(credit)
    return credit


def get_provider_credit_balance(db: Session, provider_id: int) -> float:
    total = (
        db.query(func.coalesce(func.sum(models.BillCredit.amount_gyd), 0))
        .filter(models.BillCredit.provider_id == provider_id)
        .scalar()
    )
    return float(total or 0.0)


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
        raise ValueError("Service not found")

    # Load provider
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == service.provider_id)
        .first()
    )
    if not provider:
        raise ValueError("Provider not found for this service")

    # Load provider user
    provider_user = (
        db.query(models.User)
        .filter(models.User.id == provider.user_id)
        .first()
    )
    if not provider_user:
        raise ValueError("Provider user not found")

    # Current local time (Guyana, naive to match DB usage)
    now = now_local_naive()

    # Defensive: do not allow bookings in the past
    if booking.start_time <= now:
        raise ValueError("Cannot book a time in the past")

    # Compute end time based on service duration
    end_time = booking.start_time + timedelta(
        minutes=service.duration_minutes
    )

    # Check overlapping *future/ongoing* confirmed bookings for this same service
    normalized_status = normalized_booking_status_expr()

    overlap = (
        db.query(models.Booking)
        .filter(models.Booking.service_id == booking.service_id)
        .filter(normalized_status == "confirmed")
        .filter(models.Booking.end_time > now)  # ignore bookings that already ended
        .filter(
            models.Booking.start_time < end_time,
            models.Booking.end_time > booking.start_time,
        )
        .first()
    )

    if overlap:
        # This slot is taken
        raise ValueError("Selected slot is no longer available")

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

def _clamp_service_charge(percentage: float) -> Decimal:
    """Normalize a service charge percentage to the 0-100 range as Decimal."""

    pct = Decimal(str(percentage or 0))
    pct = max(Decimal("0"), min(Decimal("100"), pct))
    return pct


def get_or_create_platform_settings(db: Session) -> models.PlatformSetting:
    settings = db.query(models.PlatformSetting).first()
    if not settings:
        settings = models.PlatformSetting(
            service_charge_percentage=float(DEFAULT_SERVICE_CHARGE_PERCENTAGE)
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def get_platform_service_charge_percentage(db: Session) -> Decimal:
    settings = get_or_create_platform_settings(db)
    pct = settings.service_charge_percentage
    if pct is None:
        return DEFAULT_SERVICE_CHARGE_PERCENTAGE
    return _clamp_service_charge(pct)


def update_platform_service_charge(db: Session, percentage: float) -> Decimal:
    settings = get_or_create_platform_settings(db)
    pct = _clamp_service_charge(percentage)
    settings.service_charge_percentage = float(pct)
    db.commit()
    db.refresh(settings)
    return pct


def _auto_complete_finished_bookings(
    db: Session, provider_id: int | None = None, as_of: datetime | None = None
) -> None:
    """
    Mark in-past bookings as completed so billing can rely on explicit completion.

    Only transitions ``confirmed`` → ``completed`` when the appointment has
    already ended. Cancelled and already-completed bookings are left untouched.
    """

    cutoff = as_of or datetime.utcnow()

    query = db.query(models.Booking).filter(
        models.Booking.end_time.isnot(None),
        models.Booking.end_time <= cutoff,
    )

    if provider_id is not None:
        query = query.join(models.Service, models.Booking.service_id == models.Service.id).filter(
            models.Service.provider_id == provider_id
        )

    stale_bookings = query.all()

    for booking in stale_bookings:
        if normalized_booking_status_value(booking.status) != "confirmed":
            continue

        if not booking.end_time:
            continue

        if booking.end_time > cutoff:
            continue

        booking.status = "completed"

    if stale_bookings:
        db.commit()


def generate_monthly_bills(db: Session, month: date):
    """
    Generate or update bills for all providers for the given month.

    - Only counts bookings that are:
        * completed (booking has ended) and not cancelled
        * belong to this provider
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

    # Ensure past bookings are marked completed before calculating billing windows
    _auto_complete_finished_bookings(db, as_of=period_end)

    for prov in providers:
        total = (
            _billable_bookings_base_query(db, prov.id, as_of=period_end)
            .with_entities(func.sum(models.Service.price_gyd))
            .filter(
                models.Booking.end_time >= start_dt,
                models.Booking.end_time < period_end,
            )
            .scalar()
            or 0
        )

        # Platform fee on completed bookings using admin-configured percentage
        service_charge_pct = get_platform_service_charge_percentage(db)
        fee_rate = service_charge_pct / Decimal("100")
        fee = fee_rate * Decimal(str(total))

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







def _calculate_bill_total_due(db: Session, bill: models.Bill, provider_id: int) -> float:
    """Mirror the provider-facing bill "Total due" for a given bill."""

    total_due = Decimal(str(bill.fee_gyd or 0)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    credits = Decimal(str(get_provider_credit_balance(db, provider_id) or 0))
    # Bill credits should only ever reduce what a provider owes. If the balance is
    # negative (e.g., from a bad manual entry), clamp it to zero so we don't
    # accidentally inflate the amount due.
    credits = max(credits, Decimal("0"))

    net_due = (total_due - credits).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if net_due < 0:
        net_due = Decimal("0")

    return float(net_due)


from datetime import date
from decimal import Decimal

from app.config import get_settings
from app import models
# get_provider_credit_balance should already be defined in this file

CANCELLED_STATUSES = {"cancelled"}


def _is_cancelled_status(status: str | None) -> bool:
    return normalized_booking_status_value(status) == "cancelled"


def _billable_bookings_base_query(
    db: Session, provider_id: int, as_of: datetime | None = None
):
    """Return a base query for bookings that are eligible for billing.

    Eligibility rules (applied consistently across billing calculations):
    - Booking is NOT cancelled.
    - Booking has ended.
    - Appointment end time is on or before the cutoff.
    """

    cutoff = as_of or datetime.utcnow()

    normalized_status = normalized_booking_status_expr()

    return (
        db.query(models.Booking, models.Service, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(
            models.Provider.id == provider_id,
            normalized_status.in_(["completed", "confirmed"]),
            models.Booking.end_time.isnot(None),
            models.Booking.end_time <= cutoff,
        )
    )


def _billing_period_bounds(reference: datetime) -> tuple[datetime, datetime]:
    """Return start/end datetimes covering the month containing ``reference``."""

    start = datetime(reference.year, reference.month, 1)
    if reference.month == 12:
        end = datetime(reference.year + 1, 1, 1)
    else:
        end = datetime(reference.year, reference.month + 1, 1)

    return start, end


def get_provider_fees_due(db: Session, provider_id: int) -> float:
    """
    Compute the *current month's* amount due for this provider in GYD,
    using only completed (ended) and non-cancelled bookings.

    Logic:
    - Look at bookings that have ended (end_time <= now) and are not cancelled,
    - Take only those whose service date falls in the current calendar month,
    - Sum the service prices for those bookings,
    - Apply the platform service charge percentage,
    - Subtract bill credits (but never go below 0).

    This intentionally ignores the stored Bill rows and instead computes
    the amount due from live booking data so the admin dashboard matches
    what the provider sees.
    """
    now_utc = datetime.utcnow()
    period_start, period_end = _billing_period_bounds(now_utc)

    _auto_complete_finished_bookings(db, provider_id=provider_id, as_of=now_utc)

    rows = (
        _billable_bookings_base_query(db, provider_id, as_of=now_utc)
        .filter(
            models.Booking.end_time >= period_start,
            models.Booking.end_time < period_end,
        )
        .with_entities(
            models.Booking.end_time,
            models.Booking.status,
            models.Service.price_gyd.label("service_price_gyd"),
        )
        .all()
    )

    services_total = Decimal("0")
    for r in rows:
        end_time = r.end_time
        if not end_time:
            continue

        if _is_cancelled_status(r.status):
            continue

        price = r.service_price_gyd or 0
        services_total += Decimal(str(price))

    if services_total <= 0:
        return 0.0

    service_charge_pct = get_platform_service_charge_percentage(db)
    fee_rate = Decimal(str(max(service_charge_pct, 0))) / Decimal("100")

    platform_fee = services_total * fee_rate
    platform_fee = platform_fee.quantize(Decimal("1"))

    if platform_fee <= 0:
        return 0.0

    credits = Decimal(str(get_provider_credit_balance(db, provider_id) or 0))
    applied_credits = min(credits, platform_fee)
    total_due = platform_fee - applied_credits

    if total_due < 0:
        total_due = Decimal("0")

    return float(total_due)




def get_provider_current_month_due_from_completed_bookings(
    db: Session, provider_id: int
) -> float:
    """
    Compute the provider's current-month amount due using only completed (ended)
    and non-cancelled bookings.

    This is intentionally aligned with the provider-facing billing screen logic:
    - Uses the same billable-bookings semantics as provider invoices,
    - Filters those bookings to the current calendar month,
    - Applies the platform service charge percentage,
    - Applies available bill credits, but never returns a negative value.
    """
    now = datetime.utcnow()
    period_start, period_end = _billing_period_bounds(now)

    _auto_complete_finished_bookings(db, provider_id=provider_id, as_of=now)

    rows = (
        _billable_bookings_base_query(db, provider_id, as_of=now)
        .filter(
            models.Booking.end_time >= period_start,
            models.Booking.end_time < period_end,
        )
        .with_entities(
            models.Booking.end_time,
            models.Booking.status,
            models.Service.price_gyd.label("service_price_gyd"),
        )
        .order_by(models.Booking.end_time.asc())
        .all()
    )

    services_total = Decimal("0")
    for r in rows:
        if _is_cancelled_status(r.status):
            continue

        price = r.service_price_gyd or 0
        services_total += Decimal(str(price))

    if services_total <= 0:
        return 0.0

    service_charge_pct = get_platform_service_charge_percentage(db)
    fee_rate = Decimal(str(max(service_charge_pct, 0))) / Decimal("100")
    platform_fee = services_total * fee_rate

    platform_fee = platform_fee.quantize(Decimal("1"))
    if platform_fee <= 0:
        return 0.0

    credits = Decimal(str(get_provider_credit_balance(db, provider_id) or 0))
    applied_credits = min(credits, platform_fee)
    total_due = platform_fee - applied_credits

    if total_due < 0:
        total_due = Decimal("0")

    return float(total_due)




def _provider_billing_row(db: Session, provider: models.Provider, user: models.User):
    latest_bill = (
        db.query(models.Bill)
        .filter(models.Bill.provider_id == provider.id)
        .order_by(models.Bill.due_date.desc())
        .first()
    )

    if latest_bill:
        amount_due = get_provider_current_month_due_from_completed_bookings(
            db, provider.id
        )
        is_paid = bool(latest_bill.is_paid)
    else:
        amount_due = 0.0
        is_paid = True

    return {
        "provider_id": provider.id,
        "name": get_display_name(user),
        "account_number": provider.account_number or "",
        "phone": user.phone or "",
        "amount_due_gyd": float(amount_due or 0.0),
        "is_paid": is_paid,
        "is_locked": bool(getattr(provider, "is_locked", False)),
        "last_due_date": latest_bill.due_date if latest_bill else None,
    }


def list_provider_billing_rows(db: Session):
    rows = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .all()
    )

    return [_provider_billing_row(db, provider, user) for provider, user in rows]


def get_provider_billing_row(db: Session, provider_id: int):
    row = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Provider.id == provider_id)
        .first()
    )

    if not row:
        return None

    provider, user = row
    return _provider_billing_row(db, provider, user)


def set_provider_bills_paid_state(db: Session, provider_id: int, is_paid: bool) -> int:
    updated = (
        db.query(models.Bill)
        .filter(models.Bill.provider_id == provider_id)
        .update({models.Bill.is_paid: is_paid}, synchronize_session=False)
    )

    db.commit()
    return updated


def set_provider_lock_state(db: Session, provider_id: int, is_locked: bool) -> int:
    updated = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .update({models.Provider.is_locked: is_locked}, synchronize_session=False)
    )

    db.commit()
    return updated


def list_bookings_for_provider(db: Session, provider_id: int):
    """Return all bookings for this provider, newest first."""

    rows = (
        db.query(
            models.Booking.id,
            models.Booking.start_time,
            models.Booking.end_time,
            models.Booking.status,
            models.Service.name.label("service_name"),
            models.Service.price_gyd.label("service_price_gyd"),
            models.User.username.label("customer_name"),
        )
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(models.Provider.id == provider_id)
        .order_by(models.Booking.start_time.desc())
        .all()
    )

    return [
        {
            "id": r.id,
            "service_name": r.service_name,
            "service_price_gyd": float(r.service_price_gyd or 0.0),
            "customer_name": r.customer_name,
            "start_time": r.start_time,
            "end_time": r.end_time,
            "status": normalized_booking_status_value(r.status),
            "canceled_at": None,
            "completed_at": None,
        }
        for r in rows
    ]


def get_billable_bookings_for_provider(
    db: Session,
    provider_id: int,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
    as_of: datetime | None = None,
):
    """
    Return bookings eligible for billing (completed + not cancelled).

    This uses the shared billing eligibility rules and includes client/service
    details needed for invoice line-items.
    """

    cutoff = as_of or datetime.utcnow()
    default_start, default_end = _billing_period_bounds(cutoff)

    period_start = period_start or default_start
    period_end = period_end or default_end
    _auto_complete_finished_bookings(db, provider_id=provider_id, as_of=cutoff)

    rows = (
        _billable_bookings_base_query(db, provider_id, as_of=cutoff)
        .filter(
            models.Booking.end_time >= period_start,
            models.Booking.end_time < period_end,
        )
        .with_entities(
            models.Booking.id,
            models.Booking.start_time,
            models.Booking.end_time,
            models.Booking.status,
            models.Service.name.label("service_name"),
            models.Service.price_gyd.label("service_price_gyd"),
            models.User.username.label("customer_name"),
        )
        .order_by(models.Booking.end_time.desc())
        .all()
    )

    billable_rows = []

    for r in rows:
        if _is_cancelled_status(r.status):
            continue

        billable_rows.append(
            {
                "id": r.id,
                "service_name": r.service_name,
                "service_price_gyd": float(r.service_price_gyd or 0.0),
                "customer_name": r.customer_name,
                "start_time": r.start_time,
                "end_time": r.end_time,
                "status": normalized_booking_status_value(r.status),
                "completed_at": None,
            }
        )

    return billable_rows


def list_billable_bookings_for_provider(
    db: Session,
    provider_id: int,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
    as_of: datetime | None = None,
):
    """Deprecated alias for backwards compatibility."""

    return get_billable_bookings_for_provider(
        db,
        provider_id,
        period_start=period_start,
        period_end=period_end,
        as_of=as_of,
    )


def _refresh_bill_for_booking(db: Session, booking: models.Booking) -> None:
    """Regenerate bills for the month containing this booking."""

    if not booking.start_time:
        return

    generate_monthly_bills(db, month=booking.start_time.date())


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
                    provider_name = get_display_name(provider_user)
                    provider_location = provider_user.location or ""
                    provider_lat = provider_user.lat
                    provider_long = provider_user.long

        results.append(
            schemas.BookingWithDetails(
                id=booking.id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=normalized_booking_status_value(booking.status),
                canceled_at=None,
                completed_at=None,
                service_name=service.name if service else "",
                service_duration_minutes=service.duration_minutes if service else 0,
                service_price_gyd=(
                    float(service.price_gyd or 0.0)
                    if service and service.price_gyd is not None
                    else 0.0
                ),
                customer_name=get_display_name(user),
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
    If the booking has already been auto-completed, this still forces the status
    back to "cancelled" so it won't be billed.
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

    normalized_status = normalized_booking_status_value(booking.status)

    if normalized_status == "completed":
        raise ValueError("Cannot cancel a completed booking")

    # If it's already cancelled, nothing to do
    if normalized_status == "cancelled":
        return booking

    booking.status = "cancelled"
    db.commit()
    db.refresh(booking)

    _refresh_bill_for_booking(db, booking)

    service = (
        db.query(models.Service)
        .filter(models.Service.id == booking.service_id)
        .first()
    )
    provider_user = None
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

    customer = (
        db.query(models.User)
        .filter(models.User.id == booking.customer_id)
        .first()
    )

    if provider_user and service and customer:
        send_whatsapp(
            provider_user.whatsapp,
            (
                "❌ Booking cancelled by customer.\n"
                f"{get_display_name(customer)} cancelled {service.name}\n"
                f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}"
            ),
        )

        send_push(
            provider_user.expo_push_token,
            "Booking cancelled",
            f"{get_display_name(customer)} cancelled {service.name} on "
            f"{booking.start_time.strftime('%d %b %Y at %I:%M %p')}",
        )

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

    normalized_status = normalized_booking_status_value(booking.status)

    if normalized_status == "completed":
        raise ValueError("Cannot cancel a completed booking")

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

    _refresh_bill_for_booking(db, booking)

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

def list_catalog_images_for_provider(db: Session, provider_id: int):
    return (
        db.query(models.ProviderCatalogImage)
        .filter(models.ProviderCatalogImage.provider_id == provider_id)
        .order_by(models.ProviderCatalogImage.created_at.desc())
        .all()
    )


def add_catalog_image_for_provider(
    db: Session,
    provider_id: int,
    image_url: str,
    caption: Optional[str] = None,
):
    item = models.ProviderCatalogImage(
        provider_id=provider_id,
        image_url=image_url,
        caption=caption or None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete_catalog_image_for_provider(
    db: Session,
    provider_id: int,
    image_id: int,
) -> bool:
    item = (
        db.query(models.ProviderCatalogImage)
        .filter(
            models.ProviderCatalogImage.id == image_id,
            models.ProviderCatalogImage.provider_id == provider_id,
        )
        .first()
    )
    if not item:
        return False

    db.delete(item)
    db.commit()
    return True



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

    # Use Guyana local "now"
    now = now_local_naive()

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

        day_start = datetime(
            day_date.year, day_date.month, day_date.day, start_hour, start_minute
        )
        day_end = datetime(
            day_date.year, day_date.month, day_date.day, end_hour, end_minute
        )

        is_today = (day_date == now.date())

        # Get existing confirmed bookings for this provider on that day
        normalized_status = normalized_booking_status_expr()

        bookings = (
            db.query(models.Booking)
            .join(models.Service, models.Booking.service_id == models.Service.id)
            .filter(
                models.Service.provider_id == provider_id,
                models.Booking.start_time >= day_start,
                models.Booking.start_time < day_end,
                normalized_status == "confirmed",
            )
            .all()
        )

        def overlaps(slot_start, slot_end, booking):
            # True if times intersect
            return not (
                slot_end <= booking.start_time or slot_start >= booking.end_time
            )

        slot_start = day_start
        slots_for_day = []

        while slot_start + slot_duration <= day_end:
            slot_end = slot_start + slot_duration

            # For *today*, don't offer slots that start in the past
            # (but keep them aligned to working hours)
            if is_today and slot_start <= now:
                slot_start += slot_duration
                continue

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
    All *confirmed* bookings for this provider whose start_time is today
    and that have not finished yet.
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
            models.Booking.end_time > now,
        )
        .order_by(models.Booking.start_time)
    )

    results = []
    for booking, service, customer in q.all():
        normalized_status = normalized_booking_status_value(booking.status)
        if normalized_status != "confirmed":
            continue

        results.append(
            schemas.BookingWithDetails(
                id=booking.id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=normalized_booking_status_value(booking.status),
                canceled_at=None,
                completed_at=None,
                service_name=service.name,
                service_duration_minutes=service.duration_minutes,
                service_price_gyd=service.price_gyd or 0.0,
                customer_name=get_display_name(customer),
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
      )
      .order_by(models.Booking.start_time)
    )

    results = []
    for booking, service, customer in q.all():
        normalized_status = normalized_booking_status_value(booking.status)
        if normalized_status != "confirmed":
            continue

        results.append(
            schemas.BookingWithDetails(
                id=booking.id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=normalized_booking_status_value(booking.status),
                canceled_at=None,
                completed_at=None,
                service_name=service.name,
                service_duration_minutes=service.duration_minutes,
                service_price_gyd=service.price_gyd or 0.0,
                customer_name=get_display_name(customer),
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
