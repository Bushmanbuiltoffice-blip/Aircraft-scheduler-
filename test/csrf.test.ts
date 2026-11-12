import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken, UNUSABLE_PASSWORD_HASH } from "../src/auth";
import { createInvite } from "../src/invites";
import { originVerdict } from "../src/csrf";
import { insertUser } from "../src/db";
import type { User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM invites; DELETE FROM email_outbox; DELETE FROM flight_logs; DELETE FROM reservations;
    DELETE FROM maintenance_blocks; DELETE FROM aircraft_checkouts; DELETE FROM sessions; DELETE FROM aircraft; DELETE FROM users;
  `);
}

async function makeUser(partial: Partial<User> & Pick<User, "email" | "name" | "role">): Promise<User> {
  const user: User = {
    id: crypto.randomUUID(),
    email: partial.email,
    passwordHash: partial.passwordHash ?? (await hashPassword("Pattern123!")),
    name: partial.name,
    role: partial.role,
    phone: null,
    certificateType: null,
    certificateNumber: null,
    medicalClass: null,
    medicalExpiration: null,
    instructorRateCents: null,
    icalToken: newToken(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await insertUser(db(), user);
  return user;
}

/** GETs a form page like a browser with no cookies, returning its CSRF cookie and hidden field. */
async function openForm(path: string): Promise<{ cookie: string; field: string; html: string; response: Response }> {
  const response = await SELF.fetch(`${BASE}${path}`, { redirect: "manual" });
  const html = await response.text();
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const raw = cookies.find((item) => item.startsWith("fh_csrf=")) ?? "";
  const field = /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
  return { cookie: raw.split(";")[0] ?? "", field, html, response };
}

async function submit(path: string, fields: Record<string, string>, headers: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

beforeEach(async () => {
  await reset();
  await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
});

describe("origin classification", () => {
  const host = "rampboard.test";
  it("trusts a matching Origin and rejects a different one", () => {
    expect(originVerdict({ origin: BASE, referer: undefined, host })).toBe("same");
    expect(originVerdict({ origin: "https://evil.example", referer: `${BASE}/login`, host })).toBe("cross");
  });
  it("falls back to Referer when Origin is missing or null", () => {
    expect(originVerdict({ origin: "null", referer: `${BASE}/login`, host })).toBe("same");
    expect(originVerdict({ origin: undefined, referer: "https://evil.example/", host })).toBe("cross");
    expect(originVerdict({ origin: "null", referer: undefined, host })).toBe("unknown");
    expect(originVerdict({ origin: undefined, referer: undefined, host })).toBe("unknown");
  });
});

describe("login form from in-app browsers", () => {
  it("sets a SameSite=Lax CSRF cookie and hidden field on the login page with no prior cookie", async () => {
    const form = await openForm("/login");
    expect(form.response.status).toBe(200);
    const setCookie = form.response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/fh_csrf=/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/SameSite=Strict/i);
    expect(form.field.length).toBeGreaterThanOrEqual(43);
    expect(form.cookie).toBe(`fh_csrf=${form.field}`);
  });

  const legit: Array<[string, Record<string, string>]> = [
    ["Origin matches", { origin: BASE }],
    ["Origin missing", {}],
    ["Origin null", { origin: "null" }],
    ["Origin null, Sec-Fetch-Site none", { origin: "null", "sec-fetch-site": "none" }],
    ["Origin null, Sec-Fetch-Site cross-site", { origin: "null", "sec-fetch-site": "cross-site" }],
    ["Origin null, Sec-Fetch-Site same-origin", { origin: "null", "sec-fetch-site": "same-origin" }],
  ];
  for (const [label, headers] of legit) {
    it(`accepts the real form when ${label}`, async () => {
      const form = await openForm("/login");
      const bad = await submit("/login", { email: "kyle@example.com", password: "wrong-password-1", _csrf: form.field }, { ...headers, cookie: form.cookie });
      expect(bad.status).toBe(401);
      expect(await bad.text()).toContain("Email or password is incorrect.");
      const good = await submit("/login", { email: "kyle@example.com", password: "Pattern123!", _csrf: form.field }, { ...headers, cookie: form.cookie });
      expect(good.status).toBe(303);
    });
  }

  it("accepts Origin null with a same-site Referer even without the token", async () => {
    const response = await submit("/login", { email: "kyle@example.com", password: "nope-nope-1" }, { origin: "null", referer: `${BASE}/login` });
    expect(response.status).toBe(401);
  });

  const attacks: Array<[string, Record<string, string>, boolean]> = [
    ["Origin null and no token", { origin: "null" }, false],
    ["Origin missing and no token", {}, false],
    ["a foreign Origin even with the token", { origin: "https://evil.example" }, true],
    ["a foreign Referer and no Origin", { referer: "https://evil.example/page" }, true],
  ];
  for (const [label, headers, sendToken] of attacks) {
    it(`blocks ${label} with a friendly page`, async () => {
      const form = await openForm("/login");
      const fields: Record<string, string> = { email: "kyle@example.com", password: "Pattern123!" };
      if (sendToken) fields._csrf = form.field;
      const response = await submit("/login", fields, { ...headers, cookie: form.cookie });
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toMatch(/text\/html/);
      const html = await response.text();
      expect(html).toContain("Please try again");
      expect(html).toContain('href="/login"');
      expect(response.headers.get("set-cookie") ?? "").not.toMatch(/rampboard_session=/);
    });
  }

  it("blocks a token that does not match the cookie", async () => {
    const form = await openForm("/login");
    const other = await openForm("/login");
    const response = await submit("/login", { email: "kyle@example.com", password: "Pattern123!", _csrf: other.field }, { origin: "null", cookie: form.cookie });
    expect(response.status).toBe(403);
  });
});

describe("invite set-password form from in-app browsers", () => {
  it("uses a same-origin referrer policy and accepts Origin null with the form token", async () => {
    const admin = (await db().prepare("SELECT id FROM users WHERE email = 'kyle@example.com'").first<{ id: string }>())!;
    const juan = await makeUser({ email: null, name: "Juan Valdivia", role: "instructor", passwordHash: UNUSABLE_PASSWORD_HASH });
    const { token } = await createInvite(db(), { userId: juan.id, createdBy: admin.id });
    const form = await openForm(`/invite/${token}`);
    expect(form.response.status).toBe(200);
    expect(form.response.headers.get("referrer-policy")).toBe("same-origin");
    expect(form.field).not.toBe("");
    const blocked = await submit(`/invite/${token}`, { email: "juan@example.com", password: "Taildragger42", confirm: "Taildragger42" }, { origin: "null" });
    expect(blocked.status).toBe(403);
    const done = await submit(
      `/invite/${token}`,
      { email: "juan@example.com", password: "Taildragger42", confirm: "Taildragger42", _csrf: form.field },
      { origin: "null", "sec-fetch-site": "same-origin", cookie: form.cookie },
    );
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/?notice=password-set");
  });
});
