from datetime import datetime, timedelta, date
from decimal import Decimal
import os

from sqlalchemy import func
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from twilio.rest import Client

from . import models, schemas


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


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


def hash_password(password: str) -> str:
    """Return a secure hash for the given plaintext password."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify that a plaintext password matches a stored hash."""
    return pwd_context.verify(plain, hashed)


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
