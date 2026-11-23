# Cloudflare Worker + D1 cutover

This adds a separate TypeScript Worker API and D1 migration without replacing the
FastAPI/MySQL backend. The remote D1 database `hoangdzstore-db` has been created
and migration `0001_initial.sql` has been applied. Production Worker
`https://hoangdz-store-api.hoangdz0283.workers.dev` and Pages site
`https://hoangdzstore.pages.dev` are deployed. The original MySQL source
`hoangdz_store` remains unchanged.

## What is implemented

- Worker routes compatible with the current login, profile, checkout, order,
  Admin product/customer/order, and chatbot UI APIs.
- Server-side role checks, exact-origin CORS, prepared D1 statements, auth
  throttling, JWT HS256, one-time checkout keys, and conditional stock updates.
- D1 schema for products, users, orders, order items, reset tokens, and auth
  rate-limit state.
- A read-only MySQL export that emits SQLite/D1 SQL outside the project folder.
- A one-time reset-token tool for the existing account if legacy bcrypt
  verification exceeds the Cloudflare Free CPU budget.
- The product catalog still loads from `data/products.json`; after configuring a
  Worker URL, live product prices and inventory are refreshed from D1 while local
  product-ID image paths remain authoritative.
- An opt-in chatbot fallback that searches active D1 products and answers the
  configured FAQ. Authenticated order lookup is restricted to the order owner.
- A backend-only AI adapter using the Workers AI binding. No API key or AI call
  is exposed to the browser.
- Synthetic Demo analytics stored in an in-memory R2-shaped adapter. It creates
  150 generated users and 500 JSONL events across 90 days; it never binds to or
  writes to an R2 bucket.
- Admin-only synthetic analytics reporting for 24 hours, 7 days, and 90 days.
  Demo orders and products are generated labels/events and are not read from D1.

The production Worker config uses `ANALYTICS_MODE=demo` and has no R2 binding.
No R2 bucket or customer analytics data is needed. The dashboard labels the
report **SYNTHETIC DEMO DATA**. The production Admin check still reads the
signed-in account role from D1.

## Local checks

From `D:\Hoangdz-STORE` in PowerShell:

```powershell
npm install
npm run typecheck
npm run test:api
npm run pages:build
```

For manual local API work, copy `.dev.vars.example` to `.dev.vars`, replace
`SECRET_KEY` with a random value of at least 32 characters, then run:

```powershell
npm run d1:local:migrate
npm run dev:api
```

`wrangler.jsonc` points to the existing remote D1 database `hoangdzstore-db`
with binding `DB`. The initial schema migration is already applied remotely.
The `d1:local:migrate` script targets only Wrangler's local D1 database.
`npm run test:api` uses `wrangler.test.jsonc`, an isolated local D1/R2
configuration that does not initialize the production AI binding.

## B4-B6 configuration

The synthetic analytics Demo requires no R2 bucket and no Workers AI model.
Deployment still requires owner approval; enabling AI remains optional and
requires confirming account access and quota first.

### Synthetic Demo analytics

For the dashboard demo, run `npm run dev:api:demo`. It explicitly runs
Wrangler with `--local` and `wrangler.dev.jsonc`, uses a local D1 database, and
sets `ANALYTICS_MODE=demo`. Production `wrangler.jsonc` uses the same mode and
does not declare an R2 binding. Demo Storage simulates R2-style `put`, `get`,
`list`, cursors, JSONL objects, and injected errors entirely in memory. Each
report is synthesized from 150 generated anonymous users and 500 events across
90 days. Its event types include page views, product views, searches, cart
additions, checkout starts, orders, and chatbot interactions.

The Demo endpoint has separate 24h, 7d, and 90d windows. The Admin API still
requires a valid Admin user in D1; synthetic identities, events, product names,
and orders are never inserted into D1 or mixed with real order data. The
dashboard explicitly shows **SYNTHETIC DEMO DATA**. Visitor event intake is
rejected while Demo mode is active. No R2 bucket is configured, required, or
contacted.

For a local frontend, build with `npm run pages:build` and serve `dist/` at
`http://localhost:5500`:

