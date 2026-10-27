import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SESSION_COOKIE, SESSION_DAYS, type AppEnv, type User } from "./types";
import type { Viewer } from "./ui";

export async function readForm(c: Context<AppEnv>): Promise<Record<string, string>> {
  const body = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function field(data: Record<string, string>, key: string): string {
  return (data[key] ?? "").trim();
}

export function blankToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

export function checked(data: Record<string, string>, key: string): boolean {
  const value = data[key];
  return value === "yes" || value === "on" || value === "true";
}

export function viewerOf(user: User): Viewer {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  const secure = new URL(c.req.url).protocol === "https:";
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure, sameSite: "Lax" });
}

export function readSessionCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}