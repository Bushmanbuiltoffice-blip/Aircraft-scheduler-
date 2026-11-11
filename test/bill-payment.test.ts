import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
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
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

async function makeUser(partial: Partial<User> & Pick<User, "email" | "name" | "role">): Promise<User> {
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

async function post(path: string, fields: Record<string, string>, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, cookie },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

async function get(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
}

function sessionCookie(response: Response): string {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const token = cookies.map((cookie) => /rampboard_session=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
  if (!token) throw new Error("Missing session cookie");
  return `rampboard_session=${token}`;
}

async function login(email: string): Promise<string> {
  const response = await post("/login", { email, password: "Pattern123!" }, "");
  expect(response.status).toBe(303);
  return sessionCookie(response);
}

type PayRow = {
  aircraft_payment_method: string | null;
  instructor_payment_method: string | null;
  aircraft_cost_cents: number;
  instructor_cost_cents: number;
  ground_cost_cents: number | null;
  total_cost_cents: number;
  paid: number;
  hobbs_in: number;
};

async function payRow(id: string): Promise<PayRow> {
  const row = await db()
    .prepare(
      `SELECT aircraft_payment_method, instructor_payment_method, aircraft_cost_cents, instructor_cost_cents,
              ground_cost_cents, total_cost_cents, paid, hobbs_in
       FROM flight_logs WHERE id = ?`,
    )
    .bind(id)
    .first<PayRow>();
  if (!row) throw new Error("missing log");
  return row;
}

async function insertLog(input: {
  pilotId: string;
  instructorId: string | null;
  aircraftId: string;
  aircraftCost: number;
  instructorCost: number;
  groundHours?: number | null;
  groundCost?: number | null;
  external?: boolean;
  paid?: boolean;
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
  await db()
    .prepare(
      `INSERT INTO flight_logs (
         id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
         aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents,
         rate_basis, created_at, ground_hours, ground_rate_cents, ground_cost_cents, paid, billing_status, billing_note, imported
       ) VALUES (?, ?, ?, ?, ?, 100, 101.4, 80, 81, 1.4, 15500, ?, 7500, 1.4, ?, ?, 'wet', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      reservationId,
      input.pilotId,
      input.instructorId,
      input.aircraftId,
      input.aircraftCost,
      input.instructorCost,
      input.external ? 0 : input.aircraftCost + input.instructorCost + (input.groundCost ?? 0),
      now,
      input.groundHours === undefined ? null : input.groundHours,
      input.groundCost == null ? null : 7500,
      input.groundCost === undefined ? null : input.groundCost,
      input.paid ? 1 : 0,
      input.external ? "external" : "in_app",
      input.external ? "Historical import, billed outside app" : null,
      input.external ? 1 : 0,
    )
    .run();
  return id;
}

beforeEach(reset);

describe("cash or check on each bill", () => {
  it("keeps aircraft and instructor methods independent, including ground on the instructor bill", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor" });
    const renter = await makeUser({ email: "renter@example.com", name: "Renter Pilot", role: "renter" });
    const aircraftId = crypto.randomUUID();
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 100, 80, NULL, ?)`,
      )
      .bind(aircraftId, new Date().toISOString())
      .run();
    const withGround = await insertLog({
      pilotId: renter.id,
      instructorId: instructor.id,
      aircraftId,
      aircraftCost: 21700,
      instructorCost: 10500,
      groundHours: 1.5,
      groundCost: 11250,
    });
    const noGround = await insertLog({
      pilotId: renter.id,
      instructorId: instructor.id,
      aircraftId,
      aircraftCost: 21700,
      instructorCost: 10500,
    });
    const cookie = await sessionCookie(await post("/login", { email: admin.email!, password: "Pattern123!" }, ""));
    const before = await payRow(withGround);
    const aircraftPage = await get(`/logs/${withGround}/bill/aircraft`, cookie);
    expect(aircraftPage.headers.get("cache-control")).toContain("no-store");
    const aircraftHtml = await aircraftPage.text();
    expect(aircraftHtml).toContain("Was this paid by cash or by check?");
    expect(aircraftHtml).toContain('type="reset">Cancel');
    expect(aircraftHtml).toContain("Not paid.");
    expect(aircraftHtml).not.toMatch(/name="method"[^>]*checked/);
    expect(await payRow(withGround)).toEqual(before);

    const missing = await post(`/logs/${withGround}/bill/aircraft/payment`, { action: "record" }, cookie);
    expect(missing.status).toBe(422);
    expect(await payRow(withGround)).toEqual(before);
    const card = await post(`/logs/${withGround}/bill/aircraft/payment`, { action: "record", method: "card" }, cookie);
    expect(card.status).toBe(422);
    expect(await payRow(withGround)).toEqual(before);

    const aircraftPaid = await post(`/logs/${withGround}/bill/aircraft/payment`, { action: "record", method: "cash" }, cookie);
    expect(aircraftPaid.status).toBe(303);
    const afterAircraft = await payRow(withGround);
    expect(afterAircraft.aircraft_payment_method).toBe("cash");
    expect(afterAircraft.instructor_payment_method).toBeNull();
    expect(afterAircraft.paid).toBe(0);
    expect(afterAircraft.aircraft_cost_cents).toBe(21700);
    expect(afterAircraft.instructor_cost_cents).toBe(10500);
    expect(afterAircraft.ground_cost_cents).toBe(11250);
    expect(afterAircraft.total_cost_cents).toBe(21700 + 10500 + 11250);
    expect(afterAircraft.hobbs_in).toBeCloseTo(101.4);
    const printedAircraft = await (await get(`/logs/${withGround}/bill/aircraft`, cookie)).text();
    expect(printedAircraft).toContain('<p class="bill-paid-mark" id="bill-payment-mark">Paid by cash.</p>');
    expect(printedAircraft).toContain("Mark this bill unpaid");
    expect(printedAircraft).not.toContain("Was this paid by cash or by check?");
    expect(printedAircraft).not.toContain(">Mark paid</button>");
    expect(printedAircraft).not.toContain("Paid by check.");

    const instructorPaid = await post(`/logs/${withGround}/bill/instructor/payment`, { action: "record", method: "check" }, cookie);
    expect(instructorPaid.status).toBe(303);
    const both = await payRow(withGround);
    expect(both.aircraft_payment_method).toBe("cash");
    expect(both.instructor_payment_method).toBe("check");
    expect(both.paid).toBe(1);
    expect(both.total_cost_cents).toBe(before.total_cost_cents);
    const printedInstructor = await (await get(`/logs/${withGround}/bill/instructor`, cookie)).text();
    expect(printedInstructor).toContain("Paid by check.");
    expect(printedInstructor).toContain("covers flight instruction and ground instruction");
    expect(printedInstructor).toContain("1.5 hr × $75.00/hr = $112.50");
    expect(printedInstructor).not.toContain("Paid by cash.");
    const renterCookie = await login(renter.email!);
    const renterView = await (await get(`/logs/${withGround}/bill/instructor`, renterCookie)).text();
    expect(renterView).toContain("Paid by check.");
    expect(renterView).not.toContain('id="bill-pay-form"');
    expect((await post(`/logs/${withGround}/bill/aircraft/payment`, { action: "record", method: "check" }, renterCookie)).status).toBe(403);
    expect((await payRow(withGround)).aircraft_payment_method).toBe("cash");

    const cleared = await post(`/logs/${withGround}/bill/aircraft/payment`, { action: "clear" }, cookie);
    expect(cleared.status).toBe(303);
    const afterClear = await payRow(withGround);
    expect(afterClear.aircraft_payment_method).toBeNull();
    expect(afterClear.instructor_payment_method).toBe("check");
    expect(afterClear.paid).toBe(0);
    const again = await (await get(`/logs/${withGround}/bill/aircraft`, cookie)).text();
    expect(again).not.toMatch(/name="method"[^>]*checked/);
    const repayBlank = await post(`/logs/${withGround}/bill/aircraft/payment`, { action: "record", method: "" }, cookie);
    expect(repayBlank.status).toBe(422);
    expect((await payRow(withGround)).aircraft_payment_method).toBeNull();

    const plain = await (await get(`/logs/${noGround}/bill/instructor`, cookie)).text();
    expect(plain).toContain("Ground instruction was not recorded");
    expect(plain).toContain("Not paid.");
    expect(plain).not.toContain("Paid by cash.");
  });

  it("leaves an already-paid rental unknown, rejects solo and external marks, and does not invent a method", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const renter = await makeUser({ email: "renter@example.com", name: "Renter Pilot", role: "renter" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor" });
    const aircraftId = crypto.randomUUID();
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 100, 80, NULL, ?)`,
      )
      .bind(aircraftId, new Date().toISOString())
      .run();
    const legacy = await insertLog({
      pilotId: renter.id,
      instructorId: instructor.id,
      aircraftId,
      aircraftCost: 21700,
      instructorCost: 10500,
      groundHours: 0,
      groundCost: 0,
      paid: true,
    });
    const solo = await insertLog({ pilotId: renter.id, instructorId: null, aircraftId, aircraftCost: 21700, instructorCost: 0 });
    const outside = await insertLog({
      pilotId: renter.id,
      instructorId: instructor.id,
      aircraftId,
      aircraftCost: 0,
      instructorCost: 0,
      external: true,
    });
    const cookie = await login("owner@example.com");
    const legacyHtml = await (await get(`/logs/${legacy}/bill/instructor`, cookie)).text();
    expect(legacyHtml).toContain("Cash or check was not recorded for this bill.");
    expect(legacyHtml).toContain("$0.00");
    expect(legacyHtml).not.toContain("Paid by cash.");
    expect(legacyHtml).not.toContain("Paid by check.");
    expect((await payRow(legacy)).paid).toBe(1);
    const noted = await post(`/logs/${legacy}/bill/instructor/payment`, { action: "record", method: "cash" }, cookie);
    expect(noted.status).toBe(303);
    const legacyRow = await payRow(legacy);
    expect(legacyRow.instructor_payment_method).toBe("cash");
    expect(legacyRow.aircraft_payment_method).toBeNull();
    expect(legacyRow.paid).toBe(1);
    expect((await post(`/logs/${solo}/bill/instructor/payment`, { action: "record", method: "check" }, cookie)).status).toBe(422);
    expect((await payRow(solo)).instructor_payment_method).toBeNull();
    const soloPaid = await post(`/logs/${solo}/bill/aircraft/payment`, { action: "record", method: "check" }, cookie);
    expect(soloPaid.status).toBe(303);
    expect(await payRow(solo)).toMatchObject({ aircraft_payment_method: "check", instructor_payment_method: null, paid: 1, aircraft_cost_cents: 21700 });
    const beforeOutside = await payRow(outside);
    expect((await post(`/logs/${outside}/bill/aircraft/payment`, { action: "record", method: "cash" }, cookie)).status).toBe(409);
    expect(await payRow(outside)).toEqual(beforeOutside);
  });

  it("shows mark paid on the flight list and the flight for each real bill, and records cash or check from there", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor" });
    const renter = await makeUser({ email: "renter@example.com", name: "Renter Pilot", role: "renter" });
    const aircraftId = crypto.randomUUID();
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 100, 80, NULL, ?)`,
      )
      .bind(aircraftId, new Date().toISOString())
      .run();
    const dual = await insertLog({
      pilotId: renter.id,
      instructorId: instructor.id,
      aircraftId,
      aircraftCost: 21700,
      instructorCost: 10500,
      groundHours: 1.5,
      groundCost: 11250,
    });
    const solo = await insertLog({ pilotId: renter.id, instructorId: null, aircraftId, aircraftCost: 15500, instructorCost: 0 });
    const outside = await insertLog({
      pilotId: renter.id,
      instructorId: instructor.id,
      aircraftId,
      aircraftCost: 0,
      instructorCost: 0,
      external: true,
    });
    const before = await payRow(dual);

    for (const actor of [admin, instructor]) {
      const cookie = await login(actor.email!);
      const list = await (await get("/logs", cookie)).text();
      const detail = await (await get(`/logs/${dual}`, cookie)).text();
      const aircraftBill = await (await get(`/logs/${dual}/bill/aircraft`, cookie)).text();
      const instructorBill = await (await get(`/logs/${dual}/bill/instructor`, cookie)).text();
      for (const page of [list, detail, aircraftBill, instructorBill]) {
        expect(page).toContain(">Mark paid</button>");
        expect(page).toContain("Was this paid by cash or by check?");
        expect(page).not.toMatch(/name="method"[^>]*checked/);
      }
      const aircraftSlot = slot(list, `mark-paid-aircraft-${dual}`);
      const instructorSlot = slot(list, `mark-paid-instructor-${dual}`);
      expect(aircraftSlot).toContain("Aircraft bill");
      expect(aircraftSlot).toContain(">Mark paid</button>");
      expect(aircraftSlot).not.toContain("Mark this bill unpaid");
      expect(instructorSlot).toContain("Instructor bill");
      expect(instructorSlot).toContain("Ground instruction is included on this instructor bill.");
      expect(instructorSlot).toContain(">Mark paid</button>");
      expect(instructorSlot).not.toContain("Mark this bill unpaid");
      expect(detail).toContain("Ground instruction is included on this instructor bill.");
      expect(aircraftBill).toContain('id="bill-pay-form"');
      expect(aircraftBill).not.toContain("Mark this bill unpaid");
      expect(instructorBill).not.toContain("Mark this bill unpaid");
    }

    const adminCookie = await login(admin.email!);
    const adminList = await (await get("/logs", adminCookie)).text();
    expect(adminList).toContain(`action="/logs/${solo}/bill/aircraft/payment"`);
    expect(adminList).not.toContain(`/logs/${solo}/bill/instructor/payment`);
    expect(adminList).not.toContain(`/logs/${outside}/bill/`);
    const soloDetail = await (await get(`/logs/${solo}`, adminCookie)).text();
    expect(soloDetail).toContain(`action="/logs/${solo}/bill/aircraft/payment"`);
    expect(soloDetail).not.toContain(`/logs/${solo}/bill/instructor/payment`);
    const outsideDetail = await (await get(`/logs/${outside}`, adminCookie)).text();
    expect(outsideDetail).toContain("Paid outside app");
    expect(outsideDetail).not.toContain(">Mark paid</button>");
    expect(outsideDetail).not.toContain("/payment");
    expect(await payRow(dual)).toEqual(before);
    expect(await payRow(outside)).toMatchObject({ aircraft_payment_method: null, instructor_payment_method: null, paid: 0, total_cost_cents: 0 });

    const marked = await post(`/logs/${dual}/bill/aircraft/payment`, { action: "record", method: "cash", next: "/logs" }, adminCookie);
    expect(marked.status).toBe(303);
    expect(marked.headers.get("location")).toBe("/logs?notice=bill-paid-cash");
    const afterList = await (await get("/logs", adminCookie)).text();
    const paidAircraft = slot(afterList, `mark-paid-aircraft-${dual}`);
    expect(paidAircraft).toContain("Paid by cash.");
    expect(paidAircraft).toContain("Mark this bill unpaid");
    expect(paidAircraft).not.toContain('name="method"');
    expect(paidAircraft).not.toContain(">Mark paid</button>");
    const stillInstructor = slot(afterList, `mark-paid-instructor-${dual}`);
    expect(stillInstructor).toContain(">Mark paid</button>");
    expect(stillInstructor).not.toContain("Mark this bill unpaid");
    const afterDetail = await (await get(`/logs/${dual}`, adminCookie)).text();
    expect(slot(afterDetail, `mark-paid-aircraft-${dual}`)).toContain("Paid by cash.");
    expect((await payRow(dual)).paid).toBe(0);

    const instructorCookie = await login(instructor.email!);
    const instructorMarked = await post(`/logs/${dual}/bill/instructor/payment`, { action: "record", method: "check", next: `/logs/${dual}` }, instructorCookie);
    expect(instructorMarked.status).toBe(303);
    expect(instructorMarked.headers.get("location")).toBe(`/logs/${dual}?notice=bill-paid-check`);
    expect(await payRow(dual)).toMatchObject({
      aircraft_payment_method: "cash",
      instructor_payment_method: "check",
      paid: 1,
      aircraft_cost_cents: 21700,
      instructor_cost_cents: 10500,
      ground_cost_cents: 11250,
    });

    const renterCookie = await login(renter.email!);
    for (const path of ["/logs", `/logs/${dual}`, `/logs/${dual}/bill/aircraft`, `/logs/${dual}/bill/instructor`]) {
      const page = await (await get(path, renterCookie)).text();
      expect(page).not.toContain(">Mark paid</button>");
      expect(page).not.toContain("bill-pay-form");
      expect(page).not.toContain("Mark this bill unpaid");
    }
    expect((await post(`/logs/${dual}/bill/aircraft/payment`, { action: "record", method: "check", next: "/logs" }, renterCookie)).status).toBe(403);
    expect((await payRow(dual)).aircraft_payment_method).toBe("cash");
    const beforeOutside = await payRow(outside);
    expect((await post(`/logs/${outside}/bill/aircraft/payment`, { action: "record", method: "cash", next: "/logs" }, adminCookie)).status).toBe(409);
    expect(await payRow(outside)).toEqual(beforeOutside);
  });
});

function slot(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf("bill-pay-slot", start + 10);
  return html.slice(start, next === -1 ? start + 1500 : next);
}
