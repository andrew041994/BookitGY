from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session

from app.database import SessionLocal, _ensure_tables_initialized
from app import models
from app import crud
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


def run_billing_job(
    target_month: date | datetime | None = None,
    *,
    force_regen: bool = False,
    resend_email: bool = False,
):
    """
    Recalculate monthly bills for all providers based on completed bookings.

    This uses today's date to determine the current month and will:
    - Only count bookings that have already ended.
    - Update or create a Bill row for this month per provider.
    """
    _ensure_tables_initialized()
    db: Session = SessionLocal()
    try:
        today = now_guyana().date()
        generate_monthly_bills(
            db,
            month=today,
            target_month=target_month,
            force_regen=force_regen,
            resend_email=resend_email,
        )
    finally:
        db.close()


def auto_complete_finished_bookings_job():
    """Mark finished confirmed bookings as completed."""

    _ensure_tables_initialized()
    db: Session = SessionLocal()
    try:
        crud._auto_complete_finished_bookings(db)
    finally:
        db.close()


def ensure_monthly_billing_cycles_job():
    """Ensure billing cycle rows exist for the current month."""
    _ensure_tables_initialized()
    db: Session = SessionLocal()
    try:
        cycle_month = crud.current_billing_cycle_month()
        crud.ensure_billing_cycles_for_month(db, cycle_month)
    finally:
        db.close()


def auto_suspend_unpaid_providers_job():
    """Suspend providers who remain unpaid for the current cycle."""
    _ensure_tables_initialized()
    db: Session = SessionLocal()
    try:
        reference_date = now_guyana().date()
        crud.auto_suspend_unpaid_providers(db, reference_date)
    finally:
        db.close()


def registerCronJobs(scheduler):
    """
    Register all recurring scheduled tasks.
    """
    # 1-hour reminders: run every minute
    scheduler.add_job(send_upcoming_reminders, "interval", minutes=1)

    # Billing snapshot: update fees every 1 minutes
    scheduler.add_job(run_billing_job, "interval", minutes=1)

    # Auto-complete finished bookings: run frequently to keep statuses current
    scheduler.add_job(auto_complete_finished_bookings_job, "interval", minutes=1)

    # Monthly billing cycle reset: ensure rows exist for the new month
    scheduler.add_job(ensure_monthly_billing_cycles_job, "cron", day=1, hour=0, minute=5)

    # Auto-suspend unpaid providers on the 15th
    scheduler.add_job(auto_suspend_unpaid_providers_job, "cron", day=15, hour=0, minute=5)
