import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { hash as bcryptHash } from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccessToken,
  hashPassword,
  hashResetToken,
  verifyAccessToken,
  verifyPassword
} from "../workers/security";
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_TIMEOUT_MS,
  generateAiReply,
  isAiConfigured,
  resolveAiReply,
  shouldUseAiForChat,
  type AiEnvironment
} from "../workers/ai";
import { buildAnalyticsReport, createAnalyticsEvent, writeAnalyticsEvent } from "../workers/analytics";
import { AnalyticsR2MockAdapter, createSyntheticAnalyticsBucket } from "../workers/analytics-demo";
import worker from "../workers/worker";

const secret = "local-test-secret-at-least-32-characters";
const customerPassword = "Sample account password 123!";
let customerHash: string;
let legacyHash: string;

async function request(
  path: string,
  init: RequestInit = {},
  token?: string,
  origin = "https://hoangdzstore.pages.dev"
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return SELF.fetch(new Request(`https://hoangdz-store-api.test${path}`, { ...init, headers }));
}

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

async function createOrder(
  token: string,
  key: string,
  quantity = 2,
  paymentMethod = "cod"
): Promise<Response> {
  return request("/api/orders/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key
    },
    body: JSON.stringify({
      recipient_name: "Test Recipient",
      recipient_phone: "0900000000",
      shipping_address: "1 Test Street, Ho Chi Minh City",
      payment_method: paymentMethod,
      items: [{ product_id: 10, quantity }]
    })
  }, token);
}

beforeAll(async () => {
  customerHash = await hashPassword(customerPassword);
  legacyHash = await bcryptHash("Legacy password 123", 12);
});

beforeEach(async () => {
  const storedEvents = await env.ANALYTICS_BUCKET.list({ prefix: "events/", limit: 1000 });
  await Promise.all(storedEvents.objects.map(object => env.ANALYTICS_BUCKET.delete(object.key)));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM order_items"),
    env.DB.prepare("DELETE FROM password_reset_tokens"),
    env.DB.prepare("DELETE FROM orders"),
    env.DB.prepare("DELETE FROM products"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM auth_rate_limits"),
    env.DB.prepare(`INSERT INTO users (
      id, full_name, email, email_normalized, password_hash, role, created_at
    ) VALUES (1, 'Test Customer', 'customer@example.com', 'customer@example.com', ?, 'customer', ?)`)
      .bind(customerHash, new Date().toISOString()),
    env.DB.prepare(`INSERT INTO products (
      id, name, category, price, sale_price, image, brand, stock, specifications, is_active
    ) VALUES (10, 'Test Laptop', 'Laptop', 1000, 800, NULL, 'Test', 3, NULL, 1)`)
  ]);
});

