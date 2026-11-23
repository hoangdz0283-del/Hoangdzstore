import { sha256Hex } from "./security";

export const ANALYTICS_EVENT_TYPES = [
  "page_view",
  "product_view",
  "search",
  "chatbot_interaction",
  "add_to_cart",
  "checkout_started",
  "order_created"
] as const;

export type AnalyticsEventType = typeof ANALYTICS_EVENT_TYPES[number];
export type AnalyticsRange = "24h" | "7d" | "90d";
export type AnalyticsDataMode = "demo" | "local" | "production";

export interface AnalyticsBucket {
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<unknown>;
  list(options: {
    prefix?: string;
    limit?: number;
    include?: ("customMetadata" | "httpMetadata")[];
    cursor?: string;
    startAfter?: string;
  }): Promise<{
    objects: Array<{ key: string; customMetadata?: Record<string, string> }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface AnalyticsEvent {
  timestamp_utc: string;
  timestamp_epoch_ms: number;
  event_id: string;
  event_type: AnalyticsEventType;
  anonymous_id: string;
  payload: Record<string, string | number>;
  data_source?: "synthetic_demo";
}

export interface StoredAnalyticsEvent {
  timestamp_utc: string;
  timestamp_epoch_ms: number;
  event_id: string;
  event_type: AnalyticsEventType;
  anonymous_id: string;
  payload: Record<string, string | number>;
  product_id?: number;
  search_term?: string;
  page?: string;
  interaction?: string;
  item_count?: number;
}

interface TimeRange {
  start: number;
  end: number;
}

interface AnalyticsEnvironment {
  DB: D1Database;
  ANALYTICS_BUCKET?: AnalyticsBucket;
  ANALYTICS_MODE?: AnalyticsDataMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProductId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function safeSearchTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const term = value.trim().replace(/\s+/g, " ").slice(0, 80);
  const normalized = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi");
  const sensitiveTerms = [
    "password", "passwd", "passphrase", "password_hash", "hash", "token", "secret",
    "authorization", "bearer", "api key", "api_key", "apikey", "mat khau", "cvv",
    "cvc", "credit card", "debit card", "card number", "payment", "thanh toan",
    "ngan hang", "tai khoan", "so tai khoan"
  ];
  const hasSensitiveValue =
    /[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i.test(term) ||
    /\+?\d[\d\s().-]{7,}\d/.test(term) ||
    /(?:\d[\s-]?){13,19}/.test(term) ||
    /\b[a-f0-9]{32,}\b/i.test(term) ||
    /^[a-z0-9_-]{16,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}$/i.test(term) ||
    sensitiveTerms.some(sensitiveTerm => normalized.includes(sensitiveTerm));
  if (!term || hasSensitiveValue) {
    return null;
  }
  return term;
}

export async function createAnalyticsEvent(
  input: Record<string, unknown>,
  now = new Date()
): Promise<AnalyticsEvent> {
  const eventType = input.event_type;
  const anonymousId = input.anonymous_id;
  if (typeof eventType !== "string" ||
      !ANALYTICS_EVENT_TYPES.includes(eventType as AnalyticsEventType)) {
    throw new TypeError("Invalid analytics event type.");
  }
  if (typeof anonymousId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anonymousId)) {
    throw new TypeError("Invalid anonymous analytics identifier.");
  }
  const suppliedPayload = input.payload;
  const payload = isRecord(suppliedPayload) ? suppliedPayload : {};
  const safePayload: AnalyticsEvent["payload"] = {};

  switch (eventType) {
    case "page_view": {
      const page = payload.page;
      if (typeof page === "string" && ["home", "products", "orders", "product"].includes(page)) {
        safePayload.page = page;
      }
      break;
    }
    case "product_view":
    case "add_to_cart": {
      if (!isProductId(payload.product_id)) throw new TypeError("Invalid analytics product id.");
      safePayload.product_id = payload.product_id;
      if (eventType === "add_to_cart" && typeof payload.quantity === "number" &&
          Number.isSafeInteger(payload.quantity) && payload.quantity > 0 && payload.quantity <= 100) {
        safePayload.quantity = payload.quantity;
      }
      break;
    }
    case "search": {
      const term = safeSearchTerm(payload.term);
      if (term) safePayload.term = term;
      break;
    }
    case "chatbot_interaction": {
      if (payload.interaction === "message" || payload.interaction === "order_lookup") {
        safePayload.interaction = payload.interaction;
      }
      break;
    }
    case "checkout_started":
    case "order_created": {
      if (typeof payload.item_count === "number" &&
          Number.isSafeInteger(payload.item_count) && payload.item_count >= 1 && payload.item_count <= 50) {
        safePayload.item_count = payload.item_count;
      }
      break;
    }
  }

  const timestamp = now.toISOString();
  return {
    timestamp_utc: timestamp,
    timestamp_epoch_ms: now.getTime(),
    event_id: crypto.randomUUID(),
    event_type: eventType as AnalyticsEventType,
    anonymous_id: await sha256Hex(anonymousId.toLowerCase()),
    payload: safePayload
  };
}

function eventDateParts(date: Date): { date: string; hour: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: value("hour")
  };
}

function utcDateParts(date: Date): { date: string; hour: string } {
  const iso = date.toISOString();
  return { date: iso.slice(0, 10), hour: iso.slice(11, 13) };
}

function eventMetadata(event: AnalyticsEvent): Record<string, string> {
  const metadata: Record<string, string> = {
    eventId: event.event_id,
    eventType: event.event_type,
    timestampUtc: event.timestamp_utc,
    timestampEpochMs: String(event.timestamp_epoch_ms),
    anonymousId: event.anonymous_id
  };
  for (const [key, value] of Object.entries(event.payload)) {
    const metadataKey = {
      product_id: "productId",
      search_term: "searchTerm",
      page: "page",
      interaction: "interaction",
      item_count: "itemCount",
      quantity: "quantity",
      term: "searchTerm"
    }[key];
    if (metadataKey) metadata[metadataKey] = String(value);
  }
  return metadata;
}

export async function writeAnalyticsEvent(
  bucket: Pick<AnalyticsBucket, "put">,
  event: AnalyticsEvent
): Promise<void> {
  const parts = utcDateParts(new Date(event.timestamp_epoch_ms));
  const key = `events/${parts.date.replace(/-/g, "/")}/${parts.hour}/${event.event_id}.jsonl`;
  const stored = {
    timestamp_utc: event.timestamp_utc,
    timestamp_epoch_ms: event.timestamp_epoch_ms,
    event_id: event.event_id,
    event_type: event.event_type,
    anonymous_id: event.anonymous_id,
    payload: event.payload,
    ...(event.data_source ? { data_source: event.data_source } : {})
  };
  await bucket.put(key, `${JSON.stringify(stored)}\n`, {
    httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
    customMetadata: eventMetadata(event)
  });
}

function rangeFor(value: string, now: number): { name: AnalyticsRange; range: TimeRange } {
  const duration = value === "24h" ? 24 * 60 * 60 * 1000
    : value === "7d" ? 7 * 24 * 60 * 60 * 1000
      : value === "90d" ? 90 * 24 * 60 * 60 * 1000 : 0;
  if (!duration) throw new TypeError("Invalid analytics range.");
  return { name: value as AnalyticsRange, range: { start: now - duration, end: now } };
}

export interface AnalyticsReport {
  data_mode: AnalyticsDataMode;
  range: AnalyticsRange;
  timezone: "Asia/Ho_Chi_Minh";
  range_start: string;
  range_end: string;
  events: StoredAnalyticsEvent[];
  event_count: number;
  next_cursor: string | null;
  metrics: {
    page_views: number;
    active_users: number;
    product_views: number;
    searches: number;
    cart_adds: number;
    chatbot_interactions: number;
    tracked_orders: number;
    checkouts: number;
    view_to_cart_rate: number;
    cart_to_order_rate: number;
    checkout_to_order_rate: number;
    active_users_by_period: Record<string, number>;
    top_products: Array<{ product_id: number; name: string; views: number }>;
    top_search_terms: Array<{ term: string; searches: number }>;
  };
  orders_total: number;
  orders_by_period: Record<string, number>;
  orders_truncated: boolean;
}

export async function buildAnalyticsReport(
  env: AnalyticsEnvironment,
  rangeValue: string,
  cursor: string | null,
  now = Date.now()
): Promise<AnalyticsReport> {
  const { name, range } = rangeFor(rangeValue, now);
  if (!env.ANALYTICS_BUCKET) throw new Error("Analytics R2 bucket is not configured.");
  const dataMode = env.ANALYTICS_MODE || "production";

  const startIso = new Date(range.start).toISOString();
  const endIso = new Date(range.end).toISOString();
  const startParts = utcDateParts(new Date(range.start));
  const firstKey = `events/${startParts.date.replace(/-/g, "/")}/`;
  if (cursor && (cursor.length > 4096 || !/^[\w+/=-]+$/.test(cursor))) {
    throw new TypeError("Invalid analytics cursor.");
  }
  const listed = await env.ANALYTICS_BUCKET.list({
    prefix: "events/",
    limit: 500,
    include: ["customMetadata"],
    ...(cursor ? { cursor } : { startAfter: firstKey })
  });

  const events: StoredAnalyticsEvent[] = [];
  for (const object of listed.objects) {
    const metadata = object.customMetadata || {};
    const eventType = metadata.eventType;
    const timestamp = Number(metadata.timestampEpochMs);
    const anonymousId = metadata.anonymousId;
    const eventId = metadata.eventId;
    if (!ANALYTICS_EVENT_TYPES.includes(eventType as AnalyticsEventType) ||
        !Number.isSafeInteger(timestamp) || timestamp < range.start || timestamp > range.end ||
        !anonymousId || !/^[0-9a-f]{64}$/.test(anonymousId) ||
        !eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
      continue;
    }
    const event: StoredAnalyticsEvent = {
      timestamp_utc: metadata.timestampUtc || new Date(timestamp).toISOString(),
      timestamp_epoch_ms: timestamp,
      event_id: eventId,
      event_type: eventType as AnalyticsEventType,
      anonymous_id: anonymousId,
      payload: {}
    };
    const productId = Number(metadata.productId);
    if (Number.isSafeInteger(productId) && productId > 0) {
      event.product_id = productId;
      event.payload.product_id = productId;
    }
    if (metadata.searchTerm) {
      event.search_term = metadata.searchTerm.slice(0, 80);
      event.payload.term = event.search_term;
    }
    if (metadata.page) {
      event.page = metadata.page;
      event.payload.page = metadata.page;
    }
    if (metadata.interaction) {
      event.interaction = metadata.interaction;
      event.payload.interaction = metadata.interaction;
    }
    if (Number.isSafeInteger(Number(metadata.itemCount))) {
      event.item_count = Number(metadata.itemCount);
      event.payload.item_count = event.item_count;
    }
    events.push(event);
  }

  const eventCounts = new Map<AnalyticsEventType, number>();
  const activeUsers = new Set<string>();
  const activeUsersByPeriod = new Map<string, Set<string>>();
  const productViews = new Map<number, number>();
  const searchTerms = new Map<string, number>();
  const periodKey = (timestamp: number) => {
    const parts = eventDateParts(new Date(timestamp));
    return name === "24h" ? `${parts.date} ${parts.hour}:00` : parts.date;
  };
  for (const event of events) {
    eventCounts.set(event.event_type, (eventCounts.get(event.event_type) || 0) + 1);
    activeUsers.add(event.anonymous_id);
    const period = periodKey(event.timestamp_epoch_ms);
    const visitors = activeUsersByPeriod.get(period) || new Set<string>();
    visitors.add(event.anonymous_id);
    activeUsersByPeriod.set(period, visitors);
    if (event.event_type === "product_view" && event.product_id) {
      productViews.set(event.product_id, (productViews.get(event.product_id) || 0) + 1);
    }
    if (event.event_type === "search" && event.search_term) {
      searchTerms.set(event.search_term, (searchTerms.get(event.search_term) || 0) + 1);
    }
  }

  const topProductRows = [...productViews.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
  const productNames = new Map<number, string>();
  if (dataMode === "demo") {
    for (const [productId, views] of topProductRows) {
      productNames.set(productId, `Sản phẩm Demo ${String(productId).padStart(2, "0")}`);
    }
  } else if (topProductRows.length) {
    const placeholders = topProductRows.map(() => "?").join(",");
    const productRows = await env.DB.prepare(
      `SELECT id, name FROM products WHERE id IN (${placeholders})`
    ).bind(...topProductRows.map(([id]) => id)).all<{ id: number; name: string }>();
    for (const product of productRows.results) productNames.set(product.id, product.name);
  }
  const pageViews = eventCounts.get("page_view") || 0;
  const productViewCount = eventCounts.get("product_view") || 0;
  const cartAdds = eventCounts.get("add_to_cart") || 0;
  const checkouts = eventCounts.get("checkout_started") || 0;
  const trackedOrders = eventCounts.get("order_created") || 0;

  const ordersByPeriod: Record<string, number> = {};
  let ordersTotal = trackedOrders;
  let ordersTruncated = false;
  if (dataMode === "demo") {
    for (const event of events) {
      if (event.event_type !== "order_created") continue;
      const parts = eventDateParts(new Date(event.timestamp_epoch_ms));
      const key = name === "24h" ? `${parts.date} ${parts.hour}:00` : parts.date;
      ordersByPeriod[key] = (ordersByPeriod[key] || 0) + 1;
    }
  } else {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM orders WHERE created_at >= ? AND created_at <= ?"
    ).bind(startIso, endIso).first<{ total: number }>();
    const orderRows = await env.DB.prepare(
      "SELECT created_at FROM orders WHERE created_at >= ? AND created_at <= ? ORDER BY created_at LIMIT 1001"
    ).bind(startIso, endIso).all<{ created_at: string }>();
    ordersTotal = Number(count?.total || 0);
    ordersTruncated = orderRows.results.length > 1000;
    for (const order of orderRows.results.slice(0, 1000)) {
      const parts = eventDateParts(new Date(order.created_at));
      const key = name === "24h" ? `${parts.date} ${parts.hour}:00` : parts.date;
      ordersByPeriod[key] = (ordersByPeriod[key] || 0) + 1;
    }
  }

  return {
    data_mode: dataMode,
    range: name,
    timezone: "Asia/Ho_Chi_Minh",
    range_start: startIso,
    range_end: endIso,
    events,
    event_count: events.length,
    next_cursor: listed.truncated ? listed.cursor || null : null,
    metrics: {
      page_views: pageViews,
      active_users: activeUsers.size,
      product_views: productViewCount,
      searches: eventCounts.get("search") || 0,
      cart_adds: cartAdds,
      chatbot_interactions: eventCounts.get("chatbot_interaction") || 0,
      tracked_orders: trackedOrders,
      checkouts,
      view_to_cart_rate: productViewCount ? cartAdds / productViewCount : 0,
      cart_to_order_rate: cartAdds ? trackedOrders / cartAdds : 0,
      checkout_to_order_rate: checkouts ? ordersTotal / checkouts : 0,
      active_users_by_period: Object.fromEntries(
        [...activeUsersByPeriod.entries()].map(([key, visitors]) => [key, visitors.size])
      ),
      top_products: topProductRows.map(([product_id, views]) => ({
        product_id,
        name: productNames.get(product_id) || `Sản phẩm #${product_id}`,
        views
      })),
      top_search_terms: [...searchTerms.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([term, searches]) => ({ term, searches }))
    },
    orders_total: ordersTotal,
    orders_by_period: ordersByPeriod,
    orders_truncated: ordersTruncated
  };
}
