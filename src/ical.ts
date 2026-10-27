import { ORG_NAME } from "./types";

export type IcalEvent = {
  uid: string;
  stamp: string;
  start: string;
  end: string;
  summary: string;
  description?: string;
  status: "CONFIRMED" | "CANCELLED";
};

export function buildIcal(events: IcalEvent[], calendarName: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${ORG_NAME}//Rampboard//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:America/Los_Angeles",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeText(event.uid)}`);
    lines.push(`DTSTAMP:${toIcsUtc(event.stamp)}`);
    lines.push(`DTSTART:${toIcsUtc(event.start)}`);
    lines.push(`DTEND:${toIcsUtc(event.end)}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push(`STATUS:${event.status}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function escapeText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\r\n", "\n").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  let limit = 75;
  while (encoder.encode(rest).length > limit) {
    let end = Math.min(rest.length, limit);
    while (end > 0 && encoder.encode(rest.slice(0, end)).length > limit) end--;
    if (end === 0) break;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
    limit = 74;
  }
  parts.push(rest);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

function toIcsUtc(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
