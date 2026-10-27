import { spawnSync } from "node:child_process";

const local = process.argv.includes("--local");
if (!local && !process.argv.includes("--yes")) {
  console.error(
    "This adds N1561Y and Juan Valdivia to the Cloudflare database. It does not delete anything. Run `npm run db:seed:prod -- --yes` to apply it.",
  );
  process.exit(1);
}

const args = ["wrangler", "d1", "execute", "rampboard", local ? "--local" : "--remote", "--yes", "--file", "scripts/prod-seed.sql"];
const result = spawnSync("npx", args, { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

console.log("");
console.log("Production records are in place: N1561Y (Cessna 172C, $155/hour wet, no dry rate) and Juan Valdivia ($75/hour).");
console.log("Juan has no email and cannot sign in. Open the site and create your admin account, then add Juan's email and a password under People.");
