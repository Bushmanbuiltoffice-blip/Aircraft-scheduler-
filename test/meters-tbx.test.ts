import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { replaceInsurancePdf } from "../src/documents";
import { insertUser } from "../src/db";
import { computeFlightCost } from "../src/domain";
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
    DELETE FROM tbx_entries;
    DELETE FROM user_document_chunks;
    DELETE FROM user_documents;
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

function samplePdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
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
       VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 318.6, 467.4, NULL, ?)`,
    )
    .bind(id, new Date().toISOString())
    .run();
  return id;
}



async function makeReservation(pilotId: string, aircraftId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'scheduled', 'wet', NULL, ?, ?, ?)`,
    )
    .bind(id, aircraftId, pilotId, new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 7_200_000).toISOString(), pilotId, now, now)
    .run();
  return id;
}

async function status(id: string): Promise<string | null> {
  return db().prepare("SELECT status FROM reservations WHERE id = ?").bind(id).first<string>("status");
}

async function meters(id: string) {
  return db().prepare("SELECT hobbs, tach FROM aircraft WHERE id = ?").bind(id).first<{ hobbs: number; tach: number }>();
}

beforeEach(async () => {
  await reset();
});

describe("Hobbs and tach on every flight", () => {
  async function setup() {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    await replaceInsurancePdf(db(), { userId: admin.id, fileName: "sample-insurance.pdf", bytes: samplePdf(), uploadedBy: admin.id });
    const plane = await makePlane();
    const reservation = await makeReservation(admin.id, plane);
    return { admin, plane, reservation, cookie: await login(admin.email) };
  }

  it("check-out shows both meters prefilled with the airplane's readings, a confirm box, and tach marked not billed", async () => {
    const s = await setup();
    const html = await (await get(`/reservations/${s.reservation}`, s.cookie)).text();
    expect(html).toMatch(/name="hobbs_out"[^>]*required[^>]*value="318.6"/);
    expect(html).toMatch(/name="tach_out"[^>]*required[^>]*value="467.4"/);
    expect(html).toContain('name="meters_confirmed" value="yes" required');
    expect(html).toContain("Tach out (required, maintenance only, not billed)");
    expect(html).toContain("Hobbs out (required, billed)");
  });

  it("check-out needs both readings, one decimal, and the confirm box", async () => {
    const s = await setup();
    const cases: Array<[Record<string, string>, string]> = [
      [{ hobbs_out: "", tach_out: "467.4", meters_confirmed: "yes" }, "Enter both Hobbs out and tach out"],
      [{ hobbs_out: "318.6", tach_out: "", meters_confirmed: "yes" }, "Enter both Hobbs out and tach out"],
      [{ hobbs_out: "318.65", tach_out: "467.4", meters_confirmed: "yes" }, "at most one decimal"],
      [{ hobbs_out: "abc", tach_out: "467.4", meters_confirmed: "yes" }, "at most one decimal"],
      [{ hobbs_out: "318.6", tach_out: "467.4" }, "Confirm that you read Hobbs and tach"],
    ];
    for (const [fields, message] of cases) {
      const response = await post(`/reservations/${s.reservation}/checkout`, fields, s.cookie);
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(message);
      expect(await status(s.reservation)).toBe("scheduled");
    }
  });

  it("warns, but does not block, when check-out meters are lower than recorded or jump more than 10 hours", async () => {
    const s = await setup();
    const out = await post(`/reservations/${s.reservation}/checkout`, { hobbs_out: "318.0", tach_out: "480.0", meters_confirmed: "yes" }, s.cookie);
    expect(out.status).toBe(303);
    expect(await status(s.reservation)).toBe("checked_out");
    const html = await (await get(`/reservations/${s.reservation}`, s.cookie)).text();
    expect(html).toContain("Hobbs out 318.0 is lower than the airplane&#39;s last recorded hobbs 318.6");
    expect(html).toContain("Tach out 480.0 is 12.6 hours above the last recorded 467.4");
  });

  it("check-in needs both readings, validates them, updates the airplane, and bills Hobbs only", async () => {
    const s = await setup();
    await post(`/reservations/${s.reservation}/checkout`, { hobbs_out: "318.6", tach_out: "467.4", meters_confirmed: "yes" }, s.cookie);
    const form = await (await get(`/reservations/${s.reservation}`, s.cookie)).text();
    expect(form).toMatch(/name="hobbs_in"[^>]*required/);
    expect(form).toMatch(/name="tach_in"[^>]*required/);
    expect(form).toContain("Tach in (required, maintenance only, not billed)");
    const bad: Array<[Record<string, string>, string]> = [
      [{ hobbs_in: "320.0", tach_in: "" }, "Enter both Hobbs in and tach in"],
      [{ hobbs_in: "", tach_in: "468.5" }, "Enter both Hobbs in and tach in"],
      [{ hobbs_in: "320.05", tach_in: "468.5" }, "at most one decimal"],
      [{ hobbs_in: "318.6", tach_in: "468.5" }, "Hobbs in must be greater than Hobbs out."],
      [{ hobbs_in: "320.0", tach_in: "467.0" }, "Tach in cannot be less than tach out."],
    ];
    for (const [fields, message] of bad) {
      const response = await post(`/reservations/${s.reservation}/checkin`, fields, s.cookie);
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(message);
      expect(await status(s.reservation)).toBe("checked_out");
    }
    const done = await post(`/reservations/${s.reservation}/checkin`, { hobbs_in: "320.0", tach_in: "468.5" }, s.cookie);
    expect(done.status).toBe(303);
    expect(await meters(s.plane)).toEqual({ hobbs: 320, tach: 468.5 });
    const log = await db().prepare("SELECT flight_hours, total_cost_cents, tach_in FROM flight_logs WHERE reservation_id = ?").bind(s.reservation).first<{ flight_hours: number; total_cost_cents: number; tach_in: number }>();
    // 1.4 Hobbs hours × $155 = $217.00. Tach moved 1.1 and does not change the bill.
    expect(log).toEqual({ flight_hours: 1.4, total_cost_cents: 21700, tach_in: 468.5 });
    const page = await (await get(done.headers.get("location") ?? "/", s.cookie)).text();
    expect(page).toContain("Tach (maintenance, not billed)");
  });

  it("warns on a check-in jump over 10 hours without blocking it", async () => {
    const s = await setup();
    await post(`/reservations/${s.reservation}/checkout`, { hobbs_out: "318.6", tach_out: "467.4", meters_confirmed: "yes" }, s.cookie);
    const done = await post(`/reservations/${s.reservation}/checkin`, { hobbs_in: "330.6", tach_in: "468.4" }, s.cookie);
    expect(done.status).toBe(303);
    const page = await (await get(done.headers.get("location") ?? "/", s.cookie)).text();
    expect(page).toContain("Hobbs went up 12.0 hours on this flight (318.6 → 330.6)");
  });

  it("tach never changes the charge", () => {
    const base = { hobbsOut: 318.6, hobbsIn: 320.0, rateBasis: "wet" as const, wetCents: 15500, dryCents: null, instructorRateCents: 7500 };
    const a = computeFlightCost({ ...base, tachOut: 467.4, tachIn: 467.5 });
    const b = computeFlightCost({ ...base, tachOut: 467.4, tachIn: 475.0 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.totalCostCents).toBe(b.value.totalCostCents);
      expect(a.value.aircraftCostCents).toBe(21700);
      expect(a.value.instructorCostCents).toBe(10500);
    }
  });
});

