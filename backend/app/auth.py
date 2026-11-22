
from datetime import datetime, timedelta, timezone
import os

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User


# =====================================
# CAU HINH
# =====================================

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

if not SECRET_KEY:
    raise RuntimeError("Thieu SECRET_KEY trong file .env")

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/token"
)


# =====================================
# DATABASE
# =====================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =====================================
# SCHEMAS
# =====================================

class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    phone: str | None = Field(default=None, max_length=20)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class ProfileUpdateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=1000)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


# =====================================
# PASSWORD
# =====================================

def hash_password(password):
    return pwd_context.hash(password)


def verify_password(password, hashed):
    return pwd_context.verify(password, hashed)


# =====================================
# JWT TOKEN
# =====================================

def create_access_token(user_id):
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": str(user_id),
        "exp": expire
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


# =====================================
# LAY TAI KHOAN DANG DANG NHAP
# =====================================

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Vui long dang nhap",
        headers={"WWW-Authenticate": "Bearer"}
    )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = int(payload.get("sub"))

    except (JWTError, ValueError, TypeError):
        raise credentials_error

    user = db.query(User).filter(
        User.id == user_id
    ).first()

    if not user:
        raise credentials_error

    return user


def require_admin(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Yeu cau quyen admin"
        )
    return user


# =====================================
# DANG KY
# =====================================

@router.post("/register", status_code=201)
def register(
    data: RegisterRequest,
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(
        User.email == data.email
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Email da duoc dang ky"
        )

    full_name = data.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Ho va ten phai co it nhat 2 ky tu"
        )

    phone = data.phone.strip() if data.phone and data.phone.strip() else None

    user = User(
        full_name=full_name,
        email=data.email,
        password_hash=hash_password(data.password),
        phone=phone,
        role="customer"
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": "Dang ky thanh cong",
        "user_id": user.id
    }


# =====================================
# DANG NHAP JSON CHO WEBSITE
# =====================================

@router.post("/login")
def login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.email == data.email
    ).first()

    if not user or not verify_password(
        data.password,
        user.password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Email hoac mat khau khong dung"
        )

    token = create_access_token(user.id)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role
        }
    }


# =====================================
# DANG NHAP OAUTH2 CHO SWAGGER
# =====================================

@router.post("/token")
def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.email == form_data.username
    ).first()

    if not user or not verify_password(
        form_data.password,
        user.password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Email hoac mat khau khong dung"
        )

    token = create_access_token(user.id)

    return {
        "access_token": token,
        "token_type": "bearer"
    }


# =====================================
# THONG TIN TAI KHOAN HIEN TAI
# =====================================

@router.get("/me")
def get_me(
    user: User = Depends(get_current_user)
):
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "address": user.address,
        "role": user.role
    }


@router.put("/me")
def update_me(
    data: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    full_name = data.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Ho va ten phai co it nhat 2 ky tu"
        )

    user.full_name = full_name
    user.phone = data.phone.strip() if data.phone and data.phone.strip() else None
    user.address = data.address.strip() if data.address and data.address.strip() else None

    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "address": user.address,
        "role": user.role
    }


@router.patch("/password")
def change_password(
    data: PasswordChangeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(
            status_code=400,
            detail="Mat khau hien tai khong dung"
        )

    if verify_password(data.new_password, user.password_hash):
        raise HTTPException(
            status_code=400,
            detail="Mat khau moi phai khac mat khau hien tai"
        )

    user.password_hash = hash_password(data.new_password)
    db.commit()

    return {"message": "Doi mat khau thanh cong"}
