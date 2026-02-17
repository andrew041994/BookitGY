import os
from datetime import datetime, timedelta, date
import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List
from sqlalchemy import func, cast, String, case, select, or_, desc
from sqlalchemy.orm import Session, aliased, joinedload
from sqlalchemy.exc import IntegrityError
from passlib.context import CryptContext
from twilio.rest import Client
import requests
import hashlib
import json
from . import models, schemas
from typing import Optional
from dotenv import load_dotenv, find_dotenv
from app.utils.passwords import validate_password
from app.utils.time import now_guyana, today_start_guyana, today_end_guyana

load_dotenv(find_dotenv(), override=False)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
DEFAULT_SERVICE_CHARGE_PERCENTAGE = Decimal("10.0")
SUSPENDED_PROVIDER_MESSAGE = (
    "Provider account is suspended and cannot accept bookings."
)


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
        db.query(models.Provider)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(
            models.User.is_deleted.is_(False),
            models.User.deleted_at.is_(None),
        )
        .options(joinedload(models.Provider.user))
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

    providers = q.all()

    results = []
    for provider in providers:
        user = provider.user
        professions = get_professions_for_provider(db, provider.id)
        services = [svc.name for svc in list_services_for_provider(db, provider.id)]

        results.append(
            {
                "provider_id": provider.id,
                "user_id": user.id,
                "name": get_display_name(user),
                "location": user.location or "",
                "lat": user.lat,
                "long": user.long,
                "user": {
                    "lat": user.lat,
                    "long": user.long,
                },
                "bio": provider.bio or "",
                "professions": professions,
                "services": services,
                "avatar_url": provider.avatar_url,
                "is_suspended": bool(getattr(user, "is_suspended", False)),
            }
        )

    return results


def list_admin_provider_locations(db: Session):
    rows = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .all()
    )

    results = []
    for provider, user in rows:
        results.append(
            {
                "provider_id": provider.id,
                "username": user.username,
                "email": user.email,
                "phone": user.phone,
                "lat": user.lat,
                "long": user.long,
                "account_number": provider.account_number,
                "location": user.location or "",
            }
        )

    return results


