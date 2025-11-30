import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, Header
from dotenv import load_dotenv
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent  # points to backend/
# Load backend/.env
load_dotenv(BASE_DIR / ".env")
# Optionally also load project-root .env (guyana-booker/.env)
load_dotenv(BASE_DIR.parent / ".env")
from app.database import SessionLocal, get_db, Base, engine
from app.workers.cron import registerCronJobs
from app.config import get_settings
from app import crud, schemas
from app.routes import auth as auth_routes
from app.routes import users as users_routes
from app.routes import providers as providers_routes
from app.routes import bookings as bookings_routes
from app.routes import profile as profile_routes





settings = get_settings()

app = FastAPI(title="Guyana Booker")
scheduler = BackgroundScheduler()


def start_scheduler() -> None:
    """
    Start the background scheduler and register cron jobs.
    This is only called on FastAPI startup, so it won't run on import.
    """
    if scheduler.running:
        return

    registerCronJobs(scheduler)
    scheduler.start()


def _seed_demo_users() -> None:
    """
    Seed demo users in development environment only.
    Controlled by settings.ENABLE_DEMO_SEED and settings.ENV.
    """
    if not settings.ENABLE_DEMO_SEED or settings.ENV != "dev":
        return

    db: Session = SessionLocal()
    try:
        if not crud.get_user_by_email(db, "customer@guyana.com"):
            crud.create_user(
                db,
                schemas.UserCreate(
                    email="customer@guyana.com",
                    password="pass",
                    full_name="Test Customer",
                    phone="5926000000",
                    location="Georgetown",
                    whatsapp="whatsapp:+5926000000",
                ),
            )

        if not crud.get_user_by_email(db, "provider@guyana.com"):
            crud.create_user(
                db,
                schemas.UserCreate(
                    email="provider@guyana.com",
                    password="pass",
                    full_name="Test Provider",
                    phone="5926000001",
                    location="Georgetown",
                    is_provider=True,
                    whatsapp="whatsapp:+5926000001",
                ),
            )

        print("Demo users created — login with customer@guyana.com / pass")
    finally:
        db.close()


@app.on_event("startup")
def on_startup():
    # 1) Make sure all tables exist
    Base.metadata.create_all(bind=engine)

    # 2) Start background jobs
    start_scheduler()

    # 3) Seed demo users in dev, if enabled
    _seed_demo_users()


# CORS
if settings.ENV == "prod":
    allow_origins = settings.CORS_ALLOW_ORIGINS or []
else:
    # In dev, allow everything so mobile, web, and ngrok can all hit the API
    allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Guyana Booker API running"}

