#!/usr/bin/env bash
# Publish Firehound Rental to Cloudflare without prompts.
#
# From the project folder, on the machine that has the API token:
#
#   export CLOUDFLARE_API_TOKEN='paste-the-token-here'
#   bash scripts/deploy-prod.sh
#
# If the token can see more than one account, also:
#
#   export CLOUDFLARE_ACCOUNT_ID='the-account-id'
#
# The token is never printed. The sign-in secret is generated and stored on
# the Worker named in wrangler.jsonc, and it is never printed. A new Worker
# name does not have the previous secret, so this script sets one. The D1
# database stays named rampboard. This script does not load the fake sample
# pilots. It adds N1561Y and Juan Valdivia only when the fleet is empty.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Set CLOUDFLARE_API_TOKEN to a Cloudflare API token, then run this script again." >&2
  echo "The token needs permission to edit Workers, edit D1, and read the account." >&2
  exit 1
fi

for tool in curl node npx; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "This script needs ${tool} on your PATH. Install Node.js 22 or newer, then run npm install in this folder." >&2
    exit 1
  fi
done

WORKER_NAME="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const text = readFileSync("wrangler.jsonc", "utf8");
  const match = text.match(/"name"\s*:\s*"([a-z0-9-]+)"/);
  if (!match) {
    console.error("Could not read the Worker name from wrangler.jsonc.");
    process.exit(1);
  }
  process.stdout.write(match[1]);
')"
echo "Publishing Worker ${WORKER_NAME}. The D1 database stays rampboard."

export CI=true
umask 077

scrub() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    let text = readFileSync(0, "utf8");
    for (const value of [process.env.CLOUDFLARE_API_TOKEN, process.env.REDACT_SECRET]) {
      if (value) text = text.split(value).join("[redacted]");
    }
    process.stdout.write(text);
  '
}

api() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local out
  out="$(mktemp)"
  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body" \
      "$url")" || { rm -f "$out"; echo "Could not reach the Cloudflare API." >&2; exit 1; }
  else
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "$url")" || { rm -f "$out"; echo "Could not reach the Cloudflare API." >&2; exit 1; }
  fi
  API_CODE="$code"
  API_BODY="$(cat "$out")"
  rm -f "$out"
}

api_error() {
  printf '%s' "$API_BODY" | scrub | node --input-type=module -e '
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    try {
      const data = JSON.parse(raw);
      const messages = (data.errors || []).map((error) => error.message).filter(Boolean);
      console.error(messages.join("; ") || "Cloudflare API request failed.");
    } catch {
      console.error("Cloudflare API request failed.");
    }
  '
}

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  api GET "https://api.cloudflare.com/client/v4/accounts?per_page=50"
  CLOUDFLARE_ACCOUNT_ID="$(printf '%s' "$API_BODY" | node --input-type=module -e '
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const data = JSON.parse(raw);
    if (!data.success) {
      const messages = (data.errors || []).map((error) => error.message).filter(Boolean);
      console.error(messages.join("; ") || "Could not list Cloudflare accounts.");
      process.exit(2);
    }
    const accounts = data.result || [];
    if (accounts.length === 0) {
      console.error("This API token cannot see any Cloudflare accounts.");
      process.exit(2);
    }
    if (accounts.length > 1) {
      console.error("This token can see more than one account. Set CLOUDFLARE_ACCOUNT_ID to the one that should own Firehound Rental:");
      for (const account of accounts) console.error(`  ${account.id}  ${account.name}`);
      process.exit(2);
    }
    process.stdout.write(accounts[0].id);
  ')" || exit 1
  export CLOUDFLARE_ACCOUNT_ID
  echo "Using Cloudflare account ${CLOUDFLARE_ACCOUNT_ID}."
else
  export CLOUDFLARE_ACCOUNT_ID
  echo "Using Cloudflare account ${CLOUDFLARE_ACCOUNT_ID}."
fi

api GET "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database?per_page=100"
database_id="$(printf '%s' "$API_BODY" | node --input-type=module -e '
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const data = JSON.parse(raw);
  if (!data.success) {
    const messages = (data.errors || []).map((error) => error.message).filter(Boolean);
    console.error(messages.join("; ") || "Could not list D1 databases.");
    process.exit(2);
  }
  const found = (data.result || []).find((database) => database.name === "rampboard");
  if (found) process.stdout.write(found.uuid);
')" || exit 1

if [[ -z "$database_id" ]]; then
  echo "Creating the D1 database named rampboard."
  api POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database" '{"name":"rampboard"}'
  database_id="$(printf '%s' "$API_BODY" | node --input-type=module -e '
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const data = JSON.parse(raw);
    if (!data.success) {
      const messages = (data.errors || []).map((error) => error.message).filter(Boolean);
      console.error(messages.join("; ") || "Could not create the D1 database.");
      process.exit(2);
    }
    process.stdout.write(data.result.uuid);
  ')" || exit 1
else
  echo "D1 database rampboard already exists."
fi

node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const id = process.argv[1];
  const path = "wrangler.jsonc";
  const text = readFileSync(path, "utf8");
  const next = text.replace(/"database_id"\s*:\s*"[0-9a-fA-F-]{36}"/, `"database_id": "${id}"`);
  if (next === text) {
    console.error("Could not find database_id in wrangler.jsonc.");
    process.exit(1);
  }
  if (next !== text) writeFileSync(path, next);
  console.log(`Saved database id ${id} in wrangler.jsonc.`);
