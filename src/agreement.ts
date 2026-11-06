/** Rental-agreement signatures. A person signs only their own current version. Old rows are kept. */

import {
  AGREEMENT_PDF_BASE64,
  AGREEMENT_TEXT,
  AGREEMENT_TEXT_SHA256,
  AGREEMENT_VERSION,
} from "./agreements/canonical";
import { buildTextPdf, signedAgreementDocument } from "./agreement_pdf";

export const AGREEMENT_ACK =
  "I HAVE READ AND I UNDERSTAND THE ABOVE COVENANTS, RESTRICTIONS AND REQUIREMENTS OF THE RENTAL AGREEMENT. I ACKNOWLEDGE THAT I HAVE RECEIVED A COPY OF THIS AGREEMENT.";

export type AgreementStatus = "missing" | "awaiting_guardian" | "complete";

export type AgreementRecord = {
  id: string;
  userId: string;
  versionId: string;
  termsSha256: string;
  termsText: string;
  accountName: string;
  accountEmail: string | null;
  legalName: string;
  ageStatement: "adult" | "minor";
  renterSignedAt: string;
  status: "awaiting_guardian" | "complete";
  guardianLegalName: string | null;
  guardianSignedAt: string | null;
};

type Row = {
  id: string;
  user_id: string;
  version_id: string;
  terms_sha256: string;
  terms_text: string;
  account_name: string;
  account_email: string | null;
  legal_name: string;
  age_statement: "adult" | "minor";
  renter_signed_at: string;
  status: "awaiting_guardian" | "complete";
  guardian_legal_name: string | null;
  guardian_signed_at: string | null;
};

function mapRow(row: Row): AgreementRecord {
  return {
    id: row.id,
    userId: row.user_id,
    versionId: row.version_id,
    termsSha256: row.terms_sha256,
    termsText: row.terms_text,
    accountName: row.account_name,
    accountEmail: row.account_email,
    legalName: row.legal_name,
    ageStatement: row.age_statement,
    renterSignedAt: row.renter_signed_at,
    status: row.status,
    guardianLegalName: row.guardian_legal_name,
    guardianSignedAt: row.guardian_signed_at,
  };
}

export function currentAgreementMatches(record: AgreementRecord | null): record is AgreementRecord {
  return !!record
    && record.versionId === AGREEMENT_VERSION
    && record.termsSha256 === AGREEMENT_TEXT_SHA256
    && record.termsText === AGREEMENT_TEXT;
}

export function agreementStatus(record: AgreementRecord | null): AgreementStatus {
  if (!currentAgreementMatches(record)) return "missing";
  return record.status === "complete" ? "complete" : "awaiting_guardian";
}

export function agreementAllowsCheckout(record: AgreementRecord | null): boolean {
  return agreementStatus(record) === "complete";
}

export function agreementCheckoutMessage(pilotName: string, status: AgreementStatus): string {
  if (status === "awaiting_guardian") {
    return `${pilotName} signed the rental agreement, and it is not complete. A parent or legal guardian must sign separately. The renter's name is not parent consent. Check-out stays blocked.`;
  }
  return `${pilotName} has not signed the current Fire Hound Rental aircraft rental agreement. Check-out stays blocked until they sign it.`;
}

