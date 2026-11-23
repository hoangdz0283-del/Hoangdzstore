import {
  writeAnalyticsEvent,
  type AnalyticsBucket,
  type AnalyticsEvent
} from "./analytics";
import { sha256Hex } from "./security";

type MockOperation = "put" | "get" | "list";

interface MockPutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

interface MockStoredObject {
  key: string;
  body: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export class AnalyticsR2MockAdapter implements AnalyticsBucket {
  private readonly objects = new Map<string, MockStoredObject>();
  private readonly pendingErrors = new Map<MockOperation, Error>();

  failNext(operation: MockOperation, error = new Error(`Synthetic R2 ${operation} failure.`)): void {
    this.pendingErrors.set(operation, error);
  }

  private throwPending(operation: MockOperation): void {
    const error = this.pendingErrors.get(operation);
    if (!error) return;
    this.pendingErrors.delete(operation);
    throw error;
  }

  async put(key: string, value: string, options: MockPutOptions = {}): Promise<void> {
    this.throwPending("put");
    this.objects.set(key, {
      key,
      body: value,
      httpMetadata: options.httpMetadata,
      customMetadata: options.customMetadata ? { ...options.customMetadata } : undefined
    });
  }

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    this.throwPending("get");
    const object = this.objects.get(key);
    if (!object) return null;
    return { text: async () => object.body };
  }

  async list(options: {
    prefix?: string;
    limit?: number;
    include?: ("customMetadata" | "httpMetadata")[];
    cursor?: string;
    startAfter?: string;
  }): Promise<{
    objects: Array<{ key: string; customMetadata?: Record<string, string> }>;
    truncated: boolean;
    cursor?: string;
  }> {
    this.throwPending("list");
    const prefix = options.prefix || "";
    const sorted = [...this.objects.values()]
      .filter(object => object.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key));
    const offset = options.cursor
      ? this.parseCursor(options.cursor)
      : options.startAfter
        ? sorted.findIndex(object => object.key > options.startAfter!)
        : 0;
    const start = offset < 0 ? sorted.length : offset;
    const limit = options.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError("Synthetic R2 list limit must be between 1 and 1000.");
    }
    const page = sorted.slice(start, start + limit);
    const truncated = start + page.length < sorted.length;
    return {
      objects: page.map(object => ({
        key: object.key,
        ...(options.include?.includes("customMetadata") && object.customMetadata
          ? { customMetadata: { ...object.customMetadata } }
          : {})
      })),
      truncated,
      ...(truncated ? { cursor: `mock-${start + page.length}` } : {})
    };
  }

  private parseCursor(cursor: string): number {
    const match = /^mock-(\d+)$/.exec(cursor);
    if (!match) throw new TypeError("Invalid synthetic R2 cursor.");
    return Number(match[1]);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_USERS = 150;
const DEMO_PRODUCT_IDS = [1, 2, 3, 4, 5];
const DEMO_SEARCH_TERMS = ["demo iphone", "demo laptop", "demo tablet", "demo phụ kiện"];

function syntheticUuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function syntheticEventId(value: number): string {
  return `00000000-0000-4000-8000-${(value + 1).toString(16).padStart(12, "0")}`;
}

function syntheticPayload(eventType: AnalyticsEvent["event_type"], index: number): AnalyticsEvent["payload"] {
  switch (eventType) {
    case "page_view":
      return { page: ["home", "products", "product", "orders"][index % 4] };
    case "product_view":
      return { product_id: DEMO_PRODUCT_IDS[index % DEMO_PRODUCT_IDS.length] };
    case "search":
      return { term: DEMO_SEARCH_TERMS[index % DEMO_SEARCH_TERMS.length] };
    case "add_to_cart":
      return { product_id: DEMO_PRODUCT_IDS[index % DEMO_PRODUCT_IDS.length], quantity: (index % 3) + 1 };
    case "checkout_started":
    case "order_created":
      return { item_count: (index % 3) + 1 };
    case "chatbot_interaction":
      return { interaction: index % 2 ? "message" : "order_lookup" };
  }
}

export async function createSyntheticAnalyticsBucket(now = Date.now()): Promise<AnalyticsR2MockAdapter> {
  const bucket = new AnalyticsR2MockAdapter();
  const anonymousIds = await Promise.all(
    Array.from({ length: DEMO_USERS }, (_, index) => sha256Hex(`synthetic-demo-user-${index + 1}`))
  );

  let eventIndex = 0;
  for (let userIndex = 0; userIndex < DEMO_USERS; userIndex++) {
    const journey: AnalyticsEvent["event_type"][] = ["page_view"];
    if (userIndex < 120) journey.push("product_view");
    if (userIndex < 80) journey.push("search");
    if (userIndex < 60) journey.push("add_to_cart");
    if (userIndex < 45) journey.push("checkout_started");
    if (userIndex < 30) journey.push("order_created");
    if (userIndex < 15) journey.push("chatbot_interaction");

    const day = Math.floor(userIndex * 90 / DEMO_USERS);
    for (let slot = 0; slot < journey.length; slot++) {
      const eventType = journey[slot];
      const timestamp = new Date(now - day * DAY_MS - (journey.length - slot) * 15 * 60 * 1000 - 1);
      const event: AnalyticsEvent = {
        timestamp_utc: timestamp.toISOString(),
        timestamp_epoch_ms: timestamp.getTime(),
        event_id: syntheticEventId(eventIndex),
        event_type: eventType,
        anonymous_id: anonymousIds[userIndex],
        payload: syntheticPayload(eventType, eventIndex),
        data_source: "synthetic_demo"
      };
      await writeAnalyticsEvent(bucket, event);
      eventIndex++;
    }
  }

  return bucket;
}

