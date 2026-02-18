import hashlib
import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

JWT_SECRET_ENV_VAR = "JWT_SECRET_KEY"
JWT_ALGORITHM = "HS256"


@lru_cache(maxsize=1)
def get_jwt_secret_key() -> str:
    secret = (os.getenv(JWT_SECRET_ENV_VAR) or "").strip()
    if not secret:
        raise RuntimeError(
            f"JWT secret is missing. Set {JWT_SECRET_ENV_VAR} to a non-empty value."
        )

    hash_prefix = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:8]
    logger.info(
        "JWT config initialized: env_var=%s secret_sha256_prefix=%s",
        JWT_SECRET_ENV_VAR,
        hash_prefix,
    )
    return secret


def get_jwt_algorithm() -> str:
    return JWT_ALGORITHM
