from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional  # 👈 new
from .database import get_db, Base, engine, SessionLocal
from app import crud, schemas
import os
from jose import jwt, JWTError
from datetime import datetime, timedelta

SECRET_KEY = os.getenv("JWT_SECRET", "dev-secret")
ACCESS_TOKEN_EXPIRE_MINUTES = 1440

app = FastAPI(title="Guyana Booker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables
Base.metadata.create_all(bind=engine)

# Seed demo users
db = SessionLocal()
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


@app.get("/")
def root():
    return {"message": "Guyana Booker API running"}


# ---------------------------
# AUTH ROUTES
# ---------------------------

@app.post("/auth/signup")
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if crud.get_user_by_email(db, user.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db, user)


@app.post("/auth/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = crud.authenticate_user(db, form_data.username, form_data.password)

    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    token_payload = {
        "sub": user.email,
        "user_id": user.id,
        "is_provider": user.is_provider,
        "is_admin": user.is_admin,
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }

    access_token = jwt.encode(token_payload, SECRET_KEY, algorithm="HS256")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "email": user.email,
        "is_provider": user.is_provider,
        "is_admin": user.is_admin,
    }


# ---------------------------
# HELPER: CURRENT USER FROM JWT
# ---------------------------

def get_current_user_from_header(authorization: Optional[str], db: Session):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ", 1)[1]

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_email = payload.get("sub")
    if not user_email:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = crud.get_user_by_email(db, user_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


# ---------------------------
# ME ENDPOINT
# ---------------------------

@app.get("/me")
def read_me(authorization: str = Header(None), db: Session = Depends(get_db)):
    user = get_current_user_from_header(authorization, db)

    return {
        "user_id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "location": user.location,
        "is_provider": user.is_provider,
        "is_admin": user.is_admin,
    }


# ---------------------------
# PROVIDER SERVICES ENDPOINTS
# ---------------------------

@app.get(
    "/providers/me/services",
    response_model=List[schemas.ServiceOut],
    status_code=status.HTTP_200_OK,
)
def list_my_services(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can have services")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        provider = crud.create_provider_for_user(db, user)

    services = crud.list_services_for_provider(db, provider_id=provider.id)
    return services


@app.post(
    "/providers/me/services",
    response_model=schemas.ServiceOut,
    status_code=status.HTTP_201_CREATED,
)
def create_my_service(
    service_in: schemas.ServiceCreate,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can create services")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        provider = crud.create_provider_for_user(db, user)

    new_service = crud.create_service_for_provider(
        db, provider_id=provider.id, service_in=service_in
    )
    return new_service


@app.delete(
    "/providers/me/services/{service_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_my_service(
    service_id: int,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can delete services")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    ok = crud.delete_service_for_provider(db, service_id=service_id, provider_id=provider.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Service not found")

    # 204 has no body
    return

@app.get(
    "/providers/me/bookings",
    response_model=List[schemas.BookingSummary],
    status_code=status.HTTP_200_OK,
)
def list_my_bookings(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can view provider bookings")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    bookings = crud.list_bookings_for_provider(db, provider_id=provider.id)
    return bookings

@app.post(
    "/providers/me/bookings/{booking_id}/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
)
def cancel_my_booking(
    booking_id: int,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can cancel bookings")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    ok = crud.cancel_booking_for_provider(db, booking_id=booking_id, provider_id=provider.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Booking not found")

    # 204 No Content → nothing to return
    return

@app.get(
    "/providers/me/hours",
    response_model=List[schemas.WorkingHoursOut],
    status_code=status.HTTP_200_OK,
)
def get_my_working_hours(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can manage working hours")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    rows = crud.get_or_create_working_hours_for_provider(db, provider_id=provider.id)
    return rows


@app.post(
    "/providers/me/hours",
    response_model=List[schemas.WorkingHoursOut],
    status_code=status.HTTP_200_OK,
)
def update_my_working_hours(
    hours: List[schemas.WorkingHoursUpdate],
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user_from_header(authorization, db)

    if not user.is_provider:
        raise HTTPException(status_code=403, detail="Only providers can manage working hours")

    provider = crud.get_provider_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # convert Pydantic models to simple dicts for CRUD
    hours_list = [h.dict() for h in hours]

    rows = crud.set_working_hours_for_provider(db, provider_id=provider.id, hours_list=hours_list)
    return rows
