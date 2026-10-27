#!/usr/bin/env bash
# Import a paper flight log into D1.
#
# Default is the live database, with no charges. These historical flights
# were already paid outside the app.
#
#   npm run db:migrate:remote
#   bash scripts/import-flights.sh data/import/n1561y_flights_2026-09-05_to_2026-10-22.csv
#
# Rehearse on this computer:
#
#   bash scripts/import-flights.sh data/import/n1561y_flights_2026-09-05_to_2026-10-22.csv --local
#
# The command is safe to run again. It adds missing rows and leaves existing
# rows in place. Hobbs and tach move forward only when the saved readings are
# blank or lower.
set -euo pipefail

cd "$(dirname "$0")/.."

CSV=""
RATE=""
BILL=0
TARGET=""
PERSIST=""

usage() {
  echo "Usage: bash scripts/import-flights.sh <csv> [--instructor-rate N] [--bill] [--no-billing] [--remote] [--local] [--persist-to DIR]" >&2
  echo "Billing is off unless you pass --bill. The paper log should be imported with billing off." >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instructor-rate)
      RATE="${2:-}"
      if [[ -z "$RATE" ]]; then
        echo "Pass a number after --instructor-rate." >&2
        exit 1
      fi
      shift 2
      ;;
    --bill)
      BILL=1
      shift
      ;;
    --no-billing)
      BILL=0
      shift
      ;;
    --local)
      if [[ "$TARGET" == "remote" ]]; then
        echo "Pass either --local or --remote, not both." >&2
        exit 1
      fi
      TARGET="local"
      shift
      ;;
    --remote)
      if [[ "$TARGET" == "local" ]]; then
        echo "Pass either --local or --remote, not both." >&2
        exit 1
      fi
      TARGET="remote"
      shift
      ;;
    --persist-to)
      PERSIST="${2:-}"
      if [[ -z "$PERSIST" ]]; then
        echo "Pass a directory after --persist-to." >&2
        exit 1
      fi
      if [[ "$TARGET" == "remote" ]]; then
        echo "--persist-to is only for a local database." >&2
        exit 1
      fi
      TARGET="local"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "$CSV" ]]; then
        echo "Pass one CSV file." >&2
        exit 1
      fi
      CSV="$1"
      shift
      ;;
  esac
done

if [[ -z "$CSV" ]]; then
  usage
  exit 1
fi
if [[ ! -f "$CSV" ]]; then
  echo "CSV not found: $CSV" >&2
  exit 1
fi
if [[ -z "$TARGET" ]]; then
  TARGET="remote"
fi

for tool in npx node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "This script needs ${tool}. Install Node.js 22 or newer, then run npm install in this folder." >&2
    exit 1
  fi
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

d1() {
  local args=(npx wrangler d1 execute rampboard --yes)
  if [[ "$TARGET" == "local" ]]; then
    args+=(--local)
    if [[ -n "$PERSIST" ]]; then
      args+=(--persist-to "$PERSIST")
    fi
  else
    args+=(--remote)
  fi
  "${args[@]}" "$@"
}

echo "Reading people and N1561Y from the ${TARGET} database."
d1 --json --command "SELECT name FROM pragma_table_info('flight_logs') WHERE name = 'billing_status'; SELECT id, name, role FROM users; SELECT id, tail_number, hourly_wet_cents FROM aircraft WHERE tail_number = 'N1561Y';" >"$tmp/lookup.json"

gen=(npx tsx scripts/generate-flight-import-sql.ts --csv "$CSV" --lookup "$tmp/lookup.json" --out "$tmp/import.sql")
if [[ "$BILL" == "1" ]]; then
  gen+=(--bill)
fi
if [[ -n "$RATE" ]]; then
  gen+=(--instructor-rate "$RATE")
fi
"${gen[@]}"

echo "Applying import SQL."
d1 --json --file "$tmp/import.sql" >"$tmp/apply.json"
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const raw = readFileSync(process.argv[1], "utf8");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) {
    console.error(raw);
    process.exit(1);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    console.error(raw);
    process.exit(1);
  }
  for (const entry of parsed) {
    if (entry && entry.success === false) {
      console.error(entry.error || "A SQL statement failed.");
      process.exit(1);
    }
  }
' "$tmp/apply.json"

echo "Import finished. Running it again will not add duplicate flights."
