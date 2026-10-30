-- Reference documents (POH, checklists, ...) shown on the Resources tab.
-- storage = 'asset': the PDF ships with the app under /docs (served only through the Worker, after sign-in).
-- storage = 'd1':    an admin uploaded the PDF; its bytes live in resource_chunks as base64 text.
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  aircraft_id TEXT REFERENCES aircraft(id) ON DELETE SET NULL,
  notes TEXT,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage TEXT NOT NULL CHECK (storage IN ('asset', 'd1')),
  storage_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_resources_aircraft ON resources(aircraft_id, sort_order, title);

CREATE TABLE resource_chunks (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (resource_id, seq)
);

INSERT INTO resources (id, title, aircraft_id, notes, file_name, content_type, size_bytes, storage, storage_key, sort_order, created_by, created_at)
VALUES (
  'poh-172c-1962',
  'Owner''s Manual (POH), 1962 Cessna 172C',
  (SELECT id FROM aircraft WHERE tail_number = 'N1561Y' LIMIT 1),
  'Cessna Model 172C and Skyhawk 1962 Owner''s Manual (Cessna D124-13), scanned, 72 pages. Reference copy only. The FAA-approved manual stays in the airplane.',
  'cessna-172c-1962-owners-manual.pdf',
  'application/pdf',
  15175749,
  'asset',
  '/docs/cessna-172c-1962-owners-manual.pdf',
  0,
  NULL,
  '2026-10-30T05:30:00.000Z'
);
