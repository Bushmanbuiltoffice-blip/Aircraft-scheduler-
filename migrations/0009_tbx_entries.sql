-- TBX (airworthy.com) has no public API for aircraft times, so meters are entered in TBX by hand.
-- Each row records that an admin entered these Hobbs / tach readings into TBX for an airplane.
CREATE TABLE tbx_entries (
  id TEXT PRIMARY KEY,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  hobbs REAL NOT NULL,
  tach REAL NOT NULL,
  entered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  entered_at TEXT NOT NULL
);
CREATE INDEX idx_tbx_aircraft ON tbx_entries(aircraft_id, entered_at);
