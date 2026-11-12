/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import { getAircraft, insertTbxEntry, listFlightLogs, listTbxEntries } from "./db";
import { checked, readForm, viewerOf } from "./http";
import { parseMeter } from "./format";
import { TbxPage } from "./pages_tbx";
import type { AppEnv, User } from "./types";
import { document, SimpleMessage } from "./ui";

/**
 * TBX (airworthy.com) has no documented public API, webhook, or email-in for aircraft times,
 * so this is a manual hand-off: show the numbers, export the flights, and record what was entered.
 */
export function registerTbx(app: Hono<AppEnv>): void {
  app.get("/aircraft/:id/tbx", async (c) => {
    const user = adminOnly(c);
    if (!user) return forbidden(c);
    return renderTbx(c, user, c.req.query("notice") === "tbx-entered" ? "Marked as entered in TBX." : null, null);
  });

  app.post("/aircraft/:id/tbx", async (c) => {
    const user = adminOnly(c);
    if (!user) return forbidden(c);
    const aircraft = await getAircraft(c.env.DB, c.req.param("id"));
    if (!aircraft) return c.notFound();
    const data = await readForm(c);
    if (!checked(data, "entered")) return renderTbx(c, user, null, "Tick the box once you have entered the times in TBX.", 422);
    const hobbs = parseMeter(data.hobbs ?? "");
    const tach = parseMeter(data.tach ?? "");
    // Only record what is on screen right now; if a flight checked in meanwhile, show the new numbers instead.
    if (hobbs == null || tach == null || hobbs !== aircraft.hobbs || tach !== aircraft.tach) {
      return renderTbx(c, user, null, "The meters changed since this page loaded. Check the new numbers, enter them in TBX, then mark again.", 409);
    }
    await insertTbxEntry(c.env.DB, { aircraftId: aircraft.id, hobbs, tach, enteredBy: user.id });
    return c.redirect(`/aircraft/${aircraft.id}/tbx?notice=tbx-entered`, 303);
  });

  app.get("/aircraft/:id/tbx.csv", async (c) => {
    const user = adminOnly(c);
    if (!user) return forbidden(c);
    const aircraft = await getAircraft(c.env.DB, c.req.param("id"));
    if (!aircraft) return c.notFound();
    const all = c.req.query("all") === "1";
    const last = (await listTbxEntries(c.env.DB, aircraft.id, 1))[0] ?? null;
    const flights = (await listFlightLogs(c.env.DB, { aircraftId: aircraft.id, sinceIso: all ? null : last?.enteredAt ?? null, limit: 1000 })).reverse();
    const rows = [
      ["date_utc", "tail_number", "pilot", "tach_out", "tach_in", "tach_hours", "hobbs_out", "hobbs_in", "hobbs_hours"],
      ...flights.map((log) => [
        log.createdAt,
        aircraft.tailNumber,
        log.pilotName,
        meter(log.tachOut),
        meter(log.tachIn),
        log.tachOut != null && log.tachIn != null ? (Math.round((log.tachIn - log.tachOut) * 10) / 10).toFixed(1) : "",
        meter(log.hobbsOut),
        meter(log.hobbsIn),
        log.flightHours.toFixed(1),
      ]),
    ];
    const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const day = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${aircraft.tailNumber}-tbx-times-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}

async function renderTbx(c: Context<AppEnv>, user: User, notice: string | null, error: string | null, status: 200 | 409 | 422 = 200) {
  const aircraft = await getAircraft(c.env.DB, c.req.param("id") ?? "");
  if (!aircraft) return c.notFound();
  const entries = await listTbxEntries(c.env.DB, aircraft.id, 10);
  const flights = await listFlightLogs(c.env.DB, { aircraftId: aircraft.id, sinceIso: entries[0]?.enteredAt ?? null, limit: 200 });
  c.header("Cache-Control", "no-store");
  return c.html(
    document(
      <TbxPage viewer={viewerOf(user)} usingDevSecret={c.get("usingDevSecret")} aircraft={aircraft} entries={entries} flights={flights} notice={notice} error={error} />,
    ),
    status,
  );
}

function meter(value: number | null): string {
  return value == null ? "" : value.toFixed(1);
}

function csvCell(value: string): string {
  // Quote everything and neutralize spreadsheet formulas.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function adminOnly(c: Context<AppEnv>): User | null {
  const user = c.get("user");
  return user && user.role === "admin" ? user : null;
}

function forbidden(c: Context<AppEnv>) {
  return c.html(document(<SimpleMessage title="Not allowed" message="Only admins can use the TBX update page." />), 403);
}
