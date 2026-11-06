-- Ground instruction is charged on the instructor bill only, at the instructor rate saved on that flight.
-- Existing rows stay NULL: ground time was not recorded here, and no ground charge is added until someone enters hours.
-- ground_hours already exists from the flight-log import and is not backfilled.
ALTER TABLE flight_logs ADD COLUMN ground_rate_cents INTEGER;
ALTER TABLE flight_logs ADD COLUMN ground_cost_cents INTEGER;
