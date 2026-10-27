import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken, UNUSABLE_PASSWORD_HASH, verifyPassword } from "../src/auth";
import prodSeedSql from "../scripts/prod-seed.sql";
import { buildDemoSeedSql } from "../src/demo_seed";
import { insertAdminIfNone, insertAircraft, insertUser, upsertCheckout } from "../src/db";
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
    id: crypto.randomUUID(),
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
  };
  await insertUser(db(), { ...user });
  return user;
}

async function makeAircraft(partial: Partial<Aircraft> = {}): Promise<Aircraft> {
  const aircraft: Aircraft = {
    id: partial.id ?? crypto.randomUUID(),
    tailNumber: partial.tailNumber ?? "N172RB",
    make: partial.make ?? "Cessna",
    model: partial.model ?? "172S",
    year: 2018,
    hourlyWetCents: partial.hourlyWetCents ?? 18000,
    hourlyDryCents: partial.hourlyDryCents === undefined ? 15000 : partial.hourlyDryCents,
    defaultRate: "wet",
    status: partial.status ?? "available",
    hobbs: partial.hobbs ?? 100,
    tach: partial.tach ?? 80,
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

beforeEach(async () => {
  await reset();
});

describe("auth and fleet", () => {
  it("sends a fresh database to setup and then signs in the owner", async () => {
    const first = await get("/");
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/setup");
    const created = await post("/setup", {
      name: "Kyle Bushman",
      email: "kyle@example.com",
      password: "Pattern123!",
      confirm: "Pattern123!",
    });
    expect(created.status).toBe(303);
    const cookie = sessionCookie(created);
    const home = await get("/", cookie);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Dispatch");
    expect((await get("/setup", cookie)).status).toBe(404);
    const again = await post("/setup", {
      name: "Someone Else",
      email: "other@example.com",
      password: "Pattern123!",
      confirm: "Pattern123!",
    });
    expect(again.status).toBe(404);
    const admins = await db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
    expect(Number(admins?.n)).toBe(1);
    const duplicate = await insertAdminIfNone(db(), {
      id: crypto.randomUUID(),
      email: "third@example.com",
      passwordHash: await hashPassword("Pattern123!"),
      name: "Third",
      role: "admin",
      phone: null,
      certificateType: null,
      certificateNumber: null,
      medicalClass: null,
      medicalExpiration: null,
      instructorRateCents: null,
      icalToken: newToken(),
      createdAt: new Date().toISOString(),
    });
    expect(duplicate).toBe(false);
    expect(Number((await db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>())?.n)).toBe(1);
  });

  it("lets the first visitor create an admin when Juan is already on the list, and Juan cannot sign in", async () => {
    await db().exec(prodSeedSql);
    await db().exec(prodSeedSql);
    const aircraft = await db().prepare("SELECT COUNT(*) AS n FROM aircraft").first<{ n: number }>();
    const people = await db().prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    const reservations = await db().prepare("SELECT COUNT(*) AS n FROM reservations").first<{ n: number }>();
    expect(Number(aircraft?.n)).toBe(1);
    expect(Number(people?.n)).toBe(1);
    expect(Number(reservations?.n)).toBe(0);
    const juan = await db()
      .prepare("SELECT email, password_hash, instructor_rate_cents, role FROM users WHERE name = 'Juan Valdivia'")
      .first<{ email: string | null; password_hash: string; instructor_rate_cents: number; role: string }>();
    expect(juan?.role).toBe("instructor");
    expect(juan?.email).toBeNull();
    expect(juan?.password_hash).toBe(UNUSABLE_PASSWORD_HASH);
    expect(juan?.instructor_rate_cents).toBe(7500);
    expect(await verifyPassword("disabled", UNUSABLE_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("Pattern123!", UNUSABLE_PASSWORD_HASH)).toBe(false);
    const plane = await db()
      .prepare("SELECT tail_number, model, hourly_wet_cents, hourly_dry_cents, hobbs, tach FROM aircraft")
      .first<{ tail_number: string; model: string; hourly_wet_cents: number; hourly_dry_cents: number | null; hobbs: number | null; tach: number | null }>();
    expect(plane?.tail_number).toBe("N1561Y");
    expect(plane?.model).toBe("172C");
    expect(plane?.hourly_wet_cents).toBe(15500);
    expect(plane?.hourly_dry_cents).toBeNull();
    expect(plane?.hobbs).toBeNull();
    expect(plane?.tach).toBeNull();
    const before = await get("/");
    expect(before.status).toBe(302);
    expect(before.headers.get("location")).toBe("/setup");
    expect((await get("/login")).status).toBe(302);
    const created = await post("/setup", {
      name: "Kyle Bushman",
      email: "kyle@example.com",
      password: "Pattern123!",
      confirm: "Pattern123!",
    });
    expect(created.status).toBe(303);
    expect((await get("/setup")).status).toBe(404);
    const blocked = await post("/setup", {
      name: "Someone Else",
      email: "other@example.com",
      password: "Pattern123!",
      confirm: "Pattern123!",
    });
    expect(blocked.status).toBe(404);
    await db().prepare("UPDATE users SET email = ? WHERE name = 'Juan Valdivia'").bind("juan.valdivia@example.com").run();
    const juanLogin = await post("/login", { email: "juan.valdivia@example.com", password: "Pattern123!" });
    expect(juanLogin.status).toBe(401);
    const juanWord = await post("/login", { email: "juan.valdivia@example.com", password: "disabled" });
    expect(juanWord.status).toBe(401);
    expect(Number((await db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>())?.n)).toBe(1);
    expect(Number((await db().prepare("SELECT COUNT(*) AS n FROM users WHERE name = 'Juan Valdivia'").first<{ n: number }>())?.n)).toBe(1);
  });

  it("rejects a bad password and lets an admin add an aircraft", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const denied = await post("/login", { email: "kyle@example.com", password: "not-the-password" });
    expect(denied.status).toBe(401);
    expect(await denied.text()).toContain("Email or password is incorrect");
    const cookie = await login("kyle@example.com");
    const saved = await post(
      "/aircraft",
      {
        tail_number: "n28rb",
        make: "Piper",
        model: "Archer",
        year: "2004",
        wet: "169.00",
        dry: "139.00",
        default_rate: "wet",
        status: "available",
        hobbs: "3890.2",
        tach: "3600.0",
        notes: "IFR",
      },
      cookie,
    );
    expect(saved.status).toBe(303);
    const fleet = await get("/aircraft", cookie);
    expect(await fleet.text()).toContain("N28RB");
  });

  it("stops a pilot from editing the fleet", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const cookie = await login("pilot@example.com");
    const response = await post("/aircraft", { tail_number: "N1", make: "Cessna", model: "152", wet: "10", dry: "8" }, cookie);
    expect(response.status).toBe(403);
  });
});

describe("scheduling", () => {
  it("books a flight, rejects conflicts, and allows the next slot", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "Maya Chen", role: "instructor" });
    const other = await makeUser({ email: "other@example.com", name: "Jordan Hale", role: "renter" });
    const aircraft = await makeAircraft();
    const otherAircraft = await makeAircraft({ tailNumber: "N182RB", model: "182T" });
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    await upsertCheckout(db(), { userId: other.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    await upsertCheckout(db(), { userId: other.id, aircraftId: otherAircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const cookie = await login(pilot.email);
    const first = slot(2, "10:00", "12:00");
    const booked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: pilot.id,
        instructor_id: instructor.id,
        starts_at: first.starts,
        ends_at: first.ends,
        rate_basis: "wet",
        notes: "Dual",
      },
      cookie,
    );
    expect(booked.status).toBe(303);
    const overlap = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: pilot.id,
        instructor_id: "",
        starts_at: slot(2, "11:00", "13:00").starts,
        ends_at: slot(2, "11:00", "13:00").ends,
        rate_basis: "wet",
      },
      cookie,
    );
    expect(overlap.status).toBe(422);
    expect(await overlap.text()).toContain("already booked");
    const instructorClash = await post(
      "/reservations",
      {
        aircraft_id: otherAircraft.id,
        pilot_id: other.id,
        instructor_id: instructor.id,
        starts_at: slot(2, "11:00", "12:30").starts,
        ends_at: slot(2, "11:00", "12:30").ends,
        rate_basis: "wet",
      },
      await login(admin.email),
    );
    expect(instructorClash.status).toBe(422);
    expect(await instructorClash.text()).toContain("Maya Chen");
    const adjacent = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: other.id,
        instructor_id: "",
        starts_at: slot(2, "12:00", "13:30").starts,
        ends_at: slot(2, "12:00", "13:30").ends,
        rate_basis: "wet",
      },
      await login(other.email),
    );
    expect(adjacent.status).toBe(303);
  });

  it("blocks maintenance, grounded aircraft, expired medicals, and missing checkouts", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const expired = await makeUser({
      email: "sam@example.com",
      name: "Sam Okonkwo",
      role: "renter",
      medicalExpiration: addDays(todayInZone(), -3),
    });
    const student = await makeUser({ email: "student@example.com", name: "Luis Ortega", role: "renter" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "Maya Chen", role: "instructor" });
    const aircraft = await makeAircraft();
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    await upsertCheckout(db(), { userId: expired.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const adminCookie = await login(admin.email);
    const down = await post(
      `/aircraft/${aircraft.id}/maintenance`,
      {
        starts_at: slot(3, "09:00", "11:00").starts,
        ends_at: slot(3, "12:00", "12:00").ends,
        reason: "Annual inspection",
        ground_now: "",
      },
      adminCookie,
    );
    expect(down.status).toBe(303);
    const duringMx = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: pilot.id,
        starts_at: slot(3, "10:00", "11:00").starts,
        ends_at: slot(3, "10:00", "11:00").ends,
        rate_basis: "wet",
      },
      await login(pilot.email),
    );
    expect(duringMx.status).toBe(422);
    expect(await duringMx.text()).toContain("maintenance");
    const clear = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: pilot.id,
        starts_at: slot(4, "10:00", "12:00").starts,
        ends_at: slot(4, "10:00", "12:00").ends,
        rate_basis: "wet",
      },
      await login(pilot.email),
    );
    expect(clear.status).toBe(303);
    await db().prepare("UPDATE aircraft SET status = 'grounded' WHERE id = ?").bind(aircraft.id).run();
    const grounded = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: pilot.id,
        starts_at: slot(5, "10:00", "12:00").starts,
        ends_at: slot(5, "10:00", "12:00").ends,
        rate_basis: "wet",
      },
      await login(pilot.email),
    );
    expect(grounded.status).toBe(422);
    expect(await grounded.text()).toContain("grounded");
    await db().prepare("UPDATE aircraft SET status = 'available' WHERE id = ?").bind(aircraft.id).run();
    const medical = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: expired.id,
        starts_at: slot(6, "10:00", "12:00").starts,
        ends_at: slot(6, "10:00", "12:00").ends,
        rate_basis: "wet",
      },
      await login(expired.email),
    );
    expect(medical.status).toBe(422);
    expect(await medical.text()).toContain("Medical expired");
    const noCheckout = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: student.id,
        starts_at: slot(6, "13:00", "15:00").starts,
        ends_at: slot(6, "13:00", "15:00").ends,
        rate_basis: "wet",
      },
      await login(student.email),
    );
    expect(noCheckout.status).toBe(422);
    expect(await noCheckout.text()).toContain("Not checked out");
    const ride = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: student.id,
        instructor_id: instructor.id,
        starts_at: slot(6, "13:00", "15:00").starts,
        ends_at: slot(6, "13:00", "15:00").ends,
        rate_basis: "wet",
      },
      await login(instructor.email),
    );
    expect(ride.status).toBe(303);
  });

  it("refuses a dry booking when the airplane has no dry rate", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const aircraft = await makeAircraft({ tailNumber: "N1561Y", model: "172C", hourlyWetCents: 15500, hourlyDryCents: null });
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const when = slot(3, "09:00", "11:00");
    const denied = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: pilot.id, starts_at: when.starts, ends_at: when.ends, rate_basis: "dry" },
      await login(pilot.email),
    );
    expect(denied.status).toBe(422);
    expect(await denied.text()).toContain("does not have a dry rate");
  });

  it("checks out, checks in, and stores Hobbs cost", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "Maya Chen", role: "instructor", instructorRateCents: 7500 });
    const aircraft = await makeAircraft({ hourlyWetCents: 15500, hourlyDryCents: null, hobbs: 100, tach: 80 });
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const cookie = await login(pilot.email);
    const when = slot(1, "09:00", "11:00");
    const booked = await post(
      "/reservations",
      {
        aircraft_id: aircraft.id,
        pilot_id: pilot.id,
        instructor_id: instructor.id,
        starts_at: when.starts,
        ends_at: when.ends,
        rate_basis: "wet",
      },
      cookie,
    );
    const location = booked.headers.get("location") ?? "";
    const id = /\/reservations\/([^?]+)/.exec(location)?.[1];
    expect(id).toBeTruthy();
    const out = await post(`/reservations/${id}/checkout`, { hobbs_out: "100.0", tach_out: "80.0" }, cookie);
    expect(out.status).toBe(303);
    const done = await post(`/reservations/${id}/checkin`, { hobbs_in: "101.4", tach_in: "81.1" }, cookie);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toContain("/logs/");
    const log = await get(done.headers.get("location") ?? "/", cookie);
    const html = await log.text();
    expect(html).toContain("$217.00");
    expect(html).toContain("$105.00");
    expect(html).toContain("$322.00");
    const meter = await db().prepare("SELECT hobbs FROM aircraft WHERE id = ?").bind(aircraft.id).first<{ hobbs: number }>();
    expect(meter?.hobbs).toBeCloseTo(101.4);
    const mail = await db().prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>();
    expect(Number(mail?.n)).toBeGreaterThan(0);
  });

  it("cancels a reservation and frees the airplane", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter" });
    const other = await makeUser({ email: "other@example.com", name: "Jordan Hale", role: "renter" });
    const aircraft = await makeAircraft();
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    await upsertCheckout(db(), { userId: other.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const cookie = await login(pilot.email);
    const when = slot(2, "08:00", "10:00");
    const booked = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: pilot.id, starts_at: when.starts, ends_at: when.ends, rate_basis: "wet" },
      cookie,
    );
    const id = /\/reservations\/([^?]+)/.exec(booked.headers.get("location") ?? "")?.[1];
    const blocked = await post(`/reservations/${id}/cancel`, { reason: "Weather" }, await login(other.email));
    expect(blocked.status).toBe(403);
    const cancelled = await post(`/reservations/${id}/cancel`, { reason: "Weather" }, cookie);
    expect(cancelled.status).toBe(303);
    const again = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: other.id, starts_at: when.starts, ends_at: when.ends, rate_basis: "wet" },
      await login(other.email),
    );
    expect(again.status).toBe(303);
  });

  it("publishes an iCal feed for the pilot and drops cancelled flights", async () => {
    await makeUser({ email: "owner@example.com", name: "Owner Admin", role: "admin" });
    const pilot = await makeUser({ email: "pilot@example.com", name: "Priya Shah", role: "renter", icalToken: "demo-feed-token" });
    const aircraft = await makeAircraft();
    await upsertCheckout(db(), { userId: pilot.id, aircraftId: aircraft.id, status: "current", checkedOutOn: todayInZone(), expiresOn: null });
    const cookie = await login(pilot.email);
    const when = slot(2, "15:00", "17:00");
    const booked = await post(
      "/reservations",
      { aircraft_id: aircraft.id, pilot_id: pilot.id, starts_at: when.starts, ends_at: when.ends, rate_basis: "wet" },
      cookie,
    );
    const id = /\/reservations\/([^?]+)/.exec(booked.headers.get("location") ?? "")?.[1];
    const feed = await get("/ical/demo-feed-token");
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    expect(await feed.text()).toContain("N172RB");
    await post(`/reservations/${id}/cancel`, {}, cookie);
    const after = await get("/ical/demo-feed-token");
    expect(await after.text()).not.toContain("N172RB");
    expect((await get("/ical/missing")).status).toBe(404);
  });
});

