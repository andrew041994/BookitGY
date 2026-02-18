from datetime import datetime, timedelta, timezone
import logging
from typing import Any

from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError, JWSSignatureError

from app.auth.jwt_config import (
    get_access_token_expire_minutes,
    get_jwt_algorithm,
    get_jwt_secret_key,
)

logger = logging.getLogger(__name__)

REFRESH_TOKEN_EXPIRE_DAYS = 30


def _decode_error_type(exc: Exception) -> str:
    if isinstance(exc, ExpiredSignatureError):
        return "ExpiredSignatureError"
    if isinstance(exc, JWSSignatureError):
        return "InvalidSignatureError"
    if isinstance(exc, JWTError):
        return "DecodeError"
    return type(exc).__name__


def create_access_token(data: dict[str, Any]) -> str:
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(minutes=get_access_token_expire_minutes())
    payload = {
        **data,
        "iat": int(issued_at.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, get_jwt_secret_key(), algorithm=get_jwt_algorithm())


def create_refresh_token(data: dict[str, Any]) -> str:
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        **data,
        "type": "refresh",
        "iat": int(issued_at.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, get_jwt_secret_key(), algorithm=get_jwt_algorithm())


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            get_jwt_secret_key(),
            algorithms=[get_jwt_algorithm()],
        )
    except JWTError as exc:
        logger.warning("JWT decode failed error_type=%s", _decode_error_type(exc))
        raise
