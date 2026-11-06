import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { giveSignedAgreement } from "./agreement_fixture";
import { hashPassword, newToken } from "../src/auth";
import { replaceInsurancePdf } from "../src/documents";
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
    DELETE FROM user_document_chunks;
    DELETE FROM user_documents;
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

function pdfBytes(marker: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% sample ${marker}\ntrailer<<>>\n%%EOF\n`);
}

async function uploadPdf(cookie: string, path: string, bytes: Uint8Array | null, name = "sample-insurance.pdf"): Promise<Response> {
  const form = new FormData();
  if (bytes) form.set("file", new File([bytes], name, { type: "application/pdf" }));
  return SELF.fetch(`${BASE}${path}`, { method: "POST", headers: { cookie, origin: BASE }, body: form, redirect: "manual" });
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

async function makeReservation(pilotId: string, aircraftId: string, instructorId: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'wet', NULL, ?, ?, ?)`,
    )
    .bind(
      id,
      aircraftId,
      pilotId,
      instructorId,
      new Date(Date.now() + 3_600_000).toISOString(),
      new Date(Date.now() + 7_200_000).toISOString(),
      pilotId,
      now,
      now,
    )
    .run();
  return id;
}

const METERS = { hobbs_out: "100.0", tach_out: "80.0", meters_confirmed: "yes" };

beforeEach(async () => {
  await reset();
});

