import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AGREEMENT_PDF_SHA256, AGREEMENT_TEXT, AGREEMENT_TEXT_SHA256, AGREEMENT_VERSION } from "../src/agreements/canonical";
import { canonicalAgreementPdf } from "../src/agreement";
import { signedAgreementDocument } from "../src/agreement_pdf";

const PREVIOUS_VERSION = "fire-hound-rental-agreement-2026-11-06";
const PREVIOUS_TEXT_SHA256 = "21089c85f56c1e541b6fd779e7a49f87bcbc9d1f1f676f0fdf329fc242284455";
import { hashPassword, newToken } from "../src/auth";
import { insertUser, removePerson } from "../src/db";
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
    DELETE FROM agreement_signatures;
    DELETE FROM user_document_chunks;
    DELETE FROM user_documents;
    DELETE FROM invites;
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

async function makeUser(partial: Partial<User> & Pick<User, "email" | "name" | "role">): Promise<User> {
  const user: User = {
    id: partial.id ?? crypto.randomUUID(),
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

async function makeReservation(pilotId: string, aircraftId: string, instructorId: string | null): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db()
    .prepare(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'wet', NULL, ?, ?, ?)`,
    )
    .bind(id, aircraftId, pilotId, instructorId, new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 7_200_000).toISOString(), pilotId, now, now)
    .run();
  return id;
}

const SIGN = {
  legal_name: "Rita Jane Renter",
  age: "adult",
  read_ack: "yes",
  esign_consent: "yes",
};
const METERS = { hobbs_out: "100.0", tach_out: "80.0", meters_confirmed: "yes" };

beforeEach(async () => {
  await reset();
});

describe("rental agreement signing", () => {
  it("uses the canonical text and unsigned PDF, and does not mark anyone signed", async () => {
    const bytes = new TextEncoder().encode(AGREEMENT_TEXT);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(AGREEMENT_TEXT_SHA256);
    expect(AGREEMENT_TEXT).toContain("Fire Hound Rental");
    expect(AGREEMENT_TEXT).toContain("cash or check only");
    expect(AGREEMENT_TEXT).toContain("less than twenty-four (24) hours");
    expect(AGREEMENT_TEXT).toContain("$50 cancellation fee");
    expect(AGREEMENT_TEXT).toContain("Cancellations due to weather are exempt");
    expect(AGREEMENT_TEXT).toContain("$75,000.00");
    expect(AGREEMENT_TEXT).not.toContain("$60,000.00");
    expect(AGREEMENT_VERSION).toBe("fire-hound-rental-agreement-2026-11-06-75000");
    expect(AGREEMENT_TEXT_SHA256).not.toBe(PREVIOUS_TEXT_SHA256);
    expect(AGREEMENT_TEXT).toContain("medical certificate");
    const pdf = canonicalAgreementPdf();
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const pdfDigest = await crypto.subtle.digest("SHA-256", pdf);
    const pdfHex = [...new Uint8Array(pdfDigest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(pdfHex).toBe(AGREEMENT_PDF_SHA256);

    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const cookie = await login(renter.email);
    const account = await (await get("/account", cookie)).text();
    expect(account).toContain("Not signed");
    expect(account).not.toContain("Rita Jane Renter");
    const resources = await (await get("/resources", cookie)).text();
    expect(resources).toContain("View and sign");
    expect(resources).toContain("Not signed");
    const file = await get("/agreement/file", cookie);
    expect(file.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);
    expect((await get("/agreement/file")).status).toBe(302);
  });

  it("blocks solo and dual check-out until the renter signs, and keeps the signature immutable", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const student = await makeUser({ email: "sam@example.com", name: "Sam Student", role: "student" });
    const instructor = await makeUser({ email: "ivy@example.com", name: "Ivy Instructor", role: "instructor" });
    const other = await makeUser({ email: "owen@example.com", name: "Owen Other", role: "renter" });
    const plane = await makePlane();
    const solo = await makeReservation(renter.id, plane, null);
    const dual = await makeReservation(student.id, plane, instructor.id);
    const renterCookie = await login(renter.email);
    const adminCookie = await login(admin.email);
    const studentCookie = await login(student.email);

    for (const [id, cookie] of [[solo, renterCookie], [dual, studentCookie]] as const) {
      const page = await (await get(`/reservations/${id}`, cookie)).text();
      expect(page).toContain('id="agreement-required"');
      expect(page).not.toContain('name="hobbs_out"');
      const blocked = await post(`/reservations/${id}/checkout`, METERS, cookie);
      expect(blocked.status).toBe(422);
      expect(await blocked.text()).toContain("has not signed");
      expect(await db().prepare("SELECT status FROM reservations WHERE id = ?").bind(id).first("status")).toBe("scheduled");
    }
    expect((await db().prepare("SELECT COUNT(*) AS n FROM agreement_signatures").first("n"))).toBe(0);

    const adminSignsSelf = await post("/agreement/sign", { ...SIGN, legal_name: "Kyle Bushman Admin" }, adminCookie);
    expect(adminSignsSelf.status).toBe(303);
    const onlyAdmin = await db().prepare("SELECT user_id FROM agreement_signatures").all<{ user_id: string }>();
    expect(onlyAdmin.results.map((row) => row.user_id)).toEqual([admin.id]);

    const missingConsent = await post("/agreement/sign", { legal_name: "Rita Jane Renter", age: "adult" }, renterCookie);
    expect(missingConsent.status).toBe(422);
    const signed = await post("/agreement/sign", SIGN, renterCookie);
    expect(signed.status).toBe(303);
    const first = await db()
      .prepare("SELECT legal_name, renter_signed_at, terms_text, terms_sha256, status FROM agreement_signatures WHERE user_id = ?")
      .bind(renter.id)
      .first<{ legal_name: string; renter_signed_at: string; terms_text: string; terms_sha256: string; status: string }>();
    expect(first?.legal_name).toBe("Rita Jane Renter");
    expect(first?.status).toBe("complete");
    expect(first?.terms_text).toBe(AGREEMENT_TEXT);
    expect(first?.terms_sha256).toBe(AGREEMENT_TEXT_SHA256);
    const again = await post("/agreement/sign", { ...SIGN, legal_name: "Someone Else Entirely" }, renterCookie);
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toContain("agreement-already-signed");
    const still = await db().prepare("SELECT legal_name, renter_signed_at FROM agreement_signatures WHERE user_id = ?").bind(renter.id).first<{ legal_name: string; renter_signed_at: string }>();
    expect(still).toEqual({ legal_name: first?.legal_name, renter_signed_at: first?.renter_signed_at });

    await db()
      .prepare(
        `INSERT INTO agreement_signatures (
           id, user_id, version_id, terms_sha256, terms_text, account_name, account_email, legal_name,
           age_statement, renter_signed_at, status, guardian_legal_name, guardian_signed_at, created_at
         ) VALUES (?, ?, 'old-version', 'abc', 'old terms', ?, ?, 'Old Name', 'adult', ?, 'complete', NULL, NULL, ?)`,
      )
      .bind(crypto.randomUUID(), renter.id, renter.name, renter.email, "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z")
      .run();
    expect(await db().prepare("SELECT COUNT(*) AS n FROM agreement_signatures WHERE user_id = ?").bind(renter.id).first("n")).toBe(2);

    const soloOpen = await (await get(`/reservations/${solo}`, renterCookie)).text();
    expect(soloOpen).not.toContain('id="agreement-required"');
    expect(soloOpen).toContain('id="solo-insurance"');
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\n% sample\ntrailer<<>>\n%%EOF\n");
    const form = new FormData();
    form.set("file", new File([pdfBytes], "sample-insurance.pdf", { type: "application/pdf" }));
    expect((await SELF.fetch(`${BASE}/account/insurance`, { method: "POST", headers: { cookie: renterCookie, origin: BASE }, body: form, redirect: "manual" })).status).toBe(303);
    expect((await post(`/reservations/${solo}/checkout`, METERS, renterCookie)).status).toBe(303);

    const studentSigned = await post("/agreement/sign", { ...SIGN, legal_name: "Sam Student Pilot", age: "adult" }, studentCookie);
    expect(studentSigned.status).toBe(303);
    const dualPage = await (await get(`/reservations/${dual}`, studentCookie)).text();
    expect(dualPage).not.toContain('id="agreement-required"');
    expect(dualPage).toContain('name="hobbs_out"');
    expect((await post(`/reservations/${dual}/checkout`, METERS, studentCookie)).status).toBe(303);

    const stored = await db().prepare("SELECT * FROM agreement_signatures WHERE user_id = ? AND version_id = ?").bind(renter.id, AGREEMENT_VERSION).first<{
      legal_name: string; account_name: string; account_email: string | null; user_id: string; age_statement: "adult" | "minor"; renter_signed_at: string; status: "complete"; guardian_legal_name: string | null; guardian_signed_at: string | null; terms_text: string; terms_sha256: string; version_id: string; id: string;
    }>();
    expect(stored?.terms_text).toBe(AGREEMENT_TEXT);
    const documentText = signedAgreementDocument({
      id: stored!.id,
      userId: stored!.user_id,
      versionId: stored!.version_id,
      termsSha256: stored!.terms_sha256,
      termsText: stored!.terms_text,
      accountName: stored!.account_name,
      accountEmail: stored!.account_email,
      legalName: stored!.legal_name,
      ageStatement: stored!.age_statement,
      renterSignedAt: stored!.renter_signed_at,
      status: stored!.status,
      guardianLegalName: stored!.guardian_legal_name,
      guardianSignedAt: stored!.guardian_signed_at,
    });
    for (const phrase of ["Fire Hound Rental", "cash or check only", "less than twenty-four (24) hours", "$50 cancellation fee", "Cancellations due to weather are exempt", "$75,000.00", "medical certificate", "Rita Jane Renter", AGREEMENT_TEXT_SHA256, "not a SignWell signature", "*If renter is a minor a parent or legal guardian must also sign."]) {
      expect(documentText).toContain(phrase);
    }
    expect(documentText).not.toContain("$60,000.00");
    expect(documentText).not.toContain("_______________________________");
    const signedPdf = await get("/agreement/signed", renterCookie);
    expect(signedPdf.status).toBe(200);
    expect(signedPdf.headers.get("cache-control")).toContain("no-store");
    const signedBytes = new TextDecoder().decode(await signedPdf.arrayBuffer());
    expect(signedBytes.startsWith("%PDF-")).toBe(true);
    expect(signedBytes).toContain("Rita Jane Renter");
    expect(signedBytes).toContain(AGREEMENT_TEXT_SHA256);
    expect(signedBytes).toContain("SignWell");
    expect((await get(`/pilots/${renter.id}/agreement/signed`, await login(other.email))).status).toBe(403);
    expect((await get(`/pilots/${renter.id}/agreement/signed`, await login(instructor.email))).status).toBe(403);
    expect((await get(`/pilots/${renter.id}/agreement/signed`, adminCookie)).status).toBe(200);
    const people = await (await get("/pilots", adminCookie)).text();
    expect(people).toContain("Signed");
    expect(people).toContain("Not signed");

    const reservationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'checked_in', 'wet', NULL, ?, ?, ?)`,
      )
      .bind(reservationId, plane, renter.id, now, new Date(Date.now() + 1000).toISOString(), renter.id, now, now)
      .run();
    expect(await removePerson(db(), renter.id, now)).toBe("soft");
    expect(await db().prepare("SELECT legal_name FROM agreement_signatures WHERE user_id = ? AND version_id = ?").bind(renter.id, AGREEMENT_VERSION).first("legal_name")).toBe("Rita Jane Renter");
  });

  it("keeps a $60,000 signature on the old version and requires a new signature for $75,000", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "rita@example.com", name: "Rita Renter", role: "renter" });
    const oldTerms = AGREEMENT_TEXT.replace("$75,000.00", "$60,000.00");
    const oldHashBytes = new TextEncoder().encode(oldTerms);
    const oldDigest = await crypto.subtle.digest("SHA-256", oldHashBytes);
    const oldHash = [...new Uint8Array(oldDigest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(oldHash).toBe(PREVIOUS_TEXT_SHA256);
    const signedAt = "2026-11-06T18:00:00.000Z";
    await db()
      .prepare(
        `INSERT INTO agreement_signatures (
           id, user_id, version_id, terms_sha256, terms_text, account_name, account_email, legal_name,
           age_statement, renter_signed_at, status, guardian_legal_name, guardian_signed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Rita Jane Renter', 'adult', ?, 'complete', NULL, NULL, ?)`,
      )
      .bind(crypto.randomUUID(), renter.id, PREVIOUS_VERSION, PREVIOUS_TEXT_SHA256, oldTerms, renter.name, renter.email, signedAt, signedAt)
      .run();
    const plane = await makePlane();
    const solo = await makeReservation(renter.id, plane, null);
    const cookie = await login(renter.email);
    const blocked = await post(`/reservations/${solo}/checkout`, METERS, cookie);
    expect(blocked.status).toBe(422);
    expect(await blocked.text()).toContain("has not signed");
    const signed = await post("/agreement/sign", SIGN, cookie);
    expect(signed.status).toBe(303);
    const rows = await db()
      .prepare("SELECT version_id, terms_sha256, terms_text, legal_name, renter_signed_at FROM agreement_signatures WHERE user_id = ? ORDER BY version_id")
      .bind(renter.id)
      .all<{ version_id: string; terms_sha256: string; terms_text: string; legal_name: string; renter_signed_at: string }>();
    const previous = rows.results.find((row) => row.version_id === PREVIOUS_VERSION);
    const current = rows.results.find((row) => row.version_id === AGREEMENT_VERSION);
    expect(previous?.terms_text).toContain("$60,000.00");
    expect(previous?.terms_text).not.toContain("$75,000.00");
    expect(previous?.terms_sha256).toBe(PREVIOUS_TEXT_SHA256);
    expect(previous?.renter_signed_at).toBe(signedAt);
    expect(current?.terms_text).toContain("$75,000.00");
    expect(current?.terms_text).not.toContain("$60,000.00");
    expect(current?.terms_sha256).toBe(AGREEMENT_TEXT_SHA256);
    expect(current?.terms_sha256).not.toBe(previous?.terms_sha256);
    const oldCopy = signedAgreementDocument({
      id: "old",
      userId: renter.id,
      versionId: PREVIOUS_VERSION,
      termsSha256: PREVIOUS_TEXT_SHA256,
      termsText: oldTerms,
      accountName: renter.name,
      accountEmail: renter.email,
      legalName: "Rita Jane Renter",
      ageStatement: "adult",
      renterSignedAt: signedAt,
      status: "complete",
      guardianLegalName: null,
      guardianSignedAt: null,
    });
    expect(oldCopy).toContain("$60,000.00");
    expect(oldCopy).toContain(PREVIOUS_VERSION);
    expect(oldCopy).toContain(PREVIOUS_TEXT_SHA256);
    expect(oldCopy).not.toContain("$75,000.00");
    expect(oldCopy).not.toContain(AGREEMENT_VERSION);
    void admin;
  });

  it("does not complete a minor's agreement until a parent signs separately", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const minor = await makeUser({ email: "sam@example.com", name: "Sam Student", role: "student" });
    const instructor = await makeUser({ email: "ivy@example.com", name: "Ivy Instructor", role: "instructor" });
    const plane = await makePlane();
    const dual = await makeReservation(minor.id, plane, instructor.id);
    const cookie = await login(minor.email);
    const signed = await post("/agreement/sign", { ...SIGN, legal_name: "Sam Alex Student", age: "minor" }, cookie);
    expect(signed.status).toBe(303);
    expect(signed.headers.get("location")).toContain("agreement-guardian");
    const row = await db()
      .prepare("SELECT status, renter_signed_at, guardian_legal_name FROM agreement_signatures WHERE user_id = ?")
      .bind(minor.id)
      .first<{ status: string; renter_signed_at: string; guardian_legal_name: string | null }>();
    expect(row?.status).toBe("awaiting_guardian");
    expect(row?.guardian_legal_name).toBeNull();
    const blocked = await post(`/reservations/${dual}/checkout`, METERS, cookie);
    expect(blocked.status).toBe(422);
    expect(await blocked.text()).toContain("not parent consent");
    const noConsent = await post("/agreement/guardian", { guardian_legal_name: "Alex Parent Student" }, cookie);
    expect(noConsent.status).toBe(422);
    const guardian = await post("/agreement/guardian", { guardian_legal_name: "Alex Parent Student", guardian_consent: "yes" }, cookie);
    expect(guardian.status).toBe(303);
    const done = await db()
      .prepare("SELECT status, legal_name, renter_signed_at, guardian_legal_name, guardian_signed_at FROM agreement_signatures WHERE user_id = ?")
      .bind(minor.id)
      .first<{ status: string; legal_name: string; renter_signed_at: string; guardian_legal_name: string; guardian_signed_at: string }>();
    expect(done?.status).toBe("complete");
    expect(done?.legal_name).toBe("Sam Alex Student");
    expect(done?.renter_signed_at).toBe(row?.renter_signed_at);
    expect(done?.guardian_legal_name).toBe("Alex Parent Student");
    expect(done?.guardian_signed_at).not.toBe(done?.renter_signed_at);
    const pdf = new TextDecoder().decode(await (await get("/agreement/signed", cookie)).arrayBuffer());
    expect(pdf).toContain("Alex Parent Student");
    expect(pdf).toContain("separate signature action");
    expect(pdf).not.toContain("_______________________________");
  });
});
