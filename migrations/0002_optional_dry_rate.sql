-- Dry rate is optional. SQLite cannot drop NOT NULL in place, so rebuild the table.
-- Foreign keys are off for this file so the parent table can be replaced.
PRAGMA foreign_keys = OFF;

CREATE TABLE aircraft_new (
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

INSERT INTO aircraft_new (
  id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate,
  status, hobbs, tach, notes, created_at
)
SELECT
  id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate,
  status, hobbs, tach, notes, created_at
FROM aircraft;

DROP TABLE aircraft;

ALTER TABLE aircraft_new RENAME TO aircraft;

PRAGMA foreign_keys = ON;
