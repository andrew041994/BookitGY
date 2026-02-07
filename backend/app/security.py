from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app import crud, models

settings = get_settings()


def get_current_user_from_header(
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
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("uid")
    user_email: Optional[str] = payload.get("sub")
    if not user_id and not user_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    if user_id:
        user = crud.get_user_by_id(db, user_id, include_deleted=True)
    else:
        user = crud.get_user_by_email(db, user_email, include_deleted=True)

    if not user:
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
