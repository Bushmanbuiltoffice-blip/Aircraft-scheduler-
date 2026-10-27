import { sessionTokenHash } from "./auth";
import type {
  Aircraft,
  AircraftStatus,
  Checkout,
  CheckoutStatus,
  BillingStatus,
  FlightLogView,
  MaintenanceBlock,
  PilotBilling,
  RateBasis,
  Reservation,
  ReservationStatus,
  Role,
  ScheduleEntry,
  User,
} from "./types";

type UserRow = {
  id: string;
  email: string | null;
  password_hash: string;
  name: string;
  role: Role;
  phone: string | null;
  certificate_type: User["certificateType"];
  certificate_number: string | null;
  medical_class: User["medicalClass"];
  medical_expiration: string | null;
  instructor_rate_cents: number | null;
  ical_token: string;
  created_at: string;
  deleted_at: string | null;
};

type AircraftRow = {
  id: string;
  tail_number: string;
  make: string;
  model: string;
  year: number | null;
  hourly_wet_cents: number;
  hourly_dry_cents: number | null;
  default_rate: RateBasis;
  status: AircraftStatus;
  hobbs: number | null;
  tach: number | null;
  notes: string | null;
  created_at: string;
};

type ReservationRow = {
  id: string;
  aircraft_id: string;
  pilot_id: string;
  instructor_id: string | null;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  rate_basis: RateBasis;
  hobbs_out: number | null;
  tach_out: number | null;
  hobbs_in: number | null;
  tach_in: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
};

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    role: row.role,
    phone: row.phone,
    certificateType: row.certificate_type,
    certificateNumber: row.certificate_number,
    medicalClass: row.medical_class,
    medicalExpiration: row.medical_expiration,
    instructorRateCents: row.instructor_rate_cents,
    icalToken: row.ical_token,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? null,
  };
}

export function mapAircraft(row: AircraftRow): Aircraft {
  return {
    id: row.id,
    tailNumber: row.tail_number,
    make: row.make,
    model: row.model,
    year: row.year,
    hourlyWetCents: row.hourly_wet_cents,
    hourlyDryCents: row.hourly_dry_cents,
    defaultRate: row.default_rate,
    status: row.status,
    hobbs: row.hobbs,
    tach: row.tach,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function mapReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    aircraftId: row.aircraft_id,
    pilotId: row.pilot_id,
    instructorId: row.instructor_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    rateBasis: row.rate_basis,
    hobbsOut: row.hobbs_out,
    tachOut: row.tach_out,
    hobbsIn: row.hobbs_in,
    tachIn: row.tach_in,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
  };
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function insertAdminIfNone(db: D1Database, user: NewUser): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO users (
        id, email, password_hash, name, role, phone, certificate_type, certificate_number,
        medical_class, medical_expiration, instructor_rate_cents, ical_token, created_at
      )
      SELECT ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND deleted_at IS NULL)`,
    )
    .bind(
      user.id,
      user.email,
      user.passwordHash,
      user.name,
      user.phone,
      user.certificateType,
      user.certificateNumber,
      user.medicalClass,
      user.medicalExpiration,
      user.instructorRateCents,
      user.icalToken,
      user.createdAt,
    )
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function countAdmins(db: D1Database, exceptId?: string): Promise<number> {
  const row = exceptId
    ? await db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted_at IS NULL AND id != ?")
        .bind(exceptId)
        .first<{ n: number }>()
    : await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted_at IS NULL").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL").bind(email).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function getUserByIcalToken(db: D1Database, token: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE ical_token = ? AND deleted_at IS NULL").bind(token).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY role = 'admin' DESC, role = 'instructor' DESC, name COLLATE NOCASE")
    .all<UserRow>();
  return results.map(mapUser);
}

export async function listInstructors(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT * FROM users WHERE role = 'instructor' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE")
    .all<UserRow>();
  return results.map(mapUser);
}

export type PersonHistory = {
  flightLogCount: number;
  reservationCount: number;
  futureReservationCount: number;
};

/** Counts history used to decide hard vs soft removal. Does not read or write flight log columns besides the count. */
export async function personHistory(db: D1Database, personId: string, nowIso: string): Promise<PersonHistory> {
  const logs = await db
    .prepare("SELECT COUNT(*) AS n FROM flight_logs WHERE pilot_id = ? OR instructor_id = ?")
    .bind(personId, personId)
    .first<{ n: number }>();
  const reservations = await db
    .prepare("SELECT COUNT(*) AS n FROM reservations WHERE pilot_id = ? OR instructor_id = ?")
    .bind(personId, personId)
    .first<{ n: number }>();
  const future = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM reservations
       WHERE status IN ('scheduled', 'checked_out') AND starts_at > ? AND (pilot_id = ? OR instructor_id = ?)`,
    )
    .bind(nowIso, personId, personId)
    .first<{ n: number }>();
  return {
    flightLogCount: Number(logs?.n ?? 0),
    reservationCount: Number(reservations?.n ?? 0),
    futureReservationCount: Number(future?.n ?? 0),
  };
}

