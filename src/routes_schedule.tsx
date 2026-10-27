/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import { RESOURCE_TONES, buildDayBoard, buildWeekBoard, type BoardEvent, type BoardResource } from "./board";
import { canBookDespiteEligibility, computeFlightCost, eligibilityAllowsBooking, pilotEligibility, validateReservationWindow } from "./domain";
import { createEmailSender, reservationMessage, safeSend } from "./email";
import { formatMoney, parseMeter } from "./format";
import { buildIcal, type IcalEvent } from "./ical";
import { clashMessage, pageNotice } from "./copy";
import {
  billingByPilot,
  cancelReservation,
  checkInReservation,
  checkoutReservation,
  findBookingClash,
  getAircraft,
  getCheckout,
  getFlightLog,
  getFlightLogByReservation,
  getScheduleEntry,
  getUserByIcalToken,
  getUserById,
  insertReservationIfFree,
  listAircraft,
  listCheckoutsForUser,
  listFlightLogs,
  listInstructors,
  listMaintenance,
  listOutbox,
  listReservationsForUser,
  listReservationsOverlapping,
  listUpcoming,
  listUsers,
  monthTotals,
  updateReservationIfFree,
} from "./db";
import { field, isUuid, readForm, viewerOf } from "./http";
import { DashboardPage } from "./pages_dash";
import { LogDetailPage, LogsPage } from "./pages_logs";
import { ReservationPage } from "./pages_reservation";
import { ReservationFormPage, SchedulePage, type ReservationFormValues } from "./pages_schedule";
import { document, SimpleMessage } from "./ui";
import {
  addDays,
  formatDateTime,
  formatDayKey,
  formatLongDay,
  formatTime,
  monthRange,
  parseDay,
  parseLocalDateTime,
  startOfWeek,
  todayInZone,
  zonedTimeToUtc,
} from "./time";
import type { Aircraft, AppEnv, MaintenanceBlock, RateBasis, ReservationStatus, ScheduleEntry, User } from "./types";
import { ORG_NAME, TIME_ZONE } from "./types";

