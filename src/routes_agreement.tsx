/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import {
  agreementStatus,
  canonicalAgreementPdf,
  getAgreement,
  signAgreement,
  signAsGuardian,
  signedAgreementPdf,
} from "./agreement";
import { pageNotice } from "./copy";
import { contentDisposition } from "./resources";
import { field, isUuid, readForm, viewerOf } from "./http";
import { getUserById } from "./db";
import { AgreementPage } from "./pages_agreement";
import type { AppEnv, User } from "./types";
import { document, SimpleMessage } from "./ui";

export function registerAgreement(app: Hono<AppEnv>): void {
  app.get("/agreement", async (c) => {
    const user = mustUser(c);
    return renderAgreement(c, user, null);
  });
  app.get("/agreement/file", (c) => serveCanonical(c, "attachment"));
  app.get("/agreement/file/view", (c) => serveCanonical(c, "inline"));
  app.get("/agreement/signed", async (c) => serveSigned(c, mustUser(c).id, mustUser(c)));
  app.get("/pilots/:id/agreement/signed", async (c) => {
    const actor = mustUser(c);
    if (actor.role !== "admin") return forbidden(c);
    return serveSigned(c, c.req.param("id"), actor);
  });
  app.post("/agreement/sign", async (c) => {
    const user = mustUser(c);
    const data = await readForm(c);
    if (field(data, "read_ack") !== "yes" || field(data, "esign_consent") !== "yes") {
      return renderAgreement(c, user, "Confirm that you have read the agreement and that you agree to sign it electronically.", 422);
    }
    const age = field(data, "age");
    if (age !== "adult" && age !== "minor") {
      return renderAgreement(c, user, "Say whether you are 18 or older, or under 18.", 422);
    }
    const result = await signAgreement(c.env.DB, {
      userId: user.id,
      accountName: user.name,
      accountEmail: user.email,
      legalName: field(data, "legal_name"),
      ageStatement: age,
      nowIso: new Date().toISOString(),
    });
    if (!result.ok) return renderAgreement(c, user, result.error, 422);
    const notice = result.already ? "agreement-already-signed" : result.record.status === "awaiting_guardian" ? "agreement-guardian" : "agreement-signed";
    return c.redirect(`/agreement?notice=${notice}`, 303);
  });
  app.post("/agreement/guardian", async (c) => {
    const user = mustUser(c);
    const data = await readForm(c);
    if (field(data, "guardian_consent") !== "yes") {
      return renderAgreement(c, user, "The parent or legal guardian has to confirm that they read the agreement and agree to it.", 422);
    }
    const result = await signAsGuardian(c.env.DB, {
      userId: user.id,
      guardianLegalName: field(data, "guardian_legal_name"),
      nowIso: new Date().toISOString(),
    });
    if (!result.ok) return renderAgreement(c, user, result.error, 422);
    return c.redirect(`/agreement?notice=${result.already ? "agreement-already-signed" : "agreement-signed"}`, 303);
  });
}

async function renderAgreement(c: Context<AppEnv>, user: User, error: string | null, status?: 200 | 422): Promise<Response> {
  const record = await getAgreement(c.env.DB, user.id);
  return c.html(
    document(
      <AgreementPage
        viewer={viewerOf(user)}
        path="/resources"
        usingDevSecret={c.get("usingDevSecret")}
        notice={pageNotice(c.req.query("notice"))}
        error={error}
        record={record}
        status={agreementStatus(record)}
      />,
    ),
    status ?? (error ? 422 : 200),
  );
}

function serveCanonical(c: Context<AppEnv>, kind: "inline" | "attachment"): Response {
  mustUser(c);
  const bytes = canonicalAgreementPdf();
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(kind, "fire-hound-rental-agreement.pdf"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function serveSigned(c: Context<AppEnv>, userId: string, actor: User): Promise<Response> {
  if (!isUuid(userId)) return c.notFound();
  if (actor.id !== userId && actor.role !== "admin") return forbidden(c);
  const person = await getUserById(c.env.DB, userId);
  const record = await getAgreement(c.env.DB, userId);
  if (!record || agreementStatus(record) !== "complete") return c.notFound();
  const bytes = signedAgreementPdf(record);
  const fileName = `fire-hound-rental-agreement-signed-${(person?.name ?? record.legalName).replace(/[^A-Za-z0-9]+/g, "-")}`;
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition("attachment", fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function mustUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) throw new Error("Sign-in required.");
  return user;
}

function forbidden(c: Context<AppEnv>) {
  return c.html(document(<SimpleMessage title="Not allowed" message="Your role cannot do that." />), 403);
}
