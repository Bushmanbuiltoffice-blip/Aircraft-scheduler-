CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'instructor', 'renter')),
  phone TEXT,
  certificate_type TEXT,
  certificate_number TEXT,
  medical_class TEXT,
  medical_expiration TEXT,
  instructor_rate_cents INTEGER,
  ical_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE aircraft (
  id TEXT PRIMARY KEY,
  tail_number TEXT NOT NULL UNIQUE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  hourly_wet_cents INTEGER NOT NULL,
  hourly_dry_cents INTEGER,
  default_rate TEXT NOT NULL CHECK (default_rate IN ('wet', 'dry')),
  status TEXT NOT NULL CHECK (status IN ('available', 'grounded')),
  hobbs REAL,
  tach REAL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE maintenance_blocks (
  id TEXT PRIMARY KEY,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE TABLE aircraft_checkouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('current', 'expired', 'revoked')),
  checked_out_on TEXT NOT NULL,
  expires_on TEXT,
  UNIQUE (user_id, aircraft_id)
);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id),
  pilot_id TEXT NOT NULL REFERENCES users(id),
  instructor_id TEXT REFERENCES users(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'checked_out', 'checked_in', 'cancelled')),
  rate_basis TEXT NOT NULL CHECK (rate_basis IN ('wet', 'dry')),
  hobbs_out REAL,
  tach_out REAL,
  hobbs_in REAL,
  tach_in REAL,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  CHECK (ends_at > starts_at)
);

CREATE TABLE flight_logs (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations(id),
  pilot_id TEXT NOT NULL REFERENCES users(id),
  instructor_id TEXT REFERENCES users(id),
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
  created_at TEXT NOT NULL
);

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_maint_aircraft ON maintenance_blocks(aircraft_id, starts_at);
CREATE INDEX idx_res_aircraft ON reservations(aircraft_id, starts_at);
CREATE INDEX idx_res_pilot ON reservations(pilot_id, starts_at);
CREATE INDEX idx_res_instructor ON reservations(instructor_id, starts_at);
CREATE INDEX idx_logs_pilot ON flight_logs(pilot_id, created_at);
CREATE INDEX idx_logs_created ON flight_logs(created_at);
CREATE INDEX idx_email_created ON email_outbox(created_at);
