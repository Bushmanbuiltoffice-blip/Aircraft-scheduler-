import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { UNUSABLE_PASSWORD_HASH } from "../src/auth";
import { insertUser } from "../src/db";
import { createInvite, inviteTokenHash, lookupInvite } from "../src/invites";
import { addDays, todayInZone } from "../src/time";
import type { User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM email_outbox;
    DELETE FROM flight_logs;
    DELETE FROM reservations;
    DELETE FROM maintenance_blocks;
    DELETE FROM aircraft_checkouts;
    DELETE FROM invites;
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

async function makeUser(partial: Partial<User> & Pick<User, "email" | "name" | "role">): Promise<User> {
  const today = todayInZone();
  const user: User = {
    id: partial.id ?? crypto.randomUUID(),
    email: partial.email,
    passwordHash: partial.passwordHash ?? (await hashPassword("Pattern123!")),
    name: partial.name,
    role: partial.role,
    phone: null,
    certificateType: partial.certificateType ?? "private",
    certificateNumber: null,
    medicalClass: partial.medicalClass ?? "third",
    medicalExpiration: partial.medicalExpiration === undefined ? addDays(today, 200) : partial.medicalExpiration,
    instructorRateCents: partial.instructorRateCents ?? (partial.role === "instructor" ? 7500 : null),
    icalToken: partial.icalToken ?? newToken(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await insertUser(db(), user);
  return user;
}


async function post(path: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    origin: BASE,
  });
  if (cookie) headers.set("cookie", cookie);
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

async function get(path: string, cookie = ""): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

function sessionCookie(response: Response): string {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const token = cookies.map((cookie) => /rampboard_session=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
  if (!token) throw new Error(`Missing session cookie: ${cookies.join(" | ")}`);
  return `rampboard_session=${token}`;
}

async function login(email: string | null): Promise<string> {
  if (!email) throw new Error("This test user has no email.");
  const response = await post("/login", { email, password: "Pattern123!" });
  expect(response.status).toBe(303);
  return sessionCookie(response);
}


function tokenFrom(html: string): string {
  const match = /\/invite\/([A-Za-z0-9_-]{40,})/.exec(html);
  if (!match?.[1]) throw new Error("No invite link on the page.");
  return match[1];
}

async function setup() {
  const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
  const juan = await makeUser({ email: null, name: "Juan Valdivia", role: "instructor", passwordHash: UNUSABLE_PASSWORD_HASH });
  const noah = await makeUser({ email: null, name: "Noah Burkhardt", role: "student", passwordHash: UNUSABLE_PASSWORD_HASH });
  const priya = await makeUser({ email: "priya@example.com", name: "Priya Shah", role: "renter" });
  return { admin, juan, noah, priya, adminCookie: await login(admin.email) };
}

async function invite(personId: string, cookie: string): Promise<{ response: Response; html: string; token: string }> {
  const response = await post(`/pilots/${personId}/invite`, {}, cookie);
  const html = await response.text();
  return { response, html, token: response.status === 200 ? tokenFrom(html) : "" };
}

beforeEach(async () => {
  await reset();
});

describe("invites", () => {
  it("shows Invite for people without a login and Send reset link for people with one", async () => {
    const { adminCookie } = await setup();
    const page = await get("/pilots", adminCookie);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain(">Invite</button>");
    expect(html).toContain(">Send reset link</button>");
    expect(html).toContain("Active login");
    expect(html).toContain("No login");
  });

  it("only admins can create invites", async () => {
    const { noah, priya } = await setup();
    const response = await post(`/pilots/${noah.id}/invite`, {}, await login(priya.email));
    expect(response.status).toBe(403);
    const { results } = await db().prepare("SELECT COUNT(*) AS n FROM invites").all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it("stores only a hash, shows the link with Copy, Text, and Email, and marks the person Invited", async () => {
    const { adminCookie, juan, priya } = await setup();
    const { response, html, token } = await invite(juan.id, adminCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(html).toContain(`${BASE}/invite/${token}`);
    expect(html).toContain("Copy link");
    expect(html).toContain('href="sms:');
    expect(html).not.toContain('href="mailto:');
    const { results } = await db().prepare("SELECT token_hash, expires_at, created_by FROM invites WHERE user_id = ?").bind(juan.id).all<{ token_hash: string; expires_at: string; created_by: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.token_hash).toBe(await inviteTokenHash(token));
    expect(results[0]?.token_hash).not.toContain(token);
    const days = (Date.parse(results[0]!.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    const withEmail = await invite(priya.id, adminCookie);
    expect(withEmail.html).toContain('href="mailto:priya@example.com?');
    expect(withEmail.html).toContain(encodeURIComponent("invited to Firehound Rental. Set your password here:"));
    const list = await (await get("/pilots", adminCookie)).text();
    expect(list).toContain("Invited, expires");
  });

  it("lets the person set an email and password once, signs them in, and rejects reuse", async () => {
    const { adminCookie, juan } = await setup();
    const { token } = await invite(juan.id, adminCookie);
    const page = await get(`/invite/${token}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Welcome, Juan Valdivia");

    const short = await post(`/invite/${token}`, { email: "juan@example.com", password: "short1", confirm: "short1" });
    expect(short.status).toBe(422);
    const mismatch = await post(`/invite/${token}`, { email: "juan@example.com", password: "Taildragger42", confirm: "Taildragger43" });
    expect(mismatch.status).toBe(422);
    const noEmail = await post(`/invite/${token}`, { email: "", password: "Taildragger42", confirm: "Taildragger42" });
    expect(noEmail.status).toBe(422);

    const ok = await post(`/invite/${token}`, { email: "Juan@Example.com", password: "Taildragger42", confirm: "Taildragger42" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/?notice=password-set");
    const cookie = sessionCookie(ok);
    const dashboard = await get("/", cookie);
    expect(dashboard.status).toBe(200);

    const signIn = await post("/login", { email: "juan@example.com", password: "Taildragger42" });
    expect(signIn.status).toBe(303);

    const reuse = await get(`/invite/${token}`);
    expect(reuse.status).toBe(410);
    expect(await reuse.text()).toContain("already used");
    const reusePost = await post(`/invite/${token}`, { email: "juan@example.com", password: "Other12345", confirm: "Other12345" });
    expect(reusePost.status).toBe(410);
    expect((await signInWorks("juan@example.com", "Other12345"))).toBe(false);

    const list = await (await get("/pilots", adminCookie)).text();
    expect(list).toContain("Active login");
  });

  it("signs the person out of other sessions when a reset link is used", async () => {
    const { adminCookie, priya } = await setup();
    const oldCookie = await login(priya.email);
    expect((await get("/", oldCookie)).status).toBe(200);
    const { html, token } = await invite(priya.id, adminCookie);
    expect(html).toContain("Reset link for Priya Shah");
    const done = await post(`/invite/${token}`, { email: "priya@example.com", password: "NewPass2026", confirm: "NewPass2026" });
    expect(done.status).toBe(303);
    const stale = await get("/", oldCookie);
    expect(stale.status).toBe(302);
    expect(await signInWorks("priya@example.com", "Pattern123!")).toBe(false);
    expect(await signInWorks("priya@example.com", "NewPass2026")).toBe(true);
  });

  it("a new invite invalidates the older unused one", async () => {
    const { adminCookie, noah } = await setup();
    const first = await invite(noah.id, adminCookie);
    const second = await invite(noah.id, adminCookie);
    expect(first.token).not.toBe(second.token);
    expect((await get(`/invite/${first.token}`)).status).toBe(410);
    expect((await get(`/invite/${second.token}`)).status).toBe(200);
    const { results } = await db()
      .prepare("SELECT COUNT(*) AS n FROM invites WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL")
      .bind(noah.id)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it("rejects an expired invite", async () => {
    const { admin, noah } = await setup();
    const { token } = await createInvite(db(), { userId: noah.id, createdBy: admin.id, now: new Date(Date.now() - 8 * 86_400_000) });
    expect((await lookupInvite(db(), token)).ok).toBe(false);
    const page = await get(`/invite/${token}`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("expired");
    const attempt = await post(`/invite/${token}`, { email: "noah@example.com", password: "Taildragger42", confirm: "Taildragger42" });
    expect(attempt.status).toBe(410);
    expect(await signInWorks("noah@example.com", "Taildragger42")).toBe(false);
  });

  it("rejects unknown tokens", async () => {
    await setup();
    const page = await get(`/invite/${newToken()}`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("Ask the office admin");
  });

  it("removed people cannot be invited, and their open invites stop working", async () => {
    const { admin, adminCookie, noah, juan } = await setup();
    const { token } = await invite(noah.id, adminCookie);
    // Give Noah history so removal is a soft delete.
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES ('ac1', 'N1561Y', 'Cessna', '172C', 1966, 15500, NULL, 'wet', 'available', 100, 80, NULL, ?)`,
      )
      .bind(new Date().toISOString())
      .run();
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES ('r1', 'ac1', ?, ?, '2026-01-01T17:00:00.000Z', '2026-01-01T18:00:00.000Z', 'checked_in', 'wet', NULL, ?, ?, ?)`,
      )
      .bind(noah.id, juan.id, admin.id, now, now)
      .run();
    const removed = await post(`/pilots/${noah.id}/delete`, {}, adminCookie);
    expect(removed.status).toBe(303);
    const { results } = await db().prepare("SELECT deleted_at FROM users WHERE id = ?").bind(noah.id).all<{ deleted_at: string | null }>();
    expect(results[0]?.deleted_at).toBeTruthy();
    expect((await get(`/invite/${token}`)).status).toBe(410);
    const attempt = await post(`/invite/${token}`, { email: "noah@example.com", password: "Taildragger42", confirm: "Taildragger42" });
    expect(attempt.status).toBe(410);
    const again = await post(`/pilots/${noah.id}/invite`, {}, adminCookie);
    expect(again.status).toBe(409);
    // Even a token created directly for a removed person is refused.
    await createInvite(db(), { userId: noah.id, createdBy: admin.id });
    const { results: open } = await db()
      .prepare("SELECT COUNT(*) AS n FROM invites WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL")
      .bind(noah.id)
      .all<{ n: number }>();
    expect(open[0]?.n).toBe(0);
  });

  it("requires a unique email and keeps the invite usable after a duplicate", async () => {
    const { adminCookie, juan } = await setup();
    const { token } = await invite(juan.id, adminCookie);
    const dup = await post(`/invite/${token}`, { email: "PRIYA@example.com", password: "Taildragger42", confirm: "Taildragger42" });
    expect(dup.status).toBe(422);
    expect(await dup.text()).toContain("already used by someone else");
    const { results } = await db().prepare("SELECT email, password_hash FROM users WHERE id = ?").bind(juan.id).all<{ email: string | null; password_hash: string }>();
    expect(results[0]?.email).toBeNull();
    expect(results[0]?.password_hash).toBe(UNUSABLE_PASSWORD_HASH);
    expect((await get(`/invite/${token}`)).status).toBe(200);
    const ok = await post(`/invite/${token}`, { email: "juan@example.com", password: "Taildragger42", confirm: "Taildragger42" });
    expect(ok.status).toBe(303);
  });
});

async function signInWorks(email: string, password: string): Promise<boolean> {
  const response = await post("/login", { email, password });
  return response.status === 303;
}
