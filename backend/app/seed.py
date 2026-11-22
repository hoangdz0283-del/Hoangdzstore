import json
import re
import unicodedata

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import Product


TARGET_BRAND_COUNTS = {
    "Apple": 8,
    "Samsung": 7,
    "ASUS": 6,
    "LG": 5,
    "Lenovo": 6,
}


SCHEMA_ADDITIONS = {
    "brand": "VARCHAR(100) NOT NULL DEFAULT 'Unknown'",
    "description": "TEXT NULL",
    "sale_price": "BIGINT NULL",
    "stock": "INT NOT NULL DEFAULT 10",
    "specifications": "JSON NULL",
    "is_active": "BOOLEAN NOT NULL DEFAULT 1",
}


LEGACY_METADATA = {
    1: {
        "name": "iPhone 16 Pro Max",
        "brand": "Apple",
        "description": "Điện thoại cao cấp Apple iPhone 16 Pro Max. Dung lượng bộ nhớ chưa được ghi trong danh mục cũ.",
        "specifications": {
            "model": "iPhone 16 Pro Max",
            "chip": "Apple A18 Pro",
            "display": "Super Retina XDR",
            "storage": "Chưa có trong dữ liệu cũ",
        },
    },
    2: {
        "name": "MacBook Pro M4",
        "brand": "Apple",
        "description": "Laptop Apple MacBook Pro dùng chip M4. Cấu hình bộ nhớ và kích thước màn hình chưa được ghi trong danh mục cũ.",
        "specifications": {
            "model": "MacBook Pro M4",
            "chip": "Apple M4",
            "display": "Liquid Retina XDR",
            "memory_and_storage": "Chưa có trong dữ liệu cũ",
        },
    },
    3: {
        "name": "AirPods Pro",
        "brand": "Apple",
        "description": "Tai nghe không dây Apple AirPods Pro; thế hệ cụ thể chưa được ghi trong danh mục cũ.",
        "specifications": {
            "model": "AirPods Pro",
            "brand": "Apple",
            "noise_control": "Active noise cancellation",
            "generation": "Chưa có trong dữ liệu cũ",
        },
    },
    4: {
        "name": "iPad Pro",
        "brand": "Apple",
        "description": "Máy tính bảng Apple iPad Pro. Thế hệ, kích thước màn hình và dung lượng chưa được ghi trong danh mục cũ.",
        "specifications": {
            "model": "iPad Pro",
            "brand": "Apple",
            "generation": "Chưa có trong dữ liệu cũ",
            "display_size_and_storage": "Chưa có trong dữ liệu cũ",
        },
    },
    5: {
        "name": "MacBook Air M3",
        "brand": "Apple",
        "description": "Laptop Apple MacBook Air dùng chip M3. Cấu hình bộ nhớ và kích thước màn hình chưa được ghi trong danh mục cũ.",
        "specifications": {
            "model": "MacBook Air M3",
            "chip": "Apple M3",
            "memory_and_storage": "Chưa có trong dữ liệu cũ",
            "display_size": "Chưa có trong dữ liệu cũ",
        },
    },
    6: {
        "name": "Tai nghe Sony",
        "brand": "Sony",
        "description": "Tai nghe Sony; mã sản phẩm và thông số chi tiết chưa được ghi trong danh mục cũ.",
        "specifications": {
            "brand": "Sony",
            "model": "Chưa có trong dữ liệu cũ",
            "connectivity_and_audio_features": "Chưa có trong dữ liệu cũ",
        },
    },
    7: {
        "name": "Apple Watch",
        "brand": "Apple",
        "description": "Dòng đồng hồ thông minh Apple Watch. Thế hệ, kích thước và cấu hình chưa được ghi trong danh mục cũ.",
        "specifications": {
            "brand": "Apple",
            "model_and_generation": "Chưa có trong dữ liệu cũ",
            "case_size_and_connectivity": "Chưa có trong dữ liệu cũ",
        },
    },
    8: {
        "name": "Sạc không dây",
        "brand": "Chưa xác định",
        "description": "Đế sạc không dây; thương hiệu và thông số công suất chưa được ghi trong danh mục cũ.",
        "specifications": {
            "brand": "Unknown",
            "model": "Chưa có trong dữ liệu cũ",
            "charging_standard_and_power": "Chưa có trong dữ liệu cũ",
        },
    },
}


def _image(photo_id):
    return f"https://images.unsplash.com/{photo_id}?w=600&q=85"


