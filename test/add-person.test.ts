import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken, UNUSABLE_PASSWORD_HASH } from "../src/auth";
import { insertUser } from "../src/db";
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



const PERSON = {
  name: "Nora New",
  email: "nora@example.com",
  role: "renter",
  phone: "541-555-0100",
  certificate_type: "private",
  certificate_number: "",
  medical_class: "third",
  medical_expiration: "",
  instructor_rate: "",
};

beforeEach(async () => {
  await reset();
});

describe("Add person without a password", () => {
  it("the Add person form has no password field and explains the invite", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const html = await (await get("/pilots/new", await login(admin.email))).text();
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("Temporary password");
    expect(html).toContain("No password needed.");
  });

  it("saves with no usable password and opens the invite dialog right away", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const cookie = await login(admin.email);
    const response = await post("/pilots", PERSON, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("Invite link for Nora New");
    expect(html).toContain("Nora New is saved with no password.");
    expect(html).toContain('id="copy-invite"');
    expect(html).toMatch(/href="sms:[^"]*invite%2F/);
    expect(html).toMatch(/href="mailto:nora@example.com/);
    const url = /id="invite-url" type="text" readonly="" value="([^"]+)"/.exec(html)?.[1];
    expect(url).toMatch(/^https:\/\/rampboard\.test\/invite\//);

    const row = await db().prepare("SELECT id, password_hash FROM users WHERE email = 'nora@example.com'").first<{ id: string; password_hash: string }>();
    expect(row?.password_hash).toBe(UNUSABLE_PASSWORD_HASH);
    const invites = await db().prepare("SELECT COUNT(*) AS n FROM invites WHERE user_id = ? AND used_at IS NULL").bind(row!.id).first("n");
    expect(invites).toBe(1);

    // A stray password field is ignored; the account still has no password.
    await post("/pilots", { ...PERSON, name: "Pat Posted", email: "pat@example.com", password: "Pattern123!" }, cookie);
    expect(await db().prepare("SELECT password_hash FROM users WHERE email = 'pat@example.com'").first("password_hash")).toBe(UNUSABLE_PASSWORD_HASH);

    // The invite works: they pick a password and are signed in.
    const path = new URL(url!).pathname;
    expect((await get(path)).status).toBe(200);
    const accept = await post(path, { email: "nora@example.com", password: "NoraFlies2026", confirm: "NoraFlies2026" });
    expect(accept.status).toBe(303);
    expect((await post("/login", { email: "nora@example.com", password: "NoraFlies2026" })).status).toBe(303);
  });

  it("login never works for an account with no password, including an empty or literal password", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    await makeUser({ email: "nopass@example.com", name: "No Pass", role: "renter", passwordHash: UNUSABLE_PASSWORD_HASH });
    for (const password of ["", " ", "disabled", "Pattern123!"]) {
      const response = await post("/login", { email: "nopass@example.com", password });
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie") ?? "").not.toContain("rampboard_session=");
    }
    const missing = await SELF.fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
      body: "email=nopass%40example.com",
      redirect: "manual",
    });
    expect(missing.status).toBe(401);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM sessions").first("n")).toBe(0);
  });

  it("the People Invite button still works for them, and edit can still set a password", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const cookie = await login(admin.email);
    await post("/pilots", PERSON, cookie);
    const id = (await db().prepare("SELECT id FROM users WHERE email = 'nora@example.com'").first<string>("id"))!;
    const people = await (await get("/pilots", cookie)).text();
    expect(people).toContain(`action="/pilots/${id}/invite"`);
    const again = await post(`/pilots/${id}/invite`, {}, cookie);
    expect(again.status).toBe(200);
    const againHtml = await again.text();
    expect(againHtml).toContain("Invite link for Nora New");
    expect(againHtml).not.toContain("is saved with no password");
    // Only the newest link is live.
    expect(await db().prepare("SELECT COUNT(*) AS n FROM invites WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(id).first("n")).toBe(1);

    const edit = await (await get(`/pilots/${id}`, cookie)).text();
    expect(edit).toContain('name="password"');
    const saved = await post(`/pilots/${id}`, { ...PERSON, password: "AdminSet2026" }, cookie);
    expect(saved.status).toBe(303);
    expect((await post("/login", { email: "nora@example.com", password: "AdminSet2026" })).status).toBe(303);
  });
});
