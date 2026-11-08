import {
  BILL_BUSINESS_NAME,
  BILL_PAYMENT_NOTE,
  aircraftBillId,
  instructorBillId,
  instructorBillTotalCents,
  paymentMethodLabel,
} from "./bills";
import { BILLED_OUTSIDE_LABEL, formatFuel, formatGroundHours, formatHours, formatMeter, formatMoney, formatOil, rateLabel } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView } from "./types";

const NOT_RECORDED = "Not recorded";

function meter(value: number | null): string {
  return value == null ? NOT_RECORDED : formatMeter(value);
}

function ground(value: number | null): string {
  return value == null ? NOT_RECORDED : `${formatGroundHours(value)} hr`;
}

function tachTime(out: number | null, inn: number | null): string {
  if (out == null || inn == null) return NOT_RECORDED;
  return `${formatHours(Math.round((inn - out) * 10) / 10)} hr`;
}

export function aircraftBillLines(log: FlightLogView): string[] {
  return [
    BILL_BUSINESS_NAME,
    "Aircraft rental bill",
    `Bill ${aircraftBillId(log.id)}`,
    `Customer: ${log.pilotName}`,
    `Date: ${formatDateTime(log.createdAt)}`,
    `Aircraft: ${log.tailNumber} ${log.make} ${log.model}`,
    `Hobbs: ${meter(log.hobbsOut)} to ${meter(log.hobbsIn)}  ${formatHours(log.flightHours)} hr`,
    `Saved rate: ${rateLabel(log.rateBasis)} ${formatMoney(log.aircraftRateCents)}/hr`,
    `Aircraft charge: ${formatHours(log.flightHours)} hr x ${formatMoney(log.aircraftRateCents)} = ${formatMoney(log.aircraftCostCents)}`,
    `Total: ${formatMoney(log.aircraftCostCents)}`,
    paymentMethodLabel(log.aircraftPaymentMethod, log.paid),
    "This is the aircraft bill only. It does not mark the instructor bill.",
    BILL_PAYMENT_NOTE,
  ];
}

export function instructorBillLines(log: FlightLogView): string[] {
  const groundLine = log.groundCostCents == null
    ? "Ground instruction: Not recorded. No ground charge is included."
    : `Ground instruction: ${formatGroundHours(log.groundHours ?? 0)} hr x ${formatMoney(log.groundRateCents ?? log.instructorRateCents)}/hr = ${formatMoney(log.groundCostCents)}`;
  const covers = log.groundCostCents == null
    ? "This instructor bill covers flight instruction. Ground instruction was not recorded, so it is not charged on this bill."
    : "This instructor bill covers flight instruction and ground instruction. One cash or check choice pays this whole instructor bill.";
  return [
    BILL_BUSINESS_NAME,
    "Instruction bill",
    `Bill ${instructorBillId(log.id)}`,
    `Customer: ${log.pilotName}`,
    `Date: ${formatDateTime(log.createdAt)}`,
    `Instructor: ${log.instructorName ?? "Name not on this flight record"}`,
    `Flight instruction: ${formatHours(log.instructorHours)} hr x ${formatMoney(log.instructorRateCents)}/hr = ${formatMoney(log.instructorCostCents)}`,
    `Saved instructor rate: ${formatMoney(log.instructorRateCents)}/hr. Ground uses this same rate.`,
    groundLine,
    `Instructor total: ${formatMoney(instructorBillTotalCents(log))}`,
    paymentMethodLabel(log.instructorPaymentMethod, log.paid),
    covers,
    BILL_PAYMENT_NOTE,
  ];
}

export function flightRecordLines(log: FlightLogView): string[] {
  const external = log.billingStatus === "external";
  return [
    "Firehound Rental",
    "Flight record",
    `Record ${log.id}`,
    "This is a copy of the flight saved in Firehound Rental. It is not a signed pilot logbook or a maintenance logbook, and it does not create a charge.",
    `When: ${formatDateTime(log.createdAt)} Pacific`,
    `Aircraft: ${log.tailNumber} ${log.make} ${log.model}`,
    `Pilot: ${log.pilotName}`,
    `Instructor: ${log.instructorName ?? "Solo"}`,
    `Flight type: ${log.rentalType ?? NOT_RECORDED}`,
    `Hobbs out: ${meter(log.hobbsOut)}`,
    `Hobbs in: ${meter(log.hobbsIn)}`,
    `Hobbs time: ${formatHours(log.flightHours)} hr`,
    `Tach out: ${meter(log.tachOut)}`,
    `Tach in: ${meter(log.tachIn)}`,
    `Tach time: ${tachTime(log.tachOut, log.tachIn)}`,
    `Ground: ${ground(log.groundHours)}`,
    `Fuel added: ${formatFuel(log.fuelAddedGal)}`,
    `Oil added: ${formatOil(log.oilAddedQt)}`,
    ...(log.maintenanceFlight ? ["Recorded as a maintenance flight."] : []),
    external
      ? `${log.billingNote ?? BILLED_OUTSIDE_LABEL} This page is not an invoice.`
      : "Hobbs is the billed time. Tach is a maintenance reading and is not used to calculate a charge. Saved charges, if any, stay on the separate bills.",
  ];
}

export function aircraftPdfName(logId: string): string {
  return `${aircraftBillId(logId)}.pdf`;
}

export function instructorPdfName(logId: string): string {
  return `${instructorBillId(logId)}.pdf`;
}

export function flightRecordPdfName(logId: string): string {
  return `flight-record-${logId}.pdf`;
}
