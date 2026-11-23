import {
  createAccessToken,
  hashPassword,
  hashResetToken,
  hmacHex,
  verifyAccessToken,
  verifyPassword
} from "./security";
import {
  attemptAiProductRecommendations,
  isAiConfigured,
  resolveAiReply,
  shouldUseAiForChat,
  type AiEnvironment,
  type AiProductCandidate
} from "./ai";
import { findChatbotFaq } from "./chatbot-faq";
import { buildAnalyticsReport, createAnalyticsEvent, writeAnalyticsEvent } from "./analytics";
import { createSyntheticAnalyticsBucket } from "./analytics-demo";
import type { AnalyticsDataMode } from "./analytics";

interface Env extends AiEnvironment {
  DB: D1Database;
  ANALYTICS_BUCKET?: R2Bucket;
  ANALYTICS_MODE?: AnalyticsDataMode;
  SECRET_KEY: string;
  CORS_ORIGINS: string;
}

interface UserRow {
  id: number;
  full_name: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  phone: string | null;
  address: string | null;
  role: string;
  created_at: string | null;
}

interface ProductRow {
  id: number;
  name: string;
  category: string;
  price: number;
  image: string | null;
  badge: string | null;
  brand: string;
  description: string | null;
  sale_price: number | null;
  stock: number;
  specifications: string | null;
  is_active: number;
}

interface OrderRow {
  id: number;
  user_id: number;
  recipient_name: string;
  recipient_phone: string;
  shipping_address: string;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  status: string;
  note: string | null;
  created_at: string | null;
  user_email?: string;
  user_name?: string;
}

interface OrderItemRow {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  product_image: string | null;
}

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const utf8Encoder = new TextEncoder();
const statuses = ["pending", "confirmed", "preparing", "shipping", "delivered", "cancelled"] as const;
const paymentStatuses = ["unpaid", "paid", "refunded"] as const;
const paymentMethods = ["cod", "bank_transfer"] as const;
const statusTransitions: Record<string, readonly string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["shipping", "cancelled"],
  shipping: ["delivered", "cancelled"],
  delivered: [],
  cancelled: []
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(jsonHeaders);
  new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders
  });
}

function fail(status: number, detail: string): never {
  throw new ApiError(status, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(request: Request, maxBytes = 32_768): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > maxBytes) fail(413, "Request body quá lớn.");

  let value: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) fail(400, "Request body bị thiếu.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        fail(413, "Request body quá lớn.");
      }
      chunks.push(chunk);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    value = JSON.parse(new TextDecoder().decode(merged));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, "JSON không hợp lệ hoặc request body bị thiếu.");
  }
  if (!isRecord(value)) fail(400, "JSON body phải là object.");
  return value;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  minLength: number,
  maxLength: number,
  label = key
): string {
  const value = body[key];
  if (typeof value !== "string") fail(422, `${label} không hợp lệ.`);
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    fail(422, `${label} phải có từ ${minLength} đến ${maxLength} ký tự.`);
  }
  return normalized;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
  label = key
): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    fail(422, `${label} không hợp lệ.`);
  }
  return value.trim() || null;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(422, `${label} không hợp lệ.`);
  }
  return value;
}

function passwordString(
  body: Record<string, unknown>,
  key: string,
  minLength: number,
  label: string
): string {
  const value = body[key];
  if (typeof value !== "string" || value.length < minLength || value.length > 72) {
    fail(422, `${label} phải có từ ${minLength} đến 72 ký tự.`);
  }
  return value;
}

function normalizedEmail(value: unknown): { email: string; normalized: string } {
  if (typeof value !== "string") fail(422, "Email không hợp lệ.");
  const email = value.trim();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(422, "Email không hợp lệ.");
  }
  return { email, normalized: email.toLowerCase() };
}

function userResponse(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    role: user.role
  };
}

function publicProduct(product: ProductRow): Record<string, unknown> {
  let specifications: Record<string, unknown> | null = null;
  if (product.specifications) {
    const parsed: unknown = JSON.parse(product.specifications);
    if (!isRecord(parsed)) fail(500, "Thông số sản phẩm không đúng định dạng.");
    specifications = parsed;
  }
  return {
    ...product,
    is_active: Boolean(product.is_active),
    specifications
  };
}

async function authenticate(request: Request, env: Env): Promise<UserRow> {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) fail(401, "Vui lòng đăng nhập.");
  const userId = await verifyAccessToken(match[1], env.SECRET_KEY);
  if (!userId) fail(401, "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  if (!user) fail(401, "Vui lòng đăng nhập.");
  return user;
}

async function requireAdmin(request: Request, env: Env): Promise<UserRow> {
  const user = await authenticate(request, env);
  if (user.role !== "admin") fail(403, "Yêu cầu quyền admin.");
  return user;
}

async function checkRateLimit(
  request: Request,
  env: Env,
  scope: string,
  subject: string | null,
  limits: readonly [number, number],
  detail: string
): Promise<void> {
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?")
    .bind(minute - 60 * 60 * 1000).run();
  const keys = await Promise.all([
    hmacHex(`${scope}:ip:${ip}`, env.SECRET_KEY),
    ...(subject ? [hmacHex(`${scope}:subject:${subject}`, env.SECRET_KEY)] : [])
  ]);
  const results = await env.DB.batch(keys.map(key =>
    env.DB.prepare(`INSERT INTO auth_rate_limits (rate_key, window_start, attempts)
      VALUES (?, ?, 1)
      ON CONFLICT(rate_key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start = excluded.window_start
          THEN auth_rate_limits.attempts + 1 ELSE 1 END,
        window_start = excluded.window_start
      RETURNING attempts`).bind(key, minute)
  ));
  const attempts = results.map(result => {
    const rows = result.results as Array<{ attempts: number }> | undefined;
    return Number(rows?.[0]?.attempts || 0);
  });
  if (attempts[0] > limits[0] || (subject && attempts[1] > limits[1])) {
    fail(429, detail);
  }
}

async function checkAuthRateLimit(
  request: Request,
  env: Env,
  email: string,
  action: "login" | "register"
): Promise<void> {
  const limits = action === "login" ? [30, 8] as const : [10, 4] as const;
  await checkRateLimit(
    request,
    env,
    `auth:${action}`,
    email,
    limits,
    "Quá nhiều yêu cầu. Vui lòng thử lại sau một phút."
  );
}

function parsePage(url: URL, maxPageSize: number, defaultPageSize: number): {
  page: number;
  pageSize: number;
} {
  const page = integer(Number(url.searchParams.get("page") || "1"), 1, 1_000_000, "page");
  const pageSize = integer(
    Number(url.searchParams.get("page_size") || String(defaultPageSize)),
    1,
    maxPageSize,
    "page_size"
  );
  return { page, pageSize };
}

