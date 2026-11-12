/**
 * Policy expiration from PDF text only. Text inside a PDF is data, not instructions.
 * A date counts only when it is labeled as the expiration or as the end of the policy period.
 */

import { extractPdfText } from "./pdf_text";
import { addDays, daysBetween } from "./time";

export const EXPIRATION_WINDOW_DAYS = 30;

export type ExpirationSource = "extracted" | "confirmed";
export type ExpirationFlag = "expired" | "expiring" | "current" | "unconfirmed";

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const DATE_SRC = `(?:(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})|(${MONTH})\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4}))`;
const DATE_RE = new RegExp(DATE_SRC, "gi");
const LABEL_RE = /(?:expiration(?:\s+date)?|expires|expiry|exp\.?\s*date|valid\s+(?:until|through)|good\s+through|coverage\s+(?:ends|through))\s*[:#]?\s*$/i;
const PERIOD_RE = new RegExp(
  `(?:policy|coverage)\\s+period\\s*[:#]?\\s*${DATE_SRC}\\s*(?:to|through|–|—|-)\\s*${DATE_SRC}`,
  "gi",
);

export type ExtractedExpiration = { outcome: "date"; date: string } | { outcome: "unconfirmed"; partial: boolean };

/** Reads the PDF locally and returns one expiration date, or unconfirmed. Never guesses. */
export async function extractPolicyExpiration(bytes: Uint8Array): Promise<ExtractedExpiration> {
  const parsed = await extractPdfText(bytes);
  const found = expirationFromText(parsed.text);
  if (found) return { outcome: "date", date: found };
  return { outcome: "unconfirmed", partial: parsed.partial || parsed.text.trim().length === 0 };
}

/** Visible text only. Creation dates and unlabeled dates in the file are ignored. */
export function expirationFromText(text: string): string | null {
  DATE_RE.lastIndex = 0;
  PERIOD_RE.lastIndex = 0;
  const hits = new Set<string>();
  for (const match of text.matchAll(DATE_RE)) {
    const date = dateFromMatch(match);
    if (!date) continue;
    const prefix = text.slice(Math.max(0, match.index - 60), match.index).replace(/\s+/g, " ");
    if (LABEL_RE.test(prefix)) hits.add(date);
  }
  for (const match of text.matchAll(PERIOD_RE)) {
    const end = namedGroupsEnd(match);
    if (end) hits.add(end);
  }
  if (hits.size !== 1) return null;
  return [...hits][0] ?? null;
}

/**
 * The expiration calendar date is covered through the end of that Pacific day.
 * The next Pacific date is expired. Today through 30 days ahead is expiring.
 */
export function classifyExpiration(date: string | null, today: string): { flag: ExpirationFlag; daysUntil: number | null } {
  if (!date) return { flag: "unconfirmed", daysUntil: null };
  if (date < today) return { flag: "expired", daysUntil: daysBetween(today, date) };
  const daysUntil = daysBetween(today, date);
  if (daysUntil <= EXPIRATION_WINDOW_DAYS) return { flag: "expiring", daysUntil };
  return { flag: "current", daysUntil };
}

export function insuranceListLabel(date: string | null, today: string): string {
  const { flag, daysUntil } = classifyExpiration(date, today);
  if (flag === "expired") return "Expired";
  if (flag === "expiring" && daysUntil === 0) return "Expires today";
  if (flag === "expiring") return `Expires in ${daysUntil} days`;
  if (flag === "unconfirmed") return "Date not confirmed";
  return "On file";
}

export function insuranceFlagMessage(input: {
  pilotName: string;
  date: string | null;
  source: ExpirationSource | null;
  today: string;
}): string {
  const { flag, daysUntil } = classifyExpiration(input.date, input.today);
  if (flag === "unconfirmed") {
    return "Expiration not confirmed. The PDF did not contain one clear policy expiration date. A scanned page is not read here, and the file is not sent anywhere else.";
  }
  const source = input.source === "confirmed" ? "entered on the profile" : "read from the PDF";
  const date = input.date ?? "";
  if (flag === "expired") {
    return `${input.pilotName}'s insurance expiration ${date} has passed (${source}). Pacific Time keeps that date covered through the end of the day and treats the next day as expired. This is a warning.`;
  }
  if (flag === "expiring" && daysUntil === 0) {
    return `${input.pilotName}'s insurance expiration ${date} is today (${source}). It is covered through today, Pacific Time.`;
  }
  if (flag === "expiring") {
    return `${input.pilotName}'s insurance expiration ${date} is in ${daysUntil} days (${source}), through that Pacific date.`;
  }
  return `${input.pilotName}'s insurance expiration ${date} (${source}).`;
}

export function windowEnd(today: string): string {
  return addDays(today, EXPIRATION_WINDOW_DAYS);
}

function namedGroupsEnd(match: RegExpMatchArray): string | null {
  // The period regex repeats DATE_SRC. The end date is the second copy, so it
  // occupies the second half of the capture list. Re-parse the matched text's end token.
  const text = match[0] ?? "";
  const dates = [...text.matchAll(new RegExp(DATE_SRC, "gi"))].map(dateFromMatch).filter((item): item is string => Boolean(item));
  return dates.length >= 2 ? dates[dates.length - 1] ?? null : null;
}

function dateFromMatch(match: RegExpMatchArray): string | null {
  const parts = match.slice(1);
  if (parts[0] && parts[1] && parts[2]) return iso(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  if (parts[3] && parts[4] && parts[5]) return iso(Number(parts[5]), Number(parts[3]), Number(parts[4]));
  if (parts[6] && parts[7] && parts[8]) return iso(Number(parts[8]), MONTHS[parts[6].toLowerCase()] ?? 0, Number(parts[7]));
  if (parts[9] && parts[10] && parts[11]) return iso(Number(parts[11]), MONTHS[parts[10].toLowerCase()] ?? 0, Number(parts[9]));
  return null;
}

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
