/** Private per-person PDFs. Insurance is the only kind. Not a Resources document. */

import type { Role } from "./types";
import { RESOURCE_CHUNK_BYTES, contentDisposition, isPdf, safePdfName } from "./resources";

export { contentDisposition, isPdf };

export type InsurancePdf = {
  userId: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string | null;
  updatedAt: string;
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
};

function mapInsurance(row: InsuranceRow): InsurancePdf {
  return {
    userId: row.user_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    updatedAt: row.updated_at,
  };
}

export async function getInsurancePdf(db: D1Database, userId: string): Promise<InsurancePdf | null> {
  const row = await db
    .prepare(
      `SELECT user_id, file_name, size_bytes, uploaded_by, updated_at
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

/** Stores or replaces the person's insurance PDF. Does not create a row when there is no file. */
export async function replaceInsurancePdf(
  db: D1Database,
  input: { userId: string; fileName: string; bytes: Uint8Array; uploadedBy: string },
): Promise<void> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO user_documents (user_id, kind, file_name, content_type, size_bytes, uploaded_by, updated_at)
         VALUES (?, 'insurance', ?, 'application/pdf', ?, ?, ?)
         ON CONFLICT(user_id, kind) DO UPDATE SET
           file_name = excluded.file_name,
           content_type = 'application/pdf',
           size_bytes = excluded.size_bytes,
           uploaded_by = excluded.uploaded_by,
           updated_at = excluded.updated_at`,
      )
      .bind(input.userId, safePdfName(input.fileName), input.bytes.length, input.uploadedBy, now),
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
