export const TIME_ZONE = "America/Los_Angeles";
export const SESSION_COOKIE = "rampboard_session";
export const SESSION_DAYS = 14;
// Shown on every page, in calendar feeds, and in notification text.
// Change this one string to rename the operation.
export const ORG_NAME = "Firehound Rental";
export const FIELD_NAME = "Hobby Field (77S), Creswell";

export type Role = "admin" | "instructor" | "renter";
export type AircraftStatus = "available" | "grounded";
export type RateBasis = "wet" | "dry";
export type ReservationStatus = "scheduled" | "checked_out" | "checked_in" | "cancelled";
export type CheckoutStatus = "current" | "expired" | "revoked";
export type CertificateType =
  | "student"
  | "sport"
  | "recreational"
  | "private"
  | "commercial"
  | "atp"
  | "none";
export type MedicalClass = "first" | "second" | "third" | "basicmed" | "none";

export type Bindings = {
  DB: D1Database;
  SESSION_SECRET?: string;
};

export type Variables = {
  user: User | null;
  usingDevSecret: boolean;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export interface User {
  id: string;
  email: string | null;
  passwordHash: string;
  name: string;
  role: Role;
  phone: string | null;
  certificateType: CertificateType | null;
  certificateNumber: string | null;
  medicalClass: MedicalClass | null;
  medicalExpiration: string | null;
  instructorRateCents: number | null;
  icalToken: string;
  createdAt: string;
}

export interface Aircraft {
  id: string;
  tailNumber: string;
  make: string;
  model: string;
  year: number | null;
  hourlyWetCents: number;
  hourlyDryCents: number | null;
  defaultRate: RateBasis;
  status: AircraftStatus;
  hobbs: number | null;
  tach: number | null;
  notes: string | null;
  createdAt: string;
}

export interface MaintenanceBlock {
  id: string;
  aircraftId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface Checkout {
  id: string;
  userId: string;
  aircraftId: string;
  status: CheckoutStatus;
  checkedOutOn: string;
  expiresOn: string | null;
}

export interface Reservation {
  id: string;
  aircraftId: string;
  pilotId: string;
  instructorId: string | null;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  rateBasis: RateBasis;
  hobbsOut: number | null;
  tachOut: number | null;
  hobbsIn: number | null;
  tachIn: number | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface FlightLog {
  id: string;
  reservationId: string;
  pilotId: string;
  instructorId: string | null;
  aircraftId: string;
  hobbsOut: number;
  hobbsIn: number;
  tachOut: number | null;
  tachIn: number | null;
  flightHours: number;
  aircraftRateCents: number;
  aircraftCostCents: number;
  instructorRateCents: number;
  instructorHours: number;
  instructorCostCents: number;
  totalCostCents: number;
  rateBasis: RateBasis;
  createdAt: string;
}

export type ScheduleEntry = {
  id: string;
  aircraftId: string;
  tailNumber: string;
  make: string;
  model: string;
  pilotId: string;
  pilotName: string;
  instructorId: string | null;
  instructorName: string | null;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  rateBasis: RateBasis;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
  hobbsOut: number | null;
  tachOut: number | null;
  hobbsIn: number | null;
  tachIn: number | null;
};

export type FlightLogView = FlightLog & {
  pilotName: string;
  instructorName: string | null;
  tailNumber: string;
  make: string;
  model: string;
};

export type PilotBilling = {
  id: string;
  name: string;
  flights: number;
  hours: number;
  totalCents: number;
};
