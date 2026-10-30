/** @jsxImportSource hono/jsx */
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { sessionSecret } from "./auth";
import { CSRF_COOKIE, CSRF_FIELD, csrfTokenMatches, ensureCsrfCookie, injectCsrfField, originVerdict } from "./csrf";
import { countAdmins, userForSession } from "./db";
import { readSessionCookie } from "./http";
import { registerAuth } from "./routes_auth";
import { registerFleet } from "./routes_fleet";
import { registerInvites } from "./routes_invite";
import { registerResources } from "./routes_resources";
import { registerSchedule } from "./routes_schedule";
import { ORG_NAME, type AppEnv } from "./types";
import { document, SimpleMessage, TryAgainPage } from "./ui";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true, service: "firehound-rental" }));

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD") {
      const token = ensureCsrfCookie(c);
      await next();
      const type = c.res.headers.get("content-type") ?? "";
      if (method === "GET" && type.includes("text/html")) {
        const body = await c.res.text();
        if (/<form\b/i.test(body)) {
          const headers = new Headers(c.res.headers);
          headers.delete("content-length");
          c.res = new Response(injectCsrfField(body, token), { status: c.res.status, headers });
        } else {
          c.res = new Response(body, c.res);
        }
      }
      return;
    }
    const verdict = originVerdict({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
      host: new URL(c.req.url).host,
    });
    if (verdict === "cross") return blocked(c);
    if (verdict === "unknown") {
      const type = c.req.header("content-type") ?? "";
      let formToken: string | undefined;
      if (/application\/x-www-form-urlencoded|multipart\/form-data/i.test(type)) {
        const body = await c.req.parseBody();
        const value = body[CSRF_FIELD];
        formToken = typeof value === "string" ? value : undefined;
      }
      if (!csrfTokenMatches(getCookie(c, CSRF_COOKIE), formToken)) return blocked(c);
    }
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
  registerInvites(app);
  registerFleet(app);
  registerSchedule(app);
  registerResources(app);

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
  return path === "/login" || path === "/setup" || path === "/health" || path.startsWith("/ical/") || path.startsWith("/invite/");
}

function blocked(c: Context<AppEnv>) {
  const path = new URL(c.req.url).pathname;
  const retry = path.startsWith("/") && !path.startsWith("//") ? path : "/login";
  return c.html(document(<TryAgainPage href={retry} />), 403);
}
