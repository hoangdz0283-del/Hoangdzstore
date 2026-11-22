## Cloudflare Pages: static product catalog

The public catalog is exported from the existing MySQL `products` table, selecting
active rows in product-ID order. The exporter only reads MySQL and writes
`data/products.json`; it does not change the schema or database records. It exports
public product fields only. Because the database still contains legacy remote image
URLs, each exported `image` path is taken from the local, product-ID-based image
manifest instead. The backend, users, and orders are never copied to the Pages site.

Run these commands in PowerShell whenever product details or stock change:

```powershell
Set-Location D:\Hoangdz-STORE\backend
.\.venv\Scripts\python.exe -m app.export_products
.\.venv\Scripts\python.exe -m app.export_products --check
Set-Location ..
node scripts\build_pages.mjs
```

The export includes product ID, name, brand, category, description, price,
sale price, local image path, badge, stock, specifications, and active status.
`--check` validates the JSON and verifies every referenced image exists locally.
The Pages build copies only `index.html`, `css/`, `js/`, `assets/`, and `data/` to
`dist/`; it rejects missing image paths and environment files, and does not include
`backend/.env`.

For a local preview after building:

```powershell
python -m http.server 8000 --directory dist
```

In Cloudflare Pages, connect the repository with root directory `.`, build command
`node scripts/build_pages.mjs`, and build output directory `dist`. For a direct
upload, upload the contents of `dist/` only. After deployment, verify that
`/data/products.json` returns 34 product records and that `assets/images/` files
load. Re-export and redeploy after catalog updates; the published JSON is public,
including its prices, stock, and specifications.

Product browsing no longer calls the local backend. Login, checkout, order
management, and chatbot remain backend-dependent and still use the existing API
base URL; those features require a separately hosted public HTTPS backend to work
for Cloudflare visitors while the personal computer is off.

## Chatbot AI (Phase 8)

The chatbot uses the OpenAI Chat Completions API through the FastAPI backend. It is
disabled until `OPENAI_API_KEY` is configured; without a key, the status endpoint
reports that AI is unavailable and chat requests return HTTP 503 rather than a
simulated answer.

1. Keep the existing database settings in `backend/.env`.
2. Add `OPENAI_API_KEY` and, optionally, `OPENAI_MODEL` using
   [`backend/.env.example`](./backend/.env.example) as a template. Never commit the
   actual key.
3. Restart the backend on port `8001`, then check `GET /api/chatbot/status`.
   Set `CORS_ORIGINS` to the exact comma-separated frontend origins in deployments;
   wildcard origins are rejected. Local development defaults include ports 5500,
   8000, and 8765.

The recommendation prompt receives active product IDs, names, brands, categories,
prices, stock counts, and product specifications from the current database. The
customer's question and up to eight earlier customer messages are sent to the
configured AI provider; order records and account data are not included. Order
lookup is a separate authenticated endpoint and only returns orders owned by the
signed-in customer.

Chat requests are limited to 10 per minute per client IP and signed-in account in
each backend process. This in-memory limit is suitable for the current single-process
setup; a multi-worker deployment should use a shared rate-limit store.