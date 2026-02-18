from datetime import datetime, timedelta
import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWSSignatureError, JWTError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app import crud, models
from app.auth.jwt_config import get_jwt_algorithm, get_jwt_secret_key

logger = logging.getLogger(__name__)
settings = get_settings()


def _token_fingerprint(token: str) -> str:
    if len(token) <= 20:
        return token
    return f"{token[:10]}{token[-10:]}"


def _decode_error_type(exc: Exception) -> str:
    if isinstance(exc, ExpiredSignatureError):
        return "ExpiredSignatureError"
    if isinstance(exc, JWSSignatureError):
        return "InvalidSignatureError"
    if isinstance(exc, JWTError):
        return "DecodeError"
    return type(exc).__name__


def get_current_user_from_header(
    request: Request,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> models.User:
    """
    Resolve the current user from a Bearer JWT in the Authorization header.

    - Validates the header format.
    - Decodes and verifies the JWT.
    - Looks up the user by email (sub).
    - Optionally enforces token freshness using 'iat' and a max age.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format",
        )

    token = parts[1]

    try:
        payload = jwt.decode(
            token,
            get_jwt_secret_key(),
            algorithms=[get_jwt_algorithm()],
        )
    except JWTError as exc:
        logger.warning(
            "Bearer token decode failed path=%s error_type=%s token_fingerprint=%s",
            request.url.path,
            _decode_error_type(exc),
            _token_fingerprint(token),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    logger.info(
        "Bearer token decode success path=%s sub=%s user_id=%s exp=%s iat=%s aud=%s iss=%s",
        request.url.path,
        payload.get("sub"),
        payload.get("uid"),
        int(payload.get("exp")) if isinstance(payload.get("exp"), (int, float)) else payload.get("exp"),
        int(payload.get("iat")) if isinstance(payload.get("iat"), (int, float)) else payload.get("iat"),
        payload.get("aud"),
        payload.get("iss"),
    )

    raw_user_id = payload.get("uid")
    user_id = int(raw_user_id) if isinstance(raw_user_id, (int, str)) and str(raw_user_id).isdigit() else raw_user_id
    user_email: Optional[str] = payload.get("sub")
    if not user_id and not user_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = None
    if user_id:
        user = crud.get_user_by_id(db, user_id, include_deleted=True)
    if not user and user_email:
        user = crud.get_user_by_email(db, user_email, include_deleted=True)

    if not user:
        logger.warning(
            "Bearer token user lookup failed path=%s sub=%s user_id=%s",
            request.url.path,
            user_email,
            user_id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if crud.user_is_deleted(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    token_version = payload.get("tv")
    if token_version is None or token_version != user.token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    # ------------------------------------------------------------------
    # Token freshness check using iat
    # ------------------------------------------------------------------
    issued_at_ts = payload.get("iat")
    if isinstance(issued_at_ts, (int, float)):
        issued_at = datetime.utcfromtimestamp(issued_at_ts)

        # You can override MAX_TOKEN_AGE_MINUTES in env; if not present,
        # fall back to the same value as ACCESS_TOKEN_EXPIRE_MINUTES.
        max_age_minutes = getattr(
            settings,
            "MAX_TOKEN_AGE_MINUTES",
            settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        )

        if (datetime.utcnow() - issued_at) > timedelta(minutes=max_age_minutes):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token is too old, please log in again",
            )

    return user
