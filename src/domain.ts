import type { RateBasis, Role } from "./types";
import { daysBetween } from "./time";

export type CostInput = {
  hobbsOut: number;
  hobbsIn: number;
  tachOut: number | null;
  tachIn: number | null;
  rateBasis: RateBasis;
  wetCents: number;
  dryCents: number | null;
  instructorRateCents: number | null;
};

export type CostValue = {
  hobbsOut: number;
  hobbsIn: number;
  tachOut: number | null;
  tachIn: number | null;
  flightHours: number;
  tachHours: number | null;
  aircraftRateCents: number;
  aircraftCostCents: number;
  instructorRateCents: number;
  instructorHours: number;
  instructorCostCents: number;
  totalCostCents: number;
  rateBasis: RateBasis;
};

export function computeFlightCost(input: CostInput): { ok: true; value: CostValue } | { ok: false; error: string } {
  if (!Number.isFinite(input.hobbsOut) || !Number.isFinite(input.hobbsIn)) {
    return { ok: false, error: "Hobbs readings must be numbers." };
  }
  const hobbsOutTenths = Math.round(input.hobbsOut * 10);
  const hobbsInTenths = Math.round(input.hobbsIn * 10);
  if (hobbsInTenths <= hobbsOutTenths) {
    return { ok: false, error: "Hobbs in must be greater than Hobbs out." };
  }
  let tachOut: number | null = null;
  let tachIn: number | null = null;
  let tachHours: number | null = null;
  if (input.tachOut != null || input.tachIn != null) {
    if (input.tachOut == null || input.tachIn == null) {
      return { ok: false, error: "Enter both tach out and tach in." };
    }
    const tachOutTenths = Math.round(input.tachOut * 10);
    const tachInTenths = Math.round(input.tachIn * 10);
    if (tachInTenths < tachOutTenths) {
      return { ok: false, error: "Tach in cannot be less than tach out." };
    }
    tachOut = tachOutTenths / 10;
    tachIn = tachInTenths / 10;
    tachHours = (tachInTenths - tachOutTenths) / 10;
  }
  const tenths = hobbsInTenths - hobbsOutTenths;
  const flightHours = tenths / 10;
  const aircraftRateCents = input.rateBasis === "wet" ? input.wetCents : input.dryCents;
  if (aircraftRateCents == null) {
    return { ok: false, error: "This aircraft has no dry rate. Add one before checking in a dry flight, or switch the reservation to wet." };
  }
  const aircraftCostCents = Math.round((tenths * aircraftRateCents) / 10);
  const hasInstructor = input.instructorRateCents != null;
  const instructorRateCents = input.instructorRateCents ?? 0;
  const instructorHours = hasInstructor ? flightHours : 0;
  const instructorCostCents = hasInstructor ? Math.round((tenths * instructorRateCents) / 10) : 0;
  return {
    ok: true,
    value: {
      hobbsOut: hobbsOutTenths / 10,
      hobbsIn: hobbsInTenths / 10,
      tachOut,
      tachIn,
      flightHours,
      tachHours,
      aircraftRateCents,
      aircraftCostCents,
      instructorRateCents,
      instructorHours,
      instructorCostCents,
      totalCostCents: aircraftCostCents + instructorCostCents,
      rateBasis: input.rateBasis,
    },
  };
}

export type Eligibility = {
  ok: boolean;
  blocks: string[];
  warnings: string[];
};

export const MEDICAL_WITH_INSTRUCTOR_NOTE = "No current medical, OK with instructor aboard.";

/**
 * A student or renter may fly without a current medical when an instructor is
 * on the booking. Solo flights still need a current medical.
 */
export function medicalWaivedByInstructor(pilotRole: Role, hasInstructor: boolean): boolean {
  return hasInstructor && booksOnlySelf(pilotRole);
}

/** Solo check-out needs the pilot's insurance PDF. An assigned instructor makes the flight dual and skips it. */
export function soloCheckoutNeedsInsurance(instructorId: string | null | undefined): boolean {
  return !instructorId;
}

