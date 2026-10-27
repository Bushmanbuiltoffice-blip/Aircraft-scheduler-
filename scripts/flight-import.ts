import { BILLED_OUTSIDE_LABEL, paperPaidLabel, parseDollarsToCents } from "../src/format";
import { zonedTimeToUtc } from "../src/time";

export const IMPORT_TAIL = "N1561Y";

export type ImportUser = {
  id: string;
  name: string;
  role: string;
};

export type ImportAircraft = {
  id: string;
  tailNumber: string;
  hourlyWetCents: number;
};

export type ImportOptions = {
  csv: string;
  aircraft: ImportAircraft;
  users: ImportUser[];
  bill: boolean;
  instructorRateCents: number | null;
};

export type PlannedFlight = {
  key: string;
  date: string;
  pilotName: string;
  pilotId: string;
  instructorId: string | null;
  guestInstructorName: string | null;
  reservationId: string;
  logId: string;
  startsAt: string;
  endsAt: string;
  hobbsOut: string;
  hobbsIn: string;
  tachOut: string;
  tachIn: string;
  flightHours: string;
  groundHours: string | null;
  fuelAddedGal: string | null;
  oilAddedQt: string | null;
  rentalType: string;
  aircraftPaid: boolean;
  instructorPaid: boolean;
  maintenance: boolean;
  aircraftRateCents: number;
  aircraftCostCents: number;
  instructorRateCents: number;
  instructorHours: string;
  instructorCostCents: number;
  totalCostCents: number;
  billingStatus: "in_app" | "external";
  billingNote: string | null;
  notes: string;
};

export type ImportPlan = {
  sql: string;
  flights: PlannedFlight[];
  createdPilots: string[];
  reusedPilots: string[];
  guestInstructors: string[];
  hobbs: number;
  tach: number;
  totalCostCents: number;
  bill: boolean;
  text: string;
};

type ParsedFlight = {
  date: string;
  pilotName: string;
  instructorName: string | null;
  tachOut: { tenths: number; sql: string };
  tachIn: { tenths: number; sql: string };
  hobbsOut: { tenths: number; sql: string };
  hobbsIn: { tenths: number; sql: string };
  groundHours: { value: number; sql: string } | null;
  fuelAddedGal: { value: number; sql: string } | null;
  oilAddedQt: { value: number; sql: string } | null;
  aircraftPaid: boolean;
  instructorPaid: boolean;
  maintenance: boolean;
  rentalType: string;
};

export function parseDollars(input: string): number {
  const cents = parseDollarsToCents(input.trim());
  if (cents == null) throw new Error(`Instructor rate must be a dollar amount such as 75 or 65, not "${input}".`);
  return cents;
}

export function parseFlightCsv(text: string): ParsedFlight[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The CSV has no flight rows.");
  const header = rows[0]?.map((cell) => cell.trim()) ?? [];
  const expected = [
    "date",
    "pilot",
    "instructor",
    "tach_start",
    "tach_end",
    "hobbs_start",
    "hobbs_end",
    "flight_time",
    "ground_time",
    "paid_status",
    "fuel_added_gal",
    "oil_added_qt",
    "rental_type",
  ];
  if (header.join(",") !== expected.join(",")) {
    throw new Error(`CSV header must be ${expected.join(",")}.`);
  }
  const flights: ParsedFlight[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.length !== expected.length) {
      throw new Error(`Row ${index + 1} has ${row.length} columns, expected ${expected.length}.`);
    }
    const cell = (offset: number) => (row[offset] ?? "").trim();
    const date = cell(0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new Error(`Row ${index + 1} has an invalid date "${date}".`);
    }
    const pilotName = personName(cell(1), `Row ${index + 1} pilot`);
    const instructorRaw = cell(2);
    const instructorName = instructorRaw ? personName(instructorRaw, `Row ${index + 1} instructor`) : null;
    const tachOut = parseTenths(cell(3), `Row ${index + 1} tach start`);
    const tachIn = parseTenths(cell(4), `Row ${index + 1} tach end`);
    const hobbsOut = parseTenths(cell(5), `Row ${index + 1} Hobbs start`);
    const hobbsIn = parseTenths(cell(6), `Row ${index + 1} Hobbs end`);
    const flightTime = parseTenths(cell(7), `Row ${index + 1} flight time`);
    if (hobbsIn.tenths <= hobbsOut.tenths) throw new Error(`Row ${index + 1} Hobbs end must be after Hobbs start.`);
    if (tachIn.tenths < tachOut.tenths) throw new Error(`Row ${index + 1} tach end is before tach start.`);
    const hobbsTenths = hobbsIn.tenths - hobbsOut.tenths;
    if (flightTime.tenths !== hobbsTenths) {
      throw new Error(`Row ${index + 1} flight time ${flightTime.sql} does not match Hobbs ${((hobbsTenths) / 10).toFixed(1)}.`);
    }
    const paid = parsePaid(cell(9), index + 1);
    const rentalType = cell(12);
    if (!rentalType || rentalType.length > 80) throw new Error(`Row ${index + 1} is missing a rental type.`);
    const key = flightKey(date, hobbsOut.sql);
    if (seen.has(key)) throw new Error(`Duplicate flight ${key}.`);
    seen.add(key);
    flights.push({
      date,
      pilotName,
      instructorName,
      tachOut,
      tachIn,
      hobbsOut,
      hobbsIn,
      groundHours: parseOptionalDecimal(cell(8), `Row ${index + 1} ground time`, 2),
      fuelAddedGal: parseOptionalDecimal(cell(10), `Row ${index + 1} fuel`, 2),
      oilAddedQt: parseOptionalDecimal(cell(11), `Row ${index + 1} oil`, 2),
      aircraftPaid: paid.aircraftPaid,
      instructorPaid: paid.instructorPaid,
      maintenance: paid.maintenance,
      rentalType,
    });
  }
  return flights;
}

