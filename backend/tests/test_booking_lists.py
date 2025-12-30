import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from app.utils.time import now_guyana, today_end_guyana, today_start_guyana


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

    return provider, provider_user, customer_user, service


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


@pytest.mark.usefixtures("db_session")
def test_provider_lists_handle_mixed_confirmed_status_casing(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    _allow_custom_statuses(models, "CONFIRMED", "confirmed ")

    now = now_guyana()
    today_start = now + timedelta(minutes=30)
    if today_start.date() != now.date():
        today_start = now.replace(second=0, microsecond=0) + timedelta(minutes=5)

    today_end = today_start + timedelta(hours=1)
    upcoming_start = today_start + timedelta(days=1)
    upcoming_end = upcoming_start + timedelta(hours=1)

    today_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=today_start,
        end_time=today_end,
        status="CONFIRMED",
    )

    upcoming_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=upcoming_start,
        end_time=upcoming_end,
        status="confirmed ",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)

    today_data = crud.list_todays_bookings_for_provider(session, provider.id)
    assert [item.id for item in today_data] == [today_booking.id]
    assert today_data[0].status == "confirmed"

    upcoming_data = crud.list_upcoming_bookings_for_provider(session, provider.id)
    assert [item.id for item in upcoming_data] == [upcoming_booking.id]
    assert upcoming_data[0].status == "confirmed"


@pytest.mark.usefixtures("db_session")
def test_provider_today_bookings_include_past_end_times(db_session, monkeypatch):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    fake_now = datetime(2024, 1, 2, 15, 0)
    monkeypatch.setattr(crud, "now_guyana", lambda: fake_now)
    monkeypatch.setattr("app.utils.time.now_guyana", lambda: fake_now)

    start_time = datetime(fake_now.year, fake_now.month, fake_now.day, 9, 0)
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

    data = crud.list_todays_bookings_for_provider(session, provider.id)
    assert data == []

    session.refresh(booking)
    assert booking.status == "completed"


@pytest.mark.usefixtures("db_session")
def test_provider_bookings_include_all_statuses(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    future_start = now + timedelta(hours=2)
    past_start = now - timedelta(days=1)
    cancelled_start = now - timedelta(hours=3)

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=future_start,
        end_time=future_start + timedelta(hours=1),
        status="confirmed",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start,
        end_time=past_start + timedelta(hours=1),
        status="completed",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=cancelled_start,
        end_time=cancelled_start + timedelta(hours=1),
        status="cancelled",
    )

    data = crud.list_bookings_for_provider(session, provider.id)
    statuses = {item["status"] for item in data}
    assert statuses == {"confirmed", "completed", "cancelled"}

    cancelled_rows = [item for item in data if item["status"] == "cancelled"]
    assert cancelled_rows


@pytest.mark.usefixtures("db_session")
def test_provider_billing_excludes_upcoming_and_cancelled(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    future_start = now + timedelta(hours=3)
    past_start = now - timedelta(hours=4)

    in_month_billable = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start,
        end_time=past_start + timedelta(hours=1),
        status="confirmed",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=future_start,
        end_time=future_start + timedelta(hours=1),
        status="confirmed",
    )

    cancelled_past = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start - timedelta(hours=2),
        end_time=past_start - timedelta(hours=1),
        status="cancelled",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)

    data = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    returned_ids = {item["id"] for item in data}
    assert in_month_billable.id in returned_ids
    assert cancelled_past.id not in returned_ids
    assert all(item["status"] != "cancelled" for item in data)
    assert all(item["end_time"] <= now for item in data)

    in_month_billable.status = "cancelled"
    session.commit()

    data = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)
    returned_ids = {item["id"] for item in data}
    assert in_month_billable.id not in returned_ids


@pytest.mark.usefixtures("db_session")
def test_provider_billing_endpoint_only_returns_completed(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = now_guyana()

    completed_start = now - timedelta(hours=2)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=completed_start,
        end_time=completed_start + timedelta(hours=1),
        status="completed",
    )

    cancelled_start = now - timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=cancelled_start,
        end_time=cancelled_start + timedelta(minutes=30),
        status="cancelled",
    )

    upcoming_start = now + timedelta(hours=1)
    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=upcoming_start,
        end_time=upcoming_start + timedelta(hours=1),
        status="confirmed",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)

    data = crud.get_billable_bookings_for_provider(session, provider.id, as_of=now)

    assert len(data) == 1
    assert data[0]["status"] == "completed"
    returned_end = data[0]["end_time"]
    assert returned_end <= now


@pytest.mark.usefixtures("db_session")
def test_customer_bookings_include_cancelled_and_upcoming(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    future_start = now + timedelta(hours=3)
    cancelled_start = now - timedelta(hours=1)
    completed_start = now - timedelta(days=1)

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=future_start,
        end_time=future_start + timedelta(hours=1),
        status="confirmed",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=completed_start,
        end_time=completed_start + timedelta(hours=1),
        status="completed",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=cancelled_start,
        end_time=cancelled_start + timedelta(hours=1),
        status="cancelled",
    )

    data = crud.list_bookings_for_customer(session, customer.id)
    statuses = {item.status for item in data}
    assert statuses == {"confirmed", "cancelled", "completed"}

    cancelled_rows = [item for item in data if item.status == "cancelled"]
    assert cancelled_rows
