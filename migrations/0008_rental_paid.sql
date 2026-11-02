-- Paid / unpaid per rental (flight log). Additive only: existing rows keep their data.
-- New rentals start unpaid. Flights with billing_status 'external' (historical imports billed
-- outside the app) are shown as paid outside the app and never get a toggle; their row is not changed.
ALTER TABLE flight_logs ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flight_logs ADD COLUMN paid_at TEXT;
ALTER TABLE flight_logs ADD COLUMN paid_by TEXT REFERENCES users(id);
CREATE INDEX idx_logs_unpaid ON flight_logs(pilot_id, paid, billing_status);
