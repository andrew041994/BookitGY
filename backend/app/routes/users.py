from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
import traceback
from io import BytesIO
import os
from tempfile import NamedTemporaryFile

import cloudinary
from PIL import Image, UnidentifiedImageError

from app.database import get_db
from app import crud, schemas, models
from app.security import get_current_user_from_header
from app.config import get_settings
from app.services.cloudinary_service import upload_avatar


router = APIRouter(tags=["users"])

settings = get_settings()

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
    secure=True,
)

ALLOWED_AVATAR_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
ALLOWED_AVATAR_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
MAX_AVATAR_DIMENSION = 4096


def _validate_client_image(contents: bytes) -> None:
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


@router.get("/users/me")
def read_users_me(
    current_user: models.User = Depends(get_current_user_from_header),
):
    return current_user




@router.put("/users/me")
def update_users_me(
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    """
    Partially update the current user.
    Only fields that are actually sent by the client are changed.
    """
    try:
        updated_user = crud.update_user(db, current_user.id, user_update)
    except SQLAlchemyError as e:
        # This will show up in `docker compose logs backend`
        print("ERROR updating user in /users/me:", repr(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="Database error while updating user profile.",
        )

    if updated_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return updated_user

@router.post("/users/me/avatar")
async def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
):
    """
    Upload/update avatar for the *current user* (clients or providers).

    Stores the Cloudinary URL in users.avatar_url.
    """
    # Validate MIME type
    if file.content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid avatar file type. Allowed: JPEG, PNG, WEBP.",
        )

    contents = await file.read()
    if len(contents) > MAX_AVATAR_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar file is too large. Maximum size is 5 MB.",
        )

    _validate_client_image(contents)

    # Temporary file for Cloudinary
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

    secure_url = (
        upload_result.get("secure_url")
        if isinstance(upload_result, dict)
        else str(upload_result)
    )

    if not secure_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Avatar upload did not return a valid URL",
        )

    current_user.avatar_url = secure_url
    db.commit()
    db.refresh(current_user)

    return {"avatar_url": secure_url}


