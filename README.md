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

For a local end-to-end Demo, run the Worker in one terminal:

```powershell
npm run dev:api:demo
```

Build and serve the frontend in another terminal:

```powershell
npm run pages:build
python -m http.server 5500 --directory dist
```

On `localhost` or `127.0.0.1`, `js/config.js` points the browser to the local
Worker at `http://127.0.0.1:8787`; on public Pages it uses the production Worker
URL. Local CORS allows only `http://localhost:5500` and
`http://127.0.0.1:5500`; production CORS allows only the Pages origin. The local
Worker requires a private `.dev.vars` signing key and an initialized local D1
schema/Admin account. No local migration or Admin account was created during
this verification.

In Cloudflare Pages, connect the repository with root directory `.`, build command
`node scripts/build_pages.mjs`, and build output directory `dist`. For a direct
upload, upload the contents of `dist/` only. After deployment, verify that
`/data/products.json` returns 34 product records and that `assets/images/` files
load. Re-export and redeploy after catalog updates; the published JSON is public,
including its prices, stock, and specifications.

Product browsing continues to use the public static catalog. A separate
Cloudflare Worker + D1 backend has been added for login, checkout, order
management, and Admin. The frontend source is configured to use
`https://hoangdz-store-api.hoangdz0283.workers.dev`. The remote D1 database
`hoangdzstore-db` has been created and its initial schema migration applied. The
original MySQL database `hoangdz_store` remains the unchanged source. The Pages
site must be rebuilt and deployed separately before frontend changes in this
worktree become public. See
[`CLOUDFLARE_WORKER.md`](./CLOUDFLARE_WORKER.md) for the safe cutover steps.

## Frontend test status

Status reflects only the evidence recorded here. Automated Worker API tests use
an isolated local D1 database; they do not prove the frontend UI or production
write flows.

| Chức năng | Trạng thái | Kiểu kiểm thử | Bằng chứng / giới hạn |
|---|---|---|---|
| Trang chủ | Đạt | Thủ công, production | `https://hoangdzstore.pages.dev/` tải HTTP 200 và hiển thị đúng tiêu đề. |
| Hiển thị 34 sản phẩm | Đạt | Build tự động + production browser | Pages build xác nhận 34 sản phẩm; production hiển thị 12 ban đầu, “Xem thêm” lên 34; Worker GET trả 34. |
| Tìm kiếm và lọc sản phẩm | Đạt | Thủ công, production + local preview | Production tìm “iPhone 16 Pro Max” trả 1 kết quả; bộ lọc Apple từng trả 8 kết quả trên local preview. |
| Chi tiết sản phẩm | Đạt | Thủ công, local preview | Modal chi tiết mở và hiển thị tên cùng thông số sản phẩm. |
| Giỏ hàng | Đạt | Thủ công, production | Thêm sản phẩm vào giỏ; checkout thành công và giỏ được xóa sau khi Worker xác nhận đơn. |
| Đăng ký | Đạt | Tự động API + production UI | Dữ liệu synthetic `@example.invalid` đăng ký HTTP 201; tài khoản thử đã được xóa. |
| Đăng nhập | Đạt | Tự động API + production UI | Đăng nhập HTTP 200, lấy profile HTTP 200 bằng tài khoản synthetic; không dùng tài khoản khách hàng thật. |
| Đăng xuất | Đạt | Thủ công, production UI | Đăng xuất thành công và token bị xóa khỏi localStorage. |
| Đặt hàng | Đạt | API tests + production UI | Đơn COD thử HTTP 201, được hủy ngay; stock sản phẩm trở lại giá trị ban đầu và đơn thử đã được xóa. |
| Lịch sử đơn hàng | Đạt | API tests + production UI | Đơn thử hiện trong lịch sử; chi tiết sản phẩm/người nhận hiển thị; trạng thái hủy được xác nhận trước khi dọn dữ liệu. |
| Trang quản trị | Chưa hoạt động production | API tests + read-only production check | Worker production hiện trả 404 cho `/api/admin/analytics`; source test cục bộ xác nhận 401 khi chưa đăng nhập và 403 với customer. Không tạo Admin hoặc đổi role. |
| Kết nối Cloudflare Worker API | Đạt | Tự động + thủ công, chỉ đọc | Pages production tải `js/config.js` trước `js/app.js`; browser ghi nhận GET `/api/products` tới Worker đúng URL, không lỗi. Worker health HTTP 200, preflight HTTP 204, phản hồi lỗi auth giữ đúng CORS; sản phẩm API trả 34 mục. |
| B4 chatbot FAQ/sản phẩm/đơn hàng | Đạt cục bộ; production chưa bật | Worker API tests + public status GET | Source có FAQ/D1 và tra cứu đơn theo chủ sở hữu; Worker production hiện trả `available:false`. |
| B4 kết nối AI | Chưa bật model | Wrangler catalog, chưa inference | Binding có trong source; `@cf/aisingapore/gemma-sea-lion-v4-27b-it` hiện có trong catalog và được đề xuất cho tiếng Việt/Đông Nam Á. Quyền/quota tài khoản chưa xác minh; `AI_MODEL` để trống, inference chưa chạy. |
| B5 sự kiện R2 + đồng ý analytics | Đạt cục bộ | Worker API tests + Pages build | Synthetic JSONL 90 ngày, R2 mock put/get/list/lỗi và R2 local đã qua test. Production R2/API chưa xác minh; không ghi production. |
| B6 phân tích Admin | Đạt cục bộ; production API chưa có | Worker API tests + Pages build + public GET | Source kiểm tra Admin, các khoảng thời gian GMT+7 và dữ liệu rỗng; dashboard có 7 chuỗi biểu đồ và nhãn Demo/Production. Worker production hiện trả 404 cho analytics. |

