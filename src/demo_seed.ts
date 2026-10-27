import { hashPassword } from "./auth";
import { computeFlightCost } from "./domain";
import { addDays, todayInZone, zonedTimeToUtc } from "./time";

export const DEMO_PASSWORD = "Pattern123!";

const IDS = {
  kyle: "00000000-0000-4000-8000-000000000001",
  maya: "00000000-0000-4000-8000-000000000002",
  andre: "00000000-0000-4000-8000-000000000003",
  priya: "00000000-0000-4000-8000-000000000004",
  luis: "00000000-0000-4000-8000-000000000005",
  sam: "00000000-0000-4000-8000-000000000006",
  jordan: "00000000-0000-4000-8000-000000000007",
  n172: "00000000-0000-4000-8000-000000000101",
  n182: "00000000-0000-4000-8000-000000000102",
  n28: "00000000-0000-4000-8000-000000000103",
  n152: "00000000-0000-4000-8000-000000000104",
  n550: "00000000-0000-4000-8000-000000000105",
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

  const users = [
    [IDS.kyle, "kyle.bushman@example.com", "Kyle Bushman", "admin", "541-555-0148", "commercial", "C1234567", "second", addDays(today, 300), null, "demo-ical-kyle"],
    [IDS.maya, "maya.chen@example.com", "Maya Chen", "instructor", "541-555-0172", "commercial", "CFI88211", "second", addDays(today, 220), 7500, "demo-ical-maya"],
    [IDS.andre, "andre.walsh@example.com", "Andre Walsh", "instructor", "541-555-0194", "commercial", "CFI44019", "second", addDays(today, 180), 6500, "demo-ical-andre"],
    [IDS.priya, "priya.shah@example.com", "Priya Shah", "renter", "541-555-0115", "private", "P998120", "third", addDays(today, 400), null, "demo-ical-priya"],
    [IDS.luis, "luis.ortega@example.com", "Luis Ortega", "renter", "541-555-0160", "student", "S441290", "third", addDays(today, 200), null, "demo-ical-luis"],
    [IDS.sam, "sam.okonkwo@example.com", "Sam Okonkwo", "renter", "541-555-0133", "private", "P220184", "third", addDays(today, -20), null, "demo-ical-sam"],
    [IDS.jordan, "jordan.hale@example.com", "Jordan Hale", "renter", "541-555-0188", "commercial", "C775410", "first", addDays(today, 90), null, "demo-ical-jordan"],
  ] as const;
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

  const aircraft = [
    [IDS.n172, "N172RB", "Cessna", "172S", 2018, 17900, 14900, "wet", "available", 4128.4, 3102.2, "Primary trainer. Fuel $6.10/gal on the wet rate."],
    [IDS.n182, "N182RB", "Cessna", "182T", 2016, 24900, 20900, "wet", "available", 2204.1, 1988.6, "Cross-country ship. G1000."],
    [IDS.n28, "N28RB", "Piper", "PA-28-181 Archer", 2004, 16900, 13900, "wet", "available", 3890.2, 3611.0, "Good IFR platform."],
    [IDS.n152, "N152RB", "Cessna", "152", 1979, 12900, 10900, "wet", "grounded", 7320.5, 7011.8, "In the shop for annual."],
    [IDS.n550, "N550RB", "Beechcraft", "A36 Bonanza", 1998, 38900, 32900, "wet", "available", 1544.8, 1490.2, "Complex checkout required."],
  ] as const;
  for (const item of aircraft) {
    lines.push(
      `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at) VALUES (${[
        sql(item[0]),
        sql(item[1]),
        sql(item[2]),
        sql(item[3]),
        String(item[4]),
        String(item[5]),
        String(item[6]),
        sql(item[7]),
        sql(item[8]),
        String(item[9]),
        String(item[10]),
        sql(item[11]),
        sql(created),
      ].join(", ")});`,
    );
  }

  const checkouts: Array<[string, string, string]> = [
    [IDS.kyle, IDS.n172, addDays(today, 365)],
    [IDS.kyle, IDS.n182, addDays(today, 365)],
    [IDS.kyle, IDS.n28, addDays(today, 365)],
    [IDS.maya, IDS.n172, addDays(today, 365)],
    [IDS.maya, IDS.n182, addDays(today, 365)],
    [IDS.maya, IDS.n28, addDays(today, 365)],
    [IDS.andre, IDS.n172, addDays(today, 200)],
    [IDS.andre, IDS.n28, addDays(today, 200)],
    [IDS.andre, IDS.n152, addDays(today, 200)],
    [IDS.priya, IDS.n172, addDays(today, 300)],
    [IDS.priya, IDS.n28, addDays(today, 300)],
    [IDS.luis, IDS.n152, addDays(today, 120)],
    [IDS.sam, IDS.n172, addDays(today, 100)],
    [IDS.jordan, IDS.n182, addDays(today, 250)],
    [IDS.jordan, IDS.n550, addDays(today, 250)],
  ];
  checkouts.forEach((item, index) => {
    lines.push(
      `INSERT INTO aircraft_checkouts (id, user_id, aircraft_id, status, checked_out_on, expires_on) VALUES (${[
        sql(id("checkout", index + 1)),
        sql(item[0]),
        sql(item[1]),
        sql("current"),
        sql(addDays(today, -40)),
        sql(item[2]),
      ].join(", ")});`,
    );
  });

  lines.push(
    `INSERT INTO maintenance_blocks (id, aircraft_id, starts_at, ends_at, reason, created_by, created_at) VALUES (${[
      sql(id("maint", 1)),
      sql(IDS.n152),
      sql(day(-1, "08:00")),
      sql(day(2, "17:00")),
      sql("Annual inspection"),
      sql(IDS.kyle),
      sql(created),
    ].join(", ")});`,
  );
  lines.push(
    `INSERT INTO maintenance_blocks (id, aircraft_id, starts_at, ends_at, reason, created_by, created_at) VALUES (${[
      sql(id("maint", 2)),
      sql(IDS.n182),
      sql(day(1, "18:00")),
      sql(day(1, "21:00")),
      sql("Oil and filter change"),
      sql(IDS.kyle),
      sql(created),
    ].join(", ")});`,
  );

  type Booking = {
    n: number;
    aircraft: string;
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
    wet: number;
    dry: number;
    instructorRate: number | null;
  };
  const bookings: Booking[] = [
    { n: 1, aircraft: IDS.n172, pilot: IDS.priya, instructor: IDS.maya, start: day(0, "08:00"), end: day(0, "10:00"), status: "checked_out", hobbsOut: 4128.4, tachOut: 3102.2, notes: "Pattern work and a short hop to Eugene.", wet: 17900, dry: 14900, instructorRate: 7500 },
    { n: 2, aircraft: IDS.n28, pilot: IDS.kyle, instructor: IDS.andre, start: day(0, "09:00"), end: day(0, "11:00"), status: "scheduled", notes: "Flight review.", wet: 16900, dry: 13900, instructorRate: 6500 },
    { n: 3, aircraft: IDS.n182, pilot: IDS.jordan, instructor: null, start: day(0, "10:30"), end: day(0, "12:30"), status: "scheduled", notes: "Solo cross-country practice.", wet: 24900, dry: 20900, instructorRate: null },
    { n: 4, aircraft: IDS.n550, pilot: IDS.jordan, instructor: null, start: day(0, "14:00"), end: day(0, "16:00"), status: "scheduled", wet: 38900, dry: 32900, instructorRate: null },
    { n: 5, aircraft: IDS.n172, pilot: IDS.priya, instructor: null, start: day(0, "15:30"), end: day(0, "17:30"), status: "scheduled", wet: 17900, dry: 14900, instructorRate: null },
    { n: 6, aircraft: IDS.n172, pilot: IDS.priya, instructor: null, start: day(1, "09:00"), end: day(1, "11:00"), status: "scheduled", wet: 17900, dry: 14900, instructorRate: null },
    { n: 7, aircraft: IDS.n28, pilot: IDS.priya, instructor: IDS.andre, start: day(1, "13:00"), end: day(1, "15:00"), status: "scheduled", notes: "Hood work.", wet: 16900, dry: 13900, instructorRate: 6500 },
    { n: 8, aircraft: IDS.n550, pilot: IDS.jordan, instructor: null, start: day(2, "15:00"), end: day(2, "17:00"), status: "scheduled", wet: 38900, dry: 32900, instructorRate: null },
    { n: 9, aircraft: IDS.n152, pilot: IDS.luis, instructor: IDS.andre, start: day(4, "10:00"), end: day(4, "12:00"), status: "scheduled", notes: "After annual.", wet: 12900, dry: 10900, instructorRate: 6500 },
    { n: 10, aircraft: IDS.n182, pilot: IDS.jordan, instructor: null, start: day(-1, "16:00"), end: day(-1, "18:00"), status: "checked_in", hobbsOut: 2202.6, tachOut: 1987.4, hobbsIn: 2204.1, tachIn: 1988.6, wet: 24900, dry: 20900, instructorRate: null },
    { n: 11, aircraft: IDS.n172, pilot: IDS.priya, instructor: IDS.maya, start: day(-4, "13:00"), end: day(-4, "15:00"), status: "checked_in", hobbsOut: 4124.4, tachOut: 3099.0, hobbsIn: 4126.2, tachIn: 3100.4, wet: 17900, dry: 14900, instructorRate: 7500 },
    { n: 12, aircraft: IDS.n152, pilot: IDS.luis, instructor: IDS.andre, start: day(-3, "09:00"), end: day(-3, "11:00"), status: "checked_in", hobbsOut: 7319.3, tachOut: 7010.8, hobbsIn: 7320.5, tachIn: 7011.8, notes: "Last flight before annual.", wet: 12900, dry: 10900, instructorRate: 6500 },
    { n: 13, aircraft: IDS.n172, pilot: IDS.sam, instructor: null, start: day(-12, "11:00"), end: day(-12, "12:30"), status: "checked_in", hobbsOut: 4122.0, tachOut: 3097.2, hobbsIn: 4123.1, tachIn: 3098.1, wet: 17900, dry: 14900, instructorRate: null },
  ];

  for (const booking of bookings) {
    const reservationId = id("res", booking.n);
    lines.push(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at, cancelled_at) VALUES (${[
        sql(reservationId),
        sql(booking.aircraft),
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
        wetCents: booking.wet,
        dryCents: booking.dry,
        instructorRateCents: booking.instructor ? booking.instructorRate : null,
      });
      if (!cost.ok) throw new Error(cost.error);
      const value = cost.value;
      lines.push(
        `INSERT INTO flight_logs (id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours, aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at) VALUES (${[
          sql(id("log", booking.n)),
          sql(reservationId),
          sql(booking.pilot),
          sql(booking.instructor),
          sql(booking.aircraft),
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
      sql("N172RB reservation confirmed"),
      sql("Hi Priya Shah, your Bushman Aviation reservation was confirmed for N172RB. This note was recorded by Rampboard. No email provider is connected yet."),
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
