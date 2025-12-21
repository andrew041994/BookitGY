import re


PASSWORD_REQUIREMENTS_MESSAGE = (
    "Password must be 6–8 characters and include uppercase, lowercase, "
    "number, and special character."
)


def validate_password(password: str) -> None:
    if not 6 <= len(password) <= 8:
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[A-Z]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[a-z]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[0-9]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[^A-Za-z0-9]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
