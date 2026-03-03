from fastapi.testclient import TestClient


def _build_client(session):
    from app.main import app
    from app.database import get_db
    from app.routes import auth as auth_routes

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[auth_routes.get_db] = override_get_db
    client = TestClient(app)
    return client, app, auth_routes


def test_signup_login_still_works(db_session):
    session, _, _ = db_session
    client, app, _ = _build_client(session)

    try:
        signup = client.post(
            "/auth/signup",
            json={
                "email": "local@example.com",
                "username": "localuser",
                "phone": "592 333 2222",
                "password": "StrongPass123!",
                "is_provider": False,
            },
        )
        assert signup.status_code == 201

        verify = client.post("/auth/verify-email", json={"token": signup.json()["verification_link"].split("token=")[1]})
        assert verify.status_code == 200

        login = client.post(
            "/auth/login_by_email",
            json={"email": "local@example.com", "password": "StrongPass123!"},
        )
        assert login.status_code == 200
        body = login.json()
        assert body["access_token"]
        assert body["refresh_token"]
    finally:
        app.dependency_overrides = {}


def test_google_auth_creates_user_with_onboarding_flag(db_session, monkeypatch):
    session, models, _ = db_session
    client, app, auth_routes = _build_client(session)

    try:
        monkeypatch.setattr(
            auth_routes,
            "_verify_google_id_token",
            lambda _token: {
                "sub": "google-sub-1",
                "email": "google1@example.com",
                "email_verified": True,
                "name": "Google User",
            },
        )

        resp = client.post("/auth/google", json={"id_token": "dummy"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["needs_onboarding"] is True
        assert body["access_token"]

        user = session.query(models.User).filter(models.User.email == "google1@example.com").first()
        assert user is not None
        assert user.google_sub == "google-sub-1"
        assert user.phone is None
        assert user.auth_provider == "google"
        assert user.is_email_verified is True
    finally:
        app.dependency_overrides = {}


def test_complete_profile_sets_phone_provider_and_creates_provider(db_session, monkeypatch):
    session, models, _ = db_session
    client, app, auth_routes = _build_client(session)

    try:
        monkeypatch.setattr(
            auth_routes,
            "_verify_google_id_token",
            lambda _token: {
                "sub": "google-sub-2",
                "email": "google2@example.com",
                "email_verified": True,
                "name": "Provider User",
            },
        )

        auth_resp = client.post("/auth/google", json={"id_token": "dummy"})
        assert auth_resp.status_code == 200

        from app.security import get_current_user_from_header

        google_user = session.query(models.User).filter(models.User.email == "google2@example.com").first()
        app.dependency_overrides[get_current_user_from_header] = lambda: google_user

        complete = client.post(
            "/auth/complete-profile",
            json={"phone": "+592 777 8888", "is_provider": True},
        )
        assert complete.status_code == 200
        body = complete.json()
        assert body["needs_onboarding"] is False
        assert body["user"]["phone"] == "+5927778888"
        assert body["user"]["is_provider"] is True

        user = session.query(models.User).filter(models.User.email == "google2@example.com").first()
        assert user is not None
        provider = session.query(models.Provider).filter(models.Provider.user_id == user.id).first()
        assert provider is not None
        assert provider.account_number.startswith("ACC-")
    finally:
        app.dependency_overrides = {}
