import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.database import Base
from app.main import get_products
from app.models import OrderItem, Product, User
from app.orders import (
    CancelOrderRequest,
    CreateOrderRequest,
    OrderItemRequest,
    cancel_order,
    create_order,
    get_effective_unit_price,
)
from app.seed import (
    LEGACY_METADATA,
    NEW_PRODUCTS,
    TARGET_BRAND_COUNTS,
    ensure_catalog_schema,
    populate_catalog,
)


LEGACY_ROWS = [
    (1, "iPhone 16 Pro Max", "phone", 29990000, "image-1", "Bán chạy"),
    (2, "MacBook Pro M4", "laptop", 42990000, "image-2", "Nổi bật"),
    (3, "AirPods Pro", "audio", 5490000, "image-3", "Hot"),
    (4, "iPad Pro", "phone", 24990000, "image-4", "Mới"),
    (5, "MacBook Air M3", "laptop", 26990000, "image-5", "Ưu đãi"),
    (6, "Tai nghe Sony", "audio", 3990000, "image-6", "Bán chạy"),
    (7, "Apple Watch", "accessory", 8990000, "image-7", "Mới"),
    (8, "Sạc không dây", "accessory", 1290000, "image-8", "Giá tốt"),
]


class ProductCatalogTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        with self.engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE products ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "name VARCHAR(255) NOT NULL, "
                "category VARCHAR(100) NOT NULL, "
                "price BIGINT NOT NULL, "
                "image TEXT, "
                "badge VARCHAR(100))"
            ))
            for row in LEGACY_ROWS:
                connection.execute(
                    text(
                        "INSERT INTO products "
                        "(id, name, category, price, image, badge) "
                        "VALUES (:id, :name, :category, :price, :image, :badge)"
                    ),
                    {
                        "id": row[0],
                        "name": row[1],
                        "category": row[2],
                        "price": row[3],
                        "image": row[4],
                        "badge": row[5],
                    },
                )
        self.original_rows = list(LEGACY_ROWS)

    def tearDown(self):
        self.engine.dispose()

    def test_catalog_metadata_and_idempotent_import(self):
        ensure_catalog_schema(self.engine)
        columns = {column["name"] for column in inspect(self.engine).get_columns("products")}
        self.assertTrue({
            "brand",
            "description",
            "sale_price",
            "stock",
            "specifications",
            "is_active",
        }.issubset(columns))

        with Session(self.engine) as session:
            with session.begin():
                first_run = populate_catalog(session)

            self.assertEqual(first_run["added"], 26)
            self.assertEqual(first_run["total"], 34)
            self.assertEqual(first_run["brand_counts"], TARGET_BRAND_COUNTS)

            api_products = get_products(session)
            self.assertEqual(len(api_products), 34)
            api_product = next(item for item in api_products if item["brand"] == "Samsung")
            self.assertEqual(api_product["brand"], "Samsung")
            self.assertIn("specifications", api_product)
            self.assertIn("description", api_product)
            self.assertIn("sale_price", api_product)
            self.assertTrue(api_product["is_active"])

            legacy = (
                session.query(Product)
                .filter(Product.id.in_([row[0] for row in self.original_rows]))
                .order_by(Product.id)
                .all()
            )
            self.assertEqual(
                [
                    (item.id, item.name, item.category, item.price, item.image, item.badge)
                    for item in legacy
                ],
                self.original_rows,
            )
            for item in legacy:
                self.assertEqual(item.brand, LEGACY_METADATA[item.id]["brand"])
                self.assertTrue(item.description)
                self.assertTrue(item.specifications)
                self.assertIsNotNone(item.stock)
                self.assertTrue(item.is_active)

            added_product = session.query(Product).filter_by(name="Galaxy S25 256GB").one()
            added_product.stock = 0
            added_product.is_active = False
            session.commit()

            self.assertNotIn(
                "Galaxy S25 256GB",
                {item["name"] for item in get_products(session)},
            )
            session.rollback()
            with session.begin():
                second_run = populate_catalog(session)

            self.assertEqual(second_run["added"], 0)
            self.assertEqual(second_run["total"], 34)
            self.assertEqual(
                session.query(Product).filter_by(name="Galaxy S25 256GB").one().stock,
                0,
            )

    def test_new_products_are_unique_and_complete(self):
        names = [item["name"].casefold() for item in NEW_PRODUCTS]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(NEW_PRODUCTS), 26)

        counts = {brand: 0 for brand in TARGET_BRAND_COUNTS}
        for item in NEW_PRODUCTS:
            counts[item["brand"]] += 1
            self.assertTrue(item["category"])
            self.assertTrue(item["description"])
            self.assertTrue(item["image"])
            self.assertTrue(item["specifications"])
            self.assertGreaterEqual(item["stock"], 0)
            if item["sale_price"] is not None:
                self.assertGreater(item["sale_price"], 0)
                self.assertLess(item["sale_price"], item["price"])

        self.assertEqual(counts, {
            "Apple": 2,
            "Samsung": 7,
            "ASUS": 6,
            "LG": 5,
            "Lenovo": 6,
        })

    def test_order_price_uses_only_valid_sale_prices(self):
        product = Product(price=1000, sale_price=800)
        self.assertEqual(get_effective_unit_price(product), 800)

        for invalid_sale_price in (None, 0, -1, 1000, 1200):
            product.sale_price = invalid_sale_price
            self.assertEqual(get_effective_unit_price(product), 1000)

    def test_order_creation_persists_discounted_snapshot_in_memory(self):
        ensure_catalog_schema(self.engine)
        with Session(self.engine) as session:
            with session.begin():
                populate_catalog(session)
            Base.metadata.create_all(bind=self.engine)

            sale_product = (
                session.query(Product)
                .filter(Product.sale_price.is_not(None))
                .order_by(Product.id)
                .first()
            )
            sale_product.stock = 10
            user = User(
                full_name="Test Customer",
                email="catalog-order@example.com",
                password_hash="test-hash",
                role="customer",
            )
            session.add(user)
            session.commit()

            quantity = 2
            result = create_order(
                CreateOrderRequest(
                    recipient_name="Test Customer",
                    recipient_phone="0900000000",
                    shipping_address="Test address",
                    items=[
                        OrderItemRequest(
                            product_id=sale_product.id,
                            quantity=quantity,
                        )
                    ],
                ),
                session,
                user,
            )

            self.assertEqual(
                result["total_amount"],
                sale_product.sale_price * quantity,
            )
            order_item = (
                session.query(OrderItem)
                .filter(OrderItem.order_id == result["order_id"])
                .one()
            )
            self.assertEqual(order_item.unit_price, sale_product.sale_price)
            self.assertEqual(order_item.subtotal, sale_product.sale_price * quantity)
            self.assertTrue(order_item.stock_deducted)
            self.assertEqual(sale_product.stock, 10 - quantity)

            cancelled = cancel_order(
                result["order_id"],
                CancelOrderRequest(reason="Test cancellation"),
                session,
                user,
            )
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(sale_product.stock, 10)
            self.assertFalse(order_item.stock_deducted)

    def test_order_rejects_insufficient_stock_without_mutating_inventory(self):
        ensure_catalog_schema(self.engine)
        with Session(self.engine) as session:
            with session.begin():
                populate_catalog(session)
            Base.metadata.create_all(bind=self.engine)

            product = session.query(Product).filter_by(id=1).one()
            product.stock = 1
            user = User(
                full_name="Stock Test",
                email="stock-test@example.com",
                password_hash="test-hash",
                role="customer",
            )
            session.add(user)
            session.commit()

            with self.assertRaises(HTTPException) as context:
                create_order(
                    CreateOrderRequest(
                        recipient_name="Stock Test",
                        recipient_phone="0900000000",
                        shipping_address="Test address",
                        items=[OrderItemRequest(product_id=product.id, quantity=2)],
                    ),
                    session,
                    user,
                )

            self.assertEqual(context.exception.status_code, 409)
            session.refresh(product)
            self.assertEqual(product.stock, 1)
            self.assertEqual(session.query(OrderItem).count(), 0)

    def test_order_rejects_inactive_product(self):
        ensure_catalog_schema(self.engine)
        with Session(self.engine) as session:
            with session.begin():
                populate_catalog(session)
            Base.metadata.create_all(bind=self.engine)

            product = session.query(Product).filter_by(id=1).one()
            product.is_active = False
            user = User(
                full_name="Inactive Test",
                email="inactive-test@example.com",
                password_hash="test-hash",
                role="customer",
            )
            session.add(user)
            session.commit()

            with self.assertRaises(HTTPException) as context:
                create_order(
                    CreateOrderRequest(
                        recipient_name="Inactive Test",
                        recipient_phone="0900000000",
                        shipping_address="Test address",
                        items=[OrderItemRequest(product_id=product.id, quantity=1)],
                    ),
                    session,
                    user,
                )

            self.assertEqual(context.exception.status_code, 404)
            self.assertEqual(session.query(OrderItem).count(), 0)


if __name__ == "__main__":
    unittest.main()
