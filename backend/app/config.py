import os
from functools import lru_cache
from typing import List
from dotenv import load_dotenv, find_dotenv
from pathlib import Path

# Load backend/.env explicitly (if present) so local credentials are picked up
# when running from any working directory. Fall back to the nearest .env for
# compatibility with existing setups.
BACKEND_DOTENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(BACKEND_DOTENV, override=False)
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
        # Password reset
        # -----------------------------
        # Used to build the reset link that gets emailed/logged.
        password_reset_url = os.getenv("PASSWORD_RESET_URL")
        if self.ENV == "prod" and not password_reset_url:
            raise RuntimeError(
                "PASSWORD_RESET_URL is not set. "
                "Set it to the production reset password page URL."
            )
        self.PASSWORD_RESET_URL: str = (
            password_reset_url or "http://localhost:5173/reset-password"
        )

        self.PASSWORD_RESET_EXPIRES_MINUTES: int = int(
            os.getenv("PASSWORD_RESET_EXPIRES_MINUTES", "60")
        )

        # -----------------------------
        # Email verification
        # -----------------------------
        # Used to build the verification link that gets emailed/logged.
        email_verification_url = os.getenv("EMAIL_VERIFICATION_URL")
        if self.ENV == "prod" and not email_verification_url:
            raise RuntimeError(
                "EMAIL_VERIFICATION_URL is not set. "
                "Set it to the production backend verify endpoint."
            )
        self.EMAIL_VERIFICATION_URL: str = (
            email_verification_url or "http://localhost:8000/auth/verify"
        )

        frontend_login_url = os.getenv("FRONTEND_LOGIN_URL")
        if self.ENV == "prod" and not frontend_login_url:
            raise RuntimeError(
                "FRONTEND_LOGIN_URL is not set. "
                "Set it to the production login page URL."
            )
        self.FRONTEND_LOGIN_URL: str = (
            frontend_login_url or "http://localhost:5173/login"
        )

        self.EMAIL_TOKEN_EXPIRES_MINUTES: int = int(
            os.getenv("EMAIL_TOKEN_EXPIRES_MINUTES", "2880")
        )
        email_token_secret = os.getenv("EMAIL_TOKEN_SECRET")
        if not email_token_secret:
            if self.ENV == "prod":
                raise RuntimeError(
                    "EMAIL_TOKEN_SECRET is not set. "
                    "Set it to a strong, unique value."
                )
            email_token_secret = self.JWT_SECRET_KEY
        self.EMAIL_TOKEN_SECRET: str = email_token_secret

        # -----------------------------
        # SendGrid email
        # -----------------------------
        self.SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")
        self.SENDGRID_FROM_EMAIL: str = os.getenv("SENDGRID_FROM_EMAIL", "")
        if self.ENV == "prod":
            missing = []
            if not self.SENDGRID_API_KEY:
                missing.append("SENDGRID_API_KEY")
            if not self.SENDGRID_FROM_EMAIL:
                missing.append("SENDGRID_FROM_EMAIL")
            if missing:
                raise RuntimeError(
                    "Missing required email settings: "
                    + ", ".join(missing)
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
