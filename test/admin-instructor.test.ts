import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { giveSignedAgreement } from "./agreement_fixture";
import { hashPassword, newToken } from "../src/auth";
import { MEDICAL_WITH_INSTRUCTOR_NOTE } from "../src/domain";
import { insertAircraft, insertUser, upsertCheckout } from "../src/db";
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
    hobbs: 100,
    tach: 80,
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

function personFields(input: { name: string; email: string; role: string; rate: string; medical: string | null }): Record<string, string> {
  return {
    name: input.name,
    email: input.email,
    role: input.role,
    phone: "",
    certificate_type: "commercial",
    certificate_number: "",
    medical_class: "third",
    medical_expiration: input.medical ?? "",
    instructor_rate: input.rate,
  };
}

beforeEach(reset);

describe("an admin with an instructor rate still instructs", () => {
  it("books, edits, and bills an admin-instructor at his saved rate, and keeps him on Coming up", async () => {
    const kyle = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin", instructorRateCents: null });
    const juan = await makeUser({
      email: "juan@example.com",
      name: "Juan Valdivia",
      role: "admin",
      instructorRateCents: 7500,
      medicalExpiration: addDays(todayInZone(), 300),
    });
    const student = await makeUser({
      email: "student@example.com",
      name: "Student Pilot",
      role: "student",
      medicalExpiration: null,
    });
    const aircraft = await makeAircraft();
    await upsertCheckout(db(), { userId: student.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    await giveSignedAgreement(db(), student);
    const kyleCookie = await login(kyle.email);
    const juanCookie = await login(juan.email);

    const picker = await (await get("/reservations/new", kyleCookie)).text();
    const instructorOptions = selectInner(picker, "instructor_id");
    expect(instructorOptions).toContain(`<option value="${juan.id}"`);
    expect(instructorOptions).not.toContain(kyle.id);
    const board = await (await get("/schedule?board=instructors", kyleCookie)).text();
    expect(board).toContain(`/reservations/new?instructor=${juan.id}`);
    expect(board).not.toContain(`/reservations/new?instructor=${kyle.id}`);

    const openStart = new Date(Date.now() - 26 * 3_600_000).toISOString();
    const openEnd = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const openId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'checked_out', 'wet', 'still out', ?, ?, ?)`,
      )
      .bind(openId, aircraft.id, student.id, juan.id, openStart, openEnd, juan.id, now, now)
      .run();
    const juanHome = comingUp(await (await get("/", juanCookie)).text());
    const kyleHome = comingUp(await (await get("/", kyleCookie)).text());
    expect(juanHome).toContain(`/reservations/${openId}`);
    expect(kyleHome).not.toContain(openId);

    const day = addDays(todayInZone(), 3);
    const booked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: student.id,
        instructor_id: juan.id,
        starts_at: `${day}T09:00`,
        ends_at: `${day}T11:00`,
        rate_basis: "wet",
        notes: "first lesson",
      },
      kyleCookie,
    );
    expect(booked.status).toBe(303);
    const id = /\/reservations\/([^?]+)/.exec(booked.headers.get("location") ?? "")?.[1] ?? "";
    const saved = await db().prepare("SELECT instructor_id, notes FROM reservations WHERE id = ?").bind(id).first<{ instructor_id: string; notes: string }>();
    expect(saved).toEqual({ instructor_id: juan.id, notes: "first lesson" });
    const page = await (await get(`/reservations/${id}`, kyleCookie)).text();
    expect(page).toContain(MEDICAL_WITH_INSTRUCTOR_NOTE);
    expect(page).toContain("Juan Valdivia");
    expect(comingUp(await (await get("/", juanCookie)).text())).toContain(`/reservations/${id}`);

    const edited = await post(
      `/reservations/${id}`,
      {
        aircraft_id: aircraft.id,
        pilot_id: student.id,
        instructor_id: juan.id,
        starts_at: `${day}T09:00`,
        ends_at: `${day}T11:00`,
        rate_basis: "wet",
        notes: "moved the briefing",
      },
      juanCookie,
    );
    expect(edited.status).toBe(303);
    const afterEdit = await db().prepare("SELECT instructor_id, notes FROM reservations WHERE id = ?").bind(id).first<{ instructor_id: string; notes: string }>();
    expect(afterEdit).toEqual({ instructor_id: juan.id, notes: "moved the briefing" });

    expect((await post(`/reservations/${id}/checkout`, { hobbs_out: "100.0", tach_out: "80.0", meters_confirmed: "yes" }, kyleCookie)).status).toBe(303);
    const checkinForm = await (await get(`/reservations/${id}`, kyleCookie)).text();
    expect(checkinForm).toContain('name="ground_hours"');
    expect(checkinForm).toContain("$75.00/hr");
    const checkedIn = await post(
      `/reservations/${id}/checkin`,
      { hobbs_in: "101.4", tach_in: "81.0", ground_hours: "1.5" },
      kyleCookie,
    );
    expect(checkedIn.status).toBe(303);
    const logId = /\/logs\/([^?]+)/.exec(checkedIn.headers.get("location") ?? "")?.[1] ?? "";
    const row = await db()
      .prepare(
        `SELECT instructor_id, instructor_rate_cents, instructor_cost_cents, ground_rate_cents, ground_cost_cents, aircraft_cost_cents
         FROM flight_logs WHERE id = ?`,
      )
      .bind(logId)
      .first<{
        instructor_id: string;
        instructor_rate_cents: number;
        instructor_cost_cents: number;
        ground_rate_cents: number;
        ground_cost_cents: number;
        aircraft_cost_cents: number;
      }>();
    expect(row).toEqual({
      instructor_id: juan.id,
      instructor_rate_cents: 7500,
      instructor_cost_cents: 10500,
      ground_rate_cents: 7500,
      ground_cost_cents: 11250,
      aircraft_cost_cents: 21700,
    });
    const bill = await (await get(`/logs/${logId}/bill/instructor`, juanCookie)).text();
    expect(bill).toContain("1.4 hr × $75.00/hr = $105.00");
    expect(bill).toContain("1.5 hr × $75.00/hr = $112.50");

    const account = await post(
      "/account",
      personFields({ name: juan.name, email: juan.email!, role: "admin", rate: "80.00", medical: juan.medicalExpiration }),
      juanCookie,
    );
    expect(account.status).toBe(303);
    const rate = await db().prepare("SELECT role, instructor_rate_cents FROM users WHERE id = ?").bind(juan.id).first<{ role: string; instructor_rate_cents: number }>();
    expect(rate).toEqual({ role: "admin", instructor_rate_cents: 8000 });
  });

  it("keeps the instructor rate when an admin changes that person's role to admin", async () => {
    const kyle = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin", instructorRateCents: null });
    const maya = await makeUser({ email: "maya@example.com", name: "Maya Chen", role: "instructor", instructorRateCents: 7500 });
    const cookie = await login(kyle.email);
    const form = await (await get(`/pilots/${maya.id}`, cookie)).text();
    expect(form).toContain('name="instructor_rate"');
    expect(form).toContain('value="75.00"');
    const saved = await post(
      `/pilots/${maya.id}`,
      personFields({ name: maya.name, email: maya.email!, role: "admin", rate: "75.00", medical: maya.medicalExpiration }),
      cookie,
    );
    expect(saved.status).toBe(303);
    const row = await db().prepare("SELECT role, instructor_rate_cents FROM users WHERE id = ?").bind(maya.id).first<{ role: string; instructor_rate_cents: number }>();
    expect(row).toEqual({ role: "admin", instructor_rate_cents: 7500 });
    const picker = await (await get("/reservations/new", cookie)).text();
    const instructorOptions = selectInner(picker, "instructor_id");
    expect(instructorOptions).toContain(`<option value="${maya.id}"`);
    expect(instructorOptions).toContain("Maya Chen");
  });
});

function selectInner(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf("</select>", start);
  if (start < 0 || end < 0) throw new Error(`Missing select ${id}`);
  return html.slice(start, end);
}
