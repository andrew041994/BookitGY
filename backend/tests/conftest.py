import sys
import tempfile
from pathlib import Path

import pytest

repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root))


@pytest.fixture()
def db_session(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    test_db_path = Path(tmp.name)

    # Minimal settings for an isolated SQLite test database
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{test_db_path}")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://localhost")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)

    for module_name in [
        "app.config",
        "app.database",
        "app.models",
        "app.crud",
        "app.main",
        "app.routes.bookings",
        "app.workers.cron",
    ]:
        sys.modules.pop(module_name, None)

    import app.config as config

    config.get_settings.cache_clear()

    import app.database as database
    import app.models as models
    import app.crud as crud

    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)

    session = database.SessionLocal()
    try:
        yield session, models, crud
    finally:
        session.close()
        database.engine.dispose()
        if test_db_path.exists():
            test_db_path.unlink()