def list_admin_cancellation_stats(
    db: Session,
    *,
    month: int,
    year: int,
):
    try:
        start_dt = datetime(year, month, 1)
    except ValueError as exc:
        raise ValueError("Invalid cancellation month/year") from exc

    if month == 12:
        end_dt = datetime(year + 1, 1, 1)
    else:
        end_dt = datetime(year, month + 1, 1)

    provider_alias = aliased(models.Provider)

    cancellations_subquery = (
        db.query(
            provider_alias.id.label("provider_id"),
            func.sum(
                case(
                    (
                        or_(
                            models.Booking.canceled_by_role == "provider",
                            models.Booking.canceled_by_user_id == provider_alias.user_id,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("provider_cancelled_count"),
            func.sum(
                case(
                    (
                        or_(
                            models.Booking.canceled_by_role == "client",
                            models.Booking.canceled_by_user_id == models.Booking.customer_id,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("customer_cancelled_count"),
        )
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(provider_alias, models.Service.provider_id == provider_alias.id)
        .filter(
            models.Booking.start_time >= start_dt,
            models.Booking.start_time < end_dt,
            or_(
                normalized_booking_status_expr() == "cancelled",
                models.Booking.canceled_at.isnot(None),
            ),
        )
        .group_by(provider_alias.id)
        .subquery()
    )

    provider_cancelled = func.coalesce(cancellations_subquery.c.provider_cancelled_count, 0)
    customer_cancelled = func.coalesce(cancellations_subquery.c.customer_cancelled_count, 0)
    total_cancellations = (provider_cancelled + customer_cancelled).label("total_cancellations")

    rows = (
        db.query(
            models.Provider.id.label("provider_id"),
            models.User.username,
            models.User.email,
            models.User.phone,
            provider_cancelled.label("provider_cancelled_count"),
            customer_cancelled.label("customer_cancelled_count"),
            total_cancellations,
        )
        .join(models.User, models.Provider.user_id == models.User.id)
        .outerjoin(
            cancellations_subquery,
            cancellations_subquery.c.provider_id == models.Provider.id,
        )
        .order_by(desc(total_cancellations), models.Provider.id.asc())
        .all()
    )

    results = []
    for row in rows:
        results.append(
            {
                "provider_id": row.provider_id,
                "username": row.username,
                "email": row.email,
                "phone": row.phone,
                "provider_cancelled_count": int(row.provider_cancelled_count or 0),
                "customer_cancelled_count": int(row.customer_cancelled_count or 0),
                "total_cancellations": int(row.total_cancellations or 0),
            }
        )

    return results


def list_services_for_provider(
    db: Session,
    provider_id: int,
    *,
    include_inactive: bool = False,
):
    query = db.query(models.Service).filter(models.Service.provider_id == provider_id)
    if not include_inactive:
        query = query.filter(models.Service.is_active.is_(True))
    return query.order_by(models.Service.id.asc()).all()

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
    db: Session,
    service_id: int,
    provider_id: int,
    *,
    include_inactive: bool = True,
) -> Optional[models.Service]:
    query = db.query(models.Service).filter(
        models.Service.id == service_id,
        models.Service.provider_id == provider_id,
    )
    if not include_inactive:
        query = query.filter(models.Service.is_active.is_(True))
    return query.first()

def delete_service_for_provider(
    db: Session,
    service_id: int,
    provider_id: int,
) -> Optional[str]:
    svc = get_service_for_provider(db, service_id, provider_id, include_inactive=True)
    if not svc:
        return None
    if not svc.is_active:
        return "already_archived"
    svc.is_active = False
    db.commit()
    return "archived"

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

def delete_service(db: Session, provider_id: int, service_id: int) -> Optional[str]:
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


def normalize_whatsapp_number(value: Optional[str]) -> str:
    if not value:
        return ""
    normalized = str(value)
    if not normalized.startswith("whatsapp:"):
        normalized = f"whatsapp:{normalized}"
    return normalized


def send_whatsapp(to: str, body: str) -> None:
    """Send a WhatsApp message, or log a preview if Twilio isn't configured."""
    print(
        "[WhatsApp debug] send_whatsapp called with: "
        f"client={bool(twilio_client)}, FROM={FROM_NUMBER!r}, to={to!r}"
    )
    normalized_from = normalize_whatsapp_number(FROM_NUMBER)
    normalized_to = normalize_whatsapp_number(to)
    print(
        "[WhatsApp debug] normalized numbers: "
        f"FROM={normalized_from!r}, TO={normalized_to!r}"
    )

    if not twilio_client or not normalized_to or not normalized_from:
        print(f"[WhatsApp Preview] To {to}: {body}")
        return

    try:
        msg = twilio_client.messages.create(
            from_=normalized_from,
            body=body,
            to=normalized_to,
        )
        print(f"[WhatsApp debug] Twilio message SID: {msg.sid}")
    except Exception as e:
        print(f"WhatsApp error: {e}")





def send_whatsapp_template(
    to: str,
    template_sid: str,
    variables: dict,
) -> None:
    normalized_from = normalize_whatsapp_number(FROM_NUMBER)
    normalized_to = normalize_whatsapp_number(to)

    if not twilio_client or not normalized_to or not normalized_from:
        print("[WhatsApp Template Preview]", template_sid, variables)
        return

    try:
        msg = twilio_client.messages.create(
            from_=normalized_from,
            to=normalized_to,
            content_sid=template_sid,
            content_variables=json.dumps(variables),
        )
        print(f"[WhatsApp template] SID: {msg.sid}")
    except Exception as e:
        print(f"WhatsApp template error: {e}")



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
        send_whatsapp_template(
        to=customer.whatsapp,
        template_sid=os.environ["TWILIO_WA_TPL_BOOKING_CONFIRMED"],
        variables={
            "1": service.name,
            "2": get_display_name(provider_user),
            "3": booking.start_time.strftime("%d %b %Y at %I:%M %p"),
            "4": str(service.price_gyd),
        },
    )


    # Provider: one "new booking" message
    if provider_user.whatsapp:
        send_whatsapp_template(
        to=provider_user.whatsapp,
        template_sid=os.environ["TWILIO_WA_TPL_PROVIDER_NEW_BOOKING"],
        variables={
            "1": get_display_name(customer),
            "2": service.name,
            "3": booking.start_time.strftime("%d %b %Y at %I:%M %p"),
        },
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
    validate_password(user.password)
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


def user_is_deleted(user: Optional[models.User]) -> bool:
    if not user:
        return False
    return bool(getattr(user, "is_deleted", False)) or getattr(
        user, "deleted_at", None
    ) is not None


def _apply_not_deleted_filter(query):
    return query.filter(
        models.User.is_deleted.is_(False),
        models.User.deleted_at.is_(None),
    )




def normalize_phone(phone: Optional[str]) -> str:
    normalized = (phone or "").strip()
    if not normalized:
        return ""
    return "".join(ch for ch in normalized if not ch.isspace())


def get_user_by_phone(db: Session, phone: str, *, include_deleted: bool = False):
    normalized = normalize_phone(phone)
    if not normalized:
        return None
    query = db.query(models.User).filter(models.User.phone == normalized)
    if not include_deleted:
        query = _apply_not_deleted_filter(query)
    return query.first()


def get_oauth_identity(db: Session, provider: str, provider_user_id: str):
    return (
        db.query(models.OAuthIdentity)
        .filter(
            models.OAuthIdentity.provider == provider,
            models.OAuthIdentity.provider_user_id == provider_user_id,
        )
        .first()
    )


def create_oauth_identity(
    db: Session,
    *,
    user_id: int,
    provider: str,
    provider_user_id: str,
    email: Optional[str] = None,
) -> models.OAuthIdentity:
    record = models.OAuthIdentity(
        user_id=user_id,
        provider=provider,
        provider_user_id=provider_user_id,
        email=(email.strip().lower() if email else None),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def create_user_for_oauth(
    db: Session,
    *,
    email: str,
    phone: str,
    username: str,
    is_provider: bool,
) -> models.User:
    normalized_email = (email or "").strip().lower()
    normalized_phone = normalize_phone(phone)
    normalized_username = normalize_username(username)

    user = models.User(
        email=normalized_email,
        phone=normalized_phone,
        username=normalized_username,
        is_provider=is_provider,
        is_email_verified=False,
        hashed_password=hash_password(os.urandom(16).hex()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def generate_unique_username(db: Session, seed: str) -> str:
    base = normalize_username(seed)
    if not base:
        base = "facebook_user"
    candidate = base
    counter = 1
    while get_user_by_username(db, candidate):
        counter += 1
        candidate = f"{base}{counter}"
    return candidate


def get_user_by_email(db: Session, email: str, *, include_deleted: bool = False):
    """Return user by email, or None if not found."""
    if not email:
        return None
    normalized = email.strip().lower()
    query = db.query(models.User).filter(func.lower(models.User.email) == normalized)
    if not include_deleted:
        query = _apply_not_deleted_filter(query)
    return query.first()


def get_user_by_id(db: Session, user_id: int, *, include_deleted: bool = False):
    """Return user by id, or None if not found."""
    query = db.query(models.User).filter(models.User.id == user_id)
    if not include_deleted:
        query = _apply_not_deleted_filter(query)
    return query.first()


def set_user_suspension(
    db: Session,
    user_id: int,
    is_suspended: bool,
) -> Optional[models.User]:
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return None

    user.is_suspended = is_suspended
    db.commit()
    db.refresh(user)
    return user


def assert_provider_not_suspended(
    db: Session,
    provider_user_id: int,
) -> models.User:
    user = db.query(models.User).filter(models.User.id == provider_user_id).first()
    if not user:
        raise ValueError("Provider user not found")
    if getattr(user, "is_suspended", False):
        raise PermissionError(SUSPENDED_PROVIDER_MESSAGE)
    return user


def get_user_by_username(
    db: Session,
    username: str,
    *,
    include_deleted: bool = False,
):
    """Return user by username, or None if not found."""
    normalized = normalize_username(username)
    query = db.query(models.User).filter(func.lower(models.User.username) == normalized)
    if not include_deleted:
        query = _apply_not_deleted_filter(query)
    return query.first()


def authenticate_user(db: Session, email: str, password: str):
    """
    Authenticate a user by email + password.

    Returns:
        - user object if credentials are valid
        - None if invalid
    """
    user = get_user_by_email(db, email, include_deleted=True)
    if not user:
        return None

    if user_is_deleted(user):
        return None

    if not verify_password(password, user.hashed_password):
        return None

    return user


def _hash_deleted_value(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def delete_user_account(
    db: Session,
    user: models.User,
    password: str,
) -> None:
    if not verify_password(password, user.hashed_password):
        raise ValueError("Incorrect password")

    deletion_id = os.urandom(16).hex()
    placeholder_email = f"deleted_{deletion_id}@deleted.bookitgy"
    placeholder_username = f"deleted_user_{deletion_id[:8]}"

    deleted_email_hash = _hash_deleted_value(user.email)
    deleted_phone_hash = _hash_deleted_value(user.phone)

    provider = None
    transaction = db.begin_nested() if db.in_transaction() else db.begin()
    try:
        with transaction:
            user.is_deleted = True
            user.deleted_at = now_guyana()
            user.token_version = (user.token_version or 0) + 1
            user.deleted_email_hash = deleted_email_hash
            user.deleted_phone_hash = deleted_phone_hash
            user.email = placeholder_email
            user.username = placeholder_username
            user.phone = None
            user.whatsapp = None
            user.expo_push_token = None
            user.location = None
            user.lat = None
            user.long = None
            user.avatar_url = None
            user.is_email_verified = False
            user.email_verified_at = None
            user.password_reset_at = None

            provider = get_provider_by_user_id(db, user.id)
            if provider:
                provider.is_locked = True
                provider.bio = None
                provider.avatar_url = None
                db.query(models.Service).filter(
                    models.Service.provider_id == provider.id
                ).update(
                    {models.Service.is_active: False},
                    synchronize_session=False,
                )
        db.commit()
        db.refresh(user)
        if provider:
            db.refresh(provider)
    except Exception:
        db.rollback()
        raise


def verify_user_email(db: Session, user: models.User) -> models.User:
    """Mark a user's email as verified."""
    user.is_email_verified = True
    user.email_verified_at = now_guyana()
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

    now = now_guyana()
    user.hashed_password = hash_password(new_password)
    user.password_changed_at = now
    revoke_user_refresh_tokens(db, user.id)
    db.commit()
    db.refresh(user)
    return user


def set_user_password_reset(
    db: Session,
    user: models.User,
    new_password: str,
) -> models.User:
    """Update a user's password and mark the reset timestamp."""

    now = now_guyana()
    user.hashed_password = hash_password(new_password)
    user.password_reset_at = now
    user.password_changed_at = now
    revoke_user_refresh_tokens(db, user.id)
    db.commit()
    db.refresh(user)
    return user


def invalidate_password_reset_tokens(
    db: Session,
    user_id: int,
) -> int:
    """Mark all unused password reset tokens as used for a given user."""
    now = now_guyana()
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
    token.used_at = now_guyana()
    db.commit()
    db.refresh(token)
    return token


def create_refresh_token_record(
    db: Session,
    user_id: int,
    token_hash: str,
) -> models.RefreshToken:
    now = now_guyana()
    token = models.RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        created_at=now,
        last_used_at=now,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def get_refresh_token_by_hash(
    db: Session,
    token_hash: str,
) -> Optional[models.RefreshToken]:
    return (
        db.query(models.RefreshToken)
        .filter(models.RefreshToken.token_hash == token_hash)
        .first()
    )


def revoke_refresh_token(
    db: Session,
    token: models.RefreshToken,
    replaced_by_token_id: Optional[int] = None,
) -> models.RefreshToken:
    if token.revoked_at is None:
        token.revoked_at = now_guyana()
    token.replaced_by_token_id = replaced_by_token_id
    db.commit()
    db.refresh(token)
    return token


def revoke_user_refresh_tokens(db: Session, user_id: int) -> int:
    now = now_guyana()
    tokens = (
        db.query(models.RefreshToken)
        .filter(
            models.RefreshToken.user_id == user_id,
            models.RefreshToken.revoked_at.is_(None),
        )
        .all()
    )
    for token in tokens:
        token.revoked_at = now
    if tokens:
        db.commit()
    return len(tokens)

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


def apply_bill_credit_to_current_cycle(
    db: Session, provider: models.Provider, amount_gyd: float
) -> tuple[models.BillCredit, Decimal]:
    cycle_month = current_billing_cycle_month()
    billing_cycle = get_billing_cycle_for_account(db, provider.account_number, cycle_month)
    if not billing_cycle:
        billing_cycle = models.BillingCycle(
            account_number=provider.account_number,
            cycle_month=cycle_month,
            is_paid=False,
        )
        db.add(billing_cycle)

    previous_balance = Decimal(str(get_provider_credit_balance(db, provider.id) or 0))
    platform_fee = Decimal(str(get_provider_platform_fee_for_cycle(db, provider.id, cycle_month)))
    previous_applied = min(previous_balance, platform_fee)
    current_applied = Decimal(str(billing_cycle.credits_applied_gyd or 0))
    credit_amount = Decimal(str(amount_gyd or 0))
    remaining_apply = platform_fee - max(previous_applied, current_applied)
    if remaining_apply < 0:
        remaining_apply = Decimal("0")
    applied_amount = min(credit_amount, remaining_apply)

    credit = models.BillCredit(
        provider_id=provider.id,
        amount_gyd=credit_amount,
    )
    db.add(credit)
    billing_cycle.credits_applied_gyd = (
        Decimal(str(billing_cycle.credits_applied_gyd or 0)) + applied_amount
    )

    db.commit()
    db.refresh(credit)
    return credit, applied_amount


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
        .filter(
            models.Service.id == booking.service_id,
            models.Service.is_active.is_(True),
        )
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

    assert_provider_not_suspended(db, provider_user.id)

    # Current local time (Guyana, naive to match DB usage)
    now = now_guyana()

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

    cutoff = as_of or now_guyana()
    normalized_status = normalized_booking_status_expr()

    candidate_query = db.query(models.Booking).filter(
        models.Booking.end_time.isnot(None),
        models.Booking.end_time <= cutoff,
        normalized_status == "confirmed",
    )

    if provider_id is not None:
        candidate_query = candidate_query.join(
            models.Service, models.Booking.service_id == models.Service.id
        ).filter(models.Service.provider_id == provider_id)

    candidate_ids = [booking.id for booking in candidate_query.all()]

    if not candidate_ids:
        return

    update_data = {models.Booking.status: "completed"}
    if "completed_at" in models.Booking.__table__.columns:
        update_data[models.Booking.completed_at] = cutoff

    updated = (
        db.query(models.Booking)
        .filter(models.Booking.id.in_(candidate_ids))
        .filter(models.Booking.end_time <= cutoff)
        .filter(normalized_status == "confirmed")
        .update(update_data, synchronize_session=False)
    )

    if updated:
        db.commit()


def generate_monthly_bills(db: Session, month: date):
    """
    Generate or update bills for all providers for the given month.

    - Only counts bookings that are:
        * completed (booking has ended) and not cancelled
        * belong to this provider
        * have end_time inside [first_of_month, first_of_next_month)
    - Safe to run multiple times (creates missing bills only).
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

    now = now_guyana()

    # Don't count future appointments that haven't ended yet
    period_end = min(end_dt, now)

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

        existing_bill = (
            db.query(models.Bill)
            .filter(
                models.Bill.provider_id == prov.id,
                models.Bill.month == start,
            )
            .first()
        )
        if existing_bill:
            continue

        # If there's nothing to bill and no existing bill, skip
        if total == 0:
            continue

        # Bill due on the 15th of the following month
        due = datetime(next_month.year, next_month.month, 15, 23, 59)

        bill = models.Bill(
            provider_id=prov.id,
            month=start,
            total_gyd=total,
            fee_gyd=fee,
            due_date=due,
            is_paid=False,
        )
        db.add(bill)

    db.commit()


def list_bills_for_provider(db: Session, provider_id: int):
    """Return persisted monthly bills for a provider (newest first)."""

    return (
        db.query(models.Bill)
        .filter(models.Bill.provider_id == provider_id)
        .order_by(models.Bill.month.desc())
        .all()
    )


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

    cutoff = as_of or now_guyana()

    normalized_status = normalized_booking_status_expr()

    return (
        db.query(models.Booking, models.Service, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(
            models.Provider.id == provider_id,
            normalized_status == "completed",
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
    now_local = now_guyana()
    period_start, period_end = _billing_period_bounds(now_local)

    rows = (
        _billable_bookings_base_query(db, provider_id, as_of=now_local)
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
    now = now_guyana()
    period_start, period_end = _billing_period_bounds(now)

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
        if normalized_booking_status_value(r.status) != "completed":
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


def get_provider_fees_due_for_cycle(
    db: Session, provider_id: int, cycle_month: date
) -> float:
    """
    Compute the provider's amount due for a given billing cycle month using
    only completed (ended) and non-cancelled bookings.

    The cycle month is expected to be the first day of the target month.
    """
    period_start = datetime(cycle_month.year, cycle_month.month, 1)
    if cycle_month.month == 12:
        period_end = datetime(cycle_month.year + 1, 1, 1)
    else:
        period_end = datetime(cycle_month.year, cycle_month.month + 1, 1)

    now = now_guyana()
    if cycle_month.year == now.year and cycle_month.month == now.month:
        cutoff = min(period_end, now)
    else:
        cutoff = period_end

    rows = (
        _billable_bookings_base_query(db, provider_id, as_of=cutoff)
        .filter(
            models.Booking.end_time >= period_start,
            models.Booking.end_time < cutoff,
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
        if normalized_booking_status_value(r.status) != "completed":
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


def get_provider_platform_fee_for_cycle(
    db: Session, provider_id: int, cycle_month: date
) -> float:
    """
    Compute the provider's platform fee for a given billing cycle month
    without applying bill credits.
    """
    period_start = datetime(cycle_month.year, cycle_month.month, 1)
    if cycle_month.month == 12:
        period_end = datetime(cycle_month.year + 1, 1, 1)
    else:
        period_end = datetime(cycle_month.year, cycle_month.month + 1, 1)

    now = now_guyana()
    if cycle_month.year == now.year and cycle_month.month == now.month:
        cutoff = min(period_end, now)
    else:
        cutoff = period_end

    rows = (
        _billable_bookings_base_query(db, provider_id, as_of=cutoff)
        .filter(
            models.Booking.end_time >= period_start,
            models.Booking.end_time < cutoff,
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
        if normalized_booking_status_value(r.status) != "completed":
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

    return float(platform_fee)


def _normalize_cycle_month(value: date | datetime) -> date:
    if value is None:
        raise ValueError("cycle_month is required")
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        raise ValueError("cycle_month must be a date or datetime")
    return date(value.year, value.month, 1)


def _provider_billing_row(
    db: Session, provider: models.Provider, user: models.User, cycle_month: date
):
    

    cycle_month = _normalize_cycle_month(cycle_month)
    current_cycle_month = _normalize_cycle_month(current_billing_cycle_month())

    billing_cycle = get_billing_cycle_for_account(db, provider.account_number, cycle_month)
    bill = (
        db.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == cycle_month,
        )
        .first()
    )

    is_paid = bool(billing_cycle.is_paid) if billing_cycle else False
    paid_at = billing_cycle.paid_at if billing_cycle else None
    credits_applied = (
        Decimal(str(billing_cycle.credits_applied_gyd or 0))
        if billing_cycle
        else Decimal("0")
    )

    if bill and cycle_month < current_cycle_month:
        amount_due = Decimal(str(bill.fee_gyd or 0)) - credits_applied
        if amount_due < 0:
            amount_due = Decimal("0")
    else:
        amount_due = Decimal(
            str(get_provider_fees_due_for_cycle(db, provider.id, cycle_month) or 0)
        )

    if bill and bill.due_date:
        last_due_date = bill.due_date
    else:
        if cycle_month.month == 12:
            due_year = cycle_month.year + 1
            due_month = 1
        else:
            due_year = cycle_month.year
            due_month = cycle_month.month + 1
        last_due_date = datetime(due_year, due_month, 15, 23, 59)

    return {
        "provider_id": provider.id,
        "user_id": user.id,
        "name": get_display_name(user),
        "account_number": provider.account_number or "",
        "phone": user.phone or "",
        "amount_due_gyd": float(amount_due),
        "bill_credits_gyd": float(credits_applied),
        "cycle_month": cycle_month,
        "is_paid": is_paid,
        "is_locked": bool(getattr(provider, "is_locked", False)),
        "is_suspended": bool(getattr(user, "is_suspended", False)),
        "last_due_date": last_due_date,
        "paid_at": paid_at,
        
    }


def list_provider_billing_rows(db: Session, cycle_month: date):
    rows = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .all()
    )

    account_numbers = [
        provider.account_number
        for provider, _user in rows
        if provider.account_number
    ]
    ensure_billing_cycles_for_accounts(db, account_numbers, cycle_month)

    return [
        _provider_billing_row(db, provider, user, cycle_month)
        for provider, user in rows
    ]


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
    if provider.account_number:
        ensure_billing_cycles_for_accounts(
            db, [provider.account_number], current_billing_cycle_month()
        )
    return _provider_billing_row(
        db, provider, user, current_billing_cycle_month()
    )


def list_provider_billing_cycles(
    db: Session,
    provider: models.Provider,
    limit: int = 6,
    include_future: bool = False,
):
    account_number = provider.account_number or ""
    outstanding_fees = float(get_provider_fees_due(db, provider.id) or 0.0)
    if not account_number:
        return {
            "account_number": "",
            "outstanding_fees_gyd": outstanding_fees,
            "cycles": [],
        }

    ensure_billing_cycles_for_accounts(
        db, [account_number], current_billing_cycle_month()
    )

    billing_cycles_query = db.query(models.BillingCycle).filter(
        models.BillingCycle.account_number == account_number
    )
    if not include_future:
        billing_cycles_query = billing_cycles_query.filter(
            models.BillingCycle.cycle_month <= current_billing_cycle_month()
        )

    billing_cycles = (
        billing_cycles_query.order_by(models.BillingCycle.cycle_month.desc())
        .limit(limit)
        .all()
    )

    service_charge_pct = get_platform_service_charge_percentage(db)
    fee_rate = Decimal(str(max(service_charge_pct, 0))) / Decimal("100")
    now = now_guyana()
    now_date = now.date()
    current_cycle_month = _normalize_cycle_month(current_billing_cycle_month(now_date))
    cycles = []

    for billing_cycle in billing_cycles:
        cycle_month = _normalize_cycle_month(billing_cycle.cycle_month)
        if cycle_month.month == 12:
            next_month = date(cycle_month.year + 1, 1, 1)
        else:
            next_month = date(cycle_month.year, cycle_month.month + 1, 1)
        period_start = datetime.combine(cycle_month, datetime.min.time())
        period_end = datetime.combine(next_month, datetime.min.time())

        if cycle_month.year == now.year and cycle_month.month == now.month:
            cutoff = min(period_end, now)
        else:
            cutoff = period_end

        rows = (
            _billable_bookings_base_query(db, provider.id, as_of=cutoff)
            .filter(
                models.Booking.end_time >= period_start,
                models.Booking.end_time < cutoff,
            )
            .with_entities(
                models.Booking.status,
                models.Service.id.label("service_id"),
                models.Service.name.label("service_name"),
                models.Service.price_gyd.label("service_price_gyd"),
            )
            .order_by(models.Booking.end_time.asc())
            .all()
        )

        services_total = Decimal("0")
        items_map: dict[int, dict[str, object]] = {}
        for row in rows:
            if _is_cancelled_status(row.status):
                continue
            if normalized_booking_status_value(row.status) != "completed":
                continue

            price = Decimal(str(row.service_price_gyd or 0))
            services_total += price
            service_id = row.service_id
            item = items_map.setdefault(
                service_id,
                {
                    "service_id": service_id,
                    "service_name": row.service_name or "",
                    "qty": 0,
                    "services_total_gyd": Decimal("0"),
                },
            )
            item["qty"] = int(item["qty"]) + 1
            item["services_total_gyd"] = (
                Decimal(str(item["services_total_gyd"])) + price
            )

        bill_credits = Decimal(str(billing_cycle.credits_applied_gyd or 0))
        bill = (
            db.query(models.Bill)
            .filter(
                models.Bill.provider_id == provider.id,
                models.Bill.month == cycle_month,
            )
            .first()
        )

        if bill and cycle_month < current_cycle_month:
            platform_fee = Decimal(str(bill.fee_gyd or 0))
            total_due = platform_fee - bill_credits
            if total_due < 0:
                total_due = Decimal("0")
        else:
            platform_fee = Decimal(
                str(
                    get_provider_platform_fee_for_cycle(
                        db, provider.id, cycle_month
                    )
                    or 0
                )
            )
            total_due = Decimal(
                str(get_provider_fees_due_for_cycle(db, provider.id, cycle_month) or 0)
            )

        items = []
        for item in items_map.values():
            item_services_total = Decimal(str(item["services_total_gyd"]))
            item_platform_fee = (item_services_total * fee_rate).quantize(Decimal("1"))
            items.append(
                {
                    "service_id": int(item["service_id"]),
                    "service_name": str(item["service_name"]),
                    "qty": int(item["qty"]),
                    "services_total_gyd": float(item_services_total),
                    "platform_fee_gyd": float(item_platform_fee),
                }
            )

        items.sort(key=lambda entry: entry["service_name"].lower())

        invoice_date = next_month
        coverage_end = next_month - timedelta(days=1)
        if billing_cycle.is_paid:
            status = "Paid"
        elif cycle_month == current_cycle_month and invoice_date > now_date:
            status = "Scheduled"
        else:
            status = "Generated"

        cycles.append(
            {
                "cycle_month": cycle_month,
                "coverage_start": cycle_month,
                "coverage_end": coverage_end,
                "invoice_date": invoice_date,
                "status": status,
                "services_total_gyd": float(services_total),
                "platform_fee_gyd": float(platform_fee),
                "bill_credits_gyd": float(bill_credits),
                "total_due_gyd": float(total_due),
                "items": items,
            }
        )

    return {
        "account_number": account_number,
        "outstanding_fees_gyd": outstanding_fees,
        "cycles": cycles,
    }


def set_provider_bills_paid_state(
    db: Session,
    provider_id: int,
    month: date,
    is_paid: bool,
) -> int:
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .first()
    )
    if not provider or not provider.account_number:
        return 0

    cycle_month = date(month.year, month.month, 1)
    billing_cycle = get_or_create_billing_cycle(db, provider.account_number, cycle_month)
    if not billing_cycle:
        return 0

    billing_cycle.is_paid = bool(is_paid)
    billing_cycle.paid_at = now_guyana() if is_paid else None
    bill_updates = {models.Bill.is_paid: bool(is_paid)}
    bill_paid_at = getattr(models.Bill, "paid_at", None)
    bill_paid_on = getattr(models.Bill, "paid_on", None)
    if bill_paid_at is not None:
        bill_updates[bill_paid_at] = now_guyana() if is_paid else None
    if bill_paid_on is not None:
        bill_updates[bill_paid_on] = now_guyana().date() if is_paid else None
    (
        db.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider_id,
            models.Bill.month == cycle_month,
        )
        .update(bill_updates, synchronize_session="fetch")
    )
    db.commit()
    return 1


def current_billing_cycle_month(reference: datetime | date | None = None) -> date:
    if reference is None:
        reference = now_guyana()
    if isinstance(reference, datetime):
        reference = reference.date()
    return date(reference.year, reference.month, 1)


def get_billing_cycle_for_account(
    db: Session, account_number: str | None, cycle_month: date
) -> Optional[models.BillingCycle]:
    if not account_number:
        return None
    return (
        db.query(models.BillingCycle)
        .filter(
            models.BillingCycle.account_number == account_number,
            models.BillingCycle.cycle_month == cycle_month,
        )
        .first()
    )


def ensure_billing_cycles_for_accounts(
    db: Session, account_numbers: List[str], cycle_month: date
) -> dict[str, models.BillingCycle]:
    if not account_numbers:
        return {}
    unique_numbers = {num for num in account_numbers if num}
    if not unique_numbers:
        return {}

    existing = (
        db.query(models.BillingCycle)
        .filter(
            models.BillingCycle.cycle_month == cycle_month,
            models.BillingCycle.account_number.in_(unique_numbers),
        )
        .all()
    )
    existing_map = {row.account_number: row for row in existing}
    missing = [num for num in unique_numbers if num not in existing_map]
    if missing:
        created = []
        for num in missing:
            billing_cycle = models.BillingCycle(
                account_number=num,
                cycle_month=cycle_month,
                is_paid=False,
            )
            db.add(billing_cycle)
            created.append(billing_cycle)
        db.commit()
        for billing_cycle in created:
            existing_map[billing_cycle.account_number] = billing_cycle
    return existing_map


def get_or_create_billing_cycle(
    db: Session, account_number: str, cycle_month: date
) -> Optional[models.BillingCycle]:
    existing = get_billing_cycle_for_account(db, account_number, cycle_month)
    if existing:
        return existing

    billing_cycle = models.BillingCycle(
        account_number=account_number,
        cycle_month=cycle_month,
        is_paid=False,
    )
    db.add(billing_cycle)
    try:
        db.commit()
        return billing_cycle
    except IntegrityError:
        db.rollback()
        return get_billing_cycle_for_account(db, account_number, cycle_month)


def mark_billing_cycle_paid(
    db: Session,
    *,
    account_number: str,
    cycle_month: date,
    provider_user: Optional[models.User] = None,
    send_email=None,
) -> models.BillingCycle:
    billing_cycle = get_or_create_billing_cycle(db, account_number, cycle_month)
    if not billing_cycle:
        raise ValueError("Billing cycle not found or created.")

    if not billing_cycle.is_paid:
        billing_cycle.is_paid = True
        billing_cycle.paid_at = now_guyana()
        db.commit()
        if send_email and provider_user and provider_user.email:
            try:
                send_email(
                    provider_user.email,
                    account_number=account_number,
                    cycle_month=cycle_month,
                )
            except Exception:
                logger.exception(
                    "Failed to send billing paid email for account=%s",
                    account_number,
                )
    return billing_cycle


def ensure_billing_cycles_for_month(db: Session, cycle_month: date) -> int:
    providers = db.query(models.Provider).filter(
        models.Provider.account_number.isnot(None)
    ).all()
    account_numbers = [provider.account_number for provider in providers if provider.account_number]
    existing = ensure_billing_cycles_for_accounts(db, account_numbers, cycle_month)
    return len(existing)


def suspend_unpaid_providers_for_cycle(db: Session, cycle_month: date) -> int:
    unpaid_accounts = (
        db.query(models.BillingCycle.account_number)
        .filter(
            models.BillingCycle.cycle_month == cycle_month,
            models.BillingCycle.is_paid.is_(False),
        )
        .all()
    )
    account_numbers = [row[0] for row in unpaid_accounts if row[0]]
    if not account_numbers:
        return 0

    provider_user_ids = select(models.Provider.user_id).filter(
        models.Provider.account_number.in_(account_numbers)
    )
    updated = (
        db.query(models.User)
        .filter(
            models.User.id.in_(provider_user_ids),
            models.User.is_suspended.is_(False),
        )
        .update({models.User.is_suspended: True}, synchronize_session=False)
    )
    db.commit()
    return updated


def auto_suspend_unpaid_providers(db: Session, reference_date: date) -> int:
    if reference_date.day < 15:
        return 0
    cycle_month = current_billing_cycle_month(reference_date)
    return suspend_unpaid_providers_for_cycle(db, cycle_month)


def set_provider_lock_state(db: Session, provider_id: int, is_locked: bool) -> int:
    updated = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .update({models.Provider.is_locked: is_locked}, synchronize_session=False)
    )

    db.commit()
    return updated


def list_bookings_for_provider(
    db: Session,
    provider_id: int,
    range_start: datetime | None = None,
    range_end: datetime | None = None,
):
    """Return bookings for this provider, newest first, optionally within a date range."""

    query = (
        db.query(models.Booking, models.Service, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(models.Provider.id == provider_id)
    )

    if range_start is not None:
        query = query.filter(models.Booking.start_time >= range_start)
    if range_end is not None:
        query = query.filter(models.Booking.start_time <= range_end)

    rows = query.order_by(models.Booking.start_time.desc()).all()

    return [
        {
            "id": booking.id,
            "service_name": service.name,
            "service_price_gyd": float(service.price_gyd or 0.0),
            "customer_name": customer.username,
            "start_time": booking.start_time,
            "end_time": booking.end_time,
            "status": normalized_booking_status_value(booking.status),
            "canceled_at": getattr(booking, "canceled_at", None),
            "completed_at": getattr(booking, "completed_at", None),
        }
        for booking, service, customer in rows
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

    cutoff = as_of or now_guyana()
    default_start, default_end = _billing_period_bounds(cutoff)

    period_start = period_start or default_start
    period_end = period_end or default_end
    rows = (
        # removed as_of=cutoff from parenthesis below, this 
        # was redundant as if not r.end_time or r.end_time > cutoff: does the same thing
        _billable_bookings_base_query(db, provider_id,)
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
        normalized_status = normalized_booking_status_value(r.status)
        if normalized_status != "completed":
            continue
        if not r.end_time or r.end_time > cutoff:
            continue
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



def confirm_booking_for_provider(
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

    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .first()
    )
    if not provider:
        return False

    assert_provider_not_suspended(db, provider.user_id)

    normalized_status = normalized_booking_status_value(booking.status)
    if normalized_status == "cancelled":
        return False

    if normalized_status != "confirmed":
        booking.status = "confirmed"
        db.commit()
        db.refresh(booking)

    return True


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
        .with_for_update()
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
    booking.canceled_at = now_guyana()
    booking.canceled_by_user_id = customer_id
    booking.canceled_by_role = "client"
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

    if provider_user and service and customer and provider_user.whatsapp:
     send_whatsapp_template(
        to=provider_user.whatsapp,
        template_sid=os.environ["TWILIO_WA_TPL_PROVIDER_CUSTOMER_CANCELLED"],
        variables={
            "1": get_display_name(customer),
            "2": service.name,
            "3": booking.start_time.strftime("%d %b %Y at %I:%M %p"),
        },
    )


    if provider_user and service and customer:
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

    booking_row = (
        db.query(models.Booking.id, models.Provider.user_id)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .filter(
            models.Booking.id == booking_id,
            models.Provider.id == provider_id,
        )
        .first()
    )

    if not booking_row:
        return False

    booking_id, provider_user_id = booking_row
    booking = (
        db.query(models.Booking)
        .filter(models.Booking.id == booking_id)
        .with_for_update()
        .first()
    )
    if not booking:
        return False

    normalized_status = normalized_booking_status_value(booking.status)

    if normalized_status == "completed":
        raise ValueError("Cannot cancel a completed booking")

    if normalized_status == "cancelled":
        return True

    service = (
        db.query(models.Service)
        .filter(models.Service.id == booking.service_id)
        .first()
    )
    if not service:
        return False

    customer = (
        db.query(models.User)
        .filter(models.User.id == booking.customer_id)
        .first()
    )

    booking.status = "cancelled"
    booking.canceled_at = now_guyana()
    booking.canceled_by_user_id = provider_user_id
    booking.canceled_by_role = "provider"
    db.commit()
    db.refresh(booking)

    _refresh_bill_for_booking(db, booking)

    if customer and service and customer.whatsapp:
     send_whatsapp_template(
        to=customer.whatsapp,
        template_sid=os.environ["TWILIO_WA_TPL_CUSTOMER_PROVIDER_CANCELLED"],
        variables={
            "1": service.name,
            "2": booking.start_time.strftime("%d %b %Y at %I:%M %p"),
        },
    )


    if customer and service:
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
            models.Service.is_active.is_(True),
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
    now = now_guyana()

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
    All *confirmed* bookings for this provider whose start_time is today.
    """
    start_of_day = today_start_guyana()
    end_of_day = today_end_guyana()
    now = now_guyana()
    _auto_complete_finished_bookings(db, provider_id=provider_id, as_of=now)
    normalized_status = normalized_booking_status_expr()

    q = (
        db.query(models.Booking, models.Service, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(
            models.Service.provider_id == provider_id,
            normalized_status == "confirmed",
            models.Booking.start_time >= start_of_day,
            models.Booking.start_time <= end_of_day,
            models.Booking.end_time > now,
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
                status=normalized_booking_status_value(booking.status),
                canceled_at=getattr(booking, "canceled_at", None),
                completed_at=getattr(booking, "completed_at", None),
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
    end_of_today = today_end_guyana()
    start = end_of_today + timedelta(seconds=1)
    end = start + timedelta(days=days_ahead)
    normalized_status = normalized_booking_status_expr()

    q = (
      db.query(models.Booking, models.Service, models.User)
      .join(models.Service, models.Booking.service_id == models.Service.id)
      .join(models.User, models.Booking.customer_id == models.User.id)
      .filter(
          models.Service.provider_id == provider_id,
          normalized_status == "confirmed",
          models.Booking.start_time > end_of_today,
          models.Booking.start_time < end,
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
