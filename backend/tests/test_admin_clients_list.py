def _create_user(db, models, *, username: str, whatsapp: str, email: str, is_provider: bool):
    user = models.User(
        username=username,
        email=email,
        hashed_password='x',
        is_provider=is_provider,
        whatsapp=whatsapp,
    )
    db.add(user)
    db.flush()
    return user


def test_list_clients_excludes_providers_orders_desc_and_searches(db_session):
    db, models, _ = db_session

    admin_user = models.User(
        username='admin',
        email='admin@example.com',
        hashed_password='x',
        is_admin=True,
    )
    db.add(admin_user)
    db.flush()

    client_a = _create_user(
        db,
        models,
        username='AlphaClient',
        whatsapp='592-1111',
        email='alpha-client@example.com',
        is_provider=False,
    )
    client_b = _create_user(
        db,
        models,
        username='BravoClient',
        whatsapp='592-2222',
        email='bravo-client@example.com',
        is_provider=False,
    )
    _create_user(
        db,
        models,
        username='CharlieProvider',
        whatsapp='592-3333',
        email='charlie-provider@example.com',
        is_provider=True,
    )

    db.commit()

    from app.routes import admin as admin_routes

    rows = admin_routes.list_clients(
        search=None,
        limit=50,
        offset=0,
        db=db,
        _=admin_user,
    )

    assert [row['id'] for row in rows] == [client_b.id, client_a.id]

    by_username = admin_routes.list_clients(
        search='brav',
        limit=50,
        offset=0,
        db=db,
        _=admin_user,
    )
    assert [row['id'] for row in by_username] == [client_b.id]

    by_whatsapp = admin_routes.list_clients(
        search='1111',
        limit=50,
        offset=0,
        db=db,
        _=admin_user,
    )
    assert [row['id'] for row in by_whatsapp] == [client_a.id]
