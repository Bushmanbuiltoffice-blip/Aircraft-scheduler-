/** Private per-person PDFs. Insurance is the only kind. Not a Resources document. */

import { extractPolicyExpiration } from "./policy_expiration";
import type { ExpirationSource } from "./policy_expiration";
import type { Role } from "./types";
import { RESOURCE_CHUNK_BYTES, contentDisposition, isPdf, safePdfName } from "./resources";

export { contentDisposition, isPdf };

export type InsurancePdf = {
  userId: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string | null;
  updatedAt: string;
  /** Pacific calendar date, or null when the date is not confirmed. */
  expirationDate: string | null;
  expirationSource: ExpirationSource | null;
  expirationCheckedAt: string | null;
};

/** The person themselves, or an admin managing their record. Instructors are not included. */
export function canManageInsurancePdf(actor: { id: string; role: Role }, subjectUserId: string): boolean {
  return actor.role === "admin" || actor.id === subjectUserId;
}

type InsuranceRow = {
  user_id: string;
  file_name: string;
  size_bytes: number;
  uploaded_by: string | null;
  updated_at: string;
  expiration_date: string | null;
  expiration_source: string | null;
  expiration_checked_at: string | null;
};

function mapInsurance(row: InsuranceRow): InsurancePdf {
  const source = row.expiration_source === "extracted" || row.expiration_source === "confirmed" ? row.expiration_source : null;
  return {
    userId: row.user_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    updatedAt: row.updated_at,
    expirationDate: row.expiration_date,
    expirationSource: source,
    expirationCheckedAt: row.expiration_checked_at,
  };
}

const INSURANCE_COLUMNS = `user_id, file_name, size_bytes, uploaded_by, updated_at, expiration_date, expiration_source, expiration_checked_at`;

export async function getInsurancePdf(db: D1Database, userId: string): Promise<InsurancePdf | null> {
  const row = await db
    .prepare(
      `SELECT ${INSURANCE_COLUMNS}
       FROM user_documents WHERE user_id = ? AND kind = 'insurance'`,
    )
    .bind(userId)
    .first<InsuranceRow>();
  return row ? mapInsurance(row) : null;
}

/** User ids that actually have an uploaded insurance PDF. Everyone else is empty. */
export async function insuranceUserIds(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT user_id FROM user_documents WHERE kind = 'insurance'").all<{ user_id: string }>();
  return new Set(results.map((row) => row.user_id));
}

type Base64Bytes = Uint8Array & { toBase64(): string };
type Base64Ctor = { fromBase64(text: string): Uint8Array };

function toBase64(bytes: Uint8Array): string {
  return (bytes as Base64Bytes).toBase64();
}

function fromBase64(text: string): Uint8Array {
  return (Uint8Array as unknown as Base64Ctor).fromBase64(text);
}

/** Stores or replaces the person's insurance PDF and reads its expiration again. The previous date is not kept. */
export async function replaceInsurancePdf(
  db: D1Database,
  input: { userId: string; fileName: string; bytes: Uint8Array; uploadedBy: string },
): Promise<void> {
  const now = new Date().toISOString();
  const extracted = await extractPolicyExpiration(input.bytes);
  const expirationDate = extracted.outcome === "date" ? extracted.date : null;
  const expirationSource = extracted.outcome === "date" ? "extracted" : null;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO user_documents (
           user_id, kind, file_name, content_type, size_bytes, uploaded_by, updated_at,
           expiration_date, expiration_source, expiration_checked_at
         )
         VALUES (?, 'insurance', ?, 'application/pdf', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, kind) DO UPDATE SET
           file_name = excluded.file_name,
           content_type = 'application/pdf',
           size_bytes = excluded.size_bytes,
           uploaded_by = excluded.uploaded_by,
           updated_at = excluded.updated_at,
           expiration_date = excluded.expiration_date,
           expiration_source = excluded.expiration_source,
           expiration_checked_at = excluded.expiration_checked_at`,
      )
      .bind(
        input.userId,
        safePdfName(input.fileName),
        input.bytes.length,
        input.uploadedBy,
        now,
        expirationDate,
        expirationSource,
        now,
      ),
    db.prepare("DELETE FROM user_document_chunks WHERE user_id = ? AND kind = 'insurance'").bind(input.userId),
  ];
  for (let seq = 0, offset = 0; offset < input.bytes.length; seq += 1, offset += RESOURCE_CHUNK_BYTES) {
    const chunk = input.bytes.subarray(offset, offset + RESOURCE_CHUNK_BYTES);
    statements.push(
      db
        .prepare("INSERT INTO user_document_chunks (user_id, kind, seq, data) VALUES (?, 'insurance', ?, ?)")
        .bind(input.userId, seq, toBase64(chunk)),
    );
  }
  await db.batch(statements);
}

/** Reads a PDF that was uploaded before expiration tracking, once. A confirmed date is left alone. */
export async function ensureInsuranceExpiration(db: D1Database, userId: string): Promise<InsurancePdf | null> {
  const current = await getInsurancePdf(db, userId);
  if (!current || current.expirationCheckedAt) return current;
  await rereadInsuranceExpiration(db, userId);
  return getInsurancePdf(db, userId);
}

/** Reads every unchecked insurance PDF. Safe to call when showing the people list. */
export async function ensureUncheckedInsurance(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare("SELECT user_id FROM user_documents WHERE kind = 'insurance' AND expiration_checked_at IS NULL")
    .all<{ user_id: string }>();
  for (const row of results) await ensureInsuranceExpiration(db, row.user_id);
}

/** Runs extraction again and replaces any previous date, including a hand-entered one. */
export async function rereadInsuranceExpiration(db: D1Database, userId: string): Promise<boolean> {
  const bytes = await loadInsuranceBytes(db, userId);
  if (!bytes) return false;
  const extracted = await extractPolicyExpiration(bytes);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE user_documents
       SET expiration_date = ?, expiration_source = ?, expiration_checked_at = ?
       WHERE user_id = ? AND kind = 'insurance'`,
    )
    .bind(extracted.outcome === "date" ? extracted.date : null, extracted.outcome === "date" ? "extracted" : null, now, userId)
    .run();
  return true;
}

/** The person or an admin sets the expiration, or clears it. Does not change the PDF bytes. */
export async function confirmInsuranceExpiration(db: D1Database, userId: string, date: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE user_documents
       SET expiration_date = ?, expiration_source = ?, expiration_checked_at = ?
       WHERE user_id = ? AND kind = 'insurance'`,
    )
    .bind(date, date ? "confirmed" : null, now, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

async function loadInsuranceBytes(db: D1Database, userId: string): Promise<Uint8Array | null> {
  const { results } = await db
    .prepare("SELECT data FROM user_document_chunks WHERE user_id = ? AND kind = 'insurance' ORDER BY seq")
    .bind(userId)
    .all<{ data: string }>();
  if (!results.length) return null;
  const parts = results.map((row) => fromBase64(row.data));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Streams the private PDF. Call only after an auth check. */
export function streamInsurancePdf(db: D1Database, userId: string): ReadableStream<Uint8Array> {
  let next = 0;
  let pending: Uint8Array[] = [];
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!pending.length && !done) {
        const { results } = await db
          .prepare(
            `SELECT seq, data FROM user_document_chunks
             WHERE user_id = ? AND kind = 'insurance' AND seq >= ?
             ORDER BY seq LIMIT 4`,
          )
          .bind(userId, next)
          .all<{ seq: number; data: string }>();
        if (!results.length) done = true;
        for (const row of results) {
          pending.push(fromBase64(row.data));
          next = row.seq + 1;
        }
      }
      const chunk = pending.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
}
