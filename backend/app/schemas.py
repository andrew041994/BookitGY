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

class User(UserBase):
    id: int
    is_provider: bool
    expo_push_token: Optional[str] = None

    class Config:
        orm_mode = True

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    location: Optional[str] = None

    lat: Optional[float] = None
    long: Optional[float] = None


class ProviderUpdate(BaseModel):
    bio: Optional[str] = None
    location: Optional[str] = None  # human-readable address / area
    whatsapp: Optional[str] = None
    professions: Optional[List[str]] = None
    is_active: Optional[bool] = None



class UserCreate(UserBase):
    password: str
    is_provider: bool = False
    is_admin: bool = False   # 👈 add this


class LoginByEmailPayload(BaseModel):
    email: str
    password: str


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

class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price_gyd: Optional[float] = None
    duration_minutes: Optional[int] = None


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


class WorkingHoursBase(BaseModel):
    weekday: int               # 0 = Monday, 6 = Sunday
    is_closed: bool
    start_time: Optional[str] = None  # "09:00"
    end_time: Optional[str] = None    # "17:00"


class WorkingHoursOut(WorkingHoursBase):
    id: int
    provider_id: int


class WorkingHoursUpdate(WorkingHoursBase):
       weekday: int               # 0 = Monday, 6 = Sunday
       is_closed: bool
       start_time: Optional[str] = None  # "09:00"
       end_time: Optional[str] = None    # "17:00"# same fields as base; used for updates
       pass

class ProviderWorkingHoursUpdate(BaseModel):
    weekday: int                    # 0 = Monday, 6 = Sunday
    is_closed: bool
    start_time: Optional[str] = None  # "09:00"
    end_time: Optional[str] = None    # "17:00"


class BookingSummary(BaseModel):
    id: int
    service_name: str
    customer_name: str
    start_time: datetime
    end_time: datetime
    status: str


class PromotionUpdate(BaseModel):
    free_bookings_total: int


class ProviderProfileOut(BaseModel):
    full_name: str
    phone: str
    whatsapp: Optional[str] = None
    location: str
    bio: Optional[str] = None
    professions: List[str] = []
    avatar_url: Optional[str] = None   # 👈 NEW





class ProviderProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    professions: Optional[List[str]] = None
    avatar_url: Optional[str] = None   # 👈 NEW



class BookingWithDetails(BaseModel):
    id: int
    start_time: datetime
    end_time: datetime
    status: str

    service_name: str
    service_duration_minutes: int
    service_price_gyd: float

    customer_name: str
    customer_phone: str

    # NEW: provider info for navigation
    provider_name: Optional[str] = None
    provider_location: Optional[str] = None
    provider_lat: Optional[float] = None
    provider_long: Optional[float] = None

    class Config:
        from_attributes = True




class BookingUpdate(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

class ProviderListItem(BaseModel):
    provider_id: int
    name: str
    location: str
    lat: Optional[float] = None
    long: Optional[float] = None
    bio: Optional[str] = None
    professions: List[str] = []


class AvailabilitySlot(BaseModel):
    start_time: datetime  # full ISO datetime from backend


class ProviderAvailabilityDay(BaseModel):
    date: date            # YYYY-MM-DD
    slots: List[datetime]  # list of ISO datetimes (start times)

class UserProfileOut(BaseModel):
    full_name: str
    phone: str
    whatsapp: Optional[str] = None
    location: str


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    location: Optional[str] = None

class ProviderSummary(BaseModel):
    account_number: str
    total_fees_due_gyd: float

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    email: str
    is_provider: bool
    is_admin: bool

class ProviderLocationUpdate(BaseModel):
    lat: float
    long: float
    location: Optional[str] = None  # optional human-readable text



