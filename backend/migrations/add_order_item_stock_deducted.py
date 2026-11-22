import sys
from pathlib import Path

from sqlalchemy import inspect, text


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.database import engine


def upgrade(target_engine=engine):
    with target_engine.begin() as connection:
        if "order_items" not in inspect(connection).get_table_names():
            raise RuntimeError("The order_items table does not exist.")

        columns = {
            column["name"]
            for column in inspect(connection).get_columns("order_items")
        }
        if "stock_deducted" in columns:
            return False

        connection.execute(text(
            "ALTER TABLE order_items "
            "ADD COLUMN stock_deducted BOOLEAN NOT NULL DEFAULT 0"
        ))

    return True


if __name__ == "__main__":
    applied = upgrade()
    print("Added order_items.stock_deducted." if applied else "Migration already applied.")