/**
 * Remove a person from the active roster.
 * Flight logs are never deleted or updated. A person with any flight log or
 * reservation is soft-deleted (deleted_at) so past logs keep their name.
 * Someone with neither is hard-deleted. Future reservations that have not
 * started are cancelled. Sessions are invalidated.
 */
export async function removePerson(db: D1Database, personId: string, nowIso: string): Promise<"hard" | "soft"> {
  const hard = await db
    .prepare(
      `DELETE FROM users
       WHERE id = ? AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM flight_logs WHERE pilot_id = users.id OR instructor_id = users.id)
         AND NOT EXISTS (SELECT 1 FROM reservations WHERE pilot_id = users.id OR instructor_id = users.id)`,
    )
    .bind(personId)
    .run();
  if (Number(hard.meta.changes ?? 0) > 0) return "hard";
  const note = "Cancelled because this person was removed. Flight logs were not changed.";
  await db.batch([
    db.prepare("UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(nowIso, personId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(personId),
    db
      .prepare(
        `UPDATE reservations
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?,
             notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
         WHERE status IN ('scheduled', 'checked_out') AND starts_at > ? AND (pilot_id = ? OR instructor_id = ?)`,
      )
      .bind(nowIso, nowIso, note, note, nowIso, personId, personId),
  ]);
  return "soft";
}

export type NewUser = {
  id: string;
  email: string | null;
  passwordHash: string;
  name: string;
  role: Role;
  phone: string | null;
  certificateType: User["certificateType"];
  certificateNumber: string | null;
  medicalClass: User["medicalClass"];
  medicalExpiration: string | null;
  instructorRateCents: number | null;
  icalToken: string;
  createdAt: string;
};

export async function insertUser(db: D1Database, user: NewUser): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (
        id, email, password_hash, name, role, phone, certificate_type, certificate_number,
        medical_class, medical_expiration, instructor_rate_cents, ical_token, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      user.id,
      user.email,
      user.passwordHash,
      user.name,
      user.role,
      user.phone,
      user.certificateType,
      user.certificateNumber,
      user.medicalClass,
      user.medicalExpiration,
      user.instructorRateCents,
      user.icalToken,
      user.createdAt,
    )
    .run();
}

export async function updateUser(db: D1Database, user: User): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET
        email = ?, name = ?, role = ?, phone = ?, certificate_type = ?, certificate_number = ?,
        medical_class = ?, medical_expiration = ?, instructor_rate_cents = ?, password_hash = ?, ical_token = ?
      WHERE id = ?`,
    )
    .bind(
      user.email,
      user.name,
      user.role,
      user.phone,
      user.certificateType,
      user.certificateNumber,
      user.medicalClass,
      user.medicalExpiration,
      user.instructorRateCents,
      user.passwordHash,
      user.icalToken,
      user.id,
    )
    .run();
}

export async function createSession(db: D1Database, userId: string, token: string, secret: string, days: number): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  await db
    .prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, await sessionTokenHash(token, secret), expires.toISOString(), now.toISOString())
    .run();
}

export async function deleteSession(db: D1Database, token: string, secret: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sessionTokenHash(token, secret)).run();
}

export async function userForSession(db: D1Database, token: string, secret: string): Promise<User | null> {
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    )
    .bind(await sessionTokenHash(token, secret), new Date().toISOString())
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function listAircraft(db: D1Database): Promise<Aircraft[]> {
  const { results } = await db.prepare("SELECT * FROM aircraft ORDER BY tail_number").all<AircraftRow>();
  return results.map(mapAircraft);
}

export async function getAircraft(db: D1Database, id: string): Promise<Aircraft | null> {
  const row = await db.prepare("SELECT * FROM aircraft WHERE id = ?").bind(id).first<AircraftRow>();
  return row ? mapAircraft(row) : null;
}

export async function insertAircraft(db: D1Database, aircraft: Aircraft): Promise<void> {
  await db
    .prepare(
      `INSERT INTO aircraft (
        id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate,
        status, hobbs, tach, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      aircraft.id,
      aircraft.tailNumber,
      aircraft.make,
      aircraft.model,
      aircraft.year,
      aircraft.hourlyWetCents,
      aircraft.hourlyDryCents,
      aircraft.defaultRate,
      aircraft.status,
      aircraft.hobbs,
      aircraft.tach,
      aircraft.notes,
      aircraft.createdAt,
    )
    .run();
}

