from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from jose import jwt
from datetime import datetime, timedelta
from app.database import get_db, Base, engine
from app import crud, schemas, models

app = FastAPI(title="Guyana Booker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# JWT settings
SECRET_KEY = "your-super-secret-key-change-this-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 1 day

# Create tables
Base.metadata.create_all(bind=engine)

# Seed demo users (this works 100%)
def seed_demo_users():
    db: Session = next(get_db())
    try:
        if not crud.get_user_by_email(db, "customer@guyana.com"):
            crud.create_user(db, schemas.UserCreate(
                email="customer@guyana.com", password="pass", full_name="Test Customer",
                phone="5926000000", location="Georgetown", whatsapp="whatsapp:+5926000000"
            ))
            crud.create_user(db, schemas.UserCreate(
                email="provider@guyana.com", password="pass", full_name="Test Provider",
                phone="5926000001", location="Georgetown", is_provider=True, whatsapp="whatsapp:+5926000001"
            ))
            print("Demo users created — login with customer@guyana.com / pass")
    finally:
        db.close()

seed_demo_users()

# Token creation
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# Routes
@app.post("/auth/signup")
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if crud.get_user_by_email(db, user.email):
        raise HTTPException(400, "Email already registered")
    return crud.create_user(db, user)

@app.post("/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = crud.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/")
def root():
    return {"message": "Guyana Booker API is running — use customer@guyana.com / pass"}

# Add your other routes here (search, book, admin, etc.) — they all stay!
