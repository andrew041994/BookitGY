from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app import crud, schemas

router = APIRouter(tags=["auth"])
settings = get_settings()


@router.post("/auth/signup")
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # Check if email already exists
    existing = crud.get_user_by_email(db, user.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    created = crud.create_user(db, user)
      # If the user chose to register as a provider, ensure the flag is stored
    # and create their provider row too.
    if user.is_provider:
        if not getattr(created, "is_provider", False):
            created.is_provider = True
            db.commit()
            db.refresh(created)

        crud.get_or_create_provider_for_user(db, created.id)
    return created


def _create_access_token(subject: str) -> str:
    """
    Create a signed JWT access token for a given subject (user email).

    Adds:
    - exp: expiration time
    - iat: issued-at timestamp (seconds since epoch)
    """
    now = datetime.utcnow()
    expire = now + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": subject,
        "exp": expire,               # jose can handle datetime
        "iat": int(now.timestamp()), # numeric timestamp for freshness checks
    }

    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

def _create_password_reset_token(email: str) -> str:
    now = datetime.utcnow()
    expire = now + timedelta(minutes=30)

    payload = {
        "sub": email,
        "type": "password_reset",
        "exp": expire,
        "iat": int(now.timestamp()),
    }

    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def _decode_password_reset_token(token: str) -> str:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    if payload.get("type") != "password_reset":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid reset token",
        )

    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid reset token payload",
        )

    return email


@router.post("/auth/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Form-style login:
    - username: email
    - password: password
    """
    user = crud.authenticate_user(db, form_data.username, form_data.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    access_token = _create_access_token(user.email)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "email": user.email,
        "is_provider": user.is_provider,
        "is_admin": getattr(user, "is_admin", False),
    }


@router.post("/auth/login_by_email")
def login_by_email(
    payload: schemas.LoginByEmailPayload,
    db: Session = Depends(get_db),
):
    """
    JSON-style login:
    {
      "email": "...",
      "password": "..."
    }
    """
    user = crud.authenticate_user(db, payload.email, payload.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    access_token = _create_access_token(user.email)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "email": user.email,
        "is_provider": user.is_provider,
        "is_admin": getattr(user, "is_admin", False),
    }


@router.post("/auth/forgot-password")
def forgot_password(
    payload: schemas.ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    user = crud.get_user_by_email(db, payload.email)
    reset_link = None

    if user:
        token = _create_password_reset_token(user.email)
        reset_link = f"{settings.PASSWORD_RESET_URL}?token={token}"
        print(f"[RESET PASSWORD] Send this link to {user.email}: {reset_link}")

    response = {
        "message": "If an account exists for that email, a reset link has been sent.",
    }

    if settings.ENV == "dev":
        response["reset_link"] = reset_link

    return response


@router.post("/auth/reset-password")
def reset_password(payload: schemas.ResetPasswordPayload, db: Session = Depends(get_db)):
    email = _decode_password_reset_token(payload.token)
    user = crud.get_user_by_email(db, email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    crud.set_user_password(db, user, payload.new_password)

    return {"message": "Password updated successfully"}