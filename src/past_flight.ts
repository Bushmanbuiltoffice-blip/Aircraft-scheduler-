import { groundInstructionCents, parseGroundHours } from "./bills";
import { parseFuelGallons, parseMeter, parseOilQuarts } from "./format";
import { addDays, addMinutesLocal, parseDay, zonedTimeToUtc } from "./time";

export const PREFERRED_TAIL = "N1561Y";
export const OUTSIDE_BILLING_NOTE = "Already settled outside the app. No new bill is created.";

export type PastBilling = "in_app" | "external";

export type PastFlightForm = {
  flightDate: string;
  aircraftId: string;
  pilotId: string;
  instructorId: string;
  hobbsOut: string;
  hobbsIn: string;
  tachOut: string;
  tachIn: string;
  groundHours: string;
  fuelAddedGal: string;
  oilAddedQt: string;
  notes: string;
  billing: string;
};

export type PastFlightDraft = {
  day: string;
  startsAt: string;
  endsAt: string;
  dayStartIso: string;
  dayEndIso: string;
  aircraftId: string;
  pilotId: string;
  instructorId: string | null;
  hobbsOut: number;
  hobbsIn: number;
  tachOut: number;
  tachIn: number;
  flightHours: number;
  aircraftRateCents: number;
  aircraftCostCents: number;
  instructorRateCents: number;
  instructorHours: number;
  instructorCostCents: number;
  groundHours: number | null;
  groundRateCents: number | null;
  groundCostCents: number | null;
  totalCostCents: number;
  oilAddedQt: number | null;
  fuelAddedGal: number | null;
  notes: string | null;
  billingStatus: PastBilling;
  billingNote: string | null;
};

export function emptyPastFlightForm(aircraftId = ""): PastFlightForm {
  return {
    flightDate: "",
    aircraftId,
    pilotId: "",
    instructorId: "",
    hobbsOut: "",
    hobbsIn: "",
    tachOut: "",
    tachIn: "",
    groundHours: "",
    fuelAddedGal: "",
    oilAddedQt: "",
    notes: "",
    billing: "",
  };
}

export function preferredAircraftId(aircraft: Array<{ id: string; tailNumber: string }>): string {
  return aircraft.find((item) => item.tailNumber === PREFERRED_TAIL)?.id ?? aircraft[0]?.id ?? "";
}

function tenths(value: number): number {
  return Math.round(value * 10);
}

/**
 * Turns the admin form into a completed flight.
 * Hobbs and tach in may equal out. A future date is rejected. Billing must be chosen.
 * Charges use the airplane's wet rate and, when an instructor is chosen, that person's rate.
 */