function pagination(total: number, page: number, pageSize: number): Record<string, number> {
  return { total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
}

function boundedSearch(value: string): string {
  let result = "";
  let bytes = 0;
  for (const character of value.trim()) {
    const characterBytes = utf8Encoder.encode(character).byteLength;
    if (bytes + characterBytes > 48) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

async function orderItems(env: Env, orderId: number): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(`SELECT
      oi.id, oi.product_id, oi.product_name, oi.unit_price, oi.quantity, oi.subtotal,
      p.image AS product_image
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
    ORDER BY oi.id`).bind(orderId).all<OrderItemRow>();
  return result.results.map(item => ({ ...item }));
}

async function orderItemsForOrders(
  env: Env,
  orderIds: number[]
): Promise<Map<number, Record<string, unknown>[]>> {
  const grouped = new Map<number, Record<string, unknown>[]>();
  if (orderIds.length === 0) return grouped;
  const placeholders = orderIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`SELECT
      oi.order_id, oi.id, oi.product_id, oi.product_name, oi.unit_price, oi.quantity, oi.subtotal,
      p.image AS product_image
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id IN (${placeholders})
    ORDER BY oi.order_id, oi.id`).bind(...orderIds).all<OrderItemRow & { order_id: number }>();
  for (const item of result.results) {
    const items = grouped.get(item.order_id) || [];
    items.push({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      unit_price: item.unit_price,
      quantity: item.quantity,
      subtotal: item.subtotal,
      product_image: item.product_image
    });
    grouped.set(item.order_id, items);
  }
  return grouped;
}

async function orderResponse(
  env: Env,
  order: OrderRow,
  includeUser = false,
  includedItems?: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  return {
    id: order.id,
    ...(includeUser ? {
      user_id: order.user_id,
      user_email: order.user_email || "",
      user_name: order.user_name || ""
    } : {}),
    recipient_name: order.recipient_name,
    recipient_phone: order.recipient_phone,
    shipping_address: order.shipping_address,
    total_amount: order.total_amount,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    status: order.status,
    note: order.note,
    created_at: order.created_at,
    items: includedItems || await orderItems(env, order.id)
  };
}

async function getOrder(env: Env, orderId: number, includeUser = false): Promise<OrderRow | null> {
  const query = includeUser
    ? `SELECT o.*, u.email AS user_email, u.full_name AS user_name
       FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`
    : "SELECT * FROM orders WHERE id = ?";
  return env.DB.prepare(query).bind(orderId).first<OrderRow>();
}

async function restoreOrderInventory(
  env: Env,
  orderId: number,
  cancelKey: string
): Promise<D1PreparedStatement[]> {
  return [
    env.DB.prepare(`UPDATE products
      SET stock = stock + (
        SELECT COALESCE(SUM(oi.quantity), 0)
        FROM order_items oi
        WHERE oi.order_id = ? AND oi.product_id = products.id AND oi.stock_deducted = 1
      )
      WHERE id IN (
        SELECT product_id FROM order_items
        WHERE order_id = ? AND product_id IS NOT NULL AND stock_deducted = 1
      )
      AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND cancel_key = ?)`)
      .bind(orderId, orderId, orderId, cancelKey),
    env.DB.prepare(`UPDATE order_items
      SET stock_deducted = 0
      WHERE order_id = ? AND stock_deducted = 1
      AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND cancel_key = ?)`)
      .bind(orderId, orderId, cancelKey)
  ];
}

async function cancelOrder(
  env: Env,
  orderId: number,
  userId: number,
  reason: string | null
): Promise<Record<string, unknown>> {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?")
    .bind(orderId, userId).first<OrderRow>();
  if (!order) fail(404, "Không tìm thấy đơn hàng.");
  if (order.status !== "pending") fail(400, "Chỉ có thể hủy đơn hàng đang chờ xác nhận.");

  const cancelKey = crypto.randomUUID();
  const note = reason ? `${order.note || ""}\n[Lý do hủy]: ${reason}`.trim() : order.note;
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET status = 'cancelled', note = ?, cancel_key = ?
      WHERE id = ? AND user_id = ? AND status = 'pending'`)
      .bind(note, cancelKey, orderId, userId),
    ...(await restoreOrderInventory(env, orderId, cancelKey))
  ]);
  if (Number(result[0].meta.changes) !== 1) fail(409, "Trạng thái đơn hàng đã thay đổi. Hãy tải lại.");
  return { message: "Hủy đơn hàng thành công", order_id: orderId, status: "cancelled" };
}

async function createOrder(
  request: Request,
  env: Env,
  user: UserRow,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const recipientName = requiredString(body, "recipient_name", 2, 150, "Tên người nhận");
  const recipientPhone = requiredString(body, "recipient_phone", 9, 20, "Số điện thoại");
  const shippingAddress = requiredString(body, "shipping_address", 5, 1000, "Địa chỉ nhận hàng");
  const paymentMethod = body.payment_method ?? "cod";
  if (typeof paymentMethod !== "string" || !paymentMethods.includes(paymentMethod as typeof paymentMethods[number])) {
    fail(422, "Phương thức thanh toán không hợp lệ.");
  }
  const note = optionalString(body, "note", 1000, "Ghi chú");
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    fail(422, "Đơn hàng phải có từ 1 đến 50 dòng sản phẩm.");
  }

  const quantities = new Map<number, number>();
  for (const rawItem of body.items) {
    if (!isRecord(rawItem)) fail(422, "Dòng sản phẩm không hợp lệ.");
    const productId = integer(rawItem.product_id, 1, Number.MAX_SAFE_INTEGER, "product_id");
    const quantity = integer(rawItem.quantity, 1, 100, "quantity");
    const nextQuantity = (quantities.get(productId) || 0) + quantity;
    if (nextQuantity > 100) fail(400, "Số lượng mỗi sản phẩm không được vượt quá 100.");
    quantities.set(productId, nextQuantity);
  }

  const normalizedItems = [...quantities.entries()]
    .sort(([left], [right]) => left - right)
    .map(([product_id, quantity]) => ({ product_id, quantity }));
  const fingerprint = await (async () => {
    const canonical = JSON.stringify({
      user_id: user.id,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      shipping_address: shippingAddress,
      payment_method: paymentMethod,
      note,
      items: normalizedItems
    });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  })();

  const suppliedKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
  if (!/^[\w.:-]{8,128}$/.test(suppliedKey)) fail(400, "Idempotency-Key không hợp lệ.");
  const checkoutKey = `${user.id}:${suppliedKey}`;
  const previous = await env.DB.prepare("SELECT id, total_amount, payment_method, payment_status, status, checkout_fingerprint FROM orders WHERE checkout_key = ?")
    .bind(checkoutKey).first<OrderRow & { checkout_fingerprint: string | null }>();
  if (previous) {
    if (previous.checkout_fingerprint !== fingerprint) {
      fail(409, "Idempotency-Key đã được dùng cho nội dung đơn hàng khác.");
    }
    return {
      message: "Đơn hàng đã được tạo trước đó",
      order_id: previous.id,
      total_amount: previous.total_amount,
      payment_method: previous.payment_method,
      payment_status: previous.payment_status,
      status: previous.status
    };
  }

  const placeholders = normalizedItems.map(() => "?").join(",");
  const productResult = await env.DB.prepare(
    `SELECT * FROM products WHERE id IN (${placeholders})`
  ).bind(...normalizedItems.map(item => item.product_id)).all<ProductRow>();
  const productMap = new Map(productResult.results.map(product => [product.id, product]));
  if (productMap.size !== normalizedItems.length) {
    fail(404, "Không tìm thấy một hoặc nhiều sản phẩm đang kinh doanh.");
  }

  let totalAmount = 0;
  const reservedItems = normalizedItems.map(item => {
    const product = productMap.get(item.product_id);
    if (!product || !product.is_active) {
      fail(404, `Không tìm thấy sản phẩm đang kinh doanh ID ${item.product_id}.`);
    }
    if (product.stock < item.quantity) fail(409, `Sản phẩm '${product.name}' không đủ tồn kho.`);
    const unitPrice = product.sale_price !== null &&
      product.sale_price > 0 &&
      product.sale_price < product.price
      ? product.sale_price
      : product.price;
    const subtotal = unitPrice * item.quantity;
    if (!Number.isSafeInteger(subtotal)) fail(422, "Tổng tiền vượt giới hạn hỗ trợ.");
    totalAmount += subtotal;
    return {
      ...item,
      expected_price: product.price,
      expected_sale_price: product.sale_price,
      product_name: product.name,
      unit_price: unitPrice,
      subtotal
    };
  });
  if (!Number.isSafeInteger(totalAmount)) fail(422, "Tổng tiền vượt giới hạn hỗ trợ.");

  const reservationJson = JSON.stringify(reservedItems.map(item => ({
    product_id: item.product_id,
    quantity: item.quantity,
    price: item.expected_price,
    sale_price: item.expected_sale_price
  })));
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE products
      SET stock = products.stock - CAST(json_extract(requested.value, '$.quantity') AS INTEGER)
      FROM json_each(?) AS requested
      WHERE products.id = CAST(json_extract(requested.value, '$.product_id') AS INTEGER)
        AND products.is_active = 1
        AND products.price = CAST(json_extract(requested.value, '$.price') AS INTEGER)
        AND (
          (products.sale_price IS NULL AND json_type(requested.value, '$.sale_price') = 'null')
          OR products.sale_price = CAST(json_extract(requested.value, '$.sale_price') AS INTEGER)
        )
        AND products.stock >= CAST(json_extract(requested.value, '$.quantity') AS INTEGER)
        AND (
          SELECT COUNT(*)
          FROM json_each(?) AS check_item
          JOIN products p ON p.id = CAST(json_extract(check_item.value, '$.product_id') AS INTEGER)
          WHERE p.is_active = 1
            AND p.price = CAST(json_extract(check_item.value, '$.price') AS INTEGER)
            AND (
              (p.sale_price IS NULL AND json_type(check_item.value, '$.sale_price') = 'null')
              OR p.sale_price = CAST(json_extract(check_item.value, '$.sale_price') AS INTEGER)
            )
            AND p.stock >= CAST(json_extract(check_item.value, '$.quantity') AS INTEGER)
        ) = (SELECT COUNT(*) FROM json_each(?))`)
      .bind(reservationJson, reservationJson, reservationJson),
    env.DB.prepare(`INSERT INTO orders (
        user_id, recipient_name, recipient_phone, shipping_address, total_amount,
        payment_method, payment_status, status, note, created_at, checkout_key, checkout_fingerprint
      )
      SELECT ?, ?, ?, ?, ?, ?, 'unpaid', 'pending', ?, ?, ?, ?
      WHERE changes() = ?`)
      .bind(user.id, recipientName, recipientPhone, shippingAddress, totalAmount, paymentMethod, note, now, checkoutKey, fingerprint, normalizedItems.length)
  ];
  for (const item of reservedItems) {
    statements.push(env.DB.prepare(`INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity, subtotal, stock_deducted
      )
      SELECT id, ?, ?, ?, ?, ?, 1 FROM orders WHERE checkout_key = ?`)
      .bind(item.product_id, item.product_name, item.unit_price, item.quantity, item.subtotal, checkoutKey));
  }

  const results = await env.DB.batch(statements);
  if (Number(results[0].meta.changes) !== normalizedItems.length) {
    fail(409, "Tồn kho hoặc giá sản phẩm vừa thay đổi. Vui lòng kiểm tra giỏ hàng và thử lại.");
  }
  const created = await env.DB.prepare("SELECT id FROM orders WHERE checkout_key = ?")
    .bind(checkoutKey).first<{ id: number }>();
  if (!created) fail(500, "Không thể xác nhận đơn hàng vừa tạo.");
  return {
    message: "Tạo đơn hàng thành công",
    order_id: created.id,
    total_amount: totalAmount,
    payment_method: paymentMethod,
    payment_status: "unpaid",
    status: "pending"
  };
}

