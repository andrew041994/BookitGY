from datetime import timedelta
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app import models
from app.crud import send_push, generate_monthly_bills
from app.utils.time import now_guyana


def send_upcoming_reminders():
    """
    Send push reminder to clients 1 hour before their appointment.
    Runs regularly via APScheduler.
    """
    db: Session = SessionLocal()

    now = now_guyana()
    reminder_window_start = now + timedelta(hours=1) - timedelta(minutes=1)
    reminder_window_end = now + timedelta(hours=1) + timedelta(minutes=1)

    rows = (
        db.query(models.Booking, models.Service, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.User, models.Booking.customer_id == models.User.id)
        .filter(
            models.Booking.status == "confirmed",
            models.Booking.start_time >= reminder_window_start,
            models.Booking.start_time <= reminder_window_end,
        )
        .all()
    )

    for booking, service, customer in rows:
        send_push(
            customer.expo_push_token,
            "Upcoming appointment",
            f"Your {service.name} at "
            f"{booking.start_time.strftime('%I:%M %p')} starts in 1 hour.",
        )

    db.close()


def run_billing_job():
    """
    Recalculate monthly bills for all providers based on completed bookings.

    This uses today's date to determine the current month and will:
    - Only count bookings that have already ended.
    - Update or create a Bill row for this month per provider.
    """
    db: Session = SessionLocal()
    try:
        today = now_guyana().date()
        generate_monthly_bills(db, today)
    finally:
        db.close()


def registerCronJobs(scheduler):
    """
    Register all recurring scheduled tasks.
    """
    # 1-hour reminders: run every minute
    scheduler.add_job(send_upcoming_reminders, "interval", minutes=1)

    # Billing snapshot: update fees every 10 minutes
    scheduler.add_job(run_billing_job, "interval", minutes=5)
