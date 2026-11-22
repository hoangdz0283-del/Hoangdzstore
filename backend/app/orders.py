from datetime import datetime
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_db, get_current_user, require_admin
from app.models import User, Product, Order, OrderItem


router = APIRouter(
    prefix="/api/orders",
    tags=["Orders"]
)


def get_effective_unit_price(product: Product) -> int:
    sale_price = product.sale_price
    if sale_price is not None and 0 < sale_price < product.price:
        return int(sale_price)
    return int(product.price)


# =====================================
# SCHEMAS
# =====================================

class OrderItemRequest(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=100)


class CreateOrderRequest(BaseModel):
    recipient_name: str = Field(min_length=2, max_length=150)
    recipient_phone: str = Field(min_length=9, max_length=20)
    shipping_address: str = Field(min_length=5)
    payment_method: Literal["cod", "bank_transfer"] = "cod"
    note: str | None = Field(default=None, max_length=1000)
    items: list[OrderItemRequest] = Field(min_length=1, max_length=50)


class OrderItemResponse(BaseModel):
    id: int
    product_id: Optional[int]
    product_name: str
    unit_price: int
    quantity: int
    subtotal: int
    product_image: Optional[str] = None

    class Config:
        from_attributes = True


class OrderResponse(BaseModel):
    id: int
    recipient_name: str
    recipient_phone: str
    shipping_address: str
    total_amount: int
    payment_method: str
    payment_status: str
    status: str
    note: Optional[str]
    created_at: datetime
    items: list[OrderItemResponse]

    class Config:
        from_attributes = True


class OrderListItemResponse(BaseModel):
    id: int
    recipient_name: str
    recipient_phone: str
    shipping_address: str
    total_amount: int
    payment_method: str
    payment_status: str
    status: str
    note: Optional[str]
    created_at: datetime
    items: list[OrderItemResponse]

    class Config:
        from_attributes = True


