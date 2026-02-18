import hashlib
import logging
import os
from dataclasses import dataclass
from functools import lru_cache

logger = logging.getLogger(__name__)

JWT_SECRET_ENV_VAR_ALIASES = ("JWT_SECRET_KEY", "JWT_SECRET")
JWT_ALGORITHM = "HS256"


@dataclass(frozen=True)
class JWTConfig:
    secret_key: str
    secret_source_env: str
    algorithm: str
    access_token_expire_minutes: int


def _clean_env_secret(value: str) -> str:
    return value.strip()


def _resolve_jwt_secret_from_env() -> tuple[str, str]:
    provided: dict[str, str] = {}
    for env_name in JWT_SECRET_ENV_VAR_ALIASES:
        raw_value = os.getenv(env_name)
        if raw_value is None:
            continue
        cleaned = _clean_env_secret(raw_value)
        if cleaned:
            provided[env_name] = cleaned

    if not provided:
        aliases = ", ".join(JWT_SECRET_ENV_VAR_ALIASES)
        raise RuntimeError(
            f"JWT secret is missing. Set one of: {aliases}."
        )

    distinct_values = set(provided.values())
    if len(distinct_values) > 1:
        conflict_names = ", ".join(sorted(provided.keys()))
        raise RuntimeError(
            "Conflicting JWT secret environment variables detected: "
            f"{conflict_names}. Set them to the same value after trimming whitespace."
        )

    for env_name in JWT_SECRET_ENV_VAR_ALIASES:
        if env_name in provided:
            return provided[env_name], env_name

    raise RuntimeError("JWT secret resolution failed unexpectedly.")


def _resolve_access_token_expire_minutes() -> int:
    return int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "540")
    )


@lru_cache(maxsize=1)
def get_jwt_config() -> JWTConfig:
    secret, source_env = _resolve_jwt_secret_from_env()

    if len(secret) < 32:
        raise RuntimeError(
            "JWT secret is not set or is too weak. "
            "Set JWT_SECRET_KEY/JWT_SECRET to a strong value at least 32 characters long."
        )

    access_expire_minutes = _resolve_access_token_expire_minutes()
    fingerprint = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:8]
    logger.info(
        "JWT config initialized: env_var=%s algorithm=%s access_expire_minutes=%s "
        "secret_fingerprint=%s secret_length=%s",
        source_env,
        JWT_ALGORITHM,
        access_expire_minutes,
        fingerprint,
        len(secret),
    )
    return JWTConfig(
        secret_key=secret,
        secret_source_env=source_env,
        algorithm=JWT_ALGORITHM,
        access_token_expire_minutes=access_expire_minutes,
    )


def get_jwt_secret_key() -> str:
    return get_jwt_config().secret_key


def get_jwt_algorithm() -> str:
    return get_jwt_config().algorithm


def get_access_token_expire_minutes() -> int:
    return get_jwt_config().access_token_expire_minutes
