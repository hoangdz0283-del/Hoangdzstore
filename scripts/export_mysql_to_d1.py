#!/usr/bin/env python3
"""Export the existing MySQL store to private, SQLite-compatible D1 SQL."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pymysql
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_DATABASE = "hoangdz_store"
TABLE_COLUMNS = {
    "products": (
        "id", "name", "category", "price", "image", "badge", "brand",
        "description", "sale_price", "stock", "specifications", "is_active",
    ),
    "users": (
        "id", "full_name", "email", "password_hash", "phone", "address",
        "role", "created_at",
    ),
    "orders": (
        "id", "user_id", "recipient_name", "recipient_phone", "shipping_address",
        "total_amount", "payment_method", "payment_status", "status", "note",
        "created_at",
    ),
    "order_items": (
        "id", "order_id", "product_id", "product_name", "unit_price",
        "quantity", "subtotal", "stock_deducted",
    ),
}


def fail(message: str) -> "NoReturn":
    print(message, file=sys.stderr)
    raise SystemExit(1)


def normalize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        fail("Không thể xuất dữ liệu nhị phân không hỗ trợ.")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def specification_json(value: Any, product_id: int) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            fail(f"Không thể xuất: thông số sản phẩm {product_id} không phải JSON hợp lệ.")
    if not isinstance(value, dict):
        fail(f"Không thể xuất: thông số sản phẩm {product_id} phải là JSON object.")
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sql_literal(value: Any) -> str:
    value = normalize(value)
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        fail("Dữ liệu số thực không được hỗ trợ; dừng để tránh sai lệch.")
    if not isinstance(value, str):
        fail("Gặp kiểu dữ liệu không được hỗ trợ; dừng xuất.")
    return "'" + value.replace("'", "''") + "'"


def validate_relations(rows: dict[str, list[dict[str, Any]]]) -> None:
    user_ids = {row["id"] for row in rows["users"]}
    product_ids = {row["id"] for row in rows["products"]}
    order_ids = {row["id"] for row in rows["orders"]}
    normalized_emails = [str(row["email"]).strip().lower() for row in rows["users"]]
    if len(normalized_emails) != len(set(normalized_emails)):
        fail("Không thể xuất: email trùng sau khi chuẩn hóa chữ hoa/thường.")

    valid_statuses = {"pending", "confirmed", "preparing", "shipping", "delivered", "cancelled"}
    valid_payments = {"unpaid", "paid", "refunded"}
    valid_methods = {"cod", "bank_transfer"}
    for product in rows["products"]:
        for field in ("id", "price", "stock"):
            if not isinstance(product[field], int) or abs(product[field]) > 9_007_199_254_740_991:
                fail(f"Không thể xuất: trường {field} của sản phẩm {product['id']} vượt phạm vi số an toàn.")
        if product["sale_price"] is not None and (
            not isinstance(product["sale_price"], int)
            or abs(product["sale_price"]) > 9_007_199_254_740_991
        ):
            fail(f"Không thể xuất: giá khuyến mãi sản phẩm {product['id']} vượt phạm vi số an toàn.")
    for order in rows["orders"]:
        if order["user_id"] not in user_ids:
            fail(f"Không thể xuất: đơn hàng {order['id']} không có người dùng liên kết.")
        if not isinstance(order["total_amount"], int) or abs(order["total_amount"]) > 9_007_199_254_740_991:
            fail(f"Không thể xuất: tổng tiền đơn hàng {order['id']} vượt phạm vi số an toàn.")
        if order["status"] not in valid_statuses:
            fail(f"Không thể xuất: đơn hàng {order['id']} có trạng thái không được D1 hỗ trợ.")
        if order["payment_status"] not in valid_payments or order["payment_method"] not in valid_methods:
            fail(f"Không thể xuất: đơn hàng {order['id']} có trạng thái/phương thức thanh toán không hợp lệ.")
    for item in rows["order_items"]:
        if item["order_id"] not in order_ids:
            fail(f"Không thể xuất: chi tiết đơn hàng {item['id']} thiếu đơn hàng liên kết.")
        if item["product_id"] is not None and item["product_id"] not in product_ids:
            fail(f"Không thể xuất: chi tiết đơn hàng {item['id']} có product_id không hợp lệ.")
        numeric_values = (item["id"], item["order_id"], item["unit_price"], item["quantity"], item["subtotal"])
        if any(not isinstance(value, int) or abs(value) > 9_007_199_254_740_991 for value in numeric_values):
            fail(f"Không thể xuất: chi tiết đơn hàng {item['id']} vượt phạm vi số an toàn.")
        if item["quantity"] <= 0 or item["unit_price"] < 0 or item["subtotal"] < 0:
            fail(f"Không thể xuất: chi tiết đơn hàng {item['id']} có số tiền/số lượng không hợp lệ.")


def dump_sql(rows: dict[str, list[dict[str, Any]]]) -> str:
    statements = [
        "-- Private data export. Keep outside the repository and never publish.",
        "-- Target schema: workers/migrations/0001_initial.sql",
    ]
    for table in ("products", "users", "orders", "order_items"):
        columns = TABLE_COLUMNS[table]
        for row in rows[table]:
            values = [row[column] for column in columns]
            if table == "products":
                values[columns.index("specifications")] = specification_json(
                    row["specifications"],
                    int(row["id"]),
                )
            if table == "users":
                columns_with_normalized = (*columns[:3], "email_normalized", *columns[3:])
                values = [*values[:3], str(row["email"]).strip().lower(), *values[3:]]
                insert_columns = columns_with_normalized
            else:
                insert_columns = columns
            statements.append(
                f"INSERT INTO {table} ({', '.join(insert_columns)}) VALUES "
                f"({', '.join(sql_literal(value) for value in values)});"
            )
    return "\n".join(statements) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Private SQL file path outside the project")
    parser.add_argument("--force", action="store_true", help="Allow replacing an existing output file")
    args = parser.parse_args()

    output = Path(args.output).expanduser().resolve()
    try:
        output.relative_to(ROOT)
    except ValueError:
        pass
    else:
        fail("Từ chối ghi file export vào thư mục dự án. Hãy chọn thư mục riêng tư bên ngoài repository.")
    if output.exists() and not args.force:
        fail("File đích đã tồn tại. Chọn đường dẫn mới hoặc dùng --force sau khi kiểm tra file.")

    env_file = ROOT / "backend" / ".env"
    if env_file.exists():
        load_dotenv(env_file, override=False)
    database_name = os.getenv("DB_NAME", EXPECTED_DATABASE)
    if database_name != EXPECTED_DATABASE:
        fail(f"DB_NAME phải là {EXPECTED_DATABASE}; không kết nối database khác.")

    connection = None
    try:
        connection = pymysql.connect(
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "root"),
            password=os.getenv("DB_PASSWORD", ""),
            database=database_name,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10,
            read_timeout=60,
            write_timeout=10,
            autocommit=False,
        )
        with connection.cursor() as cursor:
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            connection.begin()
            cursor.execute("SELECT DATABASE() AS selected_database")
            selected_database = cursor.fetchone()["selected_database"]
            if selected_database != EXPECTED_DATABASE:
                fail("MySQL trả về database không khớp; không xuất dữ liệu.")

            rows: dict[str, list[dict[str, Any]]] = {}
            for table, columns in TABLE_COLUMNS.items():
                cursor.execute(f"SELECT {', '.join(columns)} FROM {table} ORDER BY id")
                rows[table] = cursor.fetchall()
            validate_relations(rows)
            sql = dump_sql(rows)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(sql, encoding="utf-8", newline="\n")
            try:
                os.chmod(output, 0o600)
            except OSError:
                pass
            connection.rollback()
    except SystemExit:
        raise
    except Exception as error:
        fail(f"Xuất dữ liệu thất bại ({type(error).__name__}). Không có lệnh ghi nào được gửi tới MySQL.")
    finally:
        if connection is not None:
            connection.close()

    counts = ", ".join(f"{table}={len(rows[table])}" for table in TABLE_COLUMNS)
    print(f"Đã tạo bản xuất riêng tư ({counts}).")
    print("File chứa thông tin cá nhân và password hash; không đưa vào GitHub hoặc thư mục Pages.")


if __name__ == "__main__":
    main()
