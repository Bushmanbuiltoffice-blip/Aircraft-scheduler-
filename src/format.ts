import type { AircraftStatus, RateBasis, ReservationStatus, Role } from "./types";

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
}

export function centsToDollarInput(cents: number): string {
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
