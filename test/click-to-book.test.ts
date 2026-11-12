import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertAircraft, insertUser } from "../src/db";
import { addDays, todayInZone } from "../src/time";
import type { Aircraft, User } from "../src/types";

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

async function makeAircraft(): Promise<Aircraft> {
  const aircraft: Aircraft = {
    id: crypto.randomUUID(),
    tailNumber: "N1561Y",
    make: "Cessna",
    model: "172C",
    year: 1966,
    hourlyWetCents: 15500,
    hourlyDryCents: null,
    defaultRate: "wet",
    status: "available",
    hobbs: 100,
    tach: 80,
    notes: null,
    createdAt: new Date().toISOString(),
  };
  await insertAircraft(db(), aircraft);
  return aircraft;
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


function inputValue(html: string, name: string): string {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1] ?? new RegExp(`value="([^"]*)"[^>]*name="${name}"`).exec(html)?.[1] ?? "";
}

beforeEach(async () => {
  await reset();
});

describe("click a day or time to book", () => {
  async function setup() {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const aircraft = await makeAircraft();
    return { admin, pilot, aircraft };
  }

  it("month view: future and today cells open New reservation, past cells do not, reservations keep their own links", async () => {
    const { admin, pilot, aircraft } = await setup();
    const today = todayInZone();
    const future = addDays(today, 3);
    const reservationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const starts = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ends = new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString();
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'scheduled', 'wet', NULL, ?, ?, ?)`,
      )
      .bind(reservationId, aircraft.id, pilot.id, starts, ends, admin.id, now, now)
      .run();
    for (const email of [admin.email, pilot.email]) {
      const cookie = await login(email);
      const ahead = await (await get(`/schedule?view=month&board=aircraft&date=${future}`, cookie)).text();
      expect(ahead).toContain(`class="month-add" href="/reservations/new?date=${future}"`);
      expect(ahead).toContain(`href="/reservations/${reservationId}"`);
      const current = await (await get(`/schedule?view=month&board=aircraft&date=${today}`, cookie)).text();
      expect(current).toContain(`class="month-add" href="/reservations/new?date=${today}"`);
      expect(current).not.toContain(`href="/reservations/new?date=${addDays(today, -1)}"`);
      expect(current).not.toContain(`href="/reservations/new?date=${addDays(today, -7)}"`);
    }
  });

  it("week and day views link empty space to that resource, day, and hour", async () => {
    const { admin, aircraft } = await setup();
    const cookie = await login(admin.email);
    const future = addDays(todayInZone(), 7);
    const week = await (await get(`/schedule?view=week&board=aircraft&date=${future}`, cookie)).text();
    expect(week).toContain(`class="cell-add" href="/reservations/new?aircraft=${aircraft.id}&amp;date=${future}"`);
    const day = await (await get(`/schedule?view=day&board=aircraft&date=${future}`, cookie)).text();
    expect(day).toContain(`href="/reservations/new?aircraft=${aircraft.id}&amp;date=${future}&amp;start=06:00"`);
    expect(day).toContain(`href="/reservations/new?aircraft=${aircraft.id}&amp;date=${future}&amp;start=20:00"`);
    expect(day).not.toContain("start=21:00");
    const past = await (await get(`/schedule?view=day&board=aircraft&date=${addDays(todayInZone(), -2)}`, cookie)).text();
    expect(past).not.toContain('class="slot-add"');
  });

  it("the New reservation form is prefilled with the date, time, two hours, and N1561Y", async () => {
    const { pilot, aircraft } = await setup();
    const cookie = await login(pilot.email);
    const future = addDays(todayInZone(), 5);
    const plain = await (await get(`/reservations/new?date=${future}`, cookie)).text();
    expect(inputValue(plain, "starts_at")).toBe(`${future}T09:00`);
    expect(inputValue(plain, "ends_at")).toBe(`${future}T11:00`);
    expect(plain).toMatch(new RegExp(`<option value="${aircraft.id}"[^>]*selected`));
    const timed = await (await get(`/reservations/new?aircraft=${aircraft.id}&date=${future}&start=14:00`, cookie)).text();
    expect(inputValue(timed, "starts_at")).toBe(`${future}T14:00`);
    expect(inputValue(timed, "ends_at")).toBe(`${future}T16:00`);
    const junk = await (await get(`/reservations/new?date=${future}&start=99:99`, cookie)).text();
    expect(inputValue(junk, "starts_at")).toBe(`${future}T09:00`);
  });
});
