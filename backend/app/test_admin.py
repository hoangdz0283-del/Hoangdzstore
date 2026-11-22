import unittest

from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.admin import (
    AdminCustomerDetailResponse,
    CustomerUpdateRequest,
    ProductStockRequest,
    ProductVisibilityRequest,
    ProductWriteRequest,
    create_product,
    get_customer,
    list_customers,
    list_products,
    router,
    update_customer,
    update_product,
    update_product_stock,
    update_product_visibility,
)
from app.auth import require_admin
from app.main import app
from app.models import Base, Order, Product, User


class AdminManagementTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.admin = User(
            full_name="Store Admin",
            email="admin@example.com",
            password_hash="not-used",
            role="admin",
        )
        self.customer = User(
            full_name="Store Customer",
            email="customer@example.com",
            password_hash="must-not-leak",
            phone="0900000000",
            address="Customer address",
            role="customer",
        )
        self.product = Product(
            name="Test Laptop",
            brand="Test",
            category="laptop",
            description="Test product",
            price=1000,
            stock=5,
            specifications={"memory": "16GB"},
            is_active=True,
        )
        self.session.add_all([self.admin, self.customer, self.product])
        self.session.commit()
        self.order = Order(
            user_id=self.customer.id,
            recipient_name=self.customer.full_name,
            recipient_phone=self.customer.phone,
            shipping_address=self.customer.address,
            total_amount=1000,
            payment_method="cod",
            payment_status="unpaid",
            status="pending",
        )
        self.session.add(self.order)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_admin_dependency_rejects_customer_accounts(self):
        self.assertIs(require_admin(self.admin), self.admin)
        with self.assertRaises(HTTPException) as context:
            require_admin(self.customer)
        self.assertEqual(context.exception.status_code, 403)

    def test_every_management_route_requires_admin(self):
        routes = [route for route in router.routes if isinstance(route, APIRoute)]
        self.assertTrue(routes)
        for route in routes:
            self.assertTrue(
                any(dependency.call is require_admin for dependency in route.dependant.dependencies),
                route.path,
            )

    def test_cors_uses_explicit_origins_without_cookie_credentials(self):
        cors = next(middleware for middleware in app.user_middleware
                    if middleware.cls is CORSMiddleware)
        self.assertNotIn("*", cors.kwargs["allow_origins"])
        self.assertFalse(cors.kwargs["allow_credentials"])
        self.assertIn("http://127.0.0.1:8765", cors.kwargs["allow_origins"])

    def test_product_create_edit_inventory_and_visibility(self):
        payload = ProductWriteRequest(
            name=" New Phone ",
            brand="Example",
            category="phone",
            description="New product",
            price=2000,
            sale_price=1800,
            stock=4,
            specifications={"storage": "256GB"},
            is_active=True,
        )
        created = create_product(payload, self.session, self.admin)
        self.assertEqual(created.name, "New Phone")
        self.assertEqual(created.stock, 4)

        updated = update_product(
            created.id,
            payload.model_copy(update={"price": 2500, "sale_price": 2200}),
            self.session,
            self.admin,
        )
        self.assertEqual(updated.price, 2500)

        updated = update_product_stock(
            created.id,
            ProductStockRequest(stock=0),
            self.session,
            self.admin,
        )
        self.assertEqual(updated.stock, 0)

        updated = update_product_visibility(
            created.id,
            ProductVisibilityRequest(is_active=False),
            self.session,
            self.admin,
        )
        self.assertFalse(updated.is_active)
        self.assertIsNotNone(self.session.get(Product, created.id))

    def test_product_rejects_invalid_sale_price_and_duplicates(self):
        invalid_price = ProductWriteRequest(
            name="Invalid Sale",
            brand="Example",
            category="phone",
            price=1000,
            sale_price=1000,
            stock=1,
        )
        with self.assertRaises(HTTPException) as context:
            create_product(invalid_price, self.session, self.admin)
        self.assertEqual(context.exception.status_code, 422)

        duplicate = ProductWriteRequest(
            name="test laptop",
            brand="TEST",
            category="laptop",
            price=1200,
            stock=1,
        )
        with self.assertRaises(HTTPException) as context:
            create_product(duplicate, self.session, self.admin)
        self.assertEqual(context.exception.status_code, 409)

    def test_customer_list_detail_and_contact_update_exclude_credentials(self):
        page = list_customers(
            search="customer",
            page=1,
            page_size=20,
            db=self.session,
            admin_user=self.admin,
        )
        self.assertEqual(page.total, 1)
        self.assertEqual(page.items[0].order_count, 1)
        self.assertNotIn("password_hash", page.items[0].model_dump())

        detail = get_customer(self.customer.id, self.session, self.admin)
        self.assertIsInstance(detail, AdminCustomerDetailResponse)
        self.assertEqual([item.id for item in detail.orders], [self.order.id])

        updated = update_customer(
            self.customer.id,
            CustomerUpdateRequest(
                full_name="Updated Customer",
                phone="0911111111",
                address="New address",
            ),
            self.session,
            self.admin,
        )
        self.assertEqual(updated.full_name, "Updated Customer")
        self.assertEqual(self.session.get(User, self.customer.id).role, "customer")
        self.assertNotIn("password_hash", updated.model_dump())


if __name__ == "__main__":
    unittest.main()
