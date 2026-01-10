from datetime import timedelta

import pytest
from fastapi import HTTPException
from app import schemas
from app.utils.time import now_guyana


def _create_user(session, crud, *, email, username, password, is_provider=False, is_suspended=False):
    user = crud.create_user(
        session,
        schemas.UserCreate(
            username=username,
            email=email,
            password=password,
            phone="000000",
            location="Georgetown",
        ),
    )
    user.is_email_verified = True
    user.is_provider = is_provider
    user.is_suspended = is_suspended
    session.commit()
    session.refresh(user)
    return user


def _create_service(session, models, provider_id):
    service = models.Service(
        provider_id=provider_id,
        name="Test Service",
        description="Basic service",
        price_gyd=1000,
        duration_minutes=60,
    )
    session.add(service)
    session.commit()
    session.refresh(service)
    return service


def test_suspended_provider_can_log_in(db_session):
    session, models, crud = db_session
    provider_user = _create_user(
        session,
        crud,
        email="provider@example.com",
        username="provider_login",
        password="password123",
        is_provider=True,
        is_suspended=True,
    )
    crud.get_or_create_provider_for_user(session, provider_user.id)
    authenticated = crud.authenticate_user(
        session, provider_user.email, "password123"
    )

    assert authenticated is not None
    assert authenticated.id == provider_user.id


def test_booking_creation_blocked_when_provider_suspended(db_session):
    session, models, crud = db_session
    provider_user = _create_user(
        session,
        crud,
        email="provider2@example.com",
        username="provider_blocked",
        password="password123",
        is_provider=True,
        is_suspended=True,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)
    service = _create_service(session, models, provider.id)

    customer_user = _create_user(
        session,
        crud,
        email="customer@example.com",
        username="customer",
        password="password123",
    )
    from app.routes.bookings import create_booking_for_me

    booking_payload = schemas.BookingCreate(
        service_id=service.id,
        start_time=now_guyana() + timedelta(hours=1),
    )

    with pytest.raises(HTTPException) as exc_info:
        create_booking_for_me(
            booking_in=booking_payload,
            db=session,
            current_user=customer_user,
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == (
        "Provider account is suspended and cannot accept bookings."
    )


def test_provider_confirm_blocked_when_suspended(db_session):
    session, models, crud = db_session
    provider_user = _create_user(
        session,
        crud,
        email="provider3@example.com",
        username="provider_confirm",
        password="password123",
        is_provider=True,
        is_suspended=True,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)
    service = _create_service(session, models, provider.id)

    customer_user = _create_user(
        session,
        crud,
        email="customer2@example.com",
        username="customer2",
        password="password123",
    )

    start_time = now_guyana() + timedelta(hours=2)
    booking = models.Booking(
        customer_id=customer_user.id,
        service_id=service.id,
        start_time=start_time,
        end_time=start_time + timedelta(hours=1),
        status="pending",
    )
    session.add(booking)
    session.commit()
    session.refresh(booking)

    from app.routes.bookings import confirm_booking_as_provider

    with pytest.raises(HTTPException) as exc_info:
        confirm_booking_as_provider(
            booking_id=booking.id,
            db=session,
            provider=provider,
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == (
        "Provider account is suspended and cannot accept bookings."
    )


def test_booking_creation_allows_unsuspended_provider(db_session):
    session, models, crud = db_session
    provider_user = _create_user(
        session,
        crud,
        email="provider4@example.com",
        username="provider_unsuspended",
        password="password123",
        is_provider=True,
        is_suspended=True,
    )
    provider_user.is_suspended = False
    session.commit()
    session.refresh(provider_user)

    provider = crud.get_or_create_provider_for_user(session, provider_user.id)
    service = _create_service(session, models, provider.id)

    customer_user = _create_user(
        session,
        crud,
        email="customer3@example.com",
        username="customer3",
        password="password123",
    )
    from app.routes.bookings import create_booking_for_me

    booking_payload = schemas.BookingCreate(
        service_id=service.id,
        start_time=now_guyana() + timedelta(hours=3),
    )

    booking = create_booking_for_me(
        booking_in=booking_payload,
        db=session,
        current_user=customer_user,
    )

    assert booking is not None
