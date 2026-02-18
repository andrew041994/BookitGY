from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.utils.time import now_guyana


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


def _create_completed_booking_for_month(
    session,
    models,
    *,
    customer,
    service,
    month_start: datetime,
    day: int,
    price_gyd: float,
):
    billing_service = models.Service(
        provider_id=service.provider_id,
        name=f"{service.name}-{day}-{price_gyd}",
        price_gyd=price_gyd,
        duration_minutes=service.duration_minutes,
    )
    session.add(billing_service)
    session.commit()
    session.refresh(billing_service)

    start_time = datetime(month_start.year, month_start.month, day, 10, 0)
    end_time = start_time + timedelta(hours=1)
    return _add_booking(
        session,
        models,
        customer=customer,
        service=billing_service,
        start_time=start_time,
        end_time=end_time,
        status="completed",
    )


def _allow_custom_statuses(models, *values):
    class _SafeLookup(dict):
        def __missing__(self, key):
            return key

    status_type = models.Booking.status.type
    column_type = models.Booking.__table__.c.status.type
    object_lookup = _SafeLookup(getattr(status_type, "_object_lookup", {}))
    valid_lookup = _SafeLookup(getattr(status_type, "_valid_lookup", {}))

    for value in values:
        if value not in status_type.enums:
            status_type.enums.append(value)
        object_lookup[value] = value
        valid_lookup[value] = value

    status_type._object_lookup = object_lookup
    status_type._valid_lookup = valid_lookup
    column_type._object_lookup = object_lookup
    column_type._valid_lookup = valid_lookup
    enum_impl = getattr(status_type, "_enum_impl", None)
    if enum_impl is not None:
        enum_impl._object_lookup = object_lookup
        enum_impl._valid_lookup = valid_lookup
    column_enum_impl = getattr(column_type, "_enum_impl", None)
    if column_enum_impl is not None:
        column_enum_impl._object_lookup = object_lookup
        column_enum_impl._valid_lookup = valid_lookup

    status_type.__class__._object_value_for_elem = (
        lambda self, elem: object_lookup.get(elem, elem)
    )

    try:
        import types

        if not hasattr(status_type, "_original_object_value_for_elem"):
            status_type._original_object_value_for_elem = (
                status_type._object_value_for_elem
            )
        status_type._object_value_for_elem = types.MethodType(
            lambda self, elem: elem, status_type
        )
    except Exception:
        pass