Worker và Pages đã được deploy trong các phiên trước; thay đổi B4-B6 ở source
hiện tại chưa được deploy. Bộ test local mới nhất có 35 API tests và dùng D1/R2
cô lập. Auth và checkout production từng được kiểm tra bằng dữ liệu synthetic
riêng; tài khoản/đơn thử đã được dọn ở phiên trước.

Counts D1 thay đổi trong lúc kiểm thử production của phiên trước so với
baseline; các marker của tài khoản và đơn thử đều bằng 0 sau cleanup. Không xóa
các hàng không có marker thử nghiệm, vì có thể là hoạt động production đồng
thời. Thay đổi B4-B6 hiện tại không ghi D1/MySQL production và không deploy.

## B4-B6 local implementation status

The current source adds a fallback chatbot backed by FAQ configuration and live
D1 product search, including structured product specifications. Customer order
lookup checks ownership in the Worker. Product recommendations can use Workers
AI to select only product IDs already returned from D1; the Worker renders all
names, prices, stock, and specifications from D1. Without a selected Workers AI model, the UI explicitly says
“Chưa kết nối AI, đang dùng tìm kiếm và FAQ”; it does not claim to use AI.
The backend uses only the Workers AI binding `AI`; `AI_MODEL` is unset, and no
inference has been made. Wrangler's read-only catalog list found
`@cf/aisingapore/gemma-sea-lion-v4-27b-it`; the free allocation and model
pricing are documented, but account entitlement and plan-specific billing are
not verified. The owner must verify plan and quota before setting a model.
Setup is documented in
[`CLOUDFLARE_WORKER.md`](./CLOUDFLARE_WORKER.md). Product, price, inventory,
policy, and order facts stay on deterministic FAQ/D1/authenticated paths
instead of being generated by AI.

Analytics B5/B6 now use synthetic Demo data only. The Worker builds an
in-memory R2-shaped Demo Storage containing 150 generated users and 500 JSONL
events across 90 days, including page/product views, searches, cart additions,
checkout starts, orders, and chatbot interactions. Production
`wrangler.jsonc` sets `ANALYTICS_MODE=demo` and has no R2 binding; Demo reports
do not read or write analytics events, products, or orders in D1. The dashboard
shows **SYNTHETIC DEMO DATA** and its Admin API still checks the account role in
D1. Demo event intake is rejected. Tests use isolated local storage bindings
and in-memory adapters only; no real R2 bucket is required or contacted.

The latest local suite covers 35 Worker API tests, including chatbot fallback
when Workers AI is unavailable, synthetic Demo Storage put/get/list and error
cases, range boundaries, and Admin-only demo routing.
It does not certify account-specific AI model access or a valid Admin account/UI workflow. For the dashboard demo use
`npm run dev:api:demo`, which uses `wrangler.dev.jsonc` and `--local`.