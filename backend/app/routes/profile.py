from typing import List
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app import models, schemas, crud
from app.config import get_settings
from app.security import get_current_user_from_header

settings = get_settings()

router = APIRouter(tags=["profile"])

MAX_AVATAR_URL_LENGTH = 500


def _sanitize_avatar_url(raw_url: str) -> str:
    """
    Validate and normalize an avatar URL before saving it.

    - Rejects empty/whitespace-only values.
    - Requires http:// or https:// scheme.
    - Enforces a max length to avoid abuse payloads.
    """
    if raw_url is None:
        return None

    url = raw_url.strip()
    if not url:
        return ""

    if len(url) > MAX_AVATAR_URL_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar URL is too long",
        )

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar URL must start with http:// or https://",
        )

    return url


# =====================================================================
#  PROVIDER PROFILE
# =====================================================================


@router.get(
    "/providers/me/profile",
    response_model=schemas.ProviderProfileOut,
    status_code=status.HTTP_200_OK,
)
def read_my_provider_profile(
    user: models.User = Depends(get_current_user_from_header),
    db: Session = Depends(get_db),
):
    """
    Return the current provider's profile.

    Only users with is_provider=True and an existing provider row
    are allowed to access this.
    """
    if not user.is_provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only providers can view provider profile",
        )

    provider = crud.get_provider_for_user(db, user.id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have a provider profile. Contact support or an admin.",
        )

    professions = crud.get_professions_for_provider(db, provider.id)

    return schemas.ProviderProfileOut(
        full_name=crud.get_display_name(user),
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
        bio=provider.bio or "",
        professions=professions,
        avatar_url=provider.avatar_url,
    )


@router.put(
    "/providers/me/profile",
    response_model=schemas.ProviderProfileOut,
    status_code=status.HTTP_200_OK,
)
def update_my_provider_profile(
    payload: schemas.ProviderProfileUpdate,
    user: models.User = Depends(get_current_user_from_header),
    db: Session = Depends(get_db),
):
    """
    Update the current provider's profile (user + provider fields).
    """
    if not user.is_provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only providers can edit provider profile",
        )

    provider = crud.get_provider_for_user(db, user.id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have a provider profile. Contact support or an admin.",
        )

    # Update basic user fields
    if payload.full_name is not None:
        try:
            crud.set_username_from_full_name(db, user, payload.full_name)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )

    if payload.phone is not None:
        user.phone = payload.phone

    if payload.whatsapp is not None:
        user.whatsapp = payload.whatsapp

    if payload.location is not None:
        user.location = payload.location

    # Update provider bio
    if payload.bio is not None:
        provider.bio = payload.bio

    # Update avatar URL (sanitized)
    if payload.avatar_url is not None:
        provider.avatar_url = _sanitize_avatar_url(payload.avatar_url)

    # Update professions if provided
    if payload.professions is not None:
        professions = crud.set_professions_for_provider(
            db, provider.id, payload.professions
        )
    else:
        professions = crud.get_professions_for_provider(db, provider.id)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        detail = str(getattr(exc, "orig", exc))
        if "users_username_lower_unique" in detail:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken",
            )
        raise
    db.refresh(user)
    db.refresh(provider)

    return schemas.ProviderProfileOut(
        full_name=crud.get_display_name(user),
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
        bio=provider.bio or "",
        professions=professions,
        avatar_url=provider.avatar_url,
    )


# =====================================================================
#  WORKING HOURS
# =====================================================================


@router.post(
    "/providers/me/hours",
    response_model=List[schemas.WorkingHoursOut],
    status_code=status.HTTP_200_OK,
)
def update_my_working_hours(
    hours: List[schemas.WorkingHoursUpdate],
    user: models.User = Depends(get_current_user_from_header),
    db: Session = Depends(get_db),
):
    if not user.is_provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only providers can manage working hours",
        )

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    hours_list = [h.dict() for h in hours]

    rows = crud.set_working_hours_for_provider(
        db, provider_id=provider.id, hours_list=hours_list
    )
    return rows


# =====================================================================
#  GENERIC USER PROFILE
# =====================================================================

@router.put(
    "/me/profile",
    response_model=schemas.UserProfileOut,
    status_code=status.HTTP_200_OK,
)
def update_my_profile(
    payload: schemas.UserProfileUpdate,
    user: models.User = Depends(get_current_user_from_header),
    db: Session = Depends(get_db),
):
    if payload.full_name is not None:
        try:
            crud.set_username_from_full_name(db, user, payload.full_name)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )

    if payload.phone is not None:
        user.phone = payload.phone

    if payload.whatsapp is not None:
        user.whatsapp = payload.whatsapp

    if payload.location is not None:
        user.location = payload.location

    if payload.avatar_url is not None:      # 👈 NEW
        user.avatar_url = payload.avatar_url

    db.commit()
    db.refresh(user)

    return schemas.UserProfileOut(
        full_name=crud.get_display_name(user),
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
        avatar_url=user.avatar_url,
    )
