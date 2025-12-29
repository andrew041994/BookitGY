from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient


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

    billable = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
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

    billable = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert billable == []


def test_cancelled_booking_not_auto_completed(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    start_time = _current_month_past_time(now) - timedelta(hours=1)
    end_time = start_time + timedelta(hours=1)

    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="cancelled",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)
    session.refresh(booking)

    assert booking.status == "cancelled"


def test_cancelling_booking_updates_monthly_bill(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    start_time = _current_month_past_time(now)
    end_time = start_time + timedelta(hours=1)

    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="completed",
    )

    crud.generate_monthly_bills(session, month=now.date())

    bill = (
        session.query(models.Bill)
        .filter(models.Bill.provider_id == provider.id)
        .first()
    )

    assert bill is not None
    assert float(bill.total_gyd) > 0

    crud.cancel_booking_for_customer(session, booking.id, customer.id)

    session.refresh(bill)

    assert float(bill.total_gyd) == 0
    assert float(bill.fee_gyd) == 0


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

    billable = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert len(billable) == 1
    assert billable[0]["status"] == "completed"

    amount_due = crud.get_provider_fees_due(session, provider.id)
    assert amount_due == 100.0  # 10% of the 1000 GYD service price


def test_completion_time_controls_billing_window(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    past_start = now - timedelta(days=31)
    end_time = _current_month_past_time(now)

    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start,
        end_time=end_time,
        status="confirmed",
    )

    billable = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert [item["id"] for item in billable] == [booking.id]

    amount_due = crud.get_provider_fees_due(session, provider.id)
    assert amount_due == 100.0


def test_cancelled_booking_removed_from_billing_after_status_change(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    start_time = _current_month_past_time(now) - timedelta(hours=3)
    end_time = start_time + timedelta(hours=1)

    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="confirmed",
    )

    billable_before = crud.get_billable_bookings_for_provider(
        session, provider.id, as_of=now
    )
    assert [item["id"] for item in billable_before] == [booking.id]
    assert crud.get_provider_fees_due(session, provider.id) == 100.0

    booking.status = "cancelled"
    session.commit()

    billable_after = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert billable_after == []
    assert crud.get_provider_fees_due(session, provider.id) == 0.0


def test_billing_endpoint_only_returns_completed(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    past_start = _current_month_past_time(now)
    past_end = past_start + timedelta(hours=1)

    completed_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start,
        end_time=past_end,
        status="confirmed",
    )

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
    cancelled = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=cancel_start,
        end_time=cancel_end,
        status="confirmed",
    )
    crud.cancel_booking_for_provider(session, cancelled.id, provider.id)

    from app import database
    from app.main import app
    from app.database import get_db
    from app.routes import bookings as bookings_routes

    database.Base.metadata.create_all(bind=database.engine)

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[bookings_routes._require_current_provider] = lambda: provider

    client = TestClient(app)

    try:
        resp = client.get("/providers/me/billing/bookings")
        assert resp.status_code == 200
        data = resp.json()
        assert [item["id"] for item in data] == [completed_booking.id]
        assert data[0]["status"] == "completed"
    finally:
        app.dependency_overrides = {}


def _month_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = datetime(now.year, now.month, 1)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1)
    else:
        end = datetime(now.year, now.month + 1, 1)
    return start, end


def test_billing_filters_to_completed_items_in_period(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
    period_start, period_end = _month_bounds(now)

    # A) Upcoming appointment should not appear
    future_start = now + timedelta(hours=2)
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

    # B) Cancelled appointment should never appear
    cancelled_start = _current_month_past_time(now) - timedelta(hours=2)
    cancelled_end = cancelled_start + timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=cancelled_start,
        end_time=cancelled_end,
        status="cancelled",
    )

    # C) Completed appointment should appear
    completed_start = _current_month_past_time(now) - timedelta(hours=4)
    completed_end = completed_start + timedelta(hours=1)
    completed_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=completed_start,
        end_time=completed_end,
        status="confirmed",
    )

    billable = crud.get_billable_bookings_for_provider(
        session,
        provider.id,
        period_start=period_start,
        period_end=period_end,
        as_of=now,
    )

    assert [item["id"] for item in billable] == [completed_booking.id]

    # Totals should also reflect only the completed item (10% of 1000 GYD)
    amount_due = crud.get_provider_fees_due(session, provider.id)
    assert amount_due == 100.0
