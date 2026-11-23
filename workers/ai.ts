interface AiMessage {
  role: "user";
  content: string;
}

export type AiProvider = "workers-ai";

export interface AiEnvironment {
  AI?: Pick<Ai, "run">;
  AI_PROVIDER?: AiProvider;
  AI_MODEL?: string;
}

export const AI_MAX_MESSAGE_CHARS = 1200;
export const AI_MAX_OUTPUT_TOKENS = 180;
export const AI_TIMEOUT_MS = 8000;

export type AiFailureKind = "timeout" | "quota" | "overloaded" | "model_unavailable" | "provider_error";

interface AiAttempt {
  reply: string | null;
  failure: AiFailureKind | null;
}

export interface AiProductCandidate {
  id: number;
  name: string;
  category: string;
  brand: string;
  price: number;
  sale_price: number | null;
  stock: number;
  specifications: string | null;
}

interface AiProductRecommendationAttempt {
  productIds: number[] | null;
  failure: AiFailureKind | null;
}

interface ConfiguredProvider {
  model: string;
  ai: Pick<Ai, "run">;
}

export const AI_RECOMMENDATION_OUTPUT_TOKENS = 80;

const storeFactTerms = [
  "gia", "bao nhieu", "ton kho", "con hang", "het hang", "bao hanh", "doi tra",
  "giao hang", "van chuyen", "thanh toan", "chuyen khoan", "don hang", "tra cuu don",
  "san pham", "product", "recommend", "price", "stock", "warranty", "shipping",
  "payment", "order", "refund", "hoangdz", "cua hang", "dia chi", "so dien thoai",
  "hotline", "website", "email", "address", "contact", "discount"
];