class PaginatedOrdersResponse(BaseModel):
    orders: list[OrderListItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CancelOrderRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


class AdminOrderStatusUpdate(BaseModel):
    status: Literal["pending", "confirmed", "preparing", "shipping", "delivered", "cancelled"]


class AdminPaymentStatusUpdate(BaseModel):
    payment_status: Literal["unpaid", "paid", "refunded"]


class AdminOrderResponse(BaseModel):
    id: int
    user_id: int
    user_email: str
    user_name: str
    recipient_name: str
    recipient_phone: str
    shipping_address: str
    total_amount: int
    payment_method: str
    payment_status: str
    status: str
    note: Optional[str]
    created_at: datetime
    items: list[OrderItemResponse]

    class Config:
        from_attributes = True


class AdminPaginatedOrdersResponse(BaseModel):
    orders: list[AdminOrderResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# =====================================
# HELPER FUNCTIONS
# =====================================

def map_status_to_vietnamese(status: str) -> str:
    """Map English status to Vietnamese for display"""
    mapping = {
        "pending": "Chờ xác nhận",
        "confirmed": "Đã xác nhận",
        "preparing": "Đang chuẩn bị hàng",
        "shipping": "Đang giao hàng",
        "delivered": "Đã giao hàng",
        "cancelled": "Đã hủy"
    }
    return mapping.get(status, status)


def map_payment_status_to_vietnamese(status: str) -> str:
    """Map English payment status to Vietnamese for display"""
    mapping = {
        "unpaid": "Chưa thanh toán",
        "paid": "Đã thanh toán",
        "refunded": "Đã hoàn tiền"
    }
    return mapping.get(status, status)


def build_admin_order_response(order: Order) -> AdminOrderResponse:
    return AdminOrderResponse(
        id=order.id,
        user_id=order.user_id,
        user_email=order.user.email if order.user else "",
        user_name=order.user.full_name if order.user else "",
        recipient_name=order.recipient_name,
        recipient_phone=order.recipient_phone,
        shipping_address=order.shipping_address,
        total_amount=order.total_amount,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        status=order.status,
        note=order.note,
        created_at=order.created_at,
        items=[build_order_item_response(item) for item in order.items]
    )


def build_order_item_response(item: OrderItem) -> OrderItemResponse:
    return OrderItemResponse(
        id=item.id,
        product_id=item.product_id,
        product_name=item.product_name,
        unit_price=item.unit_price,
        quantity=item.quantity,
        subtotal=item.subtotal,
        product_image=item.product.image if item.product else None
    )


def restore_reserved_inventory(db: Session, order: Order) -> None:
    for item in sorted(order.items, key=lambda order_item: order_item.product_id or 0):
        if not item.stock_deducted:
            continue

        product = None
        if item.product_id is not None:
            product = (
                db.query(Product)
                .filter(Product.id == item.product_id)
                .with_for_update()
                .first()
            )

        if product:
            product.stock += item.quantity
        item.stock_deducted = False


# =====================================
# TAO DON HANG
# =====================================

@router.post("/", status_code=201)
def create_order(
    data: CreateOrderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        # Gop cac san pham trung ID
        quantities = {}

        for item in data.items:
            quantities[item.product_id] = (
                quantities.get(item.product_id, 0) + item.quantity
            )

        if any(quantity > 100 for quantity in quantities.values()):
            raise HTTPException(
                status_code=400,
                detail="So luong moi san pham khong duoc vuot qua 100"
            )

        order_items = []
        total_amount = 0

        for product_id, quantity in sorted(quantities.items()):
            product = (
                db.query(Product)
                .filter(
                    Product.id == product_id,
                    Product.is_active.is_(True)
                )
                .with_for_update()
                .first()
            )

            if not product:
                raise HTTPException(
                    status_code=404,
                    detail=f"Khong tim thay san pham dang kinh doanh ID {product_id}"
                )

            if product.stock < quantity:
                raise HTTPException(
                    status_code=409,
                    detail=f"San pham '{product.name}' khong du ton kho"
                )

            unit_price = get_effective_unit_price(product)
            subtotal = unit_price * quantity
            total_amount += subtotal
            product.stock -= quantity

            order_items.append(
                OrderItem(
                    product_id=product.id,
                    product_name=product.name,
                    unit_price=unit_price,
                    quantity=quantity,
                    subtotal=subtotal,
                    stock_deducted=True
                )
            )

        order = Order(
            user_id=user.id,
            recipient_name=data.recipient_name.strip(),
            recipient_phone=data.recipient_phone.strip(),
            shipping_address=data.shipping_address.strip(),
            total_amount=total_amount,
            payment_method=data.payment_method,
            payment_status="unpaid",
            status="pending",
            note=data.note,
            items=order_items
        )

        db.add(order)
        db.commit()
        db.refresh(order)

        return {
            "message": "Tao don hang thanh cong",
            "order_id": order.id,
            "total_amount": order.total_amount,
            "payment_method": order.payment_method,
            "payment_status": order.payment_status,
            "status": order.status
        }

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Khong the tao don hang"
        )


# =====================================
# XEM LICH SU DON HANG (KHACH HANG)
# =====================================

@router.get("/")
def get_my_orders(
    page: int = Query(1, ge=1, description="So trang"),
    page_size: int = Query(10, ge=1, le=50, description="So don hang moi trang"),
    status_filter: Optional[str] = Query(None, description="Loc theo trang thai"),
    search: Optional[str] = Query(None, description="Tim kiem theo ma don hang"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    query = (
        db.query(Order)
        .options(joinedload(Order.items).joinedload(OrderItem.product))
        .filter(Order.user_id == user.id)
    )

    # Filter by status
    if status_filter:
        query = query.filter(Order.status == status_filter)

    # Search by order ID
    if search:
        try:
            order_id = int(search.strip())
            query = query.filter(Order.id == order_id)
        except ValueError:
            # Invalid search, return empty
            return PaginatedOrdersResponse(
                orders=[],
                total=0,
                page=page,
                page_size=page_size,
                total_pages=0
            )

    # Get total count
    total = query.count()

    # Apply pagination
    orders = (
        query.order_by(Order.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    total_pages = (total + page_size - 1) // page_size

    order_list = []
    for order in orders:
        order_list.append(OrderListItemResponse(
            id=order.id,
            recipient_name=order.recipient_name,
            recipient_phone=order.recipient_phone,
            shipping_address=order.shipping_address,
            total_amount=order.total_amount,
            payment_method=order.payment_method,
            payment_status=order.payment_status,
            status=order.status,
            note=order.note,
            created_at=order.created_at,
            items=[build_order_item_response(item) for item in order.items]
        ))

    return PaginatedOrdersResponse(
        orders=order_list,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


# =====================================
# ADMIN: TONG QUAN DON HANG
# =====================================

@router.get("/admin/summary")
def admin_get_order_summary(
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin)
):
    status_counts = dict(
        db.query(Order.status, func.count(Order.id))
        .group_by(Order.status)
        .all()
    )

    total_orders = sum(status_counts.values())
    active_statuses = ("confirmed", "preparing", "shipping")
    revenue_total = (
        db.query(func.coalesce(func.sum(Order.total_amount), 0))
        .filter(
            Order.status != "cancelled",
            Order.payment_status == "paid"
        )
        .scalar()
    )

    return {
        "total_orders": total_orders,
        "pending_orders": status_counts.get("pending", 0),
        "active_orders": sum(status_counts.get(value, 0) for value in active_statuses),
        "delivered_orders": status_counts.get("delivered", 0),
        "revenue_total": int(revenue_total or 0)
    }


# =====================================
# ADMIN: XEM TAT CA DON HANG
# =====================================

@router.get("/admin/all", response_model=AdminPaginatedOrdersResponse)
def admin_get_all_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None),
    payment_status_filter: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Tim theo ma don hoac ten khach hang"),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin)
):
    query = (
        db.query(Order)
        .options(
            joinedload(Order.items).joinedload(OrderItem.product),
            joinedload(Order.user)
        )
        .join(User, Order.user_id == User.id)
    )

    if status_filter:
        query = query.filter(Order.status == status_filter)

    if payment_status_filter:
        query = query.filter(Order.payment_status == payment_status_filter)

    if search:
        search_term = search.strip()
        try:
            order_id = int(search_term)
            query = query.filter(Order.id == order_id)
        except ValueError:
            query = query.filter(
                or_(
                    User.full_name.ilike(f"%{search_term}%"),
                    User.email.ilike(f"%{search_term}%"),
                    Order.recipient_name.ilike(f"%{search_term}%")
                )
            )

    total = query.count()
    orders = (
        query.order_by(Order.created_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return AdminPaginatedOrdersResponse(
        orders=[build_admin_order_response(order) for order in orders],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size
    )


# =====================================
# CHI TIET DON HANG (KHACH HANG)
# =====================================

@router.get("/{order_id}", response_model=OrderResponse)
def get_order_detail(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    order = (
        db.query(Order)
        .options(
            joinedload(Order.items).joinedload(OrderItem.product)
        )
        .filter(Order.id == order_id, Order.user_id == user.id)
        .first()
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Khong tim thay don hang"
        )

    return OrderResponse(
        id=order.id,
        recipient_name=order.recipient_name,
        recipient_phone=order.recipient_phone,
        shipping_address=order.shipping_address,
        total_amount=order.total_amount,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        status=order.status,
        note=order.note,
        created_at=order.created_at,
        items=[build_order_item_response(item) for item in order.items]
    )


# =====================================
# HUY DON HANG (KHACH HANG)
# =====================================

@router.patch("/{order_id}/cancel")
def cancel_order(
    order_id: int,
    data: CancelOrderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    order = (
        db.query(Order)
        .with_for_update()
        .filter(Order.id == order_id, Order.user_id == user.id)
        .first()
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Khong tim thay don hang"
        )

    # Chi cho phep huy khi don hang o trang thai "pending" (Chờ xác nhận)
    if order.status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Chi co the huy don hang o trang thai 'Cho xac nhan'"
        )

    try:
        order.status = "cancelled"
        restore_reserved_inventory(db, order)
        if data.reason:
            note = order.note or ""
            order.note = f"{note}\n[Ly do huy]: {data.reason}".strip()
        db.commit()
        db.refresh(order)

        return {
            "message": "Huy don hang thanh cong",
            "order_id": order.id,
            "status": order.status
        }

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Khong the huy don hang"
        )


# =====================================
# ADMIN: CHI TIET DON HANG
# =====================================
@router.get("/admin/{order_id}", response_model=AdminOrderResponse)
def admin_get_order_detail(
    order_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin)
):
    order = (
        db.query(Order)
        .options(
            joinedload(Order.items).joinedload(OrderItem.product),
            joinedload(Order.user)
        )
        .filter(Order.id == order_id)
        .first()
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Khong tim thay don hang"
        )

    return build_admin_order_response(order)


# =====================================
# ADMIN: CAP NHAT TRANG THAI DON HANG
# =====================================

@router.patch("/admin/{order_id}/status")
def admin_update_order_status(
    order_id: int,
    data: AdminOrderStatusUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin)
):
    order = (
        db.query(Order)
        .with_for_update()
        .filter(Order.id == order_id)
        .first()
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Khong tim thay don hang"
        )

    # Validate status transition
    valid_transitions = {
        "pending": ["confirmed", "cancelled"],
        "confirmed": ["preparing", "cancelled"],
        "preparing": ["shipping", "cancelled"],
        "shipping": ["delivered", "cancelled"],
        "delivered": [],  # Cannot change from delivered
        "cancelled": []   # Cannot change from cancelled
    }

    current_status = order.status
    new_status = data.status

    if new_status not in valid_transitions.get(current_status, []):
        if new_status == current_status:
            return {"message": "Trang thai khong thay doi", "order_id": order.id, "status": order.status}
        raise HTTPException(
            status_code=400,
            detail=f"Khong the chuyen tu '{map_status_to_vietnamese(current_status)}' sang '{map_status_to_vietnamese(new_status)}'"
        )

    try:
        order.status = new_status
        if new_status == "cancelled":
            restore_reserved_inventory(db, order)
        db.commit()
        db.refresh(order)

        return {
            "message": "Cap nhat trang thai thanh cong",
            "order_id": order.id,
            "status": order.status
        }

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Khong the cap nhat trang thai"
        )


# =====================================
# ADMIN: CAP NHAT TRANG THAI THANH TOAN
# =====================================

@router.patch("/admin/{order_id}/payment")
def admin_update_payment_status(
    order_id: int,
    data: AdminPaymentStatusUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin)
):
    order = db.query(Order).filter(Order.id == order_id).first()

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Khong tim thay don hang"
        )

    try:
        order.payment_status = data.payment_status
        db.commit()
        db.refresh(order)

        return {
            "message": "Cap nhat trang thai thanh toan thanh cong",
            "order_id": order.id,
            "payment_status": order.payment_status
        }

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Khong the cap nhat trang thai thanh toan"
        )