async function listOrders(
  url: URL,
  env: Env,
  user: UserRow,
  admin: boolean
): Promise<Record<string, unknown>> {
  const { page, pageSize } = parsePage(url, admin ? 100 : 50, admin ? 20 : 10);
  const statusFilter = url.searchParams.get("status_filter");
  const paymentFilter = url.searchParams.get("payment_status_filter");
  const search = boundedSearch(url.searchParams.get("search") || "");
  if (statusFilter && !statuses.includes(statusFilter as typeof statuses[number])) fail(422, "Trạng thái đơn hàng không hợp lệ.");
  if (paymentFilter && !paymentStatuses.includes(paymentFilter as typeof paymentStatuses[number])) fail(422, "Trạng thái thanh toán không hợp lệ.");

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (!admin) {
    conditions.push("o.user_id = ?");
    values.push(user.id);
  }
  if (statusFilter) {
    conditions.push("o.status = ?");
    values.push(statusFilter);
  }
  if (paymentFilter && admin) {
    conditions.push("o.payment_status = ?");
    values.push(paymentFilter);
  }
  if (search) {
    if (/^\d+$/.test(search)) {
      const orderId = Number(search);
      if (Number.isSafeInteger(orderId)) {
        conditions.push("o.id = ?");
        values.push(orderId);
      } else {
        conditions.push("0 = 1");
      }
    } else if (admin) {
      conditions.push("(u.full_name LIKE ? OR u.email LIKE ? OR o.recipient_name LIKE ?)");
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      conditions.push("0 = 1");
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = admin ? "FROM orders o JOIN users u ON u.id = o.user_id" : "FROM orders o";
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from} ${where}`)
    .bind(...values).first<{ total: number }>();
  const total = Number(count?.total || 0);
  const rows = await env.DB.prepare(`SELECT o.*${admin ? ", u.email AS user_email, u.full_name AS user_name" : ""}
    ${from} ${where}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, (page - 1) * pageSize).all<OrderRow>();
  const itemsByOrder = await orderItemsForOrders(env, rows.results.map(order => order.id));
  const orders = await Promise.all(rows.results.map(order =>
    orderResponse(env, order, admin, itemsByOrder.get(order.id) || [])
  ));
  return { orders, ...pagination(total, page, pageSize) };
}

