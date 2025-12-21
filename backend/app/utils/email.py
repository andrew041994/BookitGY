from fastapi import HTTPException, status
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from app.config import get_settings

settings = get_settings()


def _ensure_email_configured() -> None:
    if not settings.SENDGRID_API_KEY or not settings.SENDGRID_FROM_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Email service is not configured. "
                "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."
            ),
        )


def _send_email(message: Mail, error_detail: str) -> None:
    try:
        client = SendGridAPIClient(settings.SENDGRID_API_KEY)
        response = client.send(message)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_detail,
        ) from exc

    if response.status_code < 200 or response.status_code >= 300:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_detail,
        )


def send_verification_email(to_email: str, verification_link: str) -> None:
    _ensure_email_configured()

    subject = "Verify your BookitGY email"
    content = (
        "Welcome to BookitGY!\n\n"
        "Please verify your email by clicking the link below:\n"
        f"{verification_link}\n\n"
        "If you did not create this account, you can ignore this email."
    )

    message = Mail(
        from_email=settings.SENDGRID_FROM_EMAIL,
        to_emails=to_email,
        subject=subject,
        plain_text_content=content,
    )

    _send_email(message, "Failed to send verification email.")


def send_password_reset_email(to_email: str, reset_link: str) -> None:
    _ensure_email_configured()

    subject = "Reset your BookitGY password"
    plain_text = (
        "We received a request to reset your BookitGY password.\n\n"
        "Reset your password using the link below:\n"
        f"{reset_link}\n\n"
        "If you did not request a password reset, you can ignore this email."
    )
    html_content = (
        "<p>We received a request to reset your BookitGY password.</p>"
        "<p>Reset your password using the link below:</p>"
        f"<p><a href=\"{reset_link}\">Reset your password</a></p>"
        "<p>If you did not request a password reset, you can ignore this email.</p>"
    )

    message = Mail(
        from_email=settings.SENDGRID_FROM_EMAIL,
        to_emails=to_email,
        subject=subject,
        plain_text_content=plain_text,
        html_content=html_content,
    )

    _send_email(message, "Failed to send password reset email.")
