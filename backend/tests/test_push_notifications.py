def _seed_user(session, models, idx: int):
    user = models.User(
        username=f"user{idx}",
        email=f"user{idx}@example.com",
        hashed_password="x",
        phone="12345",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_register_and_deactivate_push_token(db_session):
    session, models, _crud = db_session
    from app.services import push_notifications

    user = _seed_user(session, models, 1)

    row = push_notifications.upsert_push_token(
        session,
        user_id=user.id,
        expo_push_token="ExponentPushToken[abc123]",
        platform="ios",
        device_id="dev-1",
    )
    assert row.is_active is True

    updated = push_notifications.deactivate_push_token(
        session,
        user_id=user.id,
        device_id="dev-1",
    )
    assert updated == 1

    refreshed = session.query(models.PushToken).filter(models.PushToken.id == row.id).first()
    assert refreshed.is_active is False


def test_send_push_deactivates_invalid_tokens(db_session, monkeypatch):
    session, models, _crud = db_session
    from app.services import push_notifications

    user = _seed_user(session, models, 2)
    push_notifications.upsert_push_token(
        session,
        user_id=user.id,
        expo_push_token="ExponentPushToken[badtoken]",
        platform="android",
        device_id="dev-2",
    )

    class FakeResponse:
        content = b"1"

        def json(self):
            return {
                "data": {
                    "status": "error",
                    "details": {"error": "DeviceNotRegistered"},
                }
            }

    monkeypatch.setattr(
        "app.services.push_notifications.requests.post",
        lambda *args, **kwargs: FakeResponse(),
    )

    push_notifications.send_push_to_user(
        session,
        user_id=user.id,
        title="Hello",
        body="World",
        data={"type": "test"},
    )

    row = session.query(models.PushToken).filter(models.PushToken.user_id == user.id).first()
    assert row.is_active is False


def test_deactivate_push_token_requires_identifier(db_session):
    session, models, _crud = db_session
    from app.services import push_notifications

    user = _seed_user(session, models, 3)

    try:
        push_notifications.deactivate_push_token(session, user_id=user.id)
    except ValueError as exc:
        assert "required" in str(exc)
    else:
        assert False, "Expected ValueError when no identifier is provided"
