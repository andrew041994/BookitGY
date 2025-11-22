from pydantic import BaseModel
from datetime import datetime, date
from typing import Optional, List
from decimal import Decimal




class UserBase(BaseModel):
    email: str
    full_name: str
    phone: str
    whatsapp: Optional[str] = None
    location: str
    lat: Optional[float] = None
    long: Optional[float] = None

class UserCreate(UserBase):
    password: str
    is_provider: bool = False
    is_admin: bool = False   # 👈 add this


class UserOut(UserBase):
    id: int
    is_provider: bool
    is_admin: bool           # 👈 add this


    class Config:
        from_attributes = True

class ServiceCreate(BaseModel):
    name: str
    description: str
    price_gyd: float
    duration_minutes: int

class ServiceOut(BaseModel):
    id: int
    provider_id: int
    name: str
    description: str
    price_gyd: float
    duration_minutes: int

    class Config:
        from_attributes = True


class BookingCreate(BaseModel):
    service_id: int
    start_time: datetime

class PromotionUpdate(BaseModel):
    free_bookings_total: int