```powershell
npm run pages:build
python -m http.server 5500 --directory dist
```

`js/config.js` selects the local Worker only for `localhost` and
`127.0.0.1`; public hostnames continue to select the production Worker URL. The
local API needs a private `.dev.vars` signing key and a prepared local D1 schema
with an authorized Admin. This work did not run migrations or create an Admin.
`wrangler.dev.jsonc` and `.dev.vars.example` allow exactly
`http://localhost:5500` and `http://127.0.0.1:5500`; the production
`wrangler.jsonc` keeps only `https://hoangdzstore.pages.dev`.

The Demo Storage adapter keeps JSONL objects under R2-shaped date/hour keys in
memory only. Generated records contain no email, phone, passwords, tokens,
payment data, customer IDs, or real order details. `npm run test:api` uses an
isolated test environment; any local storage fixtures are not connected to a
Cloudflare R2 bucket.

### Workers AI chatbot

The `AI` binding is declared in `wrangler.jsonc`. The Worker is the only
component that can invoke Workers AI; the browser never calls an AI endpoint
directly. There is no OpenAI-compatible provider, API key, or external AI
service in this implementation.

`AI_PROVIDER=workers-ai` is configured, but `AI_MODEL` is intentionally unset.
The read-only Wrangler command `npx wrangler ai models list --json --search
gemma` confirmed that `@cf/aisingapore/gemma-sea-lion-v4-27b-it` is currently
in Cloudflare's Text Generation catalog. It is the recommended candidate
because SEA-LION is tuned for Southeast Asian languages, making it a better
catalog match for Vietnamese chat than the previously considered Llama 3.2 3B
(which did not appear in the current Wrangler catalog search). Cloudflare's
pricing page gives this model's rate as 31,876 Neurons per million input tokens
and 50,488 per million output tokens. Workers Free includes 10,000 Neurons per
day; the model is not in Cloudflare's named paid-only model list. On Workers
Free, requests beyond the daily allocation fail; on Workers Paid, usage beyond
the allocation can be billed.

The public catalog and free allocation do **not** verify model access, account
plan, or remaining quota for this specific Cloudflare account. No inference has
been run because it would consume Neurons and could incur charges on a Paid
account. Therefore `AI_MODEL` remains unset and the active chatbot stays on
FAQ/D1 fallback until the account owner confirms the plan and quota.

Before enabling inference, check the Workers AI model catalog and current
Neuron usage in the Cloudflare dashboard, and confirm the account is on Workers
Free. Then configure the non-secret variable `AI_MODEL` as
`@cf/aisingapore/gemma-sea-lion-v4-27b-it` for the Worker environment (and in
`wrangler.jsonc` if that file is the deployment source of truth). Keep
`AI_PROVIDER=workers-ai` and the existing `AI` binding. Do not switch to a Paid
plan or configure this model if the account plan could result in paid usage.
No API key or secret is required.

Product name, current price, stock, description, and structured specifications
are searched and rendered from D1. For recommendations, AI receives a bounded
list of D1 candidates and may return only candidate product IDs; the Worker
validates those IDs and renders all product facts from D1. Price/specification
questions, policies, and order lookups stay on deterministic D1/FAQ or
authenticated owner-scoped paths. Unspecified warranty, shipping, and return
terms are explicitly reported as not configured.

A chatbot request is limited to 1,200 characters, sends a single user turn
without history, caps output at 180 tokens (80 for product selection), and
aborts after 8 seconds. AI timeout, quota, model, invalid-output, and provider
errors fall back to FAQ/D1. The browser does not call Workers AI. The input
remains available when AI is unconfigured. Tests mock the Workers AI binding;
they do not call a real model.

### Admin analytics

