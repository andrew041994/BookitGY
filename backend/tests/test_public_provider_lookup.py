import pytest
from fastapi import HTTPException


def test_public_provider_lookup_by_username(db_session):
    from app.routes import providers as providers_routes

    session, models, _ = db_session

    user = models.User(username="demoprovider", is_provider=True)
    session.add(user)
    session.commit()
    session.refresh(user)

    provider = models.Provider(
        user_id=user.id,
        account_number="ACC-LOOKUP-1",
        avatar_url="https://example.com/avatar.png",
    )
    session.add(provider)
    session.commit()
    session.refresh(provider)

    payload = providers_routes.get_public_provider_by_username(
        "demoprovider", db=session
    )

    assert payload.provider_id == provider.id
    assert payload.username == user.username
    assert payload.display_name == user.username
    assert payload.avatar_url == provider.avatar_url
    assert payload.business_name is None


def test_public_provider_lookup_rejects_non_provider(db_session):
    from app.routes import providers as providers_routes

    session, models, _ = db_session

    user = models.User(username="notaprovider", is_provider=False)
    session.add(user)
    session.commit()

    with pytest.raises(HTTPException) as exc:
        providers_routes.get_public_provider_by_username("notaprovider", db=session)

    assert exc.value.status_code == 404
    assert exc.value.detail == "Provider not found"