@app.put("/providers/me/location")
def update_my_location(
    payload: dict,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    lat = payload.get("lat")
    long = payload.get("long")
    location = payload.get("location")  # optional

    if lat is None or long is None:
        raise HTTPException(status_code=400, detail="lat and long are required")

    # update
    user.lat = float(lat)
    user.long = float(long)
    if location is not None:
        user.location = location

    db.commit()
    db.refresh(user)

    return {
        "status": "updated",
        "lat": user.lat,
        "long": user.long,
        "location": user.location,
    }


# Routers
app.include_router(auth_routes.router)
app.include_router(users_routes.router)
app.include_router(providers_routes.router)
app.include_router(bookings_routes.router)
app.include_router(profile_routes.router)







# from fastapi import FastAPI, Depends, HTTPException, Header, status
# from fastapi.security import OAuth2PasswordRequestForm
# from fastapi.middleware.cors import CORSMiddleware
# from sqlalchemy.orm import Session
# from typing import List, Optional  # 👈 new
# from .database import get_db, Base, engine, SessionLocal
# from app import crud, schemas, models
# import os
# from jose import jwt, JWTError
# from datetime import datetime, timedelta
# from apscheduler.schedulers.background import BackgroundScheduler
# from app.workers.cron import registerCronJobs


# SECRET_KEY = os.getenv("JWT_SECRET", "dev-secret")
# ACCESS_TOKEN_EXPIRE_MINUTES = 1440

# app = FastAPI(title="Guyana Booker")
# scheduler = BackgroundScheduler()
# registerCronJobs(scheduler)
# scheduler.start()


# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # Create tables
# Base.metadata.create_all(bind=engine)

# # Seed demo users
# db = SessionLocal()
# try:
    
#     if not crud.get_user_by_email(db, "customer@guyana.com"):
#         crud.create_user(
#             db,
#             schemas.UserCreate(
#                 email="customer@guyana.com",
#                 password="pass",
#                 full_name="Test Customer",
#                 phone="5926000000",
#                 location="Georgetown",
#                 whatsapp="whatsapp:+5926000000",
#             ),
#         )
#         crud.create_user(
#             db,
#             schemas.UserCreate(
#                 email="provider@guyana.com",
#                 password="pass",
#                 full_name="Test Provider",
#                 phone="5926000001",
#                 location="Georgetown",
#                 is_provider=True,
#                 whatsapp="whatsapp:+5926000001",
#             ),
#         )
#         print("Demo users created — login with customer@guyana.com / pass")

        
# finally:
#     db.close()


# @app.get("/")
# def root():
#     return {"message": "Guyana Booker API running"}


# # ---------------------------
# # AUTH ROUTES
# # ---------------------------

# @app.post("/auth/signup")
# def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
#     if crud.get_user_by_email(db, user.email):
#         raise HTTPException(status_code=400, detail="Email already registered")
#     return crud.create_user(db, user)


# @app.post("/auth/login")
# def login(
#     form_data: OAuth2PasswordRequestForm = Depends(),
#     db: Session = Depends(get_db),
# ):
#     user = crud.authenticate_user(db, form_data.username, form_data.password)

#     if not user:
#         raise HTTPException(status_code=400, detail="Incorrect email or password")

#     token_payload = {
#         "sub": user.email,
#         "user_id": user.id,
#         "is_provider": user.is_provider,
#         "is_admin": user.is_admin,
#         "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
#     }

#     access_token = jwt.encode(token_payload, SECRET_KEY, algorithm="HS256")

#     return {
#         "access_token": access_token,
#         "token_type": "bearer",
#         "user_id": user.id,
#         "email": user.email,
#         "is_provider": user.is_provider,
#         "is_admin": user.is_admin,
#     }


# # ---------------------------
# # HELPER: CURRENT USER FROM JWT
# # ---------------------------

# def get_current_user_from_header(authorization: Optional[str], db: Session):
#     if not authorization or not authorization.startswith("Bearer "):
#         raise HTTPException(status_code=401, detail="Not authenticated")

#     token = authorization.split(" ", 1)[1]

#     try:
#         payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
#     except JWTError:
#         raise HTTPException(status_code=401, detail="Invalid token")

#     user_email = payload.get("sub")
#     if not user_email:
#         raise HTTPException(status_code=401, detail="Invalid token payload")

#     user = crud.get_user_by_email(db, user_email)
#     if not user:
#         raise HTTPException(status_code=404, detail="User not found")

#     return user


# # ---------------------------
# # ME ENDPOINT
# # ---------------------------

# @app.get("/me")
# def read_me(authorization: str = Header(None), db: Session = Depends(get_db)):
#     user = get_current_user_from_header(authorization, db)

#     return {
#         "user_id": user.id,
#         "email": user.email,
#         "full_name": user.full_name,
#         "phone": user.phone,
#         "location": user.location,
#         "lat": user.lat,
#         "long": user.long,
#         "is_provider": user.is_provider,
#         "is_admin": user.is_admin,
#     }

# # ---------------------------
# # ME PROFILE (for any user)
# # ---------------------------

# @app.get("/me/profile",
#     response_model=schemas.UserProfileOut,
#     status_code=status.HTTP_200_OK,
# )
# def get_my_profile(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     return schemas.UserProfileOut(
#         full_name=user.full_name or "",
#         phone=user.phone or "",
#         whatsapp=user.whatsapp,
#         location=user.location or "",
#     )


# @app.put("/me/profile",
#     response_model=schemas.UserProfileOut,
#     status_code=status.HTTP_200_OK,
# )
# def update_my_profile(
#     payload: schemas.UserProfileUpdate,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if payload.full_name is not None:
#         user.full_name = payload.full_name

#     if payload.phone is not None:
#         user.phone = payload.phone

#     if payload.whatsapp is not None:
#         user.whatsapp = payload.whatsapp

#     if payload.location is not None:
#         user.location = payload.location

#     db.commit()
#     db.refresh(user)

#     return schemas.UserProfileOut(
#         full_name=user.full_name or "",
#         phone=user.phone or "",
#         whatsapp=user.whatsapp,
#         location=user.location or "",
#     )

# @app.post("/me/push-token")
# def save_my_push_token(
#     payload: dict,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)
#     token = payload.get("expo_push_token")
#     user.expo_push_token = token
#     db.commit()
#     return {"status": "ok"}


# # ---------------------------
# # PROVIDER SERVICES ENDPOINTS
# # ---------------------------

# @app.get(
#     "/providers/me/services",
#     response_model=List[schemas.ServiceOut],
#     status_code=status.HTTP_200_OK,
# )
# def list_my_services(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can have services")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         provider = crud.create_provider_for_user(db, user)

#     services = crud.list_services_for_provider(db, provider_id=provider.id)
#     return services


# @app.post(
#     "/providers/me/services",
#     response_model=schemas.ServiceOut,
#     status_code=status.HTTP_201_CREATED,
# )
# def create_my_service(
#     service_in: schemas.ServiceCreate,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can create services")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         provider = crud.create_provider_for_user(db, user)

#     new_service = crud.create_service_for_provider(
#         db, provider_id=provider.id, service_in=service_in
#     )
#     return new_service


# @app.delete(
#     "/providers/me/services/{service_id}",
#     status_code=status.HTTP_204_NO_CONTENT,
# )
# def delete_my_service(
#     service_id: int,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can delete services")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     ok = crud.delete_service_for_provider(db, service_id=service_id, provider_id=provider.id)
#     if not ok:
#         raise HTTPException(status_code=404, detail="Service not found")

#     # 204 has no body
#     return

# @app.get(
#     "/providers/me/bookings",
#     response_model=List[schemas.BookingSummary],
#     status_code=status.HTTP_200_OK,
# )
# def list_my_bookings(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can view provider bookings")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     bookings = crud.list_bookings_for_provider(db, provider_id=provider.id)
#     return bookings

# @app.post(
#     "/providers/me/bookings/{booking_id}/cancel",
#     status_code=status.HTTP_204_NO_CONTENT,
# )
# def cancel_my_booking(
#     booking_id: int,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can cancel bookings")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     ok = crud.cancel_booking_for_provider(db, booking_id=booking_id, provider_id=provider.id)
#     if not ok:
#         raise HTTPException(status_code=404, detail="Booking not found")

#     # 204 No Content → nothing to return
#     return

# @app.get(
#     "/providers/me/hours",
#     response_model=List[schemas.WorkingHoursOut],
#     status_code=status.HTTP_200_OK,
# )
# def get_my_working_hours(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can manage working hours")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     rows = crud.get_or_create_working_hours_for_provider(db, provider_id=provider.id)
#     return rows


# @app.post(
#     "/providers/me/hours",
#     response_model=List[schemas.WorkingHoursOut],
#     status_code=status.HTTP_200_OK,
# )
# def update_my_working_hours(
#     hours: List[schemas.WorkingHoursUpdate],
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can manage working hours")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     # convert Pydantic models to simple dicts for CRUD
#     hours_list = [h.dict() for h in hours]

#     rows = crud.set_working_hours_for_provider(db, provider_id=provider.id, hours_list=hours_list)
#     return rows


# @app.get(
#     "/providers/me/profile",
#     response_model=schemas.ProviderProfileOut,
#     status_code=status.HTTP_200_OK,
# )
# def get_my_provider_profile(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can edit provider profile")

#     provider = crud.get_or_create_provider_for_user(db, user.id)
#     professions = crud.get_professions_for_provider(db, provider.id)

#     return schemas.ProviderProfileOut(
#         full_name=user.full_name or "",
#         phone=user.phone or "",
#         whatsapp=user.whatsapp,
#         location=user.location or "",
#         bio=provider.bio or "",
#         professions=professions,
#     )



# @app.put(
#     "/providers/me/profile",
#     response_model=schemas.ProviderProfileOut,
#     status_code=status.HTTP_200_OK,
# )
# def update_my_provider_profile(
#     payload: schemas.ProviderProfileUpdate,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can edit provider profile")

#     provider = crud.get_or_create_provider_for_user(db, user.id)

#     # Update basic fields
#     if payload.full_name is not None:
#         user.full_name = payload.full_name

#     if payload.phone is not None:
#         user.phone = payload.phone

#     if payload.whatsapp is not None:
#         user.whatsapp = payload.whatsapp

#     if payload.location is not None:
#         user.location = payload.location

#     if payload.bio is not None:
#         provider.bio = payload.bio

#     # Update professions if provided
#     if payload.professions is not None:
#         professions = crud.set_professions_for_provider(
#             db, provider.id, payload.professions
#         )
#     else:
#         professions = crud.get_professions_for_provider(db, provider.id)

#     db.commit()
#     db.refresh(user)
#     db.refresh(provider)

#     return schemas.ProviderProfileOut(
#         full_name=user.full_name or "",
#         phone=user.phone or "",
#         whatsapp=user.whatsapp,
#         location=user.location or "",
#         bio=provider.bio or "",
#         professions=professions,
#     )


# @app.get(
#     "/providers/me/bookings/today",
#     response_model=List[schemas.BookingWithDetails],
#     status_code=status.HTTP_200_OK,
# )
# def get_my_todays_bookings(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can see these bookings")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     bookings = crud.list_todays_bookings_for_provider(db, provider.id)
#     return bookings


# @app.post(
#     "/providers/me/bookings/{booking_id}/cancel",
#     status_code=status.HTTP_200_OK,
# )
# def cancel_my_booking(
#     booking_id: int,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can cancel bookings")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     ok = crud.cancel_booking_for_provider(db, booking_id=booking_id, provider_id=provider.id)
#     if not ok:
#         raise HTTPException(status_code=404, detail="Booking not found")

#     return {"status": "cancelled"}

# @app.get(
#     "/providers/me/bookings/upcoming",
#     response_model=List[schemas.BookingWithDetails],
#     status_code=status.HTTP_200_OK,
# )
# def get_my_upcoming_bookings(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can see these bookings")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         raise HTTPException(status_code=404, detail="Provider not found")

#     bookings = crud.list_upcoming_bookings_for_provider(db, provider.id)
#     return bookings


# @app.post("/providers/me/location")
# def update_location(data: dict, authorization: str = Header(None), db: Session = Depends(get_db)):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers can update location")

#     provider = crud.get_provider_by_user_id(db, user.id)

#     user.lat = data.get("lat")
#     user.long = data.get("long")

#     db.commit()

#     return {"status": "updated", "lat": user.lat, "long": user.long}

# @app.get(
#     "/providers/{provider_id}/availability",
#     response_model=List[schemas.ProviderAvailabilityDay],
#     status_code=status.HTTP_200_OK,
# )
# def get_provider_availability_route(
#     provider_id: int,
#     service_id: int,
#     days: int = 14,
#     db: Session = Depends(get_db),
# ):
#     """
#     Availability for a specific provider + service over the next `days`.
#     Used by the client calendar/time slot picker.
#     """
#     try:
#         availability = crud.get_provider_availability(
#             db,
#             provider_id=provider_id,
#             service_id=service_id,
#             days=days,
#         )
#     except ValueError as e:
#         raise HTTPException(status_code=400, detail=str(e))

#     return availability

# @app.get(
#     "/providers/me/summary",
#     response_model=schemas.ProviderSummary,
#     status_code=status.HTTP_200_OK,
# )
# def get_my_provider_summary(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     user = get_current_user_from_header(authorization, db)

#     if not user.is_provider:
#         raise HTTPException(status_code=403, detail="Only providers have summaries")

#     provider = crud.get_provider_by_user_id(db, user.id)
#     if not provider:
#         provider = crud.create_provider_for_user(db, user)

#     # 🔑 Backfill account_number if it's missing
#     if not provider.account_number:
#         provider.account_number = crud.generate_account_number_for_email(user.email)
#         db.commit()
#         db.refresh(provider)

#     fees_due = crud.get_provider_fees_due(db, provider.id)

#     return schemas.ProviderSummary(
#         account_number=provider.account_number,
#         total_fees_due_gyd=fees_due,
#     )



# # ---------------------------
# # PUBLIC PROVIDER LIST + CLIENT BOOKINGS
# # ---------------------------

# @app.get(
#     "/providers",
#     response_model=List[schemas.ProviderListItem],
#     status_code=status.HTTP_200_OK,
# )
# def list_providers(db: Session = Depends(get_db)):
#     """
#     Public list of providers for the client search screen.
#     """
#     rows = (
#         db.query(models.Provider, models.User)
#         .join(models.User, models.Provider.user_id == models.User.id)
#         .all()
#     )
#     out = []
#     for provider, user in rows:
#         professions = crud.get_professions_for_provider(db, provider.id)
#         out.append(
#             schemas.ProviderListItem(
#                 provider_id=provider.id,
#                 name=user.full_name or "",
#                 location=user.location or "",
#                 lat=user.lat,
#                 long=user.long,
#                 bio=provider.bio or "",
#                 professions=professions,
#             )
#         )
#     return out



# @app.get(
#     "/providers/{provider_id}/services",
#     response_model=List[schemas.ServiceOut],
#     status_code=status.HTTP_200_OK,
# )
# def list_services_for_provider_public(
#     provider_id: int, db: Session = Depends(get_db)
# ):
#     """
#     Public list of services for a single provider.
#     """
#     services = crud.list_services_for_provider(db, provider_id=provider_id)
#     return services


# @app.post(
#     "/bookings",
#     response_model=schemas.BookingWithDetails,
#     status_code=status.HTTP_201_CREATED,
# )
# def create_booking_for_me(
#     payload: schemas.BookingCreate,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     """
#     Create a booking for the currently logged-in user (as customer).
#     This uses the promotion + lock logic inside crud.create_booking.
#     """
#     user = get_current_user_from_header(authorization, db)

#     try:
#         booking = crud.create_booking(db, payload, customer_id=user.id)
#     except ValueError as e:
#         raise HTTPException(status_code=400, detail=str(e))

#     # Build rich response with service + customer info
#     service = (
#         db.query(models.Service)
#         .filter(models.Service.id == booking.service_id)
#         .first()
#     )
#     customer = user

#     return schemas.BookingWithDetails(
#         id=booking.id,
#         start_time=booking.start_time,
#         end_time=booking.end_time,
#         status=booking.status,
#         service_name=service.name if service else "",
#         service_duration_minutes=service.duration_minutes if service else 0,
#         service_price_gyd=(
#             float(service.price_gyd) if service and service.price_gyd is not None else 0.0
#         ),
#         customer_name=customer.full_name or "",
#         customer_phone=customer.phone or "",
#     )

# @app.get(
#     "/me/bookings",
#     response_model=List[schemas.BookingWithDetails],
#     status_code=status.HTTP_200_OK,
# )
# def list_my_bookings_for_me(
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     """
#     All bookings for the currently logged-in user as a customer.
#     """
#     user = get_current_user_from_header(authorization, db)
#     bookings = crud.list_bookings_for_customer(db, user.id)
#     return bookings

# @app.post(
#     "/me/bookings/{booking_id}/cancel",
#     status_code=status.HTTP_200_OK,
# )
# def cancel_my_booking_as_customer(
#     booking_id: int,
#     authorization: str = Header(None),
#     db: Session = Depends(get_db),
# ):
#     """
#     Cancel a booking as the currently logged-in customer.
#     """
#     user = get_current_user_from_header(authorization, db)

#     ok = crud.cancel_booking_for_customer(
#         db, booking_id=booking_id, customer_id=user.id
#     )
#     if not ok:
#         raise HTTPException(status_code=404, detail="Booking not found")

#     return {"status": "cancelled"}


