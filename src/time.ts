import { TIME_ZONE } from "./types";

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 21;

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

const partFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function getZonedParts(date: Date, _timeZone = TIME_ZONE): ZonedParts {
  const map: Record<string, string> = {};
  for (const part of partFormat.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = map.hour ?? "00";
  if (hour === "24") hour = "00";
  return {
    year: map.year ?? "1970",
    month: map.month ?? "01",
    day: map.day ?? "01",
    hour,
    minute: map.minute ?? "00",
    second: map.second ?? "00",
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** Interpret a `YYYY-MM-DDTHH:mm` wall time in Pacific Time as a UTC Date. */
export function zonedTimeToUtc(dateTimeLocal: string, timeZone = TIME_ZONE): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal);
  if (!match) throw new Error(`Invalid local time: ${dateTimeLocal}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = new Date(desiredUtc - offsetMs(new Date(desiredUtc), timeZone));
  const adjusted = new Date(desiredUtc - offsetMs(utc, timeZone));
  if (adjusted.getTime() !== utc.getTime()) {
    const retry = new Date(desiredUtc - offsetMs(adjusted, timeZone));
    utc = retry.getTime() === adjusted.getTime() ? adjusted : retry;
  }
  return utc;
}

export function formatDayKey(date: Date, timeZone = TIME_ZONE): string {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayInZone(now = new Date(), timeZone = TIME_ZONE): string {
  return formatDayKey(now, timeZone);
}

export function addDays(day: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Invalid day: ${day}`);
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const date = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${month}-${date}`;
}

export function startOfWeek(day: string, timeZone = TIME_ZONE): string {
  const noon = zonedTimeToUtc(`${day}T12:00`, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(noon);
  const index: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const idx = index[weekday];
  if (idx == null) throw new Error(`Unexpected weekday ${weekday}`);
  return addDays(day, -idx);
}

export function dayRange(day: string, timeZone = TIME_ZONE): { startIso: string; endIso: string } {
  return {
    startIso: zonedTimeToUtc(`${day}T00:00`, timeZone).toISOString(),
    endIso: zonedTimeToUtc(`${addDays(day, 1)}T00:00`, timeZone).toISOString(),
  };
}

export function visibleWindow(day: string, timeZone = TIME_ZONE): { startIso: string; endIso: string } {
  const startHour = String(DAY_START_HOUR).padStart(2, "0");
  const endHour = String(DAY_END_HOUR).padStart(2, "0");
  return {
    startIso: zonedTimeToUtc(`${day}T${startHour}:00`, timeZone).toISOString(),
    endIso: zonedTimeToUtc(`${day}T${endHour}:00`, timeZone).toISOString(),
  };
}

export function monthRange(day: string, timeZone = TIME_ZONE): { startIso: string; endIso: string } {
  const month = day.slice(0, 7);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNum = Number(monthText);
  const next = monthNum === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNum + 1).padStart(2, "0")}-01`;
  return {
    startIso: zonedTimeToUtc(`${month}-01T00:00`, timeZone).toISOString(),
    endIso: zonedTimeToUtc(`${next}T00:00`, timeZone).toISOString(),
  };
}

export function toDateTimeLocalValue(iso: string, timeZone = TIME_ZONE): string {
  const parts = getZonedParts(new Date(iso), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatDayLabel(day: string, timeZone = TIME_ZONE): string {
  const noon = zonedTimeToUtc(`${day}T12:00`, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(noon);
}

export function formatLongDay(day: string, timeZone = TIME_ZONE): string {
  const noon = zonedTimeToUtc(`${day}T12:00`, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(noon);
}

export function formatTime(iso: string, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(isoOrDay: string, timeZone = TIME_ZONE): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDay)) return formatDayLabel(isoOrDay, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoOrDay));
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && endA > startB;
}

export function clipToWindow(
  startIso: string,
  endIso: string,
  windowStartIso: string,
  windowEndIso: string,
): { topPct: number; heightPct: number } | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const windowStart = Date.parse(windowStartIso);
  const windowEnd = Date.parse(windowEndIso);
  if (!(end > windowStart && start < windowEnd)) return null;
  const clippedStart = Math.max(start, windowStart);
  const clippedEnd = Math.min(end, windowEnd);
  const span = windowEnd - windowStart;
  const topPct = ((clippedStart - windowStart) / span) * 100;
  const heightPct = Math.max(((clippedEnd - clippedStart) / span) * 100, 2.2);
  return { topPct, heightPct };
}

export function daysBetween(earlierDay: string, laterDay: string): number {
  const [ay, am, ad] = earlierDay.split("-").map(Number);
  const [by, bm, bd] = laterDay.split("-").map(Number);
  const ms = Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!);
  return Math.round(ms / 86_400_000);
}

export function parseLocalDateTime(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const normalized = trimmed.slice(0, 16);
  const [day, time] = normalized.split("T");
  const [hour, minute] = time!.split(":").map(Number);
  if (hour! > 23 || minute! > 59) return null;
  if (!parseDay(day!)) return null;
  return normalized;
}

export function parseDay(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const [year, month, day] = input.split("-").map(Number);
  const dt = new Date(Date.UTC(year!, month! - 1, day!));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month! - 1 || dt.getUTCDate() !== day) return null;
  return input;
}
