from datetime import datetime, timedelta
import threading

from sqlalchemy.orm import Query, Session as OrmSession

from app.utils.time import now_guyana


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


def test_confirmed_booking_auto_completes_after_end_time(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    start_time = now - timedelta(hours=2)
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
    session.refresh(booking)

    assert booking.status == "completed"


def test_cancelled_booking_never_auto_completes(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    start_time = now - timedelta(hours=2)
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


def test_future_booking_remains_confirmed(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    start_time = now + timedelta(hours=2)
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
    session.refresh(booking)

    assert booking.status == "confirmed"


def test_read_paths_do_not_auto_complete(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    fake_now = datetime(2024, 1, 1, 12, 0)
    monkeypatch.setattr(crud, "now_guyana", lambda: fake_now)
    monkeypatch.setattr("app.utils.time.now_guyana", lambda: fake_now)

    start_time = fake_now - timedelta(hours=2)
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

    # Billing/read helpers should never mutate booking status.
    assert (
        crud.get_billable_bookings_for_provider(session, provider.id, as_of=fake_now)
        == []
    )
    amount_due = crud.get_provider_current_month_due_from_completed_bookings(
        session, provider.id
    )

    session.refresh(booking)

    assert amount_due == 0
    assert booking.status == "confirmed"


def test_billing_only_counts_completed(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    past_start = now - timedelta(hours=3)
    past_end = past_start + timedelta(hours=1)
    future_start = now + timedelta(hours=2)
    future_end = future_start + timedelta(hours=1)

    completed_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start,
        end_time=past_end,
        status="completed",
    )

    past_confirmed_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start - timedelta(hours=2),
        end_time=past_end - timedelta(hours=2),
        status="confirmed",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=past_start - timedelta(hours=4),
        end_time=past_end - timedelta(hours=4),
        status="cancelled",
    )

    _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=future_start,
        end_time=future_end,
        status="confirmed",
    )

    crud._auto_complete_finished_bookings(session, as_of=now)

    billable = crud.get_billable_bookings_for_provider(
        session, provider.id, as_of=now
    )

    session.refresh(completed_booking)
    session.refresh(past_confirmed_booking)

    # The confirmed past booking should auto-complete; only completed entries count.
    assert {b["id"] for b in billable} == {
        completed_booking.id,
        past_confirmed_booking.id,
    }
    assert completed_booking.status == "completed"
    assert past_confirmed_booking.status == "completed"


def test_cannot_cancel_completed_bookings(db_session):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    start_time = now + timedelta(hours=1)
    end_time = start_time + timedelta(hours=1)

    active_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time,
        end_time=end_time,
        status="confirmed",
    )

    cancelled_booking = crud.cancel_booking_for_customer(
        session, active_booking.id, customer.id
    )
    assert cancelled_booking.status == "cancelled"

    completed_booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=start_time + timedelta(hours=2),
        end_time=end_time + timedelta(hours=2),
        status="completed",
    )

    try:
        crud.cancel_booking_for_customer(session, completed_booking.id, customer.id)
    except ValueError:
        session.refresh(completed_booking)
        assert completed_booking.status == "completed"
    else:
        raise AssertionError("Cancelling a completed booking should fail")


def test_cancel_booking_for_customer_uses_row_lock(db_session, monkeypatch):
    session, models, crud = db_session
    _, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=now + timedelta(hours=1),
        end_time=now + timedelta(hours=2),
        status="confirmed",
    )

    called = {"value": False}
    original = Query.with_for_update

    def wrapped(self, *args, **kwargs):
        called["value"] = True
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Query, "with_for_update", wrapped)

    crud.cancel_booking_for_customer(session, booking.id, customer.id)

    assert called["value"] is True


def test_cancel_booking_for_provider_uses_row_lock(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    now = now_guyana()
    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=now + timedelta(hours=1),
        end_time=now + timedelta(hours=2),
        status="confirmed",
    )

    called = {"value": False}
    original = Query.with_for_update

    def wrapped(self, *args, **kwargs):
        called["value"] = True
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Query, "with_for_update", wrapped)

    crud.cancel_booking_for_provider(session, booking.id, provider.id)

    assert called["value"] is True


def test_concurrent_customer_cancel_sends_notifications_once(db_session, monkeypatch):
    session, models, crud = db_session
    provider, customer, service = _create_provider_graph(session, models)

    provider_user = (
        session.query(models.User)
        .filter(models.User.id == provider.user_id)
        .first()
    )
    provider_user.whatsapp = "whatsapp:+592000000"
    provider_user.expo_push_token = "expo-token"
    session.commit()

    now = now_guyana()
    booking = _add_booking(
        session,
        models,
        customer=customer,
        service=service,
        start_time=now + timedelta(hours=1),
        end_time=now + timedelta(hours=2),
        status="confirmed",
    )

    counts = {"whatsapp": 0, "push": 0}

    def fake_whatsapp(*args, **kwargs):
        counts["whatsapp"] += 1

    def fake_push(*args, **kwargs):
        counts["push"] += 1

    monkeypatch.setattr(crud, "send_whatsapp", fake_whatsapp)
    monkeypatch.setattr(crud, "send_push", fake_push)

    row_lock = threading.Lock()
    original_with_for_update = Query.with_for_update
    original_commit = OrmSession.commit

    def locked_with_for_update(self, *args, **kwargs):
        row_lock.acquire()
        self.session.info["test_row_lock"] = row_lock
        return original_with_for_update(self, *args, **kwargs)

    def locked_commit(self, *args, **kwargs):
        try:
            return original_commit(self, *args, **kwargs)
        finally:
            lock = self.info.pop("test_row_lock", None)
            if lock and lock.locked():
                lock.release()

    monkeypatch.setattr(Query, "with_for_update", locked_with_for_update)
    monkeypatch.setattr(OrmSession, "commit", locked_commit)

    import app.database as database

    second_session = database.SessionLocal()
    try:
        results = {}

        def cancel_in_session(target_session, key):
            results[key] = crud.cancel_booking_for_customer(
                target_session, booking.id, customer.id
            )

        thread_one = threading.Thread(
            target=cancel_in_session, args=(session, "first")
        )
        thread_two = threading.Thread(
            target=cancel_in_session, args=(second_session, "second")
        )

        thread_one.start()
        thread_two.start()
        thread_one.join()
        thread_two.join()

        assert results["first"].status == "cancelled"
        assert results["second"].status == "cancelled"
        assert counts == {"whatsapp": 1, "push": 1}
    finally:
        second_session.close()
