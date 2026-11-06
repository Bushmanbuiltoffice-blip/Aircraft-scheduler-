import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { newToken } from "./auth";
import type { AppEnv } from "./types";

export const CSRF_COOKIE = "fh_csrf";
export const CSRF_FIELD = "_csrf";

export type OriginVerdict = "same" | "cross" | "unknown";

/**
 * Classifies a state-changing request by its Origin, then Referer.
 * "unknown" means the browser sent no usable origin (missing or "null", which
 * Safari, Gmail's in-app browser, and no-referrer pages do), so the caller must
 * fall back to the CSRF token.
 */
export function originVerdict(input: { origin: string | undefined; referer: string | undefined; host: string }): OriginVerdict {
  const origin = input.origin?.trim();
  if (origin && origin !== "null") {
    const host = hostOf(origin);
    return host === input.host ? "same" : "cross";
  }
  const referer = input.referer?.trim();
  if (referer) {
    const host = hostOf(referer);
    if (host === input.host) return "same";
    if (host) return "cross";
  }
  return "unknown";
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/** Returns the CSRF token for this browser, setting the cookie when it is missing. */
export function ensureCsrfCookie(c: Context<AppEnv>): string {
  const existing = getCookie(c, CSRF_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{32,100}$/.test(existing)) return existing;
  const token = newToken();
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86_400,
  });
  return token;
}

export function csrfTokenMatches(cookieToken: string | undefined, formToken: string | undefined): boolean {
  if (!cookieToken || !formToken || cookieToken.length !== formToken.length) return false;
  let diff = 0;
  for (let i = 0; i < cookieToken.length; i++) diff |= cookieToken.charCodeAt(i) ^ formToken.charCodeAt(i);
  return diff === 0;
}

/** Adds the hidden CSRF field to every POST form in an HTML page. */
export function injectCsrfField(html: string, token: string): string {
  return html.replace(/<form\b[^>]*\bmethod="post"[^>]*>/gi, (tag) => `${tag}<input type="hidden" name="${CSRF_FIELD}" value="${token}"/>`);
}
