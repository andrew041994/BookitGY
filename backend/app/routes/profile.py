from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, List

from app.database import get_db
from app import models, schemas, crud
from app.config import get_settings
from app.security import get_current_user_from_header


settings = get_settings()

router = APIRouter(tags=["profile"])





# =====================================================================
#  PROVIDER PROFILE
# =====================================================================

# GET /providers/me/profile
@router.get(
    "/providers/me/profile",
    response_model=schemas.ProviderProfileOut,
    status_code=status.HTTP_200_OK,
)
def read_my_provider_profile(
    user: models.User = Depends(get_current_user_from_header),
    db: Session = Depends(get_db),
):
    if not user.is_provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only providers can view provider profile",
        )

    provider = crud.get_or_create_provider_for_user(db, user.id)
    professions = crud.get_professions_for_provider(db, provider.id)

    return schemas.ProviderProfileOut(
        full_name=user.full_name or "",
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
        bio=provider.bio or "",
        professions=professions,
        avatar_url=provider.avatar_url,  # 👈 NEW
    )


# PUT /providers/me/profile
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
    if not user.is_provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only providers can edit provider profile",
        )

    provider = crud.get_or_create_provider_for_user(db, user.id)

    # Update basic user fields
    if payload.full_name is not None:
        user.full_name = payload.full_name

    if payload.phone is not None:
        user.phone = payload.phone

    if payload.whatsapp is not None:
        user.whatsapp = payload.whatsapp

    if payload.location is not None:
        user.location = payload.location

    # Update provider bio
    if payload.bio is not None:
        provider.bio = payload.bio

    if payload.avatar_url is not None:  # 👈 NEW
        provider.avatar_url = payload.avatar_url

    # Update professions if provided
    if payload.professions is not None:
        professions = crud.set_professions_for_provider(
            db, provider.id, payload.professions
        )
    else:
        professions = crud.get_professions_for_provider(db, provider.id)

    db.commit()
    db.refresh(user)
    db.refresh(provider)

    return schemas.ProviderProfileOut(
        full_name=user.full_name or "",
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
        bio=provider.bio or "",
        professions=professions,
        avatar_url=provider.avatar_url,  # 👈 NEW
    )


# =====================================================================
#  WORKING HOURS
# =====================================================================

# POST /providers/me/hours
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
            status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found"
        )

    hours_list = [h.dict() for h in hours]

    rows = crud.set_working_hours_for_provider(
        db, provider_id=provider.id, hours_list=hours_list
    )
    return rows


# =====================================================================
#  GENERIC USER PROFILE
# =====================================================================

# GET /me/profile  (optional: for future use on client side)
@router.get(
    "/me/profile",
    response_model=schemas.UserProfileOut,
    status_code=status.HTTP_200_OK,
)
def read_my_profile(
    user: models.User = Depends(get_current_user_from_header),
    db: Session = Depends(get_db),
):
    return schemas.UserProfileOut(
        full_name=user.full_name or "",
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
    )


# PUT /me/profile
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
        user.full_name = payload.full_name

    if payload.phone is not None:
        user.phone = payload.phone

    if payload.whatsapp is not None:
        user.whatsapp = payload.whatsapp

    if payload.location is not None:
        user.location = payload.location

    db.commit()
    db.refresh(user)

    return schemas.UserProfileOut(
        full_name=user.full_name or "",
        phone=user.phone or "",
        whatsapp=user.whatsapp,
        location=user.location or "",
    )
