import os
import time

import pandas as pd
import streamlit as st
from dotenv import load_dotenv


class IcebergTableError(RuntimeError):
    pass


def read_config() -> dict[str, str]:
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=False)
    try:
        secrets = st.secrets.to_dict()
    except st.errors.StreamlitSecretNotFoundError:
        secrets = {}

    def get_value(name: str, default: str = "") -> str:
        secret_value = secrets.get(name)
        if secret_value is not None and str(secret_value).strip():
            return str(secret_value).strip()
        return os.getenv(name, default).strip()

    config = {
        "USE_SAMPLE": get_value("USE_SAMPLE", "1"),
        "GROUP_ID": get_value("GROUP_ID", "nhom2") or "nhom2",
        "R2_ACCOUNT_ID": get_value("R2_ACCOUNT_ID"),
        "R2_BUCKET": get_value("R2_BUCKET"),
        "R2_ACCESS_KEY_ID": get_value("R2_ACCESS_KEY_ID"),
        "R2_SECRET_ACCESS_KEY": get_value("R2_SECRET_ACCESS_KEY"),
    }
    if config["USE_SAMPLE"] not in {"0", "1"}:
        raise ValueError("USE_SAMPLE chỉ nhận giá trị 0 hoặc 1.")
    return config


try:
    CONFIG = read_config()
except ValueError as exc:
    st.error(f"Cấu hình không hợp lệ: {exc}")
    st.stop()

ACCOUNT_ID = CONFIG["R2_ACCOUNT_ID"]
BUCKET = CONFIG["R2_BUCKET"]
ACCESS_KEY_ID = CONFIG["R2_ACCESS_KEY_ID"]
SECRET_ACCESS_KEY = CONFIG["R2_SECRET_ACCESS_KEY"]
USE_SAMPLE = CONFIG["USE_SAMPLE"] == "1"
GROUP_ID = CONFIG["GROUP_ID"]
R2_ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

if not USE_SAMPLE:
    missing_config = [
        name
        for name, value in (
            ("R2_ACCOUNT_ID", ACCOUNT_ID),
            ("R2_BUCKET", BUCKET),
            ("R2_ACCESS_KEY_ID", ACCESS_KEY_ID),
            ("R2_SECRET_ACCESS_KEY", SECRET_ACCESS_KEY),
        )
        if not value
    ]
    if missing_config:
        st.error(f"Thiếu cấu hình R2 bắt buộc: {', '.join(missing_config)}.")
        st.stop()


def sample_events(group_id: str) -> pd.DataFrame:
    now_ms = int(time.time() * 1000)
    rows = [
        {"id": group_id, "country": "VN", "device": "ios", "time": now_ms - i * 60_000, "ip": f"10.0.0.{i % 7}"}
        for i in range(40)
    ] + [
        {"id": group_id, "country": "US", "device": "pc", "time": now_ms - i * 90_000, "ip": f"10.0.1.{i % 4}"}
        for i in range(25)
    ] + [
        {"id": group_id, "country": "JP", "device": "android", "time": now_ms - i * 120_000, "ip": f"10.0.2.{i % 3}"}
        for i in range(15)
    ]
    return pd.DataFrame(rows)


def latest_metadata_key(s3) -> str:
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".metadata.json")]
    if not keys:
        raise IcebergTableError(
            f"Không tìm thấy Iceberg metadata (*.metadata.json) trong bucket '{BUCKET}'."
        )

    table_roots = {
        key.rsplit("/metadata/", 1)[0] if "/metadata/" in key else key.rpartition("/")[0]
        for key in keys
    }
    if len(table_roots) > 1:
        raise IcebergTableError(
            f"Bucket '{BUCKET}' chứa metadata của nhiều bảng Iceberg. "
            "Hãy trỏ R2_BUCKET tới bucket chỉ chứa một bảng."
        )
    return sorted(keys)[-1]


def iceberg_events() -> pd.DataFrame:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
    from pyiceberg.exceptions import ValidationError
    from pyiceberg.table import StaticTable

    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=ACCESS_KEY_ID,
        aws_secret_access_key=SECRET_ACCESS_KEY,
        region_name="auto",
    )
    try:
        table = StaticTable.from_metadata(
            f"s3://{BUCKET}/{latest_metadata_key(s3)}",
            properties={
                "s3.endpoint": R2_ENDPOINT,
                "s3.access-key-id": ACCESS_KEY_ID,
                "s3.secret-access-key": SECRET_ACCESS_KEY,
                "s3.region": "auto",
            },
        )
        required_fields = {"id", "country", "device", "time", "ip"}
        available_fields = {field.name for field in table.schema().fields}
        missing_fields = required_fields - available_fields
        if missing_fields:
            raise IcebergTableError(
                "Iceberg table không đúng schema. Thiếu các cột: "
                f"{', '.join(sorted(missing_fields))}."
            )
        return table.scan(
            selected_fields=("id", "country", "device", "time", "ip")
        ).to_pandas()
    except IcebergTableError:
        raise
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "R2 request failed")
        raise IcebergTableError(
            f"Không thể truy cập dữ liệu R2 (mã lỗi: {error_code}). "
            "Kiểm tra Account ID, endpoint, cặp access key/secret key, bucket "
            "và quyền đọc; credentials không được hiển thị."
        ) from exc
    except BotoCoreError as exc:
        raise IcebergTableError(
            "Không thể kết nối hoặc đọc dữ liệu từ R2. "
            "Kiểm tra endpoint, mạng và quyền đọc; credentials không được hiển thị."
        ) from exc
    except (OSError, KeyError, TypeError, ValueError, ValidationError) as exc:
        raise IcebergTableError(
            "Không thể mở Iceberg table. Metadata có thể sai định dạng hoặc "
            "các file dữ liệu được tham chiếu không đúng cấu trúc."
        ) from exc


@st.cache_data(ttl=300)
def load_events() -> pd.DataFrame:
    df = sample_events(GROUP_ID) if USE_SAMPLE else iceberg_events()
    if pd.api.types.is_numeric_dtype(df["time"]):
        df["time"] = pd.to_datetime(df["time"], unit="ms")
    return df[df["id"].astype(str) == GROUP_ID]


st.set_page_config(page_title="Thống kê truy cập 24h", layout="wide")
st.title("Thống kê truy cập 24h qua")
st.caption(f"Mã nhóm: {GROUP_ID}")
if USE_SAMPLE:
    st.info("Đang dùng dữ liệu mẫu. Đặt USE_SAMPLE=0 để đọc Iceberg.")

try:
    df = load_events()
except IcebergTableError as exc:
    st.error(str(exc))
    st.stop()
now_utc = pd.Timestamp.now(tz="UTC").tz_localize(None)  # time đã là UTC naive
df = df[df["time"] >= now_utc - pd.Timedelta(hours=24)]

c1, c2, c3 = st.columns(3)
c1.metric("Số người truy cập (IP duy nhất)", df["ip"].nunique())
c2.metric("Số quốc gia", df["country"].nunique())
c3.metric("Số lượt xem", len(df))

left, right = st.columns(2)
with left:
    st.subheader("Theo quốc gia")
    st.bar_chart(df["country"].value_counts())
with right:
    st.subheader("Theo thiết bị")
    st.bar_chart(df["device"].value_counts())
