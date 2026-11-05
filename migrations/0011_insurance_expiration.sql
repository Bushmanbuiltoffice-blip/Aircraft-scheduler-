-- When the insurance PDF's policy expiration was read, or entered by the person or an admin.
-- NULL expiration_date means the date is not confirmed. Nothing here invents a date.
-- Existing PDFs have expiration_checked_at NULL, so the next profile or checkout view reads them once.
-- Replacing the PDF clears these columns in the same write as the new file (see the upload code).
ALTER TABLE user_documents ADD COLUMN expiration_date TEXT;
ALTER TABLE user_documents ADD COLUMN expiration_source TEXT
  CHECK (expiration_source IS NULL OR expiration_source IN ('extracted', 'confirmed'));
ALTER TABLE user_documents ADD COLUMN expiration_checked_at TEXT;
