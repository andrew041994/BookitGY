from datetime import date


def _create_provider(session, models, *, account_number, email):
    user = models.User(
        username=email,
        email=email,
        hashed_password="hashed",
        is_provider=True,
    )
    session.add(user)
    session.flush()
    provider = models.Provider(user_id=user.id, account_number=account_number)
    session.add(provider)
    session.commit()
    return user, provider


def test_mark_billing_cycle_paid_sends_email_once(db_session):
    session, models, crud = db_session
    user, provider = _create_provider(
        session, models, account_number="ACC-1001", email="provider@example.com"
    )
    cycle_month = date(2024, 1, 1)
    sent = []

    def fake_send(to_email, *, account_number, cycle_month):
        sent.append((to_email, account_number, cycle_month))

    billing_cycle = crud.mark_billing_cycle_paid(
        session,
        account_number=provider.account_number,
        cycle_month=cycle_month,
        provider_user=user,
        send_email=fake_send,
    )

    assert billing_cycle.is_paid is True
    assert billing_cycle.paid_at is not None
    assert len(sent) == 1

    billing_cycle_again = crud.mark_billing_cycle_paid(
        session,
        account_number=provider.account_number,
        cycle_month=cycle_month,
        provider_user=user,
        send_email=fake_send,
    )

    assert billing_cycle_again.is_paid is True
    assert len(sent) == 1


def test_mark_billing_cycle_paid_does_not_email_when_already_paid(db_session):
    session, models, crud = db_session
    user, provider = _create_provider(
        session, models, account_number="ACC-2001", email="provider2@example.com"
    )
    cycle_month = date(2024, 2, 1)
    billing_cycle = models.BillingCycle(
        account_number=provider.account_number,
        cycle_month=cycle_month,
        is_paid=True,
        paid_at=None,
    )
    session.add(billing_cycle)
    session.commit()

    sent = []

    def fake_send(to_email, *, account_number, cycle_month):
        sent.append((to_email, account_number, cycle_month))

    billing_cycle_again = crud.mark_billing_cycle_paid(
        session,
        account_number=provider.account_number,
        cycle_month=cycle_month,
        provider_user=user,
        send_email=fake_send,
    )

    assert billing_cycle_again.is_paid is True
    assert sent == []


def test_auto_suspend_unpaid_providers_after_cutoff(db_session):
    session, models, crud = db_session
    user_paid, provider_paid = _create_provider(
        session, models, account_number="ACC-3001", email="paid@example.com"
    )
    user_unpaid, provider_unpaid = _create_provider(
        session, models, account_number="ACC-3002", email="unpaid@example.com"
    )
    cycle_month = date(2024, 3, 1)

    session.add_all(
        [
            models.BillingCycle(
                account_number=provider_paid.account_number,
                cycle_month=cycle_month,
                is_paid=True,
                paid_at=None,
            ),
            models.BillingCycle(
                account_number=provider_unpaid.account_number,
                cycle_month=cycle_month,
                is_paid=False,
                paid_at=None,
            ),
        ]
    )
    session.commit()

    updated = crud.auto_suspend_unpaid_providers(session, date(2024, 3, 15))
    session.refresh(user_paid)
    session.refresh(user_unpaid)

    assert updated == 1
    assert user_paid.is_suspended is False
    assert user_unpaid.is_suspended is True


def test_ensure_billing_cycles_for_new_month(db_session):
    session, models, crud = db_session
    _create_provider(session, models, account_number="ACC-4001", email="one@example.com")
    _create_provider(session, models, account_number="ACC-4002", email="two@example.com")

    previous_month = date(2024, 4, 1)
    session.add(
        models.BillingCycle(
            account_number="ACC-4001",
            cycle_month=previous_month,
            is_paid=True,
            paid_at=None,
        )
    )
    session.commit()

    new_month = date(2024, 5, 1)
    crud.ensure_billing_cycles_for_month(session, new_month)

    rows = (
        session.query(models.BillingCycle)
        .filter(models.BillingCycle.cycle_month == new_month)
        .order_by(models.BillingCycle.account_number)
        .all()
    )

    assert [row.account_number for row in rows] == ["ACC-4001", "ACC-4002"]
    assert all(row.is_paid is False for row in rows)


def test_provider_billing_cycles_hide_future_by_default(db_session, monkeypatch):
    session, models, crud = db_session
    _user, provider = _create_provider(
        session, models, account_number="ACC-5001", email="future@example.com"
    )
    current_month = date(2024, 1, 1)
    future_month = date(2024, 2, 1)

    session.add_all(
        [
            models.BillingCycle(
                account_number=provider.account_number,
                cycle_month=current_month,
                is_paid=False,
                paid_at=None,
            ),
            models.BillingCycle(
                account_number=provider.account_number,
                cycle_month=future_month,
                is_paid=False,
                paid_at=None,
            ),
        ]
    )
    session.commit()

    monkeypatch.setattr(
        crud, "current_billing_cycle_month", lambda reference=None: current_month
    )

    response = crud.list_provider_billing_cycles(session, provider, limit=6)
    cycle_months = [cycle["cycle_month"] for cycle in response["cycles"]]
    assert future_month not in cycle_months
    assert current_month in cycle_months

    response_with_future = crud.list_provider_billing_cycles(
        session, provider, limit=6, include_future=True
    )
    cycle_months_with_future = [
        cycle["cycle_month"] for cycle in response_with_future["cycles"]
    ]
    assert future_month in cycle_months_with_future
