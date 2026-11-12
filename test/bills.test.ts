import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { giveSignedAgreement } from "./agreement_fixture";
import { hashPassword, newToken } from "../src/auth";
import { groundInstructionCents, parseGroundHours } from "../src/bills";
import { insertAircraft, insertUser, upsertCheckout } from "../src/db";
import { addDays, formatDateTime, todayInZone } from "../src/time";
import type { Aircraft, User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

describe("ground instruction arithmetic", () => {
  it("prices hundredths of an hour from the saved instructor rate", () => {
    expect(groundInstructionCents(1.5, 7500)).toBe(11250);
    expect(groundInstructionCents(0, 7500)).toBe(0);
    expect(groundInstructionCents(0.25, 7500)).toBe(1875);
    expect(groundInstructionCents(1, 6000)).toBe(6000);
  });

  it("accepts blank, zero, and fractional hours and rejects the rest", () => {
    expect(parseGroundHours("")).toEqual({ ok: true, value: null });
    expect(parseGroundHours("  ")).toEqual({ ok: true, value: null });
    expect(parseGroundHours("0")).toEqual({ ok: true, value: 0 });
    expect(parseGroundHours("1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseGroundHours("24")).toEqual({ ok: true, value: 24 });
    expect(parseGroundHours("-1").ok).toBe(false);
    expect(parseGroundHours("1.234").ok).toBe(false);
    expect(parseGroundHours("24.01").ok).toBe(false);
    expect(parseGroundHours("25").ok).toBe(false);
  });
});

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM email_outbox;
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
  await insertUser(db(), { ...user });
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
    hobbs: 100,
    tach: 80,
    notes: null,
    createdAt: new Date().toISOString(),
  };
  await insertAircraft(db(), aircraft);
  return aircraft;
}

function slot(dayOffset: number, start: string, end: string): { starts: string; ends: string } {
  const day = addDays(todayInZone(), dayOffset);
  return { starts: `${day}T${start}`, ends: `${day}T${end}` };
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
  if (!token) throw new Error(`Missing session cookie: ${cookies.join(" | ")}`);
  return `rampboard_session=${token}`;
}

async function login(email: string | null): Promise<string> {
  if (!email) throw new Error("This test user has no email.");
  const response = await post("/login", { email, password: "Pattern123!" });
  expect(response.status).toBe(303);
  return sessionCookie(response);
}

type MoneyRow = {
  aircraft_rate_cents: number;
  aircraft_cost_cents: number;
  instructor_rate_cents: number;
  instructor_cost_cents: number;
  ground_hours: number | null;
  ground_rate_cents: number | null;
  ground_cost_cents: number | null;
  total_cost_cents: number;
  paid: number;
  hobbs_out: number;
  hobbs_in: number;
  billing_status: string;
};

async function moneyRow(id: string): Promise<MoneyRow> {
  const row = await db()
    .prepare(
      `SELECT aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_cost_cents,
              ground_hours, ground_rate_cents, ground_cost_cents, total_cost_cents, paid, hobbs_out, hobbs_in, billing_status
       FROM flight_logs WHERE id = ?`,
    )
    .bind(id)
    .first<MoneyRow>();
  if (!row) throw new Error("missing log");
  return row;
}

async function insertCompleted(input: {
  pilotId: string;
  aircraftId: string;
  instructorId: string | null;
  aircraftCost: number;
  instructorRate: number;
  instructorCost: number;
  external?: boolean;
  groundHours?: number | null;
  createdAt?: string;
}): Promise<string> {
  const reservationId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = input.createdAt ?? "2026-06-15T19:00:00.000Z";
  const end = "2026-06-15T21:00:00.000Z";
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at, hobbs_out, hobbs_in, tach_out, tach_in)
       VALUES (?, ?, ?, ?, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?, 100, 101.4, 80, 81)`,
    )
    .bind(reservationId, input.aircraftId, input.pilotId, input.instructorId, now, end, input.pilotId, now, now)
    .run();
  const total = input.external ? 0 : input.aircraftCost + input.instructorCost;
  await db()
    .prepare(
      `INSERT INTO flight_logs (
         id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
         aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at,
         ground_hours, imported, billing_status, billing_note
       ) VALUES (?, ?, ?, ?, ?, 100, 101.4, 80, 81, 1.4, 15500, ?, ?, 1.4, ?, ?, 'wet', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      reservationId,
      input.pilotId,
      input.instructorId,
      input.aircraftId,
      input.external ? 0 : input.aircraftCost,
      input.instructorRate,
      input.external ? 0 : input.instructorCost,
      total,
      now,
      input.groundHours === undefined ? null : input.groundHours,
      input.external ? 1 : 0,
      input.external ? "external" : "in_app",
      input.external ? "Historical import, billed outside app" : null,
    )
    .run();
  return id;
}

