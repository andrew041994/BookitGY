import os

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler

from app.config import get_settings
from app.database import get_db, SessionLocal
from app import crud, schemas, models
from app.routes import auth as auth_routes
from app.routes import users as users_routes
from app.routes import providers as providers_routes
from app.routes import bookings as bookings_routes
from app.routes import profile as profile_routes
from app.routes import admin as admin_routes
from app.security import get_current_user_from_header
from app.workers.cron import registerCronJobs
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import crud, schemas
from app.config import get_settings

settings = get_settings()

app = FastAPI(title="Guyana Booker")
scheduler = BackgroundScheduler()





def _seed_demo_users() -> None:
    """
    Seed demo users in development environment only.

    Guarded by:
      - ENV == 'dev'
      - ENABLE_DEMO_SEED=true

    Requires DEMO_USER_PASSWORD to be set to a strong value; never logs
    credentials.
    """
    if not settings.ENABLE_DEMO_SEED or settings.ENV != "dev":
        return

    demo_password = os.getenv("DEMO_USER_PASSWORD")
    if not demo_password:
        print(
            "[DEMO SEED] Skipping demo seed; DEMO_USER_PASSWORD is not set. "
            "Set a strong password (>=12 chars) to enable seeding in dev."
        )
        return

    if len(demo_password) < 12:
        raise RuntimeError(
            "DEMO_USER_PASSWORD must be at least 12 characters long for demo seeding."
        )

    db: Session = SessionLocal()
    try:
        # CUSTOMER (non-provider)
        customer = crud.get_user_by_email(db, "customer@guyana.com")
        if not customer:
            customer = crud.create_user(
                db,
                schemas.UserCreate(
                    email="customer@guyana.com",
                    password=demo_password,
                    full_name="Demo Customer",
                ),
            )

        # PROVIDER
        provider_user = crud.get_user_by_email(db, "provider@guyana.com")
        if not provider_user:
            provider_user = crud.create_user(
                db,
                schemas.UserCreate(
                    email="provider@guyana.com",
                    password=demo_password,
                    full_name="Demo Provider",
                ),
            )

        # Ensure provider role is set server-side only
        if not getattr(provider_user, "is_provider", False):
            provider_user.is_provider = True
            db.commit()
            db.refresh(provider_user)

        crud.get_or_create_provider_for_user(db, provider_user.id)

        print(
            "[DEMO SEED] Created/verified demo users customer@guyana.com and "
                        "provider@guyana.com using the configured DEMO_USER_PASSWORD."        )
    finally:
        db.close()


# -------------------------------------------------------------------
# CORS
# -------------------------------------------------------------------
allow_origins = settings.CORS_ALLOW_ORIGINS or []
if not allow_origins:
    raise RuntimeError(
        "CORS_ALLOW_ORIGINS is empty. "
        "Set it in your environment to a comma-separated list of allowed origins."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------------
# Scheduler / Cron jobs
# -------------------------------------------------------------------
def start_scheduler() -> None:
    """Start the background scheduler and register cron jobs (only once)."""
    if scheduler.running:
        return

    registerCronJobs(scheduler)
    scheduler.start()


# -------------------------------------------------------------------
# Demo data seeding
# -------------------------------------------------------------------



# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------
app.include_router(auth_routes.router)
app.include_router(users_routes.router)
app.include_router(providers_routes.router)
app.include_router(bookings_routes.router)
app.include_router(profile_routes.router)
app.include_router(admin_routes.router)


# -------------------------------------------------------------------
# Provider location endpoint (restricted & validated)
# -------------------------------------------------
# ------------------

@app.put("/providers/me/location")
def update_my_location(
    payload: schemas.ProviderLocationUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_from_header),
    ):
    """
    Allow a provider to update their public location (lat/long + optional text).
    Uses Pydantic validation and standard FastAPI authentication.
    """

    user = current_user

    if not getattr(user, "is_provider", False):
        raise HTTPException(
            status_code=403,
            detail="Only providers can update their pinned location.",
        )

    lat_f = payload.lat
    long_f = payload.long
    location = payload.location

    # Validate ranges
    if not (-90.0 <= lat_f <= 90.0):
        raise HTTPException(
            status_code=400,
            detail="lat must be between -90 and 90 degrees",
        )
    if not (-180.0 <= long_f <= 180.0):
        raise HTTPException(
            status_code=400,
            detail="long must be between -180 and 180 degrees",
        )

    user.lat = lat_f
    user.long = long_f
    user.location = location

    db.commit()
    db.refresh(user)

    return {
        "lat": user.lat,
        "long": user.long,
        "location": user.location,
    }



# -------------------------------------------------------------------
# Startup hook
# -------------------------------------------------------------------
@app.on_event("startup")
def on_startup() -> None:
    _seed_demo_users()
    start_scheduler()