export async function updateAircraft(db: D1Database, aircraft: Aircraft): Promise<void> {
  await db
    .prepare(
      `UPDATE aircraft SET
        tail_number = ?, make = ?, model = ?, year = ?, hourly_wet_cents = ?, hourly_dry_cents = ?,
        default_rate = ?, status = ?, hobbs = ?, tach = ?, notes = ?
      WHERE id = ?`,
    )
    .bind(
      aircraft.tailNumber,
      aircraft.make,
      aircraft.model,
      aircraft.year,
      aircraft.hourlyWetCents,
      aircraft.hourlyDryCents,
      aircraft.defaultRate,
      aircraft.status,
      aircraft.hobbs,
      aircraft.tach,
      aircraft.notes,
      aircraft.id,
    )
    .run();
}

export async function setAircraftStatus(db: D1Database, id: string, status: AircraftStatus): Promise<void> {
  await db.prepare("UPDATE aircraft SET status = ? WHERE id = ?").bind(status, id).run();
}

export async function listMaintenance(db: D1Database, fromIso?: string, toIso?: string): Promise<MaintenanceBlock[]> {
  const { results } = fromIso && toIso
    ? await db
        .prepare(
          `SELECT * FROM maintenance_blocks
           WHERE starts_at < ? AND ends_at > ?
           ORDER BY starts_at`,
        )
        .bind(toIso, fromIso)
        .all<MaintenanceRow>()
    : await db.prepare("SELECT * FROM maintenance_blocks ORDER BY starts_at").all<MaintenanceRow>();
  return results.map(mapMaintenance);
}

export async function listMaintenanceForAircraft(db: D1Database, aircraftId: string): Promise<MaintenanceBlock[]> {
  const { results } = await db
    .prepare("SELECT * FROM maintenance_blocks WHERE aircraft_id = ? ORDER BY starts_at DESC")
    .bind(aircraftId)
    .all<MaintenanceRow>();
  return results.map(mapMaintenance);
}

export async function insertMaintenance(db: D1Database, block: MaintenanceBlock): Promise<void> {
  await db
    .prepare(
      `INSERT INTO maintenance_blocks (id, aircraft_id, starts_at, ends_at, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(block.id, block.aircraftId, block.startsAt, block.endsAt, block.reason, block.createdBy, block.createdAt)
    .run();
}

export async function getMaintenance(db: D1Database, id: string): Promise<MaintenanceBlock | null> {
  const row = await db.prepare("SELECT * FROM maintenance_blocks WHERE id = ?").bind(id).first<MaintenanceRow>();
  return row ? mapMaintenance(row) : null;
}

export async function deleteMaintenance(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM maintenance_blocks WHERE id = ?").bind(id).run();
}

type MaintenanceRow = {
  id: string;
  aircraft_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  created_by: string | null;
  created_at: string;
};

function mapMaintenance(row: MaintenanceRow): MaintenanceBlock {
  return {
    id: row.id,
    aircraftId: row.aircraft_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function getCheckout(db: D1Database, userId: string, aircraftId: string): Promise<Checkout | null> {
  const row = await db
    .prepare("SELECT * FROM aircraft_checkouts WHERE user_id = ? AND aircraft_id = ?")
    .bind(userId, aircraftId)
    .first<CheckoutRow>();
  return row ? mapCheckout(row) : null;
}

export async function listCheckoutsForUser(db: D1Database, userId: string): Promise<Checkout[]> {
  const { results } = await db.prepare("SELECT * FROM aircraft_checkouts WHERE user_id = ?").bind(userId).all<CheckoutRow>();
  return results.map(mapCheckout);
}

export async function upsertCheckout(
  db: D1Database,
  checkout: { userId: string; aircraftId: string; status: CheckoutStatus; checkedOutOn: string; expiresOn: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO aircraft_checkouts (id, user_id, aircraft_id, status, checked_out_on, expires_on)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, aircraft_id) DO UPDATE SET
         status = excluded.status,
         checked_out_on = excluded.checked_out_on,
         expires_on = excluded.expires_on`,
    )
    .bind(crypto.randomUUID(), checkout.userId, checkout.aircraftId, checkout.status, checkout.checkedOutOn, checkout.expiresOn)
    .run();
}

