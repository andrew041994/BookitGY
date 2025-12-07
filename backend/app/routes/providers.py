from typing import List, Optional
import tempfile
import os
import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.services.cloudinary_service import upload_avatar
from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header
from app.config import get_settings


settings = get_settings()

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
    secure=True,
)

router = APIRouter(tags=["providers"])

def _require_current_provider(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
) -> models.Provider:
    if not current_user.is_provider:
        raise HTTPException(
            status_code=403, detail="Only providers can access this endpoint",
        )

    provider = crud.get_provider_by_user_id(db, current_user.id)
    if not provider:
        provider = crud.create_provider_for_user(db, current_user)
    return provider

# -------------------------------------------------------------------
# Provider "me" profile
# -------------------------------------------------------------------

def _get_provider_for_user(db: Session, current_user: models.User) -> models.Provider:
    if not current_user.is_provider:
        raise HTTPException(
            status_code=403, detail="Only providers can access this endpoint",
        )

    provider = crud.get_provider_by_user_id(db, current_user.id)
    if not provider:
        provider = crud.create_provider_for_user(db, current_user)
    return provider


def _require_current_provider(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
) -> models.Provider:
    return _get_provider_for_user(db, current_user)


# -------------------------------------------------------------------
# Provider "me" profile
# -------------------------------------------------------------------

@router.get("/providers/me")
def get_my_provider(
    provider: models.Provider = Depends(_require_current_provider),
):
    return provider




@router.post("/providers/me/avatar")
def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider), 
):
    """
    Upload or update the current provider's avatar image.
    Expects multipart/form-data with a file field named 'file'.
    """
    # Save uploaded file to a temp file so Cloudinary can read it
    suffix = "." + (file.filename.split(".")[-1] if "." in file.filename else "jpg")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        public_id = f"provider_{provider.id}_avatar"
        avatar_url = upload_avatar(tmp_path, public_id=public_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Avatar upload failed: {e}")

    provider.avatar_url = avatar_url
    db.commit()
    db.refresh(provider)

    return {"avatar_url": provider.avatar_url}

# -------------------------------------------------------------------
# Provider "me" services
# -------------------------------------------------------------------

@router.get("/providers/me/services")
def list_my_services(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_services_for_provider(db, provider.id)


@router.post("/providers/me/services")
def create_my_service(
    service_in: schemas.ServiceCreate,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.create_service_for_provider(db, provider.id, service_in)


@router.put("/providers/me/services/{service_id}")
def update_my_service(
    service_id: int,
    service_update: schemas.ServiceUpdate,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.update_service(db, provider.id, service_id, service_update)


@router.delete("/providers/me/services/{service_id}")
def delete_my_service(
    service_id: int,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    crud.delete_service(db, provider.id, service_id)
    return {"status": "deleted"}


# -------------------------------------------------------------------
# Provider "me" working-hours + summary
# -------------------------------------------------------------------

@router.get("/providers/me/working-hours", response_model=List[schemas.WorkingHoursOut])
def get_my_working_hours(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    """
    Return 7 rows (Mon–Sun). If none exist, create defaults (all closed)
    so the frontend always has something to render.
    """
    return crud.get_or_create_working_hours_for_provider(db, provider.id)


@router.put(
    "/providers/me/working-hours",
    response_model=List[schemas.WorkingHoursOut],
)
def update_my_working_hours(
    hours: List[schemas.ProviderWorkingHoursUpdate],
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    """
    Replace this provider's working hours with the given list.
    Each item should have: weekday, is_closed, start_time, end_time.
    """

    # Convert Pydantic models -> plain dicts for the CRUD helper
    rows = crud.set_working_hours_for_provider(
        db=db,
        provider_id=provider.id,
        hours_list=[h.model_dump() for h in hours],
    )
    return rows


@router.get("/providers/me/summary")
def get_my_provider_summary(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):

    # You can wire this to real fee logic if desired:
    # fees_due = crud.get_provider_fees_due(db, provider.id)
    total_fees_due = 0

    return {
        "account_number": provider.account_number,
        "total_fees_due_gyd": float(total_fees_due or 0.0),
    }

# -------------------------------------------------------------------
# Provider "me" location pin
# -------------------------------------------------------------------

@router.put("/providers/me/location", response_model=schemas.ProviderLocationUpdate)
def update_my_location(
    payload: schemas.ProviderLocationUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    """
    Update the current provider's pinned map location (lat/long and optional text).

    This:
    - Only works for users marked as providers.
    - Stores coordinates on the User record (lat, long, location).
    """

    if not current_user.is_provider:
        raise HTTPException(
            status_code=403,
            detail="Only providers can pin their location.",
        )

    # Basic validation in case the frontend sends weird values
    if payload.lat is None or payload.long is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude and longitude are required.",
        )

    # Update the user's location fields
    current_user.lat = payload.lat
    current_user.long = payload.long

    if payload.location is not None:
        current_user.location = payload.location

    db.commit()
    db.refresh(current_user)

    return schemas.ProviderLocationUpdate(
        lat=current_user.lat,
        long=current_user.long,
        location=current_user.location,
    )


# -------------------------------------------------------------------
# Public provider routes
# -------------------------------------------------------------------

@router.get("/providers")
def list_providers(
    profession: Optional[str] = None,
    db: Session = Depends(get_db),
):
    return crud.list_providers(db, profession=profession)


@router.get("/providers/{provider_id}")
def get_provider(provider_id: int, db: Session = Depends(get_db)):
    provider = crud.get_provider(db, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    return provider


@router.get("/providers/{provider_id}/services")
def list_provider_services(provider_id: int, db: Session = Depends(get_db)):
    return crud.list_services_for_provider(db, provider_id)

@router.get(
    "/providers/{provider_id}/availability",
    response_model=List[schemas.ProviderAvailabilityDay],
)
def get_provider_availability_route(
    provider_id: int,
    service_id: int,
    days: int = 14,
    db: Session = Depends(get_db),
):
    """
    Availability for a specific provider + service over the next `days`.
    Used by the client calendar/time slot picker.
    """
    try:
        availability = crud.get_provider_availability(
            db,
            provider_id=provider_id,
            service_id=service_id,
            days=days,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return availability



@router.put("/providers/me")
# NOTE: This is the canonical PUT /providers/me route; avoid defining duplicates
# elsewhere to prevent FastAPI from choosing an unexpected handler.
def update_my_provider_profile(
    payload: schemas.ProviderUpdate,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    """
    Update provider profile fields (bio, location text, whatsapp, is_active, professions).

    Coordinate updates (lat/long) are handled exclusively by /providers/me/location
    with proper validation, so they are NOT accepted here.
    """

    # Update provider row via CRUD helper
    updated = crud.update_provider(db, provider.id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Provider not found")

    # Optionally keep user's contact info in sync
    if payload.location is not None:
        current_user.location = payload.location
    if payload.whatsapp is not None:
        current_user.whatsapp = payload.whatsapp

    db.commit()
    db.refresh(updated)
    db.refresh(current_user)

    return updated



