from datetime import datetime, timedelta

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
        password="Password",
        is_provider=True,
        is_suspended=True,
    )
    crud.get_or_create_provider_for_user(session, provider_user.id)
    authenticated = crud.authenticate_user(
        session, provider_user.email, "Password"
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
        password="Password",
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
        password="Password",
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
        password="Password",
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
        password="Password",
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
        password="Password",
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
        password="Password",
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


def test_provider_confirm_auto_locked_when_current_cycle_unpaid_after_cutoff(db_session, monkeypatch):
    session, models, crud = db_session

    provider_user = _create_user(
        session,
        crud,
        email="provider5@example.com",
        username="provider_autolock",
        password="Password",
        is_provider=True,
        is_suspended=False,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)
    service = _create_service(session, models, provider.id)

    customer_user = _create_user(
        session,
        crud,
        email="customer5@example.com",
        username="customer5",
        password="Password",
    )

    fixed_now = datetime(2026, 2, 17, 8, 0, 0)
    monkeypatch.setattr("app.crud.now_guyana", lambda: fixed_now)

    booking = models.Booking(
        customer_id=customer_user.id,
        service_id=service.id,
        start_time=fixed_now - timedelta(hours=3),
        end_time=fixed_now - timedelta(hours=2),
        status="completed",
    )
    session.add(booking)

    current_cycle = crud.current_billing_cycle_month(fixed_now.date())
    session.add(
        models.BillingCycle(
            account_number=provider.account_number,
            cycle_month=current_cycle,
            is_paid=False,
        )
    )

    pending_booking = models.Booking(
        customer_id=customer_user.id,
        service_id=service.id,
        start_time=fixed_now + timedelta(hours=2),
        end_time=fixed_now + timedelta(hours=3),
        status="pending",
    )
    session.add(pending_booking)
    session.commit()
    session.refresh(provider)

    from app.routes.bookings import confirm_booking_as_provider

    with pytest.raises(HTTPException) as exc_info:
        confirm_booking_as_provider(
            booking_id=pending_booking.id,
            db=session,
            provider=provider,
        )

    session.refresh(provider)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == (
        "Provider account is locked and cannot accept or confirm new appointments."
    )
    assert provider.is_locked is True
