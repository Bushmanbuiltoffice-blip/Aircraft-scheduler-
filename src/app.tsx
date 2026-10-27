/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { sessionSecret } from "./auth";
import { countAdmins, userForSession } from "./db";
import { readSessionCookie } from "./http";
import { registerAuth } from "./routes_auth";
import { registerFleet } from "./routes_fleet";
import { registerSchedule } from "./routes_schedule";
import { ORG_NAME, type AppEnv } from "./types";
import { document, SimpleMessage } from "./ui";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true, service: "firehound-rental" }));

  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      await next();
      return;
    }
    const origin = c.req.header("origin");
    if (!origin) {
      await next();
      return;
    }
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return c.text("Cross-site request blocked.", 403);
    }
    if (originHost !== new URL(c.req.url).host) return c.text("Cross-site request blocked.", 403);
    await next();
  });

  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    if (path === "/health") {
      await next();
      return;
    }
    let admins = 0;
    try {
      admins = await countAdmins(c.env.DB);
    } catch (error) {
      if (error instanceof Error && /no such table/i.test(error.message)) {
        return c.html(
          document(
            <SimpleMessage
              title="Database not ready"
              message="The database tables have not been created yet. Run the migration command from the README, then reload this page."
            />,
          ),
          500,
        );
      }
      throw error;
    }
    if (admins === 0 && path !== "/setup" && path !== "/health") return c.redirect("/setup");
    if (admins > 0 && path === "/setup") return c.notFound();
    const { secret, usingDevFallback } = sessionSecret(c.env);
    c.set("usingDevSecret", usingDevFallback);
    const token = readSessionCookie(c);
    c.set("user", token ? await userForSession(c.env.DB, token, secret) : null);
    if (!isPublic(path) && !c.get("user")) {
      const nextUrl = `${path}${url.search}`;
      return c.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }
    await next();
  });

  registerAuth(app);
  registerFleet(app);
  registerSchedule(app);

  app.notFound((c) =>
    c.html(document(<SimpleMessage title="Page not found" message={`That page is not on ${ORG_NAME}.`} />), 404),
  );

  app.onError((error, c) => {
    console.error(error);
    const message = error instanceof Error && /no such table/i.test(error.message)
      ? "The database tables have not been created yet. Run the migration command from the README, then reload this page."
      : "The error was logged. If you are running this on your computer, look at the Wrangler window for details.";
    return c.html(document(<SimpleMessage title="Something went wrong" message={message} />), 500);
  });

  return app;
}

function isPublic(path: string): boolean {
  return path === "/login" || path === "/setup" || path === "/health" || path.startsWith("/ical/");
}