function validProductWrite(body: Record<string, unknown>): {
  name: string;
  brand: string;
  category: string;
  description: string | null;
  price: number;
  sale_price: number | null;
  image: string | null;
  badge: string | null;
  stock: number;
  specifications: string | null;
  is_active: number;
} {
  const name = requiredString(body, "name", 2, 255, "Tên sản phẩm");
  const brand = requiredString(body, "brand", 1, 100, "Thương hiệu");
  const category = requiredString(body, "category", 1, 100, "Danh mục");
  const price = integer(body.price, 1, Number.MAX_SAFE_INTEGER, "Giá");
  const stock = integer(body.stock, 0, Number.MAX_SAFE_INTEGER, "Tồn kho");
  const salePrice = body.sale_price === null || body.sale_price === undefined
    ? null
    : integer(body.sale_price, 1, Number.MAX_SAFE_INTEGER, "Giá khuyến mãi");
  if (salePrice !== null && salePrice >= price) fail(422, "Giá khuyến mãi phải nhỏ hơn giá gốc.");
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") fail(422, "Trạng thái sản phẩm không hợp lệ.");
  const specifications = body.specifications;
  if (specifications !== null && specifications !== undefined && !isRecord(specifications)) {
    fail(422, "Thông số kỹ thuật phải là JSON object.");
  }
  return {
    name,
    brand,
    category,
    description: optionalString(body, "description", 10_000, "Mô tả"),
    price,
    sale_price: salePrice,
    image: optionalString(body, "image", 2048, "Ảnh"),
    badge: optionalString(body, "badge", 100, "Nhãn"),
    stock,
    specifications: specifications ? JSON.stringify(specifications) : null,
    is_active: body.is_active === false ? 0 : 1
  };
}

async function adminProductList(url: URL, env: Env): Promise<Record<string, unknown>> {
  const { page, pageSize } = parsePage(url, 100, 20);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const search = boundedSearch(url.searchParams.get("search") || "");
  if (search) {
    conditions.push("(name LIKE ? OR brand LIKE ? OR category LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const brand = url.searchParams.get("brand");
  const category = url.searchParams.get("category");
  const active = url.searchParams.get("active");
  if (brand) {
    conditions.push("brand = ?");
    values.push(brand.slice(0, 100));
  }
  if (category) {
    conditions.push("category = ?");
    values.push(category.slice(0, 100));
  }
  if (active !== null && active !== "") {
    if (active !== "true" && active !== "false") fail(422, "Bộ lọc trạng thái sản phẩm không hợp lệ.");
    conditions.push("is_active = ?");
    values.push(active === "true" ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM products ${where}`)
    .bind(...values).first<{ total: number }>();
  const total = Number(count?.total || 0);
  const rows = await env.DB.prepare(`SELECT * FROM products ${where} ORDER BY id LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, (page - 1) * pageSize).all<ProductRow>();
  return {
    items: rows.results.map(publicProduct),
    ...pagination(total, page, pageSize)
  };
}

async function adminCustomerList(url: URL, env: Env): Promise<Record<string, unknown>> {
  const { page, pageSize } = parsePage(url, 100, 20);
  const search = boundedSearch(url.searchParams.get("search") || "");
  const where = search
    ? "WHERE u.role = 'customer' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)"
    : "WHERE u.role = 'customer'";
  const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`)
    .bind(...params).first<{ total: number }>();
  const total = Number(count?.total || 0);
  const rows = await env.DB.prepare(`SELECT u.id, u.full_name, u.email, u.phone, u.address, u.created_at,
      COUNT(o.id) AS order_count
    FROM users u LEFT JOIN orders o ON o.user_id = u.id
    ${where}
    GROUP BY u.id
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, (page - 1) * pageSize).all();
  return { items: rows.results, ...pagination(total, page, pageSize) };
}

async function adminCustomerDetail(env: Env, customerId: number): Promise<Record<string, unknown>> {
  const customer = await env.DB.prepare(`SELECT id, full_name, email, phone, address, created_at
    FROM users WHERE id = ? AND role = 'customer'`).bind(customerId).first<Record<string, unknown>>();
  if (!customer) fail(404, "Không tìm thấy khách hàng.");
  const orders = await env.DB.prepare(`SELECT id, status, payment_status, total_amount, created_at
    FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`)
    .bind(customerId).all();
  const count = await env.DB.prepare("SELECT COUNT(*) AS order_count FROM orders WHERE user_id = ?")
    .bind(customerId).first<{ order_count: number }>();
  return { ...customer, order_count: Number(count?.order_count || 0), orders: orders.results };
}

function scrubPrivateChatText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Z]{2,}/gi, "[đã ẩn]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[đã ẩn]")
    .replace(/\b(?:password|mật khẩu|token|secret|api[\s_-]?key)\s*[:=]\s*\S+/gi, "[đã ẩn]")
    .replace(/\b(?:sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{16,})\b/gi, "[đã ẩn]")
    .slice(0, 1200);
}

function productSearchTerms(message: string): string[] {
  const stopWords = new Set([
    "toi", "muon", "tim", "mua", "cho", "shop", "co", "khong", "gia", "bao", "nhieu",
    "san", "pham", "hang", "tu", "van", "giup", "ve", "la", "cua", "can", "xin",
    "goi", "nen", "nao", "phu", "hop", "sinh", "vien", "de", "xuat"
  ]);
  return [...new Set(
    message.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("vi")
      .match(/[\p{L}\p{N}]+/gu) || []
  )].filter(term => term.length >= 2 && !stopWords.has(term)).slice(0, 5);
}

function isProductRecommendationRequest(message: string): boolean {
  const normalized = message.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi");
  return /\b(tu van|goi y|nen mua|phu hop|recommend|suggest)\b/.test(normalized)
    || /\bchon\b.*\b(gi|nao)\b/.test(normalized);
}