export function canonicalAgreementPdf(): Uint8Array {
  const binary = atob(AGREEMENT_PDF_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function signedAgreementPdf(record: AgreementRecord): Uint8Array {
  return buildTextPdf(signedAgreementDocument(record));
}

export async function getAgreement(db: D1Database, userId: string): Promise<AgreementRecord | null> {
  const row = await db
    .prepare("SELECT * FROM agreement_signatures WHERE user_id = ? AND version_id = ?")
    .bind(userId, AGREEMENT_VERSION)
    .first<Row>();
  return row ? mapRow(row) : null;
}

export async function agreementLabels(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare("SELECT user_id, status, terms_sha256, terms_text FROM agreement_signatures WHERE version_id = ?")
    .bind(AGREEMENT_VERSION)
    .all<{ user_id: string; status: string; terms_sha256: string; terms_text: string }>();
  const labels = new Map<string, string>();
  for (const row of results) {
    if (row.terms_sha256 !== AGREEMENT_TEXT_SHA256 || row.terms_text !== AGREEMENT_TEXT) continue;
    labels.set(row.user_id, row.status === "complete" ? "Signed" : "Guardian must sign");
  }
  return labels;
}

export type SignInput = {
  userId: string;
  accountName: string;
  accountEmail: string | null;
  legalName: string;
  ageStatement: "adult" | "minor";
  nowIso: string;
};

export type SignResult = { ok: true; record: AgreementRecord; already: boolean } | { ok: false; error: string };

export async function signAgreement(db: D1Database, input: SignInput): Promise<SignResult> {
  const legalName = input.legalName.trim().replace(/\s+/g, " ");
  if (legalName.length < 3 || !legalName.includes(" ")) {
    return { ok: false, error: "Type your full legal name, first and last." };
  }
  const existing = await getAgreement(db, input.userId);
  if (existing && !currentAgreementMatches(existing)) {
    return { ok: false, error: "A signature for this version is already stored and was not replaced." };
  }
  if (existing) return { ok: true, record: existing, already: true };
  const id = crypto.randomUUID();
  const status = input.ageStatement === "minor" ? "awaiting_guardian" : "complete";
  await db
    .prepare(
      `INSERT INTO agreement_signatures (
         id, user_id, version_id, terms_sha256, terms_text, account_name, account_email, legal_name,
         age_statement, renter_signed_at, status, guardian_legal_name, guardian_signed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .bind(
      id,
      input.userId,
      AGREEMENT_VERSION,
      AGREEMENT_TEXT_SHA256,
      AGREEMENT_TEXT,
      input.accountName,
      input.accountEmail,
      legalName,
      input.ageStatement,
      input.nowIso,
      status,
      input.nowIso,
    )
    .run();
  const record = await getAgreement(db, input.userId);
  if (!record) return { ok: false, error: "The signature could not be saved." };
  return { ok: true, record, already: false };
}

export async function signAsGuardian(
  db: D1Database,
  input: { userId: string; guardianLegalName: string; nowIso: string },
): Promise<SignResult> {
  const name = input.guardianLegalName.trim().replace(/\s+/g, " ");
  if (name.length < 3 || !name.includes(" ")) {
    return { ok: false, error: "Type the parent or legal guardian's full legal name." };
  }
  const existing = await getAgreement(db, input.userId);
  if (!existing || !currentAgreementMatches(existing)) {
    return { ok: false, error: "The renter has not signed this agreement yet." };
  }
  if (existing.status === "complete" && existing.ageStatement === "adult") {
    return { ok: false, error: "This signer stated they are 18 or older. A guardian signature was not requested." };
  }
  if (existing.status === "complete" && existing.guardianSignedAt) {
    return { ok: true, record: existing, already: true };
  }
  await db
    .prepare(
      `UPDATE agreement_signatures
       SET guardian_legal_name = ?, guardian_signed_at = ?, status = 'complete'
       WHERE id = ? AND status = 'awaiting_guardian' AND legal_name = ? AND renter_signed_at = ?`,
    )
    .bind(name, input.nowIso, existing.id, existing.legalName, existing.renterSignedAt)
    .run();
  const record = await getAgreement(db, input.userId);
  if (!record || record.status !== "complete" || record.guardianLegalName !== name) {
    return { ok: false, error: "The guardian signature could not be saved." };
  }
  if (record.legalName !== existing.legalName || record.renterSignedAt !== existing.renterSignedAt) {
    return { ok: false, error: "The renter signature was left unchanged." };
  }
  return { ok: true, record, already: false };
}