class AiResponseError extends Error {
  constructor(readonly failure: AiFailureKind, message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsStoreFactTerms(value: string): boolean {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi");
  return storeFactTerms.some(term => normalized.includes(term));
}

function configuredProvider(env: AiEnvironment): ConfiguredProvider | null {
  const model = env.AI_MODEL?.trim();
  if (env.AI_PROVIDER !== "workers-ai" || !model || !env.AI) return null;
  return { model, ai: env.AI };
}

function failureFromText(value: string): AiFailureKind {
  const normalized = value.toLocaleLowerCase("en");
  if (/timeout|timed out|deadline|abort/.test(normalized)) return "timeout";
  if (/quota|neuron|billing|insufficient|daily limit/.test(normalized)) return "quota";
  if (/overload|overloaded|capacity|busy|429|rate.?limit|503/.test(normalized)) return "overloaded";
  if (/model.*(unavailable|not available|not found|unsupported|does not exist)|unknown model/.test(normalized)) {
    return "model_unavailable";
  }
  return "provider_error";
}

export function classifyAiFailure(error: unknown): AiFailureKind {
  if (error instanceof AiResponseError) return error.failure;

  const details = isRecord(error)
    ? [error.name, error.message, error.code, error.status]
      .filter(value => typeof value === "string" || typeof value === "number")
      .join(" ")
    : error instanceof Error
      ? `${error.name} ${error.message}`
      : "";
  return failureFromText(details);
}

function safeReply(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reply = value.trim();
  if (
    !reply
    || /\d|₫|\bvnd\b|https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i.test(reply)
    || containsStoreFactTerms(reply)
  ) return null;
  return reply.slice(0, AI_MAX_MESSAGE_CHARS);
}

function workersAiResponseText(value: unknown): string | null {
  const response = workersAiOutputText(value);
  return safeReply(response);
}

function workersAiOutputText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (value.success === false) {
    const errorText = Array.isArray(value.errors)
      ? value.errors.map(error => {
        if (!isRecord(error)) return "";
        return [error.message, error.code]
          .filter(item => typeof item === "string" || typeof item === "number")
          .join(" ");
      }).join(" ")
      : "";
    throw new AiResponseError(failureFromText(errorText), "Workers AI returned an unsuccessful response.");
  }
  return typeof value.response === "string" ? value.response.trim() : null;
}

export function isAiConfigured(env: AiEnvironment): boolean {
  return configuredProvider(env) !== null;
}

export function shouldUseAiForChat(
  message: string,
  hasFaq: boolean,
  hasProductSearch: boolean
): boolean {
  if (hasFaq || hasProductSearch) return false;
  return !containsStoreFactTerms(message);
}

function userPrompt(message: string): string {
  const instruction = "Chỉ chào hỏi ngắn gọn hoặc hỏi lại để làm rõ. Không nêu số liệu hay thông tin của cửa hàng. Tin nhắn: ";
  const availableChars = Math.max(0, AI_MAX_MESSAGE_CHARS - instruction.length);
  return `${instruction}${message.trim().slice(0, availableChars)}`;
}

function productRecommendationPrompt(message: string, products: AiProductCandidate[]): string {
  const instruction = "Bạn là bộ chọn sản phẩm cho HOANGDZ STORE. Chỉ chọn ID trong danh sách D1, không tự tạo ID. Trả duy nhất JSON dạng {\"product_ids\":[...]} với tối đa 3 ID; nếu không phù hợp trả []. Không viết thông tin sản phẩm khác.";
  const candidates = products.slice(0, 5).map(product => ({
    id: product.id,
    name: product.name.slice(0, 60),
    brand: product.brand.slice(0, 40),
    category: product.category.slice(0, 40),
    price: product.sale_price && product.sale_price > 0 && product.sale_price < product.price
      ? product.sale_price
      : product.price,
    stock: product.stock,
    specifications: product.specifications?.slice(0, 80) || ""
  }));
  let prompt = "";
  const originalQuestion = message.trim();

  while (candidates.length && prompt.length <= AI_MAX_MESSAGE_CHARS) {
    const catalog = JSON.stringify(candidates);
    const fixedText = `${instruction}\nDanh mục D1: ${catalog}\nNhu cầu: `;
    const question = originalQuestion.slice(0, Math.max(0, AI_MAX_MESSAGE_CHARS - fixedText.length));
    prompt = `${fixedText}${question}`;
    if (prompt.length <= AI_MAX_MESSAGE_CHARS) return prompt;
    candidates.pop();
  }

  const fixedText = `${instruction}\nDanh mục D1: []\nNhu cầu: `;
  return `${fixedText}${originalQuestion.slice(0, Math.max(0, AI_MAX_MESSAGE_CHARS - fixedText.length))}`;
}

async function runWorkersAi(
  provider: ConfiguredProvider,
  content: string,
  maxTokens: number
): Promise<unknown> {
  return provider.ai.run(
    provider.model,
    {
      messages: [{ role: "user", content }],
      max_tokens: maxTokens,
      temperature: 0.2
    },
    { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
  );
}

export async function generateAiReply(
  env: AiEnvironment,
  userMessage: string
): Promise<string | null> {
  const provider = configuredProvider(env);
  if (!provider) return null;

  return workersAiResponseText(await runWorkersAi(
    provider,
    userPrompt(userMessage),
    AI_MAX_OUTPUT_TOKENS
  ));
}

export async function attemptAiProductRecommendations(
  env: AiEnvironment,
  userMessage: string,
  products: AiProductCandidate[]
): Promise<AiProductRecommendationAttempt> {
  const provider = configuredProvider(env);
  if (!provider || !products.length) return { productIds: null, failure: null };

  try {
    const output = workersAiOutputText(await runWorkersAi(
      provider,
      productRecommendationPrompt(userMessage, products),
      AI_RECOMMENDATION_OUTPUT_TOKENS
    ));
    if (!output) return { productIds: null, failure: null };

    const parsed: unknown = JSON.parse(output);
    if (!isRecord(parsed) || !Array.isArray(parsed.product_ids)) {
      return { productIds: null, failure: null };
    }

    const allowedIds = new Set(products.map(product => product.id));
    const productIds = [...new Set(parsed.product_ids.filter((id): id is number =>
      typeof id === "number" && Number.isSafeInteger(id) && allowedIds.has(id)
    ))].slice(0, 3);
    return { productIds: productIds.length ? productIds : null, failure: null };
  } catch (error) {
    return { productIds: null, failure: classifyAiFailure(error) };
  }
}

export async function attemptAiReply(
  env: AiEnvironment,
  userMessage: string
): Promise<AiAttempt> {
  try {
    return { reply: await generateAiReply(env, userMessage), failure: null };
  } catch (error) {
    return { reply: null, failure: classifyAiFailure(error) };
  }
}

export async function resolveAiReply(
  env: AiEnvironment,
  userMessage: string,
  fallbackReply: string
): Promise<{ reply: string; mode: "ai" | "fallback"; failure: AiFailureKind | null }> {
  const attempt = await attemptAiReply(env, userMessage);
  return {
    reply: attempt.reply || fallbackReply,
    mode: attempt.reply ? "ai" : "fallback",
    failure: attempt.failure
  };
}
