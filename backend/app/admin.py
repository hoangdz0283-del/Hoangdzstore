from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth import get_db, require_admin
from app.models import Order, Product, User


router = APIRouter(prefix="/api/admin", tags=["Administration"])


class ProductWriteRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    brand: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    price: int = Field(gt=0)
    sale_price: Optional[int] = Field(default=None, gt=0)
    image: Optional[str] = Field(default=None, max_length=2048)
    badge: Optional[str] = Field(default=None, max_length=100)
    stock: int = Field(ge=0)
    specifications: Optional[dict[str, Any]] = None
    is_active: bool = True


class ProductStockRequest(BaseModel):
    stock: int = Field(ge=0)


class ProductVisibilityRequest(BaseModel):
    is_active: bool


class AdminProductResponse(BaseModel):
    id: int
    name: str
    brand: str
    category: str
    description: Optional[str]
    price: int
    sale_price: Optional[int]
    image: Optional[str]
    badge: Optional[str]
    stock: int
    specifications: Optional[dict[str, Any]]
    is_active: bool

    class Config:
        from_attributes = True


class AdminProductPage(BaseModel):
    items: list[AdminProductResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CustomerUpdateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=1000)


class AdminCustomerResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: Optional[str]
    address: Optional[str]
    created_at: Optional[datetime]
    order_count: int


class AdminCustomerOrderResponse(BaseModel):
    id: int
    status: str
    payment_status: str
    total_amount: int
    created_at: Optional[datetime]


class AdminCustomerDetailResponse(AdminCustomerResponse):
    orders: list[AdminCustomerOrderResponse]


class AdminCustomerPage(BaseModel):
    items: list[AdminCustomerResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


def validate_product_data(data: ProductWriteRequest, db: Session, product_id: int | None = None):
    name = data.name.strip()
    brand = data.brand.strip()
    category = data.category.strip()

    if len(name) < 2 or not brand or not category:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ten, thuong hieu va danh muc khong duoc de trong"
        )

    if data.sale_price is not None and data.sale_price >= data.price:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Gia khuyen mai phai nho hon gia goc"
        )

    duplicate_query = db.query(Product.id).filter(
        func.lower(Product.name) == name.lower(),
        func.lower(Product.brand) == brand.lower()
    )
    if product_id is not None:
        duplicate_query = duplicate_query.filter(Product.id != product_id)
    if duplicate_query.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="San pham cung ten va thuong hieu da ton tai"
        )


def product_values(data: ProductWriteRequest) -> dict[str, Any]:
    return {
        "name": data.name.strip(),
        "brand": data.brand.strip(),
        "category": data.category.strip(),
        "description": data.description.strip() if data.description else None,
        "price": data.price,
        "sale_price": data.sale_price,
        "image": data.image.strip() if data.image else None,
        "badge": data.badge.strip() if data.badge else None,
        "stock": data.stock,
        "specifications": data.specifications,
        "is_active": data.is_active,
    }


@router.get("/products", response_model=AdminProductPage)
def list_products(
    search: Optional[str] = Query(default=None, max_length=100),
    brand: Optional[str] = Query(default=None, max_length=100),
    category: Optional[str] = Query(default=None, max_length=100),
    active: Optional[bool] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    query = db.query(Product)
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(
            Product.name.ilike(term),
            Product.brand.ilike(term),
            Product.category.ilike(term),
        ))
    if brand:
        query = query.filter(Product.brand == brand)
    if category:
        query = query.filter(Product.category == category)
    if active is not None:
        query = query.filter(Product.is_active.is_(active))

    total = query.count()
    items = (
        query.order_by(Product.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return AdminProductPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.post("/products", response_model=AdminProductResponse, status_code=201)
def create_product(
    data: ProductWriteRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    validate_product_data(data, db)
    product = Product(**product_values(data))
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/products/{product_id}", response_model=AdminProductResponse)
def update_product(
    product_id: int,
    data: ProductWriteRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    product = (
        db.query(Product)
        .filter(Product.id == product_id)
        .with_for_update()
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Khong tim thay san pham")

    validate_product_data(data, db, product_id=product_id)
    for field, value in product_values(data).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/products/{product_id}/stock", response_model=AdminProductResponse)
def update_product_stock(
    product_id: int,
    data: ProductStockRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    product = (
        db.query(Product)
        .filter(Product.id == product_id)
        .with_for_update()
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Khong tim thay san pham")

    product.stock = data.stock
    db.commit()
    db.refresh(product)
    return product


@router.patch("/products/{product_id}/visibility", response_model=AdminProductResponse)
def update_product_visibility(
    product_id: int,
    data: ProductVisibilityRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    product = (
        db.query(Product)
        .filter(Product.id == product_id)
        .with_for_update()
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Khong tim thay san pham")

    product.is_active = data.is_active
    db.commit()
    db.refresh(product)
    return product


def customer_query(db: Session, search: Optional[str]):
    order_counts = (
        db.query(
            Order.user_id.label("user_id"),
            func.count(Order.id).label("order_count"),
        )
        .group_by(Order.user_id)
        .subquery()
    )
    query = (
        db.query(User, func.coalesce(order_counts.c.order_count, 0))
        .outerjoin(order_counts, order_counts.c.user_id == User.id)
        .filter(User.role == "customer")
    )
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(
            User.full_name.ilike(term),
            User.email.ilike(term),
            User.phone.ilike(term),
        ))
    return query


@router.get("/customers", response_model=AdminCustomerPage)
def list_customers(
    search: Optional[str] = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    query = customer_query(db, search)
    total = query.count()
    rows = (
        query.order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [
        AdminCustomerResponse(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            phone=user.phone,
            address=user.address,
            created_at=user.created_at,
            order_count=int(order_count),
        )
        for user, order_count in rows
    ]
    return AdminCustomerPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.get("/customers/{customer_id}", response_model=AdminCustomerDetailResponse)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    customer = (
        db.query(User)
        .filter(User.id == customer_id, User.role == "customer")
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Khong tim thay khach hang")

    order_count = db.query(func.count(Order.id)).filter(
        Order.user_id == customer.id
    ).scalar()
    orders = (
        db.query(Order)
        .filter(Order.user_id == customer.id)
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(20)
        .all()
    )
    return AdminCustomerDetailResponse(
        id=customer.id,
        full_name=customer.full_name,
        email=customer.email,
        phone=customer.phone,
        address=customer.address,
        created_at=customer.created_at,
        order_count=int(order_count or 0),
        orders=[
            AdminCustomerOrderResponse(
                id=order.id,
                status=order.status,
                payment_status=order.payment_status,
                total_amount=order.total_amount,
                created_at=order.created_at,
            )
            for order in orders
        ],
    )


@router.patch("/customers/{customer_id}", response_model=AdminCustomerResponse)
def update_customer(
    customer_id: int,
    data: CustomerUpdateRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    customer = (
        db.query(User)
        .filter(User.id == customer_id, User.role == "customer")
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Khong tim thay khach hang")

    full_name = data.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Ho va ten phai co it nhat 2 ky tu",
        )

    customer.full_name = full_name
    customer.phone = data.phone.strip() if data.phone and data.phone.strip() else None
    customer.address = data.address.strip() if data.address and data.address.strip() else None
    db.commit()
    db.refresh(customer)
    order_count = db.query(func.count(Order.id)).filter(
        Order.user_id == customer.id
    ).scalar()
    return AdminCustomerResponse(
        id=customer.id,
        full_name=customer.full_name,
        email=customer.email,
        phone=customer.phone,
        address=customer.address,
        created_at=customer.created_at,
        order_count=int(order_count or 0),
    )