export async function deleteCheckout(db: D1Database, userId: string, aircraftId: string): Promise<void> {
  await db.prepare("DELETE FROM aircraft_checkouts WHERE user_id = ? AND aircraft_id = ?").bind(userId, aircraftId).run();
}

type CheckoutRow = {
  id: string;
  user_id: string;
  aircraft_id: string;
  status: CheckoutStatus;
  checked_out_on: string;
  expires_on: string | null;
};

function mapCheckout(row: CheckoutRow): Checkout {
  return {
    id: row.id,
    userId: row.user_id,
    aircraftId: row.aircraft_id,
    status: row.status,
    checkedOutOn: row.checked_out_on,
    expiresOn: row.expires_on,
  };
}

const RESERVATION_JOIN = `
  SELECT r.*, a.tail_number, a.make, a.model,
         p.name AS pilot_name,
         p.role AS pilot_role,
         COALESCE(i.name, f.instructor_name) AS instructor_name
  FROM reservations r
  JOIN aircraft a ON a.id = r.aircraft_id
  JOIN users p ON p.id = r.pilot_id
  LEFT JOIN users i ON i.id = r.instructor_id
  LEFT JOIN flight_logs f ON f.reservation_id = r.id
`;

type ScheduleRow = ReservationRow & {
  tail_number: string;
  make: string;
  model: string;
  pilot_name: string;
  pilot_role: Role;
  instructor_name: string | null;
};

function mapSchedule(row: ScheduleRow): ScheduleEntry {
  return {
    ...mapReservation(row),
    tailNumber: row.tail_number,
    make: row.make,
    model: row.model,
    pilotName: row.pilot_name,
    pilotRole: row.pilot_role,
    instructorName: row.instructor_name,
  };
}

export async function listReservationsOverlapping(db: D1Database, startIso: string, endIso: string): Promise<ScheduleEntry[]> {
  const { results } = await db
    .prepare(`${RESERVATION_JOIN} WHERE r.status != 'cancelled' AND r.starts_at < ? AND r.ends_at > ? ORDER BY r.starts_at`)
    .bind(endIso, startIso)
    .all<ScheduleRow>();
  return results.map(mapSchedule);
}

export async function listUpcoming(db: D1Database, startIso: string, limit = 20): Promise<ScheduleEntry[]> {
  const { results } = await db
    .prepare(
      `${RESERVATION_JOIN}
       WHERE r.status IN ('scheduled', 'checked_out') AND r.starts_at >= ?
       ORDER BY r.starts_at LIMIT ?`,
    )
    .bind(startIso, limit)
    .all<ScheduleRow>();
  return results.map(mapSchedule);
}

export async function listReservationsForUser(db: D1Database, userId: string, startIso: string): Promise<ScheduleEntry[]> {
  const { results } = await db
    .prepare(
      `${RESERVATION_JOIN}
       WHERE r.status != 'cancelled' AND r.ends_at >= ? AND (r.pilot_id = ? OR r.instructor_id = ?)
       ORDER BY r.starts_at LIMIT 30`,
    )
    .bind(startIso, userId, userId)
    .all<ScheduleRow>();
  return results.map(mapSchedule);
}

export async function getScheduleEntry(db: D1Database, id: string): Promise<ScheduleEntry | null> {
  const row = await db.prepare(`${RESERVATION_JOIN} WHERE r.id = ?`).bind(id).first<ScheduleRow>();
  return row ? mapSchedule(row) : null;
}

export async function getReservation(db: D1Database, id: string): Promise<Reservation | null> {
  const row = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first<ReservationRow>();
  return row ? mapReservation(row) : null;
}

