import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildDemoSeedSql, DEMO_PASSWORD } from "../src/demo_seed";

const remote = process.argv.includes("--remote");
if (remote && !process.argv.includes("--yes")) {
  console.error(
    "Refusing to replace the live Cloudflare database. Seeding deletes every aircraft, person, reservation, and flight log. Run `npm run db:seed:remote -- --yes` only if you really want the sample data online.",
  );
  process.exit(1);
}

const sql = await buildDemoSeedSql(new Date());
const file = "seed.generated.sql";
writeFileSync(file, sql);
const args = ["wrangler", "d1", "execute", "rampboard", remote ? "--remote" : "--local", "--file", file];
const result = spawnSync("npx", args, { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

console.log("");
console.log("Sample data is loaded. Every demo login uses the same password.");
console.log(`Password: ${DEMO_PASSWORD}`);
console.log("Admin:       kyle.bushman@example.com");
console.log("Instructor:  maya.chen@example.com");
console.log("Pilot:       priya.shah@example.com");
console.log("Expired medical (booking is blocked): sam.okonkwo@example.com");
