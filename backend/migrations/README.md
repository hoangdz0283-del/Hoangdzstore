# Database migrations

Run migrations from the `backend` directory with the project's virtual
environment. Migrations are additive and must not reset or reseed the database.

`add_order_item_stock_deducted.py` adds a non-null `stock_deducted` flag to
`order_items`, defaulting existing rows to `false`. New orders set the flag when
inventory is reserved; cancellation restores inventory only for flagged rows.
The migration is idempotent and preserves existing order and item values.

```powershell
.\.venv\Scripts\python.exe .\migrations\add_order_item_stock_deducted.py
```
