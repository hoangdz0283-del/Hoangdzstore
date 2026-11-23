#!/usr/bin/env python3
"""Generate a one-time D1 password-reset token for an explicitly selected user."""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True, type=int)
    parser.add_argument("--output", required=True, help="Private SQL file path outside the project")
    args = parser.parse_args()
    if args.user_id <= 0:
        parser.error("--user-id must be positive")

    output = Path(args.output).expanduser().resolve()
    try:
        output.relative_to(ROOT)
    except ValueError:
        pass
    else:
        print("Từ chối ghi token vào thư mục dự án.", file=sys.stderr)
        raise SystemExit(1)
    if output.exists():
        print("File đích đã tồn tại; chọn một đường dẫn mới.", file=sys.stderr)
        raise SystemExit(1)

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = int(time.time() * 1000) + 24 * 60 * 60 * 1000
    sql = (
        "-- Private one-time password reset. Apply only to the intended D1 database.\n"
        "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at) "
        f"VALUES ('{token_hash}', {args.user_id}, {expires_at}, NULL);\n"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(sql, encoding="utf-8", newline="\n")
    try:
        os.chmod(output, 0o600)
    except OSError:
        pass
    print(f"One-time reset token (expires in 24 hours): {token}")
    print("Copy it privately; it cannot be recovered from D1 after this command.")
    print("The SQL file contains only a SHA-256 token hash; keep it private as well.")


if __name__ == "__main__":
    main()
