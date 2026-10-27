import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { STUDENT_SOLO_WARNING } from "../src/copy";
import { billingByPilot, insertAircraft, insertUser, monthTotals, upsertCheckout } from "../src/db";
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

async function logSnapshot(): Promise<unknown[]> {
  const { results } = await db().prepare("SELECT * FROM flight_logs ORDER BY id").all();
  return results;
}

async function insertReservation(input: {
  id?: string;
  aircraftId: string;
  pilotId: string;
  instructorId?: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  createdBy: string;
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await db()
    .prepare(
      `INSERT INTO reservations (
        id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis,
        notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'wet', 'leave this note', ?, ?, ?)`,
    )
    .bind(id, input.aircraftId, input.pilotId, input.instructorId ?? null, input.startsAt, input.endsAt, input.status, input.createdBy, now, now)
    .run();
  return id;
}

beforeEach(async () => {
  await reset();
});

describe("deleting a person", () => {
  it("never deletes or alters flight logs, and only soft-deletes when history exists", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const juan = await makeUser({ email: null, name: "Juan Valdivia", role: "instructor", instructorRateCents: 7500 });
    const aircraft = await makeAircraft();
    const now = Date.now();
    const past = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: pilot.id,
      instructorId: juan.id,
      startsAt: new Date(now - 10 * 86_400_000).toISOString(),
      endsAt: new Date(now - 10 * 86_400_000 + 3_600_000).toISOString(),
      status: "checked_in",
      createdBy: admin.id,
    });
    const started = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: pilot.id,
      instructorId: juan.id,
      startsAt: new Date(now - 3_600_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      status: "checked_out",
      createdBy: admin.id,
    });
    const future = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: pilot.id,
      instructorId: juan.id,
      startsAt: new Date(now + 3 * 86_400_000).toISOString(),
      endsAt: new Date(now + 3 * 86_400_000 + 7_200_000).toISOString(),
      status: "scheduled",
      createdBy: admin.id,
    });
    const logId = crypto.randomUUID();
    await db()
      .prepare(
        `INSERT INTO flight_logs (
          id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in,
          tach_out, tach_in, flight_hours, aircraft_rate_cents, aircraft_cost_cents,
          instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents,
          rate_basis, created_at, ground_hours, aircraft_paid, instructor_paid, maintenance_flight,
          fuel_added_gal, oil_added_qt, rental_type, imported, instructor_name, billing_status, billing_note
        ) VALUES (?, ?, ?, ?, ?, 279.1, 280.1, 435.9, 436.5, 1.0, 15500, 15500, 7500, 1.0, 7500, 23000, 'wet', ?, 0.4, 1, 1, 0, 12.5, 1, 'Discovery flight', 0, NULL, 'in_app', 'do-not-touch')`,
      )
      .bind(logId, past, pilot.id, juan.id, aircraft.id, new Date().toISOString())
      .run();
    const beforeLogs = await logSnapshot();
    expect(beforeLogs).toHaveLength(1);
    const wide = { start: "2000-01-01T00:00:00.000Z", end: "2100-01-01T00:00:00.000Z" };
    const beforeTotals = await monthTotals(db(), wide.start, wide.end);
    const beforeBilling = await billingByPilot(db());
    expect(beforeBilling.map((row) => row.name)).toContain("Priya Shah");

    const adminCookie = await login(admin.email);
    const pilotCookie = await login(pilot.email);
    const confirm = await get(`/pilots/${pilot.id}/delete`, adminCookie);
    expect(confirm.status).toBe(200);
    const confirmHtml = await confirm.text();
    expect(confirmHtml).toContain("Deleting a person never deletes or alters their flight logs.");
    expect(confirmHtml).toContain("Past flight logs keep showing their name.");
    expect(confirmHtml).toContain("1 flight log");
    expect(confirmHtml).toContain("1 future reservation will be cancelled.");
    expect(confirmHtml).toContain("Reservations that have already started are left as they are.");
    expect(confirmHtml).toContain("hidden from People, pilot lists, and billing");
    expect(confirmHtml).toContain("Remove this person");

    const removed = await post(`/pilots/${pilot.id}/delete`, {}, adminCookie);
    expect(removed.status).toBe(303);
    expect(removed.headers.get("location")).toBe("/pilots?notice=person-removed");
    const afterLogs = await logSnapshot();
    expect(afterLogs).toEqual(beforeLogs);
    const kept = await db()
      .prepare("SELECT pilot_id, instructor_id, billing_note, hobbs_in, fuel_added_gal, ground_hours FROM flight_logs WHERE id = ?")
      .bind(logId)
      .first<{ pilot_id: string; instructor_id: string; billing_note: string; hobbs_in: number; fuel_added_gal: number; ground_hours: number }>();
    expect(kept?.pilot_id).toBe(pilot.id);
    expect(kept?.instructor_id).toBe(juan.id);
    expect(kept?.billing_note).toBe("do-not-touch");
    expect(kept?.hobbs_in).toBeCloseTo(280.1);
    expect(kept?.fuel_added_gal).toBeCloseTo(12.5);
    expect(kept?.ground_hours).toBeCloseTo(0.4);
    expect(await monthTotals(db(), wide.start, wide.end)).toEqual(beforeTotals);

    const row = await db().prepare("SELECT deleted_at FROM users WHERE id = ?").bind(pilot.id).first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeTruthy();
    const futureStatus = await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(future).first<{ status: string }>();
    const startedStatus = await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(started).first<{ status: string }>();
    const pastStatus = await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(past).first<{ status: string }>();
    expect(futureStatus?.status).toBe("cancelled");
    expect(startedStatus?.status).toBe("checked_out");
    expect(pastStatus?.status).toBe("checked_in");

    const people = await get(removed.headers.get("location") ?? "/pilots", adminCookie);
    const peopleHtml = await people.text();
    expect(peopleHtml).toContain("Person removed. Their flight logs were not deleted or changed.");
    expect(peopleHtml).not.toContain("Priya Shah");
    const logsPage = await get("/logs", adminCookie);
    expect(await logsPage.text()).toContain("Priya Shah");
    const booking = await get("/reservations/new", adminCookie);
    expect(await booking.text()).not.toContain("Priya Shah");
    expect((await billingByPilot(db())).map((row) => row.id)).not.toContain(pilot.id);
    const signedOut = await get("/", pilotCookie);
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toContain("/login");
    const personPage = await get(`/pilots/${pilot.id}`, adminCookie);
    const personHtml = await personPage.text();
    expect(personHtml).toContain("Priya Shah");
    expect(personHtml).toContain("never deletes or alters their flight logs");
  });

  it("hard-deletes a person with no history and refuses self or the last admin", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const spare = await makeUser({ email: "spare@example.com", name: "Spare Admin", role: "admin" });
    const visitor = await makeUser({ email: "new@example.com", name: "New Person", role: "renter" });
    const aircraft = await makeAircraft();
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const pastId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: pilot.id,
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 80_000_000).toISOString(),
      status: "checked_in",
      createdBy: admin.id,
    });
    await db()
      .prepare(
        `INSERT INTO flight_logs (
          id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in,
          flight_hours, aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours,
          instructor_cost_cents, total_cost_cents, rate_basis, created_at
        ) VALUES (?, ?, ?, NULL, ?, 10, 11, 8, 8.8, 1, 15500, 15500, 0, 0, 0, 15500, 'wet', ?)`,
      )
      .bind(crypto.randomUUID(), pastId, pilot.id, aircraft.id, new Date().toISOString())
      .run();
    const beforeLogs = await logSnapshot();
    const cookie = await login(admin.email);

    const selfPage = await get(`/pilots/${admin.id}/delete`, cookie);
    const selfHtml = await selfPage.text();
    expect(selfHtml).toContain("You cannot remove your own account.");
    expect(selfHtml).not.toContain("This is the last admin.");
    expect(selfHtml).toContain("never deletes or alters their flight logs");
    expect(selfHtml).not.toContain("Remove this person");
    const selfPost = await post(`/pilots/${admin.id}/delete`, {}, cookie);
    expect(selfPost.status).toBe(200);
    expect(await db().prepare("SELECT id FROM users WHERE id = ?").bind(admin.id).first()).toBeTruthy();

    const confirm = await get(`/pilots/${visitor.id}/delete`, cookie);
    const confirmHtml = await confirm.text();
    expect(confirmHtml).toContain("no flight logs and no reservations");
    expect(confirmHtml).toContain("There are no flight logs to change.");
    const gone = await post(`/pilots/${visitor.id}/delete`, {}, cookie);
    expect(gone.status).toBe(303);
    expect(await db().prepare("SELECT id FROM users WHERE id = ?").bind(visitor.id).first()).toBeNull();
    expect(await logSnapshot()).toEqual(beforeLogs);

    const spareGone = await post(`/pilots/${spare.id}/delete`, {}, cookie);
    expect(spareGone.status).toBe(303);
    expect(await db().prepare("SELECT id FROM users WHERE id = ?").bind(spare.id).first()).toBeNull();
    const only = await get(`/pilots/${admin.id}/delete`, cookie);
    const onlyHtml = await only.text();
    expect(onlyHtml).toContain("This is the last admin.");
    expect(onlyHtml).toContain("You cannot remove your own account.");
    expect(onlyHtml).not.toContain("Remove this person");
    expect((await post(`/pilots/${admin.id}/delete`, {}, cookie)).status).toBe(200);
    expect(await db().prepare("SELECT id FROM users WHERE id = ?").bind(admin.id).first()).toBeTruthy();
    expect(await logSnapshot()).toEqual(beforeLogs);

    const pilotCookie = await login(pilot.email);
    expect((await post(`/pilots/${admin.id}/delete`, {}, pilotCookie)).status).toBe(403);
  });

  it("lets an admin remove Juan and leaves the flights he taught unchanged", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    await makeUser({ email: "second@example.com", name: "Second Admin", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Noah", role: "renter" });
    const juan = await makeUser({ email: null, name: "Juan Valdivia", role: "instructor" });
    const aircraft = await makeAircraft();
    const reservationId = await insertReservation({
      aircraftId: aircraft.id,
      pilotId: pilot.id,
      instructorId: juan.id,
      startsAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 5 * 86_400_000 + 3_600_000).toISOString(),
      status: "checked_in",
      createdBy: admin.id,
    });
    await db()
      .prepare(
        `INSERT INTO flight_logs (
          id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in,
          flight_hours, aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours,
          instructor_cost_cents, total_cost_cents, rate_basis, created_at, billing_status, billing_note
        ) VALUES (?, ?, ?, ?, ?, 279.4, 280.1, 435.9, 436.5, 0.7, 0, 0, 0, 0.7, 0, 0, 'wet', ?, 'external', 'Historical import, billed outside app')`,
      )
      .bind(crypto.randomUUID(), reservationId, pilot.id, juan.id, aircraft.id, new Date().toISOString())
      .run();
    const beforeLogs = await logSnapshot();
    const cookie = await login(admin.email);
    const confirm = await get(`/pilots/${juan.id}/delete`, cookie);
    const html = await confirm.text();
    expect(html).toContain("Juan Valdivia is an instructor. You can remove him.");
    expect(html).toContain("Remove this person");
    expect((await post(`/pilots/${juan.id}/delete`, {}, cookie)).status).toBe(303);
    expect(await logSnapshot()).toEqual(beforeLogs);
    const logs = await get("/logs", cookie);
    expect(await logs.text()).toContain("Juan Valdivia");
    const hidden = await db().prepare("SELECT deleted_at FROM users WHERE id = ?").bind(juan.id).first<{ deleted_at: string | null }>();
    expect(hidden?.deleted_at).toBeTruthy();
  });
});

