import tempfile
import unittest
from pathlib import Path

from app.export_products import (
    PUBLIC_FIELDS,
    resolve_local_asset,
    resolve_product_image,
    serialize_public_product,
    validate_catalog,
)
from app.models import Product


class ProductExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "assets" / "images").mkdir(parents=True)
        (self.root / "assets" / "images" / "phone.webp").write_bytes(b"image")
        (self.root / "assets" / "images" / "fallback.svg").write_text(
            "<svg></svg>",
            encoding="utf-8",
        )
        self.manifest = {
            "products": {
                "12": {
                    "imagePath": "assets/images/phone.webp",
                    "fallbackPath": "assets/images/fallback.svg",
                }
            },
            "defaultFallbackPath": "assets/images/fallback.svg",
        }
        self.product = Product(
            id=12,
            name="Demo Phone",
            brand="Demo",
            category="phone",
            description="Public description",
            price=1000,
            sale_price=900,
            image="https://old-image.example/phone.jpg",
            badge="New",
            stock=4,
            specifications={"storage": "128GB"},
            is_active=True,
        )

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_export_whitelists_public_fields_and_uses_local_manifest_image(self):
        record = serialize_public_product(self.product, self.manifest, self.root)
        self.assertEqual(set(record), set(PUBLIC_FIELDS))
        self.assertEqual(record["image"], "assets/images/phone.webp")
        self.assertFalse(record["image"].startswith("http"))
        self.assertNotIn("user_id", record)
        self.assertNotIn("password_hash", record)

    def test_missing_primary_image_uses_local_fallback(self):
        self.manifest["products"]["12"]["imagePath"] = "https://example.test/missing.webp"
        self.assertEqual(
            resolve_product_image(12, self.manifest, self.root),
            "assets/images/fallback.svg",
        )

    def test_image_resolver_rejects_paths_outside_the_site_root(self):
        self.assertIsNone(resolve_local_asset(self.root, "../secret.txt"))
        self.assertIsNone(resolve_local_asset(self.root, "https://example.test/image.webp"))
        self.assertIsNone(resolve_local_asset(self.root, "assets/images/Phone.webp"))

    def test_catalog_validation_rejects_duplicate_ids_and_missing_images(self):
        record = serialize_public_product(self.product, self.manifest, self.root)
        with self.assertRaisesRegex(ValueError, "duplicate product ID"):
            validate_catalog([record, record], self.root)

        record["password_hash"] = "must-not-be-exported"
        with self.assertRaisesRegex(ValueError, "non-public fields"):
            validate_catalog([record], self.root)
        del record["password_hash"]

        record["image"] = "assets/images/not-present.webp"
        with self.assertRaisesRegex(ValueError, "missing or non-local image"):
            validate_catalog([record], self.root)

    def test_inactive_products_are_not_exported(self):
        self.product.is_active = False
        with self.assertRaisesRegex(ValueError, "Refusing to export inactive"):
            serialize_public_product(self.product, self.manifest, self.root)


if __name__ == "__main__":
    unittest.main()
