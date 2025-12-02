import os
from functools import lru_cache
from typing import List
from dotenv import load_dotenv, find_dotenv

# Load the nearest .env file (root .env or backend/.env)
load_dotenv(find_dotenv(), override=False)


class Settings:
    """Application configuration loaded from environment variables.

    This keeps environment-specific behavior (dev/test/prod) and security-
    sensitive values (JWT secret, DB URL, CORS) in one place.
    """

    def __init__(self) -> None:
        # -----------------------------
        # Environment: dev, test, prod
        # -----------------------------
        self.ENV: str = os.getenv("ENV", "dev").lower()

        # -----------------------------
        # Logging
        # -----------------------------
        self.LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

        # -----------------------------
        # Database – NO SQLite default
        # -----------------------------
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise RuntimeError(
                "DATABASE_URL is not set. "
                "Set it to your PostgreSQL URL, e.g. "
                "postgresql+psycopg2://postgres:postgres@localhost:8001/postgres"
            )
        self.DATABASE_URL: str = db_url

        # -----------------------------
        # 🔐 AUTH / JWT — STRONG SECRET REQUIRED
        # -----------------------------
        legacy_secret = os.getenv("JWT_SECRET")
        env_secret = os.getenv("JWT_SECRET_KEY") or legacy_secret

        # Require a strong JWT secret in ALL environments
        if not env_secret or len(env_secret) < 32:
            raise RuntimeError(
                "JWT secret is not set or is too weak. "
                "Set JWT_SECRET_KEY (or legacy JWT_SECRET) to a strong value "
                "at least 32 characters long."
            )

        self.JWT_SECRET_KEY: str = env_secret
        self.JWT_ALGORITHM: str = "HS256"
        self.ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")
        )

        # -----------------------------
        # 🌐 CORS — EXPLICIT ORIGINS ONLY
        # -----------------------------
        raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "")
        if not raw_origins:
            raise RuntimeError(
                "CORS_ALLOW_ORIGINS is not set. "
                "Set it to a comma-separated list of allowed origins."
            )

        parsed_origins = [
            origin.strip()
            for origin in raw_origins.split(",")
            if origin.strip()
        ]

        # Forbid wildcard CORS completely
        if any(o == "*" for o in parsed_origins):
            raise RuntimeError(
                "CORS_ALLOW_ORIGINS cannot contain '*'. "
                "Use explicit origins instead."
            )

        self.CORS_ALLOW_ORIGINS: List[str] = parsed_origins

        # -----------------------------
        # Demo data seeding – OFF by default
        # -----------------------------
        # Only used by _seed_demo_users in main.py, and that function also
        # checks ENV == "dev". So seeding only runs in isolated dev when
        # ENABLE_DEMO_SEED=true is explicitly set.
        self.ENABLE_DEMO_SEED: bool = (
            os.getenv("ENABLE_DEMO_SEED", "false").lower() == "true"
        )

        # -----------------------------
        # Cloudinary (for image uploads)
        # -----------------------------
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
