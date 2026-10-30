/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import { emailError, hashPassword, newToken, normalizeEmail, passwordError, sessionSecret } from "./auth";
import { createSession, getUserById, isUniqueError } from "./db";
import { field, readForm, setSessionCookie, viewerOf } from "./http";
import { createInvite, hasWorkingLogin, inviteMessage, lookupInvite, mailtoHref, redeemInvite, smsHref } from "./invites";
import { InviteInvalidPage, InviteLinkPage, InvitePage } from "./pages_invite";
import { document, SimpleMessage } from "./ui";
import { SESSION_DAYS, type AppEnv } from "./types";

function noStore(c: Context<AppEnv>): void {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
}

export function registerInvites(app: Hono<AppEnv>): void {
  app.post("/pilots/:id/invite", async (c) => {
    const user = c.get("user");
    if (!user || user.role !== "admin") {
      return c.html(document(<SimpleMessage title="Not allowed" message="Your role cannot do that." />), 403);
    }
    const person = await getUserById(c.env.DB, c.req.param("id"));
    if (!person) return c.notFound();
    if (person.deletedAt) {
      return c.html(document(<SimpleMessage title="Person removed" message={`${person.name} was removed and cannot be invited.`} />), 409);
    }
    const { token, expiresAt } = await createInvite(c.env.DB, { userId: person.id, createdBy: user.id });
    const url = `${new URL(c.req.url).origin}/invite/${token}`;
    const message = inviteMessage(url);
    noStore(c);
    return c.html(
      document(
        <InviteLinkPage
          viewer={viewerOf(user)}
          usingDevSecret={c.get("usingDevSecret")}
          person={person}
          url={url}
          expiresAt={expiresAt}
          reset={hasWorkingLogin(person)}
          smsHref={smsHref(person.phone, message)}
          mailtoHref={person.email ? mailtoHref(person.email, message) : null}
          message={message}
        />,
      ),
    );
  });

  app.get("/invite/:token", async (c) => {
    noStore(c);
    const token = c.req.param("token");
    const found = await lookupInvite(c.env.DB, token);
    if (!found.ok) return c.html(document(<InviteInvalidPage reason={found.reason} />), 410);
    return c.html(document(<InvitePage name={found.user.name} email={found.user.email ?? ""} action={`/invite/${token}`} />));
  });

  app.post("/invite/:token", async (c) => {
    noStore(c);
    const token = c.req.param("token");
    const found = await lookupInvite(c.env.DB, token);
    if (!found.ok) return c.html(document(<InviteInvalidPage reason={found.reason} />), 410);
    const data = await readForm(c);
    const email = normalizeEmail(field(data, "email"));
    const password = data.password ?? "";
    const errors: string[] = [];
    const emailProblem = email ? emailError(email) : "Enter your email.";
    if (emailProblem) errors.push(emailProblem);
    const passwordProblem = passwordError(password);
    if (passwordProblem) errors.push(passwordProblem);
    if (password !== (data.confirm ?? "")) errors.push("Those passwords do not match.");
    const again = (list: string[]) =>
      c.html(document(<InvitePage name={found.user.name} email={email} errors={list} action={`/invite/${token}`} />), 422);
    if (errors.length) return again(errors);
    let redeemed = false;
    try {
      redeemed = await redeemInvite(c.env.DB, {
        inviteId: found.inviteId,
        userId: found.user.id,
        email,
        passwordHash: await hashPassword(password),
      });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return again(["That email is already used by someone else. Use a different email, or ask the office admin."]);
    }
    if (!redeemed) return c.html(document(<InviteInvalidPage reason="used" />), 410);
    const session = newToken();
    await createSession(c.env.DB, found.user.id, session, sessionSecret(c.env).secret, SESSION_DAYS);
    setSessionCookie(c, session);
    return c.redirect("/?notice=password-set", 303);
  });
}
