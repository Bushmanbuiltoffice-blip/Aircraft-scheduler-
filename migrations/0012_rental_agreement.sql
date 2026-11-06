-- One signature record per person per agreement version. A new version inserts a new row.
-- Older rows stay. Soft-deleting a person does not delete these rows (no cascade).
-- terms_text is the exact agreement the person signed. The app does not rewrite it later.
CREATE TABLE agreement_signatures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL,
  terms_text TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_email TEXT,
  legal_name TEXT NOT NULL,
  age_statement TEXT NOT NULL CHECK (age_statement IN ('adult', 'minor')),
  renter_signed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_guardian', 'complete')),
  guardian_legal_name TEXT,
  guardian_signed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, version_id)
);
CREATE INDEX idx_agreement_user ON agreement_signatures(user_id, version_id);
