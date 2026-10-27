-- Historical flight-log fields. Additive only: existing rows keep working.
-- billing_status 'external' means the flight was already paid outside the app
-- and must stay off in-app balances.

ALTER TABLE flight_logs ADD COLUMN ground_hours REAL;
ALTER TABLE flight_logs ADD COLUMN aircraft_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flight_logs ADD COLUMN instructor_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flight_logs ADD COLUMN maintenance_flight INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flight_logs ADD COLUMN fuel_added_gal REAL;
ALTER TABLE flight_logs ADD COLUMN oil_added_qt REAL;
ALTER TABLE flight_logs ADD COLUMN rental_type TEXT;
ALTER TABLE flight_logs ADD COLUMN imported INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flight_logs ADD COLUMN instructor_name TEXT;
ALTER TABLE flight_logs ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'in_app';
ALTER TABLE flight_logs ADD COLUMN billing_note TEXT;
