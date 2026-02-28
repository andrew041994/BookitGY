def _create_user(db, models, username: str, whatsapp: str, email: str):
    user = models.User(
        username=username,
        email=email,
        hashed_password='x',
        is_provider=True,
        whatsapp=whatsapp,
    )
    db.add(user)
    db.flush()
    return user


def test_list_providers_orders_desc_and_filters_search(db_session):
    db, models, _ = db_session

    admin_user = models.User(
        username='admin',
        email='admin@example.com',
        hashed_password='x',
        is_admin=True,
    )
    db.add(admin_user)
    db.flush()

    user_a = _create_user(db, models, 'AlphaOne', '592-0001', 'alpha@example.com')
    provider_a = models.Provider(user_id=user_a.id, account_number='ACC-1')
    db.add(provider_a)
    db.flush()

    user_b = _create_user(db, models, 'BravoTwo', '592-9999', 'bravo@example.com')
    provider_b = models.Provider(user_id=user_b.id, account_number='ACC-2')
    db.add(provider_b)
    db.flush()

    user_c = _create_user(db, models, 'CharlieThree', '592-1234', 'charlie@example.com')
    provider_c = models.Provider(user_id=user_c.id, account_number='ACC-3')
    db.add(provider_c)
    db.flush()

    db.add(models.ProviderProfession(provider_id=provider_b.id, name='Plumber'))
    db.commit()

    from app.routes import admin as admin_routes

    rows = admin_routes.list_providers(
        search=None,
        limit=50,
        offset=0,
        db=db,
        _=admin_user,
    )

    assert [row['id'] for row in rows] == [provider_c.id, provider_b.id, provider_a.id]
    assert rows[1]['profession'] == 'Plumber'

    by_username = admin_routes.list_providers(
        search='bravo',
        limit=50,
        offset=0,
        db=db,
        _=admin_user,
    )
    assert [row['id'] for row in by_username] == [provider_b.id]

    by_whatsapp = admin_routes.list_providers(
        search='1234',
        limit=50,
        offset=0,
        db=db,
        _=admin_user,
    )
    assert [row['id'] for row in by_whatsapp] == [provider_c.id]
