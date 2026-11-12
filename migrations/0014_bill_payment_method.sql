-- How an in-app bill was paid. NULL means no cash/check choice has been saved.
-- Existing paid rows are not backfilled: a rental can stay paid with the method unknown.
ALTER TABLE flight_logs ADD COLUMN aircraft_payment_method TEXT;
ALTER TABLE flight_logs ADD COLUMN instructor_payment_method TEXT;
