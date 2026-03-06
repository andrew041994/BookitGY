from datetime import datetime, timedelta
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image


def _create_booking_graph(session, models):
    provider_user = models.User(username="provider_msg_attach@example.com", is_provider=True)
    client_user = models.User(username="client_msg_attach@example.com")
    outsider_user = models.User(username="outsider_msg_attach@example.com")
    session.add_all([provider_user, client_user, outsider_user])
    session.commit()

    provider = models.Provider(user_id=provider_user.id, account_number="ACC-MSG-ATTACH")
    session.add(provider)
    session.commit()

    service = models.Service(
        provider_id=provider.id,
        name="Messaging Service",
        price_gyd=5000,
        duration_minutes=60,
    )
    session.add(service)
    session.commit()

    booking = models.Booking(
        customer_id=client_user.id,
        service_id=service.id,
        start_time=datetime.utcnow() + timedelta(hours=1),
        end_time=datetime.utcnow() + timedelta(hours=2),
        status="confirmed",
    )
    session.add(booking)
    session.commit()

    return provider_user, client_user, outsider_user, booking


def _build_client(session):
    from app.main import app
    from app.database import get_db
    from app.security import get_current_user_from_header

    current = {"user": None}

    def override_get_db():
        try:
            yield session
        finally:
            pass

    def override_user():
        return current["user"]

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_from_header] = override_user

    return app, TestClient(app), current


def _image_bytes(fmt="JPEG"):
    image = Image.new("RGB", (40, 30), color=(20, 150, 250))
    buf = BytesIO()
    image.save(buf, format=fmt)
    return buf.getvalue()


def test_upload_booking_message_attachment(db_session, monkeypatch):
    session, models, _crud = db_session
    provider_user, client_user, outsider_user, booking = _create_booking_graph(session, models)
    app, client, current = _build_client(session)

    def fake_upload(_path):
        return {"secure_url": "https://cdn.example.com/chat-upload.jpg"}

    monkeypatch.setattr("app.routes.bookings.upload_booking_message_image", fake_upload)

    current["user"] = client_user
    response = client.post(
        f"/bookings/messages/attachments?booking_id={booking.id}",
        files={"file": ("chat.jpg", _image_bytes("JPEG"), "image/jpeg")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["attachment_type"] == "image"
    assert payload["file_url"] == "https://cdn.example.com/chat-upload.jpg"
    assert payload["width"] == 40
    assert payload["height"] == 30

    current["user"] = outsider_user
    forbidden = client.post(
        f"/bookings/messages/attachments?booking_id={booking.id}",
        files={"file": ("chat.jpg", _image_bytes("JPEG"), "image/jpeg")},
    )
    assert forbidden.status_code == 403

    current["user"] = provider_user
    invalid = client.post(
        f"/bookings/messages/attachments?booking_id={booking.id}",
        files={"file": ("bad.pdf", b"not-an-image", "application/pdf")},
    )
    assert invalid.status_code == 400

    app.dependency_overrides.clear()