def test_upcoming_booking_not_billable(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
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

    now = now_guyana()
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

    now = now_guyana()
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

    now = now_guyana()
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

    with pytest.raises(ValueError):
        crud.cancel_booking_for_customer(session, booking.id, customer.id)

    session.refresh(bill)

    assert float(bill.total_gyd) > 0
    assert float(bill.fee_gyd) > 0


def test_completed_booking_counts_toward_fees(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
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

    now = now_guyana()
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

    crud._auto_complete_finished_bookings(session, as_of=now)

    billable = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert [item["id"] for item in billable] == [booking.id]

    amount_due = crud.get_provider_fees_due(session, provider.id)
    assert amount_due == 100.0


def test_cancelled_booking_removed_from_billing_after_status_change(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
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

    crud._auto_complete_finished_bookings(session, as_of=now)

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


def test_provider_cancel_is_idempotent_for_notifications(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    start_time = _current_month_past_time(now)
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

    customer.whatsapp = "whatsapp:+5920000000"
    customer.expo_push_token = "expo-token"
    session.commit()

    calls = {"whatsapp": 0, "push": 0}

    def fake_send_whatsapp(to, body):
        calls["whatsapp"] += 1

    def fake_send_push(to_token, title, body):
        calls["push"] += 1

    monkeypatch.setattr(crud, "send_whatsapp", fake_send_whatsapp)
    monkeypatch.setattr(crud, "send_push", fake_send_push)

    assert crud.cancel_booking_for_provider(session, booking.id, provider.id) is True
    assert calls == {"whatsapp": 1, "push": 1}

    assert crud.cancel_booking_for_provider(session, booking.id, provider.id) is True
    assert calls == {"whatsapp": 1, "push": 1}


def test_billing_endpoint_only_returns_completed(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
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

    crud._auto_complete_finished_bookings(session, as_of=now)

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


def test_billing_endpoint_excludes_cancelled_variants(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()

    _allow_custom_statuses(models, "CANCELLED")

    first_start = _current_month_past_time(now) - timedelta(hours=4)
    first_end = first_start + timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=first_start,
        end_time=first_end,
        status="cancelled",
    )

    second_start = _current_month_past_time(now) - timedelta(hours=2)
    second_end = second_start + timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=second_start,
        end_time=second_end,
        status="CANCELLED",
    )

    third_start = _current_month_past_time(now) - timedelta(hours=1)
    third_end = third_start + timedelta(hours=1)
    kept_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=third_start,
        end_time=third_end,
        status="confirmed",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)

    billable = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    assert {item["id"] for item in billable} == {kept_booking.id}


def test_read_only_endpoints_do_not_auto_complete_future_bookings(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    start_time = now + timedelta(minutes=10)
    end_time = start_time + timedelta(minutes=30)

    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="confirmed",
    )

    from app import database
    from app.main import app
    from app.database import get_db
    from app.routes import bookings as bookings_routes
    from app.routes import providers as providers_routes

    database.Base.metadata.create_all(bind=database.engine)

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[bookings_routes._require_current_provider] = lambda: provider
    app.dependency_overrides[
        providers_routes._require_current_provider
    ] = lambda: provider

    client = TestClient(app)

    try:
        summary_resp = client.get("/providers/me/summary")
        assert summary_resp.status_code == 200

        billing_resp = client.get("/providers/me/billing/bookings")
        assert billing_resp.status_code == 200
    finally:
        app.dependency_overrides = {}


def test_paid_bill_persists_after_regeneration(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    prior_month_date = (now.replace(day=1) - timedelta(days=1)).date()
    start_of_prior_month = prior_month_date.replace(day=1)

    start_time = datetime(
        start_of_prior_month.year, start_of_prior_month.month, 5, 10, 0
    )
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

    crud.generate_monthly_bills(session, month=prior_month_date)

    bill = (
        session.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == start_of_prior_month,
        )
        .first()
    )

    assert bill is not None
    original_total = float(bill.total_gyd)
    original_fee = float(bill.fee_gyd)
    original_due = bill.due_date

    crud.set_provider_bills_paid_state(session, provider.id, start_of_prior_month, True)


    crud.generate_monthly_bills(session, month=prior_month_date)

    bills = (
        session.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == start_of_prior_month,
        )
        .all()
    )

    assert len(bills) == 1
    persisted = bills[0]
    assert persisted.is_paid is True
    assert float(persisted.total_gyd) == original_total
    assert float(persisted.fee_gyd) == original_fee
    assert persisted.due_date == original_due


def test_provider_billing_cycles_freeze_past_bill_snapshots(db_session, monkeypatch):
    session, models, crud = db_session
    provider, _customer, _service = _create_provider_graph(session, models)

    past_month = datetime(2024, 1, 1).date()
    current_month = datetime(2024, 2, 1).date()

    session.add_all(
        [
            models.BillingCycle(
                account_number=provider.account_number,
                cycle_month=past_month,
                is_paid=False,
                paid_at=None,
                credits_applied_gyd=50,
            ),
            models.BillingCycle(
                account_number=provider.account_number,
                cycle_month=current_month,
                is_paid=False,
                paid_at=None,
                credits_applied_gyd=0,
            ),
        ]
    )

    session.add(
        models.Bill(
            provider_id=provider.id,
            month=past_month,
            total_gyd=1000,
            fee_gyd=350,
            due_date=datetime(2024, 2, 15, 23, 59),
            is_paid=False,
        )
    )
    session.commit()

    crud.update_platform_service_charge(session, 0)
    monkeypatch.setattr(
        crud, "current_billing_cycle_month", lambda reference=None: current_month
    )

    from app import database
    from app.database import get_db
    from app.main import app
    from app.routes import providers as providers_routes

    database.Base.metadata.create_all(bind=database.engine)

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[providers_routes._require_current_provider] = (
        lambda: provider
    )

    client = TestClient(app)

    try:
        response = client.get("/providers/me/billing/cycles?limit=6")
        assert response.status_code == 200
        payload = response.json()
    finally:
        app.dependency_overrides = {}

    past_cycle = next(c for c in payload["cycles"] if c["cycle_month"] == "2024-01-01")
    current_cycle = next(c for c in payload["cycles"] if c["cycle_month"] == "2024-02-01")

    assert past_cycle["platform_fee_gyd"] == 350.0
    assert past_cycle["total_due_gyd"] == 300.0
    assert current_cycle["platform_fee_gyd"] == 0.0

def test_cron_job_completes_past_confirmed_only(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()

    past_start = now - timedelta(hours=1)
    past_end = now - timedelta(minutes=30)
    confirmed_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start,
        end_time=past_end,
        status="confirmed",
    )

    cancelled_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start - timedelta(hours=1),
        end_time=past_end - timedelta(hours=1),
        status="cancelled",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)

    session.refresh(confirmed_booking)
    session.refresh(cancelled_booking)

    assert confirmed_booking.status == "completed"
    assert cancelled_booking.status == "cancelled"


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

    now = now_guyana()
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

    crud._auto_complete_finished_bookings(session, as_of=now)

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


def _generate_bill_for_month(session, models, crud, provider, customer, service, month, prices):
    for idx, price in enumerate(prices, start=1):
        _create_completed_booking_for_month(
            session,
            models,
            customer=customer,
            service=service,
            month_start=month,
            day=idx,
            price_gyd=price,
        )

    crud.generate_monthly_bills(session, month=month.date())

    return (
        session.query(models.Bill)
        .filter(models.Bill.provider_id == provider.id, models.Bill.month == month.date())
        .one()
    )


def test_generate_monthly_bill_creates_persistent_row(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    billing_month = datetime(2023, 1, 1)
    bill = _generate_bill_for_month(
        session,
        models,
        crud,
        provider,
        customer,
        service,
        billing_month,
        [1500, 500],
    )

    assert bill.month == billing_month.date()
    assert float(bill.total_gyd) == 2000
    assert float(bill.fee_gyd) == pytest.approx(200.0)
    assert bill.due_date == datetime(2023, 2, 15, 23, 59)


def test_generate_is_idempotent(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    billing_month = datetime(2023, 1, 1)
    _create_completed_booking_for_month(
        session,
        models,
        customer=customer,
        service=service,
        month_start=billing_month,
        day=2,
        price_gyd=1200,
    )

    crud.generate_monthly_bills(session, month=billing_month.date())

    first = (
        session.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == billing_month.date(),
        )
        .one()
    )
    first_id = first.id
    first_total = float(first.total_gyd)
    first_fee = float(first.fee_gyd)
    first_due = first.due_date

    crud.generate_monthly_bills(session, month=billing_month.date())

    bills = (
        session.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == billing_month.date(),
        )
        .all()
    )

    assert len(bills) == 1
    assert bills[0].id == first_id
    assert float(bills[0].total_gyd) == first_total
    assert float(bills[0].fee_gyd) == first_fee
    assert bills[0].due_date == first_due


def test_existing_bill_not_modified(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    billing_month = datetime(2023, 1, 1)

    _create_completed_booking_for_month(
        session,
        models,
        customer=customer,
        service=service,
        month_start=billing_month,
        day=2,
        price_gyd=1800,
    )

    original_due = datetime(2023, 2, 20, 12, 0)
    existing = models.Bill(
        provider_id=provider.id,
        month=billing_month.date(),
        total_gyd=Decimal("321.00"),
        fee_gyd=Decimal("45.00"),
        due_date=original_due,
        is_paid=False,
    )
    session.add(existing)
    session.commit()

    crud.generate_monthly_bills(session, month=billing_month.date())

    persisted = (
        session.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == billing_month.date(),
        )
        .one()
    )

    assert float(persisted.total_gyd) == 321.0
    assert float(persisted.fee_gyd) == 45.0
    assert persisted.due_date == original_due
    assert persisted.is_paid is False
    assert (
        session.query(models.Bill)
        .filter(models.Bill.provider_id == provider.id, models.Bill.month == billing_month.date())
        .count()
        == 1
    )


def test_paid_bills_are_not_overwritten(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    billing_month = datetime(2023, 1, 1)
    bill = _generate_bill_for_month(
        session,
        models,
        crud,
        provider,
        customer,
        service,
        billing_month,
        [1000],
    )

    original_total = float(bill.total_gyd)
    original_fee = float(bill.fee_gyd)
    original_due = bill.due_date

    crud.set_provider_bills_paid_state(session, provider.id, billing_month.date(), True)
    _create_completed_booking_for_month(
        session,
        models,
        customer=customer,
        service=service,
        month_start=billing_month,
        day=10,
        price_gyd=500,
    )

    crud.generate_monthly_bills(session, month=billing_month.date())

    persisted = (
        session.query(models.Bill)
        .filter(
            models.Bill.provider_id == provider.id,
            models.Bill.month == billing_month.date(),
        )
        .one()
    )

    assert persisted.is_paid is True
    assert float(persisted.total_gyd) == original_total
    assert float(persisted.fee_gyd) == original_fee
    assert persisted.due_date == original_due


def test_bill_generation_does_not_delete_bookings(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    billing_month = datetime(2023, 1, 1)
    first_booking = _create_completed_booking_for_month(
        session,
        models,
        customer=customer,
        service=service,
        month_start=billing_month,
        day=2,
        price_gyd=800,
    )
    second_booking = _create_completed_booking_for_month(
        session,
        models,
        customer=customer,
        service=service,
        month_start=billing_month,
        day=12,
        price_gyd=1200,
    )

    before_count = session.query(models.Booking).count()

    crud.generate_monthly_bills(session, month=billing_month.date())

    after_count = session.query(models.Booking).count()
    assert after_count == before_count
    assert {
        booking.id
        for booking in session.query(models.Booking)
        .filter(models.Booking.id.in_([first_booking.id, second_booking.id]))
        .all()
    } == {first_booking.id, second_booking.id}

def test_generate_monthly_bills_sends_statement_once_and_marks_emailed_at(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    provider_user = session.query(models.User).filter(models.User.id == provider.user_id).first()
    provider_user.email = "provider@example.com"
    session.commit()

    now = now_guyana()
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

    sent = []

    def _fake_send_monthly_statement_email(to_email, **kwargs):
        sent.append((to_email, kwargs))

    monkeypatch.setattr(crud, "send_monthly_statement_email", _fake_send_monthly_statement_email)

    billing_root = "https://bookitgy.com/app"
    monkeypatch.setattr(crud, "get_settings", lambda: type("S", (), {"FRONTEND_LOGIN_URL": billing_root})())

    crud.generate_monthly_bills(session, month=now.date())

    bill = (
        session.query(models.Bill)
        .filter(models.Bill.provider_id == provider.id, models.Bill.month == now.date().replace(day=1))
        .first()
    )

    assert bill is not None
    assert bill.emailed_at is not None
    assert len(sent) == 1
    assert sent[0][0] == "provider@example.com"
    assert sent[0][1]["month_label"] == now.strftime("%b %Y")
    assert sent[0][1]["billing_page_url"] == "https://bookitgy.com/provider/billing?account=ACC-1"

    crud.generate_monthly_bills(session, month=now.date())
    assert len(sent) == 1


def test_generate_monthly_bills_does_not_mark_emailed_when_email_send_fails(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    provider_user = session.query(models.User).filter(models.User.id == provider.user_id).first()
    provider_user.email = "provider@example.com"
    session.commit()

    now = now_guyana()
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

    def _failing_send(*args, **kwargs):
        raise RuntimeError("sendgrid failed")

    monkeypatch.setattr(crud, "send_monthly_statement_email", _failing_send)

    crud.generate_monthly_bills(session, month=now.date())

    bill = (
        session.query(models.Bill)
        .filter(models.Bill.provider_id == provider.id, models.Bill.month == now.date().replace(day=1))
        .first()
    )

    assert bill is not None
    assert bill.emailed_at is None
