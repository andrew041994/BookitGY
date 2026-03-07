from datetime import datetime, timedelta

from fastapi.testclient import TestClient


def _create_booking_graph(session, models):
    provider_user = models.User(username="provider_chat@example.com", is_provider=True)
    client_user = models.User(username="client_chat@example.com")
    outsider_user = models.User(username="outsider_chat@example.com")
    session.add_all([provider_user, client_user, outsider_user])
    session.commit()

    provider = models.Provider(user_id=provider_user.id, account_number="ACC-CHAT")
    session.add(provider)
    session.commit()
    session.refresh(provider)

    service = models.Service(
        provider_id=provider.id,
        name="Chat Service",
        price_gyd=1000,
        duration_minutes=60,
    )
    session.add(service)
    session.commit()
    session.refresh(service)

    booking = models.Booking(
        customer_id=client_user.id,
        service_id=service.id,
        start_time=datetime.utcnow() + timedelta(hours=4),
        end_time=datetime.utcnow() + timedelta(hours=5),
        status="confirmed",
    )
    session.add(booking)
    session.commit()
    session.refresh(booking)

    other_booking = models.Booking(
        customer_id=client_user.id,
        service_id=service.id,
        start_time=datetime.utcnow() + timedelta(days=1),
        end_time=datetime.utcnow() + timedelta(days=1, hours=1),
        status="confirmed",
    )
    session.add(other_booking)
    session.commit()
    session.refresh(other_booking)

    return provider_user, client_user, outsider_user, booking, other_booking


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


def _send(client, actor, booking_id, text=None, attachment=None):
    payload = {"booking_id": booking_id}
    if text is not None:
        payload["text"] = text
    if attachment is not None:
        payload["attachment"] = attachment
    return client.post("/bookings/messages", json=payload)


def test_booking_messaging_flow(db_session):
    session, models, _crud = db_session
    provider_user, client_user, outsider_user, booking, other_booking = _create_booking_graph(session, models)
    app, client, current = _build_client(session)

    # 1) client can send text-only
    current["user"] = client_user
    r = _send(client, client_user, booking.id, text=" Hello provider ")
    assert r.status_code == 200
    m1 = r.json()
    assert m1["text"] == "Hello provider"
    assert m1["sender_role"] == "client"

    # 2) provider can send text-only
    current["user"] = provider_user
    r = _send(client, provider_user, booking.id, text="Hi client")
    assert r.status_code == 200
    assert r.json()["sender_role"] == "provider"

    # 3) image-only
    current["user"] = client_user
    r = _send(
        client,
        client_user,
        booking.id,
        attachment={
            "attachment_type": "image",
            "file_url": "https://cdn.example.com/image.jpg",
            "mime_type": "image/jpeg",
            "width": 800,
            "height": 600,
        },
    )
    assert r.status_code == 200
    assert r.json()["attachment"]["file_url"] == "https://cdn.example.com/image.jpg"

    # 4) text + image
    current["user"] = provider_user
    r = _send(
        client,
        provider_user,
        booking.id,
        text="Looks great",
        attachment={
            "attachment_type": "image",
            "file_url": "https://cdn.example.com/another.png",
            "mime_type": "image/png",
        },
    )
    assert r.status_code == 200

    # 8 + 9) conversation auto-create and reuse
    conversations = session.query(models.Conversation).filter(models.Conversation.booking_id == booking.id).all()
    assert len(conversations) == 1
    assert session.query(models.Message).filter(models.Message.conversation_id == conversations[0].id).count() == 4

    # 10) list ordering oldest -> newest
    current["user"] = client_user
    r = client.get(f"/bookings/{booking.id}/messages")
    assert r.status_code == 200
    payload = r.json()
    ids = [m["id"] for m in payload["messages"]]
    assert ids == sorted(ids)

    # 12) one booking does not expose another booking's chat
    r_other = client.get(f"/bookings/{other_booking.id}/messages")
    assert r_other.status_code == 200
    assert r_other.json()["messages"] == []

    # mark read compatibility
    current["user"] = provider_user
    mark_resp = client.post("/bookings/messages/read", json={"booking_id": booking.id})
    assert mark_resp.status_code == 200
    assert mark_resp.json()["updated"] >= 1

    app.dependency_overrides.clear()


def test_booking_messaging_rejections(db_session):
    session, models, _crud = db_session
    provider_user, client_user, outsider_user, booking, _other_booking = _create_booking_graph(session, models)
    app, client, current = _build_client(session)

    # 5) reject empty message
    current["user"] = client_user
    r = _send(client, client_user, booking.id)
    assert r.status_code == 422

    # 6) reject non-participant access
    current["user"] = outsider_user
    r = _send(client, outsider_user, booking.id, text="intrude")
    assert r.status_code == 403
    assert r.json()["detail"] == "You are not allowed to access this conversation."

    # 11) reject non-image attachment
    current["user"] = client_user
    r = _send(
        client,
        client_user,
        booking.id,
        attachment={
            "attachment_type": "file",
            "file_url": "https://cdn.example.com/doc.pdf",
        },
    )
    assert r.status_code == 422

    r = _send(
        client,
        client_user,
        booking.id,
        attachment={
            "attachment_type": "image",
            "file_url": "https://cdn.example.com/doc.pdf",
            "mime_type": "application/pdf",
        },
    )
    assert r.status_code == 422

    # 7) reject sending on cancelled booking
    booking.status = "cancelled"
    session.commit()

    r = _send(client, client_user, booking.id, text="still there?")
    assert r.status_code == 400
    assert r.json()["detail"] == "Messaging is unavailable because this appointment has been cancelled."

    # 13) reject sending on completed booking
    booking.status = "completed"
    booking.canceled_at = None
    session.commit()

    r = _send(client, client_user, booking.id, text="after complete?")
    assert r.status_code == 400
    assert r.json()["detail"] == "Messaging is unavailable because this appointment is completed."

    app.dependency_overrides.clear()
