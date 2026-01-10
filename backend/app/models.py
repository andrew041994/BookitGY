from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    Boolean,
    Float,
    Date,
    Numeric,
    Enum,
    literal,
    UniqueConstraint,
)

from .database import Base
from datetime import datetime
from app.utils.time import now_guyana
from sqlalchemy.orm import column_property, relationship



class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    phone = Column(String)
    whatsapp = Column(String)  # e.g. whatsapp:+592xxxxxxx
    expo_push_token = Column(String, nullable=True)
    location = Column(String)
    lat = Column(Float, nullable=True)
    long = Column(Float, nullable=True)
    is_provider = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    is_suspended = Column(Boolean, default=False, nullable=False)
    is_email_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime, nullable=True)
    password_reset_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_guyana)
    avatar_url = Column(String, nullable=True)   # 👈 NEW


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    token_hash = Column(String, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_guyana)


class Provider(Base):
    __tablename__ = "providers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    bio = Column(Text)
    account_number = Column(String, unique=True, index=True)  # NEW
    avatar_url = Column(String, nullable=True)
    is_locked = Column(Boolean, default=False)



class Service(Base):
    __tablename__ = "services"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"))
    name = Column(String)
    description = Column(Text)
    price_gyd = Column(Float)
    duration_minutes = Column(Integer)


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False, index=True)
    start_time = Column(DateTime, nullable=False, index=True)
    end_time = Column(DateTime, nullable=False, index=True)
    status = Column(
        Enum(
            "confirmed",
            "pending",
            "cancelled",
            "completed",
            name="booking_status_enum",
        ),
        nullable=False,
        default="confirmed",
    )
    completed_at = column_property(literal(None))
    canceled_at = column_property(literal(None))






class Bill(Base):
    __tablename__ = "bills"
    __table_args__ = (
        UniqueConstraint("provider_id", "month", name="uq_bills_provider_month"),
    )
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"))
    month = Column(Date)  # first day of the month
    total_gyd = Column(Numeric(10,2), default=0)
    fee_gyd = Column(Numeric(10,2), default=0)
    is_paid = Column(Boolean, default=False)
    due_date = Column(DateTime)


class BillCredit(Base):
    __tablename__ = "bill_credits"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False)
    amount_gyd = Column(Numeric(10, 2), default=0)
    created_at = Column(DateTime, default=now_guyana)

class Promotion(Base):
    __tablename__ = "promotions"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), unique=True)
    free_bookings_total = Column(Integer, default=0)
    free_bookings_used = Column(Integer, default=0)

class ProviderWorkingHours(Base):
    __tablename__ = "provider_working_hours"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"))
    weekday = Column(Integer)  # 0 = Monday, 6 = Sunday
    is_closed = Column(Boolean, default=True)
    start_time = Column(String, nullable=True)  # "09:00"
    end_time = Column(String, nullable=True)    # "17:00"

class ProviderProfession(Base):
    __tablename__ = "provider_professions"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"))
    name = Column(String, index=True)

class ProviderCatalogImage(Base):
    __tablename__ = "provider_catalog_images"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), index=True, nullable=False)
    image_url = Column(String, nullable=False)
    caption = Column(String, nullable=True)
    created_at = Column(DateTime, default=now_guyana)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    id = Column(Integer, primary_key=True, index=True)
    service_charge_percentage = Column(Float, default=10.0)
