import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertAircraft, insertUser } from "../src/db";
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
    DELETE FROM resource_chunks;
    DELETE FROM resources WHERE id <> 'poh-172c-1962';
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



const POH = "/resources/poh-172c-1962";
const POH_BYTES = 15175749;

function fakePdf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const header = new TextEncoder().encode("%PDF-1.4\n");
  bytes.set(header);
  for (let i = header.length; i < size; i += 1) bytes[i] = (i * 31 + 7) % 251;
  return bytes;
}

async function upload(cookie: string, fields: Record<string, string>, file: Uint8Array | null, name = "wb.pdf"): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", new File([file], name, { type: "application/pdf" }));
  return SELF.fetch(`${BASE}/resources`, { method: "POST", headers: { cookie, origin: BASE }, body: form, redirect: "manual" });
}

beforeEach(async () => {
  await reset();
});

describe("Resources tab", () => {
  it("is private: signed-out visitors are sent to login, including the raw /docs file", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    for (const path of ["/resources", `${POH}/view`, `${POH}/download`, "/docs/cessna-172c-1962-owners-manual.pdf"]) {
      const response = await get(path);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/login?next=");
    }
  });

  it("shows in the nav for every role and lists the 1962 172C POH under N1561Y", async () => {
    const aircraft = await makeAircraft();
    await db().prepare("UPDATE resources SET aircraft_id = ? WHERE id = 'poh-172c-1962'").bind(aircraft.id).run();
    const roles = ["admin", "instructor", "renter", "student"] as const;
    for (const role of roles) {
      const person = await makeUser({ email: `${role}@example.com`, name: `${role} person`, role });
      const cookie = await login(person.email);
      const dash = await (await get("/", cookie)).text();
      expect(dash).toContain('href="/resources">Resources</a>');
      const response = await get("/resources", cookie);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('aria-current="page">Resources');
      expect(html).toContain("N1561Y · 1966 Cessna 172C");
      expect(html).toContain("Owner&#39;s Manual (POH), 1962 Cessna 172C");
      expect(html).toContain(`href="${POH}/view"`);
      expect(html).toContain(`href="${POH}/download"`);
      expect(html).toContain("The FAA-approved manual stays in the airplane.");
      if (role === "admin") {
        expect(html).toContain('action="/resources" enctype="multipart/form-data"');
        expect(html).toContain(`action="${POH}/delete"`);
      } else {
        expect(html).not.toContain('action="/resources"');
        expect(html).not.toContain("/delete");
      }
    }
  });

  it("serves the POH PDF inline for View and as an attachment for Download", async () => {
    await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const renter = await makeUser({ email: "renter@example.com", name: "Renter", role: "renter" });
    const cookie = await login(renter.email);
    const view = await get(`${POH}/view`, cookie);
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toBe("application/pdf");
    expect(view.headers.get("content-disposition")).toBe('inline; filename="cessna-172c-1962-owners-manual.pdf"');
    expect(view.headers.get("cache-control")).toBe("private, max-age=3600");
    const bytes = new Uint8Array(await view.arrayBuffer());
    expect(bytes.length).toBe(POH_BYTES);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    const download = await get(`${POH}/download`, cookie);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="cessna-172c-1962-owners-manual.pdf"');
    await download.arrayBuffer();
    // The raw asset path is not a public shortcut, even when signed in.
    const raw = await get("/docs/cessna-172c-1962-owners-manual.pdf", cookie);
    expect(raw.status).toBe(404);
    await raw.arrayBuffer();
  });

  it("lets an admin upload a PDF that everyone can open, byte for byte, and delete it", async () => {
    const aircraft = await makeAircraft();
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const student = await makeUser({ email: "student@example.com", name: "Sam Student", role: "student" });
    const adminCookie = await login(admin.email);
    const studentCookie = await login(student.email);
    const pdf = fakePdf(1_300_000);
    const response = await upload(adminCookie, { title: "Weight and balance", aircraft_id: aircraft.id, notes: "" }, pdf, "W&B sheet.pdf");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/resources?notice=resource-added");
    const row = await db().prepare("SELECT id, size_bytes, file_name FROM resources WHERE title = 'Weight and balance'").first<{ id: string; size_bytes: number; file_name: string }>();
    expect(row?.size_bytes).toBe(pdf.length);
    expect(row?.file_name).toBe("W-B-sheet.pdf");
    const chunks = await db().prepare("SELECT COUNT(*) AS n FROM resource_chunks WHERE resource_id = ?").bind(row!.id).first<{ n: number }>();
    expect(chunks?.n).toBe(3);
    const html = await (await get("/resources", studentCookie)).text();
    expect(html).toContain("Weight and balance");
    const view = await get(`/resources/${row!.id}/view`, studentCookie);
    expect(view.headers.get("content-type")).toBe("application/pdf");
    const back = new Uint8Array(await view.arrayBuffer());
    expect(back.length).toBe(pdf.length);
    expect(back.every((value, index) => value === pdf[index])).toBe(true);

    const studentDelete = await post(`/resources/${row!.id}/delete`, {}, studentCookie);
    expect(studentDelete.status).toBe(403);
    const removed = await post(`/resources/${row!.id}/delete`, {}, adminCookie);
    expect(removed.status).toBe(303);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM resource_chunks WHERE resource_id = ?").bind(row!.id).first("n")).toBe(0);
    expect((await get(`/resources/${row!.id}/view`, studentCookie)).status).toBe(404);
  });

  it("rejects uploads from non-admins, non-PDF files, and missing titles", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const instructor = await makeUser({ email: "cfi@example.com", name: "Ivy Instructor", role: "instructor" });
    const adminCookie = await login(admin.email);
    expect((await upload(await login(instructor.email), { title: "X" }, fakePdf(2000))).status).toBe(403);
    const notPdf = await upload(adminCookie, { title: "Photo" }, new TextEncoder().encode("GIF89a not a pdf"), "x.pdf");
    expect(notPdf.status).toBe(400);
    expect(await notPdf.text()).toContain("That file is not a PDF.");
    const noTitle = await upload(adminCookie, { title: " " }, fakePdf(2000));
    expect(noTitle.status).toBe(400);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM resources").first("n")).toBe(1);
  });
});