export function registerSchedule(app: Hono<AppEnv>): void {
  app.get("/", async (c) => {
    const user = mustUser(c);
    const now = new Date();
    const today = todayInZone(now);
    const day = dayBounds(today);
    const month = monthRange(today, TIME_ZONE);
    const monthLabel = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "long" }).format(now);
    const [aircraft, maintenance, todayAll, upcomingAll, logs, billing, totals, outbox, checkouts] = await Promise.all([
      listAircraft(c.env.DB),
      listMaintenance(c.env.DB, day.startIso, day.endIso),
      listReservationsOverlapping(c.env.DB, day.startIso, day.endIso),
      user.role === "admin"
        ? listUpcoming(c.env.DB, day.endIso, 12)
        : listReservationsForUser(c.env.DB, user.id, day.endIso),
      listFlightLogs(
        c.env.DB,
        user.role === "admin" ? { limit: 8 } : user.role === "instructor" ? { instructorOrPilotId: user.id, limit: 8 } : { pilotId: user.id, limit: 8 },
      ),
      user.role === "admin" ? billingByPilot(c.env.DB) : Promise.resolve([]),
      monthTotals(c.env.DB, month.startIso, month.endIso),
      user.role === "admin" ? listOutbox(c.env.DB, 5) : Promise.resolve([]),
      listCheckoutsForUser(c.env.DB, user.id),
    ]);
    const todayItems = user.role === "admin" ? todayAll : todayAll.filter((item) => item.pilotId === user.id || item.instructorId === user.id);
    const tails = new Map(aircraft.map((item) => [item.id, item.tailNumber]));
    const medicalBanner = medicalBannerFor(user, today);
    return c.html(
      document(
        <DashboardPage
          viewer={viewerOf(user)}
          path="/"
          notice={pageNotice(c.req.query("notice"))}
          usingDevSecret={c.get("usingDevSecret")}
          todayLabel={formatLongDay(today)}
          today={todayItems}
          upcoming={upcomingAll}
          aircraft={aircraft}
          maintenance={maintenance.filter((block) => block.startsAt <= now.toISOString() && block.endsAt > now.toISOString())}
          logs={logs}
          billing={billing}
          month={{ ...totals, label: monthLabel }}
          outbox={outbox}
          medicalBanner={medicalBanner}
          checkouts={checkouts.map((checkout) => ({ ...checkout, tail: tails.get(checkout.aircraftId) ?? "Aircraft" }))}
        />,
      ),
    );
  });

  app.get("/schedule", async (c) => {
    const user = mustUser(c);
    const today = todayInZone();
    const anchor = parseDay(c.req.query("date") ?? "") ?? today;
    const view = c.req.query("view") === "week" ? "week" : "day";
    const board = c.req.query("board") === "instructors" ? "instructors" : "aircraft";
    const weekStart = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const rangeStart = view === "week" ? dayBounds(days[0]!).startIso : dayBounds(anchor).startIso;
    const rangeEnd = view === "week" ? dayBounds(addDays(days[6]!, 1)).startIso : dayBounds(anchor).endIso;
    const [aircraft, instructors, reservations, maintenance] = await Promise.all([
      listAircraft(c.env.DB),
      listInstructors(c.env.DB),
      listReservationsOverlapping(c.env.DB, rangeStart, rangeEnd),
      listMaintenance(c.env.DB, rangeStart, rangeEnd),
    ]);
    const resources = board === "aircraft" ? aircraftResources(aircraft, anchor) : instructorResources(instructors, anchor);
    const events = boardEvents(board, reservations, maintenance, aircraft);
    const dayBoard = buildDayBoard(anchor, resources, events, anchor === today ? new Date() : null);
    const weekRows = buildWeekBoard(days, resources, events);
    return c.html(
      document(
        <SchedulePage
          viewer={viewerOf(user)}
          path="/schedule"
          notice={pageNotice(c.req.query("notice"))}
          usingDevSecret={c.get("usingDevSecret")}
          view={view}
          board={board}
          anchor={anchor}
          today={today}
          lanes={dayBoard.lanes}
          nowPct={dayBoard.nowPct}
          weekDays={days}
          weekRows={weekRows}
        />,
      ),
    );
  });

  app.get("/reservations/new", async (c) => {
    const user = mustUser(c);
    const today = todayInZone();
    const date = parseDay(c.req.query("date") ?? "") ?? today;
    const aircraft = await listAircraft(c.env.DB);
    const requestedAircraft = c.req.query("aircraft") ?? "";
    const selected = aircraft.find((item) => item.id === requestedAircraft);
    return renderBookingForm(c, {
      mode: "create",
      action: "/reservations",
      cancelHref: "/schedule",
      values: {
        aircraftId: selected?.id ?? "",
        pilotId: user.role === "renter" ? user.id : "",
        instructorId: c.req.query("instructor") ?? "",
        startsAt: `${date}T09:00`,
        endsAt: `${date}T11:00`,
        rateBasis: selected?.defaultRate ?? "wet",
        notes: "",
        override: false,
      },
      errors: [],
      warnings: [],
      aircraft,
      pilots: await bookablePilots(c, user),
      instructors: await listInstructors(c.env.DB),
    });
  });

  app.post("/reservations", async (c) => saveBooking(c, null));

  app.get("/reservations/:id", async (c) => renderReservation(c, c.req.param("id"), null));

  app.get("/reservations/:id/edit", async (c) => {
    const user = mustUser(c);
    const entry = await getScheduleEntry(c.env.DB, c.req.param("id"));
    if (!entry) return c.notFound();
    if (!canManage(user, entry) || entry.status !== "scheduled") return c.redirect(`/reservations/${entry.id}`);
    return renderBookingForm(c, {
      mode: "edit",
      action: `/reservations/${entry.id}`,
      cancelHref: `/reservations/${entry.id}`,
      values: valuesFromEntry(entry),
      errors: [],
      warnings: [],
      aircraft: await listAircraft(c.env.DB),
      pilots: await bookablePilots(c, user),
      instructors: await listInstructors(c.env.DB),
    });
  });

  app.post("/reservations/:id", async (c) => saveBooking(c, c.req.param("id")));

  app.post("/reservations/:id/cancel", async (c) => {
    const user = mustUser(c);
    const entry = await getScheduleEntry(c.env.DB, c.req.param("id"));
    if (!entry) return c.notFound();
    if (!canManage(user, entry)) return forbidden(c);
    if (entry.status === "checked_in" || entry.status === "cancelled") {
      return renderReservation(c, entry.id, "This reservation can no longer be cancelled.");
    }
    if (entry.status === "checked_out" && user.role !== "admin") {
      return renderReservation(c, entry.id, "Check the flight in, or ask an admin to cancel a checked-out flight.");
    }
    const reason = field(await readForm(c), "reason");
    const notes = [entry.notes, reason ? `Cancelled: ${reason}` : ""].filter(Boolean).join("\n") || null;
    const ok = await cancelReservation(c.env.DB, entry.id, notes, new Date().toISOString(), user.role === "admin");
    if (!ok) return renderReservation(c, entry.id, "This reservation changed. Reload and try again.");
    const fresh = await getScheduleEntry(c.env.DB, entry.id);
    if (fresh) await notify(c.env.DB, fresh, "cancelled");
    return c.redirect("/schedule?notice=cancelled", 303);
  });

  app.post("/reservations/:id/checkout", async (c) => {
    const user = mustUser(c);
    const entry = await getScheduleEntry(c.env.DB, c.req.param("id"));
    if (!entry) return c.notFound();
    if (!canManage(user, entry)) return forbidden(c);
    const data = await readForm(c);
    const hobbs = parseMeter(field(data, "hobbs_out"));
    const tach = parseMeter(field(data, "tach_out"));
    if (hobbs == null || tach == null) return renderReservation(c, entry.id, "Enter Hobbs and tach out with at most one decimal.");
    const ok = await checkoutReservation(c.env.DB, entry.id, hobbs, tach, new Date().toISOString());
    if (!ok) return renderReservation(c, entry.id, "Only a scheduled reservation can be checked out.");
    return c.redirect(`/reservations/${entry.id}?notice=checked-out`, 303);
  });

  app.post("/reservations/:id/checkin", async (c) => {
    const user = mustUser(c);
    const entry = await getScheduleEntry(c.env.DB, c.req.param("id"));
    if (!entry) return c.notFound();
    if (!canManage(user, entry)) return forbidden(c);
    if (entry.status !== "checked_out" || entry.hobbsOut == null || entry.tachOut == null) {
      return renderReservation(c, entry.id, "Check the aircraft out before checking it in.");
    }
    const data = await readForm(c);
    const hobbsIn = parseMeter(field(data, "hobbs_in"));
    const tachIn = parseMeter(field(data, "tach_in"));
    if (hobbsIn == null || tachIn == null) return renderReservation(c, entry.id, "Enter Hobbs and tach in with at most one decimal.");
    const aircraft = await getAircraft(c.env.DB, entry.aircraftId);
    if (!aircraft) return c.notFound();
    const instructor = entry.instructorId ? await getUserById(c.env.DB, entry.instructorId) : null;
    const cost = computeFlightCost({
      hobbsOut: entry.hobbsOut,
      hobbsIn,
      tachOut: entry.tachOut,
      tachIn,
      rateBasis: entry.rateBasis,
      wetCents: aircraft.hourlyWetCents,
      dryCents: aircraft.hourlyDryCents,
      instructorRateCents: instructor ? instructor.instructorRateCents ?? 0 : null,
    });
    if (!cost.ok) return renderReservation(c, entry.id, cost.error);
    const now = new Date().toISOString();
    const logId = crypto.randomUUID();
    const saved = await checkInReservation(c.env.DB, {
      id: logId,
      reservationId: entry.id,
      pilotId: entry.pilotId,
      instructorId: entry.instructorId,
      aircraftId: entry.aircraftId,
      ...cost.value,
      createdAt: now,
    });
    if (!saved) return renderReservation(c, entry.id, "Check-in could not be saved. Reload and try again.");
    const fresh = await getScheduleEntry(c.env.DB, entry.id);
    if (fresh) await notify(c.env.DB, fresh, "checked_in", formatMoney(cost.value.totalCostCents));
    return c.redirect(`/logs/${logId}?notice=checked-in`, 303);
  });

  app.get("/logs", async (c) => {
    const user = mustUser(c);
    const pilotId = user.role === "admin" ? c.req.query("pilot") ?? "" : "";
    const logs = await listFlightLogs(
      c.env.DB,
      user.role === "admin"
        ? { pilotId: pilotId || null, limit: 100 }
        : user.role === "instructor"
          ? { instructorOrPilotId: user.id, limit: 100 }
          : { pilotId: user.id, limit: 100 },
    );
    const pilots = user.role === "admin" ? await listUsers(c.env.DB) : [];
    return c.html(
      document(
        <LogsPage
          viewer={viewerOf(user)}
          path="/logs"
          usingDevSecret={c.get("usingDevSecret")}
          logs={logs}
          pilots={pilots}
          pilotId={pilotId}
        />,
      ),
    );
  });

  app.get("/logs/:id", async (c) => {
    const user = mustUser(c);
    const log = await getFlightLog(c.env.DB, c.req.param("id"));
    if (!log) return c.notFound();
    if (user.role !== "admin" && log.pilotId !== user.id && log.instructorId !== user.id) return forbidden(c);
    return c.html(
      document(
        <LogDetailPage viewer={viewerOf(user)} path="/logs" usingDevSecret={c.get("usingDevSecret")} log={log} />,
      ),
    );
  });

  app.get("/ical/:token", async (c) => {
    const owner = await getUserByIcalToken(c.env.DB, c.req.param("token"));
    if (!owner) return c.text("Calendar not found.", 404);
    const start = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const entries = (await listReservationsOverlapping(c.env.DB, start, end)).filter(
      (entry) => entry.pilotId === owner.id || entry.instructorId === owner.id,
    );
    const events: IcalEvent[] = entries.map((entry) => ({
      uid: `${entry.id}@rampboard`,
      stamp: entry.updatedAt,
      start: entry.startsAt,
      end: entry.endsAt,
      summary: entry.instructorName ? `${entry.tailNumber} dual · ${entry.instructorName}` : `${entry.tailNumber} · ${entry.pilotName}`,
      description: [`Status: ${entry.status}`, entry.notes ?? ""].filter(Boolean).join("\n"),
      status: "CONFIRMED" as const,
    }));
    return c.body(buildIcal(events, `${owner.name} · ${ORG_NAME}`), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=300",
    });
  });
}

