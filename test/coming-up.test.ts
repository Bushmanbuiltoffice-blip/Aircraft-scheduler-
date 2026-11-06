import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertAircraft, insertUser, upsertCheckout } from "../src/db";
import { addDays, todayInZone, zonedTimeToUtc } from "../src/time";
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

function comingUp(html: string): string {
  const start = html.indexOf('id="dash-coming-up"');
  const end = html.indexOf('id="dash-aircraft"');
  if (start < 0 || end <= start) throw new Error("Coming up section missing");
  return html.slice(start, end);
}

function todaySection(html: string): string {
  const start = html.indexOf('id="dash-today"');
  const end = html.indexOf('id="dash-flight-log"');
  if (start < 0 || end <= start) throw new Error("Today section missing");
  return html.slice(start, end);
}

async function insertReservation(input: {
  aircraftId: string;
  pilotId: string;
  instructorId?: string | null;
  createdBy: string;
  startsAt: string;
  endsAt: string;
  status?: string;
  notes?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'wet', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.aircraftId,
      input.pilotId,
      input.instructorId ?? null,
      input.startsAt,
      input.endsAt,
      input.status ?? "scheduled",
      input.notes ?? null,
      input.createdBy,
      now,
      now,
    )
    .run();
  return id;
}

beforeEach(async () => {
  await reset();
});

