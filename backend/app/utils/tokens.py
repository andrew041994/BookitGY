import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.config import get_settings

settings = get_settings()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def create_password_reset_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def constant_time_compare(val1: str, val2: str) -> bool:
    return hmac.compare_digest(val1, val2)


def is_reset_token_expired(expires_at: datetime) -> bool:
    return utc_now() > normalize_utc(expires_at)


def validate_reset_token_expiration(expires_at: datetime) -> None:
    if is_reset_token_expired(expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )


def build_reset_token_expiration() -> datetime:
    return utc_now() + timedelta(
        minutes=settings.PASSWORD_RESET_EXPIRES_MINUTES
    )
