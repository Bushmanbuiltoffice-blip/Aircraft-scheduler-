-- Soft-delete for people, and a Student role.
-- SQLite cannot change a CHECK constraint in place, so users is rebuilt.
-- Bookings, sessions, checkouts, maintenance, and flight logs point at users.
-- Wrangler runs this file inside a transaction where PRAGMA foreign_keys does
-- not let a parent table be dropped. Copy the child tables, drop them, then
-- replace users.
--
-- Flight logs are copied column for column, including the historical import
-- fields from 0004. This migration does not delete or edit a flight log.
-- deleted_at hides a person who still has logs or reservations. The row stays
-- so those logs can keep showing their name.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'instructor', 'renter', 'student')),
  phone TEXT,
  certificate_type TEXT,
  certificate_number TEXT,
  medical_class TEXT,
  medical_expiration TEXT,
  instructor_rate_cents INTEGER,
  ical_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO users_new (
  id, email, password_hash, name, role, phone, certificate_type, certificate_number,
  medical_class, medical_expiration, instructor_rate_cents, ical_token, created_at, deleted_at
)
SELECT
  id, email, password_hash, name, role, phone, certificate_type, certificate_number,
  medical_class, medical_expiration, instructor_rate_cents, ical_token, created_at, NULL
FROM users;

CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO sessions_new (id, user_id, token_hash, expires_at, created_at)
SELECT id, user_id, token_hash, expires_at, created_at FROM sessions;

CREATE TABLE maintenance_blocks_new (
  id TEXT PRIMARY KEY,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users_new(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);

INSERT INTO maintenance_blocks_new (
  id, aircraft_id, starts_at, ends_at, reason, created_by, created_at
)
SELECT id, aircraft_id, starts_at, ends_at, reason, created_by, created_at
FROM maintenance_blocks;

CREATE TABLE aircraft_checkouts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('current', 'expired', 'revoked')),
  checked_out_on TEXT NOT NULL,
  expires_on TEXT,
  UNIQUE (user_id, aircraft_id)
);

INSERT INTO aircraft_checkouts_new (
  id, user_id, aircraft_id, status, checked_out_on, expires_on
)
SELECT id, user_id, aircraft_id, status, checked_out_on, expires_on
FROM aircraft_checkouts;

CREATE TABLE reservations_new (
  id TEXT PRIMARY KEY,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id),
  pilot_id TEXT NOT NULL REFERENCES users_new(id),
  instructor_id TEXT REFERENCES users_new(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'checked_out', 'checked_in', 'cancelled')),
  rate_basis TEXT NOT NULL CHECK (rate_basis IN ('wet', 'dry')),
  hobbs_out REAL,
  tach_out REAL,
  hobbs_in REAL,
  tach_in REAL,
  notes TEXT,
  created_by TEXT REFERENCES users_new(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  CHECK (ends_at > starts_at)
);

INSERT INTO reservations_new (
  id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis,
  hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at, cancelled_at
)
SELECT
  id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis,
  hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at, cancelled_at
FROM reservations;

CREATE TABLE flight_logs_new (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations_new(id),
  pilot_id TEXT NOT NULL REFERENCES users_new(id),
  instructor_id TEXT REFERENCES users_new(id),
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id),
  hobbs_out REAL NOT NULL,
  hobbs_in REAL NOT NULL,
  tach_out REAL,
  tach_in REAL,
  flight_hours REAL NOT NULL,
  aircraft_rate_cents INTEGER NOT NULL,
  aircraft_cost_cents INTEGER NOT NULL,
  instructor_rate_cents INTEGER NOT NULL DEFAULT 0,
  instructor_hours REAL NOT NULL DEFAULT 0,
  instructor_cost_cents INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL,
  rate_basis TEXT NOT NULL CHECK (rate_basis IN ('wet', 'dry')),
  created_at TEXT NOT NULL,
  ground_hours REAL,
  aircraft_paid INTEGER NOT NULL DEFAULT 0,
  instructor_paid INTEGER NOT NULL DEFAULT 0,
  maintenance_flight INTEGER NOT NULL DEFAULT 0,
  fuel_added_gal REAL,
  oil_added_qt REAL,
  rental_type TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  instructor_name TEXT,
  billing_status TEXT NOT NULL DEFAULT 'in_app',
  billing_note TEXT
);

INSERT INTO flight_logs_new (
  id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in,
  tach_out, tach_in, flight_hours, aircraft_rate_cents, aircraft_cost_cents,
  instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents,
  rate_basis, created_at, ground_hours, aircraft_paid, instructor_paid, maintenance_flight,
  fuel_added_gal, oil_added_qt, rental_type, imported, instructor_name, billing_status, billing_note
)
SELECT
  id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in,
  tach_out, tach_in, flight_hours, aircraft_rate_cents, aircraft_cost_cents,
  instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents,
  rate_basis, created_at, ground_hours, aircraft_paid, instructor_paid, maintenance_flight,
  fuel_added_gal, oil_added_qt, rental_type, imported, instructor_name, billing_status, billing_note
FROM flight_logs;

DROP TABLE flight_logs;
DROP TABLE reservations;
DROP TABLE aircraft_checkouts;
DROP TABLE maintenance_blocks;
DROP TABLE sessions;
DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
ALTER TABLE sessions_new RENAME TO sessions;
ALTER TABLE maintenance_blocks_new RENAME TO maintenance_blocks;
ALTER TABLE aircraft_checkouts_new RENAME TO aircraft_checkouts;
ALTER TABLE reservations_new RENAME TO reservations;
ALTER TABLE flight_logs_new RENAME TO flight_logs;

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_maint_aircraft ON maintenance_blocks(aircraft_id, starts_at);
CREATE INDEX idx_res_aircraft ON reservations(aircraft_id, starts_at);
CREATE INDEX idx_res_pilot ON reservations(pilot_id, starts_at);
CREATE INDEX idx_res_instructor ON reservations(instructor_id, starts_at);
CREATE INDEX idx_logs_pilot ON flight_logs(pilot_id, created_at);
CREATE INDEX idx_logs_created ON flight_logs(created_at);
