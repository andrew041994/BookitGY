import importlib
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest


@pytest.fixture()
def db_session(monkeypatch):
    # Minimal settings for an in-memory SQLite test database
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://localhost")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)

    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))

    for module_name in ["app.config", "app.database", "app.models", "app.crud"]:
        sys.modules.pop(module_name, None)

    import app.config as config

    config.get_settings.cache_clear()

    import app.database as database
    import app.models as models
    import app.crud as crud

    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)

    session = database.SessionLocal()
    try:
        yield session, models, crud
    finally:
        session.close()


def _current_month_past_time(now: datetime) -> datetime:
    """Return a timestamp in the current month that is guaranteed to be in the past."""

    start_time = now - timedelta(hours=1)
    if start_time.month != now.month:
        start_time = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        start_time = start_time + timedelta(minutes=1)
        if start_time > now:
            start_time = now - timedelta(minutes=5)
    return start_time


def _create_provider_graph(session, models):
    provider_user = models.User(username="provider@example.com", is_provider=True)
    customer_user = models.User(username="customer@example.com")
    session.add_all([provider_user, customer_user])
    session.commit()

    provider = models.Provider(user_id=provider_user.id, account_number="ACC-1")
    session.add(provider)
    session.commit()
    session.refresh(provider)

    service = models.Service(
        provider_id=provider.id,
        name="Test Service",
        price_gyd=1000,
        duration_minutes=60,
    )
    session.add(service)
    session.commit()
    session.refresh(service)

    return provider, customer_user, service


def _add_booking(session, models, *, customer, service, start_time, end_time, status):
    booking = models.Booking(
        customer_id=customer.id,
        service_id=service.id,
        start_time=start_time,
        end_time=end_time,
        status=status,
    )
    session.add(booking)
    session.commit()
    session.refresh(booking)
    return booking


def test_upcoming_booking_not_billable(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    start_time = now + timedelta(hours=2)
    end_time = start_time + timedelta(hours=1)

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="confirmed",
    )

    billable = crud.list_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert billable == []


def test_cancelled_booking_not_billable(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    start_time = _current_month_past_time(now)
    end_time = start_time + timedelta(hours=1)

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="cancelled",
    )

    billable = crud.list_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert billable == []


def test_completed_booking_counts_toward_fees(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    start_time = _current_month_past_time(now)
    end_time = start_time + timedelta(hours=1)

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="completed",
    )

    # Add noise bookings that shouldn't count
    future_start = now + timedelta(days=1)
    future_end = future_start + timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=future_start,
        end_time=future_end,
        status="confirmed",
    )

    cancel_start = _current_month_past_time(now) - timedelta(hours=2)
    cancel_end = cancel_start + timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=cancel_start,
        end_time=cancel_end,
        status="cancelled",
    )

    billable = crud.list_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert len(billable) == 1
    assert billable[0]["status"] == "completed"

    amount_due = crud.get_provider_fees_due(session, provider.id)
    assert amount_due == 100.0  # 10% of the 1000 GYD service price
