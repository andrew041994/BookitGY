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
    Enum,)

from .database import Base
from datetime import datetime
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()



class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    full_name = Column(String)
    phone = Column(String)
    whatsapp = Column(String)  # e.g. whatsapp:+592xxxxxxx
    expo_push_token = Column(String, nullable=True)
    location = Column(String)
    lat = Column(Float, nullable=True)
    long = Column(Float, nullable=True)
    is_provider = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Provider(Base):
    __tablename__ = "providers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    bio = Column(Text)
    account_number = Column(String, unique=True, index=True)  # NEW
    avatar_url = Column(String, nullable=True)



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






class Bill(Base):
    __tablename__ = "bills"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"))
    month = Column(Date)  # first day of the month
    total_gyd = Column(Numeric(10,2), default=0)
    fee_gyd = Column(Numeric(10,2), default=0)
    is_paid = Column(Boolean, default=False)
    due_date = Column(DateTime)

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