def _product(
    brand,
    name,
    category,
    price,
    photo_id,
    stock,
    description,
    specifications,
    badge=None,
    sale_price=None,
):
    return {
        "brand": brand,
        "name": name,
        "category": category,
        "price": price,
        "sale_price": sale_price,
        "image": _image(photo_id),
        "badge": badge,
        "description": description,
        "stock": stock,
        "specifications": specifications,
        "is_active": True,
    }


NEW_PRODUCTS = [
    _product(
        "Apple", "iPhone 16 128GB", "phone", 21990000,
        "photo-1511707171634-5f897ff02aa9", 14,
        "Điện thoại Apple iPhone 16 với chip A18, camera Fusion 48MP và nút Camera Control.",
        {"chip": "Apple A18", "display": "6.1-inch Super Retina XDR", "camera": "48MP Fusion", "storage": "128GB"},
        "Mới", 20990000,
    ),
    _product(
        "Apple", "Mac mini M4 16GB/256GB", "laptop", 17990000,
        "photo-1498050108023-c5249f4df085", 8,
        "Máy tính để bàn nhỏ gọn Apple Mac mini với chip M4, bộ nhớ hợp nhất 16GB và SSD 256GB.",
        {"chip": "Apple M4", "memory": "16GB unified memory", "storage": "256GB SSD", "ports": "Thunderbolt, HDMI, USB-C"},
        "Nổi bật",
    ),
    _product(
        "Samsung", "Galaxy S25 Ultra 256GB", "phone", 33990000,
        "photo-1592750475338-74b7b21085ab", 9,
        "Điện thoại Samsung Galaxy S25 Ultra với S Pen, camera 200MP và màn hình Dynamic AMOLED 2X.",
        {"chip": "Snapdragon 8 Elite for Galaxy", "display": "6.9-inch QHD+ Dynamic AMOLED 2X", "camera": "200MP main", "storage": "256GB"},
        "Bán chạy", 31990000,
    ),
    _product(
        "Samsung", "Galaxy S25 256GB", "phone", 25990000,
        "photo-1512499617640-c74ae3a79d37", 13,
        "Điện thoại Samsung Galaxy S25 gọn nhẹ, màn hình AMOLED 120Hz và hệ thống camera đa dụng.",
        {"chip": "Snapdragon 8 Elite for Galaxy", "display": "6.2-inch FHD+ Dynamic AMOLED 2X", "camera": "50MP main", "storage": "256GB"},
        "Mới",
    ),
    _product(
        "Samsung", "Galaxy A56 5G 256GB", "phone", 9990000,
        "photo-1511707171634-5f897ff02aa9", 20,
        "Điện thoại Samsung Galaxy A56 5G với màn hình Super AMOLED lớn và pin dung lượng cao.",
        {"chip": "Exynos 1580", "display": "6.7-inch FHD+ Super AMOLED, 120Hz", "camera": "50MP main", "battery": "5000mAh", "storage": "256GB"},
        "Ưu đãi", 8990000,
    ),
    _product(
        "Samsung", "Galaxy Z Flip6 256GB", "phone", 23990000,
        "photo-1592750475338-74b7b21085ab", 7,
        "Điện thoại gập Samsung Galaxy Z Flip6 với màn hình chính AMOLED và màn hình phụ FlexWindow.",
        {"chip": "Snapdragon 8 Gen 3 for Galaxy", "display": "6.7-inch Dynamic AMOLED 2X", "cover_display": "3.4-inch Super AMOLED", "storage": "256GB"},
        "Nổi bật",
    ),
    _product(
        "Samsung", "Galaxy Tab S10 FE 128GB", "phone", 11990000,
        "photo-1544244015-0df4b3ffc6b0", 11,
        "Máy tính bảng Samsung Galaxy Tab S10 FE kèm bút S Pen, phù hợp học tập và làm việc.",
        {"chip": "Exynos 1580", "display": "10.9-inch LCD, 90Hz", "memory": "8GB RAM", "storage": "128GB", "accessory": "S Pen"},
        "Mới",
    ),
    _product(
        "Samsung", "Galaxy Buds3 Pro", "audio", 5490000,
        "photo-1603351154351-5e2d0600bb77", 18,
        "Tai nghe không dây Samsung Galaxy Buds3 Pro với chống ồn chủ động và hộp sạc USB-C.",
        {"audio": "Two-way speaker", "noise_control": "Adaptive ANC", "codec": "Samsung Seamless Codec", "water_resistance": "IP57"},
        "Hot", 4990000,
    ),
    _product(
        "Samsung", "Galaxy Watch7 44mm", "accessory", 7990000,
        "photo-1523275335684-37898b6baf30", 12,
        "Đồng hồ thông minh Samsung Galaxy Watch7 với theo dõi sức khỏe, GPS và Wear OS.",
        {"chip": "Exynos W1000", "display": "1.5-inch Super AMOLED", "connectivity": "Bluetooth, GPS", "operating_system": "Wear OS"},
        "Mới",
    ),
    _product(
        "ASUS", "Zenbook S 14 UX5406 32GB/1TB", "laptop", 38990000,
        "photo-1496181133206-80ce9b88a853", 5,
        "Laptop ASUS Zenbook S 14 mỏng nhẹ với màn hình OLED và cấu hình Core Ultra 7.",
        {"processor": "Intel Core Ultra 7 258V", "display": "14-inch 3K OLED, 120Hz", "memory": "32GB LPDDR5X", "storage": "1TB SSD"},
        "Nổi bật", 36990000,
    ),
    _product(
        "ASUS", "Vivobook S 14 OLED M5406 16GB/1TB", "laptop", 25990000,
        "photo-1517336714731-489689fd1ca8", 10,
        "Laptop ASUS Vivobook S 14 OLED cho công việc và giải trí với màn hình OLED sắc nét.",
        {"processor": "AMD Ryzen 7 8845HS", "display": "14-inch 3K OLED, 120Hz", "memory": "16GB LPDDR5X", "storage": "1TB SSD"},
        "Ưu đãi",
    ),
    _product(
        "ASUS", "ROG Zephyrus G14 GA403", "laptop", 49990000,
        "photo-1498050108023-c5249f4df085", 4,
        "Laptop gaming ASUS ROG Zephyrus G14 kích thước gọn, màn hình OLED và đồ họa RTX 4060.",
        {"processor": "AMD Ryzen 9 8945HS", "graphics": "NVIDIA GeForce RTX 4060", "display": "14-inch 3K OLED, 120Hz", "memory": "32GB", "storage": "1TB SSD"},
        "Gaming",
    ),
    _product(
        "ASUS", "TUF Gaming A15 FA507 16GB/512GB", "laptop", 29990000,
        "photo-1517336714731-489689fd1ca8", 9,
        "Laptop gaming ASUS TUF Gaming A15 với khung máy bền bỉ, màn hình 144Hz và RTX 4060.",
        {"processor": "AMD Ryzen 7 8845HS", "graphics": "NVIDIA GeForce RTX 4060", "display": "15.6-inch FHD, 144Hz", "memory": "16GB DDR5", "storage": "512GB SSD"},
        "Bán chạy", 27990000,
    ),
    _product(
        "ASUS", "ROG Ally X 2024", "accessory", 24990000,
        "photo-1603302576837-37561b2e2302", 6,
        "Máy chơi game cầm tay ASUS ROG Ally X chạy Windows, dùng APU AMD Ryzen Z1 Extreme.",
        {"processor": "AMD Ryzen Z1 Extreme", "display": "7-inch FHD, 120Hz", "memory": "24GB LPDDR5X", "storage": "1TB SSD", "battery": "80Wh"},
        "Gaming",
    ),
    _product(
        "ASUS", "ProArt Display PA278QV", "accessory", 7490000,
        "photo-1527443224154-c4a3942d3acf", 7,
        "Màn hình ASUS ProArt 27 inch đồ họa với màu sắc chuẩn và chân đế công thái học.",
        {"display": "27-inch IPS, 2560 x 1440", "refresh_rate": "75Hz", "color": "100% sRGB, 100% Rec.709", "ports": "DisplayPort, HDMI, USB hub"},
        "Ưu đãi",
    ),
    _product(
        "LG", "LG gram 14 2024 16GB/512GB", "laptop", 29990000,
        "photo-1496181133206-80ce9b88a853", 6,
        "Laptop LG gram 14 siêu nhẹ với màn hình WUXGA và nền tảng Intel Core Ultra.",
        {"processor": "Intel Core Ultra 5 125H", "display": "14-inch WUXGA IPS", "memory": "16GB LPDDR5", "storage": "512GB SSD"},
        "Nổi bật",
    ),
    _product(
        "LG", "LG UltraGear 27GS75Q-B", "accessory", 8990000,
        "photo-1527443224154-c4a3942d3acf", 8,
        "Màn hình gaming LG UltraGear 27 inch QHD IPS, tần số quét cao và thời gian phản hồi nhanh.",
        {"display": "27-inch QHD IPS, 2560 x 1440", "refresh_rate": "180Hz", "response_time": "1ms GtG", "sync": "AMD FreeSync"},
        "Gaming", 8490000,
    ),
    _product(
        "LG", "LG OLED evo C4 55 inch", "accessory", 39990000,
        "photo-1593359677879-a4bb92f829d1", 3,
        "Smart TV LG OLED evo C4 55 inch với điểm ảnh tự phát sáng, độ phân giải 4K và webOS.",
        {"display": "55-inch OLED evo, 4K UHD", "processor": "alpha 9 AI Processor 4K Gen7", "refresh_rate": "120Hz", "operating_system": "webOS"},
        "Nổi bật", 36990000,
    ),
    _product(
        "LG", "LG XBOOM Go XG2", "audio", 2490000,
        "photo-1608043152269-423dbba4e7e1", 15,
        "Loa Bluetooth di động LG XBOOM Go XG2 nhỏ gọn, chống nước bụi IP67.",
        {"output": "5W", "connectivity": "Bluetooth", "water_resistance": "IP67", "battery_life": "Up to 10 hours"},
        "Mới",
    ),
    _product(
        "LG", "LG gram +view 16MR70", "accessory", 8990000,
        "photo-1527443224154-c4a3942d3acf", 5,
        "Màn hình di động LG gram +view 16 inch, tỷ lệ 16:10 và kết nối USB-C.",
        {"display": "16-inch IPS, 2560 x 1600", "aspect_ratio": "16:10", "connectivity": "USB-C", "weight": "Approx. 670g"},
        "Mới",
    ),
    _product(
        "Lenovo", "ThinkPad X1 Carbon Gen 12 32GB/1TB", "laptop", 44990000,
        "photo-1496181133206-80ce9b88a853", 4,
        "Laptop doanh nghiệp Lenovo ThinkPad X1 Carbon Gen 12 với Intel Core Ultra và bảo mật ThinkShield.",
        {"processor": "Intel Core Ultra 7 155U", "display": "14-inch WUXGA IPS", "memory": "32GB LPDDR5X", "storage": "1TB SSD"},
        "Nổi bật",
    ),
    _product(
        "Lenovo", "Yoga Slim 7x 14Q8X9 16GB/512GB", "laptop", 32990000,
        "photo-1517336714731-489689fd1ca8", 7,
        "Laptop Lenovo Yoga Slim 7x nền tảng Snapdragon X với màn hình OLED và thiết kế mỏng nhẹ.",
        {"processor": "Snapdragon X Elite X1E-78-100", "display": "14.5-inch 3K OLED, 90Hz", "memory": "16GB LPDDR5X", "storage": "512GB SSD"},
        "Mới", 30990000,
    ),
    _product(
        "Lenovo", "LOQ 15AHP9 16GB/512GB", "laptop", 29990000,
        "photo-1498050108023-c5249f4df085", 8,
        "Laptop gaming Lenovo LOQ 15 với AMD Ryzen 7, NVIDIA GeForce RTX 4060 và màn hình 144Hz.",
        {"processor": "AMD Ryzen 7 8845HS", "graphics": "NVIDIA GeForce RTX 4060", "display": "15.6-inch FHD, 144Hz", "memory": "16GB DDR5", "storage": "512GB SSD"},
        "Gaming", 27990000,
    ),
    _product(
        "Lenovo", "Legion Go 8APU1 16GB/512GB", "accessory", 22990000,
        "photo-1603302576837-37561b2e2302", 6,
        "Máy chơi game cầm tay Lenovo Legion Go với màn hình lớn, tay cầm tháo rời và Windows.",
        {"processor": "AMD Ryzen Z1 Extreme", "display": "8.8-inch QHD+, 144Hz", "memory": "16GB LPDDR5X", "storage": "512GB SSD"},
        "Gaming",
    ),
    _product(
        "Lenovo", "IdeaPad Slim 5 14IMH9 16GB/512GB", "laptop", 24990000,
        "photo-1496181133206-80ce9b88a853", 9,
        "Laptop Lenovo IdeaPad Slim 5 14IMH9 cho công việc hằng ngày với Intel Core Ultra và màn hình OLED.",
        {"processor": "Intel Core Ultra 5 125H", "display": "14-inch 2.8K OLED", "memory": "16GB LPDDR5X", "storage": "512GB SSD"},
        "Ưu đãi",
    ),
    _product(
        "Lenovo", "Tab P12 8GB/128GB", "phone", 8990000,
        "photo-1544244015-0df4b3ffc6b0", 12,
        "Máy tính bảng Lenovo Tab P12 với màn hình 3K 12.7 inch và hỗ trợ bút Lenovo Tab Pen Plus.",
        {"processor": "MediaTek Dimensity 7050", "display": "12.7-inch 3K LCD", "memory": "8GB RAM", "storage": "128GB", "battery": "10200mAh"},
        "Mới",
    ),
]


