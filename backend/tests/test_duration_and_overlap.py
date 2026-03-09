from datetime import datetime, timedelta

import pytest

from app import schemas
from app.utils.time import now_guyana
from app.utils.duration import (
    derive_booking_end,
    duration_parts_to_minutes,
    minutes_to_duration_parts,
)


def _create_provider_graph(session, models):
    provider_user = models.User(username="provider-2@example.com", is_provider=True)
    customer_user = models.User(username="customer-2@example.com")
    customer_user_2 = models.User(username="customer-3@example.com")
    session.add_all([provider_user, customer_user, customer_user_2])
    session.commit()

    provider = models.Provider(user_id=provider_user.id, account_number="ACC-2")
    session.add(provider)
    session.commit()
    session.refresh(provider)

    service = models.Service(
        provider_id=provider.id,
        name="Long Service",
        price_gyd=1000,
        duration_minutes=60,
    )
    session.add(service)
    session.commit()
    session.refresh(service)

    return provider, customer_user, customer_user_2, service


def test_duration_math_roundtrip():
    assert duration_parts_to_minutes(days=0, hours=3, minutes_part=0) == 180
    assert duration_parts_to_minutes(days=3, hours=0, minutes_part=0) == 4320
    assert duration_parts_to_minutes(days=1, hours=2, minutes_part=30) == 1590

    assert minutes_to_duration_parts(4320) == (3, 0, 0)
    assert minutes_to_duration_parts(75) == (0, 1, 15)


def test_end_time_derivation():
    start = datetime(2024, 1, 1, 10, 0)
    assert derive_booking_end(start, 90) == datetime(2024, 1, 1, 11, 30)


@pytest.mark.usefixtures("db_session")
def test_overlap_rules_include_cross_midnight_and_adjacent_allowed(db_session):
    session, models, crud = db_session
    provider, customer_1, customer_2, service = _create_provider_graph(session, models)

    base = now_guyana() + timedelta(days=10)
    first_start = base.replace(hour=23, minute=0, second=0, microsecond=0)

    first = crud.create_booking(
        session,
        customer_id=customer_1.id,
        booking=schemas.BookingCreate(
            service_id=service.id,
            start_time=first_start,
        ),
    )

    with pytest.raises(ValueError):
        crud.create_booking(
            session,
            customer_id=customer_2.id,
            booking=schemas.BookingCreate(
                service_id=service.id,
                start_time=first_start + timedelta(minutes=30),
            ),
        )

    service.duration_minutes = 60 * 24 * 3
    session.commit()

    long_booking = crud.create_booking(
        session,
        customer_id=customer_2.id,
        booking=schemas.BookingCreate(
            service_id=service.id,
            start_time=first_start + timedelta(days=30, hours=10),
        ),
    )

    with pytest.raises(ValueError):
        crud.create_booking(
            session,
            customer_id=customer_1.id,
            booking=schemas.BookingCreate(
                service_id=service.id,
                start_time=first_start + timedelta(days=31, hours=11),
            ),
        )

    short_service = models.Service(
        provider_id=provider.id,
        name="Short Service",
        price_gyd=1000,
        duration_minutes=60,
    )
    session.add(short_service)
    session.commit()
    session.refresh(short_service)

    adjacent = crud.create_booking(
        session,
        customer_id=customer_1.id,
        booking=schemas.BookingCreate(
            service_id=short_service.id,
            start_time=long_booking.end_time,
        ),
    )

    assert adjacent.start_time == long_booking.end_time


def test_time_bucket_boundaries(db_session):
    session, models, crud = db_session
    now = datetime(2025, 1, 1, 12, 0)
    assert crud.booking_time_bucket(now + timedelta(minutes=1), now + timedelta(hours=1), now=now) == "upcoming"
    assert crud.booking_time_bucket(now - timedelta(minutes=1), now + timedelta(minutes=1), now=now) == "in_progress"
    assert crud.booking_time_bucket(now - timedelta(hours=2), now - timedelta(hours=1), now=now) == "finished"


def test_multi_day_availability_allows_later_slots_on_same_day(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer_1, _, service = _create_provider_graph(session, models)

    long_service = service
    long_service.duration_minutes = 60 * 24 * 3

    short_service = models.Service(
        provider_id=provider.id,
        name="Short Service",
        price_gyd=500,
        duration_minutes=60,
    )
    ten_min_service = models.Service(
        provider_id=provider.id,
        name="10 Minute Service",
        price_gyd=200,
        duration_minutes=10,
    )
    fifteen_min_service = models.Service(
        provider_id=provider.id,
        name="15 Minute Service",
        price_gyd=200,
        duration_minutes=15,
    )
    forty_five_min_service = models.Service(
        provider_id=provider.id,
        name="45 Minute Service",
        price_gyd=200,
        duration_minutes=45,
    )
    session.add_all([short_service, ten_min_service, fifteen_min_service, forty_five_min_service])

    # Thursday 09:00-12:00 working window.
    session.add(
        models.ProviderWorkingHours(
            provider_id=provider.id,
            weekday=3,
            is_closed=False,
            start_time="09:00",
            end_time="12:00",
        )
    )
    session.commit()

    # Existing long booking: Monday 09:00 -> Thursday 09:00.
    session.add(
        models.Booking(
            customer_id=customer_1.id,
            service_id=long_service.id,
            start_time=datetime(2025, 1, 6, 9, 0),
            end_time=datetime(2025, 1, 9, 9, 0),
            status="confirmed",
        )
    )
    session.commit()

    monkeypatch.setattr(crud, "now_guyana", lambda: datetime(2025, 1, 6, 8, 0))

    long_availability = crud.get_provider_availability(
        session,
        provider_id=provider.id,
        service_id=long_service.id,
        days=4,
    )

    short_availability = crud.get_provider_availability(
        session,
        provider_id=provider.id,
        service_id=short_service.id,
        days=4,
    )

    assert len(long_availability) == 1
    long_slots = long_availability[0]["slots"]
    assert datetime(2025, 1, 9, 9, 0) in long_slots
    assert datetime(2025, 1, 9, 9, 5) in long_slots
    assert datetime(2025, 1, 9, 9, 10) in long_slots
    assert datetime(2025, 1, 9, 9, 30) in long_slots
    assert datetime(2025, 1, 9, 10, 0) in long_slots

    assert len(short_availability) == 1
    short_slots = short_availability[0]["slots"]
    assert datetime(2025, 1, 9, 9, 5) in short_slots

    for custom_service in (ten_min_service, fifteen_min_service, forty_five_min_service):
        custom_availability = crud.get_provider_availability(
            session,
            provider_id=provider.id,
            service_id=custom_service.id,
            days=4,
        )
        assert len(custom_availability) == 1
        custom_slots = custom_availability[0]["slots"]
        assert datetime(2025, 1, 9, 9, 5) in custom_slots
