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
    UniqueConstraint,
    ForeignKeyConstraint,
    CheckConstraint,
)

from .database import Base
from datetime import datetime
from app.utils.time import now_guyana
from sqlalchemy.orm import relationship



class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True)
    google_sub = Column(String, unique=True, index=True, nullable=True)
    auth_provider = Column(String, nullable=False, default="local")
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
    password_changed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_guyana)
    avatar_url = Column(String, nullable=True)   # 👈 NEW
    deleted_at = Column(DateTime, nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False)
    token_version = Column(Integer, default=0, nullable=False)
    deleted_email_hash = Column(Text, nullable=True)
    deleted_phone_hash = Column(Text, nullable=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    token_hash = Column(String, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_guyana)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=now_guyana, nullable=False)
    last_used_at = Column(DateTime, default=now_guyana, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    replaced_by_token_id = Column(
        Integer,
        ForeignKey("refresh_tokens.id"),
        nullable=True,
    )


class OAuthIdentity(Base):
    __tablename__ = "oauth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_oauth_provider_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    provider = Column(String, index=True, nullable=False)
    provider_user_id = Column(String, index=True, nullable=False)
    email = Column(String, nullable=True)
    created_at = Column(DateTime, default=now_guyana, nullable=False)
    updated_at = Column(DateTime, default=now_guyana, onupdate=now_guyana, nullable=False)


class Provider(Base):
    __tablename__ = "providers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    bio = Column(Text)
    account_number = Column(String, unique=True, index=True)  # NEW
    avatar_url = Column(String, nullable=True)
    is_locked = Column(Boolean, default=False)
    avg_rating = Column(Float, nullable=True)
    rating_count = Column(Integer, nullable=False, default=0)
    user = relationship("User")
    booking_ratings = relationship("BookingRating", back_populates="provider")



class Service(Base):
    __tablename__ = "services"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"))
    name = Column(String)
    description = Column(Text)
    price_gyd = Column(Float)
    duration_minutes = Column(Integer)
    # requires DB migration:
    # ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    # CREATE INDEX IF NOT EXISTS idx_services_provider_is_active ON services(provider_id, is_active);
    is_active = Column(Boolean, default=True, nullable=False)


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
    completed_at = Column(DateTime, nullable=True)
    canceled_at = Column(DateTime, nullable=True)
    canceled_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    canceled_by_role = Column(String, nullable=True)
    rating = relationship("BookingRating", back_populates="booking", uselist=False)


class BookingRating(Base):
    __tablename__ = "booking_ratings"
    __table_args__ = (
        UniqueConstraint("booking_id", name="uq_booking_ratings_booking_id"),
        CheckConstraint("stars >= 1 AND stars <= 5", name="ck_booking_ratings_stars_range"),
    )

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False, index=True)
    client_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    stars = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=now_guyana, nullable=False)
    updated_at = Column(DateTime, default=now_guyana, onupdate=now_guyana, nullable=False)

    booking = relationship("Booking", back_populates="rating")
    provider = relationship("Provider", back_populates="booking_ratings")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False, unique=True, index=True)
    client_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    provider_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=now_guyana, nullable=False)
    updated_at = Column(DateTime, default=now_guyana, onupdate=now_guyana, nullable=False)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    text = Column(Text, nullable=True)
    message_type = Column(String, nullable=False, default="text")
    created_at = Column(DateTime, default=now_guyana, nullable=False, index=True)
    read_at = Column(DateTime, nullable=True)

    conversation = relationship("Conversation", back_populates="messages")
    attachment = relationship("MessageAttachment", back_populates="message", uselist=False, cascade="all, delete-orphan")


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False, unique=True, index=True)
    attachment_type = Column(String, nullable=False, default="image")
    file_url = Column(String, nullable=False)
    thumbnail_url = Column(String, nullable=True)
    original_filename = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now_guyana, nullable=False)

    message = relationship("Message", back_populates="attachment")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(String, nullable=False)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=now_guyana, nullable=False, index=True)






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
    emailed_at = Column(DateTime, nullable=True)


class BillCredit(Base):
    __tablename__ = "bill_credits"
    __table_args__ = (
        ForeignKeyConstraint(
            ["billing_cycle_account_number", "billing_cycle_month"],
            ["billing_cycles.account_number", "billing_cycles.cycle_month"],
            ondelete="SET NULL",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False)
    amount_gyd = Column(Numeric(10, 2), default=0)
    kind = Column(String, nullable=True)
    billing_cycle_account_number = Column(String, nullable=True)
    billing_cycle_month = Column(Date, nullable=True)
    created_at = Column(DateTime, default=now_guyana)


class BillingCycle(Base):
    __tablename__ = "billing_cycles"
    account_number = Column(String, primary_key=True)
    cycle_month = Column(Date, primary_key=True)
    is_paid = Column(Boolean, default=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    credits_applied_gyd = Column(Numeric(10, 2), default=0, nullable=False)
    finalized_at = Column(DateTime(timezone=True), nullable=True)

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


class ProviderBlockedTime(Base):
    __tablename__ = "provider_blocked_times"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False, index=True)
    start_at = Column(DateTime, nullable=False, index=True)
    end_at = Column(DateTime, nullable=False, index=True)
    is_all_day = Column(Boolean, nullable=False, default=False)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_guyana)
    updated_at = Column(DateTime, default=now_guyana, onupdate=now_guyana)

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
