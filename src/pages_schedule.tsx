/** @jsxImportSource hono/jsx */
import type { DayLane, MonthDay, WeekCellItem } from "./board";
import { DAY_END_HOUR, DAY_START_HOUR, addDays, formatDayLabel, formatLongDay, formatMonthLabel, shiftMonth } from "./time";
import type { Aircraft, RateBasis, User } from "./types";
import { Errors, Layout, PageHead, Warnings, type Viewer } from "./ui";

export function SchedulePage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  view: "day" | "week" | "month";
  board: "aircraft" | "instructors";
  anchor: string;
  today: string;
  lanes: DayLane[];
  nowPct: number | null;
  weekDays: string[];
  weekRows: Array<{ title: string; subtitle: string; tone: string; href: string; cells: WeekCellItem[][] }>;
  monthWeeks: MonthDay[][];
}) {
  const prev = props.view === "month" ? shiftMonth(props.anchor, -1) : addDays(props.anchor, props.view === "week" ? -7 : -1);
  const next = props.view === "month" ? shiftMonth(props.anchor, 1) : addDays(props.anchor, props.view === "week" ? 7 : 1);
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, index) => DAY_START_HOUR + index);
  const lede = props.view === "month"
    ? formatMonthLabel(props.anchor)
    : props.view === "day"
      ? formatLongDay(props.anchor)
      : `Week of ${formatDayLabel(props.weekDays[0] ?? props.anchor)}`;
  return (
    <Layout title="Schedule" user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title="Schedule" lede={lede}>
        <a class="btn" href={`/reservations/new?date=${props.anchor}`}>New reservation</a>
      </PageHead>
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Range">
          <a class={props.view === "day" ? "on" : ""} href={scheduleHref("day", props.board, props.anchor)}>Day</a>
          <a class={props.view === "week" ? "on" : ""} href={scheduleHref("week", props.board, props.anchor)}>Week</a>
          <a class={props.view === "month" ? "on" : ""} href={scheduleHref("month", props.board, props.anchor)}>Month</a>
        </div>
        <div class="segmented" role="group" aria-label="Resources">
          <a class={props.board === "aircraft" ? "on" : ""} href={scheduleHref(props.view, "aircraft", props.anchor)}>Aircraft</a>
          <a class={props.board === "instructors" ? "on" : ""} href={scheduleHref(props.view, "instructors", props.anchor)}>Instructors</a>
        </div>
        <div class="pager">
          <a class="btn secondary" href={scheduleHref(props.view, props.board, prev)} aria-label={props.view === "month" ? "Previous month" : "Previous"}>←</a>
          <a class="btn secondary" href={scheduleHref(props.view, props.board, props.today)}>Today</a>
          <a class="btn secondary" href={scheduleHref(props.view, props.board, next)} aria-label={props.view === "month" ? "Next month" : "Next"}>→</a>
        </div>
        <form class="date-jump" method="get" action="/schedule">
          <input type="hidden" name="view" value={props.view} />
          <input type="hidden" name="board" value={props.board} />
          <input type="date" name="date" value={props.anchor} aria-label="Jump to date" />
          <button class="btn secondary" type="submit">Go</button>
        </form>
      </div>
      {props.view === "month" ? (
        <MonthGrid weeks={props.monthWeeks} today={props.today} board={props.board} />
      ) : props.lanes.length === 0 ? (
        <p class="card card-pad">Nothing to put on this board yet. Add an aircraft{props.board === "instructors" ? " and an instructor" : ""} first.</p>
      ) : props.view === "day" ? (
        <div class="board-scroll card">
          <div class="day-head">
            <div class="gutter-spacer"></div>
            <div class="head-row">
              {props.lanes.map((lane) => (
                <div class="head-cell">
                  <a href={lane.href}>
                    <span class="tone" style={`background:${lane.tone}`}></span>
                    <strong class="tail">{lane.title}</strong>
                    <small>{lane.subtitle}</small>
                  </a>
                  <a class="book-link" href={lane.bookHref}>Book</a>
                </div>
              ))}
            </div>
          </div>
          <div class="day-body">
            <div class="gutter" aria-hidden="true">
              {hours.map((hour) => (
                <span style={`top:${((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%`}>
                  {formatHour(hour)}
                </span>
              ))}
              {props.nowPct != null ? <i class="now-flag" style={`top:${props.nowPct}%`}></i> : null}
            </div>
            <div class="lane-row">
              {props.lanes.map((lane) => (
                <div class={`lane${lane.grounded ? " grounded" : ""}`}>
                  {props.nowPct != null ? <i class="now-line" style={`top:${props.nowPct}%`}></i> : null}
                  {lane.blocks.map((block) => (
                    <a
                      class={`block ${block.className}`}
                      href={block.href}
                      style={`top:${block.top}%;height:${block.height}%;--tone:${lane.tone}`}
                      aria-label={block.aria}
                    >
                      <strong>{block.time}</strong>
                      <span>{block.label}</span>
                      {block.detail ? <em>{block.detail}</em> : null}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {props.lanes.some((lane) => lane.offHours.length > 0) ? (
            <div class="off-hours">
              <h2>Outside 6:00 AM–9:00 PM</h2>
              <ul>
                {props.lanes.flatMap((lane) =>
                  lane.offHours.map((item) => (
                    <li>
                      <span class="tail">{lane.title}</span> <a href={item.href}>{item.text}</a>
                    </li>
                  )),
                )}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div class="board-scroll card">
          <div class="week-grid">
            <div class="week-row week-head">
              <div class="week-corner">Resource</div>
              {props.weekDays.map((day) => (
                <div class={`week-day${day === props.today ? " today" : ""}`}>
                  <a href={scheduleHref("day", props.board, day)}>{formatDayLabel(day)}</a>
                </div>
              ))}
            </div>
            {props.weekRows.map((row) => (
              <div class="week-row">
                <div class="res-name">
                  <a href={row.href}>
                    <span class="tone" style={`background:${row.tone}`}></span>
                    <strong class="tail">{row.title}</strong>
                    <small>{row.subtitle}</small>
                  </a>
                </div>
                {row.cells.map((cell) => (
                  <div class="week-cell">
                    {cell.map((item) => (
                      <a class={`chip ${item.className}`} href={item.href} aria-label={item.aria}>
                        <strong>{item.time}</strong>
                        <span>{item.text}</span>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <p class="legend">
        <span class="pill scheduled">Scheduled</span>
        <span class="pill out">Checked out</span>
        <span class="pill in">Checked in</span>
        <span class="pill maint">Maintenance</span>
        <span class="muted">Back-to-back times are allowed. Overlaps are not.</span>
      </p>
    </Layout>
  );
}

function MonthGrid(props: { weeks: MonthDay[][]; today: string; board: string }) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div class="month-board card">
      <div class="month-grid">
        {labels.map((label) => (
          <div class="month-dow" aria-hidden="true">{label}</div>
        ))}
        {props.weeks.flat().map((cell) => (
          <div class={`month-cell${cell.inMonth ? "" : " outside"}${cell.day === props.today ? " today" : ""}`}>
            <a class="month-num" href={scheduleHref("day", props.board, cell.day)} aria-label={`Open ${formatLongDay(cell.day)}`}>
              {Number(cell.day.slice(8))}
            </a>
            <MonthList items={cell.items} />
            {cell.items.length > 0 ? (
              <details class="month-fold">
                <summary aria-label={`${cell.items.length} on ${formatLongDay(cell.day)}`}>
                  <span class="month-dots" aria-hidden="true">
                    {cell.items.slice(0, 4).map((item) => (
                      <i class={item.className}></i>
                    ))}
                  </span>
                  <span class="month-count">{cell.items.length}</span>
                </summary>
                <MonthList items={cell.items} />
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthList(props: { items: MonthDay["items"] }) {
  return (
    <ul class="month-list">
      {props.items.map((item) => (
        <li>
          <a class={`chip ${item.className}`} href={item.href} aria-label={item.aria}>
            <strong>{item.time}</strong>
            <span>{item.title}</span>
            {item.detail ? <em>{item.detail}</em> : null}
            <small class="tail">{item.tail}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

function scheduleHref(view: string, board: string, date: string): string {
  return `/schedule?view=${view}&board=${board}&date=${date}`;
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export type ReservationFormValues = {
  aircraftId: string;
  pilotId: string;
  instructorId: string;
  startsAt: string;
  endsAt: string;
  rateBasis: RateBasis | string;
  notes: string;
  override: boolean;
};

export function ReservationFormPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  mode: "create" | "edit";
  action: string;
  cancelHref: string;
  values: ReservationFormValues;
  errors: string[];
  warnings: string[];
  aircraft: Aircraft[];
  pilots: User[];
  instructors: User[];
  lockPilot: boolean;
}) {
  return (
    <Layout title={props.mode === "create" ? "New reservation" : "Edit reservation"} user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead
        title={props.mode === "create" ? "New reservation" : "Edit reservation"}
        lede="Price is calculated from Hobbs at check-in, not from the length of this block."
      />
      <form method="post" action={props.action} class="card card-pad stack">
        <Errors errors={props.errors} />
        <Warnings warnings={props.warnings} />
        <div class="fields">
          <label>
            Aircraft
            <select name="aircraft_id" required>
              <option value="">Select aircraft</option>
              {props.aircraft.map((item) => (
                <option value={item.id} selected={item.id === props.values.aircraftId}>
                  {item.tailNumber} · {item.make} {item.model}
                  {item.status === "grounded" ? " · grounded" : ""}
                </option>
              ))}
            </select>
          </label>
          {props.lockPilot ? (
            <input type="hidden" name="pilot_id" value={props.viewer.id} />
          ) : (
            <label>
              Pilot
              <select name="pilot_id" required>
                <option value="">Select pilot</option>
                {props.pilots.map((pilot) => (
                  <option value={pilot.id} selected={pilot.id === props.values.pilotId}>
                    {pilot.name} · {pilot.role === "renter" ? "Pilot" : pilot.role}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Instructor
            <select name="instructor_id">
              <option value="">Solo / no instructor</option>
              {props.instructors.map((instructor) => (
                <option value={instructor.id} selected={instructor.id === props.values.instructorId}>
                  {instructor.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rate
            <select name="rate_basis">
              <option value="wet" selected={props.values.rateBasis === "wet"}>Wet (fuel included)</option>
              <option value="dry" selected={props.values.rateBasis === "dry"}>Dry (only when this airplane has a dry rate)</option>
            </select>
          </label>
          <label>
            Starts (Pacific)
            <input type="datetime-local" name="starts_at" required value={props.values.startsAt} />
          </label>
          <label>
            Ends (Pacific)
            <input type="datetime-local" name="ends_at" required value={props.values.endsAt} />
          </label>
          <label class="wide">
            Notes
            <textarea name="notes" maxlength={2000}>{props.values.notes}</textarea>
          </label>
          {props.viewer.role === "admin" ? (
            <label class="check wide">
              <input type="checkbox" name="override_eligibility" value="yes" checked={props.values.override} />
              Admin override for an expired medical
            </label>
          ) : null}
        </div>
        <div class="actions">
          <button class="btn" type="submit">{props.mode === "create" ? "Save reservation" : "Save changes"}</button>
          <a class="btn secondary" href={props.cancelHref}>Cancel</a>
        </div>
      </form>
    </Layout>
  );
}
