import argparse
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Product


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "data" / "products.json"
IMAGE_MANIFEST_PATH = PROJECT_ROOT / "assets" / "images" / "manifest.js"
PUBLIC_FIELDS = (
    "id",
    "name",
    "brand",
    "category",
    "description",
    "price",
    "sale_price",
    "image",
    "badge",
    "stock",
    "specifications",
    "is_active",
)


def load_image_manifest(manifest_path: Path = IMAGE_MANIFEST_PATH) -> dict[str, Any]:
    contents = manifest_path.read_text(encoding="utf-8")
    prefix = "window.HOANGDZ_IMAGE_MANIFEST ="
    if not contents.startswith(prefix):
        raise ValueError(f"Image manifest has an unexpected format: {manifest_path}")

    manifest_json = contents[len(prefix):].strip()
    if manifest_json.endswith(";"):
        manifest_json = manifest_json[:-1].rstrip()
    manifest = json.loads(manifest_json)
    if not isinstance(manifest, dict):
        raise ValueError("Image manifest must contain a JSON object")
    return manifest


def exact_case_file_exists(root: Path, relative_path: PurePosixPath) -> bool:
    current_path = root
    try:
        for part in relative_path.parts:
            if part not in {entry.name for entry in current_path.iterdir()}:
                return False
            current_path /= part
    except (FileNotFoundError, NotADirectoryError):
        return False
    return current_path.is_file()


def resolve_local_asset(root: Path, value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None

    normalized = value.strip().replace("\\", "/")
    if urlsplit(normalized).scheme:
        return None

    relative_path = PurePosixPath(normalized)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        return None

    resolved_root = root.resolve()
    candidate = (resolved_root / Path(*relative_path.parts)).resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError:
        return None
    return relative_path.as_posix() if (
        candidate.is_file() and exact_case_file_exists(resolved_root, relative_path)
    ) else None


def resolve_product_image(
    product_id: int,
    manifest: dict[str, Any],
    project_root: Path = PROJECT_ROOT,
) -> str:
    product_record = manifest.get("products", {}).get(str(product_id), {})
    candidates = [
        product_record.get("imagePath"),
        product_record.get("fallbackPath"),
        manifest.get("defaultFallbackPath"),
    ]
    for candidate in candidates:
        local_path = resolve_local_asset(project_root, candidate)
        if local_path:
            return local_path
    raise ValueError(f"No existing local image or fallback for product ID {product_id}")


def serialize_public_product(
    product: Product,
    manifest: dict[str, Any],
    project_root: Path = PROJECT_ROOT,
) -> dict[str, Any]:
    if not product.is_active:
        raise ValueError(f"Refusing to export inactive product ID {product.id}")

    return {
        "id": product.id,
        "name": product.name,
        "brand": product.brand,
        "category": product.category,
        "description": product.description,
        "price": product.price,
        "sale_price": product.sale_price,
        "image": resolve_product_image(product.id, manifest, project_root),
        "badge": product.badge,
        "stock": product.stock,
        "specifications": product.specifications,
        "is_active": True,
    }


def validate_catalog(data: Any, project_root: Path = PROJECT_ROOT) -> int:
    if not isinstance(data, list):
        raise ValueError("Product catalog JSON must be an array")

    seen_ids = set()
    required_fields = set(PUBLIC_FIELDS)
    for index, product in enumerate(data):
        if not isinstance(product, dict):
            raise ValueError(f"Catalog entry {index} must be an object")
        missing_fields = required_fields - product.keys()
        if missing_fields:
            raise ValueError(
                f"Catalog entry {index} is missing fields: {', '.join(sorted(missing_fields))}"
            )
        unexpected_fields = product.keys() - required_fields
        if unexpected_fields:
            raise ValueError(
                f"Catalog entry {index} contains non-public fields: "
                f"{', '.join(sorted(unexpected_fields))}"
            )
        product_id = product["id"]
        if not isinstance(product_id, int) or product_id <= 0 or product_id in seen_ids:
            raise ValueError(f"Catalog entry {index} has an invalid or duplicate product ID")
        seen_ids.add(product_id)
        if not isinstance(product["name"], str) or not product["name"].strip():
            raise ValueError(f"Product ID {product_id} has no name")
        if not isinstance(product["price"], int) or product["price"] <= 0:
            raise ValueError(f"Product ID {product_id} has an invalid price")
        if not isinstance(product["stock"], int) or product["stock"] < 0:
            raise ValueError(f"Product ID {product_id} has invalid stock")
        if not resolve_local_asset(project_root, product["image"]):
            raise ValueError(f"Product ID {product_id} has a missing or non-local image path")

    return len(data)


def write_catalog_atomically(output_path: Path, data: list[dict[str, Any]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(data, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
        os.replace(temporary_path, output_path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def export_products(
    output_path: Path = DEFAULT_OUTPUT_PATH,
    project_root: Path = PROJECT_ROOT,
    session_factory=SessionLocal,
) -> int:
    manifest = load_image_manifest(project_root / "assets" / "images" / "manifest.js")
    session: Session = session_factory()
    try:
        products = (
            session.query(Product)
            .filter(Product.is_active.is_(True))
            .order_by(Product.id)
            .all()
        )
        catalog = [
            serialize_public_product(product, manifest, project_root)
            for product in products
        ]
        validate_catalog(catalog, project_root)
        write_catalog_atomically(output_path, catalog)
    finally:
        session.close()
    return len(catalog)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export active public products to the Cloudflare Pages JSON catalog."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Output JSON path (default: data/products.json at the project root)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the existing JSON catalog and its local image paths without querying MySQL",
    )
    arguments = parser.parse_args()
    output_path = arguments.output.resolve()

    if arguments.check:
        with output_path.open("r", encoding="utf-8") as catalog_file:
            count = validate_catalog(json.load(catalog_file))
        print(f"OK: {count} products; all image paths exist locally: {output_path}")
        return

    count = export_products(output_path)
    print(f"Exported {count} active public products: {output_path}")


if __name__ == "__main__":
    main()
