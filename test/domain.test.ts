import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth";
import { computeFlightCost, pilotEligibility, validateReservationWindow } from "../src/domain";
import { buildIcal, escapeText } from "../src/ical";
import { addDays, clipToWindow, rangesOverlap, todayInZone, zonedTimeToUtc } from "../src/time";

describe("flight cost", () => {
  it("bills Hobbs tenths for the aircraft and the instructor", () => {
    const result = computeFlightCost({
      hobbsOut: 100,
      hobbsIn: 101.4,
      tachOut: 80,
      tachIn: 81.1,
      rateBasis: "wet",
      wetCents: 18000,
      dryCents: 15000,
      instructorRateCents: 7500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.flightHours).toBeCloseTo(1.4);
    expect(result.value.aircraftCostCents).toBe(25200);
    expect(result.value.instructorCostCents).toBe(10500);
    expect(result.value.totalCostCents).toBe(35700);
  });

  it("does not bill an instructor on a solo flight", () => {
    const result = computeFlightCost({
      hobbsOut: 10,
      hobbsIn: 11.1,
      tachOut: null,
      tachIn: null,
      rateBasis: "dry",
      wetCents: 17900,
      dryCents: 14900,
      instructorRateCents: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aircraftCostCents).toBe(16390);
    expect(result.value.instructorCostCents).toBe(0);
    expect(result.value.totalCostCents).toBe(16390);
  });

  it("rejects a Hobbs reading that does not increase", () => {
    const result = computeFlightCost({
      hobbsOut: 10,
      hobbsIn: 10,
      tachOut: 1,
      tachIn: 1,
      rateBasis: "wet",
      wetCents: 10000,
      dryCents: 8000,
      instructorRateCents: null,
    });
    expect(result.ok).toBe(false);
  });
});

describe("eligibility", () => {
  const today = "2026-10-26";

  it("blocks an expired medical and a missing checkout", () => {
    const result = pilotEligibility({
      medicalExpiration: "2026-10-01",
      checkout: null,
      today,
      aircraftTail: "N172RB",
    });
    expect(result.ok).toBe(false);
    expect(result.blocks.join(" ")).toMatch(/Medical expired/);
    expect(result.blocks.join(" ")).toMatch(/Not checked out/);
  });

  it("warns when a medical is inside 30 days", () => {
    const result = pilotEligibility({
      medicalExpiration: addDays(today, 10),
      checkout: { status: "current", expiresOn: null },
      today,
      aircraftTail: "N172RB",
    });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatch(/Medical expires/);
  });
});

describe("time", () => {
  it("converts a Pacific afternoon to UTC during daylight time", () => {
    const utc = zonedTimeToUtc("2026-10-26T10:00");
    expect(utc.toISOString()).toBe("2026-10-26T17:00:00.000Z");
  });

  it("uses standard time after the fall change", () => {
    const utc = zonedTimeToUtc("2026-12-01T10:00");
    expect(utc.toISOString()).toBe("2026-12-01T18:00:00.000Z");
  });

  it("treats back-to-back ranges as free and overlaps as conflicts", () => {
    expect(rangesOverlap("2026-10-26T17:00:00.000Z", "2026-10-26T19:00:00.000Z", "2026-10-26T19:00:00.000Z", "2026-10-26T20:00:00.000Z")).toBe(false);
    expect(rangesOverlap("2026-10-26T17:00:00.000Z", "2026-10-26T19:00:00.000Z", "2026-10-26T18:00:00.000Z", "2026-10-26T20:00:00.000Z")).toBe(true);
  });

  it("clips a reservation into the visible day window", () => {
    const clip = clipToWindow(
      "2026-10-26T16:00:00.000Z",
      "2026-10-26T18:00:00.000Z",
      "2026-10-26T13:00:00.000Z",
      "2026-10-27T04:00:00.000Z",
    );
    expect(clip).not.toBeNull();
    expect(clip!.topPct).toBeGreaterThan(0);
    expect(clip!.heightPct).toBeGreaterThan(0);
  });

  it("rejects a reservation that is already over", () => {
    const end = new Date(Date.now() - 60 * 60 * 1000);
    const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
    expect(validateReservationWindow(start, end)).toMatch(/already over/);
  });

  it("knows today's date in Pacific time", () => {
    expect(todayInZone(new Date("2026-10-26T06:30:00.000Z"))).toBe("2026-10-25");
  });
});

describe("ical and passwords", () => {
  it("escapes calendar text", () => {
    expect(escapeText("N172RB, oil; change")).toBe("N172RB\\, oil\\; change");
    const body = buildIcal(
      [
        {
          uid: "1@rampboard",
          stamp: "2026-10-26T17:00:00.000Z",
          start: "2026-10-26T17:00:00.000Z",
          end: "2026-10-26T19:00:00.000Z",
          summary: "N172RB",
          status: "CONFIRMED",
        },
      ],
      "Rampboard",
    );
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART:20261026T170000Z");
  });

  it("hashes and checks a password", async () => {
    const hash = await hashPassword("Pattern123!");
    expect(await verifyPassword("Pattern123!", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