export type BookingClash =
  | { type: "missing_aircraft" }
  | { type: "grounded"; tail: string }
  | { type: "maintenance"; tail: string; startsAt: string; endsAt: string; reason: string }
  | { type: "aircraft"; tail: string; startsAt: string; endsAt: string; pilotName: string }
  | { type: "person"; name: string; startsAt: string; endsAt: string; tail: string };

export async function findBookingClash(
  db: D1Database,
  input: {
    aircraftId: string;
    pilotId: string;
    instructorId: string | null;
    startsAt: string;
    endsAt: string;
    excludeId?: string | null;
  },
): Promise<BookingClash | null> {
  const aircraft = await getAircraft(db, input.aircraftId);
  if (!aircraft) return { type: "missing_aircraft" };
  if (aircraft.status === "grounded") return { type: "grounded", tail: aircraft.tailNumber };
  const maintenance = await db
    .prepare(
      `SELECT * FROM maintenance_blocks
       WHERE aircraft_id = ? AND starts_at < ? AND ends_at > ?
       ORDER BY starts_at LIMIT 1`,
    )
    .bind(input.aircraftId, input.endsAt, input.startsAt)
    .first<MaintenanceRow>();
  if (maintenance) {
    return {
      type: "maintenance",
      tail: aircraft.tailNumber,
      startsAt: maintenance.starts_at,
      endsAt: maintenance.ends_at,
      reason: maintenance.reason,
    };
  }
  const aircraftClash = await db
    .prepare(
      `${RESERVATION_JOIN}
       WHERE r.aircraft_id = ? AND r.status != 'cancelled' AND r.starts_at < ? AND r.ends_at > ?
         AND (? IS NULL OR r.id != ?)
       LIMIT 1`,
    )
    .bind(input.aircraftId, input.endsAt, input.startsAt, input.excludeId ?? null, input.excludeId ?? null)
    .first<ScheduleRow>();
  if (aircraftClash) {
    return {
      type: "aircraft",
      tail: aircraftClash.tail_number,
      startsAt: aircraftClash.starts_at,
      endsAt: aircraftClash.ends_at,
      pilotName: aircraftClash.pilot_name,
    };
  }
  const people = [input.pilotId, input.instructorId].filter((id): id is string => Boolean(id));
  const seen = new Set<string>();
  for (const personId of people) {
    if (seen.has(personId)) continue;
    seen.add(personId);
    const clash = await db
      .prepare(
        `${RESERVATION_JOIN}
         WHERE r.status != 'cancelled' AND r.starts_at < ? AND r.ends_at > ?
           AND (r.pilot_id = ? OR r.instructor_id = ?)
           AND (? IS NULL OR r.id != ?)
         LIMIT 1`,
      )
      .bind(input.endsAt, input.startsAt, personId, personId, input.excludeId ?? null, input.excludeId ?? null)
      .first<ScheduleRow>();
    if (clash) {
      const name = clash.pilot_id === personId ? clash.pilot_name : clash.instructor_name || "That person";
      return { type: "person", name, startsAt: clash.starts_at, endsAt: clash.ends_at, tail: clash.tail_number };
    }
  }
  return null;
}

export type ReservationInsert = {
  id: string;
  aircraftId: string;
  pilotId: string;
  instructorId: string | null;
  startsAt: string;
  endsAt: string;
  rateBasis: RateBasis;
  notes: string | null;
  createdBy: string;
  createdAt: string;
};

