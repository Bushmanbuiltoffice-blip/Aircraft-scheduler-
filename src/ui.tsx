/** @jsxImportSource hono/jsx */
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import { roleLabel } from "./format";
import { FIELD_NAME, ORG_NAME, type Role } from "./types";

export type Viewer = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export function document(node: Child) {
  return html`<!DOCTYPE html>${node}`;
}

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/schedule", label: "Schedule" },
  { href: "/aircraft", label: "Aircraft" },
  { href: "/pilots", label: "People" },
  { href: "/logs", label: "Flight logs" },
  { href: "/account", label: "Account" },
];

export function Layout(props: {
  title: string;
  user: Viewer;
  path: string;
  notice?: string | null;
  error?: string | null;
  usingDevSecret?: boolean;
  children?: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#12263a" />
        <title>{props.title} · Rampboard</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>
        <a class="skip" href="#content">Skip to content</a>
        <header class="topbar">
          <a class="brand" href="/">
            <span class="brand-mark" aria-hidden="true">R</span>
            <span>
              <strong>Rampboard</strong>
              <small>{ORG_NAME} · 77S</small>
            </span>
          </a>
          <input id="nav-check" class="nav-check" type="checkbox" />
          <label class="nav-toggle" for="nav-check">Menu</label>
          <nav class="nav" aria-label="Primary">
            <span class="nav-user">{props.user.name}</span>
            {NAV.filter((item) => item.href !== "/pilots" || props.user.role !== "renter").map((item) => (
              <a class={navClass(props.path, item.href)} href={item.href} aria-current={navCurrent(props.path, item.href)}>
                {item.label}
              </a>
            ))}
            <form method="post" action="/logout" class="nav-logout">
              <button class="nav-link as-button" type="submit">Log out</button>
            </form>
          </nav>
          <div class="session">
            <span>{props.user.name}</span>
            <em>{roleLabel(props.user.role)}</em>
          </div>
        </header>
        <main id="content" class="wrap">
          {props.usingDevSecret && props.user.role === "admin" ? (
            <p class="alert warn">
              This server is using the built-in development sign-in secret. Before real pilots use it, set SESSION_SECRET.
              The README explains how.
            </p>
          ) : null}
          {props.notice ? <p class="alert ok" role="status">{props.notice}</p> : null}
          {props.error ? <p class="alert" role="alert">{props.error}</p> : null}
          {props.children}
        </main>
        <footer class="footer">{ORG_NAME} · {FIELD_NAME} · Times shown in Pacific</footer>
      </body>
    </html>
  );
}

function navClass(path: string, href: string): string {
  return navCurrent(path, href) ? "nav-link active" : "nav-link";
}

function navCurrent(path: string, href: string): "page" | undefined {
  if (href === "/") return path === "/" ? "page" : undefined;
  return path === href || path.startsWith(`${href}/`) ? "page" : undefined;
}

export function GuestShell(props: { title: string; kicker: string; lede: string; children?: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title} · Rampboard</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body class="guest-body">
        <div class="login-shell">
          <section class="login-hero">
            <p class="eyebrow">{ORG_NAME}</p>
            <h1>Rampboard</h1>
            <p>{props.lede}</p>
            <ul class="hero-list">
              <li><span>77S</span> Hobby Field, Creswell</li>
              <li><span>PT</span> America/Los_Angeles</li>
              <li><span>MX</span> Maintenance blocks the board</li>
            </ul>
          </section>
          <section class="login-panel">
            <p class="eyebrow">{props.kicker}</p>
            {props.children}
          </section>
        </div>
      </body>
    </html>
  );
}

export function PageHead(props: { title: string; lede?: string; children?: Child }) {
  return (
    <div class="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.lede ? <p>{props.lede}</p> : null}
      </div>
      {props.children ? <div class="page-actions">{props.children}</div> : null}
    </div>
  );
}

export function Errors(props: { errors?: string[] }) {
  if (!props.errors || props.errors.length === 0) return null;
  return (
    <div class="alert" role="alert">
      {props.errors.map((error) => (
        <p>{error}</p>
      ))}
    </div>
  );
}

export function Warnings(props: { warnings?: string[] }) {
  if (!props.warnings || props.warnings.length === 0) return null;
  return (
    <div class="alert warn" role="status">
      {props.warnings.map((warning) => (
        <p>{warning}</p>
      ))}
    </div>
  );
}

export function SimpleMessage(props: { title: string; message: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Rampboard</title>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>
        <main class="wrap narrow">
          <h1>{props.title}</h1>
          <p>{props.message}</p>
          <p><a href="/">Back to Rampboard</a></p>
        </main>
      </body>
    </html>
  );
}