describe("sample data", () => {
  it("loads the demo seed", async () => {
    await db().exec(await buildDemoSeedSql(new Date("2026-10-26T18:00:00.000Z")));
    const aircraft = await db().prepare("SELECT COUNT(*) AS n FROM aircraft").first<{ n: number }>();
    const logs = await db().prepare("SELECT COUNT(*) AS n FROM flight_logs").first<{ n: number }>();
    expect(Number(aircraft?.n)).toBe(1);
    expect(Number(logs?.n)).toBeGreaterThan(0);
    const plane = await db()
      .prepare("SELECT tail_number, model, hourly_wet_cents, hourly_dry_cents FROM aircraft")
      .first<{ tail_number: string; model: string; hourly_wet_cents: number; hourly_dry_cents: number | null }>();
    expect(plane?.tail_number).toBe("N1561Y");
    expect(plane?.model).toBe("172C");
    expect(plane?.hourly_wet_cents).toBe(15500);
    expect(plane?.hourly_dry_cents).toBeNull();
    const instructors = await db().prepare("SELECT name, instructor_rate_cents FROM users WHERE role = 'instructor'").all<{ name: string; instructor_rate_cents: number }>();
    expect(instructors.results).toEqual([{ name: "Juan Valdivia", instructor_rate_cents: 7500 }]);
    const solo = await db()
      .prepare("SELECT total_cost_cents, aircraft_rate_cents FROM flight_logs WHERE flight_hours = 1.5")
      .first<{ total_cost_cents: number; aircraft_rate_cents: number }>();
    expect(solo?.aircraft_rate_cents).toBe(15500);
    expect(solo?.total_cost_cents).toBe(23250);
    const dual = await db()
      .prepare("SELECT total_cost_cents, instructor_rate_cents FROM flight_logs WHERE flight_hours = 1.8")
      .first<{ total_cost_cents: number; instructor_rate_cents: number }>();
    expect(dual?.instructor_rate_cents).toBe(7500);
    expect(dual?.total_cost_cents).toBe(41400);
    const cookie = await login("kyle.bushman@example.com");
    const home = await get("/", cookie);
    const html = await home.text();
    expect(html).toContain("N1561Y");
    expect(html).toContain("Juan Valdivia");
    expect(html).not.toContain("N172RB");
  });
});