describe("Insurance PDF", () => {
  it("shows an empty insurance section on every profile and does not invent a file", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const student = await makeUser({ email: "sam@example.com", name: "Sam Student", role: "student" });
    const instructor = await makeUser({ email: "ivy@example.com", name: "Ivy Instructor", role: "instructor" });
    expect(await db().prepare("SELECT COUNT(*) AS n FROM user_documents").first("n")).toBe(0);

    for (const person of [admin, renter, student, instructor]) {
      const html = await (await get("/account", await login(person.email))).text();
      expect(html).toContain('id="insurance"');
      expect(html).toContain("No insurance PDF uploaded yet");
      expect(html).not.toMatch(/compliant/i);
      expect(html).not.toContain("/insurance/view");
    }

    const people = await (await get("/pilots", await login(admin.email))).text();
    expect(people).toContain(">Insurance<");
    expect(people).toContain("Rita Renter");
    expect(people).toContain("Sam Student");
    expect(people).toContain("No PDF");
    expect(people).not.toContain("On file");
  });

  it("lets the person and an admin upload, view, download, and replace, and keeps the PDF private", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const other = await makeUser({ email: "other@example.com", name: "Owen Other", role: "renter" });
    const instructor = await makeUser({ email: "ivy@example.com", name: "Ivy Instructor", role: "instructor" });
    const renterCookie = await login(renter.email);
    const adminCookie = await login(admin.email);
    const otherCookie = await login(other.email);
    const instructorCookie = await login(instructor.email);

    const rejected = await uploadPdf(renterCookie, "/account/insurance", new TextEncoder().encode("not a pdf"), "notes.txt");
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toContain("That file is not a PDF.");
    expect(await db().prepare("SELECT COUNT(*) AS n FROM user_documents").first("n")).toBe(0);

    const empty = await uploadPdf(renterCookie, "/account/insurance", null);
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain("Choose a PDF file");

    const saved = await uploadPdf(renterCookie, "/account/insurance", pdfBytes("first"), "rita policy.pdf");
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/account?notice=insurance-saved#insurance");
    const account = await (await get("/account", renterCookie)).text();
    expect(account).toContain("Insurance PDF on file");
    expect(account).toContain("rita-policy.pdf");
    expect(account).toContain('href="/account/insurance/view"');
    expect(account).not.toMatch(/compliant/i);

    const view = await get("/account/insurance/view", renterCookie);
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toContain("application/pdf");
    expect(view.headers.get("cache-control")).toContain("private");
    const viewed = new Uint8Array(await view.arrayBuffer());
    expect(viewed[0]).toBe(0x25);
    expect(new TextDecoder().decode(viewed)).toContain("sample first");

    const download = await get("/account/insurance/download", renterCookie);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("content-disposition")).toContain("rita-policy.pdf");

    expect((await get(`/pilots/${renter.id}/insurance/view`, otherCookie)).status).toBe(403);
    expect((await get(`/pilots/${renter.id}/insurance/download`, instructorCookie)).status).toBe(403);
    expect((await get(`/pilots/${renter.id}/insurance/view`)).status).toBe(302);
    const instructorPage = await (await get(`/pilots/${renter.id}`, instructorCookie)).text();
    expect(instructorPage).toContain("Insurance PDF on file");
    expect(instructorPage).toContain("private to this person and admins");
    expect(instructorPage).not.toContain("/insurance/view");
    expect((await uploadPdf(instructorCookie, `/pilots/${renter.id}/insurance`, pdfBytes("nope"))).status).toBe(403);

    const adminView = await get(`/pilots/${renter.id}/insurance/view`, adminCookie);
    expect(adminView.status).toBe(200);
    expect(new TextDecoder().decode(await adminView.arrayBuffer())).toContain("sample first");

    const replaced = await uploadPdf(adminCookie, `/pilots/${renter.id}/insurance`, pdfBytes("replaced"), "replacement.pdf");
    expect(replaced.status).toBe(303);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM user_documents").first("n")).toBe(1);
    const again = new TextDecoder().decode(await (await get("/account/insurance/download", renterCookie)).arrayBuffer());
    expect(again).toContain("sample replaced");
    expect(again).not.toContain("sample first");

    const resources = await (await get("/resources", renterCookie)).text();
    expect(resources).not.toContain("rita-policy.pdf");
    expect(resources).not.toContain("replacement.pdf");
    const people = await (await get("/pilots", adminCookie)).text();
    expect(people).toContain("Date not confirmed");
    expect(people).toContain("No PDF");
  });

  it("blocks solo check-out without a PDF, allows it after upload, and skips the requirement on a dual flight", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const student = await makeUser({ email: "sam@example.com", name: "Sam Student", role: "student" });
    const instructor = await makeUser({ email: "ivy@example.com", name: "Ivy Instructor", role: "instructor" });
    await giveSignedAgreement(db(), renter);
    await giveSignedAgreement(db(), student);
    const plane = await makePlane();
    const solo = await makeReservation(renter.id, plane, null);
    const again = await makeReservation(renter.id, plane, null);
    const dual = await makeReservation(student.id, plane, instructor.id);
    const renterCookie = await login(renter.email);
    const adminCookie = await login("kyle@example.com");
    const studentCookie = await login(student.email);

    const blockedPage = await get(`/reservations/${solo}`, renterCookie);
    expect(blockedPage.status).toBe(200);
    const blockedHtml = await blockedPage.text();
    expect(blockedHtml).toContain('id="solo-insurance"');
    expect(blockedHtml).toContain("Rita Renter");
    expect(blockedHtml).toContain("insurance PDF on file");
    expect(blockedHtml).toContain('href="/account#insurance"');
    expect(blockedHtml).toContain("Upload insurance PDF");
    expect(blockedHtml).not.toContain('name="hobbs_out"');

    const bypass = await post(`/reservations/${solo}/checkout`, METERS, renterCookie);
    expect(bypass.status).toBe(422);
    expect(await bypass.text()).toContain("insurance PDF on file");
    expect(await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(solo).first("status")).toBe("scheduled");

    const adminBypass = await post(`/reservations/${solo}/checkout`, METERS, adminCookie);
    expect(adminBypass.status).toBe(422);
    expect(await adminBypass.text()).toContain(`href="/pilots/${renter.id}#insurance"`);
    expect(await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(solo).first("status")).toBe("scheduled");

    const dualPage = await (await get(`/reservations/${dual}`, studentCookie)).text();
    expect(dualPage).not.toContain('id="solo-insurance"');
    expect(dualPage).not.toContain("Insurance PDF");
    expect(dualPage).toContain('name="hobbs_out"');
    const dualOut = await post(`/reservations/${dual}/checkout`, METERS, studentCookie);
    expect(dualOut.status).toBe(303);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM user_documents").first("n")).toBe(0);

    const uploaded = await uploadPdf(renterCookie, "/account/insurance", pdfBytes("rita"));
    expect(uploaded.status).toBe(303);
    const open = await (await get(`/reservations/${solo}`, renterCookie)).text();
    expect(open).toContain("Insurance PDF is on file.");
    expect(open).toContain('name="hobbs_out"');
    expect(open).not.toContain('id="solo-insurance"');
    const out = await post(`/reservations/${solo}/checkout`, METERS, renterCookie);
    expect(out.status).toBe(303);

    const reused = await post(`/reservations/${again}/checkout`, METERS, renterCookie);
    expect(reused.status).toBe(303);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM user_documents").first("n")).toBe(1);
    expect(await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(again).first("status")).toBe("checked_out");
  });
});

