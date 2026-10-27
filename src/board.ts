import { clipToWindow, dayRange, formatTime, rangesOverlap, visibleWindow } from "./time";

export type BoardResource = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  bookHref: string;
  tone: string;
  grounded: boolean;
};

export type BoardEvent = {
  id: string;
  resourceId: string;
  href: string;
  startsAt: string;
  endsAt: string;
  className: string;
  label: string;
  detail: string;
  aria: string;
};

export type PositionedBlock = BoardEvent & {
  top: number;
  height: number;
  time: string;
};

export type DayLane = BoardResource & {
  blocks: PositionedBlock[];
  offHours: Array<{ href: string; text: string }>;
};

export function buildDayBoard(day: string, resources: BoardResource[], events: BoardEvent[], now: Date | null): {
  lanes: DayLane[];
  nowPct: number | null;
} {
  const range = dayRange(day);
  const window = visibleWindow(day);
  const nowPct = now ? percentInWindow(now.toISOString(), window.startIso, window.endIso) : null;
  const lanes = resources.map((resource) => {
    const blocks: PositionedBlock[] = [];
    const offHours: Array<{ href: string; text: string }> = [];
    for (const event of events) {
      if (event.resourceId !== resource.id) continue;
      if (!rangesOverlap(event.startsAt, event.endsAt, range.startIso, range.endIso)) continue;
      const clip = clipToWindow(event.startsAt, event.endsAt, window.startIso, window.endIso);
      const time = `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`;
      if (!clip) {
        offHours.push({ href: event.href, text: `${time} · ${event.label}` });
        continue;
      }
      const height = Math.min(clip.heightPct, 100 - clip.topPct);
      blocks.push({ ...event, top: clip.topPct, height, time });
    }
    return { ...resource, blocks, offHours };
  });
  return { lanes, nowPct };
}

export type WeekCellItem = {
  href: string;
  className: string;
  time: string;
  text: string;
  aria: string;
};

export function buildWeekBoard(days: string[], resources: BoardResource[], events: BoardEvent[]): Array<BoardResource & { cells: WeekCellItem[][] }> {
  return resources.map((resource) => ({
    ...resource,
    cells: days.map((day) => {
      const range = dayRange(day);
      const items: WeekCellItem[] = [];
      for (const event of events) {
        if (event.resourceId !== resource.id) continue;
        if (!rangesOverlap(event.startsAt, event.endsAt, range.startIso, range.endIso)) continue;
        items.push({
          href: event.href,
          className: event.className,
          time: `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`,
          text: event.label,
          aria: event.aria,
        });
      }
      return items;
    }),
  }));
}

export type MonthEntry = {
  href: string;
  startsAt: string;
  endsAt: string;
  className: string;
  title: string;
  detail: string;
  tail: string;
  aria: string;
};

export type MonthItem = {
  href: string;
  className: string;
  time: string;
  title: string;
  detail: string;
  tail: string;
  aria: string;
};

export type MonthDay = {
  day: string;
  inMonth: boolean;
  items: MonthItem[];
};

export function buildMonthCalendar(weeks: string[][], monthKey: string, events: MonthEntry[]): MonthDay[][] {
  return weeks.map((week) =>
    week.map((day) => {
      const range = dayRange(day);
      const items = events
        .filter((event) => rangesOverlap(event.startsAt, event.endsAt, range.startIso, range.endIso))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))
        .map((event) => ({
          href: event.href,
          className: event.className,
          time: `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`,
          title: event.title,
          detail: event.detail,
          tail: event.tail,
          aria: event.aria,
        }));
      return { day, inMonth: day.startsWith(monthKey), items };
    }),
  );
}

function percentInWindow(iso: string, windowStart: string, windowEnd: string): number | null {
  const time = Date.parse(iso);
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  if (time < start || time > end) return null;
  return ((time - start) / (end - start)) * 100;
}

export const RESOURCE_TONES = ["#1d4e89", "#0f6e56", "#8a4b08", "#6b3fa0", "#8f2d3a", "#1f6f8a", "#3f4c3a"];