`GET /api/admin/analytics?range=24h|7d|90d` requires an Admin bearer token; the
Worker returns 403 to a customer. Time bounds are rolling durations and display
groups use `Asia/Ho_Chi_Minh`. The endpoint lists at most 500 R2 objects per
request, returns only anonymized event summaries and a continuation cursor, and
reads order timestamps/counts from D1 with a 1,000-row cap for the chart series.
The response includes `data_mode`; the dashboard labels Demo, local R2 test, or
production R2/D1 data instead of presenting generated events as customer
activity. Demo order counts come only from synthetic `order_created` events and
never query production D1 orders.
The dashboard's **Tải thêm dữ liệu** button continues R2 pagination. It displays
visits, active users, product views, searches, cart additions, D1 orders, and
chatbot interactions in the chart. Empty ranges render zeroes instead of sample
data, and the dashboard warns if the D1 chart series reaches its 1,000-row cap.
The anonymous event intake endpoint is separate; only the Admin report API is
restricted to Admin users.

The `users.role` column defaults to `customer`, registration explicitly writes
`customer`, and every Admin route verifies the signed-in user's current database
role on the backend. No Admin account is created automatically. If the owner
later approves initial Admin provisioning, they must privately identify one
specific account and authorize a single conditional role update for that ID;
verify exactly one row changed, then have that user sign in again. Never
promote accounts in bulk or expose account identifiers in public logs. No role
change was made during this work.

## Existing remote D1

The remote D1 database is named `hoangdzstore-db`, uses Worker binding `DB`, and
already has migration `0001_initial.sql` applied. Do not create another database
or rerun the initial migration. Use `hoangdzstore-db` (or its configured database
ID) for remote D1 commands. This is separate from the unchanged MySQL source
database named `hoangdz_store`.

## Export and import the existing MySQL data

The exporter reads only the MySQL source database `hoangdz_store` using the
connection settings already in `backend/.env`; it starts a MySQL read-only
transaction and sends no data-changing SQL. Its destination is the separate
Cloudflare D1 database `hoangdzstore-db`. It exports the four existing tables
with IDs, password hashes, timestamps, JSON specifications, order states, and
foreign keys. Output contains customer data and password hashes, so it refuses
paths inside the repository.

```powershell
$privateDir = Join-Path $env:USERPROFILE "hoangdz-store-private"
$exportFile = Join-Path $privateDir "hoangdz_store_mysql_export.sql"
& .\backend\.venv\Scripts\python.exe .\scripts\export_mysql_to_d1.py --output $exportFile
```

Review only the printed record counts. Do not open the SQL in a shared editor,
commit it, copy it into `dist/`, or upload it to GitHub. Before importing, use
read-only count queries to confirm the four application tables in the already
migrated D1 are empty; stop if any contain rows. Import exactly once:

```powershell
wrangler d1 execute hoangdzstore-db --remote --file $exportFile
```

Verify counts without printing customer rows or hashes:

```powershell
wrangler d1 execute hoangdzstore-db --remote --command "SELECT 'products' AS table_name, COUNT(*) AS row_count FROM products UNION ALL SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'orders', COUNT(*) FROM orders UNION ALL SELECT 'order_items', COUNT(*) FROM order_items"
wrangler d1 execute hoangdzstore-db --remote --command "SELECT id, status, payment_status FROM orders WHERE id = 2"
```

For the currently audited source, expected counts are 34 products, 1 user, 2
orders, and 2 order items; order #2 must still exist. Keep the original MySQL
database as an offline backup. Do not rerun an import into a non-empty D1
database: inserts intentionally fail on duplicate IDs rather than overwrite data.

The only existing MySQL account is ID 1 with role `customer`; the source has no
Admin account. No role is changed by the importer. After confirming that this
account belongs to the store owner, the owner must explicitly grant Admin in D1
before using the dashboard:

```powershell
wrangler d1 execute hoangdzstore-db --remote --command "UPDATE users SET role='admin' WHERE id=1 AND role='customer'"
```

This is a D1-only account-role change; it does not modify MySQL. Do not run it
until the account owner has been verified.

The export file is sensitive and should be retained only as long as needed for a
verified migration. Delete only the exact private export file when finished.

## Secrets, Worker URL, and Pages

