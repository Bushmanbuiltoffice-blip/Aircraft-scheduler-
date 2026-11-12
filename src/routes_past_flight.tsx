/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import { insertPastFlight, listAircraft, listInstructors, listUsers, pastFlightOverlap } from "./db";
import { field, readForm, viewerOf } from "./http";
import { PastFlightPage } from "./pages_past_flight";
import { emptyPastFlightForm, parsePastFlight, preferredAircraftId, type PastFlightForm } from "./past_flight";
import { todayInZone } from "./time";
import type { AppEnv, User } from "./types";
import { document, SimpleMessage } from "./ui";

export function registerPastFlights(app: Hono<AppEnv>): void {
  app.get("/logs/new", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    return renderForm(c, user, emptyPastFlightForm(preferredAircraftId(await listAircraft(c.env.DB))), []);
  });

  app.post("/logs/new", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const data = await readForm(c);
    const form = formFrom(data);
    const [aircraftList, pilots, instructors] = await Promise.all([
      listAircraft(c.env.DB),
      listUsers(c.env.DB),
      listInstructors(c.env.DB),
    ]);
    const aircraft = aircraftList.find((item) => item.id === form.aircraftId) ?? null;
    const pilot = pilots.find((item) => item.id === form.pilotId) ?? null;
    const instructorWasChosen = form.instructorId !== "";
    const instructor = instructorWasChosen ? instructors.find((item) => item.id === form.instructorId) ?? null : null;
    const parsed = parsePastFlight(form, {
      today: todayInZone(),
      aircraft: aircraft ? { id: aircraft.id, hourlyWetCents: aircraft.hourlyWetCents } : null,
      pilot: pilot ? { id: pilot.id } : null,
      instructor: instructor ? { id: instructor.id, instructorRateCents: instructor.instructorRateCents } : null,
      instructorWasChosen,
    });
    if (!parsed.ok) return renderForm(c, user, form, parsed.errors);
    const draft = parsed.value;
    const overlap = await pastFlightOverlap(c.env.DB, {
      dayStartIso: draft.dayStartIso,
      dayEndIso: draft.dayEndIso,
      aircraftId: draft.aircraftId,
      pilotId: draft.pilotId,
      instructorId: draft.instructorId,
    });
    const logId = crypto.randomUUID();
    await insertPastFlight(c.env.DB, {
      reservationId: crypto.randomUUID(),
      logId,
      aircraftId: draft.aircraftId,
      pilotId: draft.pilotId,
      instructorId: draft.instructorId,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      hobbsOut: draft.hobbsOut,
      hobbsIn: draft.hobbsIn,
      tachOut: draft.tachOut,
      tachIn: draft.tachIn,
      flightHours: draft.flightHours,
      aircraftRateCents: draft.aircraftRateCents,
      aircraftCostCents: draft.aircraftCostCents,
      instructorRateCents: draft.instructorRateCents,
      instructorHours: draft.instructorHours,
      instructorCostCents: draft.instructorCostCents,
      groundHours: draft.groundHours,
      groundRateCents: draft.groundRateCents,
      groundCostCents: draft.groundCostCents,
      totalCostCents: draft.totalCostCents,
      oilAddedQt: draft.oilAddedQt,
      fuelAddedGal: draft.fuelAddedGal,
      notes: draft.notes,
      billingStatus: draft.billingStatus,
      billingNote: draft.billingNote,
      createdBy: user.id,
    });
    return c.redirect(`/logs/${logId}?notice=${overlap ? "past-flight-overlap" : "past-flight-saved"}`, 303);
  });
}

function formFrom(data: Record<string, string>): PastFlightForm {
  return {
    flightDate: field(data, "flight_date"),
    aircraftId: field(data, "aircraft_id"),
    pilotId: field(data, "pilot_id"),
    instructorId: field(data, "instructor_id"),
    hobbsOut: field(data, "hobbs_out"),
    hobbsIn: field(data, "hobbs_in"),
    tachOut: field(data, "tach_out"),
    tachIn: field(data, "tach_in"),
    groundHours: field(data, "ground_hours"),
    fuelAddedGal: field(data, "fuel_added_gal"),
    oilAddedQt: field(data, "oil_added_qt"),
    notes: field(data, "notes"),
    billing: field(data, "billing"),
  };
}

async function renderForm(c: Context<AppEnv>, user: User, values: PastFlightForm, errors: string[]): Promise<Response> {
  const [aircraft, pilots, instructors] = await Promise.all([
    listAircraft(c.env.DB),
    listUsers(c.env.DB),
    listInstructors(c.env.DB),
  ]);
  return c.html(
    document(
      <PastFlightPage
        viewer={viewerOf(user)}
        usingDevSecret={c.get("usingDevSecret")}
        aircraft={aircraft}
        pilots={pilots}
        instructors={instructors}
        values={values}
        errors={errors}
      />,
    ),
    errors.length ? 422 : 200,
  );
}

function mustUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) throw new Error("Sign-in required.");
  return user;
}

function forbidden(c: Context<AppEnv>) {
  return c.html(document(<SimpleMessage title="Not allowed" message="Your role cannot do that." />), 403);
}
