import { hashPassword } from "./auth";
import { computeFlightCost } from "./domain";
import { addDays, todayInZone, zonedTimeToUtc } from "./time";
import { ORG_NAME } from "./types";

export const DEMO_PASSWORD = "Pattern123!";

/** Wet rate Kyle gave for N1561Y: $155.00 per Hobbs hour. */
const WET_CENTS = 15500;
/** Instructor rate Kyle gave for Juan Valdivia: $75.00 per Hobbs hour. */
const INSTRUCTOR_CENTS = 7500;

const IDS = {
  kyle: "00000000-0000-4000-8000-000000000001",
  juan: "00000000-0000-4000-8000-000000000002",
  priya: "00000000-0000-4000-8000-000000000004",
  luis: "00000000-0000-4000-8000-000000000005",
  sam: "00000000-0000-4000-8000-000000000006",
  jordan: "00000000-0000-4000-8000-000000000007",
  n1561y: "00000000-0000-4000-8000-000000000101",
};

export async function buildDemoSeedSql(now = new Date()): Promise<string> {
  const today = todayInZone(now);
  const day = (offset: number, time: string) => zonedTimeToUtc(`${addDays(today, offset)}T${time}`).toISOString();
  const hash = await hashPassword(DEMO_PASSWORD);
  const created = now.toISOString();
  const lines: string[] = [
    "DELETE FROM email_outbox;",
    "DELETE FROM flight_logs;",
    "DELETE FROM reservations;",
    "DELETE FROM maintenance_blocks;",
    "DELETE FROM aircraft_checkouts;",
    "DELETE FROM sessions;",
    "DELETE FROM aircraft;",
    "DELETE FROM users;",
  ];

  const users: Array<[string, string, string, string, string, string | null, string | null, string | null, string | null, number | null, string]> = [
    [IDS.kyle, "kyle.bushman@example.com", "Kyle Bushman", "admin", "541-555-0148", "commercial", "C1234567", "second", addDays(today, 300), null, "demo-ical-kyle"],
    [IDS.juan, "juan.valdivia@example.com", "Juan Valdivia", "instructor", "541-555-0175", null, null, null, null, INSTRUCTOR_CENTS, "demo-ical-juan"],
    [IDS.priya, "priya.shah@example.com", "Priya Shah", "renter", "541-555-0115", "private", "SAMPLE-P001", "third", addDays(today, 400), null, "demo-ical-priya"],
    [IDS.luis, "luis.ortega@example.com", "Luis Ortega", "renter", "541-555-0160", "student", "SAMPLE-S001", "third", addDays(today, 200), null, "demo-ical-luis"],
    [IDS.sam, "sam.okonkwo@example.com", "Sam Okonkwo", "renter", "541-555-0133", "private", "SAMPLE-P002", "third", addDays(today, -20), null, "demo-ical-sam"],
    [IDS.jordan, "jordan.hale@example.com", "Jordan Hale", "renter", "541-555-0188", "commercial", "SAMPLE-C001", "first", addDays(today, 90), null, "demo-ical-jordan"],
  ];
  for (const user of users) {
    lines.push(
      `INSERT INTO users (id, email, password_hash, name, role, phone, certificate_type, certificate_number, medical_class, medical_expiration, instructor_rate_cents, ical_token, created_at) VALUES (${[
        sql(user[0]),
        sql(user[1]),
        sql(hash),
        sql(user[2]),
        sql(user[3]),
        sql(user[4]),
        sql(user[5]),
        sql(user[6]),
        sql(user[7]),
        sql(user[8]),
        user[9] == null ? "NULL" : String(user[9]),
        sql(user[10]),
        sql(created),
      ].join(", ")});`,
    );
  }

  lines.push(
    `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at) VALUES (${[
      sql(IDS.n1561y),
      sql("N1561Y"),
      sql("Cessna"),
      sql("172C"),
      "NULL",
      String(WET_CENTS),
      "NULL",
      sql("wet"),
      sql("available"),
      "1005.6",
      "804.6",
      sql("Sample Hobbs and tach only, not the airplane's real meters. Wet rate is $155.00. Dry rate is intentionally blank."),
      sql(created),
    ].join(", ")});`,
  );

  const checkouts = [IDS.kyle, IDS.juan, IDS.priya, IDS.luis, IDS.sam, IDS.jordan];
  checkouts.forEach((userId, index) => {
    lines.push(
      `INSERT INTO aircraft_checkouts (id, user_id, aircraft_id, status, checked_out_on, expires_on) VALUES (${[
        sql(id("checkout", index + 1)),
        sql(userId),
        sql(IDS.n1561y),
        sql("current"),
        sql(addDays(today, -40)),
        sql(addDays(today, 365)),
      ].join(", ")});`,
    );
  });

  lines.push(
    `INSERT INTO maintenance_blocks (id, aircraft_id, starts_at, ends_at, reason, created_by, created_at) VALUES (${[
      sql(id("maint", 1)),
      sql(IDS.n1561y),
      sql(day(1, "18:00")),
      sql(day(1, "21:00")),
      sql("Oil and filter change"),
      sql(IDS.kyle),
      sql(created),
    ].join(", ")});`,
  );

  type Booking = {
    n: number;
    pilot: string;
    instructor: string | null;
    start: string;
    end: string;
    status: "scheduled" | "checked_out" | "checked_in";
    hobbsOut?: number;
    tachOut?: number;
    hobbsIn?: number;
    tachIn?: number;
    notes?: string;
  };
  const bookings: Booking[] = [
    { n: 1, pilot: IDS.priya, instructor: IDS.juan, start: day(0, "08:00"), end: day(0, "10:00"), status: "checked_out", hobbsOut: 1005.6, tachOut: 804.6, notes: "Pattern work. Sample flight, not a real booking." },
    { n: 2, pilot: IDS.jordan, instructor: null, start: day(0, "10:30"), end: day(0, "12:30"), status: "scheduled", notes: "Solo practice. Sample flight." },
    { n: 3, pilot: IDS.kyle, instructor: IDS.juan, start: day(0, "13:00"), end: day(0, "15:00"), status: "scheduled", notes: "Flight review. Sample flight." },
    { n: 4, pilot: IDS.priya, instructor: null, start: day(0, "15:30"), end: day(0, "17:30"), status: "scheduled", notes: "Sample solo." },
    { n: 5, pilot: IDS.priya, instructor: null, start: day(1, "09:00"), end: day(1, "11:00"), status: "scheduled" },
    { n: 6, pilot: IDS.luis, instructor: IDS.juan, start: day(1, "13:00"), end: day(1, "15:00"), status: "scheduled", notes: "Sample lesson." },
    { n: 7, pilot: IDS.jordan, instructor: null, start: day(2, "15:00"), end: day(2, "17:00"), status: "scheduled" },
    { n: 10, pilot: IDS.jordan, instructor: null, start: day(-1, "16:00"), end: day(-1, "18:00"), status: "checked_in", hobbsOut: 1004.1, tachOut: 803.4, hobbsIn: 1005.6, tachIn: 804.6 },
    { n: 11, pilot: IDS.priya, instructor: IDS.juan, start: day(-4, "13:00"), end: day(-4, "15:00"), status: "checked_in", hobbsOut: 1001.1, tachOut: 800.9, hobbsIn: 1002.9, tachIn: 802.4 },
    { n: 12, pilot: IDS.luis, instructor: IDS.juan, start: day(-3, "09:00"), end: day(-3, "11:00"), status: "checked_in", hobbsOut: 1002.9, tachOut: 802.4, hobbsIn: 1004.1, tachIn: 803.4, notes: "Sample lesson." },
    { n: 13, pilot: IDS.sam, instructor: null, start: day(-12, "11:00"), end: day(-12, "12:30"), status: "checked_in", hobbsOut: 1000.0, tachOut: 800.0, hobbsIn: 1001.1, tachIn: 800.9 },
  ];

  for (const booking of bookings) {
    const reservationId = id("res", booking.n);
    lines.push(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at, cancelled_at) VALUES (${[
        sql(reservationId),
        sql(IDS.n1561y),
        sql(booking.pilot),
        sql(booking.instructor),
        sql(booking.start),
        sql(booking.end),
        sql(booking.status),
        sql("wet"),
        num(booking.hobbsOut ?? null),
        num(booking.tachOut ?? null),
        num(booking.hobbsIn ?? null),
        num(booking.tachIn ?? null),
        sql(booking.notes ?? null),
        sql(IDS.kyle),
        sql(booking.start),
        sql(booking.end),
        "NULL",
      ].join(", ")});`,
    );
    if (booking.status === "checked_in" && booking.hobbsOut != null && booking.hobbsIn != null) {
      const cost = computeFlightCost({
        hobbsOut: booking.hobbsOut,
        hobbsIn: booking.hobbsIn,
        tachOut: booking.tachOut ?? null,
        tachIn: booking.tachIn ?? null,
        rateBasis: "wet",
        wetCents: WET_CENTS,
        dryCents: null,
        instructorRateCents: booking.instructor ? INSTRUCTOR_CENTS : null,
      });
      if (!cost.ok) throw new Error(cost.error);
      const value = cost.value;
      lines.push(
        `INSERT INTO flight_logs (id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours, aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at) VALUES (${[
          sql(id("log", booking.n)),
          sql(reservationId),
          sql(booking.pilot),
          sql(booking.instructor),
          sql(IDS.n1561y),
          String(value.hobbsOut),
          String(value.hobbsIn),
          num(value.tachOut),
          num(value.tachIn),
          String(value.flightHours),
          String(value.aircraftRateCents),
          String(value.aircraftCostCents),
          String(value.instructorRateCents),
          String(value.instructorHours),
          String(value.instructorCostCents),
          String(value.totalCostCents),
          sql("wet"),
          sql(booking.end),
        ].join(", ")});`,
      );
    }
  }

  lines.push(
    `INSERT INTO email_outbox (id, to_email, subject, body, created_at) VALUES (${[
      sql(id("mail", 1)),
      sql("priya.shah@example.com"),
      sql("N1561Y reservation confirmed"),
      sql(`Hi Priya Shah, your ${ORG_NAME} reservation was confirmed for N1561Y. This note was recorded by Rampboard. No email provider is connected yet.`),
      sql(created),
    ].join(", ")});`,
  );
  return `${lines.join("\n")}\n`;
}

function id(kind: string, n: number): string {
  const base = kind === "res" ? 200 : kind === "log" ? 300 : kind === "maint" ? 400 : kind === "mail" ? 500 : 600;
  return `00000000-0000-4000-8000-${String(base + n).padStart(12, "0")}`;
}

function sql(value: string | null): string {
  if (value == null) return "NULL";
  return `'${value.replaceAll("'", "''")}'`;
}

function num(value: number | null): string {
  return value == null ? "NULL" : String(value);
}
