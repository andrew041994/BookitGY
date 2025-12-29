from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool
from sqlalchemy.engine import make_url

from app.config import get_settings

settings = get_settings()

# Central database URL configuration
DATABASE_URL = settings.DATABASE_URL

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    if ":memory:" in DATABASE_URL:
        engine_kwargs["poolclass"] = StaticPool

engine = create_engine(DATABASE_URL, **engine_kwargs)

url = make_url(DATABASE_URL)
is_postgres = url.get_backend_name() == "postgresql"

_tables_initialized = False


def _ensure_tables_initialized():
    global _tables_initialized

    if _tables_initialized:
        return

    if url.get_backend_name().startswith("sqlite"):
        Base.metadata.create_all(bind=engine)

    _tables_initialized = True

if is_postgres:
    def _set_guyana_timezone(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET TIME ZONE 'America/Guyana'")
        finally:
            cursor.close()

    event.listen(engine, "connect", _set_guyana_timezone)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Yield a database session and ensure it is closed afterwards."""
    _ensure_tables_initialized()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# import os
# from sqlalchemy import create_engine
# from sqlalchemy.orm import sessionmaker, declarative_base

# # Use SQLite by default
# DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")

# engine_kwargs = {}
# if DATABASE_URL.startswith("sqlite"):
#     engine_kwargs["connect_args"] = {"check_same_thread": False}

# engine = create_engine(DATABASE_URL, **engine_kwargs)
# SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# Base = declarative_base()


# def get_db():
#     db = SessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()
