import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { billingByPilot, findBookingClash, getFlightLog, insertAircraft, insertReservationIfFree, insertUser } from "../src/db";
import { BILLED_OUTSIDE_LABEL } from "../src/format";
import { addDays, todayInZone, zonedTimeToUtc } from "../src/time";
import type { Aircraft, User } from "../src/types";
import { buildFlightImport, type ImportAircraft, type ImportUser } from "../scripts/flight-import";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

const SAMPLE = `date,pilot,instructor,tach_start,tach_end,hobbs_start,hobbs_end,flight_time,ground_time,paid_status,fuel_added_gal,oil_added_qt,rental_type
2026-09-05,Juan Valdivia,,435.7,435.9,279.1,279.4,0.3,0,Maintenance,0,0,Maintenance flight
2026-09-05,Noah,Juan Valdivia,435.9,436.5,279.4,280.1,0.7,0,Aircraft paid; instructor paid,0,0,Discovery flight
2026-09-25,Jett Rhoads,Hannah Edward's,455.7,456.2,301.7,302.7,1.0,,Aircraft paid,18.5,1,Rental
`;

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
    medicalExpiration: partial.medicalExpiration === undefined ? addDays(todayInZone(), 200) : partial.medicalExpiration,
    instructorRateCents: partial.instructorRateCents ?? (partial.role === "instructor" ? 7500 : null),
    icalToken: partial.icalToken ?? newToken(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await insertUser(db(), user);
  return user;
}

async function makeAircraft(partial: Partial<Aircraft> = {}): Promise<Aircraft> {
  const aircraft: Aircraft = {
    id: partial.id ?? crypto.randomUUID(),
    tailNumber: partial.tailNumber ?? "N1561Y",
    make: "Cessna",
    model: "172C",
    year: null,
    hourlyWetCents: partial.hourlyWetCents ?? 15500,
    hourlyDryCents: null,
    defaultRate: "wet",
    status: "available",
    hobbs: partial.hobbs === undefined ? null : partial.hobbs,
    tach: partial.tach === undefined ? null : partial.tach,
    notes: null,
    createdAt: new Date().toISOString(),
  };
  await insertAircraft(db(), aircraft);
  return aircraft;
}

function post(path: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", origin: BASE });
  if (cookie) headers.set("cookie", cookie);
  return SELF.fetch(`${BASE}${path}`, { method: "POST", headers, body: new URLSearchParams(fields), redirect: "manual" });
}

function get(path: string, cookie = ""): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
}

