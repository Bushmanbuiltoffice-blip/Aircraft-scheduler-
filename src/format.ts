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

/** Ground instruction is stored to the hundredth of an hour. */
export function formatGroundHours(hours: number): string {
  const hundredths = Math.round((hours + Number.EPSILON) * 100);
  return (hundredths / 100).toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

export function roleLabel(role: Role): string {
  if (role === "admin") return "Admin";
  if (role === "instructor") return "Instructor";
  if (role === "student") return "Student";
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
  return `${formatOilAmount(value)} ${unit}`;
}

/** A 172 oil sump is 8 quarts. Two cases is a sensible ceiling for one flight. */
export const MAX_OIL_QUARTS = 24;

/**
 * Blank means not recorded (NULL). 0 means none was added.
 * Up to two decimal places, from 0 through MAX_OIL_QUARTS.
 */
export function parseOilQuarts(input: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter oil in quarts, like 1 or 0.5. Use 0 if none was added. Leave blank if it was not recorded.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > MAX_OIL_QUARTS) {
    return { ok: false, error: `Oil added must be from 0 to ${MAX_OIL_QUARTS} quarts.` };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

export function formatOilAmount(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** NULL is "Not recorded". Zero is an explicit "0 qt" (none added), never a stand-in for unknown. */
export function formatOil(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Not recorded";
  if (value === 0) return "0 qt";
  return `${formatOilAmount(value)} qt`;
}

export function oilInputValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  return formatOilAmount(value);
}

export type OilTally = { recordedQt: number; recordedCount: number; missingCount: number };

/** Sums only recorded amounts. Null entries are counted aside and are not treated as zero. */
export function tallyOil(values: Array<number | null | undefined>): OilTally {
  let recordedQt = 0;
  let recordedCount = 0;
  let missingCount = 0;
  for (const value of values) {
    if (value == null || Number.isNaN(value)) missingCount += 1;
    else {
      recordedCount += 1;
      recordedQt += value;
    }
  }
  return {
    recordedQt: Math.round((recordedQt + Number.EPSILON) * 100) / 100,
    recordedCount,
    missingCount,
  };
}

export function oilTallyText(tally: OilTally): string {
  return quantityTallyText("Oil", "qt", tally.recordedQt, tally.recordedCount, tally.missingCount);
}

/**
 * Input format only. A 172C holds about 42 US gallons, so this ceiling is far
 * above a real fueling and is not a tank-size rule. It rejects values that are
 * not a gallon quantity.
 */
export const MAX_FUEL_GALLONS = 9999.99;

/** Blank means not recorded (NULL). 0 means none was added. Up to two decimal places. */
export function parseFuelGallons(input: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter fuel in gallons, like 12.5 or 0. Use 0 if none was added. Leave blank if it was not recorded.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > MAX_FUEL_GALLONS) {
    return { ok: false, error: `Fuel added must be from 0 to ${MAX_FUEL_GALLONS} gallons.` };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

/** NULL is "Not recorded". Zero is an explicit "0 gal" (none added). */
export function formatFuel(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Not recorded";
  if (value === 0) return "0 gal";
  return `${formatOilAmount(value)} gal`;
}

export function fuelInputValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  return formatOilAmount(value);
}

export type FuelTally = { recordedGal: number; recordedCount: number; missingCount: number };

/** Sums only recorded gallons. Null entries are counted aside and are not treated as zero. */
export function tallyFuel(values: Array<number | null | undefined>): FuelTally {
  let recordedGal = 0;
  let recordedCount = 0;
  let missingCount = 0;
  for (const value of values) {
    if (value == null || Number.isNaN(value)) missingCount += 1;
    else {
      recordedCount += 1;
      recordedGal += value;
    }
  }
  return {
    recordedGal: Math.round((recordedGal + Number.EPSILON) * 100) / 100,
    recordedCount,
    missingCount,
  };
}

export function fuelTallyText(tally: FuelTally): string {
  return quantityTallyText("Fuel", "gal", tally.recordedGal, tally.recordedCount, tally.missingCount);
}

function quantityTallyText(name: string, unit: string, recorded: number, recordedCount: number, missingCount: number): string {
  if (recordedCount === 0 && missingCount === 0) return `${name} on this list: no flights.`;
  const missing = `${missingCount} ${missingCount === 1 ? "flight is" : "flights are"} not recorded and not counted as zero`;
  if (recordedCount === 0) return `${name} on this list: nothing recorded. ${missing}.`;
  const flights = `${recordedCount} ${recordedCount === 1 ? "flight" : "flights"}`;
  const amount = formatQuantity(recorded, unit);
  const line = `${name} on this list: ${amount} on ${flights}.`;
  if (missingCount === 0) return line;
  return `${line} ${missing}.`;
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