export function pilotEligibility(input: {
  medicalExpiration: string | null;
  checkout: { status: string; expiresOn: string | null } | null;
  today: string;
  aircraftTail: string;
  /** True when the pilot is a student or renter and an instructor is on the booking. */
  instructorAboard?: boolean;
}): Eligibility {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const medicalProblem = !input.medicalExpiration
    ? "No medical expiration is on file."
    : input.medicalExpiration < input.today
      ? `Medical expired on ${input.medicalExpiration}.`
      : null;
  if (medicalProblem) {
    if (input.instructorAboard) warnings.push(`${MEDICAL_WITH_INSTRUCTOR_NOTE} ${medicalProblem}`);
    else blocks.push(medicalProblem);
  } else if (input.medicalExpiration) {
    const days = daysBetween(input.today, input.medicalExpiration);
    if (days <= 30) {
      warnings.push(`Medical expires in ${days} day${days === 1 ? "" : "s"} (${input.medicalExpiration}).`);
    }
  }
  const checkout = input.checkout;
  if (!checkout || checkout.status !== "current") {
    blocks.push(`Not checked out in ${input.aircraftTail}.`);
  } else if (checkout.expiresOn && checkout.expiresOn < input.today) {
    blocks.push(`Checkout in ${input.aircraftTail} expired on ${checkout.expiresOn}.`);
  } else if (checkout.expiresOn) {
    const days = daysBetween(input.today, checkout.expiresOn);
    if (days <= 30) {
      warnings.push(`Aircraft checkout expires in ${days} day${days === 1 ? "" : "s"} (${checkout.expiresOn}).`);
    }
  }
  return { ok: blocks.length === 0, blocks, warnings };
}

/** Pilots and students book only themselves and need a medical plus a checkout. */
export function booksOnlySelf(role: Role): boolean {
  return role === "renter" || role === "student";
}

export function canBookDespiteEligibility(role: Role, override: boolean): {
  bypassMedical: boolean;
  bypassCheckout: boolean;
} {
  if (role === "admin" && override) return { bypassMedical: true, bypassCheckout: true };
  if (role === "admin" || role === "instructor") return { bypassMedical: false, bypassCheckout: true };
  return { bypassMedical: false, bypassCheckout: false };
}

export function eligibilityAllowsBooking(
  eligibility: Eligibility,
  bypass: { bypassMedical: boolean; bypassCheckout: boolean },
): { ok: boolean; blocks: string[]; warnings: string[] } {
  const blocks = eligibility.blocks.filter((block) => {
    const isCheckout = /checked out|Checkout/i.test(block);
    const isMedical = /[Mm]edical/.test(block);
    if (isCheckout && bypass.bypassCheckout) return false;
    if (isMedical && bypass.bypassMedical) return false;
    return true;
  });
  const warnings = [...eligibility.warnings];
  if (bypass.bypassCheckout) {
    for (const block of eligibility.blocks) {
      if (/checked out|Checkout/i.test(block)) warnings.push(block);
    }
  }
  if (bypass.bypassMedical) {
    for (const block of eligibility.blocks) {
      if (/[Mm]edical/.test(block)) warnings.push(`Override: ${block}`);
    }
  }
  return { ok: blocks.length === 0, blocks, warnings };
}

const MIN_MS = 30 * 60 * 1000;
const MAX_MS = 16 * 60 * 60 * 1000;

export function validateReservationWindow(startsAt: Date, endsAt: Date, now = new Date()): string | null {
  const span = endsAt.getTime() - startsAt.getTime();
  if (span <= 0) return "The end time has to be after the start time.";
  if (span < MIN_MS) return "Reservations must be at least 30 minutes.";
  if (span > MAX_MS) return "Reservations cannot be longer than 16 hours.";
  if (endsAt.getTime() < now.getTime() - 60_000) return "That reservation is already over.";
  return null;
}

/** More than this many hours on one flight (or between the last recorded meter and check-out) gets a warning. */
export const METER_JUMP_WARN_HOURS = 10;

const meterText = (value: number) => value.toFixed(1);

/**
 * Soft checks on Hobbs and tach. These never block a check-out or check-in; they only warn,
 * because a meter can legitimately move (maintenance runs, a swapped meter).
 */
export function meterWarnings(input: {
  stage: "checkout" | "checkin";
  hobbsFrom: number | null;
  hobbsTo: number;
  tachFrom: number | null;
  tachTo: number;
}): string[] {
  const out: string[] = [];
  const pairs: Array<[string, number | null, number]> = [
    ["Hobbs", input.hobbsFrom, input.hobbsTo],
    ["Tach", input.tachFrom, input.tachTo],
  ];
  for (const [name, from, to] of pairs) {
    if (from == null) continue;
    const delta = Math.round((to - from) * 10) / 10;
    if (input.stage === "checkout") {
      if (delta < 0) out.push(`${name} out ${meterText(to)} is lower than the airplane's last recorded ${name.toLowerCase()} ${meterText(from)}. Double-check the meter.`);
      else if (delta > METER_JUMP_WARN_HOURS) out.push(`${name} out ${meterText(to)} is ${meterText(delta)} hours above the last recorded ${meterText(from)}. Was it flown without being logged here?`);
    } else if (delta > METER_JUMP_WARN_HOURS) {
      out.push(`${name} went up ${meterText(delta)} hours on this flight (${meterText(from)} → ${meterText(to)}). Double-check the reading.`);
    }
  }
  return out;
}
