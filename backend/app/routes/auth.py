from datetime import datetime, timedelta, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import secrets
import requests

from app.config import get_settings
from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header
from app.utils.email import send_password_reset_email, send_verification_email
from app.utils.passwords import validate_password, PASSWORD_REQUIREMENTS_MESSAGE
from app.utils.tokens import (
    build_reset_token_expiration,
    constant_time_compare,
    create_password_reset_token,
    hash_token,
    validate_reset_token_expiration,
    is_reset_token_expired,
    normalize_utc,
)
from app.utils.time import GUYANA_TIMEZONE

router = APIRouter(tags=["auth"])
settings = get_settings()
logger = logging.getLogger(__name__)


REFRESH_TOKEN_INACTIVITY_DAYS = 90


def _new_refresh_token_raw() -> str:
    return secrets.token_urlsafe(48)


def _create_refresh_token(db: Session, user_id: int) -> tuple[str, models.RefreshToken]:
    raw_token = _new_refresh_token_raw()
    token_hash = hash_token(raw_token)
    token_record = crud.create_refresh_token_record(db, user_id, token_hash)
    return raw_token, token_record


def _session_expired_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"detail": "session_expired", "code": "SESSION_EXPIRED"},
    )




def _facebook_error(status_code: int, code: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"detail": code, "code": code})


def _facebook_graph_version() -> str:
    return settings.FACEBOOK_GRAPH_VERSION


def _verify_facebook_access_token(user_token: str) -> dict:
    app_id = settings.FACEBOOK_APP_ID
    app_secret = settings.FACEBOOK_APP_SECRET
    if not app_id or not app_secret:
        raise _facebook_error(status.HTTP_401_UNAUTHORIZED, "FB_TOKEN_INVALID")

    version = _facebook_graph_version()
    try:
        debug_resp = requests.get(
            f"https://graph.facebook.com/{version}/debug_token",
            params={
                "input_token": user_token,
                "access_token": f"{app_id}|{app_secret}",
            },
            timeout=10,
        )
        debug_data = debug_resp.json().get("data", {}) if debug_resp.ok else {}
    except Exception:
        raise _facebook_error(status.HTTP_401_UNAUTHORIZED, "FB_TOKEN_INVALID")

    if (
        not debug_data.get("is_valid")
        or str(debug_data.get("app_id") or "") != str(app_id)
        or not debug_data.get("user_id")
    ):
        raise _facebook_error(status.HTTP_401_UNAUTHORIZED, "FB_TOKEN_INVALID")

    try:
        profile_resp = requests.get(
            f"https://graph.facebook.com/{version}/me",
            params={
                "fields": "id,name,email",
                "access_token": user_token,
            },
            timeout=10,
        )
        profile = profile_resp.json() if profile_resp.ok else {}
    except Exception:
        raise _facebook_error(status.HTTP_401_UNAUTHORIZED, "FB_TOKEN_INVALID")

    fb_user_id = profile.get("id") or debug_data.get("user_id")
    if not fb_user_id:
        raise _facebook_error(status.HTTP_401_UNAUTHORIZED, "FB_TOKEN_INVALID")

    return {
        "id": str(fb_user_id),
        "name": (profile.get("name") or "").strip(),
        "email": (profile.get("email") or "").strip().lower() or None,
    }


def _facebook_auth_response(db: Session, user: models.User) -> dict:
    access_token = _create_access_token(user.email, user.token_version, user.id)
    refresh_token, _ = _create_refresh_token(db, user.id)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "phone": user.phone,
            "is_provider": user.is_provider,
            "is_admin": getattr(user, "is_admin", False),
        },
    }


@router.post("/auth/signup")
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    try:
        validate_password(user.password)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=PASSWORD_REQUIREMENTS_MESSAGE,
        )

    # Check if email already exists
    existing = crud.get_user_by_email(db, user.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    username_taken = crud.get_user_by_username(db, user.username)
    if username_taken:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken",
        )

    # Create user
    try:
        created = crud.create_user(db, user)
    except IntegrityError as exc:
        detail = str(getattr(exc, "orig", exc))
        if "users_username_lower_unique" in detail:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken",
            )
        if "ix_users_email" in detail or "users_email" in detail:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        raise
    # If the user chose to register as a provider, ensure the flag is stored
    # and create their provider row too.
    if user.is_provider:
        if not getattr(created, "is_provider", False):
            created.is_provider = True
            db.commit()
            db.refresh(created)

        crud.get_or_create_provider_for_user(db, created.id)

    verification_token = _create_email_verification_token(created.email)
    verification_link = (
        f"{settings.EMAIL_VERIFICATION_URL}?token={verification_token}"
    )

    send_verification_email(created.email, verification_link)

    safe_user = schemas.UserOut.model_validate(created)
    response = {"user": safe_user, "message": "Verification email sent."}
    if settings.ENV == "dev":
        response["verification_link"] = verification_link

    return response