export async function insertReservationIfFree(db: D1Database, res: ReservationInsert): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO reservations (
         id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis,
         notes, created_by, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM aircraft a WHERE a.id = ? AND a.status = 'available')
         AND NOT EXISTS (
           SELECT 1 FROM maintenance_blocks m
           WHERE m.aircraft_id = ? AND m.starts_at < ? AND m.ends_at > ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.aircraft_id = ? AND r.status != 'cancelled' AND r.starts_at < ? AND r.ends_at > ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.status != 'cancelled' AND r.starts_at < ? AND r.ends_at > ?
             AND (
               r.pilot_id = ? OR r.instructor_id = ?
               OR (? IS NOT NULL AND (r.pilot_id = ? OR r.instructor_id = ?))
             )
         )`,
    )
    .bind(
      res.id,
      res.aircraftId,
      res.pilotId,
      res.instructorId,
      res.startsAt,
      res.endsAt,
      res.rateBasis,
      res.notes,
      res.createdBy,
      res.createdAt,
      res.createdAt,
      res.aircraftId,
      res.aircraftId,
      res.endsAt,
      res.startsAt,
      res.aircraftId,
      res.endsAt,
      res.startsAt,
      res.endsAt,
      res.startsAt,
      res.pilotId,
      res.pilotId,
      res.instructorId,
      res.instructorId,
      res.instructorId,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updateReservationIfFree(
  db: D1Database,
  res: ReservationInsert & { id: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE reservations
       SET aircraft_id = ?, pilot_id = ?, instructor_id = ?, starts_at = ?, ends_at = ?,
           rate_basis = ?, notes = ?, updated_at = ?
       WHERE id = ? AND status = 'scheduled'
         AND EXISTS (SELECT 1 FROM aircraft a WHERE a.id = ? AND a.status = 'available')
         AND NOT EXISTS (
           SELECT 1 FROM maintenance_blocks m
           WHERE m.aircraft_id = ? AND m.starts_at < ? AND m.ends_at > ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.id != ? AND r.aircraft_id = ? AND r.status != 'cancelled'
             AND r.starts_at < ? AND r.ends_at > ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.id != ? AND r.status != 'cancelled' AND r.starts_at < ? AND r.ends_at > ?
             AND (
               r.pilot_id = ? OR r.instructor_id = ?
               OR (? IS NOT NULL AND (r.pilot_id = ? OR r.instructor_id = ?))
             )
         )`,
    )
    .bind(
      res.aircraftId,
      res.pilotId,
      res.instructorId,
      res.startsAt,
      res.endsAt,
      res.rateBasis,
      res.notes,
      res.createdAt,
      res.id,
      res.aircraftId,
      res.aircraftId,
      res.endsAt,
      res.startsAt,
      res.id,
      res.aircraftId,
      res.endsAt,
      res.startsAt,
      res.id,
      res.endsAt,
      res.startsAt,
      res.pilotId,
      res.pilotId,
      res.instructorId,
      res.instructorId,
      res.instructorId,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function checkoutReservation(
  db: D1Database,
  id: string,
  hobbsOut: number,
  tachOut: number,
  nowIso: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE reservations
       SET status = 'checked_out', hobbs_out = ?, tach_out = ?, updated_at = ?
       WHERE id = ? AND status = 'scheduled'`,
    )
    .bind(hobbsOut, tachOut, nowIso, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function cancelReservation(
  db: D1Database,
  id: string,
  notes: string | null,
  nowIso: string,
  allowCheckedOut: boolean,
): Promise<boolean> {
  const statuses = allowCheckedOut ? "('scheduled', 'checked_out')" : "('scheduled')";
  const result = await db
    .prepare(
      `UPDATE reservations
       SET status = 'cancelled', cancelled_at = ?, updated_at = ?, notes = ?
       WHERE id = ? AND status IN ${statuses}`,
    )
    .bind(nowIso, nowIso, notes, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export type FlightLogInsert = {
  id: string;
  reservationId: string;
  pilotId: string;
  instructorId: string | null;
  aircraftId: string;
  hobbsOut: number;
  hobbsIn: number;
  tachOut: number | null;
  tachIn: number | null;
  flightHours: number;
  aircraftRateCents: number;
  aircraftCostCents: number;
  instructorRateCents: number;
  instructorHours: number;
  instructorCostCents: number;
  totalCostCents: number;
  rateBasis: RateBasis;
  createdAt: string;
};

export async function checkInReservation(db: D1Database, log: FlightLogInsert): Promise<boolean> {
  await db.batch([
    db
      .prepare(
        `UPDATE reservations
         SET status = 'checked_in', hobbs_in = ?, tach_in = ?, updated_at = ?
         WHERE id = ? AND status = 'checked_out'`,
      )
      .bind(log.hobbsIn, log.tachIn, log.createdAt, log.reservationId),
    db
      .prepare(
        `INSERT INTO flight_logs (
           id, reservation_id, pilot_id, instructor_id, aircraft_id,
           hobbs_out, hobbs_in, tach_out, tach_in, flight_hours,
           aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents,
           instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM reservations WHERE id = ? AND status = 'checked_in')
           AND NOT EXISTS (SELECT 1 FROM flight_logs WHERE reservation_id = ?)`,
      )
      .bind(
        log.id,
        log.reservationId,
        log.pilotId,
        log.instructorId,
        log.aircraftId,
        log.hobbsOut,
        log.hobbsIn,
        log.tachOut,
        log.tachIn,
        log.flightHours,
        log.aircraftRateCents,
        log.aircraftCostCents,
        log.instructorRateCents,
        log.instructorHours,
        log.instructorCostCents,
        log.totalCostCents,
        log.rateBasis,
        log.createdAt,
        log.reservationId,
        log.reservationId,
      ),
    db
      .prepare(
        `UPDATE aircraft SET hobbs = ?, tach = ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM flight_logs WHERE reservation_id = ?)`,
      )
      .bind(log.hobbsIn, log.tachIn, log.aircraftId, log.reservationId),
  ]);
  const saved = await getFlightLogByReservation(db, log.reservationId);
  return saved != null;
}

const FLIGHT_LOG_SELECT = `
  f.id, f.reservation_id, f.pilot_id, f.instructor_id, f.aircraft_id,
  f.hobbs_out, f.hobbs_in, f.tach_out, f.tach_in, f.flight_hours,
  f.aircraft_rate_cents, f.aircraft_cost_cents, f.instructor_rate_cents,
  f.instructor_hours, f.instructor_cost_cents, f.total_cost_cents, f.rate_basis, f.created_at,
  f.ground_hours, f.aircraft_paid, f.instructor_paid, f.maintenance_flight,
  f.fuel_added_gal, f.oil_added_qt, f.rental_type, f.imported,
  f.instructor_name AS guest_instructor_name, f.billing_status, f.billing_note,
  p.name AS pilot_name, p.role AS pilot_role, i.name AS linked_instructor_name, a.tail_number, a.make, a.model
`;

export async function getFlightLogByReservation(db: D1Database, reservationId: string): Promise<FlightLogView | null> {
  const row = await db
    .prepare(
      `SELECT ${FLIGHT_LOG_SELECT}
       FROM flight_logs f
       JOIN users p ON p.id = f.pilot_id
       LEFT JOIN users i ON i.id = f.instructor_id
       JOIN aircraft a ON a.id = f.aircraft_id
       WHERE f.reservation_id = ?`,
    )
    .bind(reservationId)
    .first<FlightLogRow>();
  return row ? mapFlightLog(row) : null;
}

export async function getFlightLog(db: D1Database, id: string): Promise<FlightLogView | null> {
  const row = await db
    .prepare(
      `SELECT ${FLIGHT_LOG_SELECT}
       FROM flight_logs f
       JOIN users p ON p.id = f.pilot_id
       LEFT JOIN users i ON i.id = f.instructor_id
       JOIN aircraft a ON a.id = f.aircraft_id
       WHERE f.id = ?`,
    )
    .bind(id)
    .first<FlightLogRow>();
  return row ? mapFlightLog(row) : null;
}

export async function listFlightLogs(
  db: D1Database,
  filter: { pilotId?: string | null; instructorOrPilotId?: string | null; limit?: number },
): Promise<FlightLogView[]> {
  const clauses: string[] = [];
  const binds: string[] = [];
  if (filter.pilotId) {
    clauses.push("f.pilot_id = ?");
    binds.push(filter.pilotId);
  }
  if (filter.instructorOrPilotId) {
    clauses.push("(f.pilot_id = ? OR f.instructor_id = ?)");
    binds.push(filter.instructorOrPilotId, filter.instructorOrPilotId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT ${FLIGHT_LOG_SELECT}
       FROM flight_logs f
       JOIN users p ON p.id = f.pilot_id
       LEFT JOIN users i ON i.id = f.instructor_id
       JOIN aircraft a ON a.id = f.aircraft_id
       ${where}
       ORDER BY f.created_at DESC
       LIMIT ?`,
    )
    .bind(...binds, filter.limit ?? 100)
    .all<FlightLogRow>();
  return results.map(mapFlightLog);
}

