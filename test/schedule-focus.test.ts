import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, newToken } from "../src/auth";
import { insertUser } from "../src/db";
import { scrollToReveal } from "../src/schedule_focus";
import { addDays, todayInZone } from "../src/time";
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
    const home = await (await SELF.fetch(`${BASE}/`, { headers })).text();
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
  });
});
