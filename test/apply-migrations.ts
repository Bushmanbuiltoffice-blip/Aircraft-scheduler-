import { applyD1Migrations, env } from "cloudflare:test";

type Migration = { name: string; queries: string[] };
type TestEnv = { DB: D1Database; TEST_MIGRATIONS: Migration[] };

const testEnv = env as unknown as TestEnv;
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