function dayBounds(day: string): { startIso: string; endIso: string } {
  return {
    startIso: zonedTimeToUtc(`${day}T00:00`).toISOString(),
    endIso: zonedTimeToUtc(`${addDays(day, 1)}T00:00`).toISOString(),
  };
}

function mustUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) throw new Error("Sign-in required.");
  return user;
}

function forbidden(c: Context<AppEnv>) {
  return c.html(document(<SimpleMessage title="Not allowed" message="Your role cannot do that." />), 403);
}

function canManage(user: User, entry: { pilotId: string; instructorId: string | null; createdBy: string | null }): boolean {
  if (user.role === "admin") return true;
  if (entry.pilotId === user.id || entry.instructorId === user.id) return true;
  return user.role === "instructor" && entry.createdBy === user.id;
}

function medicalBannerFor(user: User, today: string): string | null {
  if (!user.medicalExpiration) return "Your medical expiration is not on file. Add it under Account before you book.";
  if (user.medicalExpiration < today) return `Your medical expired on ${user.medicalExpiration}. You cannot book until it is updated.`;
  return null;
}

async function bookablePilots(c: Context<AppEnv>, user: User): Promise<User[]> {
  if (user.role === "renter") return [user];
  return listUsers(c.env.DB);
}

function valuesFromEntry(entry: ScheduleEntry): ReservationFormValues {
  return {
    aircraftId: entry.aircraftId,
    pilotId: entry.pilotId,
    instructorId: entry.instructorId ?? "",
    startsAt: parseLocalFromIso(entry.startsAt),
    endsAt: parseLocalFromIso(entry.endsAt),
    rateBasis: entry.rateBasis,
    notes: entry.notes ?? "",
    override: false,
  };
}

