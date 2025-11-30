import os
from functools import lru_cache
from typing import List


class Settings:
    """Application configuration loaded from environment variables.

    This keeps environment-specific behavior (dev/test/prod) and security-
    sensitive values (JWT secret, DB URL, CORS) in one place.
    """

    def __init__(self) -> None:
        # Environment: dev, test, prod
        self.ENV: str = os.getenv("ENV", "dev").lower()

        # NEW logging level (this is all you add)
        self.LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
        
        # Database – 🔥 no more SQLite default
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise RuntimeError(
                "DATABASE_URL is not set. "
                "Set it to your PostgreSQL URL, e.g. "
                "postgresql+psycopg2://postgres:postgres@localhost:8001/postgres"
            )
        self.DATABASE_URL: str = db_url

        # Auth / JWT
        legacy_secret = os.getenv("JWT_SECRET")
        self.JWT_SECRET_KEY: str = (
            os.getenv("JWT_SECRET_KEY") or legacy_secret or "dev-secret"
        )
        self.JWT_ALGORITHM: str = "HS256"
        self.ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")
        )

        # CORS
        raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "")
        self.CORS_ALLOW_ORIGINS: List[str] = [
            origin.strip() for origin in raw_origins.split(",") if origin.strip()
        ]

        # Demo data seeding
        self.ENABLE_DEMO_SEED: bool = (
            os.getenv("ENABLE_DEMO_SEED", "true").lower() == "true"
        )

                # Cloudinary (for image uploads)
        self.CLOUDINARY_CLOUD_NAME: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")
        self.CLOUDINARY_API_KEY: str = os.getenv("CLOUDINARY_API_KEY", "")
        self.CLOUDINARY_API_SECRET: str = os.getenv("CLOUDINARY_API_SECRET", "")
        self.CLOUDINARY_UPLOAD_FOLDER: str = os.getenv(
            "CLOUDINARY_UPLOAD_FOLDER", "bookitgy/avatars"
        )



@lru_cache()
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
