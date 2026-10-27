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
};

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