beforeEach(async () => {
  await reset();
});

describe("separate aircraft and instructor bills", () => {
  it("prints each saved charge on its own bill and leaves the row alone", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const juan = await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "instructor", instructorRateCents: 7500 });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const other = await makeUser({ email: "other@example.com", name: "Other Pilot", role: "renter" });
    const plane = await makeAircraft();
    const id = await insertCompleted({
      pilotId: renter.id,
      aircraftId: plane.id,
      instructorId: juan.id,
      aircraftCost: 21700,
      instructorRate: 7500,
      instructorCost: 10500,
    });
    const before = await moneyRow(id);
    const cookie = await login(renter.email);
    const anonymous = await get(`/logs/${id}/bill/aircraft`);
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("location")).toContain("/login");
    const denied = await get(`/logs/${id}/bill/aircraft`, await login(other.email));
    expect(denied.status).toBe(403);
    const aircraft = await get(`/logs/${id}/bill/aircraft`, cookie);
    expect(aircraft.status).toBe(200);
    expect(aircraft.headers.get("cache-control")).toBe("private, no-store");
    const aircraftHtml = await aircraft.text();
    expect(aircraftHtml).toContain("Fire Hound Rental");
    expect(aircraftHtml).toContain(`FHR-A-${id}`);
    expect(aircraftHtml).toContain("N1561Y");
    expect(aircraftHtml).toContain("Rita Renter");
    expect(aircraftHtml).toContain(formatDateTime("2026-06-15T19:00:00.000Z"));
    expect(aircraftHtml).toContain("$217.00");
    expect(aircraftHtml).toContain("$155.00");
    expect(aircraftHtml).toContain("Payment is cash or check only.");
    expect(aircraftHtml).not.toContain("Juan Valdivia");
    expect(aircraftHtml).not.toContain("$105.00");
    expect(aircraftHtml).not.toContain("Ground");
    expect(aircraftHtml).not.toContain("Tach");
    expect(aircraftHtml).not.toContain("Amount due");
    const instructorPage = await get(`/logs/${id}/bill/instructor`, cookie);
    const instructorHtml = await instructorPage.text();
    expect(instructorHtml).toContain(`FHR-I-${id}`);
    expect(instructorHtml).toContain("Juan Valdivia");
    expect(instructorHtml).toContain("Flight instruction");
    expect(instructorHtml).toContain("$105.00");
    expect(instructorHtml).toContain("$75.00");
    expect(instructorHtml).toContain("Not recorded");
    expect(instructorHtml).not.toContain("N1561Y");
    expect(instructorHtml).not.toContain("$217.00");
    expect(instructorHtml).not.toContain("Amount due");
    expect(await moneyRow(id)).toEqual(before);
    await db().prepare("UPDATE aircraft SET hourly_wet_cents = 20000 WHERE id = ?").bind(plane.id).run();
    const stillSaved = await (await get(`/logs/${id}/bill/aircraft`, await login(admin.email))).text();
    expect(stillSaved).toContain("$155.00");
    expect(stillSaved).not.toContain("$200.00");
    const outsider = await get(`/logs/${id}/bill/instructor`, await login(other.email));
    expect(outsider.status).toBe(403);
  });

  it("hides the instructor bill for a solo flight and for a saved zero instructor charge", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const plane = await makeAircraft();
    const solo = await insertCompleted({
      pilotId: renter.id,
      aircraftId: plane.id,
      instructorId: null,
      aircraftCost: 21700,
      instructorRate: 0,
      instructorCost: 0,
    });
    const cookie = await login(renter.email);
    const soloPage = await (await get(`/logs/${solo}/bill/instructor`, cookie)).text();
    expect(soloPage).toContain("No instructor bill");
    expect(soloPage).toContain("Solo flight");
    const logPage = await (await get(`/logs/${solo}`, cookie)).text();
    expect(logPage).toContain("No instructor bill");
    expect(logPage).not.toContain('name="ground_hours"');
    const zero = await insertCompleted({
      pilotId: renter.id,
      aircraftId: plane.id,
      instructorId: (await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "instructor" })).id,
      aircraftCost: 21700,
      instructorRate: 7500,
      instructorCost: 0,
    });
    const zeroPage = await (await get(`/logs/${zero}/bill/instructor`, cookie)).text();
    expect(zeroPage).toContain("$0.00");
    expect(zeroPage).toContain("no instructor bill");
  });

  it("does not print a bill for an external historical import", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const juan = await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "instructor" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const plane = await makeAircraft();
    const id = await insertCompleted({
      pilotId: renter.id,
      aircraftId: plane.id,
      instructorId: juan.id,
      aircraftCost: 0,
      instructorRate: 15500,
      instructorCost: 0,
      external: true,
      groundHours: 0.4,
    });
    const before = await moneyRow(id);
    const cookie = await login(admin.email);
    const aircraft = await (await get(`/logs/${id}/bill/aircraft`, cookie)).text();
    expect(aircraft).toContain("No new bill");
    expect(aircraft).not.toContain("$155.00");
    expect(aircraft).not.toContain("Amount due");
    const instructor = await (await get(`/logs/${id}/bill/instructor`, cookie)).text();
    expect(instructor).toContain("No new bill");
    expect(instructor).not.toContain("$155.00");
    const rejected = await post(`/logs/${id}/ground`, { ground_hours: "1" }, cookie);
    expect(rejected.status).toBe(422);
    expect(await rejected.text()).toContain("billed outside the app");
    expect(await moneyRow(id)).toEqual(before);
  });
});

