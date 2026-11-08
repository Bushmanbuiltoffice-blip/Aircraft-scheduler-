import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertUser } from "../src/db";
import { pdfText, textPdf } from "../src/text_pdf";
import { addDays, todayInZone } from "../src/time";
import type { User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM flight_logs;
    DELETE FROM reservations;
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

async function post(path: string, fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
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

async function get(path: string, cookie = ""): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
}

beforeEach(reset);

describe("downloadable bill and flight-record PDFs", () => {
  it("builds a real PDF that still contains the typed lines", () => {
    const bytes = textPdf(["Fire Hound Rental", "Total: $217.00", "Paid by cash."]);
    const text = pdfText(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Fire Hound Rental");
    expect(text).toContain("Total: $217.00");
    expect(text).toContain("Paid by cash.");
    expect(text).toContain("%%EOF");
  });

  it("serves private PDFs for both bills and the flight record without changing the flight", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
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
    const reservationId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const now = "2026-06-15T19:00:00.000Z";
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?)`,
      )
      .bind(reservationId, aircraftId, pilot.id, instructor.id, now, "2026-06-15T21:00:00.000Z", pilot.id, now, now)
      .run();
    await db()
      .prepare(
        `INSERT INTO flight_logs (
           id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
           aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents,
           ground_hours, ground_rate_cents, ground_cost_cents, total_cost_cents, rate_basis, created_at,
           aircraft_payment_method, instructor_payment_method, paid, billing_status
         ) VALUES (?, ?, ?, ?, ?, 100, 101.4, 80, 81.2, 1.4, 15500, 21700, 7500, 1.4, 10500, 1.5, 7500, 11250, 43450, 'wet', ?, 'cash', 'check', 1, 'in_app')`,
      )
      .bind(id, reservationId, pilot.id, instructor.id, aircraftId, now)
      .run();
    const before = await db().prepare("SELECT paid, aircraft_payment_method, instructor_payment_method, total_cost_cents, tach_in FROM flight_logs WHERE id = ?").bind(id).first();
    const cookie = await login(pilot.email!);

    expect((await get(`/logs/${id}/bill/aircraft.pdf`)).status).toBe(302);
    expect((await get(`/logs/${id}/bill/aircraft.pdf`, await login(stranger.email!))).status).toBe(403);

    const aircraft = await get(`/logs/${id}/bill/aircraft.pdf`, cookie);
    expect(aircraft.headers.get("content-type")).toContain("application/pdf");
    expect(aircraft.headers.get("content-disposition")).toContain(`FHR-A-${id}.pdf`);
    expect(aircraft.headers.get("cache-control")).toBe("private, no-store");
    const aircraftText = pdfText(new Uint8Array(await aircraft.arrayBuffer()));
    expect(aircraftText.startsWith("%PDF-1.4")).toBe(true);
    expect(aircraftText).toContain("N1561Y");
    expect(aircraftText).toContain("Total: $217.00");
    expect(aircraftText).toContain("Paid by cash.");
    expect(aircraftText).toContain("100.0 to 101.4");
    expect(aircraftText).not.toContain("$105.00");
    expect(aircraftText).not.toContain("$112.50");
    expect(aircraftText).not.toContain("CFI One");

    const instructorPdf = await get(`/logs/${id}/bill/instructor.pdf`, cookie);
    const instructorText = pdfText(new Uint8Array(await instructorPdf.arrayBuffer()));
    expect(instructorText).toContain("CFI One");
    expect(instructorText).toContain("Flight instruction: 1.4 hr x $75.00/hr = $105.00");
    expect(instructorText).toContain("Ground instruction: 1.5 hr x $75.00/hr = $112.50");
    expect(instructorText).toContain("Instructor total: $217.50");
    expect(instructorText).toContain("Paid by check.");
    expect(instructorText).toContain("covers flight instruction and ground instruction");
    expect(instructorText).not.toContain("Total: $217.00");

    const page = await (await get(`/logs/${id}/bill/aircraft`, cookie)).text();
    expect(page).toContain(`href="/logs/${id}/bill/aircraft.pdf"`);
    expect(page).toContain('id="save-pdf"');
    expect(page).toContain('id="print-bill"');

    const record = await get(`/logs/${id}/record.pdf`, cookie);
    const recordText = pdfText(new Uint8Array(await record.arrayBuffer()));
    expect(recordText).toContain("not a signed pilot logbook");
    expect(recordText).toContain("Tach in: 81.2");
    expect(recordText).toContain("Hobbs time: 1.4 hr");
    expect(recordText).toContain("Ground: 1.5 hr");
    expect(record.headers.get("cache-control")).toBe("private, no-store");

    expect(await db().prepare("SELECT paid, aircraft_payment_method, instructor_payment_method, total_cost_cents, tach_in FROM flight_logs WHERE id = ?").bind(id).first()).toEqual(before);
  });

  it("prints an imported flight as a record and refuses an invoice", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Pat Pilot", role: "renter" });
    const aircraftId = crypto.randomUUID();
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 200, 90, NULL, ?)`,
      )
      .bind(aircraftId, new Date().toISOString())
      .run();
    const reservationId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const now = "2026-06-15T19:00:00.000Z";
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?)`,
      )
      .bind(reservationId, aircraftId, pilot.id, now, "2026-06-15T21:00:00.000Z", pilot.id, now, now)
      .run();
    await db()
      .prepare(
        `INSERT INTO flight_logs (
           id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
           aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents,
           rate_basis, created_at, ground_hours, oil_added_qt, fuel_added_gal, imported, billing_status, billing_note
         ) VALUES (?, ?, ?, NULL, ?, 100, 101, NULL, NULL, 1, 15500, 0, 0, 0, 0, 0, 'wet', ?, NULL, NULL, NULL, 1, 'external', 'Historical import, billed outside app')`,
      )
      .bind(id, reservationId, pilot.id, aircraftId, now)
      .run();
    const cookie = await login(pilot.email!);
    expect((await get(`/logs/${id}/bill/aircraft.pdf`, cookie)).status).toBe(404);
    const record = pdfText(new Uint8Array(await (await get(`/logs/${id}/record.pdf`, cookie)).arrayBuffer()));
    expect(record).toContain("Tach out: Not recorded");
    expect(record).toContain("Tach in: Not recorded");
    expect(record).toContain("Oil added: Not recorded");
    expect(record).toContain("not an invoice");
    expect(record).toContain("Solo");
    expect(record).not.toContain("$");
  });
});
