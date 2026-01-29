from typing import List, Optional
import os
from io import BytesIO
import cloudinary
import cloudinary.uploader
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
    status,
    Form,
    Query,
)
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from tempfile import NamedTemporaryFile

from app.services.cloudinary_service import upload_avatar
from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header
from app.config import get_settings
from PIL import Image, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 10_000_000 
settings = get_settings()

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
    secure=True,
)

router = APIRouter(tags=["providers"])


@router.get(
    "/public/providers/by-username/{username}",
    response_model=schemas.PublicProviderOut,
    status_code=status.HTTP_200_OK,
)
def get_public_provider_by_username(username: str, db: Session = Depends(get_db)):
    """Return public provider information by username (case-insensitive)."""

    user = crud.get_user_by_username(db, username)
    if not user or getattr(user, "is_deleted", False) or not getattr(
        user, "is_provider", False
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    return schemas.PublicProviderOut(
        provider_id=provider.id,
        username=user.username,
        display_name=crud.get_display_name(user),
        avatar_url=provider.avatar_url or user.avatar_url,
        business_name=None,
    )

# -------------------------------------------------------------------
# Avatar upload validation
# -------------------------------------------------------------------

ALLOWED_AVATAR_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_AVATAR_FORMATS = {"JPEG", "PNG", "WEBP"}

MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
MAX_AVATAR_DIMENSION = 4096  # cap width/height to avoid extremely large images

def _validate_image_contents(contents: bytes) -> None:
    """Ensure the uploaded bytes are a real, reasonably sized image."""
    try:
        with Image.open(BytesIO(contents)) as img:
            img_format = (img.format or "").upper()
            img.verify()
    except UnidentifiedImageError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid image.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read uploaded image.",
        )

    if img_format not in ALLOWED_AVATAR_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image format. Allowed: JPEG, PNG, WEBP.",
        )

    try:
        with Image.open(BytesIO(contents)) as img_dim:
            width, height = img_dim.size
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not inspect image dimensions.",
        )

    if width > MAX_AVATAR_DIMENSION or height > MAX_AVATAR_DIMENSION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar image dimensions are too large.",
        )



def _ensure_pillow():
    """Import Pillow lazily so missing deps don’t break app startup."""
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image validation dependency missing (Pillow). Install backend requirements.",
        ) from exc

    # Guard against decompression bombs
    Image.MAX_IMAGE_PIXELS = 10_000_000
    return Image, UnidentifiedImageError

def _scan_bytes_for_viruses(data: bytes) -> None:
    """
    Hook for virus scanning.

    In production, integrate with ClamAV or a third-party AV API.
    For now it's a no-op stub to make the security intent explicit.
    """
    # Example:
    # result = antivirus_client.scan_bytes(data)
    # if not result.clean:
    #     raise HTTPException(
    #         status_code=status.HTTP_400_BAD_REQUEST,
    #         detail="Malicious file detected",
    #     )
 
    return


# -------------------------------------------------------------------
# Provider helper (no auto-creation)
# -------------------------------------------------------------------

def _get_provider_for_user(db: Session, current_user: models.User) -> models.Provider:
    """
    Return the Provider row for the current user.

    - Requires is_provider=True
    - Does NOT auto-create; missing provider -> 403/404
    """
    if not current_user.is_provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only providers can access this endpoint",
        )

    provider = crud.get_provider_by_user_id(db, current_user.id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have a provider profile. Contact support or an admin.",
        )
    return provider


def _require_current_provider(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
) -> models.Provider:
    return _get_provider_for_user(db, current_user)


# -------------------------------------------------------------------
# Provider "me" avatar
# -------------------------------------------------------------------

@router.post("/providers/me/avatar")
async def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    provider = _get_provider_for_user(db, current_user)

    # Validate MIME type
    if file.content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid avatar file type. Allowed: JPEG, PNG, WEBP.",
        )

    # Read and enforce size
    contents = await file.read()
    if len(contents) > MAX_AVATAR_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar file is too large. Maximum size is 5 MB.",
        )
    
    _validate_image_contents(contents)

    # Optional malware scan
    _scan_bytes_for_viruses(contents)

    # Write to a temporary file for Cloudinary
    try:
        with NamedTemporaryFile(delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to buffer uploaded file",
        )

    # Upload using your Cloudinary helper
    try:
        upload_result = upload_avatar(tmp_path)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload avatar",
        )
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    if isinstance(upload_result, dict):
        secure_url = upload_result.get("secure_url")
    else:
        secure_url = str(upload_result)

    if not secure_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Avatar upload did not return a valid URL",
)

    provider.avatar_url = secure_url
    db.commit()
    db.refresh(provider)

    return {"avatar_url": secure_url}


