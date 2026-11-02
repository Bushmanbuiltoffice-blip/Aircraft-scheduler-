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
    DELETE FROM invites;
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




async function makePlane(): Promise<string> {
  const id = crypto.randomUUID();
  await db()
    .prepare(
      `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
       VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 100, 80, NULL, ?)`,
    )
    .bind(id, new Date().toISOString())
    .run();
  return id;
}

async function makeLog(input: { pilotId: string; aircraftId: string; cents: number; external?: boolean; instructorId?: string | null }): Promise<string> {
  const reservationId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() - 82_800_000).toISOString();
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?)`,
    )
    .bind(reservationId, input.aircraftId, input.pilotId, input.instructorId ?? null, now, end, input.pilotId, now, now)
    .run();
  await db()
    .prepare(
      `INSERT INTO flight_logs (id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
         aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at,
         imported, billing_status, billing_note)
       VALUES (?, ?, ?, ?, ?, 100, 101, 80, 80.8, 1, 15500, ?, 0, 0, 0, ?, 'wet', ?, ?, ?, ?)`,
    )
    .bind(
      id, reservationId, input.pilotId, input.instructorId ?? null, input.aircraftId, input.cents, input.cents, now,
      input.external ? 1 : 0, input.external ? "external" : "in_app", input.external ? "Historical import, billed outside app" : null,
    )
    .run();
  return id;
}

async function paidRow(id: string) {
  return db().prepare("SELECT paid, paid_at, paid_by, total_cost_cents, billing_status FROM flight_logs WHERE id = ?").bind(id).first<{
    paid: number; paid_at: string | null; paid_by: string | null; total_cost_cents: number; billing_status: string;
  }>();
}

beforeEach(async () => {
  await reset();
});

describe("Paid / unpaid on rentals", () => {
  async function setup() {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "Ivy Instructor", role: "instructor" });
    const renter = await makeUser({ email: "renter@example.com", name: "Rita Renter", role: "renter" });
    const student = await makeUser({ email: "student@example.com", name: "Sam Student", role: "student" });
    const plane = await makePlane();
    const rental = await makeLog({ pilotId: renter.id, aircraftId: plane, cents: 16275, instructorId: instructor.id });
    const studentRental = await makeLog({ pilotId: student.id, aircraftId: plane, cents: 9000 });
    const historical = await makeLog({ pilotId: renter.id, aircraftId: plane, cents: 0, external: true });
    return { admin, instructor, renter, student, plane, rental, studentRental, historical };
  }

  it("new rentals start unpaid and imports show paid outside the app with no toggle", async () => {
    const s = await setup();
    expect((await paidRow(s.rental))?.paid).toBe(0);
    const html = await (await get("/logs", await login(s.admin.email))).text();
    expect(html).toContain('<span class="pay-badge pay-unpaid">Unpaid</span>');
    expect(html).toContain('<span class="pay-badge pay-outside">Paid outside app</span>');
    expect(html).toContain(`action="/logs/${s.rental}/paid"`);
    expect(html).not.toContain(`action="/logs/${s.historical}/paid"`);
  });

  for (const role of ["admin", "instructor"] as const) {
    it(`${role}s get a one-tap toggle that persists, records who, and shows to everyone`, async () => {
      const s = await setup();
      const actor = role === "admin" ? s.admin : s.instructor;
      const cookie = await login(actor.email);
      const list = await (await get("/logs", cookie)).text();
      expect(list).toContain(`action="/logs/${s.rental}/paid"`);
      expect(list).toContain(">Mark paid</button>");
      const marked = await post(`/logs/${s.rental}/paid`, { paid: "1", next: "/logs#x" }, cookie);
      expect(marked.status).toBe(303);
      expect(marked.headers.get("location")).toBe("/logs#x");
      const row = await paidRow(s.rental);
      expect(row?.paid).toBe(1);
      expect(row?.paid_by).toBe(actor.id);
      expect(row?.paid_at).toBeTruthy();
      expect(row?.total_cost_cents).toBe(16275);
      // Posting the same value twice keeps it paid (no accidental flip).
      await post(`/logs/${s.rental}/paid`, { paid: "1" }, cookie);
      expect((await paidRow(s.rental))?.paid).toBe(1);

      const renterCookie = await login(s.renter.email);
      const detail = await (await get(`/logs/${s.rental}`, renterCookie)).text();
      expect(detail).toContain('<span class="pay-badge pay-paid">Paid</span>');
      expect(detail).toContain(`by ${actor.name}`);
      expect(detail).not.toContain("/paid\"");

      const back = await post(`/logs/${s.rental}/paid`, { paid: "0" }, cookie);
      expect(back.status).toBe(303);
      const after = await paidRow(s.rental);
      expect(after?.paid).toBe(0);
      expect(after?.paid_by).toBeNull();
    });
  }

  it("renters and students see the badge read-only and the server rejects their toggles", async () => {
    const s = await setup();
    for (const person of [s.renter, s.student]) {
      const cookie = await login(person.email);
      const list = await (await get("/logs", cookie)).text();
      expect(list).toContain("pay-badge pay-unpaid");
      expect(list).not.toContain('class="pay-form"');
      const own = person.id === s.renter.id ? s.rental : s.studentRental;
      const tried = await post(`/logs/${own}/paid`, { paid: "1" }, cookie);
      expect(tried.status).toBe(403);
      expect((await paidRow(own))?.paid).toBe(0);
    }
  });

  it("rejects toggles without a CSRF token or from another site, and never changes billed-outside imports", async () => {
    const s = await setup();
    const cookie = await login(s.admin.email);
    const cross = await SELF.fetch(`${BASE}/logs/${s.rental}/paid`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", cookie },
      body: "paid=1",
      redirect: "manual",
    });
    expect(cross.status).toBe(403);
    const noToken = await SELF.fetch(`${BASE}/logs/${s.rental}/paid`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: "paid=1",
      redirect: "manual",
    });
    expect(noToken.status).toBe(403);
    expect((await paidRow(s.rental))?.paid).toBe(0);
    const imported = await post(`/logs/${s.historical}/paid`, { paid: "0" }, cookie);
    expect(imported.status).toBe(409);
    const row = await paidRow(s.historical);
    expect(row).toMatchObject({ paid: 0, paid_at: null, total_cost_cents: 0, billing_status: "external" });
    // Unsafe return targets fall back to the log.
    const offsite = await post(`/logs/${s.rental}/paid`, { paid: "1", next: "//evil.example/x" }, cookie);
    expect(offsite.headers.get("location")).toBe(`/logs/${s.rental}`);
  });

  it("shows the badge wherever the amount shows, and outstanding equals the sum of unpaid", async () => {
    const s = await setup();
    const cookie = await login(s.admin.email);
    await post(`/logs/${s.studentRental}/paid`, { paid: "1" }, cookie);
    const dash = await (await get("/", cookie)).text();
    expect(dash).toContain("pay-badge pay-unpaid");
    expect(dash).toContain("pay-badge pay-paid");
    expect(dash).toContain('name="next" value="/#log-');
    // Rita owes $162.75 (her import is $0 and billed outside); Sam paid $90.
    expect(dash).toMatch(/<strong>\$162\.75<\/strong> outstanding/);
    const reservation = await db().prepare("SELECT reservation_id FROM flight_logs WHERE id = ?").bind(s.rental).first<string>("reservation_id");
    const booking = await (await get(`/reservations/${reservation}`, cookie)).text();
    expect(booking).toContain("pay-badge pay-unpaid");
    expect(booking).toContain(`name="next" value="/reservations/${reservation}"`);
    const person = await (await get(`/pilots/${s.renter.id}`, cookie)).text();
    expect(person).toContain("pay-badge pay-unpaid");
    expect(person).toContain("$162.75 billed · $0.00 paid · $162.75 unpaid (1 rental)");
    const self = await (await get("/account", await login(s.student.email))).text();
    expect(self).toContain("pay-badge pay-paid");
    expect(self).not.toContain('class="pay-form"');
  });
});