export async function buildFlightImport(options: ImportOptions): Promise<ImportPlan> {
  if (options.aircraft.tailNumber !== IMPORT_TAIL) {
    throw new Error(`This import is for ${IMPORT_TAIL}. The database aircraft is ${options.aircraft.tailNumber}.`);
  }
  if (!options.aircraft.id) throw new Error(`${IMPORT_TAIL} has no id.`);
  if (!Number.isInteger(options.aircraft.hourlyWetCents) || options.aircraft.hourlyWetCents <= 0) {
    throw new Error(`${IMPORT_TAIL} needs a wet hourly rate before import.`);
  }
  if (options.bill && options.instructorRateCents == null) {
    throw new Error("Pass --instructor-rate when using --bill. Leave billing off to import the paper log with zero charges.");
  }
  const parsed = parseFlightCsv(options.csv);
  const usersByName = new Map<string, ImportUser>();
  for (const user of options.users) {
    const name = user.name.trim();
    if (!name) continue;
    if (usersByName.has(name)) throw new Error(`More than one person is named ${name}. Rename one of them, then import again.`);
    usersByName.set(name, user);
  }

  const created = new Map<string, string>();
  for (const flight of parsed) {
    if (!usersByName.has(flight.pilotName) && !created.has(flight.pilotName)) {
      created.set(flight.pilotName, await stableId("pilot", flight.pilotName));
    }
  }

  const pilotId = (name: string): string => usersByName.get(name)?.id ?? created.get(name) ?? "";
  const timed = assignTimes(parsed);
  const flights: PlannedFlight[] = [];
  for (const flight of timed) {
    const id = pilotId(flight.pilotName);
    if (!id) throw new Error(`No pilot id for ${flight.pilotName}.`);
    const instructor = resolveInstructor(flight.instructorName, usersByName, created);
    const key = `${IMPORT_TAIL}|${flight.date}|${flight.hobbsOut.sql}`;
    const costs = priceFlight(flight, instructor.id, options);
    const paper = paperPaidLabel({
      maintenanceFlight: flight.maintenance,
      aircraftPaid: flight.aircraftPaid,
      instructorPaid: flight.instructorPaid,
    });
    const notes = [
      costs.billingNote ?? "Historical import",
      `import-key:${key}.`,
      `Rental type: ${flight.rentalType}.`,
      `Paper log: ${paper}.`,
      instructor.guest ? `Guest instructor: ${instructor.guest}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    flights.push({
      key,
      date: flight.date,
      pilotName: flight.pilotName,
      pilotId: id,
      instructorId: instructor.id,
      guestInstructorName: instructor.guest,
      reservationId: await stableId("reservation", key),
      logId: await stableId("flight-log", key),
      startsAt: flight.startsAt,
      endsAt: flight.endsAt,
      hobbsOut: flight.hobbsOut.sql,
      hobbsIn: flight.hobbsIn.sql,
      tachOut: flight.tachOut.sql,
      tachIn: flight.tachIn.sql,
      flightHours: ((flight.hobbsIn.tenths - flight.hobbsOut.tenths) / 10).toFixed(1),
      groundHours: flight.groundHours?.sql ?? null,
      fuelAddedGal: flight.fuelAddedGal?.sql ?? null,
      oilAddedQt: flight.oilAddedQt?.sql ?? null,
      rentalType: flight.rentalType,
      aircraftPaid: flight.aircraftPaid,
      instructorPaid: flight.instructorPaid,
      maintenance: flight.maintenance,
      ...costs,
      notes,
    });
  }

  const last = flights.reduce((best, flight) => (Number(flight.hobbsIn) > Number(best.hobbsIn) ? flight : best));
  const hobbs = Number(last.hobbsIn);
  const tach = Number(last.tachIn);
  const lines: string[] = [];
  const createdNames = [...created.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of createdNames) {
    const id = created.get(name);
    if (!id) continue;
    const token = `import-${(await sha256Hex(`ical|${name}`)).slice(0, 32)}`;
    const createdAt = flights.find((flight) => flight.pilotName === name)?.startsAt ?? flights[0]?.startsAt;
    lines.push(
      `INSERT INTO users (id, email, password_hash, name, role, phone, certificate_type, certificate_number, medical_class, medical_expiration, instructor_rate_cents, ical_token, created_at) SELECT ${sqlString(id)}, NULL, 'disabled', ${sqlString(name)}, 'renter', NULL, NULL, NULL, NULL, NULL, NULL, ${sqlString(token)}, ${sqlString(createdAt ?? "")} WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = ${sqlString(name)});`,
    );
  }
  for (const flight of flights) {
    lines.push(
      `INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, hobbs_out, tach_out, hobbs_in, tach_in, notes, created_by, created_at, updated_at, cancelled_at) SELECT ${sqlString(flight.reservationId)}, ${sqlString(options.aircraft.id)}, ${sqlString(flight.pilotId)}, ${sqlString(flight.instructorId)}, ${sqlString(flight.startsAt)}, ${sqlString(flight.endsAt)}, 'checked_in', 'wet', ${flight.hobbsOut}, ${flight.tachOut}, ${flight.hobbsIn}, ${flight.tachIn}, ${sqlString(flight.notes)}, NULL, ${sqlString(flight.startsAt)}, ${sqlString(flight.endsAt)}, NULL WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE id = ${sqlString(flight.reservationId)}) AND NOT EXISTS (SELECT 1 FROM reservations WHERE aircraft_id = ${sqlString(options.aircraft.id)} AND notes LIKE ${sqlString(`%import-key:${flight.key}.%`)});`,
    );
    lines.push(
      `INSERT INTO flight_logs (id, reservation_id, pilot_id, instructor_id, aircraft_id, hobbs_out, hobbs_in, tach_out, tach_in, flight_hours, aircraft_rate_cents, aircraft_cost_cents, instructor_rate_cents, instructor_hours, instructor_cost_cents, total_cost_cents, rate_basis, created_at, ground_hours, aircraft_paid, instructor_paid, maintenance_flight, fuel_added_gal, oil_added_qt, rental_type, imported, instructor_name, billing_status, billing_note) SELECT ${sqlString(flight.logId)}, ${sqlString(flight.reservationId)}, ${sqlString(flight.pilotId)}, ${sqlString(flight.instructorId)}, ${sqlString(options.aircraft.id)}, ${flight.hobbsOut}, ${flight.hobbsIn}, ${flight.tachOut}, ${flight.tachIn}, ${flight.flightHours}, ${flight.aircraftRateCents}, ${flight.aircraftCostCents}, ${flight.instructorRateCents}, ${flight.instructorHours}, ${flight.instructorCostCents}, ${flight.totalCostCents}, 'wet', ${sqlString(flight.startsAt)}, ${sqlNumber(flight.groundHours)}, ${flight.aircraftPaid ? 1 : 0}, ${flight.instructorPaid ? 1 : 0}, ${flight.maintenance ? 1 : 0}, ${sqlNumber(flight.fuelAddedGal)}, ${sqlNumber(flight.oilAddedQt)}, ${sqlString(flight.rentalType)}, 1, ${sqlString(flight.guestInstructorName)}, ${sqlString(flight.billingStatus)}, ${sqlString(flight.billingNote)} WHERE EXISTS (SELECT 1 FROM reservations WHERE id = ${sqlString(flight.reservationId)}) AND NOT EXISTS (SELECT 1 FROM flight_logs WHERE reservation_id = ${sqlString(flight.reservationId)}) AND NOT EXISTS (SELECT 1 FROM flight_logs WHERE id = ${sqlString(flight.logId)});`,
    );
  }
  lines.push(
    `UPDATE aircraft SET hobbs = CASE WHEN hobbs IS NULL OR hobbs + 0.05 < ${hobbs.toFixed(1)} THEN ${hobbs.toFixed(1)} ELSE hobbs END, tach = CASE WHEN tach IS NULL OR tach + 0.05 < ${tach.toFixed(1)} THEN ${tach.toFixed(1)} ELSE tach END WHERE tail_number = ${sqlString(IMPORT_TAIL)} AND (hobbs IS NULL OR hobbs + 0.05 < ${hobbs.toFixed(1)} OR tach IS NULL OR tach + 0.05 < ${tach.toFixed(1)});`,
  );

  const reused = [...new Set(parsed.map((flight) => flight.pilotName).filter((name) => usersByName.has(name)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const guests = [...new Set(flights.map((flight) => flight.guestInstructorName).filter((name): name is string => Boolean(name)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const totalCostCents = flights.reduce((sum, flight) => sum + flight.totalCostCents, 0);
  const text = summaryText({
    flights: flights.length,
    createdPilots: createdNames,
    reusedPilots: reused,
    guestInstructors: guests,
    hobbs,
    tach,
    totalCostCents,
    bill: options.bill,
    ignoredRate: !options.bill && options.instructorRateCents != null,
  });
  return {
    sql: `${lines.join("\n")}\n`,
    flights,
    createdPilots: createdNames,
    reusedPilots: reused,
    guestInstructors: guests,
    hobbs,
    tach,
    totalCostCents,
    bill: options.bill,
    text,
  };
}

function summaryText(input: {
  flights: number;
  createdPilots: string[];
  reusedPilots: string[];
  guestInstructors: string[];
  hobbs: number;
  tach: number;
  totalCostCents: number;
  bill: boolean;
  ignoredRate: boolean;
}): string {
  const lines = [
    `${input.flights} flights for ${IMPORT_TAIL}.`,
    input.bill
      ? `Billing is on. In-app charges total $${(input.totalCostCents / 100).toFixed(2)}.`
      : `${BILLED_OUTSIDE_LABEL}. Aircraft charge $0.00, instructor charge $0.00, and no balance is created.`,
  ];
  if (input.ignoredRate) lines.push("The instructor rate was not applied. Billing is off.");
  lines.push(input.createdPilots.length ? `Pilot profiles added when missing: ${input.createdPilots.join(", ")}.` : "No new pilot profiles.");
  lines.push(input.reusedPilots.length ? `Matched existing people: ${input.reusedPilots.join(", ")}.` : "No existing people matched.");
  lines.push(
    input.guestInstructors.length
      ? `Instructor names stored on the flight only: ${input.guestInstructors.join(", ")}.`
      : "Every instructor matched a person already on file.",
  );
  lines.push(
    `Hobbs moves forward to ${input.hobbs.toFixed(1)} and tach to ${input.tach.toFixed(1)} when the saved readings are blank or lower.`,
  );
  return lines.join("\n");
}

function priceFlight(
  flight: ParsedFlight,
  instructorId: string | null,
  options: ImportOptions,
): Pick<
  PlannedFlight,
  | "aircraftRateCents"
  | "aircraftCostCents"
  | "instructorRateCents"
  | "instructorHours"
  | "instructorCostCents"
  | "totalCostCents"
  | "billingStatus"
  | "billingNote"
> {
  const tenths = flight.hobbsIn.tenths - flight.hobbsOut.tenths;
  if (!options.bill) {
    return {
      aircraftRateCents: 0,
      aircraftCostCents: 0,
      instructorRateCents: 0,
      instructorHours: "0",
      instructorCostCents: 0,
      totalCostCents: 0,
      billingStatus: "external",
      billingNote: BILLED_OUTSIDE_LABEL,
    };
  }
  if (flight.maintenance) {
    return {
      aircraftRateCents: options.aircraft.hourlyWetCents,
      aircraftCostCents: 0,
      instructorRateCents: 0,
      instructorHours: "0",
      instructorCostCents: 0,
      totalCostCents: 0,
      billingStatus: "in_app",
      billingNote: null,
    };
  }
  const aircraftCostCents = Math.round((tenths * options.aircraft.hourlyWetCents) / 10);
  const rate = instructorId != null ? options.instructorRateCents ?? 0 : 0;
  const instructorCostCents = instructorId != null ? Math.round((tenths * rate) / 10) : 0;
  return {
    aircraftRateCents: options.aircraft.hourlyWetCents,
    aircraftCostCents,
    instructorRateCents: rate,
    instructorHours: instructorId != null ? (tenths / 10).toFixed(1) : "0",
    instructorCostCents,
    totalCostCents: aircraftCostCents + instructorCostCents,
    billingStatus: "in_app",
    billingNote: null,
  };
}

function resolveInstructor(
  name: string | null,
  usersByName: Map<string, ImportUser>,
  created: Map<string, string>,
): { id: string | null; guest: string | null } {
  if (!name) return { id: null, guest: null };
  const existing = usersByName.get(name);
  if (existing) return { id: existing.id, guest: null };
  const createdId = created.get(name);
  if (createdId) return { id: createdId, guest: null };
  return { id: null, guest: name };
}

function assignTimes(flights: ParsedFlight[]): Array<ParsedFlight & { startsAt: string; endsAt: string }> {
  let cursorDate = "";
  let cursor = 8 * 60;
  return flights.map((flight) => {
    if (flight.date !== cursorDate) {
      cursorDate = flight.date;
      cursor = 8 * 60;
    }
    const hobbsMinutes = Math.round(((flight.hobbsIn.tenths - flight.hobbsOut.tenths) / 10) * 60);
    const duration = Math.max(30, hobbsMinutes);
    const start = cursor;
    const end = start + duration;
    if (end >= 24 * 60) throw new Error(`Flights on ${flight.date} do not fit in one day.`);
    cursor = end + 15;
    return {
      ...flight,
      startsAt: zonedTimeToUtc(`${flight.date}T${clock(start)}`).toISOString(),
      endsAt: zonedTimeToUtc(`${flight.date}T${clock(end)}`).toISOString(),
    };
  });
}

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function flightKey(date: string, hobbsOut: string): string {
  return `${date}|${hobbsOut}`;
}

function parsePaid(status: string, row: number): { aircraftPaid: boolean; instructorPaid: boolean; maintenance: boolean } {
  const text = status.trim().replace(/\s+/g, " ");
  if (/^maintenance$/i.test(text)) return { aircraftPaid: false, instructorPaid: false, maintenance: true };
  const aircraftPaid = /aircraft paid/i.test(text);
  const instructorPaid = /instructor paid/i.test(text);
  if (!aircraftPaid && !instructorPaid) throw new Error(`Row ${row} has an unrecognized paid status "${status}".`);
  return { aircraftPaid, instructorPaid, maintenance: false };
}

function personName(value: string, label: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[\r\n]/.test(name)) throw new Error(`${label} is missing or too long.`);
  return name;
}

function parseTenths(token: string, label: string): { tenths: number; sql: string } {
  const trimmed = token.trim();
  if (!/^\d+(\.\d)?$/.test(trimmed)) throw new Error(`${label} must be a number with at most one decimal.`);
  const tenths = Math.round(Number(trimmed) * 10);
  return { tenths, sql: (tenths / 10).toFixed(1) };
}

function parseOptionalDecimal(token: string, label: string, places: number): { value: number; sql: string } | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${places}})?$`);
  if (!pattern.test(trimmed)) throw new Error(`${label} must be a number.`);
  return { value: Number(trimmed), sql: trimmed };
}

function sqlString(value: string | null): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: string | null): string {
  if (value == null) return "NULL";
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`Refusing to write an unsafe number "${value}".`);
  return value;
}

async function stableId(kind: string, key: string): Promise<string> {
  const bytes = new Uint8Array((await sha256Bytes(`${kind}|${key}`)).slice(0, 16));
  const sixth = bytes[6] ?? 0;
  const eighth = bytes[8] ?? 0;
  bytes[6] = (sixth & 0x0f) | 0x40;
  bytes[8] = (eighth & 0x3f) | 0x80;
  const text = hex(bytes);
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await sha256Bytes(text));
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}