# -------------------------------------------------------------------
# Provider "me" profile
# -------------------------------------------------------------------

@router.get("/providers/me")
def get_my_provider(
    provider: models.Provider = Depends(_require_current_provider),
):
    return provider


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
    try:
        return crud.create_service_for_provider(db, provider.id, service_in)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Service name, price, and duration are required.",
        )


@router.put("/providers/me/services/{service_id}")
def update_my_service(
    service_id: int,
    service_update: schemas.ServiceUpdate,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    try:
        return crud.update_service(db, provider.id, service_id, service_update)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Service name, price, and duration are required.",
        )


@router.delete("/providers/me/services/{service_id}")
def delete_my_service(
    service_id: int,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    status = crud.delete_service(db, provider.id, service_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"ok": True, "status": status}


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
    total_fees_due = crud.get_provider_fees_due(db, provider.id)
    credit_balance = crud.get_provider_credit_balance(db, provider.id)
    service_charge_pct = crud.get_platform_service_charge_percentage(db)

    return {
        "account_number": provider.account_number,
        "total_fees_due_gyd": float(total_fees_due or 0.0),
        "total_credit_balance_gyd": float(credit_balance or 0.0),
        "service_charge_percentage": float(service_charge_pct),
        "service_charge_percent": float(service_charge_pct),
        "service_charge_rate": float(service_charge_pct) / 100,
    }


@router.get(
    "/providers/me/billing/cycles",
    response_model=schemas.ProviderBillingCyclesResponse,
)
def get_provider_billing_cycles(
    limit: int = Query(6, ge=1, le=24),
    include_future: bool = Query(False),
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_provider_billing_cycles(
        db, provider, limit=limit, include_future=include_future
    )


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

    if payload.lat is None or payload.long is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude and longitude are required.",
        )

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
# Provider "me" catalog (portfolio images)
# -------------------------------------------------------------------

@router.get(
    "/providers/me/catalog",
    response_model=List[schemas.ProviderCatalogImageOut],
)
def list_my_catalog_images(
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    return crud.list_catalog_images_for_provider(db, provider.id)


@router.post(
    "/providers/me/catalog",
    response_model=schemas.ProviderCatalogImageOut,
)
async def upload_my_catalog_image(
    file: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    # Validate MIME type
    if file.content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image type. Allowed: JPEG, PNG, WEBP.",
        )

    contents = await file.read()
    if len(contents) > MAX_AVATAR_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image file is too large. Maximum size is 5 MB.",
        )

    _validate_image_contents(contents)
    _scan_bytes_for_viruses(contents)

    # Write to temp file for Cloudinary
    try:
        with NamedTemporaryFile(delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to buffer uploaded file",
        )

    try:
        # You can tweak folder/name options here if you want
        upload_result = cloudinary.uploader.upload(tmp_path, folder="bookitgy/catalog")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload image",
        )
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    image_url = upload_result.get("secure_url") if isinstance(upload_result, dict) else str(upload_result)
    if not image_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image upload did not return a valid URL",
        )

    item = crud.add_catalog_image_for_provider(
        db,
        provider_id=provider.id,
        image_url=image_url,
        caption=caption,
    )
    return item


@router.delete("/providers/me/catalog/{image_id}")
def delete_my_catalog_image(
    image_id: int,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
):
    ok = crud.delete_catalog_image_for_provider(db, provider.id, image_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Catalog image not found")
    return {"status": "deleted"}


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
    "/providers/{provider_id}/catalog",
    response_model=List[schemas.ProviderCatalogImageOut],
)
def list_provider_catalog(provider_id: int, db: Session = Depends(get_db)):
    return crud.list_catalog_images_for_provider(db, provider_id)


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
def update_my_provider_profile(
    payload: schemas.ProviderUpdate,
    db: Session = Depends(get_db),
    provider: models.Provider = Depends(_require_current_provider),
    current_user: models.User = Depends(get_current_user_from_header),
):
    """
    Update provider profile fields (bio, location text, whatsapp, is_active, professions).

    Coordinate updates (lat/long) are handled exclusively by /providers/me/location.
    """
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
