import { compare as bcryptCompare } from "bcryptjs";

const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (/^\$2[aby]\$\d\d\$/.test(storedHash)) {
    try {
      return await bcryptCompare(password, storedHash);
    } catch {
      return false;
    }
  }

  const [scheme, iterationText, saltText, expectedText, extra] = storedHash.split("$");
  if (scheme !== "pbkdf2_sha256" || extra !== undefined) return false;

  const iterations = Number(iterationText);
  if (!Number.isSafeInteger(iterations) || iterations !== PBKDF2_ITERATIONS) return false;

  try {
    const salt = base64UrlToBytes(saltText);
    const expected = base64UrlToBytes(expectedText);
    if (salt.length < 16 || expected.length !== 32) return false;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256
    );
    return equalBytes(new Uint8Array(actual), expected);
  } catch {
    return false;
  }
}

export async function createAccessToken(userId: number, secret: string): Promise<string> {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    sub: String(userId),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  })));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(unsigned));
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAccessToken(token: string, secret: string): Promise<number | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0]))) as { alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]))) as {
      sub?: string;
      exp?: number;
    };
    if (header.alg !== "HS256" || !payload.sub || !Number.isSafeInteger(payload.exp)) return null;
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0 || (payload.exp ?? 0) <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`)
    );
    return valid ? userId : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashResetToken(token: string): Promise<string> {
  return sha256Hex(token);
}