describe("ground instruction on instructor flights", () => {
  it("stores zero when a new instructor check-in leaves ground blank, and prices entered hours at the saved rate", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const juan = await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "instructor", instructorRateCents: 7500 });
    const pilot = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const aircraft = await makeAircraft();
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    await giveSignedAgreement(db(), pilot);
    const cookie = await login(pilot.email);
    const when = slot(1, "09:00", "11:00");
    const booked = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: pilot.id, instructor_id: juan.id, starts_at: when.starts, ends_at: when.ends, rate_basis: "wet" },
      cookie,
    );
    const id = /\/reservations\/([^?]+)/.exec(booked.headers.get("location") ?? "")?.[1];
    expect(id).toBeTruthy();
    await post(`/reservations/${id}/checkout`, { hobbs_out: "100.0", tach_out: "80.0", meters_confirmed: "yes" }, cookie);
    const form = await (await get(`/reservations/${id}`, cookie)).text();
    expect(form).toContain('name="ground_hours"');
    const blank = await post(`/reservations/${id}/checkin`, { hobbs_in: "101.4", tach_in: "81.0" }, cookie);
    expect(blank.status).toBe(303);
    const blankLog = /\/logs\/([^?]+)/.exec(blank.headers.get("location") ?? "")?.[1] ?? "";
    const stored = await moneyRow(blankLog);
    expect(stored.aircraft_cost_cents).toBe(21700);
    expect(stored.instructor_cost_cents).toBe(10500);
    expect(stored.ground_hours).toBe(0);
    expect(stored.ground_rate_cents).toBe(7500);
    expect(stored.ground_cost_cents).toBe(0);
    expect(stored.total_cost_cents).toBe(32200);
    expect(stored.hobbs_in).toBeCloseTo(101.4);
    const zeroBill = await (await get(`/logs/${blankLog}/bill/instructor`, cookie)).text();
    expect(zeroBill).toContain("0 hr × $75.00/hr = $0.00");
    expect(zeroBill).toContain("$105.00");
    expect(zeroBill).not.toContain("$217.00");

    const soloId = crypto.randomUUID();
    const soloStart = slot(2, "09:00", "11:00");
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at, hobbs_out, tach_out)
         VALUES (?, ?, ?, NULL, ?, ?, 'checked_out', 'wet', NULL, ?, ?, ?, 101.4, 81.0)`,
      )
      .bind(soloId, aircraft.id, pilot.id, soloStart.starts, soloStart.ends, pilot.id, now, now)
      .run();
    const soloForm = await (await get(`/reservations/${soloId}`, cookie)).text();
    expect(soloForm).not.toContain('name="ground_hours"');
    const soloRejected = await post(`/reservations/${soloId}/checkin`, { hobbs_in: "102.0", tach_in: "81.4", ground_hours: "1" }, cookie);
    expect(soloRejected.status).toBe(422);
    expect(await soloRejected.text()).toContain("only for a flight with an instructor");

    const dual = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: pilot.id, instructor_id: juan.id, starts_at: slot(3, "09:00", "11:00").starts, ends_at: slot(3, "09:00", "11:00").ends, rate_basis: "wet" },
      cookie,
    );
    const dualId = /\/reservations\/([^?]+)/.exec(dual.headers.get("location") ?? "")?.[1];
    await post(`/reservations/${dualId}/checkout`, { hobbs_out: "102.0", tach_out: "81.4", meters_confirmed: "yes" }, cookie);
    const done = await post(`/reservations/${dualId}/checkin`, { hobbs_in: "103.4", tach_in: "82.0", ground_hours: "1.5" }, cookie);
    expect(done.status).toBe(303);
    const logId = /\/logs\/([^?]+)/.exec(done.headers.get("location") ?? "")?.[1] ?? "";
    const row = await moneyRow(logId);
    expect(row.aircraft_cost_cents).toBe(21700);
    expect(row.instructor_rate_cents).toBe(7500);
    expect(row.instructor_cost_cents).toBe(10500);
    expect(row.ground_hours).toBeCloseTo(1.5);
    expect(row.ground_rate_cents).toBe(7500);
    expect(row.ground_cost_cents).toBe(11250);
    expect(row.total_cost_cents).toBe(21700 + 10500 + 11250);
    const detail = await (await get(`/logs/${logId}`, cookie)).text();
    expect(detail).toContain("Ground instruction 1.5 × $75.00 = $112.50");
    expect(detail).toContain("$434.50");
    const instructorBill = await (await get(`/logs/${logId}/bill/instructor`, cookie)).text();
    expect(instructorBill).toContain("1.4 hr × $75.00/hr = $105.00");
    expect(instructorBill).toContain("1.5 hr × $75.00/hr = $112.50");
    expect(instructorBill).toContain("$217.50");
    expect(instructorBill).not.toContain("N1561Y");
    expect(instructorBill).not.toContain("$217.00");
    const aircraftBill = await (await get(`/logs/${logId}/bill/aircraft`, cookie)).text();
    expect(aircraftBill).toContain("$217.00");
    expect(aircraftBill).not.toContain("$112.50");
    expect(aircraftBill).not.toContain("Ground");
    const mail = await db().prepare("SELECT body FROM email_outbox ORDER BY rowid DESC LIMIT 1").first<{ body: string }>();
    expect(mail?.body).toContain("Total billed from Hobbs: $322.00");
    expect(mail?.body).toContain("Ground instruction: $112.50");
    expect(mail?.body).toContain("Combined total: $434.50");
  });

  it("leaves preexisting ground null until an authorized person enters hours, then keeps the old rate and the paid mark", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const juan = await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "instructor", instructorRateCents: 6000 });
    const otherInstructor = await makeUser({ email: "other-cfi@example.com", name: "Other CFI", role: "instructor" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const plane = await makeAircraft();
    const id = await insertCompleted({
      pilotId: renter.id,
      aircraftId: plane.id,
      instructorId: juan.id,
      aircraftCost: 15500,
      instructorRate: 6000,
      instructorCost: 6000,
      groundHours: 0.4,
    });
    await db().prepare("UPDATE users SET instructor_rate_cents = 7500 WHERE id = ?").bind(juan.id).run();
    const before = await moneyRow(id);
    expect(before.ground_rate_cents).toBeNull();
    expect(before.ground_cost_cents).toBeNull();
    expect(before.total_cost_cents).toBe(21500);
    const renterCookie = await login(renter.email);
    const untouched = await (await get(`/logs/${id}/bill/instructor`, renterCookie)).text();
    expect(untouched).toContain("Not recorded");
    expect(untouched).toContain("$60.00");
    expect(untouched).not.toContain("$30.00");
    const detail = await (await get(`/logs/${id}`, renterCookie)).text();
    expect(detail).toContain("0.4 hr on the record, no ground charge");
    expect(detail).not.toContain('name="ground_hours"');
    const renterPost = await post(`/logs/${id}/ground`, { ground_hours: "1.5" }, renterCookie);
    expect(renterPost.status).toBe(403);
    const stranger = await post(`/logs/${id}/ground`, { ground_hours: "1.5" }, await login(otherInstructor.email));
    expect(stranger.status).toBe(403);
    expect(await moneyRow(id)).toEqual(before);

    const juanCookie = await login(juan.email);
    const juanPage = await (await get(`/logs/${id}`, juanCookie)).text();
    expect(juanPage).toContain('name="ground_hours"');
    expect(juanPage).toContain("$60.00/hr");
    const bad = await post(`/logs/${id}/ground`, { ground_hours: "1.234" }, juanCookie);
    expect(bad.status).toBe(422);
    expect(await moneyRow(id)).toEqual(before);
    const saved = await post(`/logs/${id}/ground`, { ground_hours: "1.5" }, juanCookie);
    expect(saved.status).toBe(303);
    const row = await moneyRow(id);
    expect(row.ground_hours).toBeCloseTo(1.5);
    expect(row.ground_rate_cents).toBe(6000);
    expect(row.ground_cost_cents).toBe(9000);
    expect(row.aircraft_cost_cents).toBe(15500);
    expect(row.aircraft_rate_cents).toBe(15500);
    expect(row.instructor_cost_cents).toBe(6000);
    expect(row.instructor_rate_cents).toBe(6000);
    expect(row.total_cost_cents).toBe(15500 + 6000 + 9000);
    expect(row.paid).toBe(0);
    expect(row.hobbs_in).toBeCloseTo(101.4);

    await db().prepare("UPDATE flight_logs SET paid = 1, paid_at = ?, paid_by = ? WHERE id = ?").bind("2026-06-15T20:00:00.000Z", admin.id, id).run();
    const paidBefore = await moneyRow(id);
    expect(paidBefore.paid).toBe(1);
    const warnedForm = await (await get(`/logs/${id}`, await login(admin.email))).text();
    expect(warnedForm).toContain("already marked paid");
    const edited = await post(`/logs/${id}/ground`, { ground_hours: "2" }, await login(admin.email));
    expect(edited.status).toBe(303);
    expect(edited.headers.get("location")).toContain("notice=ground-saved-paid");
    const after = await moneyRow(id);
    expect(after.paid).toBe(1);
    expect(after.ground_hours).toBe(2);
    expect(after.ground_rate_cents).toBe(6000);
    expect(after.ground_cost_cents).toBe(12000);
    expect(after.total_cost_cents).toBe(15500 + 6000 + 12000);
    expect(after.aircraft_cost_cents).toBe(15500);
    expect(after.hobbs_out).toBe(100);
    const notice = await (await get(edited.headers.get("location") ?? "/", await login(admin.email))).text();
    expect(notice).toContain("already marked paid");
    expect(notice).toContain("paid mark was not changed");
    const home = await (await get("/", await login(admin.email))).text();
    expect(home).toContain("$335.00");
    const summed = await db()
      .prepare("SELECT COALESCE(SUM(total_cost_cents), 0) AS cents FROM flight_logs WHERE billing_status != 'external'")
      .first<{ cents: number }>();
    expect(Number(summed?.cents)).toBe(33500);
  });

  it("rejects ground on a solo flight without writing a charge", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const plane = await makeAircraft();
    const id = await insertCompleted({
      pilotId: renter.id,
      aircraftId: plane.id,
      instructorId: null,
      aircraftCost: 21700,
      instructorRate: 0,
      instructorCost: 0,
    });
    const before = await moneyRow(id);
    const response = await post(`/logs/${id}/ground`, { ground_hours: "1" }, await login(admin.email));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("only on a flight with an instructor");
    expect(await moneyRow(id)).toEqual(before);
  });
});
