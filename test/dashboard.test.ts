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


async function addFlight(input: { aircraftId: string; pilotId: string; day: string; hobbsOut: number }): Promise<string> {
  const reservationId = crypto.randomUUID();
  const logId = crypto.randomUUID();
  const starts = `${input.day}T17:00:00.000Z`;
  const ends = `${input.day}T18:00:00.000Z`;
  await db().batch([
    db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'checked_in', 'wet', ?, 0, ?, 1, NULL, NULL, ?, ?)`,
      )
      .bind(reservationId, input.aircraftId, input.pilotId, starts, ends, input.hobbsOut, input.hobbsOut + 1, starts, ends),
    db()
      .prepare(
        `INSERT INTO flight_logs (id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
           aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 1, 1, 15500, 15500, 0, 0, 0, 15500, 'wet', ?)`,
      )
      .bind(logId, reservationId, input.pilotId, input.aircraftId, input.hobbsOut, input.hobbsOut + 1, ends),
  ]);
  return logId;
}

function order(html: string, markers: string[]): number[] {
  return markers.map((marker) => {
    const index = html.indexOf(marker);
    if (index < 0) throw new Error(`Missing ${marker}`);
    return index;
  });
}

beforeEach(async () => {
  await reset();
});

describe("dispatch dashboard", () => {
  async function setup() {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const aircraft = await makeAircraft();
    const logs: string[] = [];
    for (let i = 0; i < 6; i++) {
      logs.push(await addFlight({ aircraftId: aircraft.id, pilotId: pilot.id, day: `2026-09-0${i + 1}`, hobbsOut: 100 + i }));
    }
    await db()
      .prepare("INSERT INTO email_outbox (id, to_email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), "pilot@example.com", "Reservation booked: N1561Y", "body", new Date().toISOString())
      .run();
    return { admin, pilot, aircraft, logs };
  }

  for (const who of ["admin", "renter"] as const) {
    it(`puts Coming up, then Aircraft, first and shows only the last 3 flights (${who})`, async () => {
      const { admin, pilot, logs } = await setup();
      const response = await get("/", await login(who === "admin" ? admin.email : pilot.email));
      expect(response.status).toBe(200);
      const html = await response.text();
      const [coming, aircraft, stats, today, flights] = order(html, [
        'id="dash-coming-up"',
        'id="dash-aircraft"',
        'class="stats"',
        'id="dash-today"',
        'id="dash-flight-log"',
      ]);
      expect(coming).toBeLessThan(aircraft!);
      expect(aircraft).toBeLessThan(stats!);
      expect(stats).toBeLessThan(today!);
      expect(today).toBeLessThan(flights!);
      if (who === "admin") {
        expect(html.indexOf("Billing by pilot")).toBeGreaterThan(flights!);
      } else {
        const checkouts = html.indexOf("Your checkouts");
        expect(checkouts).toBeGreaterThan(today!);
        expect(checkouts).toBeLessThan(flights!);
      }

      expect(html).not.toContain("Notifications");
      expect(html).not.toContain("Reservation booked: N1561Y");

      const logSection = html.slice(flights!);
      expect(logSection).toContain('href="/logs">View all flight logs</a>');
      const shown = [...logSection.matchAll(/href="\/logs\/([0-9a-f-]{36})"/g)].map((match) => match[1]);
      expect(shown).toEqual([logs[5], logs[4], logs[3]]);
    });
  }

  it("keeps the full Flight logs page and the notification outbox untouched", async () => {
    const { admin, logs } = await setup();
    const cookie = await login(admin.email);
    const html = await (await get("/logs", cookie)).text();
    for (const id of logs) expect(html).toContain(`/logs/${id}`);
    const { results } = await db().prepare("SELECT COUNT(*) AS n FROM email_outbox").all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });
});
