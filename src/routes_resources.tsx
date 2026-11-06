/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import { agreementStatus, getAgreement } from "./agreement";
import { pageNotice } from "./copy";
import { getAircraft, listAircraft } from "./db";
import { viewerOf } from "./http";
import { ResourcesPage } from "./pages_resources";
import {
  contentDisposition,
  createUploadedResource,
  deleteResource,
  formatBytes,
  getResource,
  groupResources,
  isPdf,
  listResources,
  MAX_UPLOAD_BYTES,
  streamChunks,
  type Resource,
} from "./resources";
import type { AppEnv, User } from "./types";
import { document, SimpleMessage } from "./ui";

export function registerResources(app: Hono<AppEnv>): void {
  app.get("/resources", async (c) => renderPage(c, mustUser(c), pageNotice(c.req.query("notice")), null));

  app.get("/resources/:id/view", (c) => serveResource(c, "inline"));
  app.get("/resources/:id/download", (c) => serveResource(c, "attachment"));

  app.post("/resources", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 300) : null;
    const aircraftValue = typeof body.aircraft_id === "string" ? body.aircraft_id : "";
    const file = body.file;
    if (!title) return renderPage(c, user, null, "Give the document a title.", 400);
    if (!(file instanceof File) || file.size === 0) return renderPage(c, user, null, "Choose a PDF file to upload.", 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return renderPage(c, user, null, `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`, 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdf(bytes)) return renderPage(c, user, null, "That file is not a PDF.", 400);
    let aircraftId: string | null = null;
    if (aircraftValue) {
      const plane = await getAircraft(c.env.DB, aircraftValue);
      if (!plane) return renderPage(c, user, null, "That aircraft is not on the fleet.", 400);
      aircraftId = plane.id;
    }
    await createUploadedResource(c.env.DB, { title, aircraftId, notes, fileName: file.name, bytes, createdBy: user.id });
    return c.redirect("/resources?notice=resource-added", 303);
  });

  app.post("/resources/:id/delete", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const removed = await deleteResource(c.env.DB, c.req.param("id"));
    if (!removed) return c.notFound();
    return c.redirect("/resources?notice=resource-deleted", 303);
  });
}

async function renderPage(c: Context<AppEnv>, user: User, notice: string | null, error: string | null, status: 200 | 400 | 413 = 200) {
  const [resources, aircraft, agreement] = await Promise.all([
    listResources(c.env.DB),
    listAircraft(c.env.DB),
    getAgreement(c.env.DB, user.id),
  ]);
  return c.html(
    document(
      <ResourcesPage
        viewer={viewerOf(user)}
        path="/resources"
        usingDevSecret={c.get("usingDevSecret")}
        groups={groupResources(resources)}
        aircraft={aircraft}
        notice={notice}
        error={error}
        agreementStatus={agreementStatus(agreement)}
      />,
    ),
    status,
  );
}

async function serveResource(c: Context<AppEnv>, kind: "inline" | "attachment"): Promise<Response> {
  mustUser(c);
  const resource = await getResource(c.env.DB, c.req.param("id") ?? "");
  if (!resource) return c.notFound();
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(kind, resource.fileName),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (resource.storage === "asset") return serveAsset(c, resource, headers);
  headers.set("Content-Length", String(resource.sizeBytes));
  return new Response(streamChunks(c.env.DB, resource.id), { headers });
}

async function serveAsset(c: Context<AppEnv>, resource: Resource, headers: Headers): Promise<Response> {
  if (!c.env.ASSETS || !resource.storageKey.startsWith("/docs/")) return c.notFound();
  const assetUrl = new URL(resource.storageKey, c.req.url);
  const forward = new Headers();
  for (const name of ["range", "if-none-match", "if-modified-since", "if-range"]) {
    const value = c.req.header(name);
    if (value) forward.set(name, value);
  }
  const upstream = await c.env.ASSETS.fetch(new Request(assetUrl, { headers: forward }));
  if (upstream.status === 404) return c.notFound();
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function mustUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) throw new Error("Sign-in required.");
  return user;
}

function forbidden(c: Context<AppEnv>) {
  return c.html(document(<SimpleMessage title="Not allowed" message="Your role cannot do that." />), 403);
}