For a new environment only, create a random JWT signing key and set it as a Worker
secret. The current production Worker already has `SECRET_KEY`; do not rotate it
without planning for active-token invalidation. Never paste the value into source
files, Pages variables, or Git:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
wrangler secret put SECRET_KEY
```

When prompted, paste the generated value. `CORS_ORIGINS` in `wrangler.jsonc`
contains the exact Pages origin and no wildcard. Production Pages and Worker are
deployed and verified with synthetic auth data. Existing customer credentials
were not used; the included local API suite covers legacy bcrypt verification.
Do not lower the bcrypt work factor or reset a customer's password as part of
routine testing.

If existing bcrypt verification is rejected for CPU use, do not reduce its work
factor. Generate an owner-controlled, one-time reset token and SQL file outside
the repository; `user-id` is the existing account ID:

```powershell
$resetSql = Join-Path $privateDir "legacy-reset.sql"
& .\backend\.venv\Scripts\python.exe .\scripts\issue_legacy_password_reset.py --user-id 1 --output $resetSql
wrangler d1 execute hoangdzstore-db --remote --file $resetSql
```

Keep the token printed by the tool private. Submit it once to the deployed Worker
with the existing account email and a new strong password:

```powershell
$body = @{
  email = "ACCOUNT_EMAIL"
  token = "ONE_TIME_TOKEN"
  new_password = "NEW_STRONG_PASSWORD"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://WORKER_URL/api/auth/reset-legacy-password" -ContentType "application/json" -Body $body
```

The token is scoped to the selected ID, expires after 24 hours, is stored hashed,
and is consumed once. Do not place account values in GitHub issues or public logs.

The production Worker is deployed at
`https://hoangdz-store-api.hoangdz0283.workers.dev`. To deploy a future Worker
update after validation, run:

```powershell
npm run deploy:api
```

`js/config.js` is configured with that exact Worker URL:

```js
window.HOANGDZ_API_BASE_URL = "https://hoangdz-store-api.hoangdz0283.workers.dev";
```

Then run:

```powershell
npm run typecheck
npm run test:api
npm run pages:build
```

To build and redeploy Pages after validation:

```powershell
npm run pages:build
npx wrangler pages deploy dist --project-name=hoangdzstore
```

For GitHub-connected Pages, configure root directory `.`, build command
`node scripts/build_pages.mjs`, and output directory `dist` in the Pages
dashboard, then push reviewed source changes to the deployment branch. The
static product JSON remains public; it contains the store's public product
fields, not account or order data.

The root `wrangler.jsonc` is specifically the Worker API configuration: it has
`main`, D1, and Workers AI bindings, but no R2 binding. Do not add
`pages_build_output_dir` to it:
Wrangler does not allow the Worker `main` field and the Pages output field in the
same config. A warning about the missing Pages field when using
`wrangler pages deploy` means Wrangler found and ignored the Worker config; it
does not invalidate the Git-integration settings or the verified `dist` build.
No Pages-specific Wrangler config is currently used.

## Security and free-tier caveats

- MySQL stays unchanged. There is no automatic sync; Cloudflare D1
  `hoangdzstore-db` is the live API data store after the verified cutover.
- Cloudflare Workers Free currently allows 100,000 requests/day and 10 ms CPU
  per invocation. D1 Free currently allows 5 million rows read/day, 100,000
  rows written/day, 500 MB per database, 5 GB storage per account, and 50 D1
  API queries per Worker invocation. D1 batches count as one API query. Quota
  exhaustion can reject requests; this project does not enable a paid plan.
- PBKDF2-SHA-256 uses the Cloudflare Workers maximum of 100,000 iterations for
  new/reset passwords. The runtime rejects higher iteration counts. Imported
  bcrypt hashes remain supported through bcryptjs and are not rewritten.
- D1 serializes writes per database; checkout reserves stock with a single
  conditional update and creates the order/items in a transactional batch. This
  is not a substitute for running the included concurrent checkout tests.
- JWTs expire after 24 hours. Browser logout removes the stored bearer token;
  there is no server-side revocation list.
- This implementation does not supply an email service, AI API, real-time stock
  push, or payment processor. COD and manual bank transfer are the only payment
  methods.
