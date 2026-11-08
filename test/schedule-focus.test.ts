import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertUser } from "../src/db";
import { launchRedirect, replayResume } from "../src/app_launch";
import { scrollToReveal, weekScrollLeft } from "../src/schedule_focus";
import { addDays, monthGrid, startOfWeek, todayInZone } from "../src/time";
import type { User } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;
const BASE = "https://rampboard.test";

async function reset(): Promise<void> {
  await db().exec(`
    DELETE FROM email_outbox;
    DELETE FROM flight_logs;
    DELETE FROM reservations;
    DELETE FROM maintenance_blocks;
    DELETE FROM aircraft_checkouts;
    DELETE FROM sessions;
    DELETE FROM aircraft;
    DELETE FROM users;
  `);
}

beforeEach(reset);

async function adminCookie(): Promise<string> {
  const user: User = {
    id: crypto.randomUUID(),
    email: "owner@example.com",
    passwordHash: await hashPassword("Pattern123!"),
    name: "Owner Admin",
    role: "admin",
    phone: null,
    certificateType: null,
    certificateNumber: null,
    medicalClass: null,
    medicalExpiration: null,
    instructorRateCents: null,
    icalToken: newToken(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await insertUser(db(), user);
  const response = await SELF.fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: new URLSearchParams({ email: "owner@example.com", password: "Pattern123!" }),
    redirect: "manual",
  });
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const token = cookies.map((cookie) => /rampboard_session=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
  if (!token) throw new Error("Missing session cookie");
  return `rampboard_session=${token}`;
}

describe("schedule opens with today in view", () => {
  it("scrolls an off-screen day into the visible box and leaves an on-screen day alone", () => {
    const phone = {
      viewport: { x: 0, y: 80, width: 390, height: 700 },
      contentSize: { width: 1080, height: 700 },
      scroll: { x: 0, y: 0 },
    };
    const saturday = { x: 820, y: 80, width: 140, height: 48 };
    const revealed = scrollToReveal({ ...phone, target: saturday });
    expect(revealed.changed).toBe(true);
    const contentLeft = saturday.x - phone.viewport.x + phone.scroll.x;
    const contentRight = contentLeft + saturday.width;
    expect(contentLeft).toBeGreaterThanOrEqual(revealed.x - 0.5);
    expect(contentRight).toBeLessThanOrEqual(revealed.x + phone.viewport.width + 0.5);

    const already = scrollToReveal({
      viewport: { x: 0, y: 0, width: 1400, height: 900 },
      contentSize: { width: 1400, height: 900 },
      scroll: { x: 0, y: 0 },
      target: { x: 400, y: 120, width: 160, height: 48 },
    });
    expect(already).toEqual({ x: 0, y: 0, changed: false });

    const below = scrollToReveal({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      contentSize: { width: 800, height: 2200 },
      scroll: { x: 0, y: 0 },
      target: { x: 40, y: 1500, width: 100, height: 118 },
    });
    expect(below.changed).toBe(true);
    expect(below.y).toBeGreaterThan(0);
    expect(1500).toBeGreaterThanOrEqual(below.y - 0.5);
    expect(1500 + 118).toBeLessThanOrEqual(below.y + 600 + 0.5);
  });

  it("scrolls a later weekday off the Sunday start, and keeps a wide week still", () => {
    const phone = weekScrollLeft({ todayIndex: 6, viewportWidth: 390, contentWidth: 1080 });
    expect(phone).toBeGreaterThan(400);
    const sunday = weekScrollLeft({ todayIndex: 0, viewportWidth: 390, contentWidth: 1080 });
    expect(sunday).toBe(0);
    const mid = weekScrollLeft({ todayIndex: 3, viewportWidth: 390, contentWidth: 1080 });
    expect(mid).toBeGreaterThan(sunday);
    expect(mid).toBeLessThan(phone);
    expect(weekScrollLeft({ todayIndex: 5, viewportWidth: 1400, contentWidth: 1080 })).toBe(0);
  });

  it("uses the Pacific day across midnight, month, and year boundaries", () => {
    expect(todayInZone(new Date("2026-01-01T07:30:00.000Z"))).toBe("2025-12-31");
    expect(todayInZone(new Date("2026-01-01T08:30:00.000Z"))).toBe("2026-01-01");
    expect(todayInZone(new Date("2026-07-15T06:30:00.000Z"))).toBe("2026-07-14");
    expect(todayInZone(new Date("2026-07-15T07:30:00.000Z"))).toBe("2026-07-15");
    expect(startOfWeek("2026-01-01")).toBe("2025-12-28");
    expect(addDays(startOfWeek("2026-01-01"), 4)).toBe("2026-01-01");
    expect(startOfWeek("2026-11-01")).toBe("2026-11-01");
    expect(startOfWeek("2026-11-07")).toBe("2026-11-01");
    const january = monthGrid("2026-01-15").weeks.flat();
    expect(january[0]).toBe("2025-12-28");
    expect(january).toContain("2026-01-01");
    expect(january[0]).not.toBe("2026-01-01");
  });

  it("sends only a cold installed-app open to the dashboard", () => {
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/schedule" })).toBe("/");
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/logs/abc/bill/aircraft" })).toBe("/");
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/" })).toBeNull();
    expect(launchRedirect({ standalone: true, hasSession: true, path: "/schedule" })).toBeNull();
    expect(launchRedirect({ standalone: true, hasSession: true, path: "/resources" })).toBeNull();
    expect(launchRedirect({ standalone: false, hasSession: false, path: "/schedule" })).toBeNull();
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/invite/token" })).toBeNull();
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/setup" })).toBeNull();
    expect(launchRedirect({ standalone: false, hasSession: false, path: "/logs/abc/record" })).toBeNull();
  });

  it("returns a backgrounded installed app to the dashboard and leaves print, forms, and signing", () => {
    const schedule = { standalone: true, path: "/schedule", formDirty: false };
    expect(replayResume({ ...schedule, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 5_000 },
    ] })).toBe("/");
    expect(replayResume({ ...schedule, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 400 },
    ] })).toBeNull();
    expect(replayResume({ ...schedule, formDirty: true, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 8_000 },
    ] })).toBeNull();
    expect(replayResume({ standalone: true, path: "/agreement", formDirty: false, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 8_000 },
    ] })).toBeNull();
    expect(replayResume({ standalone: true, path: "/logs/abc/record", formDirty: false, events: [
      { type: "beforeprint", at: 0 },
      { type: "visibility", state: "hidden", at: 10 },
      { type: "visibility", state: "visible", at: 12_000 },
    ] })).toBeNull();
    expect(replayResume({ standalone: true, path: "/logs/abc/record", formDirty: false, events: [
      { type: "beforeprint", at: 0 },
      { type: "afterprint", at: 4_000 },
      { type: "visibility", state: "hidden", at: 4_010 },
      { type: "visibility", state: "visible", at: 6_000 },
    ] })).toBeNull();
    expect(replayResume({ standalone: true, path: "/logs/abc/record", formDirty: false, events: [
      { type: "beforeprint", at: 0 },
      { type: "afterprint", at: 4_000 },
      { type: "visibility", state: "hidden", at: 10_000 },
      { type: "visibility", state: "visible", at: 15_000 },
    ] })).toBe("/");
    expect(replayResume({ standalone: true, path: "/logs/abc/bill/aircraft", formDirty: false, events: [
      { type: "file", at: 0 },
      { type: "visibility", state: "hidden", at: 20 },
      { type: "visibility", state: "visible", at: 6_000 },
    ] })).toBeNull();
    expect(replayResume({ ...schedule, events: [
      { type: "pagehide", at: 0, persisted: true },
      { type: "pageshow", at: 80, persisted: true },
    ] })).toBeNull();
    expect(replayResume({ ...schedule, events: [
      { type: "pagehide", at: 0, persisted: true },
      { type: "pageshow", at: 9_000, persisted: true },
    ] })).toBe("/");
    expect(replayResume({ ...schedule, events: [
      { type: "pagehide", at: 0, persisted: false },
      { type: "visibility", state: "visible", at: 4_000 },
    ] })).toBeNull();
    expect(replayResume({ standalone: false, path: "/schedule", formDirty: false, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 5_000 },
    ] })).toBeNull();
    expect(replayResume({ standalone: true, path: "/invite/token", formDirty: false, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 5_000 },
    ] })).toBeNull();
    expect(replayResume({ ...schedule, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "resume", at: 4_000 },
    ] })).toBe("/");
    expect(replayResume({ ...schedule, pdfHold: true, events: [
      { type: "visibility", state: "hidden", at: 0 },
      { type: "visibility", state: "visible", at: 20_000 },
    ] })).toBeNull();
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/logs/abc/bill/aircraft.pdf", pdfHold: true })).toBeNull();
    expect(launchRedirect({ standalone: true, hasSession: false, path: "/logs/abc/record.pdf" })).toBeNull();
  });

  it("marks today on the opened schedule and not on another date or the dashboard", async () => {
    const cookie = await adminCookie();
    await db()
      .prepare(
        `INSERT INTO aircraft (id, tail_number, make, model, year, hourly_wet_cents, hourly_dry_cents, default_rate, status, hobbs, tach, notes, created_at)
         VALUES (?, 'N1561Y', 'Cessna', '172C', 1962, 15500, NULL, 'wet', 'available', 100, 80, NULL, ?)`,
      )
      .bind(crypto.randomUUID(), new Date().toISOString())
      .run();
    const today = todayInZone();
    const headers = { cookie };
    const day = await (await SELF.fetch(`${BASE}/schedule`, { headers })).text();
    const week = await (await SELF.fetch(`${BASE}/schedule?view=week&date=${today}`, { headers })).text();
    const month = await (await SELF.fetch(`${BASE}/schedule?view=month&date=${today}`, { headers })).text();
    const later = addDays(today, 21);
    const otherWeek = await (await SELF.fetch(`${BASE}/schedule?view=week&date=${later}`, { headers })).text();
    const otherDay = await (await SELF.fetch(`${BASE}/schedule?view=day&date=${later}`, { headers })).text();
    const opened = await SELF.fetch(`${BASE}/schedule?view=week&date=${today}`, { headers, redirect: "manual" });
    expect(opened.status).toBe(200);
    const homeResponse = await SELF.fetch(`${BASE}/`, { headers, redirect: "manual" });
    expect(homeResponse.status).toBe(200);
    const home = await homeResponse.text();
    const manifest = await (await SELF.fetch(`${BASE}/manifest.webmanifest`)).json() as { start_url: string; display: string };
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    for (const html of [day, week, month]) {
      expect(html).toContain('data-schedule-today="1"');
      expect(html).toContain('src="/schedule-focus.js"');
      expect(html.split('data-schedule-today="1"').length - 1).toBe(1);
    }
    expect(otherWeek).not.toContain("data-schedule-today");
    expect(otherDay).not.toContain("data-schedule-today");
    expect(otherWeek).toContain('src="/schedule-focus.js"');
    expect(home).not.toContain("data-schedule-today");
    expect(home).not.toContain("schedule-focus.js");
    expect(week).toContain(`date=${today}`);
    const weekStart = startOfWeek(today);
    const todayIndex = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).indexOf(today);
    expect(week).toContain(`id="week-board" data-today-index="${todayIndex}"`);
    expect(week).toContain(`date=${weekStart}`);
    const marked = week.slice(week.indexOf('data-schedule-today="1"'));
    expect(marked.slice(0, 400)).toContain(`date=${today}`);
    const previous = addDays(weekStart, -7);
    const previousHtml = await (await SELF.fetch(`${BASE}/schedule?view=week&date=${previous}`, { headers })).text();
    expect(previousHtml).not.toContain("data-today-index");
    expect(previousHtml).not.toContain("data-schedule-today");
    expect(previousHtml).toContain(`date=${previous}`);
    expect(home).toContain('src="/app-launch.js"');
    expect(day).toContain('src="/app-launch.js"');
    expect(home).not.toContain("schedule-focus.js");
  });
});