function formatChatProducts(products: ProductRow[]): string {
  if (!products.length) {
    return "Tôi chưa tìm thấy sản phẩm phù hợp trong danh mục hiện tại. Bạn có thể thử tên hoặc thương hiệu khác.";
  }
  return products.map(product => {
    const price = product.sale_price && product.sale_price > 0 && product.sale_price < product.price
      ? product.sale_price
      : product.price;
    let specifications: string[] = [];
    try {
      const parsed: unknown = product.specifications ? JSON.parse(product.specifications) : null;
      if (isRecord(parsed)) {
        specifications = Object.entries(parsed)
          .filter((entry): entry is [string, string | number | boolean] =>
            ["string", "number", "boolean"].includes(typeof entry[1])
          )
          .slice(0, 4)
          .map(([name, value]) => `${name.replace(/_/g, " ")}: ${String(value).slice(0, 100)}`);
      }
    } catch {
      specifications = [];
    }
    const details = [
      `${product.name} (${product.brand}) · ${price.toLocaleString("vi-VN")}₫ · ${
      product.stock > 0 ? `còn ${product.stock}` : "hết hàng"
      }`,
      product.description ? product.description.slice(0, 180) : "",
      ...specifications.map(value => `• ${value}`)
    ].filter(Boolean);
    return details.join("\n");
  }).join("\n");
}

