from fastapi.testclient import TestClient


def test_delete_user_account_anonymizes_and_hides_provider(db_session):
    session, models, crud = db_session

    user = models.User(
        username="providerone",
        email="providerone@example.com",
        phone="5921234",
        whatsapp="whatsapp:+5921234",
        hashed_password=crud.hash_password("Secret123!"),
        is_provider=True,
        is_email_verified=True,
        expo_push_token="expo-token",
        location="Georgetown",
        lat=6.8,
        long=-58.1,
        avatar_url="https://example.com/user.png",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    provider = models.Provider(
        user_id=user.id,
        account_number="ACC-DELETE-1",
        bio="Provider bio",
        avatar_url="https://example.com/provider.png",
    )
    session.add(provider)
    session.commit()
    session.refresh(provider)

    service = models.Service(
        provider_id=provider.id,
        name="Test Service",
        description="Desc",
        price_gyd=50.0,
        duration_minutes=30,
        is_active=True,
    )
    session.add(service)
    session.commit()
    session.refresh(service)

    crud.delete_user_account(session, user, "Secret123!")

    session.refresh(user)
    session.refresh(provider)
    session.refresh(service)

    assert user.is_deleted is True
    assert user.deleted_at is not None
    assert user.token_version == 1
    assert user.email.startswith("deleted_")
    assert user.username.startswith("deleted_user_")
    assert user.phone is None
    assert user.whatsapp is None
    assert user.expo_push_token is None
    assert user.location is None
    assert user.lat is None
    assert user.long is None
    assert user.avatar_url is None
    assert user.deleted_email_hash is not None
    assert user.deleted_phone_hash is not None

    assert provider.is_locked is True
    assert provider.bio is None
    assert provider.avatar_url is None
    assert service.is_active is False

    providers = crud.list_providers(session)
    assert providers == []


def test_deleted_user_cannot_login_or_use_old_token(db_session):
    session, models, crud = db_session

    user = models.User(
        username="deleted-login",
        email="deleted@login.test",
        hashed_password=crud.hash_password("Secret123!"),
        is_email_verified=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    from app.main import app
    from app.database import get_db

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    try:
        login_resp = client.post(
            "/auth/login",
            data={"username": user.email, "password": "Secret123!"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        me_resp = client.get("/users/me", headers=headers)
        assert me_resp.status_code == 200

        delete_resp = client.post(
            "/users/me/delete",
            json={"password": "Secret123!"},
            headers=headers,
        )
        assert delete_resp.status_code == 200

        session.refresh(user)
        assert user.token_version == 1

        login_after = client.post(
            "/auth/login",
            data={"username": "deleted@login.test", "password": "Secret123!"},
        )
        assert login_after.status_code == 401

        me_after = client.get("/users/me", headers=headers)
        assert me_after.status_code == 401
    finally:
        app.dependency_overrides = {}
