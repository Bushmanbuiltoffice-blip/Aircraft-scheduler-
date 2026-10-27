/**
 * Stored in each new hash. 10,000 fits the Cloudflare free-plan CPU limit.
 * A paid Workers plan can raise this. Existing hashes keep the count they were saved with.
 */
export const PBKDF2_ITERATIONS = 10_000;

/** Stored on profiles that must not be able to sign in. Not a password. */
export const UNUSABLE_PASSWORD_HASH = "disabled";

export const DEV_SESSION_SECRET = "dev-insecure-session-secret";

export function sessionSecret(env: { SESSION_SECRET?: string }): { secret: string; usingDevFallback: boolean } {
  const secret = env.SESSION_SECRET?.trim();
  if (secret) return { secret, usingDevFallback: false };
  return { secret: DEV_SESSION_SECRET, usingDevFallback: true };
}

export function passwordError(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Use at least one letter and one number.";
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailError(email: string): string | null {
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

let placeholderHash: Promise<string> | null = null;

export function placeholderPasswordHash(): Promise<string> {
  placeholderHash ??= hashPassword("rampboard-missing-user");
  return placeholderHash;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  const salt = parsed?.salt ?? new Uint8Array(16);
  const iterations = parsed?.iterations ?? PBKDF2_ITERATIONS;
  const actual = await pbkdf2(password, salt, iterations);
  const expected = parsed?.hash ?? new Uint8Array(32);
  return parsed !== null && timingSafeEqual(actual, expected);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toBufferSource(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseStoredHash(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2_000_000) return null;
  const saltPart = parts[2];
  const hashPart = parts[3];
  if (!saltPart || !hashPart) return null;
  try {
    return { iterations, salt: base64UrlToBytes(saltPart), hash: base64UrlToBytes(hashPart) };
  } catch {
    return null;
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sessionTokenHash(token: string, secret: string): Promise<string> {
  return sha256Hex(`${secret}:${token}`);
}
