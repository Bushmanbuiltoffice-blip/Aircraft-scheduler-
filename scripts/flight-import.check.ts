import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BILLED_OUTSIDE_LABEL } from "../src/format";
import { buildFlightImport } from "./flight-import";

const root = fileURLToPath(new URL("..", import.meta.url));
const csvPath = join(root, "data/import/n1561y_flights_2026-09-05_to_2026-10-22.csv");
const csv = readFileSync(csvPath, "utf8");

test("the paper log plans 24 zero-charge flights and separate Noah names", async () => {
  const juan = { id: "00000000-0000-4000-8000-000000000002", name: "Juan Valdivia", role: "instructor" };
  const aircraft = { id: "00000000-0000-4000-8000-000000000101", tailNumber: "N1561Y", hourlyWetCents: 15500 };
  const plan = await buildFlightImport({ csv, aircraft, users: [juan], bill: false, instructorRateCents: 65_00 });
  assert.equal(plan.flights.length, 24);
  assert.equal(plan.totalCostCents, 0);
  assert.equal(plan.bill, false);
  assert.ok(Math.abs(plan.hobbs - 318.6) < 0.001);
  assert.ok(Math.abs(plan.tach - 467.4) < 0.001);
  assert.deepEqual(plan.reusedPilots, ["Juan Valdivia"]);
  assert.deepEqual(plan.guestInstructors, ["Hannah Edward's"]);
  assert.ok(plan.createdPilots.includes("Noah"));
  assert.ok(plan.createdPilots.includes("Noah Burkhardt"));
  assert.equal(plan.createdPilots.includes("Juan Valdivia"), false);
  assert.equal(plan.createdPilots.includes("Hannah Edward's"), false);
  assert.match(plan.text, /ignored|not applied/i);
  assert.match(plan.sql, new RegExp(BILLED_OUTSIDE_LABEL.replace(/[.]/g, "\\.")));
  assert.equal(plan.sql.includes("DELETE"), false);
  const again = await buildFlightImport({ csv, aircraft, users: [juan], bill: false, instructorRateCents: null });
  assert.equal(again.sql, plan.sql);
  const discovery = plan.flights.find((flight) => flight.rentalType === "Discovery flight");
  assert.equal(discovery?.pilotName, "Noah");
  assert.equal(discovery?.instructorId, juan.id);
  assert.equal(discovery?.totalCostCents, 0);
  const ends = plan.flights.map((flight) => flight.endsAt).sort();
  assert.ok(ends[ends.length - 1]! < "2026-10-23");
  const byDate = new Map<string, typeof plan.flights>();
  for (const flight of plan.flights) {
    const list = byDate.get(flight.date) ?? [];
    list.push(flight);
    byDate.set(flight.date, list);
  }
  for (const list of byDate.values()) {
    const ordered = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let index = 1; index < ordered.length; index += 1) {
      assert.ok(ordered[index]!.startsAt >= ordered[index - 1]!.endsAt);
    }
  }
});

test("import-flights.sh applies the paper log to a local database twice without charges", { timeout: 300_000 }, () => {
  const persist = mkdtempSync(join(tmpdir(), "firehound-import-"));
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  wrangler(env, ["d1", "migrations", "apply", "rampboard", "--local", "--persist-to", persist]);
  wrangler(env, ["d1", "execute", "rampboard", "--local", "--persist-to", persist, "--yes", "--file", "scripts/prod-seed.sql"]);
  wrangler(env, [
    "d1",
    "execute",
    "rampboard",
    "--local",
    "--persist-to",
    persist,
    "--yes",
    "--command",
    `INSERT INTO users (id, email, password_hash, name, role, ical_token, created_at) VALUES ('00000000-0000-4000-8000-00000000f201', 'keep@example.com', 'disabled', 'Keep Me', 'renter', 'keep-me-ical-token-0123456789abcdef', '2026-10-01T00:00:00.000Z');
     INSERT INTO reservations (id, aircraft_id, pilot_id, instructor_id, starts_at, ends_at, status, rate_basis, notes, created_by, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', NULL, '2026-12-01T17:00:00.000Z', '2026-12-01T19:00:00.000Z', 'scheduled', 'wet', 'keep-this-future-flight', '00000000-0000-4000-8000-000000000002', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');`,
  ]);

  const script = join(root, "scripts/import-flights.sh");
  runImport(env, script, persist);
  const first = snapshot(env, persist);
  assert.equal(first.logs, 24);
  assert.equal(first.cents, 0);
  assert.equal(first.external, 24);
  assert.equal(first.active, 1);
  assert.equal(first.maintenanceBlocks, 0);
  assert.equal(first.juans, 1);
  assert.equal(first.hannahs, 0);
  assert.equal(first.noah, 1);
  assert.equal(first.noahBurkhardt, 1);
  assert.equal(first.keep, 1);
  assert.equal(first.future, 1);
  assert.ok(Math.abs(first.hobbs - 318.6) < 0.001);
  assert.ok(Math.abs(first.tach - 467.4) < 0.001);
  assert.ok(first.maxEnd < "2026-10-23");

  runImport(env, script, persist);
  const second = snapshot(env, persist);
  assert.equal(second.logs, 24);
  assert.equal(second.cents, 0);
  assert.equal(second.future, 1);
  assert.equal(second.keep, 1);
  assert.ok(Math.abs(second.hobbs - 318.6) < 0.001);

  wrangler(env, [
    "d1",
    "execute",
    "rampboard",
    "--local",
    "--persist-to",
    persist,
    "--yes",
    "--command",
    "UPDATE aircraft SET hobbs = 9000, tach = 9000 WHERE tail_number = 'N1561Y';",
  ]);
  runImport(env, script, persist);
  const held = snapshot(env, persist);
  assert.equal(held.logs, 24);
  assert.ok(Math.abs(held.hobbs - 9000) < 0.001);
  assert.ok(Math.abs(held.tach - 9000) < 0.001);
  assert.equal(held.cents, 0);
});