def _create_access_token(subject: str, token_version: int, user_id: int) -> str:
    """
    Create a signed JWT access token for a given subject (user email).

    Adds:
    - exp: expiration time
    - iat: issued-at timestamp (seconds since epoch)
    """
    aware_now = datetime.now(GUYANA_TIMEZONE)
    now = aware_now.replace(tzinfo=None)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": subject,
        "exp": expire,               # jose can handle datetime
        "iat": int(aware_now.timestamp()), # numeric timestamp for freshness checks
        "tv": token_version,
        "uid": user_id,
    }

    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

def _create_email_verification_token(email: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=settings.EMAIL_TOKEN_EXPIRES_MINUTES)

    payload = {
        "sub": email,
        "type": "email_verification",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "nonce": secrets.token_urlsafe(8),
    }

    return jwt.encode(
        payload,
        settings.EMAIL_TOKEN_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    
    )


def _decode_email_verification_token(token: str) -> str:
    try:
        payload = jwt.decode(
            token,
            settings.EMAIL_TOKEN_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )

    if payload.get("type") != "email_verification":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification token",
        )

    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification token payload",
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

    if not getattr(user, "is_email_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )

    access_token = _create_access_token(user.email, user.token_version, user.id)
    refresh_token, _ = _create_refresh_token(db, user.id)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
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

    if not getattr(user, "is_email_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )

    access_token = _create_access_token(user.email, user.token_version, user.id)
    refresh_token, _ = _create_refresh_token(db, user.id)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user_id": user.id,
        "email": user.email,
        "is_provider": user.is_provider,
        "is_admin": getattr(user, "is_admin", False),
    }




@router.post("/auth/facebook/complete")
def facebook_complete(
    payload: schemas.FacebookCompleteRequest,
    db: Session = Depends(get_db),
):
    phone = crud.normalize_phone(payload.phone)
    if not phone:
        raise _facebook_error(status.HTTP_400_BAD_REQUEST, "PHONE_REQUIRED")

    fb_profile = _verify_facebook_access_token(payload.facebook_access_token)
    fb_email = fb_profile.get("email")
    request_email = (payload.email or "").strip().lower() or None
    final_email = fb_email or request_email

    if not final_email:
        raise _facebook_error(status.HTTP_400_BAD_REQUEST, "EMAIL_REQUIRED")

    phone_owner = crud.get_user_by_phone(db, phone)
    fb_identity = crud.get_oauth_identity(db, "facebook", fb_profile["id"])
    if fb_identity:
        user = crud.get_user_by_id(db, fb_identity.user_id)
        if not user:
            raise _facebook_error(status.HTTP_401_UNAUTHORIZED, "FB_TOKEN_INVALID")
        return _facebook_auth_response(db, user)

    if phone_owner:
        raise _facebook_error(status.HTTP_400_BAD_REQUEST, "PHONE_TAKEN")

    user = None
    if fb_email:
        user = crud.get_user_by_email(db, fb_email)

    if user:
        crud.create_oauth_identity(
            db,
            user_id=user.id,
            provider="facebook",
            provider_user_id=fb_profile["id"],
            email=fb_email,
        )
        return _facebook_auth_response(db, user)

    username_seed = fb_profile.get("name") or final_email.split("@")[0] or "facebook_user"
    unique_username = crud.generate_unique_username(db, username_seed)

    try:
        user = crud.create_user_for_oauth(
            db,
            email=final_email,
            phone=phone,
            username=unique_username,
            is_provider=payload.is_provider,
        )
    except IntegrityError as exc:
        detail = str(getattr(exc, "orig", exc))
        if "users_phone" in detail or "phone" in detail:
            raise _facebook_error(status.HTTP_400_BAD_REQUEST, "PHONE_TAKEN")
        raise

    if payload.is_provider:
        crud.get_or_create_provider_for_user(db, user.id)

    crud.create_oauth_identity(
        db,
        user_id=user.id,
        provider="facebook",
        provider_user_id=fb_profile["id"],
        email=fb_email or request_email,
    )

    return _facebook_auth_response(db, user)


@router.post("/auth/refresh")
def refresh_session(
    payload: schemas.RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    raw_token = (payload.refresh_token or "").strip()
    if not raw_token:
        raise _session_expired_error()

    token_hash = hash_token(raw_token)
    token_record = crud.get_refresh_token_by_hash(db, token_hash)
    if not token_record:
        raise _session_expired_error()

    if token_record.revoked_at is not None:
        raise _session_expired_error()

    user = crud.get_user_by_id(db, token_record.user_id, include_deleted=True)
    if not user or crud.user_is_deleted(user):
        raise _session_expired_error()

    now = datetime.now(GUYANA_TIMEZONE).replace(tzinfo=None)
    inactivity_cutoff = token_record.last_used_at + timedelta(days=REFRESH_TOKEN_INACTIVITY_DAYS)
    if now > inactivity_cutoff:
        crud.revoke_refresh_token(db, token_record)
        raise _session_expired_error()

    if user.password_changed_at and token_record.created_at <= user.password_changed_at:
        crud.revoke_refresh_token(db, token_record)
        raise _session_expired_error()

    new_refresh_token, new_record = _create_refresh_token(db, user.id)
    crud.revoke_refresh_token(db, token_record, replaced_by_token_id=new_record.id)

    access_token = _create_access_token(user.email, user.token_version, user.id)
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "user_id": user.id,
        "email": user.email,
        "is_provider": user.is_provider,
        "is_admin": getattr(user, "is_admin", False),
    }


@router.post("/auth/logout")
def logout(
    payload: schemas.RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    raw_token = (payload.refresh_token or "").strip()
    if raw_token:
        token_hash = hash_token(raw_token)
        token_record = crud.get_refresh_token_by_hash(db, token_hash)
        if token_record and token_record.revoked_at is None:
            crud.revoke_refresh_token(db, token_record)

    return {"ok": True}


@router.post("/auth/forgot-password")
def forgot_password(
    payload: schemas.ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    user = crud.get_user_by_email(db, payload.email)
    reset_link = None

    if user:
        raw_token = create_password_reset_token()
        token_hash = hash_token(raw_token)
        expires_at = build_reset_token_expiration()
        crud.invalidate_password_reset_tokens(db, user.id)
        crud.create_password_reset_token(db, user.id, token_hash, expires_at)
        reset_link = f"{settings.PASSWORD_RESET_URL}?token={raw_token}"
        send_password_reset_email(user.email, reset_link)

    response = {
        "message": "If an account exists for that email, a reset link has been sent.",
    }

    if settings.ENV == "dev" and reset_link:
        response["reset_link"] = reset_link

    return response


@router.post("/auth/reset-password")
def reset_password(payload: schemas.ResetPasswordPayload, db: Session = Depends(get_db)):
    raw_token = (payload.token or "").strip()
    if not raw_token:
        logger.info("Password reset token validation failed: missing token")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    token_hash = hash_token(raw_token)
    token_record = crud.get_password_reset_token_by_hash(db, token_hash)

    if not token_record:
        logger.info("Password reset token validation failed: not found")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    if token_record.used_at is not None:
        logger.info("Password reset token validation failed: already used")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    if not constant_time_compare(token_record.token_hash, token_hash):
        logger.info("Password reset token validation failed: hash mismatch")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    if is_reset_token_expired(token_record.expires_at):
        logger.info("Password reset token validation failed: expired")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    validate_reset_token_expiration(token_record.expires_at)

    user = crud.get_user_by_id(db, token_record.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    try:
        validate_password(payload.new_password)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=PASSWORD_REQUIREMENTS_MESSAGE,
        )

    crud.set_user_password_reset(db, user, payload.new_password)
    crud.mark_password_reset_token_used(db, token_record)

    return {"message": "Password updated successfully"}


@router.get("/auth/reset-password/debug")
def reset_password_debug(
    token: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    if settings.ENV == "prod":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if settings.ENV != "dev" and not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )

    token_hash = hash_token(token)
    token_record = crud.get_password_reset_token_by_hash(db, token_hash)

    if not token_record:
        return {
            "found": False,
            "expired": False,
            "used": False,
            "expires_at": None,
        }

    expires_at = normalize_utc(token_record.expires_at)
    return {
        "found": True,
        "expired": is_reset_token_expired(token_record.expires_at),
        "used": token_record.used_at is not None,
        "expires_at": expires_at.isoformat(),
    }


@router.post("/auth/verify-email")
def verify_email(payload: schemas.VerifyEmailPayload, db: Session = Depends(get_db)):
    return _verify_email_token(payload.token, db)


@router.get("/auth/verify")
def verify_email_link(token: str, db: Session = Depends(get_db)):
    try:
        result = _verify_email_token(token, db)
        if result.get("verified"):
            redirect_url = f"{settings.FRONTEND_LOGIN_URL}?verified=1"
        else:
            redirect_url = (
                f"{settings.FRONTEND_LOGIN_URL}"
                "?verified=0&reason=invalid_or_expired"
            )
    except HTTPException:
        redirect_url = (
            f"{settings.FRONTEND_LOGIN_URL}"
            "?verified=0&reason=invalid_or_expired"
        )

    return RedirectResponse(url=redirect_url, status_code=302)


def _verify_email_token(token: str, db: Session) -> dict:
    email = _decode_email_verification_token(token)
    user = crud.get_user_by_email(db, email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if getattr(user, "is_email_verified", False):
        return {
            "message": "Email already verified",
            "verified": True,
            "verified_at": user.email_verified_at,
        }

    crud.verify_user_email(db, user)
    logger.info(
        "Email verified for user_id=%s email=%s",
        user.id,
        user.email,
    )
    return {
        "message": "Email verified successfully",
        "verified": True,
        "verified_at": user.email_verified_at,
    }


@router.get(
    "/auth/verify-status",
    response_model=schemas.VerifyEmailStatus,
)
def verify_email_status(
    email: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    if not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )

    user = crud.get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return {
        "email": user.email,
        "is_email_verified": bool(user.is_email_verified),
        "email_verified_at": user.email_verified_at,
    }
