from pydantic import BaseModel, EmailStr, Field, validator

from datetime import datetime, date
from typing import Optional, List
import re
from decimal import Decimal


USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 30
USERNAME_PATTERN = re.compile(r"^[a-z0-9._]+$")


def normalize_and_validate_username(value: str) -> str:
    normalized = (value or "").strip().lower()
    if len(normalized) < USERNAME_MIN_LENGTH:
        raise ValueError(f"Username must be at least {USERNAME_MIN_LENGTH} characters")
    if len(normalized) > USERNAME_MAX_LENGTH:
        raise ValueError(f"Username must be at most {USERNAME_MAX_LENGTH} characters")
    if not USERNAME_PATTERN.match(normalized):
        raise ValueError(
            "Username may only contain letters, numbers, underscores, and dots"
        )
    return normalized



class UserBase(BaseModel):
    email: EmailStr
    username: str
    phone: str
    location: Optional[str] = None
    whatsapp: Optional[str] = None
    lat: Optional[float] = None
    long: Optional[float] = None
    avatar_url: Optional[str] = None  # 👈 NEW


class UserCreate(UserBase):
    password: str
    is_provider: bool = False

class User(UserBase):
    id: int
    is_provider: bool
    is_email_verified: bool
    is_suspended: bool
    expo_push_token: Optional[str] = None

    class Config:
        orm_mode = True

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    location: Optional[str] = None

    lat: Optional[float] = None
    long: Optional[float] = None
    avatar_url: Optional[str] = None  # 👈 NEW

    @validator("username")
    def validate_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return normalize_and_validate_username(value)



class ProviderUpdate(BaseModel):
    bio: Optional[str] = None
    location: Optional[str] = None  # human-readable address / area
    whatsapp: Optional[str] = None
    professions: Optional[List[str]] = None
    is_active: Optional[bool] = None








class FacebookCompleteRequest(BaseModel):
    facebook_access_token: str
    phone: Optional[str] = None
    is_provider: bool = False
    email: Optional[EmailStr] = None


class FacebookProfileUser(BaseModel):
    id: int
    email: Optional[EmailStr] = None
    username: str
    phone: Optional[str] = None
    is_provider: bool
    is_admin: bool

    class Config:
        from_attributes = True


class LoginByEmailPayload(BaseModel):
    email: str
    password: str

class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordPayload(BaseModel):
    token: str
    new_password: str


class VerifyEmailPayload(BaseModel):
    token: str


class ResendVerificationPayload(BaseModel):
    email: EmailStr


class DeleteAccountRequest(BaseModel):
    password: str


class VerifyEmailStatus(BaseModel):
    email: EmailStr
    is_email_verified: bool
    email_verified_at: Optional[datetime] = None



class UserOut(UserBase):
    id: int
    is_provider: bool
    is_email_verified: bool
    is_admin: bool           # 👈 add this
    is_suspended: bool


    class Config:
        from_attributes = True


class UserSuspensionOut(BaseModel):
    id: int
    is_suspended: bool

    class Config:
        from_attributes = True


class ProviderSuspensionUpdate(BaseModel):
    account_number: str
    is_suspended: bool


class ProviderSuspensionOut(BaseModel):
    account_number: str
    is_suspended: bool
    is_locked: bool

    class Config:
        from_attributes = True

