import type { AircraftStatus, RateBasis, ReservationStatus, Role } from "./types";

export const BILLED_OUTSIDE_LABEL = "Historical import, billed outside app";

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
}

export function centsToDollarInput(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [dollars, fraction = ""] = trimmed.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_00) return null;
  return cents;
}

export function formatMeter(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function parseMeter(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,6}(\.\d)?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 10) / 10;
}

export function formatHours(hours: number): string {
  return (Math.round(hours * 10) / 10).toFixed(1);
}

export function roleLabel(role: Role): string {
  if (role === "admin") return "Admin";
  if (role === "instructor") return "Instructor";
  return "Pilot";
}

export function statusLabel(status: ReservationStatus | AircraftStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "checked_out":
      return "Checked out";
    case "checked_in":
      return "Checked in";
    case "cancelled":
      return "Cancelled";
    case "available":
      return "Available";
    case "grounded":
      return "Grounded";
    default:
      return status;
  }
}

export function rateLabel(basis: RateBasis): string {
  return basis === "wet" ? "Wet" : "Dry";
}

export function paperPaidLabel(input: {
  maintenanceFlight: boolean;
  aircraftPaid: boolean;
  instructorPaid: boolean;
}): string {
  if (input.maintenanceFlight) return "Maintenance";
  const parts: string[] = [];
  if (input.aircraftPaid) parts.push("Aircraft paid");
  if (input.instructorPaid) parts.push("instructor paid");
  return parts.length ? parts.join("; ") : "—";
}

export function formatQuantity(value: number | null | undefined, unit: string): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const text = rounded.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${text} ${unit}`;
}

export function aircraftTitle(make: string, model: string): string {
  return `${make} ${model}`;
}

export function certificateLabel(value: string | null): string {
  if (!value || value === "none") return "Not on file";
  if (value === "atp") return "ATP";
  if (value === "basicmed") return "BasicMed";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function medicalLabel(value: string | null): string {
  if (!value || value === "none") return "None";
  if (value === "basicmed") return "BasicMed";
  if (value === "first") return "1st class";
  if (value === "second") return "2nd class";
  if (value === "third") return "3rd class";
  return value;
}
