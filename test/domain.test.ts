import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth";
import { computeFlightCost, pilotEligibility, validateReservationWindow } from "../src/domain";
import { buildIcal, escapeText } from "../src/ical";
import { buildMonthCalendar } from "../src/board";
import { addDays, clipToWindow, monthGrid, rangesOverlap, shiftMonth, todayInZone, zonedTimeToUtc } from "../src/time";

describe("flight cost", () => {
  it("bills Hobbs tenths for the aircraft and the instructor", () => {
    const result = computeFlightCost({
      hobbsOut: 100,
      hobbsIn: 101.4,
      tachOut: 80,
      tachIn: 81.1,
      rateBasis: "wet",
      wetCents: 15500,
      dryCents: null,
      instructorRateCents: 7500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.flightHours).toBeCloseTo(1.4);
    expect(result.value.aircraftRateCents).toBe(15500);
    expect(result.value.aircraftCostCents).toBe(21700);
    expect(result.value.instructorRateCents).toBe(7500);
    expect(result.value.instructorCostCents).toBe(10500);
    expect(result.value.totalCostCents).toBe(32200);
  });

  it("refuses a dry check-in when the airplane has no dry rate", () => {
    const result = computeFlightCost({
      hobbsOut: 100,
      hobbsIn: 101,
      tachOut: null,
      tachIn: null,
      rateBasis: "dry",
      wetCents: 15500,
      dryCents: null,
      instructorRateCents: null,
    });
    expect(result.ok).toBe(false);
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

describe("month calendar", () => {
  it("starts weeks on Sunday and steps by month", () => {
    const grid = monthGrid("2026-10-27");
    expect(grid.weeks[0]?.[0]).toBe("2026-09-27");
    expect(grid.weeks[0]?.[6]).toBe("2026-10-03");
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(grid.weeks.at(-1)?.at(-1)).toBe("2026-10-31");
    expect(shiftMonth("2026-10-27", -1)).toBe("2026-09-01");
    expect(shiftMonth("2026-10-27", 1)).toBe("2026-11-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("keeps a Pacific evening flight on that calendar day and marks maintenance", () => {
    const grid = monthGrid("2026-10-01");
    const days = buildMonthCalendar(grid.weeks, "2026-10", [
      {
        href: "/reservations/late",
        startsAt: "2026-10-01T06:00:00.000Z",
        endsAt: "2026-10-01T06:40:00.000Z",
        className: "scheduled",
        title: "Priya Shah",
        detail: "Juan Valdivia",
        tail: "N1561Y",
        aria: "late flight",
      },
      {
        href: "/aircraft/n1561y",
        startsAt: "2026-10-02T01:00:00.000Z",
        endsAt: "2026-10-02T04:00:00.000Z",
        className: "maint",
        title: "Maintenance",
        detail: "Oil and filter change",
        tail: "N1561Y",
        aria: "maintenance",
      },
    ]);
    const flat = days.flat();
    const sep30 = flat.find((day) => day.day === "2026-09-30");
    const oct1 = flat.find((day) => day.day === "2026-10-01");
    expect(sep30?.inMonth).toBe(false);
    expect(sep30?.items.map((item) => item.title)).toEqual(["Priya Shah"]);
    expect(sep30?.items[0]?.detail).toBe("Juan Valdivia");
    expect(sep30?.items[0]?.tail).toBe("N1561Y");
    expect(sep30?.items[0]?.time).toContain("11:00");
    expect(oct1?.items.map((item) => item.title)).toEqual(["Maintenance"]);
    expect(oct1?.items[0]?.className).toBe("maint");
    expect(oct1?.items[0]?.detail).toBe("Oil and filter change");
    expect(oct1?.items[0]?.time).toContain("6:00");
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
      "Firehound Rental",
    );
    expect(body).toContain("PRODID:-//Firehound Rental//EN");
    expect(body).toContain("X-WR-CALNAME:Firehound Rental");
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART:20261026T170000Z");
  });

  it("hashes and checks a password", async () => {
    const hash = await hashPassword("Pattern123!");
    expect(await verifyPassword("Pattern123!", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
