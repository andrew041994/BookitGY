from fastapi.testclient import TestClient
import pytest


def _build_client(session, current_user):
    from app.main import app
    from app.database import get_db
    from app.security import get_current_user_from_header

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_from_header] = lambda: current_user
    return app, TestClient(app)


def test_update_username_via_users_me_persists_and_reflects(db_session):
    session, models, crud = db_session

    user = models.User(
        username="andrew0",
        email="andrew0@example.com",
        hashed_password=crud.hash_password("Secret123!"),
        is_email_verified=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    app, client = _build_client(session, user)
    try:
        update_resp = client.put("/users/me", json={"username": "  Andrew04  "})
        assert update_resp.status_code == 200
        assert update_resp.json()["username"] == "andrew04"

        me_resp = client.get("/users/me")
        assert me_resp.status_code == 200
        assert me_resp.json()["username"] == "andrew04"
    finally:
        app.dependency_overrides = {}


def test_username_taken_and_invalid_validation(db_session):
    session, models, crud = db_session

    user_a = models.User(
        username="andrew04",
        email="andrew0@example.com",
        hashed_password=crud.hash_password("Secret123!"),
        is_email_verified=True,
    )
    user_b = models.User(
        username="otheruser",
        email="other@example.com",
        hashed_password=crud.hash_password("Secret123!"),
        is_email_verified=True,
    )
    session.add_all([user_a, user_b])
    session.commit()
    session.refresh(user_a)

    with pytest.raises(ValueError, match="Username already taken"):
        crud.set_username(session, user_a, "otheruser")

    with pytest.raises(ValueError, match="Username may only contain letters, numbers, underscores, and dots"):
        crud.set_username(session, user_a, "bad name!")
