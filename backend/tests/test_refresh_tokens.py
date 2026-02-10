from datetime import timedelta

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
    return client, app


def _create_verified_user(session, models, crud, email="refresh@test.com", password="Secret123!"):
    user = models.User(
        username=email.split("@")[0],
        email=email,
        hashed_password=crud.hash_password(password),
        is_email_verified=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _login(client, email, password):
    resp = client.post("/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("refresh_token")
    assert body.get("access_token")
    return body


def test_refresh_rotates_and_old_token_cannot_be_reused(db_session):
    session, models, crud = db_session
    client, app = _build_client(session)

    try:
        user = _create_verified_user(session, models, crud)
        first = _login(client, user.email, "Secret123!")

        refresh_resp = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert refresh_resp.status_code == 200
        rotated = refresh_resp.json()
        assert rotated["refresh_token"] != first["refresh_token"]

        reused = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert reused.status_code == 401
        assert reused.json()["detail"]["code"] == "SESSION_EXPIRED"
    finally:
        app.dependency_overrides = {}


def test_sliding_expiration_uses_newly_rotated_token_timestamp(db_session):
    session, models, crud = db_session
    client, app = _build_client(session)

    try:
        user = _create_verified_user(session, models, crud, email="slide@test.com")
        first = _login(client, user.email, "Secret123!")

        first_refresh = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert first_refresh.status_code == 200
        second_token = first_refresh.json()["refresh_token"]

        # expire the original token far in the past, verify fresh rotated token still works
        from app.utils.tokens import hash_token

        first_record = session.query(models.RefreshToken).filter(
            models.RefreshToken.token_hash == hash_token(first["refresh_token"])
        ).first()
        from app.utils.time import now_guyana
        first_record.last_used_at = now_guyana() - timedelta(days=120)
        session.commit()

        second_refresh = client.post("/auth/refresh", json={"refresh_token": second_token})
        assert second_refresh.status_code == 200
    finally:
        app.dependency_overrides = {}


def test_inactivity_expiration_fails_after_90_days(db_session):
    session, models, crud = db_session
    client, app = _build_client(session)

    try:
        user = _create_verified_user(session, models, crud, email="inactive@test.com")
        first = _login(client, user.email, "Secret123!")

        from app.utils.time import now_guyana
        from app.utils.tokens import hash_token

        record = session.query(models.RefreshToken).filter(
            models.RefreshToken.token_hash == hash_token(first["refresh_token"])
        ).first()
        record.last_used_at = now_guyana() - timedelta(days=91)
        session.commit()

        expired = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert expired.status_code == 401
        assert expired.json()["detail"]["code"] == "SESSION_EXPIRED"
    finally:
        app.dependency_overrides = {}


def test_password_change_invalidates_refresh_tokens(db_session):
    session, models, crud = db_session
    client, app = _build_client(session)

    try:
        user = _create_verified_user(session, models, crud, email="pwchange@test.com")
        first = _login(client, user.email, "Secret123!")

        from app.utils.time import now_guyana
        from app.utils.tokens import create_password_reset_token, hash_token

        raw_reset_token = create_password_reset_token()
        token_hash = hash_token(raw_reset_token)
        crud.create_password_reset_token(
            session,
            user.id,
            token_hash,
            now_guyana() + timedelta(minutes=15),
        )

        reset_resp = client.post(
            "/auth/reset-password",
            json={"token": raw_reset_token, "new_password": "NewSecret123!"},
        )
        assert reset_resp.status_code == 200

        post_change = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert post_change.status_code == 401
        assert post_change.json()["detail"]["code"] == "SESSION_EXPIRED"
    finally:
        app.dependency_overrides = {}


def test_logout_revokes_refresh_token(db_session):
    session, models, crud = db_session
    client, app = _build_client(session)

    try:
        user = _create_verified_user(session, models, crud, email="logout@test.com")
        first = _login(client, user.email, "Secret123!")

        logout_resp = client.post("/auth/logout", json={"refresh_token": first["refresh_token"]})
        assert logout_resp.status_code == 200

        post_logout = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert post_logout.status_code == 401
        assert post_logout.json()["detail"]["code"] == "SESSION_EXPIRED"
    finally:
        app.dependency_overrides = {}
