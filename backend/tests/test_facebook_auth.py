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
    auth_routes.settings.FACEBOOK_APP_ID = "test-fb-app"
    auth_routes.settings.FACEBOOK_APP_SECRET = "test-fb-secret"
    client = TestClient(app)
    return client, app, auth_routes


class _MockResponse:
    def __init__(self, ok, data):
        self.ok = ok
        self._data = data

    def json(self):
        return self._data


def _mock_facebook_calls(monkeypatch, auth_routes, *, fb_user_id="fb-1", fb_email="fb@example.com", is_valid=True):
    def fake_get(url, params=None, timeout=10):
        if url.endswith("/debug_token"):
            return _MockResponse(
                True,
                {
                    "data": {
                        "is_valid": is_valid,
                        "app_id": "test-fb-app",
                        "user_id": fb_user_id,
                    }
                },
            )
        if url.endswith("/me"):
            payload = {"id": fb_user_id, "name": "FB User"}
            if fb_email is not None:
                payload["email"] = fb_email
            return _MockResponse(True, payload)
        return _MockResponse(False, {})

    monkeypatch.setattr(auth_routes.requests, "get", fake_get)


def _base_payload(**overrides):
    payload = {
        "facebook_access_token": "fb-user-token",
        "phone": "592 123 4567",
        "is_provider": False,
        "email": None,
    }
    payload.update(overrides)
    return payload


def test_facebook_new_signup_with_fb_email_succeeds(db_session, monkeypatch):
    session, models, _ = db_session
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-fb-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-fb-secret")

    client, app, auth_routes = _build_client(session)
    try:
        _mock_facebook_calls(monkeypatch, auth_routes, fb_user_id="fb-new-1", fb_email="newfb@example.com")

        resp = client.post("/auth/facebook/complete", json=_base_payload())
        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"]
        assert body["refresh_token"]
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "newfb@example.com"

        user = session.query(models.User).filter(models.User.email == "newfb@example.com").first()
        assert user is not None
        assert user.phone == "5921234567"

        identity = (
            session.query(models.OAuthIdentity)
            .filter(
                models.OAuthIdentity.provider == "facebook",
                models.OAuthIdentity.provider_user_id == "fb-new-1",
            )
            .first()
        )
        assert identity is not None
        assert identity.user_id == user.id
    finally:
        app.dependency_overrides = {}


def test_facebook_new_signup_without_fb_email_uses_request_email(db_session, monkeypatch):
    session, models, _ = db_session
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-fb-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-fb-secret")

    client, app, auth_routes = _build_client(session)
    try:
        _mock_facebook_calls(monkeypatch, auth_routes, fb_user_id="fb-new-2", fb_email=None)

        resp = client.post(
            "/auth/facebook/complete",
            json=_base_payload(phone="5929990000", email="fallback@example.com"),
        )
        assert resp.status_code == 200
        user = session.query(models.User).filter(models.User.email == "fallback@example.com").first()
        assert user is not None

        identity = (
            session.query(models.OAuthIdentity)
            .filter(models.OAuthIdentity.provider_user_id == "fb-new-2")
            .first()
        )
        assert identity is not None
        assert identity.email == "fallback@example.com"
    finally:
        app.dependency_overrides = {}


def test_facebook_missing_email_returns_email_required(db_session, monkeypatch):
    session, _, _ = db_session
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-fb-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-fb-secret")

    client, app, auth_routes = _build_client(session)
    try:
        _mock_facebook_calls(monkeypatch, auth_routes, fb_user_id="fb-new-3", fb_email=None)

        resp = client.post("/auth/facebook/complete", json=_base_payload(phone="5929990001", email=None))
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "EMAIL_REQUIRED"
    finally:
        app.dependency_overrides = {}


def test_facebook_existing_identity_logs_in(db_session, monkeypatch):
    session, models, crud = db_session
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-fb-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-fb-secret")

    existing_user = models.User(
        username="existingfb",
        email="existingfb@example.com",
        phone="5923334444",
        hashed_password=crud.hash_password("Secret123!"),
        is_email_verified=True,
    )
    session.add(existing_user)
    session.commit()
    session.refresh(existing_user)

    session.add(
        models.OAuthIdentity(
            user_id=existing_user.id,
            provider="facebook",
            provider_user_id="fb-existing-id",
            email="existingfb@example.com",
        )
    )
    session.commit()

    client, app, auth_routes = _build_client(session)
    try:
        _mock_facebook_calls(monkeypatch, auth_routes, fb_user_id="fb-existing-id", fb_email="existingfb@example.com")

        resp = client.post("/auth/facebook/complete", json=_base_payload(phone="5920000000"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["user"]["id"] == existing_user.id
        assert session.query(models.User).count() == 1
    finally:
        app.dependency_overrides = {}


def test_facebook_matching_email_links_existing_user(db_session, monkeypatch):
    session, models, crud = db_session
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-fb-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-fb-secret")

    existing_user = models.User(
        username="existingemail",
        email="matchme@example.com",
        phone="5921212121",
        hashed_password=crud.hash_password("Secret123!"),
        is_email_verified=True,
    )
    session.add(existing_user)
    session.commit()

    client, app, auth_routes = _build_client(session)
    try:
        _mock_facebook_calls(monkeypatch, auth_routes, fb_user_id="fb-link-1", fb_email="matchme@example.com")

        resp = client.post("/auth/facebook/complete", json=_base_payload(phone="5925656565"))
        assert resp.status_code == 200

        identity = (
            session.query(models.OAuthIdentity)
            .filter(models.OAuthIdentity.provider_user_id == "fb-link-1")
            .first()
        )
        assert identity is not None
        assert identity.user_id == existing_user.id
    finally:
        app.dependency_overrides = {}


def test_facebook_invalid_token_returns_fb_token_invalid(db_session, monkeypatch):
    session, _, _ = db_session
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-fb-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-fb-secret")

    client, app, auth_routes = _build_client(session)
    try:
        _mock_facebook_calls(monkeypatch, auth_routes, fb_user_id="fb-bad", fb_email="bad@example.com", is_valid=False)

        resp = client.post("/auth/facebook/complete", json=_base_payload(phone="5927878787"))
        assert resp.status_code in (400, 401)
        assert resp.json()["detail"]["code"] == "FB_TOKEN_INVALID"
    finally:
        app.dependency_overrides = {}
