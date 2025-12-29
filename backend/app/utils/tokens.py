import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status

from app.config import get_settings
from app.utils.time import GUYANA_TIMEZONE, now_guyana

settings = get_settings()

def normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=GUYANA_TIMEZONE)
    return value.astimezone(GUYANA_TIMEZONE)


def create_password_reset_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def constant_time_compare(val1: str, val2: str) -> bool:
    return hmac.compare_digest(val1, val2)


def is_reset_token_expired(expires_at: datetime) -> bool:
    return now_guyana() > normalize_utc(expires_at).replace(tzinfo=None)


def validate_reset_token_expiration(expires_at: datetime) -> None:
    if is_reset_token_expired(expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )


def build_reset_token_expiration() -> datetime:
    return now_guyana() + timedelta(
        minutes=settings.PASSWORD_RESET_EXPIRES_MINUTES
    )