describe("TBX update page (manual hand-off)", () => {
  it("is admin-only", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const plane = await makePlane();
    for (const role of ["instructor", "renter", "student"] as const) {
      const person = await makeUser({ email: `${role}@example.com`, name: role, role });
      const cookie = await login(person.email);
      expect((await get(`/aircraft/${plane}/tbx`, cookie)).status).toBe(403);
      expect((await get(`/aircraft/${plane}/tbx.csv`, cookie)).status).toBe(403);
      expect((await post(`/aircraft/${plane}/tbx`, { hobbs: "318.6", tach: "467.4", entered: "yes" }, cookie)).status).toBe(403);
    }
  });

  it("shows current meters with copy buttons, lists flights since the last entry, exports CSV, and records entries", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    await replaceInsurancePdf(db(), { userId: admin.id, fileName: "sample-insurance.pdf", bytes: samplePdf(), uploadedBy: admin.id });
    const plane = await makePlane();
    const cookie = await login(admin.email);
    const reservation = await makeReservation(admin.id, plane);
    await post(`/reservations/${reservation}/checkout`, { hobbs_out: "318.6", tach_out: "467.4", meters_confirmed: "yes" }, cookie);
    await post(`/reservations/${reservation}/checkin`, { hobbs_in: "320.0", tach_in: "468.5" }, cookie);

    const page = await (await get(`/aircraft/${plane}/tbx`, cookie)).text();
    expect(page).toContain("Nothing has been marked as entered in TBX yet.");
    expect(page).toContain('<strong id="tbx-tach">468.5</strong>');
    expect(page).toContain('<strong id="tbx-hobbs">320.0</strong>');
    expect(page).toContain('data-copy="N1561Y Tach 468.5 Hobbs 320.0"');
    expect(page).toContain("467.4 → 468.5");
    expect(page).toContain('href="https://www.airworthy.com/"');
    expect((await get(`/aircraft/${plane}`, cookie).then((r) => r.text()))).toContain(`href="/aircraft/${plane}/tbx"`);

    const csv = await get(`/aircraft/${plane}/tbx.csv`, cookie);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe('"date_utc","tail_number","pilot","tach_out","tach_in","tach_hours","hobbs_out","hobbs_in","hobbs_hours"');
    expect(lines[1]).toContain('"N1561Y","Kyle Bushman","467.4","468.5","1.1","318.6","320.0","1.4"');

    expect((await post(`/aircraft/${plane}/tbx`, { hobbs: "320.0", tach: "468.5" }, cookie)).status).toBe(422);
    expect((await post(`/aircraft/${plane}/tbx`, { hobbs: "318.6", tach: "467.4", entered: "yes" }, cookie)).status).toBe(409);
    const marked = await post(`/aircraft/${plane}/tbx`, { hobbs: "320.0", tach: "468.5", entered: "yes" }, cookie);
    expect(marked.status).toBe(303);
    const after = await (await get(`/aircraft/${plane}/tbx`, cookie)).text();
    expect(after).toContain("TBX is up to date.");
    expect(after).toContain("No flights since the last TBX entry.");
    expect(after).not.toContain('name="entered"');
    const empty = (await (await get(`/aircraft/${plane}/tbx.csv`, cookie)).text()).trim().split("\r\n");
    expect(empty).toHaveLength(1);
    const all = (await (await get(`/aircraft/${plane}/tbx.csv?all=1`, cookie)).text()).trim().split("\r\n");
    expect(all).toHaveLength(2);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM tbx_entries").first("n")).toBe(1);
  });
});