export function parsePastFlight(
  form: PastFlightForm,
  ctx: {
    today: string;
    aircraft: { id: string; hourlyWetCents: number } | null;
    pilot: { id: string } | null;
    instructor: { id: string; instructorRateCents: number | null } | null;
    instructorWasChosen: boolean;
  },
): { ok: true; value: PastFlightDraft } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const day = parseDay(form.flightDate);
  if (!day) errors.push("Choose the date of the flight.");
  else if (day > ctx.today) errors.push("That date is in the future. A past flight has to be today or earlier.");
  if (!ctx.aircraft) errors.push("Choose an aircraft.");
  if (!ctx.pilot) errors.push("Choose a pilot.");
  if (ctx.instructorWasChosen && !ctx.instructor) errors.push("Choose an instructor from the list, or leave the flight solo.");
  if (ctx.pilot && ctx.instructor && ctx.pilot.id === ctx.instructor.id) {
    errors.push("The instructor and the pilot have to be different people.");
  }
  const hobbsOut = parseMeter(form.hobbsOut);
  const hobbsIn = parseMeter(form.hobbsIn);
  if (hobbsOut == null || hobbsIn == null) errors.push("Enter Hobbs out and Hobbs in with at most one decimal.");
  else if (hobbsIn < hobbsOut) errors.push("Hobbs in cannot be less than Hobbs out.");
  const tachOut = parseMeter(form.tachOut);
  const tachIn = parseMeter(form.tachIn);
  if (tachOut == null || tachIn == null) errors.push("Enter tach out and tach in with at most one decimal.");
  else if (tachIn < tachOut) errors.push("Tach in cannot be less than tach out.");
  const ground = parseGroundHours(form.groundHours);
  if (!ground.ok) errors.push(ground.error);
  else if (ground.value != null && !ctx.instructor) errors.push("Ground instruction needs an instructor on the flight.");
  const oil = parseOilQuarts(form.oilAddedQt);
  if (!oil.ok) errors.push(oil.error);
  const fuel = parseFuelGallons(form.fuelAddedGal);
  if (!fuel.ok) errors.push(fuel.error);
  if (form.notes.length > 2000) errors.push("Notes are too long.");
  const billing: PastBilling | null = form.billing === "in_app" || form.billing === "external" ? form.billing : null;
  if (!billing) errors.push("Choose whether to create bills in the app or record a flight already settled outside the app.");
  if (
    errors.length ||
    !day ||
    !ctx.aircraft ||
    !ctx.pilot ||
    hobbsOut == null ||
    hobbsIn == null ||
    tachOut == null ||
    tachIn == null ||
    !ground.ok ||
    !oil.ok ||
    !fuel.ok ||
    !billing
  ) {
    return { ok: false, errors };
  }

  const flightTenths = tenths(hobbsIn) - tenths(hobbsOut);
  const flightHours = flightTenths / 10;
  const instructor = ctx.instructor;
  const instructorRate = instructor?.instructorRateCents ?? 0;
  const inApp = billing === "in_app";
  const aircraftRateCents = inApp ? ctx.aircraft.hourlyWetCents : 0;
  const aircraftCostCents = inApp ? Math.round((flightTenths * aircraftRateCents) / 10) : 0;
  const instructorHours = instructor ? flightHours : 0;
  const instructorCostCents = inApp && instructor ? Math.round((flightTenths * instructorRate) / 10) : 0;
  const groundHours = ground.value;
  const groundRateCents = groundHours == null ? null : inApp && instructor ? instructorRate : 0;
  const groundCostCents =
    groundHours == null ? null : inApp && instructor ? groundInstructionCents(groundHours, instructorRate) : 0;
  const startLocal = `${day}T12:00`;
  const endLocal = addMinutesLocal(startLocal, Math.max(1, Math.round(flightHours * 60)));
  return {
    ok: true,
    value: {
      day,
      startsAt: zonedTimeToUtc(startLocal).toISOString(),
      endsAt: zonedTimeToUtc(endLocal).toISOString(),
      dayStartIso: zonedTimeToUtc(`${day}T00:00`).toISOString(),
      dayEndIso: zonedTimeToUtc(`${addDays(day, 1)}T00:00`).toISOString(),
      aircraftId: ctx.aircraft.id,
      pilotId: ctx.pilot.id,
      instructorId: instructor?.id ?? null,
      hobbsOut: tenths(hobbsOut) / 10,
      hobbsIn: tenths(hobbsIn) / 10,
      tachOut: tenths(tachOut) / 10,
      tachIn: tenths(tachIn) / 10,
      flightHours,
      aircraftRateCents,
      aircraftCostCents,
      instructorRateCents: inApp && instructor ? instructorRate : 0,
      instructorHours,
      instructorCostCents,
      groundHours,
      groundRateCents,
      groundCostCents,
      totalCostCents: aircraftCostCents + instructorCostCents + (groundCostCents ?? 0),
      oilAddedQt: oil.value,
      fuelAddedGal: fuel.value,
      notes: form.notes.trim() ? form.notes.trim() : null,
      billingStatus: billing,
      billingNote: billing === "external" ? OUTSIDE_BILLING_NOTE : null,
    },
  };
}
