-- Private insurance PDFs. One optional file per person. No row is inserted here:
-- a person with no upload has no document, which is "nothing on file", not a made-up PDF.
-- Bytes live in user_document_chunks (same chunking idea as Resources) and are served
-- only to that person or an admin. They are not fleet Resources and not public assets.
CREATE TABLE user_documents (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('insurance')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE user_document_chunks (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, seq),
  FOREIGN KEY (user_id, kind) REFERENCES user_documents(user_id, kind) ON DELETE CASCADE
);