def _normalized_name(name):
    normalized = unicodedata.normalize("NFKC", name).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def ensure_catalog_schema(bind=engine):
    inspector = inspect(bind)
    if "products" not in inspector.get_table_names():
        raise RuntimeError("The products table does not exist; refusing to create or reset tables.")

    existing_columns = {column["name"] for column in inspector.get_columns("products")}
    for column_name, definition in SCHEMA_ADDITIONS.items():
        if column_name in existing_columns:
            continue
        statement = (
            f"ALTER TABLE `products` ADD COLUMN `{column_name}` {definition}"
        )
        with bind.begin() as connection:
            connection.execute(text(statement))
        existing_columns.add(column_name)


def populate_catalog(db: Session):
    existing_products = db.query(Product).order_by(Product.id).all()
    products_by_id = {product.id: product for product in existing_products}

    for product_id, metadata in LEGACY_METADATA.items():
        product = products_by_id.get(product_id)
        if product is None or product.name != metadata["name"]:
            raise RuntimeError(
                f"Legacy product #{product_id} does not match the reviewed inventory."
            )

        if product.brand not in (None, "", "Unknown", metadata["brand"]):
            raise RuntimeError(
                f"Legacy product #{product_id} has an unexpected brand; refusing to overwrite it."
            )
        if not product.brand or product.brand == "Unknown":
            product.brand = metadata["brand"]
        if not product.description:
            product.description = metadata["description"]
        if product.specifications is None:
            product.specifications = metadata["specifications"]
        if product.stock is None:
            product.stock = 10
        if product.is_active is None:
            product.is_active = True

    db.flush()
    existing_products = db.query(Product).order_by(Product.id).all()
    names = {}
    counts = {brand: 0 for brand in TARGET_BRAND_COUNTS}
    for product in existing_products:
        key = _normalized_name(product.name)
        if key in names:
            raise RuntimeError(
                f"Duplicate product name already exists: {product.name!r}."
            )
        names[key] = product
        if product.brand in counts:
            counts[product.brand] += 1

    for brand, target_count in TARGET_BRAND_COUNTS.items():
        if counts[brand] > target_count:
            raise RuntimeError(
                f"{brand} already has {counts[brand]} products; target is {target_count}."
            )

    added = 0
    for item in NEW_PRODUCTS:
        key = _normalized_name(item["name"])
        existing = names.get(key)
        if existing:
            if existing.brand != item["brand"]:
                raise RuntimeError(
                    f"Product name {item['name']!r} already exists under "
                    f"brand {existing.brand!r}; refusing to duplicate it."
                )
            continue
        if counts[item["brand"]] >= TARGET_BRAND_COUNTS[item["brand"]]:
            continue

        product = Product(**item)
        db.add(product)
        names[key] = product
        counts[item["brand"]] += 1
        added += 1

    db.flush()
    actual_counts = {
        brand: db.query(Product).filter(Product.brand == brand).count()
        for brand in TARGET_BRAND_COUNTS
    }
    if actual_counts != TARGET_BRAND_COUNTS:
        raise RuntimeError(
            f"Brand counts do not match requested targets: {actual_counts!r}."
        )

    incomplete = (
        db.query(Product)
        .filter(
            (Product.brand.is_(None))
            | (Product.description.is_(None))
            | (Product.specifications.is_(None))
            | (Product.image.is_(None))
            | (Product.stock.is_(None))
            | (Product.is_active.is_(None))
        )
        .count()
    )
    if incomplete:
        raise RuntimeError(
            f"{incomplete} products are missing required catalog fields."
        )

    summary = {
        "added": added,
        "total": db.query(Product).count(),
        "brand_counts": actual_counts,
    }
    return summary


def main():
    ensure_catalog_schema()
    db = SessionLocal()
    try:
        with db.begin():
            summary = populate_catalog(db)
        print(json.dumps(summary, ensure_ascii=True))
    finally:
        db.close()


if __name__ == "__main__":
    main()
