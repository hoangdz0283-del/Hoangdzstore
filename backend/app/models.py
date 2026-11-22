
from sqlalchemy import (
    Boolean, Column, Integer, String, BigInteger, Text, JSON,
    DateTime, ForeignKey, func, text
)
from sqlalchemy.orm import relationship
from .database import Base


# =====================================
# 1. SAN PHAM
# =====================================

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False)
    price = Column(BigInteger, nullable=False)
    image = Column(Text, nullable=True)
    badge = Column(String(100), nullable=True)
    brand = Column(String(100), nullable=False, default="Unknown", server_default=text("'Unknown'"))
    description = Column(Text, nullable=True)
    sale_price = Column(BigInteger, nullable=True)
    stock = Column(Integer, nullable=False, default=10, server_default=text("10"))
    specifications = Column(JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("1"))


# =====================================
# 2. TAI KHOAN KHACH HANG
# =====================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=True)
    address = Column(Text, nullable=True)
    role = Column(String(30), nullable=False, default="customer")
    created_at = Column(DateTime, server_default=func.now())

    orders = relationship("Order", back_populates="user")


# =====================================
# 3. DON HANG
# =====================================

class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    recipient_name = Column(String(150), nullable=False)
    recipient_phone = Column(String(20), nullable=False)
    shipping_address = Column(Text, nullable=False)

    total_amount = Column(BigInteger, nullable=False)
    payment_method = Column(String(50), nullable=False, default="cod")
    payment_status = Column(String(30), nullable=False, default="unpaid")
    status = Column(String(30), nullable=False, default="pending")

    note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="orders")
    items = relationship(
        "OrderItem",
        back_populates="order",
        cascade="all, delete-orphan"
    )


# =====================================
# 4. CHI TIET DON HANG
# =====================================

class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id", ondelete="SET NULL"),
        nullable=True
    )

    product_name = Column(String(255), nullable=False)
    unit_price = Column(BigInteger, nullable=False)
    quantity = Column(Integer, nullable=False)
    subtotal = Column(BigInteger, nullable=False)
    stock_deducted = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("0")
    )

    order = relationship("Order", back_populates="items")
    product = relationship("Product")