type FlightLogRow = {
  id: string;
  reservation_id: string;
  pilot_id: string;
  instructor_id: string | null;
  aircraft_id: string;
  hobbs_out: number;
  hobbs_in: number;
  tach_out: number | null;
  tach_in: number | null;
  flight_hours: number;
  aircraft_rate_cents: number;
  aircraft_cost_cents: number;
  instructor_rate_cents: number;
  instructor_hours: number;
  instructor_cost_cents: number;
  total_cost_cents: number;
  rate_basis: RateBasis;
  created_at: string;
  ground_hours: number | null;
  aircraft_paid: number;
  instructor_paid: number;
  maintenance_flight: number;
  fuel_added_gal: number | null;
  oil_added_qt: number | null;
  rental_type: string | null;
  imported: number;
  guest_instructor_name: string | null;
  billing_status: string;
  billing_note: string | null;
  pilot_name: string;
  pilot_role: Role;
  linked_instructor_name: string | null;
  tail_number: string;
  make: string;
  model: string;
};

function mapFlightLog(row: FlightLogRow): FlightLogView {
  const billingStatus: BillingStatus = row.billing_status === "external" ? "external" : "in_app";
  const guestInstructorName = row.guest_instructor_name;
  return {
    id: row.id,
    reservationId: row.reservation_id,
    pilotId: row.pilot_id,
    instructorId: row.instructor_id,
    aircraftId: row.aircraft_id,
    hobbsOut: row.hobbs_out,
    hobbsIn: row.hobbs_in,
    tachOut: row.tach_out,
    tachIn: row.tach_in,
    flightHours: row.flight_hours,
    aircraftRateCents: row.aircraft_rate_cents,
    aircraftCostCents: row.aircraft_cost_cents,
    instructorRateCents: row.instructor_rate_cents,
    instructorHours: row.instructor_hours,
    instructorCostCents: row.instructor_cost_cents,
    totalCostCents: row.total_cost_cents,
    rateBasis: row.rate_basis,
    createdAt: row.created_at,
    groundHours: row.ground_hours,
    aircraftPaid: row.aircraft_paid === 1,
    instructorPaid: row.instructor_paid === 1,
    maintenanceFlight: row.maintenance_flight === 1,
    fuelAddedGal: row.fuel_added_gal,
    oilAddedQt: row.oil_added_qt,
    rentalType: row.rental_type,
    imported: row.imported === 1,
    guestInstructorName,
    billingStatus,
    billingNote: row.billing_note,
    pilotName: row.pilot_name,
    pilotRole: row.pilot_role,
    instructorName: row.linked_instructor_name ?? guestInstructorName,
    tailNumber: row.tail_number,
    make: row.make,
    model: row.model,
  };
}

