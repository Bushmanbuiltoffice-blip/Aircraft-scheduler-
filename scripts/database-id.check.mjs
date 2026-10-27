import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyDatabaseId } from "./database-id.mjs";

const currentId = "42ed7f5a-9174-427d-98fa-f7e3b111eb9a";
const placeholder = "00000000-0000-0000-0000-000000000000";
const config = (id) => `{
  "d1_databases": [
    {
      "database_name": "rampboard",
      "database_id": "${id}"
    }
  ]
}
`;

test("an already-correct database id is left unchanged", () => {
  const text = config(currentId);
  const result = applyDatabaseId(text, currentId);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.text, text);
});

test("a different database id is replaced", () => {
  const result = applyDatabaseId(config(placeholder), currentId);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(result.text, new RegExp(currentId));
  assert.doesNotMatch(result.text, new RegExp(placeholder));
});

test("missing database_id fails", () => {
  const result = applyDatabaseId("{}\n", currentId);
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not find database_id/);
});

test("the command succeeds when wrangler.jsonc already has the id", () => {
  const dir = mkdtempSync(join(tmpdir(), "firehound-db-id-"));
  const path = join(dir, "wrangler.jsonc");
  const text = config(currentId);
  writeFileSync(path, text);
  const script = fileURLToPath(new URL("./database-id.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [script, path, currentId], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /already in wrangler\.jsonc/);
  assert.equal(readFileSync(path, "utf8"), text);
});
