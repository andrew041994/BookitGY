from app import schemas


def _create_user(
    session,
    crud,
    *,
    email,
    username,
    password,
    is_provider=False,
    is_admin=False,
    is_suspended=False,
):
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
    user.is_admin = is_admin
    user.is_suspended = is_suspended
    session.commit()
    session.refresh(user)
    return user


def test_suspend_active_provider_sends_email(db_session, monkeypatch):
    session, models, crud = db_session
    from app.routes import admin as admin_routes
    admin_user = _create_user(
        session,
        crud,
        email="admin@example.com",
        username="admin_user",
        password="Password",
        is_admin=True,
    )
    provider_user = _create_user(
        session,
        crud,
        email="provider@example.com",
        username="provider_user",
        password="Password",
        is_provider=True,
        is_suspended=False,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)

    sent = []

    def fake_send(to_email, *, account_number, provider_name, is_suspended):
        sent.append(
            {
                "to_email": to_email,
                "account_number": account_number,
                "provider_name": provider_name,
                "is_suspended": is_suspended,
            }
        )

    monkeypatch.setattr(admin_routes, "send_provider_suspension_email", fake_send)

    payload = schemas.ProviderSuspensionUpdate(
        account_number=provider.account_number,
        is_suspended=True,
    )
    result = admin_routes.update_provider_suspension(
        payload,
        db=session,
        _=admin_user,
    )

    assert result["is_suspended"] is True
    assert result["is_locked"] is False
    assert len(sent) == 1
    assert sent[0]["is_suspended"] is True


def test_suspend_already_suspended_sends_no_email(db_session, monkeypatch):
    session, models, crud = db_session
    from app.routes import admin as admin_routes
    admin_user = _create_user(
        session,
        crud,
        email="admin2@example.com",
        username="admin_user2",
        password="Password",
        is_admin=True,
    )
    provider_user = _create_user(
        session,
        crud,
        email="provider2@example.com",
        username="provider_user2",
        password="Password",
        is_provider=True,
        is_suspended=True,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)

    sent = []

    def fake_send(*args, **kwargs):
        sent.append(True)

    monkeypatch.setattr(admin_routes, "send_provider_suspension_email", fake_send)

    payload = schemas.ProviderSuspensionUpdate(
        account_number=provider.account_number,
        is_suspended=True,
    )
    result = admin_routes.update_provider_suspension(
        payload,
        db=session,
        _=admin_user,
    )

    assert result["is_suspended"] is True
    assert result["is_locked"] is False
    assert sent == []


def test_restore_suspended_provider_sends_email(db_session, monkeypatch):
    session, models, crud = db_session
    from app.routes import admin as admin_routes
    admin_user = _create_user(
        session,
        crud,
        email="admin3@example.com",
        username="admin_user3",
        password="Password",
        is_admin=True,
    )
    provider_user = _create_user(
        session,
        crud,
        email="provider3@example.com",
        username="provider_user3",
        password="Password",
        is_provider=True,
        is_suspended=True,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)

    sent = []

    def fake_send(to_email, *, account_number, provider_name, is_suspended):
        sent.append(
            {
                "to_email": to_email,
                "account_number": account_number,
                "provider_name": provider_name,
                "is_suspended": is_suspended,
            }
        )

    monkeypatch.setattr(admin_routes, "send_provider_suspension_email", fake_send)

    payload = schemas.ProviderSuspensionUpdate(
        account_number=provider.account_number,
        is_suspended=False,
    )
    result = admin_routes.update_provider_suspension(
        payload,
        db=session,
        _=admin_user,
    )

    assert result["is_suspended"] is False
    assert result["is_locked"] is False
    assert len(sent) == 1
    assert sent[0]["is_suspended"] is False


def test_restore_active_provider_sends_no_email(db_session, monkeypatch):
    session, models, crud = db_session
    from app.routes import admin as admin_routes
    admin_user = _create_user(
        session,
        crud,
        email="admin4@example.com",
        username="admin_user4",
        password="Password",
        is_admin=True,
    )
    provider_user = _create_user(
        session,
        crud,
        email="provider4@example.com",
        username="provider_user4",
        password="Password",
        is_provider=True,
        is_suspended=False,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)

    sent = []

    def fake_send(*args, **kwargs):
        sent.append(True)

    monkeypatch.setattr(admin_routes, "send_provider_suspension_email", fake_send)

    payload = schemas.ProviderSuspensionUpdate(
        account_number=provider.account_number,
        is_suspended=False,
    )
    result = admin_routes.update_provider_suspension(
        payload,
        db=session,
        _=admin_user,
    )

    assert result["is_suspended"] is False
    assert result["is_locked"] is False
    assert sent == []


def test_reactivate_locked_provider_clears_lock(db_session, monkeypatch):
    session, models, crud = db_session
    from app.routes import admin as admin_routes

    admin_user = _create_user(
        session,
        crud,
        email="admin5@example.com",
        username="admin_user5",
        password="Password",
        is_admin=True,
    )
    provider_user = _create_user(
        session,
        crud,
        email="provider5@example.com",
        username="provider_user5",
        password="Password",
        is_provider=True,
        is_suspended=False,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)
    provider.is_locked = True
    session.commit()
    session.refresh(provider)

    sent = []

    def fake_send(*args, **kwargs):
        sent.append(True)

    monkeypatch.setattr(admin_routes, "send_provider_suspension_email", fake_send)

    payload = schemas.ProviderSuspensionUpdate(
        account_number=provider.account_number,
        is_suspended=False,
    )
    result = admin_routes.update_provider_suspension(
        payload,
        db=session,
        _=admin_user,
    )

    session.refresh(provider)
    session.refresh(provider_user)

    assert result["is_suspended"] is False
    assert result["is_locked"] is False
    assert provider.is_locked is False
    assert provider_user.is_suspended is False
    assert sent == []


def test_manual_suspend_keeps_provider_lock_state(db_session, monkeypatch):
    session, models, crud = db_session
    from app.routes import admin as admin_routes

    admin_user = _create_user(
        session,
        crud,
        email="admin6@example.com",
        username="admin_user6",
        password="Password",
        is_admin=True,
    )
    provider_user = _create_user(
        session,
        crud,
        email="provider6@example.com",
        username="provider_user6",
        password="Password",
        is_provider=True,
        is_suspended=False,
    )
    provider = crud.get_or_create_provider_for_user(session, provider_user.id)
    provider.is_locked = False
    session.commit()

    sent = []

    def fake_send(*args, **kwargs):
        sent.append(True)

    monkeypatch.setattr(admin_routes, "send_provider_suspension_email", fake_send)

    payload = schemas.ProviderSuspensionUpdate(
        account_number=provider.account_number,
        is_suspended=True,
    )
    result = admin_routes.update_provider_suspension(
        payload,
        db=session,
        _=admin_user,
    )

    session.refresh(provider)
    session.refresh(provider_user)

    assert result["is_suspended"] is True
    assert result["is_locked"] is False
    assert provider_user.is_suspended is True
    assert provider.is_locked is False
    assert sent == [True]
