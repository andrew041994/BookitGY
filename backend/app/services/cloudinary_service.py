import cloudinary
import cloudinary.uploader
from typing import Optional

from app.config import get_settings

settings = get_settings()

# Configure Cloudinary once at import time
cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
    secure=True,
)


def upload_avatar(file_path: str, public_id: Optional[str] = None) -> str:
    """
    Upload an avatar image to Cloudinary and return the secure URL.
    file_path: path to the local file (or tempfile) on disk.
    public_id: optional stable ID (e.g. provider_{id}_avatar).
    """
    upload_options = {
        "folder": settings.CLOUDINARY_UPLOAD_FOLDER,
        "overwrite": True,
        "resource_type": "image",
    }
    if public_id:
        upload_options["public_id"] = public_id

    result = cloudinary.uploader.upload(file_path, **upload_options)
    return result["secure_url"]
