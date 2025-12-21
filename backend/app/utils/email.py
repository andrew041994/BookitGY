from fastapi import HTTPException, status
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from app.config import get_settings

settings = get_settings()


def send_verification_email(to_email: str, verification_link: str) -> None:
    if not settings.SENDGRID_API_KEY or not settings.SENDGRID_FROM_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Email service is not configured. "
                "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."
            ),
        )

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

    try:
        client = SendGridAPIClient(settings.SENDGRID_API_KEY)
        response = client.send(message)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send verification email.",
        ) from exc

    if response.status_code < 200 or response.status_code >= 300:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send verification email.",
        )
