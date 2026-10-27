import { readFileSync, writeFileSync } from "node:fs";
import { buildFlightImport, parseDollars, type ImportAircraft, type ImportUser } from "./flight-import";

const csvPath = arg("--csv");
const lookupPath = arg("--lookup");
const outPath = arg("--out");
const rateArg = arg("--instructor-rate");
const bill = process.argv.includes("--bill");

if (!csvPath || !lookupPath || !outPath) {
  console.error("Usage: tsx scripts/generate-flight-import-sql.ts --csv <file> --lookup <wrangler.json> --out <file.sql> [--bill --instructor-rate 75]");
  process.exit(1);
}

try {
  const sets = resultSets(readFileSync(lookupPath, "utf8"));
  if (sets.length < 3) throw new Error("Expected schema, people, and aircraft results from the database lookup.");
  const [schema, people, aircraftRows] = sets;
  if (!schema?.some((row) => row.name === "billing_status")) {
    throw new Error(
      "The flight log table is missing the import columns. Apply migrations first: npm run db:migrate:remote (or npm run db:migrate:local for a --local import).",
    );
  }
  const users: ImportUser[] = (people ?? []).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
  }));
  const aircraftRow = aircraftRows?.[0];
  if (!aircraftRow) throw new Error("N1561Y is not in this database. Add the airplane with the production seed, then import again.");
  const aircraft: ImportAircraft = {
    id: String(aircraftRow.id ?? ""),
    tailNumber: String(aircraftRow.tail_number ?? ""),
    hourlyWetCents: Number(aircraftRow.hourly_wet_cents),
  };
  const plan = await buildFlightImport({
    csv: readFileSync(csvPath, "utf8"),
    aircraft,
    users,
    bill,
    instructorRateCents: rateArg == null || rateArg === "" ? null : parseDollars(rateArg),
  });
  writeFileSync(outPath, plan.sql);
  console.log(plan.text);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function resultSets(raw: string): Array<Array<Record<string, unknown>>> {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`Wrangler did not return JSON.\n${raw.slice(0, 800)}`);
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Unexpected wrangler JSON.");
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { results?: Array<Record<string, unknown>>; success?: boolean; error?: string };
    if (record.success === false) throw new Error(record.error || "Database lookup failed.");
    return record.results ?? [];
  });
}
