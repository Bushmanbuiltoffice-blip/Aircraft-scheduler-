import type { BookingClash } from "./db";
import { formatDateTime, formatTime } from "./time";

export const NOTICES: Record<string, string> = {
  booked: "Reservation saved.",
  updated: "Reservation updated.",
  cancelled: "Reservation cancelled. That time is open again.",
  "checked-out": "Checked out. Hobbs and tach out are on the reservation.",
  "checked-in": "Checked in. Flight time and cost are on the flight log.",
  "aircraft-saved": "Aircraft saved.",
  "maintenance-saved": "Maintenance saved. Overlapping bookings are blocked.",
  returned: "Aircraft is available again.",
  "maintenance-removed": "Maintenance block removed.",
  "pilot-saved": "Person saved.",
  "account-saved": "Your account is updated.",
  "password-saved": "Password updated.",
  "ical-reset": "Calendar link replaced. Old subscriptions will stop working.",
  "password-set": "Your password is saved. You are signed in.",
  "person-removed": "Person removed. Their flight logs were not deleted or changed.",
  "resource-added": "PDF added to Resources.",
  "resource-deleted": "Document removed from Resources.",
  "insurance-saved": "Insurance PDF saved. It stays on this person's record for later solo flights.",
  "oil-saved": "Oil added updated. Hobbs, tach, charges, and payment were not changed.",
  "fuel-saved": "Fuel added updated. Hobbs, tach, charges, and payment were not changed.",
  "ground-saved": "Ground instruction saved on the instructor bill. The aircraft Hobbs charge was not changed, and the paid mark was not changed.",
  "ground-saved-paid": "Ground instruction saved. This flight is already marked paid for the whole rental. That paid mark was not changed. The combined total now includes this ground charge once, and the aircraft Hobbs charge was not changed.",
  "insurance-date-saved": "Insurance expiration date saved. The PDF was not changed.",
  "insurance-date-read": "Insurance expiration was read from the PDF again.",
  "agreement-signed": "Rental agreement signed and saved.",
  "agreement-guardian": "Your signature is saved. The agreement is not complete until a parent or legal guardian signs separately.",
  "agreement-already-signed": "This agreement was already signed. The saved signature was not changed.",
};

/** Shown at solo check-out when the pilot has no insurance PDF. Presence of a PDF is the whole requirement. */
export function soloInsuranceMissingMessage(pilotName: string): string {
  return `Solo check-out needs ${pilotName}'s insurance PDF on file. Upload that PDF, then check out again.`;
}

export const STUDENT_SOLO_WARNING = "Students usually fly with an instructor. You can still book this solo.";

export function pageNotice(query: string | undefined): string | null {
  if (!query) return null;
  return NOTICES[query] ?? null;
}

export function clashMessage(clash: BookingClash): string {
  switch (clash.type) {
    case "missing_aircraft":
      return "That aircraft is not on the fleet.";
    case "grounded":
      return `${clash.tail} is grounded. Return it to service before booking it.`;
    case "maintenance":
      return `${clash.tail} is down for maintenance from ${formatDateTime(clash.startsAt)} to ${formatDateTime(clash.endsAt)}: ${clash.reason}.`;
    case "aircraft":
      return `${clash.tail} is already booked ${formatDateTime(clash.startsAt)}–${formatTime(clash.endsAt)} (${clash.pilotName}).`;
    case "person":
      return `${clash.name} is already scheduled on ${clash.tail} from ${formatDateTime(clash.startsAt)} to ${formatTime(clash.endsAt)}.`;
  }
}