async function handleChatbotMessage(request: Request, env: Env): Promise<Record<string, unknown>> {
  const body = await readJson(request, 4096);
  const message = requiredString(body, "message", 1, 1200, "Tin nhắn");
  await checkRateLimit(
    request,
    env,
    "chatbot",
    null,
    [20, 0],
    "Bạn gửi tin nhắn quá nhanh. Vui lòng thử lại sau một phút."
  );

  const orderMatch = /(?:đơn(?:\s*hàng)?\s*(?:mã\s*)?#?|#)\s*(\d{1,12})/i.exec(message);
  if (orderMatch) {
    const authorization = request.headers.get("authorization");
    if (!authorization) {
      return {
        reply: "Vui lòng đăng nhập để tra cứu đơn hàng. Tôi chỉ có thể xem đơn thuộc tài khoản của bạn.",
        mode: "faq"
      };
    }
    let user: UserRow;
    try {
      user = await authenticate(request, env);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return { reply: "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại để tra cứu đơn.", mode: "faq" };
      }
      throw error;
    }
    const orderId = Number(orderMatch[1]);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?")
      .bind(orderId, user.id).first<OrderRow>();
    if (!order) {
      return { reply: "Không tìm thấy đơn hàng này trong tài khoản của bạn.", mode: "faq" };
    }
    const statusLabels: Record<string, string> = {
      pending: "Đã đặt",
      confirmed: "Đã xác nhận",
      preparing: "Đang chuẩn bị",
      shipping: "Đang giao",
      delivered: "Đã giao",
      cancelled: "Đã hủy"
    };
    return {
      reply: `Đơn hàng #${order.id}: ${statusLabels[order.status] || order.status}. Tổng tiền ${order.total_amount.toLocaleString("vi-VN")}₫.`,
      mode: "account"
    };
  }

  const faq = findChatbotFaq(message);
  const recommendationRequest = isProductRecommendationRequest(message);
  if (faq && faq.id !== "greeting") {
    return { reply: faq.answer, mode: "faq" };
  }

  const terms = productSearchTerms(message);
  let matches: ProductRow[] = [];
  if (terms.length) {
    const conditions = terms.map(() =>
      "(name LIKE ? COLLATE NOCASE OR brand LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE OR specifications LIKE ? COLLATE NOCASE)"
    );
    const values = terms.flatMap(term => Array(5).fill(`%${term}%`));
    const result = await env.DB.prepare(`SELECT id, name, category, price, sale_price, brand, stock,
        description, specifications
      FROM products WHERE is_active = 1 AND (${conditions.join(" OR ")})
      ORDER BY CASE WHEN stock > 0 THEN 0 ELSE 1 END, id LIMIT 5`)
      .bind(...values).all<ProductRow>();
    matches = result.results;
  } else if (recommendationRequest) {
    const result = await env.DB.prepare(`SELECT id, name, category, price, sale_price, brand, stock,
        description, specifications
      FROM products WHERE is_active = 1
      ORDER BY CASE WHEN stock > 0 THEN 0 ELSE 1 END, id LIMIT 5`)
      .all<ProductRow>();
    matches = result.results;
  }

  const productReply = matches.length
    ? `${recommendationRequest && !terms.length
      ? "Một số sản phẩm hiện có trong danh mục:"
      : "Một số sản phẩm phù hợp:"}\n${formatChatProducts(matches)}`
    : "Tôi chưa tìm thấy sản phẩm phù hợp trong danh mục hiện tại. Bạn có thể thử tên hoặc thương hiệu khác.";

  if (recommendationRequest) {
    if (!matches.length || !isAiConfigured(env)) {
      return { reply: productReply, mode: "fallback" };
    }

    const candidates: AiProductCandidate[] = matches.map(product => ({
      id: product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      price: product.price,
      sale_price: product.sale_price,
      stock: product.stock,
      specifications: product.specifications
    }));
    const attempt = await attemptAiProductRecommendations(
      env,
      scrubPrivateChatText(message),
      candidates
    );
    if (attempt.failure) {
      console.error("AI provider invocation failed", JSON.stringify({ failure: attempt.failure }));
      return {
        reply: `AI hiện tạm thời không khả dụng. ${productReply}`,
        mode: "fallback"
      };
    }

    const candidateById = new Map(matches.map(product => [product.id, product]));
    const recommended = (attempt.productIds || [])
      .map(id => candidateById.get(id))
      .filter((product): product is ProductRow => product !== undefined);
    if (!recommended.length) return { reply: productReply, mode: "fallback" };
    return {
      reply: `Dựa trên danh mục D1, tôi gợi ý:\n${formatChatProducts(recommended)}`,
      mode: "ai"
    };
  }

  if (faq) return { reply: faq.answer, mode: "faq" };
  if (terms.length) return { reply: productReply, mode: "fallback" };

  const fallbackReply = "Tôi có thể tra cứu sản phẩm theo tên/thương hiệu và trả lời câu hỏi về giao hàng, thanh toán, bảo hành hoặc đổi trả. Thông tin chính sách chưa cấu hình sẽ được chuyển tới cửa hàng.";
  if (!isAiConfigured(env) || !shouldUseAiForChat(message, false, false)) {
    return { reply: fallbackReply, mode: "fallback" };
  }

  const aiReply = await resolveAiReply(env, scrubPrivateChatText(message), fallbackReply);
  if (aiReply.failure) {
    console.error("AI provider invocation failed", JSON.stringify({ failure: aiReply.failure }));
  }
  if (aiReply.mode === "ai") return { reply: aiReply.reply, mode: "ai" };
  if (aiReply.failure) {
    return {
      reply: `AI hiện tạm thời không khả dụng. ${aiReply.reply}`,
      mode: "fallback"
    };
  }
  return { reply: aiReply.reply, mode: "fallback" };
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/health" && method === "GET") return json({ status: "ok" });

  if ((path === "/api/products" || path === "/api/products/") && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY id")
      .all<ProductRow>();
    return json(rows.results.map(publicProduct));
  }

  if (path === "/api/auth/register" && method === "POST") {
    const body = await readJson(request);
    const { email, normalized } = normalizedEmail(body.email);
    const fullName = requiredString(body, "full_name", 2, 150, "Họ và tên");
    const password = passwordString(body, "password", 8, "Mật khẩu");
    const phone = optionalString(body, "phone", 20, "Số điện thoại");
    await checkAuthRateLimit(request, env, normalized, "register");
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email_normalized = ?")
      .bind(normalized).first<{ id: number }>();
    if (existing) fail(400, "Email đã được đăng ký.");
    const passwordHash = await hashPassword(password);
    try {
      const created = await env.DB.prepare(`INSERT INTO users (
        full_name, email, email_normalized, password_hash, phone, address, role, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'customer', ?) RETURNING id`)
        .bind(fullName, email, normalized, passwordHash, phone, new Date().toISOString())
        .first<{ id: number }>();
      if (!created) fail(500, "Không thể tạo tài khoản.");
      return json({ message: "Đăng ký thành công", user_id: created.id }, 201);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (String(error).includes("UNIQUE constraint failed: users.email_normalized")) {
        fail(400, "Email đã được đăng ký.");
      }
      throw error;
    }
  }

  if ((path === "/api/auth/login" || path === "/api/auth/token") && method === "POST") {
    let body: Record<string, unknown>;
    if (path.endsWith("/token")) {
      const form = await request.formData();
      body = { email: form.get("username"), password: form.get("password") };
    } else {
      body = await readJson(request);
    }
    const { normalized } = normalizedEmail(body.email);
    const password = passwordString(body, "password", 1, "Mật khẩu");
    await checkAuthRateLimit(request, env, normalized, "login");
    const user = await env.DB.prepare("SELECT * FROM users WHERE email_normalized = ?")
      .bind(normalized).first<UserRow>();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      fail(401, "Email hoặc mật khẩu không đúng.");
    }
    const accessToken = await createAccessToken(user.id, env.SECRET_KEY);
    return json({
      access_token: accessToken,
      token_type: "bearer",
      ...(path.endsWith("/login") ? { user: userResponse(user) } : {})
    });
  }

  if (path === "/api/auth/reset-legacy-password" && method === "POST") {
    const body = await readJson(request);
    const { normalized } = normalizedEmail(body.email);
    const token = requiredString(body, "token", 32, 256, "Mã khôi phục");
    const newPassword = passwordString(body, "new_password", 8, "Mật khẩu mới");
    const tokenHash = await hashResetToken(token);
    const now = Date.now();
    const usedAt = new Date(now).toISOString();
    const reset = await env.DB.prepare(`SELECT t.token_hash FROM password_reset_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND u.email_normalized = ? AND t.used_at IS NULL AND t.expires_at > ?`)
      .bind(tokenHash, normalized, now).first<{ token_hash: string }>();
    if (!reset) fail(400, "Mã khôi phục không hợp lệ, đã dùng hoặc hết hạn.");
    const passwordHash = await hashPassword(newPassword);
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ?
        WHERE token_hash = ?
          AND user_id = (SELECT id FROM users WHERE email_normalized = ?)
          AND used_at IS NULL AND expires_at > ?`)
        .bind(usedAt, tokenHash, normalized, now),
      env.DB.prepare(`UPDATE users SET password_hash = ?
        WHERE email_normalized = ?
          AND id = (SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at = ?)
          AND changes() = 1`)
        .bind(passwordHash, normalized, tokenHash, usedAt)
    ]);
    if (Number(results[0].meta.changes) !== 1 || Number(results[1].meta.changes) !== 1) {
      fail(400, "Mã khôi phục không hợp lệ, đã dùng hoặc hết hạn.");
    }
    return json({ message: "Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới." });
  }

  if (path === "/api/auth/me" && method === "GET") {
    return json(userResponse(await authenticate(request, env)));
  }

  if (path === "/api/auth/me" && method === "PUT") {
    const user = await authenticate(request, env);
    const body = await readJson(request);
    const fullName = requiredString(body, "full_name", 2, 150, "Họ và tên");
    const phone = optionalString(body, "phone", 20, "Số điện thoại");
    const address = optionalString(body, "address", 1000, "Địa chỉ");
    await env.DB.prepare("UPDATE users SET full_name = ?, phone = ?, address = ? WHERE id = ?")
      .bind(fullName, phone, address, user.id).run();
    return json(userResponse({
      ...user,
      full_name: fullName,
      phone,
      address
    }));
  }

  if (path === "/api/auth/password" && method === "PATCH") {
    const user = await authenticate(request, env);
    const body = await readJson(request);
    const currentPassword = passwordString(body, "current_password", 1, "Mật khẩu hiện tại");
    const newPassword = passwordString(body, "new_password", 8, "Mật khẩu mới");
    if (!(await verifyPassword(currentPassword, user.password_hash))) fail(400, "Mật khẩu hiện tại không đúng.");
    if (newPassword === currentPassword) fail(400, "Mật khẩu mới phải khác mật khẩu hiện tại.");
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(await hashPassword(newPassword), user.id).run();
    return json({ message: "Đổi mật khẩu thành công" });
  }

  if (path === "/api/orders" || path === "/api/orders/") {
    const user = await authenticate(request, env);
    if (method === "POST") return json(await createOrder(request, env, user, await readJson(request)), 201);
    if (method === "GET") return json(await listOrders(url, env, user, false));
  }

  const customerCancel = /^\/api\/orders\/(\d+)\/cancel$/.exec(path);
  if (customerCancel && method === "PATCH") {
    const user = await authenticate(request, env);
    const body = await readJson(request);
    return json(await cancelOrder(
      env,
      integer(Number(customerCancel[1]), 1, Number.MAX_SAFE_INTEGER, "order_id"),
      user.id,
      optionalString(body, "reason", 500, "Lý do hủy")
    ));
  }

  const adminSummary = path === "/api/orders/admin/summary";
  if (adminSummary && method === "GET") {
    await requireAdmin(request, env);
    const rows = await env.DB.prepare("SELECT status, COUNT(*) AS count FROM orders GROUP BY status").all<{ status: string; count: number }>();
    const counts = new Map(rows.results.map(row => [row.status, Number(row.count)]));
    const revenue = await env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE status != 'cancelled' AND payment_status = 'paid'")
      .first<{ total: number }>();
    return json({
      total_orders: [...counts.values()].reduce((sum, count) => sum + count, 0),
      pending_orders: counts.get("pending") || 0,
      active_orders: ["confirmed", "preparing", "shipping"].reduce((sum, status) => sum + (counts.get(status) || 0), 0),
      delivered_orders: counts.get("delivered") || 0,
      revenue_total: Number(revenue?.total || 0)
    });
  }

  if (path === "/api/orders/admin/all" && method === "GET") {
    const admin = await requireAdmin(request, env);
    return json(await listOrders(url, env, admin, true));
  }

  const adminOrderStatus = /^\/api\/orders\/admin\/(\d+)\/status$/.exec(path);
  if (adminOrderStatus && method === "PATCH") {
    await requireAdmin(request, env);
    const orderId = integer(Number(adminOrderStatus[1]), 1, Number.MAX_SAFE_INTEGER, "order_id");
    const body = await readJson(request);
    const nextStatus = body.status;
    if (typeof nextStatus !== "string" || !statuses.includes(nextStatus as typeof statuses[number])) {
      fail(422, "Trạng thái đơn hàng không hợp lệ.");
    }
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
    if (!order) fail(404, "Không tìm thấy đơn hàng.");
    if (nextStatus === order.status) return json({ message: "Trạng thái không thay đổi", order_id: order.id, status: order.status });
    if (!statusTransitions[order.status]?.includes(nextStatus)) {
      fail(400, `Không thể chuyển trạng thái từ '${order.status}' sang '${nextStatus}'.`);
    }
    const cancelKey = nextStatus === "cancelled" ? crypto.randomUUID() : null;
    const statements = [
      env.DB.prepare("UPDATE orders SET status = ?, cancel_key = ? WHERE id = ? AND status = ?")
        .bind(nextStatus, cancelKey, orderId, order.status),
      ...(cancelKey ? await restoreOrderInventory(env, orderId, cancelKey) : [])
    ];
    const result = await env.DB.batch(statements);
    if (Number(result[0].meta.changes) !== 1) fail(409, "Trạng thái đơn hàng vừa thay đổi. Hãy tải lại.");
    return json({ message: "Cập nhật trạng thái thành công", order_id: orderId, status: nextStatus });
  }

  const adminPayment = /^\/api\/orders\/admin\/(\d+)\/payment$/.exec(path);
  if (adminPayment && method === "PATCH") {
    await requireAdmin(request, env);
    const orderId = integer(Number(adminPayment[1]), 1, Number.MAX_SAFE_INTEGER, "order_id");
    const body = await readJson(request);
    const paymentStatus = body.payment_status;
    if (typeof paymentStatus !== "string" || !paymentStatuses.includes(paymentStatus as typeof paymentStatuses[number])) {
      fail(422, "Trạng thái thanh toán không hợp lệ.");
    }
    const result = await env.DB.prepare("UPDATE orders SET payment_status = ? WHERE id = ?")
      .bind(paymentStatus, orderId).run();
    if (!result.meta.changes) fail(404, "Không tìm thấy đơn hàng.");
    return json({ message: "Cập nhật trạng thái thanh toán thành công", order_id: orderId, payment_status: paymentStatus });
  }

  const adminOrder = /^\/api\/orders\/admin\/(\d+)$/.exec(path);
  if (adminOrder && method === "GET") {
    await requireAdmin(request, env);
    const order = await getOrder(env, integer(Number(adminOrder[1]), 1, Number.MAX_SAFE_INTEGER, "order_id"), true);
    if (!order) fail(404, "Không tìm thấy đơn hàng.");
    return json(await orderResponse(env, order, true));
  }

  const customerOrder = /^\/api\/orders\/(\d+)$/.exec(path);
  if (customerOrder && method === "GET") {
    const user = await authenticate(request, env);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?")
      .bind(integer(Number(customerOrder[1]), 1, Number.MAX_SAFE_INTEGER, "order_id"), user.id)
      .first<OrderRow>();
    if (!order) fail(404, "Không tìm thấy đơn hàng.");
    return json(await orderResponse(env, order));
  }

  if (path === "/api/admin/products" && method === "GET") {
    await requireAdmin(request, env);
    return json(await adminProductList(url, env));
  }

  if (path === "/api/admin/products" && method === "POST") {
    await requireAdmin(request, env);
    const values = validProductWrite(await readJson(request));
    const duplicate = await env.DB.prepare("SELECT id FROM products WHERE lower(name) = lower(?) AND lower(brand) = lower(?)")
      .bind(values.name, values.brand).first<{ id: number }>();
    if (duplicate) fail(409, "Sản phẩm cùng tên và thương hiệu đã tồn tại.");
    const created = await env.DB.prepare(`INSERT INTO products (
      name, brand, category, description, price, sale_price, image, badge, stock, specifications, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(values.name, values.brand, values.category, values.description, values.price, values.sale_price,
        values.image, values.badge, values.stock, values.specifications, values.is_active)
      .first<ProductRow>();
    if (!created) fail(500, "Không thể tạo sản phẩm.");
    return json(publicProduct(created), 201);
  }

  const adminProductMatch = /^\/api\/admin\/products\/(\d+)(?:\/(stock|visibility))?$/.exec(path);
  if (adminProductMatch && ["PUT", "PATCH"].includes(method)) {
    await requireAdmin(request, env);
    const productId = integer(Number(adminProductMatch[1]), 1, Number.MAX_SAFE_INTEGER, "product_id");
    const operation = adminProductMatch[2];
    const body = await readJson(request);
    let statement: D1PreparedStatement;
    if (method === "PUT" && !operation) {
      const values = validProductWrite(body);
      const duplicate = await env.DB.prepare("SELECT id FROM products WHERE lower(name) = lower(?) AND lower(brand) = lower(?) AND id != ?")
        .bind(values.name, values.brand, productId).first<{ id: number }>();
      if (duplicate) fail(409, "Sản phẩm cùng tên và thương hiệu đã tồn tại.");
      statement = env.DB.prepare(`UPDATE products SET
        name = ?, brand = ?, category = ?, description = ?, price = ?, sale_price = ?,
        image = ?, badge = ?, stock = ?, specifications = ?, is_active = ?
        WHERE id = ? RETURNING *`)
        .bind(values.name, values.brand, values.category, values.description, values.price, values.sale_price,
          values.image, values.badge, values.stock, values.specifications, values.is_active, productId);
    } else if (method === "PATCH" && operation === "stock") {
      statement = env.DB.prepare("UPDATE products SET stock = ? WHERE id = ? RETURNING *")
        .bind(integer(body.stock, 0, Number.MAX_SAFE_INTEGER, "Tồn kho"), productId);
    } else if (method === "PATCH" && operation === "visibility") {
      if (typeof body.is_active !== "boolean") fail(422, "Trạng thái sản phẩm không hợp lệ.");
      statement = env.DB.prepare("UPDATE products SET is_active = ? WHERE id = ? RETURNING *")
        .bind(body.is_active ? 1 : 0, productId);
    } else {
      fail(405, "Phương thức không được hỗ trợ.");
    }
    const updated = await statement.first<ProductRow>();
    if (!updated) fail(404, "Không tìm thấy sản phẩm.");
    return json(publicProduct(updated));
  }

  const adminCustomers = path === "/api/admin/customers";
  if (adminCustomers && method === "GET") {
    await requireAdmin(request, env);
    return json(await adminCustomerList(url, env));
  }

  if (path === "/api/admin/analytics" && method === "GET") {
    await requireAdmin(request, env);
    const range = url.searchParams.get("range") || "24h";
    if (!["24h", "7d", "90d"].includes(range)) fail(422, "Khoảng thời gian phân tích không hợp lệ.");
    const cursor = url.searchParams.get("cursor");
    if (cursor && (cursor.length > 4096 || !/^[\w+/=-]+$/.test(cursor))) {
      fail(422, "Con trỏ phân trang không hợp lệ.");
    }
    const now = Date.now();
    if (env.ANALYTICS_MODE === "demo") {
      const demoBucket = await createSyntheticAnalyticsBucket(now);
      return json(await buildAnalyticsReport(
        { ...env, ANALYTICS_BUCKET: demoBucket },
        range,
        cursor,
        now
      ));
    }
    if (!env.ANALYTICS_BUCKET) fail(503, "Kho lưu trữ phân tích chưa được cấu hình.");
    const report = await buildAnalyticsReport(
      env,
      range,
      cursor,
      now
    );
    return json(report);
  }

  const adminCustomer = /^\/api\/admin\/customers\/(\d+)$/.exec(path);
  if (adminCustomer && method === "GET") {
    await requireAdmin(request, env);
    return json(await adminCustomerDetail(env, integer(Number(adminCustomer[1]), 1, Number.MAX_SAFE_INTEGER, "customer_id")));
  }
  if (adminCustomer && method === "PATCH") {
    await requireAdmin(request, env);
    const customerId = integer(Number(adminCustomer[1]), 1, Number.MAX_SAFE_INTEGER, "customer_id");
    const body = await readJson(request);
    const fullName = requiredString(body, "full_name", 2, 150, "Họ và tên");
    const phone = optionalString(body, "phone", 20, "Số điện thoại");
    const address = optionalString(body, "address", 1000, "Địa chỉ");
    const updated = await env.DB.prepare(`UPDATE users SET full_name = ?, phone = ?, address = ?
      WHERE id = ? AND role = 'customer' RETURNING id, full_name, email, phone, address, created_at`)
      .bind(fullName, phone, address, customerId).first<Record<string, unknown>>();
    if (!updated) fail(404, "Không tìm thấy khách hàng.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS order_count FROM orders WHERE user_id = ?")
      .bind(customerId).first<{ order_count: number }>();
    return json({ ...updated, order_count: Number(count?.order_count || 0) });
  }

  if (path === "/api/analytics/events" && method === "POST") {
    if (env.ANALYTICS_MODE === "demo") {
      fail(409, "Chế độ Demo chỉ hiển thị dữ liệu tổng hợp và không lưu sự kiện khách truy cập.");
    }
    const body = await readJson(request, 4096);
    if (body.consent !== true) fail(403, "Cần đồng ý phân tích trước khi gửi sự kiện.");
    let event;
    try {
      event = await createAnalyticsEvent(body);
    } catch (error) {
      if (error instanceof TypeError) fail(422, "Sự kiện phân tích không hợp lệ.");
      throw error;
    }
    await checkRateLimit(
      request,
      env,
      "analytics",
      event.anonymous_id,
      [120, 100],
      "Đã vượt giới hạn gửi sự kiện. Vui lòng thử lại sau."
    );
    if (!env.ANALYTICS_BUCKET) fail(503, "Kho lưu trữ phân tích chưa được cấu hình.");
    try {
      await writeAnalyticsEvent(env.ANALYTICS_BUCKET, event);
    } catch (error) {
      console.error("Analytics event storage failed", JSON.stringify({
        errorName: error instanceof Error ? error.name : "UnknownError"
      }));
      fail(503, "Không thể lưu sự kiện phân tích lúc này.");
    }
    return json({ accepted: true }, 202);
  }

  if (path === "/api/chatbot/status" && method === "GET") {
    const configured = isAiConfigured(env);
    return json({
      available: true,
      chat_available: true,
      ai_configured: configured,
      model_access_verified: false,
      mode: configured ? "ai_unverified" : "fallback",
      message: configured
        ? "Workers AI đã được cấu hình nhưng quyền truy cập model trên tài khoản chưa xác minh; nếu không khả dụng, chatbot sẽ dùng FAQ và tìm kiếm D1."
        : "Chưa kết nối AI, đang dùng tìm kiếm và FAQ."
    });
  }

  if (path === "/api/chatbot/chat" && method === "POST") {
    return json(await handleChatbotMessage(request, env));
  }

  if (path === "/api/chatbot/order-lookup" && method === "POST") {
    const user = await authenticate(request, env);
    const body = await readJson(request);
    const orderId = integer(body.order_id, 1, Number.MAX_SAFE_INTEGER, "order_id");
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?")
      .bind(orderId, user.id).first<OrderRow>();
    if (!order) fail(404, "Không tìm thấy đơn hàng của tài khoản này.");
    const items = await orderItems(env, order.id);
    return json({
      order_id: order.id,
      status: order.status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      total_amount: order.total_amount,
      items
    });
  }

  fail(404, "Không tìm thấy API.");
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  const allowedOrigins = env.CORS_ORIGINS.split(",").map(value => value.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    if (origin && !cors.has("Access-Control-Allow-Origin")) {
      return json({ detail: "Origin không được phép." }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!env.SECRET_KEY || env.SECRET_KEY.length < 32) {
      return json({ detail: "Backend chưa được cấu hình an toàn." }, 503, cors);
    }

    try {
      const response = await dispatch(request, env);
      const headers = new Headers(response.headers);
      cors.forEach((value, key) => headers.set(key, value));
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const detail = error instanceof ApiError ? error.message : "Lỗi máy chủ nội bộ.";
      if (status >= 500) {
        const stack = error instanceof Error && error.stack
          ? error.stack.split("\n").slice(1, 9)
          : [];
        console.error("API request failed", JSON.stringify({
          method: request.method,
          path: new URL(request.url).pathname,
          errorName: error instanceof Error ? error.name : "UnknownError",
          ...(error instanceof Error && error.name === "NotSupportedError"
            ? { errorMessage: error.message.slice(0, 160) }
            : {}),
          stack
        }));
      }
      return json({ detail }, status, cors);
    }
  }
};
