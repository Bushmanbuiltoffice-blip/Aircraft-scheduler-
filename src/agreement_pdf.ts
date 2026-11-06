/** Builds a PDF whose words are the canonical agreement plus this signing record. Not a SignWell document. */

import { AGREEMENT_TEXT } from "./agreements/canonical";
import type { AgreementRecord } from "./agreement";

const MINOR_CLAUSE = "*If renter is a minor a parent or legal guardian must also sign.";
const SIGNATURE_MARK = "\nName: _______________________________    Renter\n";

const WIN: Record<number, number> = {
  0x2013: 0x96,
  0x2014: 0x97,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
};

export const ESIGN_STATEMENT =
  "I agree to sign this agreement electronically. My typed full legal name is my signature. This record was stored by the Firehound Rental scheduling application. It is not a SignWell signature and is not certified by SignWell or any other e-sign vendor.";

export function agreementBodyBeforeSignatures(terms: string = AGREEMENT_TEXT): string {
  const at = terms.indexOf(SIGNATURE_MARK);
  if (at < 0 || !terms.includes(MINOR_CLAUSE)) {
    throw new Error("Canonical agreement signature section was not found.");
  }
  return terms.slice(0, at);
}

export function signedAgreementDocument(record: AgreementRecord): string {
  const guardian = record.guardianLegalName && record.guardianSignedAt
    ? [
        `Name: ${record.guardianLegalName}    Parent / Legal Guardian`,
        `Electronic signature: ${record.guardianLegalName}`,
        `Date: ${record.guardianSignedAt}    Parent / Legal Guardian`,
        "The parent or legal guardian typed this name in a separate signature action and confirmed they are the parent or legal guardian and agree to this agreement.",
      ].join("\n")
    : "No parent or legal guardian signature was recorded. The renter stated they are 18 or older. The renter's own name and checkbox are not parent consent.";
  return [
    agreementBodyBeforeSignatures(record.termsText),
    `Name: ${record.legalName}    Renter`,
    `Electronic signature: ${record.legalName}`,
    `Date: ${record.renterSignedAt}    Renter`,
    `Account: ${record.accountName}${record.accountEmail ? ` <${record.accountEmail}>` : ""}`,
    `User id: ${record.userId}`,
    ESIGN_STATEMENT,
    "",
    MINOR_CLAUSE,
    "",
    guardian,
    "",
    `Agreement version: ${record.versionId}`,
    `Terms SHA-256: ${record.termsSha256}`,
    "",
  ].join("\n");
}

export function buildTextPdf(text: string): Uint8Array {
  const pages = paginate(wrap(text));
  const objects: string[] = [];
  const pageIds: number[] = [];
  let next = 3;
  const fontId = 3 + pages.length * 2;
  for (const lines of pages) {
    const pageId = next;
    const contentId = next + 1;
    next += 2;
    pageIds.push(pageId);
    objects[contentId] = streamObject(lines);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  const count = fontId;
  for (let id = 1; id <= count; id += 1) {
    offsets[id] = chunks.join("").length;
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const startxref = chunks.join("").length;
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= count; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  chunks.push(xref);
  chunks.push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);
  return new TextEncoder().encode(chunks.join(""));
}

function streamObject(lines: string[]): string {
  const commands = ["BT", "/F1 9 Tf", "54 760 Td", "11 TL"];
  for (const line of lines) commands.push(`(${pdfEscape(line)}) Tj`, "T*");
  commands.push("ET");
  const body = commands.join("\n");
  return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
}

function paginate(lines: string[]): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 58) pages.push(lines.slice(i, i + 58));
  return pages.length ? pages : [[""]];
}

function wrap(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let rest = paragraph;
    while (rest.length > 92) {
      let cut = rest.lastIndexOf(" ", 92);
      if (cut < 40) cut = 92;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}

function pdfEscape(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const byte = code < 128 ? code : WIN[code];
    if (byte == null) throw new Error(`Agreement text has a character this PDF font cannot store: U+${code.toString(16)}`);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}
