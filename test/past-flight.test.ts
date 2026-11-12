import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertAircraft, insertUser } from "../src/db";
import { parsePastFlight, type PastFlightForm } from "../src/past_flight";
import { addDays, todayInZone } from "../src/time";
import { pdfText } from "../src/text_pdf";
import type { Aircraft, User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM email_outbox;
    DELETE FROM tbx_entries;
    DELETE FROM flight_logs;
    DELETE FROM reservations;
    DELETE FROM maintenance_blocks;
    DELETE FROM aircraft_checkouts;
    DELETE FROM agreement_signatures;
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

async function makeUser(partial: Partial<User> & Pick<User, "email" | "name" | "role">): Promise<User> {
  const user: User = {
    id: partial.id ?? crypto.randomUUID(),
    email: partial.email,
    passwordHash: partial.passwordHash ?? (await hashPassword("Pattern123!")),
    name: partial.name,
    role: partial.role,
    phone: null,
    certificateType: "private",
    certificateNumber: null,
    medicalClass: partial.medicalClass ?? "third",
    medicalExpiration: partial.medicalExpiration === undefined ? null : partial.medicalExpiration,
    instructorRateCents: partial.instructorRateCents === undefined ? (partial.role === "instructor" ? 7500 : null) : partial.instructorRateCents,
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
    year: 1962,
    hourlyWetCents: 15500,
    hourlyDryCents: null,
    defaultRate: "wet",
    status: "available",
    hobbs: 400,
    tach: 300,
    notes: null,
    createdAt: new Date().toISOString(),
  };
  await insertAircraft(db(), aircraft);
  return aircraft;
}

async function post(path: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", origin: BASE });
  if (cookie) headers.set("cookie", cookie);
  return SELF.fetch(`${BASE}${path}`, { method: "POST", headers, body: new URLSearchParams(fields), redirect: "manual" });
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

async function login(email: string | null): Promise<string> {
  if (!email) throw new Error("This test user has no email.");
  const response = await post("/login", { email, password: "Pattern123!" });
  expect(response.status).toBe(303);
  return sessionCookie(response);
}

function comingUp(html: string): string {
  const start = html.indexOf('id="dash-coming-up"');
  const end = html.indexOf('id="dash-aircraft"');
  if (start < 0 || end <= start) throw new Error("Coming up section missing");
  return html.slice(start, end);
}

function fields(input: {
  aircraftId: string;
  pilotId: string;
  instructorId?: string;
  date: string;
  billing: string;
  hobbsOut?: string;
  hobbsIn?: string;
  tachOut?: string;
  tachIn?: string;
  ground?: string;
  notes?: string;
}): Record<string, string> {
  return {
    flight_date: input.date,
    aircraft_id: input.aircraftId,
    pilot_id: input.pilotId,
    instructor_id: input.instructorId ?? "",
    hobbs_out: input.hobbsOut ?? "100.0",
    hobbs_in: input.hobbsIn ?? "101.4",
    tach_out: input.tachOut ?? "80.0",
    tach_in: input.tachIn ?? "81.0",
    ground_hours: input.ground ?? "",
    fuel_added_gal: "5",
    oil_added_qt: "1",
    notes: input.notes ?? "Round the valley",
    billing: input.billing,
  };
}

beforeEach(reset);

describe("admin past flights", () => {
  it("rejects a future date and a lower Hobbs or tach before anything is saved", () => {
    const today = "2026-11-12";
    const base: PastFlightForm = {
      flightDate: today,
      aircraftId: "plane",
      pilotId: "pilot",
      instructorId: "",
      hobbsOut: "100.0",
      hobbsIn: "100.0",
      tachOut: "80.0",
      tachIn: "80.0",
      groundHours: "",
      fuelAddedGal: "",
      oilAddedQt: "",
      notes: "",
      billing: "",
    };
    const ctx = {
      today,
      aircraft: { id: "plane", hourlyWetCents: 15500 },
      pilot: { id: "pilot" },
      instructor: null,
      instructorWasChosen: false,
    };
    expect(parsePastFlight(base, ctx).ok).toBe(false);
    expect(parsePastFlight({ ...base, billing: "in_app", flightDate: "2026-11-13" }, ctx).ok).toBe(false);
    expect(parsePastFlight({ ...base, billing: "in_app", hobbsIn: "99.0" }, ctx).ok).toBe(false);
    expect(parsePastFlight({ ...base, billing: "in_app", tachIn: "79.0" }, ctx).ok).toBe(false);
    const same = parsePastFlight({ ...base, billing: "in_app" }, ctx);
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.value.flightHours).toBe(0);
  });

  it("lets an admin record a billed flight or a settled flight, and hides the form from everyone else", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin", instructorRateCents: null });
    const juan = await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "admin", instructorRateCents: 7500 });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor", instructorRateCents: 7500 });
    const renter = await makeUser({ email: "renter@example.com", name: "Rita Renter", role: "renter", medicalExpiration: null });
    const student = await makeUser({ email: "student@example.com", name: "Sam Student", role: "student", medicalExpiration: null });
    const aircraft = await makeAircraft();
    const adminCookie = await login(admin.email);
    const yesterday = addDays(todayInZone(), -1);
    const form = await get("/logs/new", adminCookie);
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("Add past flight");
    expect(html).toContain("N1561Y");
    expect(html).toContain(`value="${aircraft.id}"`);
    expect(html.slice(html.indexOf("N1561Y") - 80, html.indexOf("N1561Y"))).toContain("selected");
    expect(html).toContain("Juan Valdivia");
    expect(html).toContain("does not book a reservation");
    expect(html).not.toMatch(/name="billing"[^>]*checked/);
    const logs = await (await get("/logs", adminCookie)).text();
    expect(logs).toContain('href="/logs/new"');

    for (const person of [instructor, renter, student]) {
      const cookie = await login(person.email);
      expect((await get("/logs/new", cookie)).status).toBe(403);
      expect((await post("/logs/new", fields({ aircraftId: aircraft.id, pilotId: renter.id, date: yesterday, billing: "in_app" }), cookie)).status).toBe(403);
      expect(await (await get("/logs", cookie)).text()).not.toContain('href="/logs/new"');
    }
    expect((await db().prepare("SELECT COUNT(*) AS n FROM flight_logs").first<{ n: number }>())?.n).toBe(0);

    const future = await post("/logs/new", fields({ aircraftId: aircraft.id, pilotId: renter.id, date: addDays(todayInZone(), 1), billing: "in_app" }), adminCookie);
    expect(future.status).toBe(422);
    expect(await future.text()).toContain("in the future");
    const lower = await post("/logs/new", fields({ aircraftId: aircraft.id, pilotId: renter.id, date: yesterday, billing: "in_app", hobbsIn: "99.0" }), adminCookie);
    expect(lower.status).toBe(422);
    expect(await lower.text()).toContain("Hobbs in cannot be less");
    const missing = await post("/logs/new", { ...fields({ aircraftId: aircraft.id, pilotId: renter.id, date: yesterday, billing: "in_app" }), billing: "" }, adminCookie);
    expect(missing.status).toBe(422);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM flight_logs").first<{ n: number }>())?.n).toBe(0);

    const billed = await post(
      "/logs/new",
      fields({
        aircraftId: aircraft.id,
        pilotId: renter.id,
        instructorId: juan.id,
        date: yesterday,
        billing: "in_app",
        ground: "1.5",
        notes: "Round the valley",
      }),
      adminCookie,
    );
    expect(billed.status).toBe(303);
    const logId = /\/logs\/([^?]+)/.exec(billed.headers.get("location") ?? "")?.[1] ?? "";
    expect(billed.headers.get("location")).toContain("notice=past-flight-saved");
    const row = await db()
      .prepare(
        `SELECT flight_hours, aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_cost_cents,
                ground_hours, ground_cost_cents, total_cost_cents, billing_status, paid, fuel_added_gal, oil_added_qt
         FROM flight_logs WHERE id = ?`,
      )
      .bind(logId)
      .first<{
        flight_hours: number;
        aircraft_rate_cents: number;
        aircraft_cost_cents: number;
        instructor_rate_cents: number;
        instructor_cost_cents: number;
        ground_hours: number;
        ground_cost_cents: number;
        total_cost_cents: number;
        billing_status: string;
        paid: number;
        fuel_added_gal: number;
        oil_added_qt: number;
      }>();
    expect(row).toMatchObject({
      aircraft_rate_cents: 15500,
      aircraft_cost_cents: 21700,
      instructor_rate_cents: 7500,
      instructor_cost_cents: 10500,
      ground_cost_cents: 11250,
      total_cost_cents: 43450,
      billing_status: "in_app",
      paid: 0,
      fuel_added_gal: 5,
      oil_added_qt: 1,
    });
    expect(row?.flight_hours).toBeCloseTo(1.4);
    expect(row?.ground_hours).toBeCloseTo(1.5);
    const meters = await db().prepare("SELECT hobbs, tach FROM aircraft WHERE id = ?").bind(aircraft.id).first<{ hobbs: number; tach: number }>();
    expect(meters).toEqual({ hobbs: 400, tach: 300 });
    expect((await db().prepare("SELECT COUNT(*) AS n FROM tbx_entries").first<{ n: number }>())?.n).toBe(0);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>())?.n).toBe(0);
    const detail = await (await get(`/logs/${logId}`, adminCookie)).text();
    expect(detail).toContain("Round the valley");
    expect(detail).toContain(">Mark paid</button>");
    expect(detail).toContain("Was this paid by cash or by check?");
    expect(detail).not.toMatch(/name="method"[^>]*checked/);
    const record = await (await get(`/logs/${logId}/record`, adminCookie)).text();
    expect(record).toContain("Round the valley");
    expect(record).toContain("101.4");
    const pdf = pdfText(new Uint8Array(await (await get(`/logs/${logId}/record.pdf`, adminCookie)).arrayBuffer()));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Notes / route: Round the valley");
    expect(pdf).toContain("Hobbs in: 101.4");
    const list = await (await get("/logs", adminCookie)).text();
    expect(list).toContain(`/logs/${logId}`);
    const home = comingUp(await (await get("/", adminCookie)).text());
    const reservationId = await db().prepare("SELECT reservation_id AS id FROM flight_logs WHERE id = ?").bind(logId).first<{ id: string }>();
    expect(home).not.toContain(reservationId?.id ?? "missing");
    const status = await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(reservationId?.id).first<{ status: string }>();
    expect(status?.status).toBe("checked_in");

    const outside = await post(
      "/logs/new",
      fields({ aircraftId: aircraft.id, pilotId: student.id, date: addDays(todayInZone(), -2), billing: "external", notes: "Already paid" }),
      adminCookie,
    );
    expect(outside.status).toBe(303);
    const outsideId = /\/logs\/([^?]+)/.exec(outside.headers.get("location") ?? "")?.[1] ?? "";
    const outsideRow = await db()
      .prepare("SELECT total_cost_cents, aircraft_cost_cents, instructor_cost_cents, billing_status, billing_note, paid FROM flight_logs WHERE id = ?")
      .bind(outsideId)
      .first<{ total_cost_cents: number; aircraft_cost_cents: number; instructor_cost_cents: number; billing_status: string; billing_note: string; paid: number }>();
    expect(outsideRow).toMatchObject({
      total_cost_cents: 0,
      aircraft_cost_cents: 0,
      instructor_cost_cents: 0,
      billing_status: "external",
      paid: 0,
    });
    const outsidePage = await (await get(`/logs/${outsideId}`, adminCookie)).text();
    expect(outsidePage).toContain("Paid outside app");
    expect(outsidePage).not.toContain(">Mark paid</button>");
    expect((await get(`/logs/${outsideId}/bill/aircraft.pdf`, adminCookie)).status).toBe(404);
    expect(comingUp(await (await get("/", adminCookie)).text())).not.toContain(
      (await db().prepare("SELECT reservation_id AS id FROM flight_logs WHERE id = ?").bind(outsideId).first<{ id: string }>())?.id ?? "missing",
    );

    const clashDay = addDays(todayInZone(), -3);
    const clashId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?)`,
      )
      .bind(clashId, aircraft.id, renter.id, `${clashDay}T18:00:00.000Z`, `${clashDay}T20:00:00.000Z`, admin.id, now, now)
      .run();
    const overlapped = await post("/logs/new", fields({ aircraftId: aircraft.id, pilotId: renter.id, date: clashDay, billing: "external" }), adminCookie);
    expect(overlapped.status).toBe(303);
    expect(overlapped.headers.get("location")).toContain("notice=past-flight-overlap");
    expect((await db().prepare("SELECT COUNT(*) AS n FROM flight_logs").first<{ n: number }>())?.n).toBe(3);
  });
});
