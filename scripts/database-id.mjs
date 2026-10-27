import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const databaseIdPattern = /"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/;

export function applyDatabaseId(text, id) {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return { ok: false, error: "Database id is not a valid id." };
  }
  const found = text.match(databaseIdPattern);
  if (!found) {
    return { ok: false, error: "Could not find database_id in wrangler.jsonc." };
  }
  if (found[1].toLowerCase() === id.toLowerCase()) {
    return { ok: true, changed: false, text };
  }
  return {
    ok: true,
    changed: true,
    text: text.replace(databaseIdPattern, `"database_id": "${id}"`),
  };
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const [path, id] = process.argv.slice(2);
  if (!path || !id) {
    console.error("Usage: node scripts/database-id.mjs <wrangler.jsonc> <database-id>");
    process.exit(1);
  }
  const text = readFileSync(path, "utf8");
  const result = applyDatabaseId(text, id);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.changed) {
    writeFileSync(path, result.text);
    console.log(`Saved database id ${id} in wrangler.jsonc.`);
  } else {
    console.log(`database id ${id} is already in wrangler.jsonc.`);
  }
}
