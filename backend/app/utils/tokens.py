import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status

from app.config import get_settings

settings = get_settings()


def create_password_reset_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def constant_time_compare(val1: str, val2: str) -> bool:
    return hmac.compare_digest(val1, val2)


def validate_reset_token_expiration(expires_at: datetime) -> None:
    if datetime.utcnow() > expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )


def build_reset_token_expiration() -> datetime:
    return datetime.utcnow() + timedelta(
        minutes=settings.PASSWORD_RESET_EXPIRES_MINUTES
    )