function runImport(env: NodeJS.ProcessEnv, script: string, persist: string): void {
  const result = spawnSync("bash", [script, csvPath, "--local", "--persist-to", persist], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`import failed\n${result.stdout}\n${result.stderr}`);
  }
  assert.match(result.stdout, /Historical import, billed outside app/);
  assert.match(result.stdout, /zero charges|\$0\.00/);
}

function snapshot(env: NodeJS.ProcessEnv, persist: string): {
  logs: number;
  cents: number;
  external: number;
  active: number;
  maintenanceBlocks: number;
  juans: number;
  hannahs: number;
  noah: number;
  noahBurkhardt: number;
  keep: number;
  future: number;
  hobbs: number;
  tach: number;
  maxEnd: string;
} {
  const sets = wrangler(env, [
    "d1",
    "execute",
    "rampboard",
    "--local",
    "--persist-to",
    persist,
    "--yes",
    "--json",
    "--command",
    `SELECT
       (SELECT COUNT(*) FROM flight_logs) AS logs,
       (SELECT COALESCE(SUM(total_cost_cents), 0) FROM flight_logs) AS cents,
       (SELECT COUNT(*) FROM flight_logs WHERE billing_status = 'external' AND billing_note = '${BILLED_OUTSIDE_LABEL}') AS external,
       (SELECT COUNT(*) FROM reservations WHERE status IN ('scheduled', 'checked_out')) AS active,
       (SELECT COUNT(*) FROM maintenance_blocks) AS maintenance_blocks,
       (SELECT COUNT(*) FROM users WHERE name = 'Juan Valdivia') AS juans,
       (SELECT COUNT(*) FROM users WHERE name LIKE 'Hannah%') AS hannahs,
       (SELECT COUNT(*) FROM users WHERE name = 'Noah' AND email IS NULL AND password_hash = 'disabled') AS noah,
       (SELECT COUNT(*) FROM users WHERE name = 'Noah Burkhardt' AND email IS NULL AND password_hash = 'disabled') AS noah_burkhardt,
       (SELECT COUNT(*) FROM users WHERE name = 'Keep Me') AS keep,
       (SELECT COUNT(*) FROM reservations WHERE notes = 'keep-this-future-flight' AND status = 'scheduled') AS future,
       (SELECT hobbs FROM aircraft WHERE tail_number = 'N1561Y') AS hobbs,
       (SELECT tach FROM aircraft WHERE tail_number = 'N1561Y') AS tach,
       (SELECT MAX(ends_at) FROM reservations WHERE status = 'checked_in') AS max_end;`,
  ]);
  const row = sets[0]?.[0] ?? {};
  return {
    logs: Number(row.logs),
    cents: Number(row.cents),
    external: Number(row.external),
    active: Number(row.active),
    maintenanceBlocks: Number(row.maintenance_blocks),
    juans: Number(row.juans),
    hannahs: Number(row.hannahs),
    noah: Number(row.noah),
    noahBurkhardt: Number(row.noah_burkhardt),
    keep: Number(row.keep),
    future: Number(row.future),
    hobbs: Number(row.hobbs),
    tach: Number(row.tach),
    maxEnd: String(row.max_end ?? ""),
  };
}

function wrangler(env: NodeJS.ProcessEnv, args: string[]): Array<Array<Record<string, unknown>>> {
  const result = spawnSync("npx", ["wrangler", ...args], { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  if (!args.includes("--json")) return [];
  return resultSets(`${result.stdout}\n${result.stderr}`);
}

function resultSets(raw: string): Array<Array<Record<string, unknown>>> {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`No JSON in wrangler output:\n${raw.slice(0, 1200)}`);
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ results?: Array<Record<string, unknown>>; success?: boolean; error?: string }>;
  return parsed.map((entry) => {
    if (entry.success === false) throw new Error(entry.error || "D1 query failed");
    return entry.results ?? [];
  });
}