class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: str
    price_gyd: float = Field(..., gt=0)
    duration_minutes: int = Field(..., gt=0)

    @validator("name")
    def name_must_not_be_blank(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Service name is required")
        return trimmed

class ServiceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1)
    description: Optional[str] = None
    price_gyd: Optional[float] = Field(None, gt=0)
    duration_minutes: Optional[int] = Field(None, gt=0)

    @validator("name")
    def name_must_not_be_blank(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Service name is required")
        return trimmed


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


class BillCreditUpdate(BaseModel):
    credit_gyd: float


class BillCreditOut(BaseModel):
    provider_id: int
    account_number: str
    credit_applied_gyd: float
    total_credit_balance_gyd: float


class ProviderBillingRow(BaseModel):
    provider_id: int
    name: str
    account_number: str
    phone: Optional[str] = None
    amount_due_gyd: float
    bill_credits_gyd: float = 0
    cycle_month: date
    is_paid: bool
    is_locked: bool = False
    is_suspended: bool = False
    last_due_date: Optional[datetime] = None
    paid_at: Optional[datetime] = None


class AdminProviderLocationOut(BaseModel):
    provider_id: int
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    lat: Optional[float] = None
    long: Optional[float] = None
    account_number: Optional[str] = None
    location: Optional[str] = None


class AdminProviderCancellationOut(BaseModel):
    provider_id: int
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    provider_cancelled_count: int
    customer_cancelled_count: int
    total_cancellations: int


class AdminSignupReportOut(BaseModel):
    start: date
    end: date
    providers: int
    clients: int
    total_providers: int
    total_clients: int


class AdminBookingMetricsTotals(BaseModel):
    total_bookings: int
    upcoming: int
    completed: int
    cancelled: int
    total_revenue: Optional[float] = None


class AdminBookingMetricsProviderRow(BaseModel):
    provider_id: int
    provider_name: Optional[str] = None
    profession: Optional[str] = None
    total_bookings: int
    upcoming: int
    completed: int
    cancelled: int


class AdminBookingMetricsOut(BaseModel):
    start: date
    end: date
    status: str
    profession: str
    totals: AdminBookingMetricsTotals
    by_provider: List[AdminBookingMetricsProviderRow] = []


class AdminProfessionsOut(BaseModel):
    professions: List[str] = []


class AdminProviderPerformanceFilters(BaseModel):
    profession: str
    status: str


class AdminProviderPerformanceProviderRow(BaseModel):
    provider_id: int
    provider_name: Optional[str] = None
    profession: Optional[str] = None
    total_bookings: Optional[int] = None
    total_revenue: Optional[float] = None


class AdminProviderPerformanceServiceRow(BaseModel):
    service_id: int
    service_name: Optional[str] = None
    provider_id: Optional[int] = None
    provider_name: Optional[str] = None
    bookings: int


class ProviderCancellationRow(BaseModel):
    provider_id: int
    provider_name: Optional[str] = None
    profession: Optional[str] = None
    cancelled: int
    total: Optional[int] = None
    total_bookings: Optional[int] = None
    cancellation_rate: float


class ProviderLowActivityRow(BaseModel):
    provider_id: int
    provider_name: Optional[str] = None
    profession: Optional[str] = None
    bookings: Optional[int] = None
    bookings_in_range: Optional[int] = None


class AdminProviderPerformanceSummaryOut(BaseModel):
    start: date
    end: date
    filters: AdminProviderPerformanceFilters
    revenue_supported: bool
    top_providers_by_bookings: List[AdminProviderPerformanceProviderRow] = []
    top_providers_by_revenue: List[AdminProviderPerformanceProviderRow] = []
    most_booked_services: List[AdminProviderPerformanceServiceRow] = []
    high_cancellation_rates: List[ProviderCancellationRow] = []
    low_activity_providers: List[ProviderLowActivityRow] = []


class ProviderRetentionRow(BaseModel):
    provider_id: int
    provider_name: Optional[str] = None
    profession: Optional[str] = None
    active_months: List[str] = []
    months_active_count: int
    is_active_every_month: bool
    last_active_month: Optional[str] = None


class AdminProviderRetentionOut(BaseModel):
    months: List[str] = []
    providers: List[ProviderRetentionRow] = []


class AdminLowActivityOut(BaseModel):
    month: str
    threshold: int
    providers: List[ProviderLowActivityRow] = []


class AdminCancellationRatesOut(BaseModel):
    start: date
    end: date
    min_bookings: int
    providers: List[ProviderCancellationRow] = []


class ProviderBillingCycleItem(BaseModel):
    service_id: int
    service_name: str
    qty: int
    services_total_gyd: float
    platform_fee_gyd: float


class ProviderBillingCycleOut(BaseModel):
    cycle_month: date
    coverage_start: date
    coverage_end: date
    invoice_date: date
    status: str
    services_total_gyd: float
    platform_fee_gyd: float
    bill_credits_gyd: float
    total_due_gyd: float
    items: List[ProviderBillingCycleItem] = []


class ProviderBillingCyclesResponse(BaseModel):
    account_number: str
    outstanding_fees_gyd: float
    cycles: List[ProviderBillingCycleOut] = []


class BillingStatusUpdate(BaseModel):
    is_paid: bool


class BillingCycleStatusOut(BaseModel):
    account_number: str
    cycle_month: date
    is_paid: bool
    paid_at: Optional[datetime] = None


class BillingCycleMarkPaidIn(BaseModel):
    cycle_month: Optional[date] = None


class BillingCycleMarkAllPaidIn(BaseModel):
    cycle_month: date


class BillingCycleMarkAllPaidOut(BaseModel):
    cycle_month: date
    updated_count: int


class BillOut(BaseModel):
    id: int
    month: date
    total_gyd: float
    fee_gyd: float
    due_date: Optional[datetime] = None
    is_paid: bool

    class Config:
        from_attributes = True


class ProviderLockUpdate(BaseModel):
    is_locked: bool


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
    username: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    professions: Optional[List[str]] = None
    avatar_url: Optional[str] = None   # 👈 NEW

    @validator("username")
    def validate_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return normalize_and_validate_username(value)



class BookingWithDetails(BaseModel):
    id: int
    start_time: datetime
    end_time: datetime
    status: str
    canceled_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

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
    services: List[str] = []
    avatar_url: Optional[str] = None


class AvailabilitySlot(BaseModel):
    start_time: datetime  # full ISO datetime from backend


class ProviderAvailabilityDay(BaseModel):
    date: date            # YYYY-MM-DD
    slots: List[datetime]  # list of ISO datetimes (start times)


class PublicProviderOut(BaseModel):
    provider_id: int
    username: str
    display_name: str
    avatar_url: Optional[str] = None
    business_name: Optional[str] = None

class UserProfileOut(BaseModel):
    full_name: str
    phone: str
    whatsapp: Optional[str] = None
    location: str
    avatar_url: Optional[str] = None  # 👈 NEW



class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    location: Optional[str] = None
    avatar_url: Optional[str] = None  # 👈 NEW

    @validator("username")
    def validate_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return normalize_and_validate_username(value)


class ProviderSummary(BaseModel):
    account_number: str
    total_fees_due_gyd: float
    service_charge_percentage: Optional[float] = None

class RefreshTokenRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: int
    email: str
    is_provider: bool
    is_admin: bool

class ProviderLocationUpdate(BaseModel):
    lat: float
    long: float
    location: Optional[str] = None  # optional human-readable text

class ProviderCatalogImageOut(BaseModel):
    id: int
    image_url: str
    caption: Optional[str] = None

    class Config:
        from_attributes = True


class ServiceChargeUpdate(BaseModel):
    service_charge_percentage: float


class ServiceChargeOut(BaseModel):
    service_charge_percentage: float