export async function billingByPilot(db: D1Database): Promise<PilotBilling[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name,
              COUNT(f.id) AS flights,
              COALESCE(SUM(f.flight_hours), 0) AS hours,
              COALESCE(SUM(f.total_cost_cents), 0) AS total_cents
       FROM users u
       JOIN flight_logs f ON f.pilot_id = u.id AND f.billing_status != 'external'
       WHERE u.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY total_cents DESC, u.name`,
    )
    .all<{ id: string; name: string; flights: number; hours: number; total_cents: number }>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    flights: Number(row.flights),
    hours: Number(row.hours),
    totalCents: Number(row.total_cents),
  }));
}

/** Hobbs hours include every logged flight. The flight count and cents are in-app charges only. */
export async function monthTotals(db: D1Database, startIso: string, endIso: string): Promise<{ hours: number; cents: number; flights: number }> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN billing_status = 'external' THEN 0 ELSE 1 END), 0) AS flights,
              COALESCE(SUM(flight_hours), 0) AS hours,
              COALESCE(SUM(CASE WHEN billing_status = 'external' THEN 0 ELSE total_cost_cents END), 0) AS cents
       FROM flight_logs
       WHERE created_at >= ? AND created_at < ?`,
    )
    .bind(startIso, endIso)
    .first<{ flights: number; hours: number; cents: number }>();
  return {
    flights: Number(row?.flights ?? 0),
    hours: Number(row?.hours ?? 0),
    cents: Number(row?.cents ?? 0),
  };
}

export type OutboxRow = { id: string; toEmail: string; subject: string; body: string; createdAt: string };

export async function listOutbox(db: D1Database, limit = 8): Promise<OutboxRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<{ id: string; to_email: string; subject: string; body: string; created_at: string }>();
  return results.map((row) => ({
    id: row.id,
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export function isUniqueError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}
