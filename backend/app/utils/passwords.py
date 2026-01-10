import re


PASSWORD_REQUIREMENTS_MESSAGE = (
    "Password must be at least 6 characters and include uppercase, lowercase, "
    "number, and special character."
)


def validate_password(password: str) -> None:
    if len(password) < 6:
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[A-Z]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[a-z]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[0-9]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[^A-Za-z0-9]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