function parseLocalFromIso(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") map[part.type] = part.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

async function renderBookingForm(
  c: Context<AppEnv>,
  input: {
    mode: "create" | "edit";
    action: string;
    cancelHref: string;
    values: ReservationFormValues;
    errors: string[];
    warnings: string[];
    aircraft: Aircraft[];
    pilots: User[];
    instructors: User[];
  },
): Promise<Response> {
  const user = mustUser(c);
  return c.html(
    document(
      <ReservationFormPage
        viewer={viewerOf(user)}
        path="/schedule"
        usingDevSecret={c.get("usingDevSecret")}
        mode={input.mode}
        action={input.action}
        cancelHref={input.cancelHref}
        values={input.values}
        errors={input.errors}
        warnings={input.warnings}
        aircraft={input.aircraft}
        pilots={input.pilots}
        instructors={input.instructors}
        lockPilot={user.role === "renter"}
      />,
    ),
    input.errors.length ? 422 : 200,
  );
}

async function renderReservation(c: Context<AppEnv>, id: string, actionError: string | null): Promise<Response> {
  const user = mustUser(c);
  if (!isUuid(id)) return c.notFound();
  const entry = await getScheduleEntry(c.env.DB, id);
  if (!entry) return c.notFound();
  const [aircraft, pilot, checkout, log] = await Promise.all([
    getAircraft(c.env.DB, entry.aircraftId),
    getUserById(c.env.DB, entry.pilotId),
    getCheckout(c.env.DB, entry.pilotId, entry.aircraftId),
    getFlightLogByReservation(c.env.DB, entry.id),
  ]);
  const warnings =
    entry.status === "scheduled" && pilot && aircraft
      ? pilotEligibility({
          medicalExpiration: pilot.medicalExpiration,
          checkout,
          today: formatDayKey(new Date(entry.startsAt)),
          aircraftTail: aircraft.tailNumber,
        }).blocks.concat(
          pilotEligibility({
            medicalExpiration: pilot.medicalExpiration,
            checkout,
            today: formatDayKey(new Date(entry.startsAt)),
            aircraftTail: aircraft.tailNumber,
          }).warnings,
        )
      : [];
  return c.html(
    document(
      <ReservationPage
        viewer={viewerOf(user)}
        path="/schedule"
        notice={pageNotice(c.req.query("notice"))}
        usingDevSecret={c.get("usingDevSecret")}
        entry={entry}
        canManage={canManage(user, entry)}
        warnings={entry.status === "scheduled" ? warnings : []}
        log={log}
        hobbsSuggestion={aircraft?.hobbs == null ? "" : aircraft.hobbs.toFixed(1)}
        tachSuggestion={aircraft?.tach == null ? "" : aircraft.tach.toFixed(1)}
        aircraftRateCents={entry.rateBasis === "dry" ? aircraft?.hourlyDryCents ?? null : aircraft?.hourlyWetCents ?? null}
        instructorRateCents={entry.instructorId ? (await instructorRate(c, entry.instructorId)) : null}
        actionError={actionError}
      />,
    ),
    actionError ? 422 : 200,
  );
}

async function instructorRate(c: Context<AppEnv>, id: string): Promise<number> {
  const instructor = await getUserById(c.env.DB, id);
  return instructor?.instructorRateCents ?? 0;
}

async function saveBooking(c: Context<AppEnv>, existingId: string | null): Promise<Response> {
  const user = mustUser(c);
  const data = await readForm(c);
  const aircraftList = await listAircraft(c.env.DB);
  const instructors = await listInstructors(c.env.DB);
  const pilots = await bookablePilots(c, user);
  const existing = existingId ? await getScheduleEntry(c.env.DB, existingId) : null;
  if (existingId && !existing) return c.notFound();
  if (existing && (!canManage(user, existing) || existing.status !== "scheduled")) {
    return renderReservation(c, existing.id, "Only a scheduled reservation you are on can be edited.");
  }
  const values: ReservationFormValues = {
    aircraftId: field(data, "aircraft_id"),
    pilotId: user.role === "renter" ? user.id : field(data, "pilot_id"),
    instructorId: field(data, "instructor_id"),
    startsAt: field(data, "starts_at").slice(0, 16),
    endsAt: field(data, "ends_at").slice(0, 16),
    rateBasis: field(data, "rate_basis") === "dry" ? "dry" : "wet",
    notes: field(data, "notes"),
    override: field(data, "override_eligibility") === "yes",
  };
  const fail = async (errors: string[], warnings: string[] = []) =>
    renderBookingForm(c, {
      mode: existing ? "edit" : "create",
      action: existing ? `/reservations/${existing.id}` : "/reservations",
      cancelHref: existing ? `/reservations/${existing.id}` : "/schedule",
      values,
      errors,
      warnings,
      aircraft: aircraftList,
      pilots,
      instructors,
    });
  const errors: string[] = [];
  const aircraft = aircraftList.find((item) => item.id === values.aircraftId);
  const pilot = pilots.find((item) => item.id === values.pilotId) ?? (await getUserById(c.env.DB, values.pilotId));
  if (!aircraft) errors.push("Choose an aircraft.");
  if (!pilot || (user.role === "renter" && pilot.id !== user.id)) errors.push("Choose a pilot.");
  let instructor: User | null = null;
  if (values.instructorId) {
    instructor = instructors.find((item) => item.id === values.instructorId) ?? null;
    if (!instructor) errors.push("Choose an instructor from the list, or leave the flight solo.");
    if (instructor && pilot && instructor.id === pilot.id) errors.push("The instructor and the pilot have to be different people.");
  }
  const startsLocal = parseLocalDateTime(values.startsAt);
  const endsLocal = parseLocalDateTime(values.endsAt);
  if (!startsLocal || !endsLocal) errors.push("Enter a start and end in Pacific Time.");
  if (aircraft && values.rateBasis === "dry" && aircraft.hourlyDryCents == null) {
    errors.push(`${aircraft.tailNumber} does not have a dry rate. Choose wet, or set a dry rate on the aircraft.`);
  }
  if (values.notes.length > 2000) errors.push("Notes are too long.");
  if (errors.length || !aircraft || !pilot || !startsLocal || !endsLocal) return fail(errors);
  const startsAt = zonedTimeToUtc(startsLocal);
  const endsAt = zonedTimeToUtc(endsLocal);
  const windowError = validateReservationWindow(startsAt, endsAt);
  if (windowError) return fail([windowError]);
  const checkout = await getCheckout(c.env.DB, pilot.id, aircraft.id);
  const eligibility = pilotEligibility({
    medicalExpiration: pilot.medicalExpiration,
    checkout,
    today: formatDayKey(startsAt),
    aircraftTail: aircraft.tailNumber,
  });
  const decision = eligibilityAllowsBooking(eligibility, canBookDespiteEligibility(user.role, values.override && user.role === "admin"));
  if (!decision.ok) return fail(decision.blocks, decision.warnings);
  const startsIso = startsAt.toISOString();
  const endsIso = endsAt.toISOString();
  const clash = await findBookingClash(c.env.DB, {
    aircraftId: aircraft.id,
    pilotId: pilot.id,
    instructorId: instructor?.id ?? null,
    startsAt: startsIso,
    endsAt: endsIso,
    excludeId: existing?.id ?? null,
  });
  if (clash) return fail([clashMessage(clash)], decision.warnings);
  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const payload = {
    id,
    aircraftId: aircraft.id,
    pilotId: pilot.id,
    instructorId: instructor?.id ?? null,
    startsAt: startsIso,
    endsAt: endsIso,
    rateBasis: values.rateBasis as RateBasis,
    notes: values.notes || null,
    createdBy: existing?.createdBy ?? user.id,
    createdAt: now,
  };
  const saved = existing ? await updateReservationIfFree(c.env.DB, payload) : await insertReservationIfFree(c.env.DB, payload);
  if (!saved) {
    const again = await findBookingClash(c.env.DB, {
      aircraftId: aircraft.id,
      pilotId: pilot.id,
      instructorId: instructor?.id ?? null,
      startsAt: startsIso,
      endsAt: endsIso,
      excludeId: existing?.id ?? null,
    });
    return fail([again ? clashMessage(again) : "That time was just taken. Pick another slot."]);
  }
  const fresh = await getScheduleEntry(c.env.DB, id);
  if (fresh) await notify(c.env.DB, fresh, existing ? "updated" : "booked");
  return c.redirect(`/reservations/${id}?notice=${existing ? "updated" : "booked"}`, 303);
}

async function notify(db: D1Database, entry: ScheduleEntry, kind: "booked" | "updated" | "cancelled" | "checked_in", total?: string): Promise<void> {
  const sender = createEmailSender(db);
  const when = `${formatDateTime(entry.startsAt)}–${formatTime(entry.endsAt)}`;
  const recipients: Array<{ email: string; name: string }> = [];
  const pilot = await getUserById(db, entry.pilotId);
  if (pilot?.email) recipients.push({ email: pilot.email, name: pilot.name });
  if (entry.instructorId) {
    const instructor = await getUserById(db, entry.instructorId);
    if (instructor?.email && instructor.id !== pilot?.id) recipients.push({ email: instructor.email, name: instructor.name });
  }
  for (const recipient of recipients) {
    const message = reservationMessage({
      recipientName: recipient.name,
      tail: entry.tailNumber,
      when,
      pilotName: entry.pilotName,
      instructorName: entry.instructorName,
      kind,
      total,
    });
    await safeSend(sender, { ...message, to: recipient.email });
  }
}

function aircraftResources(aircraft: Aircraft[], day: string): BoardResource[] {
  return aircraft.map((item, index) => ({
    id: item.id,
    title: item.tailNumber,
    subtitle: item.status === "grounded" ? `${item.model} · grounded` : item.model,
    href: `/aircraft/${item.id}`,
    bookHref: `/reservations/new?aircraft=${item.id}&date=${day}`,
    tone: RESOURCE_TONES[index % RESOURCE_TONES.length] ?? "#1d4e89",
    grounded: item.status === "grounded",
  }));
}

function instructorResources(instructors: User[], day: string): BoardResource[] {
  return instructors.map((item, index) => ({
    id: item.id,
    title: item.name,
    subtitle: "Instructor",
    href: `/pilots/${item.id}`,
    bookHref: `/reservations/new?instructor=${item.id}&date=${day}`,
    tone: RESOURCE_TONES[index % RESOURCE_TONES.length] ?? "#1d4e89",
    grounded: false,
  }));
}

function boardEvents(board: "aircraft" | "instructors", reservations: ScheduleEntry[], maintenance: MaintenanceBlock[], aircraft: Aircraft[]): BoardEvent[] {
  const tails = new Map(aircraft.map((item) => [item.id, item.tailNumber]));
  const events: BoardEvent[] = [];
  for (const entry of reservations) {
    const time = `${formatTime(entry.startsAt)} to ${formatTime(entry.endsAt)}`;
    if (board === "aircraft") {
      events.push({
        id: entry.id,
        resourceId: entry.aircraftId,
        href: `/reservations/${entry.id}`,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        className: blockClass(entry.status),
        label: entry.pilotName,
        detail: entry.instructorName ?? "Solo",
        aria: `${entry.tailNumber}, ${entry.pilotName}, ${time}`,
      });
    } else if (entry.instructorId) {
      events.push({
        id: entry.id,
        resourceId: entry.instructorId,
        href: `/reservations/${entry.id}`,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        className: blockClass(entry.status),
        label: entry.pilotName,
        detail: entry.tailNumber,
        aria: `${entry.instructorName ?? "Instructor"} with ${entry.pilotName} on ${entry.tailNumber}, ${time}`,
      });
    }
  }
  if (board === "aircraft") {
    for (const block of maintenance) {
      const tail = tails.get(block.aircraftId) ?? "Aircraft";
      events.push({
        id: block.id,
        resourceId: block.aircraftId,
        href: `/aircraft/${block.aircraftId}`,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        className: "maint",
        label: "Maintenance",
        detail: block.reason,
        aria: `${tail} maintenance, ${block.reason}`,
      });
    }
  }
  return events;
}

function blockClass(status: ReservationStatus): string {
  if (status === "checked_out") return "out";
  if (status === "checked_in") return "in";
  return "scheduled";
}
