import re


PASSWORD_REQUIREMENTS_MESSAGE = (
    "Password must be at least 5 characters and include 1 uppercase and "
    "1 lowercase letter."
)


def validate_password(password: str) -> None:
    if len(password) < 5:
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[A-Z]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)

    if not re.search(r"[a-z]", password):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