describe("students", () => {
  it("adds a student, shows the badge, and books solo with a warning", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "Maya Chen", role: "instructor" });
    const aircraft = await makeAircraft();
    const adminCookie = await login(admin.email);
    const created = await post(
      "/pilots",
      {
        name: "Ada Student",
        email: "ada@example.com",
        role: "student",
        phone: "",
        certificate_type: "student",
        certificate_number: "",
        medical_class: "third",
        medical_expiration: addDays(todayInZone(), 400),
        instructor_rate: "",
        password: "Pattern123!",
      },
      adminCookie,
    );
    expect(created.status).toBe(303);
    const student = await db().prepare("SELECT id, role FROM users WHERE email = 'ada@example.com'").first<{ id: string; role: string }>();
    expect(student?.role).toBe("student");
    const people = await get("/pilots", adminCookie);
    const peopleHtml = await people.text();
    expect(peopleHtml).toContain("pill role-student");
    expect(peopleHtml).toContain("Ada Student");
    expect(peopleHtml).toContain(`/pilots/${student?.id}/delete`);

    const picker = await get("/reservations/new", adminCookie);
    const pickerHtml = await picker.text();
    expect(pickerHtml).toContain("Ada Student · Student");
    expect(pickerHtml).toContain('data-role="student"');
    const logs = await get("/logs", adminCookie);
    expect(await logs.text()).toContain("Ada Student · Student");

    await upsertCheckout(db(), {
      userId: student!.id,
      aircraftId: aircraft.id,
      status: "current",
      checkedOutOn: todayInZone(),
      expiresOn: null,
    });
    const studentCookie = await login("ada@example.com");
    const home = await get("/", studentCookie);
    expect(home.status).toBe(200);
    expect(await home.text()).not.toContain('href="/pilots"');
    expect((await get("/pilots", studentCookie)).headers.get("location")).toBe("/account");
    expect((await get("/pilots/new", studentCookie)).status).toBe(403);

    const form = await get("/reservations/new", studentCookie);
    const formHtml = await form.text();
    expect(formHtml).toContain("instructor-expected");
    expect(formHtml).toContain(STUDENT_SOLO_WARNING);
    expect(formHtml).toContain("pill role-student");
    expect(formHtml).not.toMatch(/id="student-solo-warning"[^>]*hidden/);
    expect(formHtml).toContain('name="pilot_id"');

    const blocked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: admin.id,
        instructor_id: "",
        starts_at: `${addDays(todayInZone(), 3)}T09:00`,
        ends_at: `${addDays(todayInZone(), 3)}T11:00`,
        rate_basis: "wet",
      },
      studentCookie,
    );
    expect(blocked.status).toBe(303);
    const bookedId = /\/reservations\/([^?]+)/.exec(blocked.headers.get("location") ?? "")?.[1];
    const owner = await db().prepare("SELECT pilot_id, instructor_id FROM reservations WHERE id = ?").bind(bookedId).first<{ pilot_id: string; instructor_id: string | null }>();
    expect(owner?.pilot_id).toBe(student?.id);
    expect(owner?.instructor_id).toBeNull();
    const reserved = await get(`/reservations/${bookedId}`, studentCookie);
    const reservedHtml = await reserved.text();
    expect(reservedHtml).toContain(STUDENT_SOLO_WARNING);
    expect(reservedHtml).toContain("pill role-student");

    const withInstructor = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: student!.id,
        instructor_id: instructor.id,
        starts_at: `${addDays(todayInZone(), 4)}T09:00`,
        ends_at: `${addDays(todayInZone(), 4)}T11:00`,
        rate_basis: "wet",
      },
      studentCookie,
    );
    expect(withInstructor.status).toBe(303);
    const dualId = /\/reservations\/([^?]+)/.exec(withInstructor.headers.get("location") ?? "")?.[1];
    const dualPage = await get(`/reservations/${dualId}`, studentCookie);
    expect(await dualPage.text()).not.toContain(STUDENT_SOLO_WARNING);

    const noCheckout = await makeUser({ email: "solo@example.com", name: "Solo Student", role: "student" });
    const denied = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: noCheckout.id,
        instructor_id: "",
        starts_at: `${addDays(todayInZone(), 5)}T09:00`,
        ends_at: `${addDays(todayInZone(), 5)}T11:00`,
        rate_basis: "wet",
      },
      await login(noCheckout.email),
    );
    expect(denied.status).toBe(422);
    expect(await denied.text()).toContain("Not checked out");
  });
});
