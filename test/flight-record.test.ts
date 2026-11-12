import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertUser } from "../src/db";
import { addDays, formatDateTime, todayInZone } from "../src/time";
import type { User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM email_outbox;
    DELETE FROM flight_logs;
    DELETE FROM reservations;
    DELETE FROM maintenance_blocks;
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

async function makeUser(partial: Pick<User, "email" | "name" | "role">): Promise<User> {
  const user: User = {
    id: crypto.randomUUID(),
    email: partial.email,
    passwordHash: await hashPassword("Pattern123!"),
    name: partial.name,
    role: partial.role,
    phone: null,
    certificateType: "private",
    certificateNumber: null,
    medicalClass: "third",
    medicalExpiration: addDays(todayInZone(), 200),
    instructorRateCents: partial.role === "instructor" ? 7500 : null,
    icalToken: newToken(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await insertUser(db(), user);
  return user;
}

async function post(path: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, cookie },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

async function get(path: string, cookie = ""): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
}

function sessionCookie(response: Response): string {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const token = cookies.map((cookie) => /rampboard_session=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
  if (!token) throw new Error("Missing session cookie");
  return `rampboard_session=${token}`;
}

async function login(email: string): Promise<string> {
  const response = await post("/login", { email, password: "Pattern123!" });
  expect(response.status).toBe(303);
  return sessionCookie(response);
}

async function insertLog(input: {
  pilotId: string;
  instructorId: string | null;
  aircraftId: string;
  tachOut: number | null;
  tachIn: number | null;
  oil: number | null;
  fuel: number | null;
  ground: number | null;
  external?: boolean;
  instructorCost?: number;
}): Promise<string> {
  const reservationId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = "2026-06-15T19:00:00.000Z";
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?)`,
    )
    .bind(reservationId, input.aircraftId, input.pilotId, input.instructorId, now, "2026-06-15T21:00:00.000Z", input.pilotId, now, now)
    .run();
  const instructorCost = input.instructorCost ?? (input.instructorId ? 10500 : 0);
  await db()
    .prepare(
      `INSERT INTO flight_logs (
         id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
         aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents,
         rate_basis, created_at, ground_hours, oil_added_qt, fuel_added_gal, rental_type, imported, billing_status, billing_note
       ) VALUES (?, ?, ?, ?, ?, 100, 101.4, ?, ?, 1.4, 15500, ?, 7500, ?, ?, ?, 'wet', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      reservationId,
      input.pilotId,
      input.instructorId,
      input.aircraftId,
      input.tachOut,
      input.tachIn,
      input.external ? 0 : 21700,
      input.instructorId ? 1.4 : 0,
      input.external ? 0 : instructorCost,
      input.external ? 0 : 21700 + instructorCost,
      now,
      input.ground,
      input.oil,
      input.fuel,
      input.external ? "Dual" : null,
      input.external ? 1 : 0,
      input.external ? "external" : "in_app",
      input.external ? "Historical import, billed outside app" : null,
    )
    .run();
  return id;
}

beforeEach(reset);

describe("printable flight record", () => {
  it("prints solo, dual, and imported flights without turning them into bills", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Pat Pilot", role: "renter" });
    const stranger = await makeUser({ email: "other@example.com", name: "Other Person", role: "renter" });
    const aircraftId = crypto.randomUUID();
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 200, 90, NULL, ?)`,
      )
      .bind(aircraftId, new Date().toISOString())
      .run();
    const solo = await insertLog({
      pilotId: pilot.id, instructorId: null, aircraftId, tachOut: 80, tachIn: 81, oil: null, fuel: 0, ground: null,
    });
    const dual = await insertLog({
      pilotId: pilot.id, instructorId: instructor.id, aircraftId, tachOut: 81, tachIn: 82.5, oil: 1, fuel: null, ground: 1.5,
    });
    const outside = await insertLog({
      pilotId: pilot.id, instructorId: instructor.id, aircraftId, tachOut: null, tachIn: null, oil: null, fuel: null, ground: null, external: true,
    });
    const cookie = await login(pilot.email!);
    const before = await db().prepare("SELECT paid, tach_in, total_cost_cents, oil_added_qt FROM flight_logs WHERE id = ?").bind(dual).first();

    const anon = await get(`/logs/${solo}/record`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toContain("/login");
    expect((await get(`/logs/${solo}/record`, await login(stranger.email!))).status).toBe(403);
    expect((await get(`/logs/${dual}/record`, await login(instructor.email!))).status).toBe(200);
    expect((await get(`/logs/${solo}/record`, await login(admin.email!))).status).toBe(200);

    const detail = await (await get(`/logs/${solo}`, cookie)).text();
    expect(detail).toContain(`/logs/${solo}/record`);
    const soloPage = await get(`/logs/${solo}/record`, cookie);
    expect(soloPage.headers.get("cache-control")).toContain("no-store");
    const soloHtml = await soloPage.text();
    expect(soloHtml).toContain("Flight record");
    expect(soloHtml).toContain("not a signed pilot logbook");
    expect(soloHtml).toContain("N1561Y");
    expect(soloHtml).toContain("Pat Pilot");
    expect(soloHtml).toContain("Solo");
    expect(soloHtml).toContain(formatDateTime("2026-06-15T19:00:00.000Z"));
    expect(soloHtml).toContain("100.0");
    expect(soloHtml).toContain("101.4");
    expect(soloHtml).toContain("1.4 hr");
    expect(soloHtml).toContain("80.0");
    expect(soloHtml).toContain("81.0");
    expect(soloHtml).toContain("Not recorded");
    expect(soloHtml).toContain("0 gal");
    expect(soloHtml).toContain('id="print-record"');
    expect(soloHtml).not.toContain("CFI One");
    expect(soloHtml).not.toContain("Amount due");
    expect(soloHtml).not.toContain("$217.00");

    const dualHtml = await (await get(`/logs/${dual}/record`, cookie)).text();
    expect(dualHtml).toContain("CFI One");
    expect(dualHtml).toContain("1.5 hr");
    expect(dualHtml).toContain("1 qt");
    expect(dualHtml).toContain("Not recorded");
    expect(dualHtml).toContain("1.5 hr");
    expect(dualHtml).not.toContain("Amount due");

    const outsideHtml = await (await get(`/logs/${outside}/record`, cookie)).text();
    expect(outsideHtml).toContain("not an invoice");
    expect(outsideHtml).toContain("Historical import, billed outside app");
    expect(outsideHtml).toContain("Not recorded");
    expect(outsideHtml).not.toContain("$155.00");
    expect(outsideHtml).not.toContain("$0.00");
    expect(outsideHtml).not.toContain("Amount due");

    expect(await db().prepare("SELECT paid, tach_in, total_cost_cents, oil_added_qt FROM flight_logs WHERE id = ?").bind(dual).first()).toEqual(before);
  });
});