describe("Oil added", () => {
  async function historicLog(pilotId: string, aircraftId: string, cents: number): Promise<{ logId: string; reservationId: string }> {
    const reservationId = crypto.randomUUID();
    const logId = crypto.randomUUID();
    const now = "2026-09-12T15:00:00.000Z";
    const end = "2026-09-12T17:00:00.000Z";
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis,
           hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'checked_in', 'wet', 302.1, 450.4, 303.0, 451.0, 'paper', ?, ?, ?)`,
      )
      .bind(reservationId, aircraftId, pilotId, now, end, pilotId, now, now)
      .run();
    await db()
      .prepare(
        `INSERT INTO flight_logs (
           id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
           aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents,
           total_cost_cents, rate_basis, created_at, ground_hours, aircraft_paid, instructor_paid, maintenance_flight,
           fuel_added_gal, oil_added_qt, rental_type, imported, instructor_name, billing_status, billing_note, paid, paid_at, paid_by
         ) VALUES (?, ?, ?, NULL, ?, 302.1, 303.0, 450.4, 451.0, 0.9, 0, 0, 0, 0, 0, ?, 'wet', ?, NULL, 1, 0, 0, 12.0, NULL, 'Rental', 1, NULL, 'external', 'Historical import, billed outside app', 0, NULL, NULL)`,
      )
      .bind(logId, reservationId, pilotId, aircraftId, cents, now)
      .run();
    return { logId, reservationId };
  }

  async function snapshot(id: string) {
    return db()
      .prepare(
        `SELECT hobbs_out, hobbs_in, tach_out, tach_in, flight_hours, aircraft_cost_cents, instructor_cost_cents, total_cost_cents,
                fuel_added_gal, oil_added_qt, billing_status, billing_note, paid, paid_at, paid_by, imported
         FROM flight_logs WHERE id = ?`,
      )
      .bind(id)
      .first<{
        hobbs_out: number;
        hobbs_in: number;
        tach_out: number;
        tach_in: number;
        flight_hours: number;
        aircraft_cost_cents: number;
        instructor_cost_cents: number;
        total_cost_cents: number;
        fuel_added_gal: number;
        oil_added_qt: number | null;
        billing_status: string;
        billing_note: string;
        paid: number;
        paid_at: string | null;
        paid_by: string | null;
        imported: number;
      }>();
  }

  it("lets an admin record oil on a past $0 import without changing meters, cost, or payment", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const instructor = await makeUser({ email: "ivy@example.com", name: "Ivy Instructor", role: "instructor" });
    const plane = await makePlane();
    const historic = await historicLog(renter.id, plane, 0);
    const untouched = await historicLog(renter.id, plane, 0);
    const before = await snapshot(historic.logId);
    expect(before?.oil_added_qt).toBeNull();
    expect(before?.total_cost_cents).toBe(0);
    expect(before?.billing_status).toBe("external");

    const adminCookie = await login(admin.email);
    const detail = await (await get(`/logs/${historic.logId}`, adminCookie)).text();
    expect(detail).toContain("Not recorded");
    expect(detail).toContain('action="/logs/' + historic.logId + '/oil"');
    expect(detail).toContain("$0.00");
    expect(await (await get(`/logs/${historic.logId}`, await login(renter.email))).text()).not.toContain('action="/logs/' + historic.logId + '/oil"');

    expect((await post(`/logs/${historic.logId}/oil`, { oil_added_qt: "nope", paid: "1", hobbs_in: "999" }, await login(instructor.email))).status).toBe(403);
    expect((await post(`/logs/${historic.logId}/oil`, { oil_added_qt: "1" }, await login(renter.email))).status).toBe(403);
    expect((await snapshot(historic.logId))?.oil_added_qt).toBeNull();

    const invalid = await post(`/logs/${historic.logId}/oil`, { oil_added_qt: "-1", paid: "1" }, adminCookie);
    expect(invalid.status).toBe(422);
    expect(await invalid.text()).toContain("Enter oil in quarts");
    expect(await snapshot(historic.logId)).toEqual(before);

    const saved = await post(`/logs/${historic.logId}/oil`, { oil_added_qt: "1.50", paid: "1", hobbs_in: "999" }, adminCookie);
    expect(saved.status).toBe(303);
    const after = await snapshot(historic.logId);
    expect(after?.oil_added_qt).toBeCloseTo(1.5);
    expect(after?.hobbs_out).toBeCloseTo(302.1);
    expect(after?.hobbs_in).toBeCloseTo(303);
    expect(after?.tach_out).toBeCloseTo(450.4);
    expect(after?.tach_in).toBeCloseTo(451);
    expect(after?.aircraft_cost_cents).toBe(0);
    expect(after?.instructor_cost_cents).toBe(0);
    expect(after?.total_cost_cents).toBe(0);
    expect(after?.fuel_added_gal).toBeCloseTo(12);
    expect(after?.billing_status).toBe("external");
    expect(after?.billing_note).toBe("Historical import, billed outside app");
    expect(after?.paid).toBe(0);
    expect(after?.paid_at).toBeNull();
    expect(after?.paid_by).toBeNull();
    expect(after?.imported).toBe(1);
    expect((await snapshot(untouched.logId))?.oil_added_qt).toBeNull();

    const shown = await (await get(saved.headers.get("location") ?? `/logs/${historic.logId}`, adminCookie)).text();
    expect(shown).toContain("1.5 qt");
    expect(shown).toContain("Oil added updated");

    const cleared = await post(`/logs/${historic.logId}/oil`, { oil_added_qt: "   " }, adminCookie);
    expect(cleared.status).toBe(303);
    expect((await snapshot(historic.logId))?.oil_added_qt).toBeNull();
    const zero = await post(`/logs/${historic.logId}/oil`, { oil_added_qt: "0" }, adminCookie);
    expect(zero.status).toBe(303);
    expect((await snapshot(historic.logId))?.oil_added_qt).toBe(0);
    const zeroPage = await (await get("/logs", adminCookie)).text();
    expect(zeroPage).toContain("0 qt");
    expect(zeroPage).toContain("Not recorded");
    expect(zeroPage).toContain("not counted as zero");
  });

  it("records oil on a new check-in and leaves it null when the box is blank", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    await replaceInsurancePdf(db(), { userId: admin.id, fileName: "sample-insurance.pdf", bytes: pdfBytes("admin"), uploadedBy: admin.id });
    await giveSignedAgreement(db(), admin);
    const plane = await makePlane();
    const withOil = await makeReservation(admin.id, plane);
    const withoutOil = await makeReservation(admin.id, plane);
    const cookie = await login(admin.email);
    await post(`/reservations/${withOil}/checkout`, METERS, cookie);
    const bad = await post(`/reservations/${withOil}/checkin`, { hobbs_in: "101.4", tach_in: "81.0", oil_added_qt: "1.234" }, cookie);
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain("Enter oil in quarts");
    expect(await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(withOil).first("status")).toBe("checked_out");

    const done = await post(`/reservations/${withOil}/checkin`, { hobbs_in: "101.4", tach_in: "81.0", oil_added_qt: "0.5" }, cookie);
    expect(done.status).toBe(303);
    const row = await db()
      .prepare("SELECT oil_added_qt, total_cost_cents, hobbs_in, tach_in FROM flight_logs WHERE reservation_id = ?")
      .bind(withOil)
      .first<{ oil_added_qt: number; total_cost_cents: number; hobbs_in: number; tach_in: number }>();
    expect(row?.oil_added_qt).toBeCloseTo(0.5);
    expect(row?.total_cost_cents).toBe(21700);
    expect(row?.hobbs_in).toBeCloseTo(101.4);
    expect(row?.tach_in).toBeCloseTo(81);

    await post(`/reservations/${withoutOil}/checkout`, METERS, cookie);
    const plain = await post(`/reservations/${withoutOil}/checkin`, { hobbs_in: "102.0", tach_in: "81.4" }, cookie);
    expect(plain.status).toBe(303);
    const blank = await db().prepare("SELECT oil_added_qt FROM flight_logs WHERE reservation_id = ?").bind(withoutOil).first<{ oil_added_qt: number | null }>();
    expect(blank?.oil_added_qt).toBeNull();

    const list = await (await get("/logs", cookie)).text();
    expect(list).toContain("0.5 qt");
    expect(list).toContain("Not recorded");
    expect(list).toContain("not counted as zero");
  });
});
