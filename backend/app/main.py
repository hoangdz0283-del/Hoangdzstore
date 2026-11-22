
import os

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Product
from app.auth import router as auth_router
from app.admin import router as admin_router
from app.orders import router as orders_router
from app.chatbot import router as chatbot_router


app = FastAPI(
    title="HOANGDZ STORE API",
    description="Backend website ban hang dien tu",
    version="1.0.0"
)


# =====================================
# CORS
# =====================================

configured_origins = os.getenv("CORS_ORIGINS", "").strip()
if configured_origins:
    cors_origins = [
        origin.strip().rstrip("/")
        for origin in configured_origins.split(",")
        if origin.strip()
    ]
    if "*" in cors_origins:
        raise RuntimeError("CORS_ORIGINS must list explicit origins, not '*'.")
else:
    cors_origins = [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:8765",
        "http://127.0.0.1:8765",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# =====================================
# DANG KY CAC ROUTER
# =====================================

app.include_router(auth_router)
app.include_router(orders_router)
app.include_router(admin_router)
app.include_router(chatbot_router)


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
# TRANG CHU API
# =====================================

@app.get("/")
def home():
    return {
        "message": "HOANGDZ STORE API is running!",
        "status": "success"
    }


# =====================================
# DANH SACH SAN PHAM
# =====================================

@app.get("/api/products")
def get_products(db: Session = Depends(get_db)):
    products = (
        db.query(Product)
        .filter(Product.is_active.is_(True))
        .order_by(Product.id)
        .all()
    )

    return [
        {
            "id": p.id,
            "name": p.name,
            "brand": p.brand,
            "category": p.category,
            "description": p.description,
            "price": p.price,
            "sale_price": p.sale_price,
            "image": p.image,
            "badge": p.badge,
            "stock": p.stock,
            "specifications": p.specifications,
            "is_active": p.is_active
        }
        for p in products
    ]