describe("Coming up for both people on a flight", () => {
  it("shows an instructor-created flight to the assigned renter and instructor, not to anyone else", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor" });
    const student = await makeUser({ email: "student@example.com", name: "Student Pilot", role: "student" });
    const stranger = await makeUser({ email: "other@example.com", name: "Other Pilot", role: "renter" });
    const aircraft = await makeAircraft();
    const day = addDays(todayInZone(), 3);
    const booked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: student.id,
        instructor_id: instructor.id,
        starts_at: `${day}T09:00`,
        ends_at: `${day}T11:00`,
        rate_basis: "wet",
        notes: "private lesson note",
      },
      await login(instructor.email),
    );
    expect(booked.status).toBe(303);
    const id = /\/reservations\/([^?]+)/.exec(booked.headers.get("location") ?? "")?.[1] ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = await db()
      .prepare("SELECT pilot_id, instructor_id, created_by FROM reservations WHERE id = ?")
      .bind(id)
      .first<{ pilot_id: string; instructor_id: string; created_by: string }>();
    expect(row).toEqual({ pilot_id: student.id, instructor_id: instructor.id, created_by: instructor.id });

    const studentHtml = await (await get("/", await login(student.email))).text();
    const instructorHtml = await (await get("/", await login(instructor.email))).text();
    const strangerHtml = await (await get("/", await login(stranger.email))).text();
    const adminHtml = await (await get("/", await login(admin.email))).text();
    expect(comingUp(studentHtml)).toContain(`/reservations/${id}`);
    expect(comingUp(instructorHtml)).toContain(`/reservations/${id}`);
    expect(comingUp(adminHtml)).toContain(`/reservations/${id}`);
    expect(comingUp(strangerHtml)).not.toContain(id);
    expect(studentHtml).not.toContain("private lesson note");
    expect((await get(`/reservations/${id}`, await login(student.email))).status).toBe(200);
    expect((await get(`/reservations/${id}`, await login(instructor.email))).status).toBe(200);
    expect((await get(`/reservations/${id}`, await login(admin.email))).status).toBe(200);
    const hidden = await get(`/reservations/${id}`, await login(stranger.email));
    expect(hidden.status).toBe(403);
    expect(await hidden.text()).not.toContain("private lesson note");
  });

  it("keeps creator out of the filter for renter-booked, admin-booked, solo, cancelled, completed, and live flights", async () => {
    const admin = await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "CFI One", role: "instructor" });
    const renter = await makeUser({ email: "renter@example.com", name: "Renter Pilot", role: "renter" });
    const stranger = await makeUser({ email: "other@example.com", name: "Other Pilot", role: "renter" });
    const aircraft = await makeAircraft();
    await upsertCheckout(db(), { userId: renter.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const soonEnd = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const later = new Date(Date.now() + 50 * 3_600_000).toISOString();
    const laterEnd = new Date(Date.now() + 52 * 3_600_000).toISOString();
    const past = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const pastEnd = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const endOfToday = zonedTimeToUtc(`${addDays(todayInZone(), 1)}T00:00`).toISOString();

    const selfBooked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: renter.id,
        instructor_id: instructor.id,
        starts_at: `${addDays(todayInZone(), 4)}T13:00`,
        ends_at: `${addDays(todayInZone(), 4)}T15:00`,
        rate_basis: "wet",
      },
      await login(renter.email),
    );
    const selfId = /\/reservations\/([^?]+)/.exec(selfBooked.headers.get("location") ?? "")?.[1] ?? "";
    expect(selfBooked.status).toBe(303);

    const adminBooked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: renter.id,
        instructor_id: instructor.id,
        starts_at: `${addDays(todayInZone(), 5)}T13:00`,
        ends_at: `${addDays(todayInZone(), 5)}T15:00`,
        rate_basis: "wet",
      },
      await login(admin.email),
    );
    const adminId = /\/reservations\/([^?]+)/.exec(adminBooked.headers.get("location") ?? "")?.[1] ?? "";
    expect(adminBooked.status).toBe(303);

    const soloId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: renter.id,
      createdBy: admin.id,
      startsAt: later,
      endsAt: laterEnd,
    });
    const soonId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: renter.id,
      instructorId: instructor.id,
      createdBy: stranger.id,
      startsAt: soon,
      endsAt: soonEnd,
    });
    const finishedId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: renter.id,
      instructorId: instructor.id,
      createdBy: instructor.id,
      startsAt: past,
      endsAt: pastEnd,
      status: "checked_in",
    });
    const cancelledId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: renter.id,
      instructorId: instructor.id,
      createdBy: instructor.id,
      startsAt: later,
      endsAt: laterEnd,
      status: "cancelled",
    });
    const overdueOutId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: renter.id,
      instructorId: instructor.id,
      createdBy: admin.id,
      startsAt: past,
      endsAt: pastEnd,
      status: "checked_out",
    });
    const roomBeforeMidnight = new Date(endOfToday).getTime() - Date.now();
    const stillTodayId = roomBeforeMidnight > 3 * 60_000
      ? await insertReservation({
          aircraftId: aircraft.id,
          pilotId: renter.id,
          instructorId: instructor.id,
          createdBy: instructor.id,
          startsAt: new Date(new Date(endOfToday).getTime() - 2 * 60_000).toISOString(),
          endsAt: new Date(new Date(endOfToday).getTime() - 60_000).toISOString(),
        })
      : null;
    const strangerFlight = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: stranger.id,
      createdBy: stranger.id,
      startsAt: later,
      endsAt: laterEnd,
      notes: "someone else's note",
    });

    const renterComing = comingUp(await (await get("/", await login(renter.email))).text());
    const instructorComing = comingUp(await (await get("/", await login(instructor.email))).text());
    const strangerComing = comingUp(await (await get("/", await login(stranger.email))).text());
    const adminComing = comingUp(await (await get("/", await login(admin.email))).text());

    for (const id of [selfId, adminId, soloId, soonId, overdueOutId, stillTodayId].filter((id): id is string => Boolean(id))) {
      expect(renterComing).toContain(`/reservations/${id}`);
    }
    if (stillTodayId) {
      expect(instructorComing).toContain(`/reservations/${stillTodayId}`);
      expect(adminComing).not.toContain(stillTodayId);
    }
    for (const id of [finishedId, cancelledId, strangerFlight]) expect(renterComing).not.toContain(id);
    expect(renterComing).not.toContain("someone else's note");
    expect(renterComing.indexOf(soonId)).toBeLessThan(renterComing.indexOf(soloId));
    expect(renterComing.split(soonId).length - 1).toBe(1);

    for (const id of [selfId, adminId, soonId, overdueOutId]) expect(instructorComing).toContain(`/reservations/${id}`);
    expect(instructorComing).not.toContain(soloId);
    expect(instructorComing).not.toContain(finishedId);
    expect(instructorComing).not.toContain(cancelledId);
    expect(instructorComing).not.toContain(strangerFlight);

    expect(strangerComing).toContain(`/reservations/${strangerFlight}`);
    expect(strangerComing).not.toContain(selfId);
    expect(strangerComing).not.toContain(soonId);
    expect((await get(`/reservations/${soonId}`, await login(stranger.email))).status).toBe(403);

    const adminIncludes = (startsAt: string, status: string) =>
      (status === "scheduled" || status === "checked_out") && startsAt >= endOfToday;
    for (const [id, startsAt, status] of [
      [selfId, zonedTimeToUtc(`${addDays(todayInZone(), 4)}T13:00`).toISOString(), "scheduled"],
      [adminId, zonedTimeToUtc(`${addDays(todayInZone(), 5)}T13:00`).toISOString(), "scheduled"],
      [soloId, later, "scheduled"],
      [soonId, soon, "scheduled"],
      [overdueOutId, past, "checked_out"],
      [finishedId, past, "checked_in"],
      [cancelledId, later, "cancelled"],
      [strangerFlight, later, "scheduled"],
    ] as const) {
      if (adminIncludes(startsAt, status)) expect(adminComing).toContain(`/reservations/${id}`);
      else expect(adminComing).not.toContain(id);
    }

    const renterPage = await (await get("/", await login(renter.email))).text();
    if (soon < endOfToday) expect(todaySection(renterPage)).toContain(`/reservations/${soonId}`);
  });
});
