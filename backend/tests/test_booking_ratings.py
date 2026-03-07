from datetime import datetime, timedelta

from fastapi.testclient import TestClient


def _build_client(session):
    from app.main import app
    from app.database import get_db
    from app.security import get_current_user_from_header

    current = {"user": None}

    def override_get_db():
        yield session

    def override_user():
        return current["user"]

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_from_header] = override_user
    return app, TestClient(app), current


def _setup_booking(session, models, *, status="completed"):
    provider_user = models.User(username="provider_rate@example.com", is_provider=True)
    client_user = models.User(username="client_rate@example.com")
    stranger_user = models.User(username="stranger_rate@example.com")
    admin_user = models.User(username="admin_rate@example.com", is_admin=True)
    session.add_all([provider_user, client_user, stranger_user, admin_user])
    session.commit()

    provider = models.Provider(user_id=provider_user.id, account_number="ACC-RATE")
    session.add(provider)
    session.commit()

    service = models.Service(
        provider_id=provider.id,
        name="Rateable Service",
        description="desc",
        price_gyd=1200,
        duration_minutes=60,
    )
    session.add(service)
    session.commit()

    booking = models.Booking(
        customer_id=client_user.id,
        service_id=service.id,
        start_time=datetime.utcnow() - timedelta(hours=3),
        end_time=datetime.utcnow() - timedelta(hours=2),
        status=status,
    )
    session.add(booking)
    session.commit()
    session.refresh(booking)
    session.refresh(provider)

    return provider_user, client_user, stranger_user, admin_user, provider, booking


def test_create_booking_rating_and_aggregate_refresh(db_session):
    session, models, crud = db_session
    provider_user, client_user, _stranger, _admin, provider, booking = _setup_booking(session, models)
    app, client, current = _build_client(session)

    current["user"] = client_user
    resp = client.post(f"/bookings/{booking.id}/rating", json={"stars": 5})
    assert resp.status_code == 201
    payload = resp.json()
    assert payload["booking_id"] == booking.id
    assert payload["stars"] == 5

    session.refresh(provider)
    assert provider.rating_count == 1
    assert provider.avg_rating == 5.0

    # duplicate rating blocked
    dup = client.post(f"/bookings/{booking.id}/rating", json={"stars": 4})
    assert dup.status_code == 409

    # booking list for client exposes rating fields
    bookings_resp = client.get("/bookings/me")
    assert bookings_resp.status_code == 200
    row = next(x for x in bookings_resp.json() if x["id"] == booking.id)
    assert row["has_rating"] is True
    assert row["rating_stars"] == 5
    assert row["can_rate"] is False

    # provider list includes aggregate rating
    providers_resp = client.get("/providers")
    assert providers_resp.status_code == 200
    provider_row = next(x for x in providers_resp.json() if x["provider_id"] == provider.id)
    assert provider_row["rating_count"] == 1
    assert provider_row["avg_rating"] == 5.0

    app.dependency_overrides.clear()


def test_rating_creation_rules_and_authorized_get(db_session):
    session, models, _crud = db_session
    provider_user, client_user, stranger_user, admin_user, _provider, booking = _setup_booking(session, models)
    app, client, current = _build_client(session)

    # non-owner client forbidden
    current["user"] = stranger_user
    resp = client.post(f"/bookings/{booking.id}/rating", json={"stars": 4})
    assert resp.status_code == 403

    # owner can create
    current["user"] = client_user
    create_resp = client.post(f"/bookings/{booking.id}/rating", json={"stars": 4})
    assert create_resp.status_code == 201

    # provider tied to booking can read
    current["user"] = provider_user
    get_resp = client.get(f"/bookings/{booking.id}/rating")
    assert get_resp.status_code == 200
    assert get_resp.json()["stars"] == 4

    # admin can read
    current["user"] = admin_user
    admin_get = client.get(f"/bookings/{booking.id}/rating")
    assert admin_get.status_code == 200

    # unrelated user forbidden
    current["user"] = stranger_user
    denied_get = client.get(f"/bookings/{booking.id}/rating")
    assert denied_get.status_code == 403

    app.dependency_overrides.clear()


def test_rating_requires_completed_booking(db_session):
    session, models, _crud = db_session
    _provider_user, client_user, _stranger, _admin, _provider, booking = _setup_booking(session, models, status="confirmed")
    app, client, current = _build_client(session)

    current["user"] = client_user
    resp = client.post(f"/bookings/{booking.id}/rating", json={"stars": 3})
    assert resp.status_code == 400

    # pydantic request validation for stars range
    invalid_resp = client.post(f"/bookings/{booking.id}/rating", json={"stars": 6})
    assert invalid_resp.status_code == 422

    app.dependency_overrides.clear()