' "$database_id"

echo "Applying database migrations."
npx wrangler d1 migrations apply rampboard --remote

count_json="$(mktemp)"
npx wrangler d1 execute rampboard --remote --yes --json --command "SELECT COUNT(*) AS n FROM aircraft" >"$count_json"
aircraft_count="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const raw = readFileSync(process.argv[1], "utf8");
  const data = JSON.parse(raw.slice(raw.indexOf("[")));
  const row = data[0]?.results?.[0];
  if (!row || row.n == null) {
    console.error("Could not read the aircraft count.");
    process.exit(1);
  }
  process.stdout.write(String(row.n));
' "$count_json")"
rm -f "$count_json"

if [[ "$aircraft_count" == "0" ]]; then
  echo "Fleet is empty. Adding N1561Y and Juan Valdivia."
  npx wrangler d1 execute rampboard --remote --yes --file scripts/prod-seed.sql
else
  echo "Fleet already has ${aircraft_count} aircraft. Leaving the database as it is."
fi

ensure_subdomain() {
  api GET "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain"
  local existing
  existing="$(printf '%s' "$API_BODY" | node --input-type=module -e '
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    try {
      const data = JSON.parse(raw);
      if (data.success && data.result && data.result.subdomain) process.stdout.write(data.result.subdomain);
    } catch { /* missing subdomain */ }
  ')" || true
  if [[ -n "$existing" ]]; then
    WORKERS_SUBDOMAIN="$existing"
    echo "workers.dev subdomain is ${WORKERS_SUBDOMAIN}."
    return 0
  fi
  local suffix name
  suffix="$(printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | tr -cd 'a-z0-9' | tail -c 8)"
  name="firehound-${suffix}"
  echo "This account has no workers.dev subdomain yet. Registering ${name}."
  api PUT "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain" "{\"subdomain\":\"${name}\"}"
  existing="$(printf '%s' "$API_BODY" | node --input-type=module -e '
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    try {
      const data = JSON.parse(raw);
      if (data.success && data.result && data.result.subdomain) process.stdout.write(data.result.subdomain);
    } catch { /* still missing */ }
  ')" || true
  if [[ -z "$existing" ]]; then
    echo "Firehound Rental could not register a workers.dev subdomain." >&2
    api_error >&2 || true
    echo "Open this page, choose a subdomain, then run this script again:" >&2
    echo "  https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/workers/onboarding" >&2
    echo "The database and migrations are already done. The script will not add a second copy of the airplane." >&2
    exit 1
  fi
  WORKERS_SUBDOMAIN="$existing"
  echo "Registered workers.dev subdomain ${WORKERS_SUBDOMAIN}."
}

ensure_subdomain

secret_is_set=0
secret_list="$(mktemp)"
if npx wrangler secret list --name "$WORKER_NAME" --format json >"$secret_list" 2>/dev/null; then
  if node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const raw = readFileSync(process.argv[1], "utf8");
    const start = raw.indexOf("[") === -1 ? raw.indexOf("{") : raw.indexOf("[");
    const data = JSON.parse(raw.slice(start));
    const list = Array.isArray(data) ? data : (data.secrets || data.result || []);
    process.exit(list.some((item) => item.name === "SESSION_SECRET") ? 0 : 1);
  ' "$secret_list"; then
    secret_is_set=1
  fi
fi
rm -f "$secret_list"

put_secret() {
  local out
  out="$(mktemp)"
  if printf '%s\n' "$1" | npx wrangler secret put SESSION_SECRET --name "$WORKER_NAME" >"$out" 2>&1; then
    REDACT_SECRET="$1" scrub <"$out"
    rm -f "$out"
    return 0
  fi
  REDACT_SECRET="$1" scrub <"$out" >&2
  rm -f "$out"
  return 1
}

if [[ "$secret_is_set" == "1" ]]; then
  echo "SESSION_SECRET is already set. Leaving it alone."
else
  secret="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
  echo "Saving a new sign-in secret in Cloudflare. The value is not printed."
  if ! put_secret "$secret"; then
    echo "The sign-in secret could not be saved before the first publish. Publishing, then saving it."
    npx wrangler deploy --name "$WORKER_NAME" | scrub
    put_secret "$secret"
  fi
  unset secret
  unset REDACT_SECRET || true
fi

echo "Publishing Firehound Rental."
deploy_log="$(mktemp)"
npx wrangler deploy --name "$WORKER_NAME" | tee "$deploy_log" | scrub
live_url="$(WORKER_NAME="$WORKER_NAME" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const text = readFileSync(process.argv[1], "utf8");
  const worker = process.env.WORKER_NAME;
  const matches = text.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/g) || [];
  const preferred = matches.find((url) => url.includes(`://${worker}.`)) || matches.at(-1) || "";
  process.stdout.write(preferred);
' "$deploy_log")"
rm -f "$deploy_log"

if [[ -z "$live_url" && -n "${WORKERS_SUBDOMAIN:-}" ]]; then
  live_url="https://${WORKER_NAME}.${WORKERS_SUBDOMAIN}.workers.dev"
fi

echo ""
echo "Firehound Rental is live: ${live_url}"
echo "Open that address and create your admin account. Juan Valdivia is already listed, with no email and no sign-in, at \$75 an hour. N1561Y is the airplane, at \$155 an hour wet, with no dry rate."
echo "Add Juan's email and a password later under People."