describe("Cloudflare Worker API", () => {
  it("supports registration, normalized login, bearer profile, and rejects expired tokens", async () => {
    const registration = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "New Customer",
        email: "New.Customer@example.com",
        password: "A secure password 123"
      })
    });
    expect(registration.status).toBe(201);
    const registered = await json(registration);
    const stored = await env.DB.prepare("SELECT email, email_normalized, password_hash FROM users WHERE id = ?")
      .bind(registered.user_id).first<{ email: string; email_normalized: string; password_hash: string }>();
    expect(stored?.email_normalized).toBe("new.customer@example.com");
    expect(stored?.password_hash).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(stored?.password_hash).not.toContain("A secure password 123");

    const login = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "NEW.CUSTOMER@example.com", password: "A secure password 123" })
    });
    expect(login.status).toBe(200);
    const loggedIn = await json(login);
    expect(loggedIn.token_type).toBe("bearer");
    const profile = await request("/api/auth/me", {}, loggedIn.access_token);
    expect(profile.status).toBe(200);
    expect((await json(profile)).email).toBe("New.Customer@example.com");

    const expiredPayload = btoa(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) - 1 }))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const unsigned = `${expiredHeader}.${expiredPayload}`;
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned)));
    const binary = String.fromCharCode(...signature);
    const expiredToken = `${unsigned}.${btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
    expect(await verifyAccessToken(expiredToken, secret)).toBeNull();
    expect((await request("/api/auth/me", {}, expiredToken)).status).toBe(401);
  });

  it("preserves CORS headers on failed login and registration responses", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@example.com", password: "wrong password" })
    });
    expect(login.status).toBe(401);
    expect(login.headers.get("Access-Control-Allow-Origin")).toBe("https://hoangdzstore.pages.dev");

    const registration = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "Existing Customer",
        email: "customer@example.com",
        password: "A secure password 123"
      })
    });
    expect(registration.status).toBe(400);
    expect(registration.headers.get("Access-Control-Allow-Origin")).toBe("https://hoangdzstore.pages.dev");
  });

  it("returns client errors rather than 500 for missing or invalid auth input", async () => {
    const cases = [
      request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new@example.com", password: "A secure password 123" })
      }),
      request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: "New Customer",
          email: "not-an-email",
          password: "A secure password 123"
        })
      }),
      request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "customer@example.com" })
      }),
      request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid-json"
      })
    ];

    const responses = await Promise.all(cases);
    expect(responses.map(response => response.status)).toEqual([422, 422, 422, 400]);
    expect(responses.every(response => response.status < 500)).toBe(true);
  });

  it("logs safe stack context for server errors without exposing it to clients", async () => {
    await env.DB.prepare("UPDATE products SET specifications = ? WHERE id = ?").bind("{", 10).run();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await request("/api/products");
      expect(response.status).toBe(500);
      expect((await json(response)).detail).toBe("Lỗi máy chủ nội bộ.");

      expect(errorLog).toHaveBeenCalledOnce();
      const details = JSON.parse(String(errorLog.mock.calls[0][1])) as {
        method: string;
        path: string;
        errorName: string;
        stack: string[];
      };
      expect(details.method).toBe("GET");
      expect(details.path).toBe("/api/products");
      expect(details.errorName).toBe("SyntaxError");
      expect(details.stack.length).toBeGreaterThan(0);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("consumes a legacy password reset token once and stores only a password hash", async () => {
    const resetToken = "private-one-time-reset-token-1234567890";
    await env.DB.prepare(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
      VALUES (?, 1, ?)`)
      .bind(await hashResetToken(resetToken), Date.now() + 60_000).run();

    const reset = () => request("/api/auth/reset-legacy-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@example.com",
        token: resetToken,
        new_password: "Replacement password 123!"
      })
    });
    expect((await reset()).status).toBe(200);
    expect((await reset()).status).toBe(400);

    const stored = await env.DB.prepare("SELECT password_hash FROM users WHERE id = 1")
      .first<{ password_hash: string }>();
    expect(stored?.password_hash).toMatch(/^pbkdf2_sha256\$100000\$/);
    await expect(verifyPassword("Replacement password 123!", stored?.password_hash || "")).resolves.toBe(true);
  });

  it("keeps legacy bcrypt verification available without weakening its stored hash", async () => {
    await expect(verifyPassword("Legacy password 123", legacyHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", legacyHash)).resolves.toBe(false);
  });

  it("authenticates a legacy bcrypt account through the login API", async () => {
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = 1").bind(legacyHash).run();

    const login = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@example.com", password: "Legacy password 123" })
    });
    expect(login.status).toBe(200);
    const loggedIn = await json(login);
    expect(loggedIn.token_type).toBe("bearer");

    const profile = await request("/api/auth/me", {}, loggedIn.access_token);
    expect(profile.status).toBe(200);
  });

  it("rejects PBKDF2 iteration counts unsupported by the Workers runtime", async () => {
    await expect(verifyPassword("sample", "pbkdf2_sha256$600000$AA$AA")).resolves.toBe(false);
    await expect(verifyPassword("sample", "$2b$12$truncated")).resolves.toBe(false);
  });

  it("requires the Admin role on server-side Admin APIs", async () => {
    const customerToken = await createAccessToken(1, secret);
    expect((await request("/api/admin/products", {}, customerToken)).status).toBe(403);
    expect((await request("/api/admin/products")).status).toBe(401);

    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
    const adminToken = await createAccessToken(1, secret);
    const response = await request("/api/admin/products", {}, adminToken);
    expect(response.status).toBe(200);
    expect((await json(response)).total).toBe(1);
  });

  it("supports Admin product, inventory, customer, and visibility management", async () => {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
    await env.DB.prepare(`INSERT INTO users (
      id, full_name, email, email_normalized, password_hash, role, created_at
    ) VALUES (2, 'Second Customer', 'second@example.com', 'second@example.com', ?, 'customer', ?)`)
      .bind(customerHash, new Date().toISOString()).run();
    const adminToken = await createAccessToken(1, secret);

    const createdProduct = await request("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Created Test Tablet",
        brand: "Test",
        category: "Tablet",
        price: 500,
        sale_price: null,
        stock: 5,
        is_active: true,
        specifications: { storage: "128 GB" }
      })
    }, adminToken);
    expect(createdProduct.status).toBe(201);
    const product = await json(createdProduct);
    expect(product.specifications).toEqual({ storage: "128 GB" });

    const updatedProduct = await request(`/api/admin/products/${product.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated Test Tablet",
        brand: "Test",
        category: "Tablet",
        price: 600,
        sale_price: 550,
        stock: 5,
        is_active: true,
        specifications: { storage: "256 GB" }
      })
    }, adminToken);
    expect((await json(updatedProduct)).sale_price).toBe(550);

    const stockUpdate = await request(`/api/admin/products/${product.id}/stock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock: 8 })
    }, adminToken);
    expect((await json(stockUpdate)).stock).toBe(8);

    const hidden = await request(`/api/admin/products/${product.id}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false })
    }, adminToken);
    expect((await json(hidden)).is_active).toBe(false);
    const publicCatalog = await request("/api/products");
    expect((await publicCatalog.json() as unknown[]).length).toBe(1);

    const customers = await request("/api/admin/customers", {}, adminToken);
    expect((await json(customers)).total).toBe(1);
    const customer = await request("/api/admin/customers/2", {}, adminToken);
    expect((await json(customer)).order_count).toBe(0);
    const updatedCustomer = await request("/api/admin/customers/2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "Updated Customer",
        phone: "0900000000",
        address: "2 Test Street"
      })
    }, adminToken);
    expect((await json(updatedCustomer)).full_name).toBe("Updated Customer");
  });

  it("uses database price, reserves stock, and restores stock only once on cancellation", async () => {
    const token = await createAccessToken(1, secret);
    const response = await createOrder(token, "checkout-success-001");
    expect(response.status).toBe(201);
    const created = await json(response);
    expect(created.total_amount).toBe(1600);

    const retry = await createOrder(token, "checkout-success-001");
    expect((await json(retry)).order_id).toBe(created.order_id);
    const changedRetry = await createOrder(token, "checkout-success-001", 1);
    expect(changedRetry.status).toBe(409);

    const stockAfterCheckout = await env.DB.prepare("SELECT stock FROM products WHERE id = 10")
      .first<{ stock: number }>();
    expect(stockAfterCheckout?.stock).toBe(1);
    const item = await env.DB.prepare("SELECT unit_price, quantity, stock_deducted FROM order_items WHERE order_id = ?")
      .bind(created.order_id).first<{ unit_price: number; quantity: number; stock_deducted: number }>();
    expect(item).toEqual({ unit_price: 800, quantity: 2, stock_deducted: 1 });
    expect((await json(await request(`/api/orders/${created.order_id}`, {}, token))).id).toBe(created.order_id);
    expect((await json(await request("/api/orders/", {}, token))).total).toBe(1);

    const cancelled = await request(`/api/orders/${created.order_id}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Test cancellation" })
    }, token);
    expect(cancelled.status).toBe(200);
    expect((await json(cancelled)).status).toBe("cancelled");
    expect((await env.DB.prepare("SELECT stock FROM products WHERE id = 10").first<{ stock: number }>())?.stock).toBe(3);

    const repeatedCancel = await request(`/api/orders/${created.order_id}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Second attempt" })
    }, token);
    expect(repeatedCancel.status).toBe(400);
    expect((await env.DB.prepare("SELECT stock FROM products WHERE id = 10").first<{ stock: number }>())?.stock).toBe(3);
  });

  it("keeps bank transfers unpaid until Admin confirmation and enforces order transitions", async () => {
    const customerToken = await createAccessToken(1, secret);
    const checkout = await createOrder(customerToken, "checkout-bank-transfer-001", 1, "bank_transfer");
    expect(checkout.status).toBe(201);
    const checkoutResult = await json(checkout);
    expect(checkoutResult.payment_status).toBe("unpaid");

    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
    const adminToken = await createAccessToken(1, secret);
    const orderId = checkoutResult.order_id as number;
    const confirm = await request(`/api/orders/admin/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" })
    }, adminToken);
    expect(confirm.status).toBe(200);

    const skipStep = await request(`/api/orders/admin/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "delivered" })
    }, adminToken);
    expect(skipStep.status).toBe(400);

    const paid = await request(`/api/orders/admin/${orderId}/payment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_status: "paid" })
    }, adminToken);
    expect(paid.status).toBe(200);
    const adminDetail = await request(`/api/orders/admin/${orderId}`, {}, adminToken);
    expect((await json(adminDetail)).user_email).toBe("customer@example.com");
    const adminPage = await request("/api/orders/admin/all?search=customer", {}, adminToken);
    expect((await json(adminPage)).total).toBe(1);
    const summary = await json(await request("/api/orders/admin/summary", {}, adminToken));
    expect(summary.revenue_total).toBe(800);
  });

  it("does not expose a customer's orders to another authenticated account", async () => {
    const ownerToken = await createAccessToken(1, secret);
    const checkout = await createOrder(ownerToken, "checkout-owner-only-001", 1);
    const orderId = (await json(checkout)).order_id as number;
    await env.DB.prepare(`INSERT INTO users (
      id, full_name, email, email_normalized, password_hash, role, created_at
    ) VALUES (2, 'Other Customer', 'other@example.com', 'other@example.com', ?, 'customer', ?)`)
      .bind(customerHash, new Date().toISOString()).run();
    const otherToken = await createAccessToken(2, secret);

    expect((await request(`/api/orders/${orderId}`, {}, otherToken)).status).toBe(404);
    expect((await json(await request("/api/orders/", {}, otherToken))).total).toBe(0);
  });

  it("rejects insufficient stock without creating an order", async () => {
    const token = await createAccessToken(1, secret);
    const response = await createOrder(token, "checkout-out-of-stock-001", 4);
    expect(response.status).toBe(409);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first<{ count: number }>())?.count).toBe(0);
    expect((await env.DB.prepare("SELECT stock FROM products WHERE id = 10").first<{ stock: number }>())?.stock).toBe(3);
  });

  it("allows only one simultaneous checkout for the final unit", async () => {
    await env.DB.prepare("UPDATE products SET stock = 1 WHERE id = 10").run();
    const token = await createAccessToken(1, secret);
    const responses = await Promise.all([
      createOrder(token, "checkout-concurrent-001", 1),
      createOrder(token, "checkout-concurrent-002", 1)
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect((await env.DB.prepare("SELECT stock FROM products WHERE id = 10").first<{ stock: number }>())?.stock).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first<{ count: number }>())?.count).toBe(1);
  });

  it("does not allow cross-origin browser access from an unlisted origin", async () => {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await SELF.fetch(new Request("https://hoangdz-store-api.test/health", {
        method,
        headers: {
          Origin: "https://attacker.example",
          ...(method === "OPTIONS"
            ? {
              "Access-Control-Request-Method": "GET",
              "Access-Control-Request-Headers": "authorization,content-type"
            }
            : {})
        }
      }));
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("applies CORS to local GET, API errors, and preflight requests", async () => {
    const localOrigins = ["http://localhost:5500", "http://127.0.0.1:5500"];
    for (const origin of localOrigins) {
      const products = await request("/api/products", {}, undefined, origin);
      expect(products.status).toBe(200);
      expect(products.headers.get("Access-Control-Allow-Origin")).toBe(origin);

      const unauthorized = await request("/api/orders/", {}, undefined, origin);
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBe(origin);

      const failedLogin = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "customer@example.com", password: "wrong password" })
      }, undefined, origin);
      expect(failedLogin.status).toBe(401);
      expect(failedLogin.headers.get("Access-Control-Allow-Origin")).toBe(origin);

      const preflight = await request("/api/products", {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,content-type,idempotency-key"
        }
      }, undefined, origin);
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(preflight.headers.get("Access-Control-Allow-Methods")?.split(",").map(value => value.trim()))
        .toContain("GET");
      const allowedHeaders = preflight.headers.get("Access-Control-Allow-Headers")
        ?.split(",").map(value => value.trim().toLowerCase());
      expect(allowedHeaders).toEqual(expect.arrayContaining([
        "authorization",
        "content-type",
        "idempotency-key"
      ]));
    }
  });

  it("preserves CORS on configuration errors and handles preflight before secrets are configured", async () => {
    const unconfiguredEnv = {
      DB: env.DB,
      SECRET_KEY: "",
      CORS_ORIGINS: "http://localhost:5500,http://127.0.0.1:5500"
    };
    for (const origin of ["http://localhost:5500", "http://127.0.0.1:5500"]) {
      const failedRequest = await worker.fetch(new Request("https://hoangdz-store-api.test/health", {
        headers: { Origin: origin }
      }), unconfiguredEnv);
      expect(failedRequest.status).toBe(503);
      expect(failedRequest.headers.get("Access-Control-Allow-Origin")).toBe(origin);

      const preflight = await worker.fetch(new Request("https://hoangdz-store-api.test/health", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET"
        }
      }), unconfiguredEnv);
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });

  it("uses FAQ and current product data without claiming that AI is connected", async () => {
    const status = await request("/api/chatbot/status");
    const statusBody = await json(status);
    expect(statusBody.available).toBe(true);
    expect(statusBody.chat_available).toBe(true);
    expect(statusBody.ai_configured).toBe(false);
    expect(statusBody.model_access_verified).toBe(false);
    expect(statusBody.message).toBe("Chưa kết nối AI, đang dùng tìm kiếm và FAQ.");

    const faq = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Shop có hỗ trợ chuyển khoản không?" })
    });
    expect(faq.status).toBe(200);
    expect((await json(faq)).reply).toContain("chuyển khoản thủ công");

    const purchaseGuide = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hướng dẫn đặt hàng" })
    });
    expect((await json(purchaseGuide)).reply).toContain("thêm vào giỏ");

    const chat = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Tìm Test Laptop" })
    });
    expect(chat.status).toBe(200);
    const productReply = (await json(chat)).reply as string;
    expect(productReply).toContain("Test Laptop");
    expect(productReply).toContain("800");

    const recommendation = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Tư vấn sản phẩm" })
    });
    expect((await json(recommendation)).reply).toContain("Test Laptop");
  });

  it("uses mocked Workers AI only to select recommendations already found in D1", async () => {
    const run = vi.fn(async (
      _model: string,
      _input: {
        messages: Array<{ role: "user"; content: string }>;
        max_tokens: number;
        temperature: number;
      },
      _options: { signal: AbortSignal }
    ) => ({ response: "{\"product_ids\":[10,999,10]}" }));
    const aiEnv = {
      DB: env.DB,
      SECRET_KEY: secret,
      CORS_ORIGINS: "https://hoangdzstore.pages.dev",
      AI: { run } as unknown as NonNullable<AiEnvironment["AI"]>,
      AI_PROVIDER: "workers-ai" as const,
      AI_MODEL: "mock-model"
    };

    const recommendation = await worker.fetch(new Request("https://hoangdz-store-api.test/api/chatbot/chat", {
      method: "POST",
      headers: {
        Origin: "https://hoangdzstore.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Gợi ý Test Laptop cho sinh viên" })
    }), aiEnv);
    expect(recommendation.status).toBe(200);
    const recommendationBody = await json(recommendation);
    expect(recommendationBody.mode).toBe("ai");
    expect(recommendationBody.reply).toContain("Test Laptop");
    expect(recommendationBody.reply).toContain("800");
    expect(recommendationBody.reply).not.toContain("1000");

    const [, input, options] = run.mock.calls[0];
    expect(input.messages).toHaveLength(1);
    expect(input.messages[0].role).toBe("user");
    expect(input.messages[0].content).toContain("Test Laptop");
    expect(input.messages[0].content.length).toBeLessThanOrEqual(1200);
    expect(input.max_tokens).toBeLessThanOrEqual(AI_MAX_OUTPUT_TOKENS);
    expect(options.signal).toBeInstanceOf(AbortSignal);

    const priceQuestion = await worker.fetch(new Request("https://hoangdz-store-api.test/api/chatbot/chat", {
      method: "POST",
      headers: {
        Origin: "https://hoangdzstore.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Giá Test Laptop bao nhiêu?" })
    }), aiEnv);
    expect((await json(priceQuestion)).reply).toContain("800");
    expect(run).toHaveBeenCalledOnce();
  });

  it("falls back to D1 when recommendation inference fails and does not invent unmatched products", async () => {
    const failingAi = {
      run: vi.fn(async () => {
        throw new Error("daily Neurons quota exceeded");
      })
    } as unknown as NonNullable<AiEnvironment["AI"]>;
    const aiEnv = {
      DB: env.DB,
      SECRET_KEY: secret,
      CORS_ORIGINS: "https://hoangdzstore.pages.dev",
      AI: failingAi,
      AI_PROVIDER: "workers-ai" as const,
      AI_MODEL: "mock-model"
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failedRecommendation = await worker.fetch(new Request(
        "https://hoangdz-store-api.test/api/chatbot/chat",
        {
          method: "POST",
          headers: {
            Origin: "https://hoangdzstore.pages.dev",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ message: "Gợi ý Test Laptop" })
        }
      ), aiEnv);
      const fallbackBody = await json(failedRecommendation);
      expect(fallbackBody.mode).toBe("fallback");
      expect(fallbackBody.reply).toContain("AI hiện tạm thời không khả dụng");
      expect(fallbackBody.reply).toContain("Test Laptop");
      expect(fallbackBody.reply).toContain("800");
      expect(fallbackBody.reply).not.toContain("daily Neurons");
      expect(failingAi.run).toHaveBeenCalledOnce();

      const unmatched = await worker.fetch(new Request(
        "https://hoangdz-store-api.test/api/chatbot/chat",
        {
          method: "POST",
          headers: {
            Origin: "https://hoangdzstore.pages.dev",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ message: "Gợi ý iPhone" })
        }
      ), aiEnv);
      const unmatchedBody = await json(unmatched);
      expect(unmatchedBody.reply).toContain("chưa tìm thấy sản phẩm phù hợp");
      expect(unmatchedBody.reply).not.toContain("Test Laptop");
      expect(failingAi.run).toHaveBeenCalledOnce();
    } finally {
      logError.mockRestore();
    }
  });

  it("serves chatbot FAQ without an R2 binding", async () => {
    const chatEnv = {
      DB: env.DB,
      ANALYTICS_MODE: "demo" as const,
      SECRET_KEY: secret,
      CORS_ORIGINS: "https://hoangdzstore.pages.dev"
    };
    const response = await worker.fetch(new Request("https://hoangdz-store-api.test/api/chatbot/chat", {
      method: "POST",
      headers: {
        Origin: "https://hoangdzstore.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Shop có hỗ trợ chuyển khoản không?" })
    }), chatEnv);
    expect(response.status).toBe(200);
    expect((await json(response)).reply).toContain("chuyển khoản thủ công");
  });

  it("falls back to D1/FAQ when the Workers AI model is unavailable", async () => {
    const failingAi = {
      run: vi.fn(async () => {
        throw new Error("model not found");
      })
    } as unknown as NonNullable<AiEnvironment["AI"]>;
    const aiEnv = {
      DB: env.DB,
      SECRET_KEY: secret,
      CORS_ORIGINS: "https://hoangdzstore.pages.dev",
      AI: failingAi,
      AI_PROVIDER: "workers-ai" as const,
      AI_MODEL: "mock-unavailable-model"
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await worker.fetch(new Request("https://hoangdz-store-api.test/api/chatbot/chat", {
        method: "POST",
        headers: {
          Origin: "https://hoangdzstore.pages.dev",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: "Tư vấn" })
      }), aiEnv);
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.mode).toBe("fallback");
      expect(body.reply).toContain("AI hiện tạm thời không khả dụng");
      expect(body.reply).not.toContain("model not found");
      expect(failingAi.run).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith("AI provider invocation failed", "{\"failure\":\"model_unavailable\"}");
    } finally {
      logError.mockRestore();
    }
  });

  it("uses only the mocked Workers AI binding with bounded single-turn input", async () => {
    const model = "mock-workers-ai-model";
    const run = vi.fn(async (
      _model: string,
      _input: {
        messages: Array<{ role: "user"; content: string }>;
        max_tokens: number;
        temperature: number;
      },
      _options: { signal: AbortSignal }
    ) => ({ response: "Xin chào! Bạn cần hỗ trợ gì?" }));
    const ai = { run } as unknown as NonNullable<AiEnvironment["AI"]>;
    const aiEnv: AiEnvironment = { AI: ai, AI_PROVIDER: "workers-ai", AI_MODEL: model };

    expect(isAiConfigured(aiEnv)).toBe(true);
    await expect(generateAiReply(aiEnv, "  " + "x".repeat(1300)))
      .resolves.toBe("Xin chào! Bạn cần hỗ trợ gì?");
    expect(run).toHaveBeenCalledTimes(1);
    const [calledModel, input, options] = run.mock.calls[0];
    expect(calledModel).toBe(model);
    expect(input.messages).toHaveLength(1);
    expect(input.messages[0].role).toBe("user");
    expect(input.messages[0].content.length).toBeLessThanOrEqual(1200);
    expect(input.max_tokens).toBe(AI_MAX_OUTPUT_TOKENS);
    expect(input.max_tokens).toBeLessThanOrEqual(256);
    expect(input.temperature).toBe(0.2);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(AI_TIMEOUT_MS).toBe(8000);

    const unsafeAi = {
      run: vi.fn(async () => ({ response: "Sản phẩm có giá 800.000₫ và còn hàng." }))
    } as unknown as NonNullable<AiEnvironment["AI"]>;
    await expect(generateAiReply(
      { AI: unsafeAi, AI_PROVIDER: "workers-ai", AI_MODEL: model },
      "Tôi muốn được tư vấn"
    )).resolves.toBeNull();
  });

  it("keeps AI disabled without explicit provider and model, and falls back on binding errors", async () => {
    const run = vi.fn(async () => ({ response: "must not run" }));
    const ai = { run } as unknown as NonNullable<AiEnvironment["AI"]>;
    const incompleteConfigs: AiEnvironment[] = [
      { AI: ai, AI_MODEL: "mock-model" },
      { AI: ai, AI_PROVIDER: "workers-ai" }
    ];
    for (const incomplete of incompleteConfigs) {
      expect(isAiConfigured(incomplete)).toBe(false);
      await expect(resolveAiReply(incomplete, "Xin chào", "FAQ fallback")).resolves.toEqual({
        reply: "FAQ fallback",
        mode: "fallback",
        failure: null
      });
    }
    expect(run).not.toHaveBeenCalled();

    const errorCases = [
      ["daily Neurons quota exceeded", "quota"],
      ["model overloaded (503)", "overloaded"],
      ["model not found", "model_unavailable"],
      ["request timed out", "timeout"]
    ] as const;
    for (const [message, failure] of errorCases) {
      const failingAi = {
        run: vi.fn(async () => {
          throw new Error(message);
        })
      } as unknown as NonNullable<AiEnvironment["AI"]>;
      const fallback = await resolveAiReply(
        {
          AI: failingAi,
          AI_PROVIDER: "workers-ai",
          AI_MODEL: "mock-model"
        },
        "Xin chào",
        "FAQ fallback"
      );
      expect(fallback).toEqual({ reply: "FAQ fallback", mode: "fallback", failure });
    }
  });

  it("searches live D1 specifications and guides customers through checkout", async () => {
    await env.DB.prepare("UPDATE products SET specifications = ? WHERE id = ?")
      .bind(JSON.stringify({ memory: "16GB", chip: "M2" }), 10).run();
    const response = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Tìm laptop 16GB" })
    });
    const reply = (await json(response)).reply as string;
    expect(reply).toContain("Test Laptop");
    expect(reply).toContain("16GB");
    expect(reply).toContain("M2");
  });

  it("routes product and store-fact questions away from AI", () => {
    expect(shouldUseAiForChat("Tìm Test Laptop", false, true)).toBe(false);
    expect(shouldUseAiForChat("Giá bao nhiêu?", false, false)).toBe(false);
    expect(shouldUseAiForChat("Bạn có chính sách bảo hành không?", true, false)).toBe(false);
    expect(shouldUseAiForChat("Tư vấn sản phẩm", false, false)).toBe(false);
    expect(shouldUseAiForChat("Tôi muốn được tư vấn", false, false)).toBe(true);
  });

  it("rate limits chatbot messages per source IP", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await request("/api/chatbot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Xin chào" })
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every(status => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("only lets the signed-in customer look up their order through chat", async () => {
    const token = await createAccessToken(1, secret);
    const checkout = await createOrder(token, "checkout-chat-lookup-001", 1);
    expect(checkout.status).toBe(201);
    const orderId = (await json(checkout)).order_id;

    const anonymous = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Tra cứu đơn hàng #${orderId}` })
    });
    expect((await json(anonymous)).reply).toContain("Vui lòng đăng nhập");

    const owner = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Tra cứu đơn hàng #${orderId}` })
    }, token);
    expect(owner.status).toBe(200);
    expect((await json(owner)).reply).toContain(`Đơn hàng #${orderId}`);

    const otherToken = await createAccessToken(2, secret);
    await env.DB.prepare(`INSERT INTO users (
      id, full_name, email, email_normalized, password_hash, role, created_at
    ) VALUES (2, 'Other Customer', 'other@example.com', 'other@example.com', ?, 'customer', ?)`)
      .bind(customerHash, new Date().toISOString()).run();
    const other = await request("/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Tra cứu đơn hàng #${orderId}` })
    }, otherToken);
    expect((await json(other)).reply).toContain("Không tìm thấy đơn hàng");
  });

  it("stores only whitelisted anonymous event fields as one-line JSONL in R2", async () => {
    const anonymousId = crypto.randomUUID();
    const declined = await request("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "product_view",
        anonymous_id: anonymousId,
        consent: false,
        payload: { product_id: 10 }
      })
    });
    expect(declined.status).toBe(403);
    expect((await env.ANALYTICS_BUCKET.list({ prefix: "events/", limit: 10 })).objects).toHaveLength(0);

    const response = await request("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "product_view",
        anonymous_id: anonymousId,
        consent: true,
        payload: {
          product_id: 10,
          email: "private@example.invalid",
          password: "private-password",
          password_hash: "private-hash",
          token: "do-not-store",
          payment_method: "bank_transfer",
          card_number: "4111111111111111"
        }
      })
    });
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ accepted: true });

    const objects = await env.ANALYTICS_BUCKET.list({ prefix: "events/", limit: 10, include: ["customMetadata"] });
    const object = objects.objects.find(item => item.customMetadata?.eventType === "product_view");
    expect(object).toBeDefined();
    expect(object?.customMetadata?.anonymousId).toMatch(/^[0-9a-f]{64}$/);
    const stored = await env.ANALYTICS_BUCKET.get(object!.key);
    const line = await stored!.text();
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split(/\r?\n/).filter(Boolean)).toHaveLength(1);
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record).toMatchObject({
      timestamp_utc: expect.stringMatching(/Z$/),
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      event_type: "product_view",
      payload: { product_id: 10 }
    });
    expect(record.anonymous_id).toMatch(/^[0-9a-f]{64}$/);
    expect(line).not.toContain("private@example.invalid");
    expect(line).not.toContain("private-password");
    expect(line).not.toContain("private-hash");
    expect(line).not.toContain("do-not-store");
    expect(line).not.toContain('"token"');
    expect(line).not.toContain("bank_transfer");
    expect(line).not.toContain("4111111111111111");
  });

  it("drops sensitive search terms before writing JSONL or R2 metadata", async () => {
    const event = await createAnalyticsEvent({
      event_type: "search",
      anonymous_id: crypto.randomUUID(),
      payload: { term: "password=private-value" }
    });
    expect(event.payload).toEqual({});
    await writeAnalyticsEvent(env.ANALYTICS_BUCKET, event);

    const objects = await env.ANALYTICS_BUCKET.list({
      prefix: "events/",
      limit: 10,
      include: ["customMetadata"]
    });
    expect(objects.objects).toHaveLength(1);
    expect(objects.objects[0].customMetadata?.searchTerm).toBeUndefined();
    const stored = await env.ANALYTICS_BUCKET.get(objects.objects[0].key);
    const line = await stored!.text();
    expect(line).not.toContain("password");
    expect(line).not.toContain("private-value");
  });

  it("simulates R2 put/get/list pagination and surfaces connection failures", async () => {
    const bucket = new AnalyticsR2MockAdapter();
    bucket.failNext("put");
    await expect(bucket.put("events/a.jsonl", "{\"synthetic\":true}\n"))
      .rejects.toThrow("Synthetic R2 put failure.");

    for (const key of ["events/a.jsonl", "events/b.jsonl", "events/c.jsonl"]) {
      await bucket.put(key, `{"key":"${key}"}\n`, {
        httpMetadata: { contentType: "application/x-ndjson" },
        customMetadata: { dataSource: "synthetic_demo" }
      });
    }

    const firstPage = await bucket.list({ prefix: "events/", limit: 2, include: ["customMetadata"] });
    expect(firstPage.objects).toHaveLength(2);
    expect(firstPage.truncated).toBe(true);
    expect(firstPage.cursor).toBe("mock-2");
    expect(firstPage.objects[0].customMetadata).toEqual({ dataSource: "synthetic_demo" });
    const secondPage = await bucket.list({
      prefix: "events/",
      limit: 2,
      cursor: firstPage.cursor,
      include: ["customMetadata"]
    });
    expect(secondPage.objects.map(object => object.key)).toEqual(["events/c.jsonl"]);
    expect(secondPage.truncated).toBe(false);
    expect(await (await bucket.get("events/a.jsonl"))?.text()).toBe('{"key":"events/a.jsonl"}\n');
    expect(await bucket.get("events/missing.jsonl")).toBeNull();

    bucket.failNext("get");
    await expect(bucket.get("events/a.jsonl")).rejects.toThrow("Synthetic R2 get failure.");
    bucket.failNext("list");
    await expect(bucket.list({ prefix: "events/" })).rejects.toThrow("Synthetic R2 list failure.");
  });

  it("builds clearly marked synthetic JSONL across 24-hour, 7-day, and 90-day ranges without D1", async () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    const bucket = await createSyntheticAnalyticsBucket(now);
    const storedObjects = await bucket.list({
      prefix: "events/",
      limit: 1000,
      include: ["customMetadata"]
    });
    expect(storedObjects.objects).toHaveLength(500);
    const firstStored = await bucket.get(storedObjects.objects[0].key);
    const storedLine = await firstStored!.text();
    expect(storedLine.endsWith("\n")).toBe(true);
    expect(JSON.parse(storedLine)).toMatchObject({
      data_source: "synthetic_demo",
      event_type: expect.stringMatching(/^(page_view|product_view|search|add_to_cart|checkout_started|order_created|chatbot_interaction)$/)
    });

    const blockedDatabase = new Proxy(env.DB, {
      get() {
        throw new Error("Demo analytics must not query D1.");
      }
    });
    const demoEnv = {
      DB: blockedDatabase,
      ANALYTICS_BUCKET: bucket,
      ANALYTICS_MODE: "demo" as const
    };
    const day = await buildAnalyticsReport(demoEnv, "24h", null, now);
    const week = await buildAnalyticsReport(demoEnv, "7d", null, now);
    const quarter = await buildAnalyticsReport(demoEnv, "90d", null, now);

    expect(day.data_mode).toBe("demo");
    expect(day.events).toHaveLength(14);
    expect(week.events).toHaveLength(84);
    expect(quarter.events).toHaveLength(500);
    expect(new Set(quarter.events.map(event => event.event_type))).toEqual(new Set([
      "page_view", "product_view", "search", "add_to_cart", "checkout_started", "order_created", "chatbot_interaction"
    ]));
    expect(new Set(quarter.events.map(event => event.anonymous_id)).size).toBe(150);
    expect(quarter.metrics.top_products[0].name).toMatch(/^Sản phẩm Demo /);
    expect(quarter.orders_total).toBe(
      quarter.events.filter(event => event.event_type === "order_created").length
    );
    expect(quarter.metrics.checkouts).toBe(
      quarter.events.filter(event => event.event_type === "checkout_started").length
    );
    expect(quarter.metrics.checkout_to_order_rate).toBeGreaterThan(0);
    expect(quarter.orders_by_period).not.toEqual({});
    expect(day.metrics.active_users).toBe(2);
    expect(week.metrics.active_users).toBe(12);
    expect(day.events.map(event => event.event_type)).toEqual(expect.arrayContaining([
      "checkout_started",
      "order_created"
    ]));
    expect(week.metrics.active_users).toBeGreaterThan(0);
    expect(quarter.metrics.active_users).toBe(150);
  });

  it("serves demo analytics only to Admins and rejects visitor writes in demo mode", async () => {
    const demoEnv = {
      DB: env.DB,
      ANALYTICS_MODE: "demo" as const,
      SECRET_KEY: secret,
      CORS_ORIGINS: "https://hoangdzstore.pages.dev"
    };
    const storedCounts = async () => env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM orders) AS orders`).first<{
      users: number;
      products: number;
      orders: number;
    }>();
    const countsBeforeReport = await storedCounts();
    const apiRequest = (path: string, token?: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Origin", "https://hoangdzstore.pages.dev");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return worker.fetch(
        new Request(`https://hoangdz-store-api.test${path}`, { ...init, headers }),
        demoEnv
      );
    };

    expect((await apiRequest("/api/admin/analytics?range=24h")).status).toBe(401);
    const customerToken = await createAccessToken(1, secret);
    expect((await apiRequest("/api/admin/analytics?range=24h", customerToken)).status).toBe(403);

    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
    const adminToken = await createAccessToken(1, secret);
    const reportResponse = await apiRequest("/api/admin/analytics?range=90d", adminToken);
    expect(reportResponse.status).toBe(200);
    const report = await json(reportResponse);
    expect(report.data_mode).toBe("demo");
    expect(report.event_count).toBe(500);
    expect(report.orders_total).toBeGreaterThan(0);

    const visitorEventResponse = await apiRequest("/api/analytics/events", undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "page_view", consent: true })
    });
    expect(visitorEventResponse.status).toBe(409);
    expect((await env.ANALYTICS_BUCKET.list({ prefix: "events/", limit: 10 })).objects).toHaveLength(0);
    expect(await storedCounts()).toEqual(countsBeforeReport);
  });

  it("rejects analytics for customers and reports exact ranges using Ho Chi Minh time", async () => {
    const anonymousDenied = await request("/api/admin/analytics?range=24h");
    expect(anonymousDenied.status).toBe(401);

    const customerToken = await createAccessToken(1, secret);
    const denied = await request("/api/admin/analytics?range=24h", {}, customerToken);
    expect(denied.status).toBe(403);

    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
    const now = Date.parse("2030-11-24T00:00:00+07:00");
    const start = now - 24 * 60 * 60 * 1000;
    const anonymousId = crypto.randomUUID();
    const atStart = await createAnalyticsEvent({
      event_type: "page_view",
      anonymous_id: anonymousId,
      payload: { page: "home" }
    }, new Date(start));
    const beforeStart = await createAnalyticsEvent({
      event_type: "page_view",
      anonymous_id: crypto.randomUUID(),
      payload: { page: "home" }
    }, new Date(start - 1));
    const productView = await createAnalyticsEvent({
      event_type: "product_view",
      anonymous_id: anonymousId,
      payload: { product_id: 10 }
    }, new Date(now - 60 * 60 * 1000));
    await writeAnalyticsEvent(env.ANALYTICS_BUCKET, atStart);
    await writeAnalyticsEvent(env.ANALYTICS_BUCKET, beforeStart);
    await writeAnalyticsEvent(env.ANALYTICS_BUCKET, productView);
    await env.DB.prepare(`INSERT INTO orders (
      user_id, recipient_name, recipient_phone, shipping_address, total_amount,
      payment_method, payment_status, status, created_at
    ) VALUES (1, 'Test Recipient', '0900000000', 'Test Address', 100,
      'cod', 'unpaid', 'pending', ?)`)
      .bind(new Date(start).toISOString()).run();
    await env.DB.prepare(`INSERT INTO orders (
      user_id, recipient_name, recipient_phone, shipping_address, total_amount,
      payment_method, payment_status, status, created_at
    ) VALUES (1, 'Test Recipient', '0900000000', 'Test Address', 100,
      'cod', 'unpaid', 'pending', ?)`)
      .bind(new Date(start - 1).toISOString()).run();

    const token = await createAccessToken(1, secret);
    const response = await request("/api/admin/analytics?range=24h", {}, token);
    expect(response.status).toBe(200);
    const apiBody = await json(response);
    expect(apiBody).toMatchObject({
      range: "24h",
      timezone: "Asia/Ho_Chi_Minh"
    });
    expect(Array.isArray(apiBody.events)).toBe(true);
    const body = await buildAnalyticsReport(env, "24h", null, now);
    expect(body.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(body.range_start).toBe(new Date(start).toISOString());
    expect(body.range_end).toBe(new Date(now).toISOString());
    expect(body.event_count).toBe(2);
    expect(body.metrics).toMatchObject({
      page_views: 1,
      active_users: 1,
      product_views: 1,
      cart_adds: 0,
      top_products: [{ product_id: 10, name: "Test Laptop", views: 1 }]
    });
    expect(body.orders_total).toBe(1);
    expect(body.orders_by_period).toEqual({ "2030-11-23 00:00": 1 });
    expect(body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "page_view", timestamp_epoch_ms: start }),
      expect.objectContaining({ event_type: "product_view", product_id: 10 })
    ]));
  });

  it("returns empty analytics as zero counts without inventing events", async () => {
    const now = Date.parse("2040-01-01T00:00:00Z");
    const analyticsEnv = {
      DB: env.DB,
      ANALYTICS_BUCKET: env.ANALYTICS_BUCKET,
      ANALYTICS_MODE: "local" as const
    };
    const empty = await buildAnalyticsReport(analyticsEnv, "90d", null, now);
    expect(empty.event_count).toBe(0);
    expect(empty.events).toEqual([]);
    expect(empty.metrics.page_views).toBe(0);
    expect(empty.metrics.active_users).toBe(0);
    expect(empty.orders_total).toBe(0);

    for (const [range, duration] of [
      ["24h", 24 * 60 * 60 * 1000],
      ["7d", 7 * 24 * 60 * 60 * 1000],
      ["90d", 90 * 24 * 60 * 60 * 1000]
    ] as const) {
      const report = await buildAnalyticsReport(analyticsEnv, range, null, now);
      expect(Date.parse(report.range_end) - Date.parse(report.range_start)).toBe(duration);
    }
  });

  it("keeps a completed checkout successful when its optional R2 tracking write fails", async () => {
    const token = await createAccessToken(1, secret);
    const checkout = await createOrder(token, "checkout-r2-failure-001", 1);
    expect(checkout.status).toBe(201);

    const event = await createAnalyticsEvent({
      event_type: "order_created",
      anonymous_id: crypto.randomUUID(),
      payload: { item_count: 1 }
    });
    const failingBucket: Pick<R2Bucket, "put"> = {
      put: async () => {
        throw new Error("Synthetic local R2 failure.");
      }
    };
    await expect(writeAnalyticsEvent(failingBucket, event)).rejects.toThrow("Synthetic local R2 failure.");
    expect(checkout.status).toBe(201);
  });
});
