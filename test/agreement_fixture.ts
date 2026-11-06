import { AGREEMENT_TEXT, AGREEMENT_TEXT_SHA256, AGREEMENT_VERSION } from "../src/agreements/canonical";

/** Test setup only. The app never marks a person signed by itself. */
export async function giveSignedAgreement(db: D1Database, user: { id: string; name: string; email: string | null }): Promise<void> {
  const now = "2026-11-06T12:00:00.000Z";
  await db
    .prepare(
      `INSERT INTO agreement_signatures (
         id, user_id, version_id, terms_sha256, terms_text, account_name, account_email, legal_name,
         age_statement, renter_signed_at, status, guardian_legal_name, guardian_signed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'adult', ?, 'complete', NULL, NULL, ?)`,
    )
    .bind(crypto.randomUUID(), user.id, AGREEMENT_VERSION, AGREEMENT_TEXT_SHA256, AGREEMENT_TEXT, user.name, user.email, `${user.name} Legal`, now, now)
    .run();
}