function sessionCookie(response: Response): string {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const token = cookies.map((cookie) => /rampboard_session=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
  if (!token) throw new Error(`Missing session cookie: ${cookies.join(" | ")}`);
  return `rampboard_session=${token}`;
}

beforeEach(async () => {
  await reset();
});

describe("historical flight import", () => {
  it("builds idempotent zero-charge SQL and keeps guest instructors off the user list", async () => {
    const juan: ImportUser = { id: "juan-id", name: "Juan Valdivia", role: "instructor" };
    const aircraft: ImportAircraft = { id: "plane-id", tailNumber: "N1561Y", hourlyWetCents: 15500 };
    const first = await buildFlightImport({ csv: SAMPLE, aircraft, users: [juan], bill: false, instructorRateCents: 7500 });
    const second = await buildFlightImport({ csv: SAMPLE, aircraft, users: [juan], bill: false, instructorRateCents: null });
    expect(second.sql).toBe(first.sql);
    expect(first.bill).toBe(false);
    expect(first.totalCostCents).toBe(0);
    expect(first.flights).toHaveLength(3);
    expect(first.createdPilots).toEqual(["Jett Rhoads", "Noah"]);
    expect(first.reusedPilots).toEqual(["Juan Valdivia"]);
    expect(first.guestInstructors).toEqual(["Hannah Edward's"]);
    expect(first.hobbs).toBeCloseTo(302.7);
    expect(first.tach).toBeCloseTo(456.2);
    expect(first.sql).toContain(BILLED_OUTSIDE_LABEL);
    expect(first.sql).toContain("Hannah Edward''s");
    expect(first.sql).not.toContain("'Hannah Edward''s', 'renter'");
    expect(first.sql).toContain("NULL, 'disabled', 'Noah'");
    expect(first.sql).not.toMatch(/\bDELETE\b/);
    expect(first.sql).not.toMatch(/\bDROP\b/);
    const updates = first.sql.trim().split("\n").filter((line) => line.startsWith("UPDATE "));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("tail_number = 'N1561Y'");
    const jett = first.flights.find((flight) => flight.pilotName === "Jett Rhoads");
    expect(jett?.instructorId).toBeNull();
    expect(jett?.guestInstructorName).toBe("Hannah Edward's");
    expect(jett?.totalCostCents).toBe(0);
    expect(jett?.billingStatus).toBe("external");
    expect(jett?.groundHours).toBeNull();
    const noah = first.flights.find((flight) => flight.pilotName === "Noah");
    expect(noah?.instructorId).toBe("juan-id");
    expect(noah?.aircraftCostCents).toBe(0);
    expect(noah?.instructorCostCents).toBe(0);
    const sameDay = first.flights.filter((flight) => flight.date === "2026-09-05");
    expect(sameDay[1]!.startsAt >= sameDay[0]!.endsAt).toBe(true);
    for (const flight of first.flights) {
      expect(flight.endsAt < "2026-10-23").toBe(true);
      expect(flight.notes).toContain(`import-key:${flight.key}.`);
    }

    const billed = await buildFlightImport({ csv: SAMPLE, aircraft, users: [juan], bill: true, instructorRateCents: 7500 });
    expect(billed.sql).not.toContain(BILLED_OUTSIDE_LABEL);
    const billedNoah = billed.flights.find((flight) => flight.pilotName === "Noah");
    expect(billedNoah?.aircraftCostCents).toBe(10850);
    expect(billedNoah?.instructorCostCents).toBe(5250);
    expect(billedNoah?.totalCostCents).toBe(16100);
    const maintenance = billed.flights.find((flight) => flight.maintenance);
    expect(maintenance?.totalCostCents).toBe(0);
    const billedJett = billed.flights.find((flight) => flight.pilotName === "Jett Rhoads");
    expect(billedJett?.aircraftCostCents).toBe(15500);
    expect(billedJett?.instructorCostCents).toBe(0);
  });

  it("loads the rows into the local database without charges or schedule blocks", async () => {
    const admin = await makeUser({ email: "kyle@example.com", name: "Kyle Bushman", role: "admin" });
    const juan = await makeUser({
      email: null,
      name: "Juan Valdivia",
      role: "instructor",
      passwordHash: "disabled",
      instructorRateCents: 7500,
    });
    const aircraft = await makeAircraft({ tailNumber: "N1561Y", hourlyWetCents: 15500, hobbs: null, tach: null });
    const plan = await buildFlightImport({
      csv: SAMPLE,
      aircraft: { id: aircraft.id, tailNumber: aircraft.tailNumber, hourlyWetCents: aircraft.hourlyWetCents },
      users: [{ id: juan.id, name: juan.name, role: juan.role }],
      bill: false,
      instructorRateCents: null,
    });
    await db().exec(plan.sql);
    await db().exec(plan.sql);

    const counts = await db()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM flight_logs) AS logs,
           (SELECT COUNT(*) FROM reservations WHERE status = 'checked_in') AS closed,
           (SELECT COUNT(*) FROM reservations WHERE status IN ('scheduled', 'checked_out')) AS active,
           (SELECT COUNT(*) FROM maintenance_blocks) AS maintenance,
           (SELECT COALESCE(SUM(total_cost_cents), 0) FROM flight_logs) AS cents,
           (SELECT COUNT(*) FROM flight_logs WHERE billing_status = 'external' AND billing_note = ?) AS labeled,
           (SELECT COUNT(*) FROM users WHERE name = 'Juan Valdivia') AS juans,
           (SELECT COUNT(*) FROM users WHERE name LIKE 'Hannah%') AS hannahs,
           (SELECT COUNT(*) FROM users WHERE name = 'Noah' AND email IS NULL AND password_hash = 'disabled') AS noahs`,
      )
      .bind(BILLED_OUTSIDE_LABEL)
      .first<{ logs: number; closed: number; active: number; maintenance: number; cents: number; labeled: number; juans: number; hannahs: number; noahs: number }>();
    expect(Number(counts?.logs)).toBe(3);
    expect(Number(counts?.closed)).toBe(3);
    expect(Number(counts?.active)).toBe(0);
    expect(Number(counts?.maintenance)).toBe(0);
    expect(Number(counts?.cents)).toBe(0);
    expect(Number(counts?.labeled)).toBe(3);
    expect(Number(counts?.juans)).toBe(1);
    expect(Number(counts?.hannahs)).toBe(0);
    expect(Number(counts?.noahs)).toBe(1);
    expect(await billingByPilot(db())).toEqual([]);

    const meters = await db().prepare("SELECT hobbs, tach FROM aircraft WHERE id = ?").bind(aircraft.id).first<{ hobbs: number; tach: number }>();
    expect(meters?.hobbs).toBeCloseTo(302.7);
    expect(meters?.tach).toBeCloseTo(456.2);
    await db().prepare("UPDATE aircraft SET hobbs = 9000, tach = 9000 WHERE id = ?").bind(aircraft.id).run();
    await db().exec(plan.sql);
    const held = await db().prepare("SELECT hobbs, tach FROM aircraft WHERE id = ?").bind(aircraft.id).first<{ hobbs: number; tach: number }>();
    expect(held?.hobbs).toBeCloseTo(9000);
    expect(held?.tach).toBeCloseTo(9000);
    await db().prepare("UPDATE aircraft SET hobbs = 100, tach = 100 WHERE id = ?").bind(aircraft.id).run();
    await db().exec(plan.sql);
    const raised = await db().prepare("SELECT hobbs, tach FROM aircraft WHERE id = ?").bind(aircraft.id).first<{ hobbs: number; tach: number }>();
    expect(raised?.hobbs).toBeCloseTo(302.7);
    expect(raised?.tach).toBeCloseTo(456.2);

    const stillThree = await db().prepare("SELECT COUNT(*) AS n FROM flight_logs").first<{ n: number }>();
    expect(Number(stillThree?.n)).toBe(3);

    const jett = plan.flights.find((flight) => flight.pilotName === "Jett Rhoads");
    const log = await getFlightLog(db(), jett?.logId ?? "");
    expect(log?.guestInstructorName).toBe("Hannah Edward's");
    expect(log?.instructorName).toBe("Hannah Edward's");
    expect(log?.instructorId).toBeNull();
    expect(log?.rentalType).toBe("Rental");
    expect(log?.fuelAddedGal).toBeCloseTo(18.5);
    expect(log?.oilAddedQt).toBeCloseTo(1);
    expect(log?.groundHours).toBeNull();
    expect(log?.billingStatus).toBe("external");
    expect(log?.totalCostCents).toBe(0);
    expect(log?.aircraftPaid).toBe(true);
    expect(log?.instructorPaid).toBe(false);

    const futureId = crypto.randomUUID();
    const later = await insertReservationIfFree(db(), {
      id: futureId,
      aircraftId: aircraft.id,
      pilotId: admin.id,
      instructorId: juan.id,
      startsAt: zonedTimeToUtc("2026-11-02T09:00").toISOString(),
      endsAt: zonedTimeToUtc("2026-11-02T11:00").toISOString(),
      rateBasis: "wet",
      notes: "after the paper log",
      createdBy: admin.id,
      createdAt: new Date().toISOString(),
    });
    expect(later).toBe(true);
    const afternoon = await findBookingClash(db(), {
      aircraftId: aircraft.id,
      pilotId: admin.id,
      instructorId: null,
      startsAt: zonedTimeToUtc("2026-09-05T13:00").toISOString(),
      endsAt: zonedTimeToUtc("2026-09-05T15:00").toISOString(),
    });
    expect(afternoon).toBeNull();

    const cookie = sessionCookie(await post("/login", { email: "kyle@example.com", password: "Pattern123!" }));
    const logsPage = await get("/logs", cookie);
    expect(logsPage.status).toBe(200);
    const logsHtml = await logsPage.text();
    expect(logsHtml).toContain("Billed outside");
    expect(logsHtml).toContain(BILLED_OUTSIDE_LABEL);
    expect(logsHtml).toContain("Discovery flight");
    expect(logsHtml).toContain("Maintenance flight");
    expect(logsHtml).toContain("Hannah Edward");
    expect(logsHtml).toContain("Jett Rhoads");

    const detail = await get(`/logs/${jett?.logId}`, cookie);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain("Not billed here");
    expect(detailHtml).toContain(BILLED_OUTSIDE_LABEL);
    expect(detailHtml).toContain("Aircraft charge $0.00");
    expect(detailHtml).toContain("Instructor charge $0.00");
    expect(detailHtml).toContain("not on the pilot");
    expect(detailHtml).toContain("18.5 gal");
    expect(detailHtml).toContain("1 qt");
    expect(detailHtml).toContain("Aircraft paid");

    const reservation = await get(`/reservations/${jett?.reservationId}`, cookie);
    const reservationHtml = await reservation.text();
    expect(reservationHtml).toContain(BILLED_OUTSIDE_LABEL);
    expect(reservationHtml).toContain("Hannah Edward");
    expect(reservationHtml).toContain("Rental");

    const day = await get("/schedule?view=day&date=2026-09-25", cookie);
    expect(await day.text()).toContain("Hannah Edward");

    const home = await get("/", cookie);
    const homeHtml = await home.text();
    expect(homeHtml).toContain("Billed outside");
    expect(homeHtml).toContain("No in-app charges yet");
    expect(homeHtml).not.toContain(">$0.00</td>");

    const people = await get("/pilots", cookie);
    const peopleHtml = await people.text();
    expect(peopleHtml).toContain("Noah");
    expect(peopleHtml).not.toContain("Hannah Edward");

    const noah = await db().prepare("SELECT id FROM users WHERE name = 'Noah'").first<{ id: string }>();
    const pilotPage = await get(`/pilots/${noah?.id}`, cookie);
    expect(await pilotPage.text()).toContain("already paid outside the app");

    const checkedOut = await post(`/reservations/${futureId}/checkout`, { hobbs_out: "400.0", tach_out: "500.0" }, cookie);
    expect(checkedOut.status).toBe(303);
    const checkedIn = await post(`/reservations/${futureId}/checkin`, { hobbs_in: "401.0", tach_in: "501.0" }, cookie);
    expect(checkedIn.status).toBe(303);
    const billing = await billingByPilot(db());
    expect(billing).toEqual([{ id: admin.id, name: "Kyle Bushman", flights: 1, hours: 1, totalCents: 23000 }]);
    const fresh = await get(checkedIn.headers.get("location") ?? "/", cookie);
    const freshHtml = await fresh.text();
    expect(freshHtml).toContain("$155.00");
    expect(freshHtml).toContain("$75.00");
    expect(freshHtml).toContain("$230.00");
    expect(freshHtml).not.toContain(BILLED_OUTSIDE_LABEL);
  });
});
