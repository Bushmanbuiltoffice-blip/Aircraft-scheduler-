import type { Hono } from "hono";
import {
  emailError,
  hashPassword,
  newToken,
  normalizeEmail,
  passwordError,
  placeholderPasswordHash,
  sessionSecret,
  verifyPassword,
} from "./auth";
import { createSession, deleteSession, getUserByEmail, insertUser, isUniqueError } from "./db";
import { clearSessionCookie, field, readForm, readSessionCookie, safeNext, setSessionCookie } from "./http";
import { LoginPage, SetupPage } from "./pages_auth";
import { document } from "./ui";
import { SESSION_DAYS, type AppEnv } from "./types";

export function registerAuth(app: Hono<AppEnv>): void {
  app.get("/login", (c) => {
    if (c.get("user")) return c.redirect("/");
    return c.html(document(<LoginPage next={safeNext(c.req.query("next"))} />));
  });

  app.post("/login", async (c) => {
    const data = await readForm(c);
    const email = normalizeEmail(field(data, "email"));
    const password = data.password ?? "";
    const next = safeNext(field(data, "next"));
    const user = email ? await getUserByEmail(c.env.DB, email) : null;
    const valid = await verifyPassword(password, user?.passwordHash ?? (await placeholderPasswordHash()));
    if (!user || !valid) {
      return c.html(document(<LoginPage error="Email or password is incorrect." email={email} next={next} />), 401);
    }
    const token = newToken();
    await createSession(c.env.DB, user.id, token, sessionSecret(c.env).secret, SESSION_DAYS);
    setSessionCookie(c, token);
    return c.redirect(next, 303);
  });

  app.post("/logout", async (c) => {
    const token = readSessionCookie(c);
    if (token) await deleteSession(c.env.DB, token, sessionSecret(c.env).secret);
    clearSessionCookie(c);
    return c.redirect("/login", 303);
  });

  app.get("/setup", (c) => c.html(document(<SetupPage />)));

  app.post("/setup", async (c) => {
    const data = await readForm(c);
    const name = field(data, "name");
    const email = normalizeEmail(field(data, "email"));
    const password = data.password ?? "";
    const confirm = data.confirm ?? "";
    const errors: string[] = [];
    if (name.length < 2 || name.length > 120) errors.push("Enter your name.");
    const emailProblem = emailError(email);
    if (emailProblem) errors.push(emailProblem);
    const passwordProblem = passwordError(password);
    if (passwordProblem) errors.push(passwordProblem);
    if (password !== confirm) errors.push("Those passwords do not match.");
    if (errors.length) return c.html(document(<SetupPage errors={errors} name={name} email={email} />), 422);
    const userId = crypto.randomUUID();
    try {
      await insertUser(c.env.DB, {
        id: userId,
        email,
        passwordHash: await hashPassword(password),
        name,
        role: "admin",
        phone: null,
        certificateType: null,
        certificateNumber: null,
        medicalClass: null,
        medicalExpiration: null,
        instructorRateCents: null,
        icalToken: newToken(),
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (isUniqueError(error)) {
        return c.html(document(<SetupPage errors={["That email is already in use."]} name={name} email={email} />), 422);
      }
      throw error;
    }
    const token = newToken();
    await createSession(c.env.DB, userId, token, sessionSecret(c.env).secret, SESSION_DAYS);
    setSessionCookie(c, token);
    return c.redirect("/", 303);
  });
}
