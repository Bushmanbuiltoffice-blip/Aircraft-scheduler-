-- Single-use invite and password-reset links. Only a SHA-256 hash of the
-- token is stored. Additive only: no existing rows change.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_invites_user ON invites(user_id);
