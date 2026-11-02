import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertAircraft, insertUser, upsertCheckout } from "../src/db";
import { MEDICAL_WITH_INSTRUCTOR_NOTE } from "../src/domain";
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


function slot(dayOffset: number, start: string, end: string): { starts: string; ends: string } {
  const day = addDays(todayInZone(), dayOffset);
  return { starts: `${day}T${start}`, ends: `${day}T${end}` };
}

function reservationId(response: Response): string {
  const location = response.headers.get("location") ?? "";
  const id = /\/reservations\/([0-9a-f-]{36})/.exec(location)?.[1];
  if (!id) throw new Error(`No reservation id in ${location}`);
  return id;
}

beforeEach(async () => {
  await reset();
});

describe("medical with an instructor aboard", () => {
  async function setup() {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const juan = await makeUser({ email: "juan@example.com", name: "Juan Valdivia", role: "instructor", instructorRateCents: 7500 });
    const student = await makeUser({ email: "student@example.com", name: "Noah Burkhardt", role: "student", medicalExpiration: null });
    const renter = await makeUser({
      email: "renter@example.com",
      name: "Sam Okonkwo",
      role: "renter",
      medicalExpiration: addDays(todayInZone(), -5),
    });
    const aircraft = await makeAircraft();
    for (const person of [student, renter]) {
      await upsertCheckout(db(), { userId: person.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    }
    return { admin, juan, student, renter, aircraft };
  }

  it("lets a student or renter self-book with an instructor and shows the note, but blocks solo", async () => {
    const { juan, student, renter, aircraft } = await setup();
    for (const [index, person] of [student, renter].entries()) {
      const cookie = await login(person.email);
      const solo = await post(
        "/reservations",
        { aircraft_id: aircraft.id, starts_at: slot(2 + index, "09:00", "11:00").starts, ends_at: slot(2 + index, "09:00", "11:00").ends, rate_basis: "wet" },
        cookie,
      );
      expect(solo.status).toBe(422);
      expect(await solo.text()).toMatch(/No medical expiration is on file|Medical expired/);

      const dual = await post(
        "/reservations",
        {
          aircraft_id: aircraft.id,
          instructor_id: juan.id,
          starts_at: slot(2 + index, "09:00", "11:00").starts,
          ends_at: slot(2 + index, "09:00", "11:00").ends,
          rate_basis: "wet",
        },
        cookie,
      );
      expect(dual.status).toBe(303);
      const page = await get(`/reservations/${reservationId(dual)}`, cookie);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain(MEDICAL_WITH_INSTRUCTOR_NOTE);
    }
  });

  it("lets an admin book a student with an instructor, and blocks the solo version", async () => {
    const { admin, juan, student, aircraft } = await setup();
    const cookie = await login(admin.email);
    const solo = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: student.id, starts_at: slot(3, "09:00", "11:00").starts, ends_at: slot(3, "09:00", "11:00").ends, rate_basis: "wet" },
      cookie,
    );
    expect(solo.status).toBe(422);
    expect(await solo.text()).toContain("No medical expiration is on file");
    const dual = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: student.id,
        instructor_id: juan.id,
        starts_at: slot(3, "09:00", "11:00").starts,
        ends_at: slot(3, "09:00", "11:00").ends,
        rate_basis: "wet",
      },
      cookie,
    );
    expect(dual.status).toBe(303);
  });

  it("blocks again with the medical error when the instructor is removed on edit", async () => {
    const { juan, renter, aircraft } = await setup();
    const cookie = await login(renter.email);
    const times = slot(4, "09:00", "11:00");
    const dual = await post(
      "/reservations",
      { aircraft_id: aircraft.id, instructor_id: juan.id, starts_at: times.starts, ends_at: times.ends, rate_basis: "wet" },
      cookie,
    );
    expect(dual.status).toBe(303);
    const id = reservationId(dual);
    const keep = await post(
      `/reservations/${id}`,
      { aircraft_id: aircraft.id, instructor_id: juan.id, starts_at: times.starts, ends_at: times.ends, rate_basis: "wet", notes: "still dual" },
      cookie,
    );
    expect(keep.status).toBe(303);
    const solo = await post(
      `/reservations/${id}`,
      { aircraft_id: aircraft.id, instructor_id: "", starts_at: times.starts, ends_at: times.ends, rate_basis: "wet" },
      cookie,
    );
    expect(solo.status).toBe(422);
    expect(await solo.text()).toContain("Medical expired");
    const { results } = await db().prepare("SELECT instructor_id FROM reservations WHERE id = ?").bind(id).all<{ instructor_id: string | null }>();
    expect(results[0]?.instructor_id).toBe(juan.id);
  });

  it("checks out and checks in a dual flight for a pilot without a current medical", async () => {
    const { juan, student, aircraft } = await setup();
    const cookie = await login(student.email);
    const times = slot(1, "09:00", "11:00");
    const dual = await post(
      "/reservations",
      { aircraft_id: aircraft.id, instructor_id: juan.id, starts_at: times.starts, ends_at: times.ends, rate_basis: "wet" },
      cookie,
    );
    expect(dual.status).toBe(303);
    const id = reservationId(dual);
    const out = await post(`/reservations/${id}/checkout`, { hobbs_out: "100.0", tach_out: "80.0", meters_confirmed: "yes" }, cookie);
    expect(out.status).toBe(303);
    const back = await post(`/reservations/${id}/checkin`, { hobbs_in: "101.5", tach_in: "81.2" }, cookie);
    expect(back.status).toBe(303);
    expect(back.headers.get("location") ?? "").toMatch(/^\/logs\//);
  });

  it("keeps the aircraft checkout requirement for a self-booked student with an instructor", async () => {
    const { juan, aircraft } = await setup();
    const fresh = await makeUser({ email: "new@example.com", name: "Jett Rhoads", role: "student", medicalExpiration: null });
    const response = await post(
      "/reservations",
      { aircraft_id: aircraft.id, instructor_id: juan.id, starts_at: slot(5, "09:00", "11:00").starts, ends_at: slot(5, "09:00", "11:00").ends, rate_basis: "wet" },
      await login(fresh.email),
    );
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain("Not checked out in N1561Y");
    expect(text).toContain(MEDICAL_WITH_INSTRUCTOR_NOTE);
  });
});
