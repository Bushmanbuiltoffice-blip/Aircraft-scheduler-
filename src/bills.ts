/** Separate printable bills. Amounts come from the saved flight log, not today's rates. */

import type { FlightLogView } from "./types";

export const BILL_BUSINESS_NAME = "Fire Hound Rental";
export const BILL_PAYMENT_NOTE = "Payment is cash or check only.";
export const BILL_PAYMENT_QUESTION = "Was this paid by cash or by check?";

export type BillPaymentMethod = "cash" | "check";

/** Exact cash or check only. Blank and every other value are rejected. */
export function parseBillPaymentMethod(value: string | undefined): BillPaymentMethod | null {
  if (value === "cash" || value === "check") return value;
  return null;
}

export function paymentMethodLabel(method: BillPaymentMethod | null, rentalPaid: boolean): string {
  if (method === "cash") return "Paid by cash.";
  if (method === "check") return "Paid by check.";
  if (rentalPaid) return "This rental was marked paid. Cash or check was not recorded for this bill.";
  return "Not paid.";
}

export type BillKind = "aircraft" | "instructor";

export function aircraftBillId(logId: string): string {
  return `FHR-A-${logId}`;
}

export function instructorBillId(logId: string): string {
  return `FHR-I-${logId}`;
}

/** Historical imports were already billed outside the app. Do not print a new charge. */
export function externalBillReason(log: Pick<FlightLogView, "billingStatus">): string | null {
  if (log.billingStatus !== "external") return null;
  return "This flight was billed outside the app. No new bill is created.";
}

/** Solo flights and a saved instructor charge of $0 with no ground charge do not get an instructor invoice. */
export function instructorBillBlockedReason(
  log: Pick<FlightLogView, "billingStatus" | "instructorId" | "instructorName" | "instructorCostCents" | "groundCostCents">,
): string | null {
  const outside = externalBillReason(log);
  if (outside) return outside;
  if (!log.instructorId && !log.instructorName) return "Solo flight. No instructor was saved, so there is no instructor bill.";
  const ground = log.groundCostCents ?? 0;
  if (log.instructorCostCents <= 0 && ground <= 0) return "The saved instructor charge is $0.00, so there is no instructor bill.";
  return null;
}

export function canPrintAircraftBill(log: Pick<FlightLogView, "billingStatus">): boolean {
  return externalBillReason(log) == null;
}

export function canPrintInstructorBill(
  log: Pick<FlightLogView, "billingStatus" | "instructorId" | "instructorName" | "instructorCostCents" | "groundCostCents">,
): boolean {
  return instructorBillBlockedReason(log) == null;
}

/** A flight day is a reasonable cap for one ground session. */
export const MAX_GROUND_HOURS = 24;

/** Blank means not entered. 0 means none. Up to two decimal places. */
export function parseGroundHours(input: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter ground instruction in hours, like 1 or 0.5. Use 0 if none was given." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > MAX_GROUND_HOURS) {
    return { ok: false, error: `Ground instruction must be from 0 to ${MAX_GROUND_HOURS} hours.` };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

/** Hundredths of an hour times the saved hourly rate, in cents. */
export function groundInstructionCents(hours: number, rateCents: number): number {
  const hundredths = Math.round((hours + Number.EPSILON) * 100);
  return Math.round((hundredths * rateCents) / 100);
}

export function instructorBillTotalCents(log: Pick<FlightLogView, "instructorCostCents" | "groundCostCents">): number {
  return log.instructorCostCents + (log.groundCostCents ?? 0);
}

export function canAdjustGround(
  user: { id: string; role: FlightLogView["pilotRole"] },
  log: Pick<FlightLogView, "billingStatus" | "instructorId" | "instructorName" | "pilotId">,
): boolean {
  if (log.billingStatus === "external") return false;
  if (!log.instructorId) return false;
  if (user.role === "admin") return true;
  if (user.role === "instructor" && (log.instructorId === user.id || log.pilotId === user.id)) return true;
  return false;
}
