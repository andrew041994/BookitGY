import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient


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


@pytest.mark.usefixtures("db_session")
def test_provider_bookings_include_all_statuses(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
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
        resp = client.get("/providers/me/bookings")
        assert resp.status_code == 200
        data = resp.json()
        statuses = {item["status"] for item in data}
        assert statuses == {"confirmed", "completed", "cancelled"}

        cancelled_rows = [item for item in data if item["status"] == "cancelled"]
        assert cancelled_rows
    finally:
        app.dependency_overrides = {}


@pytest.mark.usefixtures("db_session")
def test_provider_billing_excludes_upcoming_and_cancelled(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
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
        returned_ids = {item["id"] for item in data}
        assert in_month_billable.id in returned_ids
        assert cancelled_past.id not in returned_ids
        assert all(item["status"] != "cancelled" for item in data)
        assert all(datetime.fromisoformat(item["end_time"]) <= now for item in data)
    finally:
        app.dependency_overrides = {}


@pytest.mark.usefixtures("db_session")
def test_customer_bookings_include_cancelled_and_upcoming(db_session):
    session, models, crud = db_session
    provider, provider_user, customer, service = _create_provider_graph(session, models)

    now = datetime.utcnow()
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

    from app import database
    from app.main import app
    from app.database import get_db
    from app.security import get_current_user_from_header

    database.Base.metadata.create_all(bind=database.engine)

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_from_header] = lambda: customer

    client = TestClient(app)

    try:
        resp = client.get("/bookings/me")
        assert resp.status_code == 200
        data = resp.json()
        statuses = {item["status"] for item in data}
        assert statuses == {"confirmed", "cancelled", "completed"}

        cancelled_rows = [item for item in data if item["status"] == "cancelled"]
        assert cancelled_rows
    finally:
        app.dependency_overrides = {}
