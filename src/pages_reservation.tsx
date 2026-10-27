/** @jsxImportSource hono/jsx */
import { formatHours, formatMeter, formatMoney, rateLabel, statusLabel } from "./format";
import { formatDateTime, toDateTimeLocalValue } from "./time";
import type { FlightLogView, ScheduleEntry } from "./types";
import { Layout, PageHead, Warnings, type Viewer } from "./ui";

export function ReservationPage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  entry: ScheduleEntry;
  canManage: boolean;
  warnings: string[];
  log: FlightLogView | null;
  hobbsSuggestion: string;
  tachSuggestion: string;
  aircraftRateCents: number;
  instructorRateCents: number | null;
  actionError?: string | null;
}) {
  const entry = props.entry;
  const estimateRate = props.instructorRateCents ?? 0;
  return (
    <Layout title={entry.tailNumber} user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title={`${entry.tailNumber} reservation`} lede={`${entry.make} ${entry.model}`}>
        <a class="btn secondary" href="/schedule">Back to schedule</a>
      </PageHead>
      <Warnings warnings={props.warnings} />
      {props.actionError ? <p class="alert" role="alert">{props.actionError}</p> : null}
      <section class="card card-pad detail-grid">
        <div>
          <p class={`pill ${entry.status}`}>{statusLabel(entry.status)}</p>
          <h2>{formatDateTime(entry.startsAt)} – {formatDateTime(entry.endsAt)}</h2>
          <dl>
            <div><dt>Pilot</dt><dd><a href={`/pilots/${entry.pilotId}`}>{entry.pilotName}</a></dd></div>
            <div><dt>Instructor</dt><dd>{entry.instructorName ? <a href={`/pilots/${entry.instructorId}`}>{entry.instructorName}</a> : "Solo"}</dd></div>
            <div><dt>Rate basis</dt><dd>{rateLabel(entry.rateBasis)}</dd></div>
            <div><dt>Aircraft</dt><dd><a class="tail" href={`/aircraft/${entry.aircraftId}`}>{entry.tailNumber}</a></dd></div>
            <div><dt>Hobbs out / in</dt><dd>{formatMeter(entry.hobbsOut)} / {formatMeter(entry.hobbsIn)}</dd></div>
            <div><dt>Tach out / in</dt><dd>{formatMeter(entry.tachOut)} / {formatMeter(entry.tachIn)}</dd></div>
          </dl>
          {entry.notes ? <p class="notes">{entry.notes}</p> : null}
        </div>
        {props.log ? (
          <aside class="cost-card">
            <h2>Flight log</h2>
            <p>{formatHours(props.log.flightHours)} Hobbs hours</p>
            <ul>
              <li>Aircraft {formatMoney(props.log.aircraftCostCents)}</li>
              <li>Instructor {formatMoney(props.log.instructorCostCents)}</li>
            </ul>
            <strong>{formatMoney(props.log.totalCostCents)}</strong>
            <a href={`/logs/${props.log.id}`}>Open the log</a>
          </aside>
        ) : (
          <aside class="cost-card">
            <h2>Billing</h2>
            <p>Nothing is billed until check-in. Aircraft time and instructor time both use the Hobbs difference.</p>
          </aside>
        )}
      </section>
      {props.canManage && entry.status === "scheduled" ? (
        <section class="card card-pad">
          <h2>Check out</h2>
          <p class="muted">Record the meters before the flight. Suggested values are the aircraft's current readings.</p>
          <form method="post" action={`/reservations/${entry.id}/checkout`} class="fields">
            <label>
              Hobbs out
              <input name="hobbs_out" inputmode="decimal" required value={props.hobbsSuggestion} />
            </label>
            <label>
              Tach out
              <input name="tach_out" inputmode="decimal" required value={props.tachSuggestion} />
            </label>
            <div class="actions wide">
              <button class="btn amber" type="submit">Check out</button>
            </div>
          </form>
        </section>
      ) : null}
      {props.canManage && entry.status === "checked_out" ? (
        <section class="card card-pad">
          <h2>Check in</h2>
          <form
            id="checkin-form"
            method="post"
            action={`/reservations/${entry.id}/checkin`}
            class="fields"
            data-hobbs-out={String(entry.hobbsOut ?? "")}
            data-aircraft-rate={String(props.aircraftRateCents)}
            data-instructor-rate={entry.instructorId ? String(estimateRate) : "0"}
          >
            <p class="wide muted">Hobbs out {formatMeter(entry.hobbsOut)} · Tach out {formatMeter(entry.tachOut)}</p>
            <label>
              Hobbs in
              <input name="hobbs_in" inputmode="decimal" required />
            </label>
            <label>
              Tach in
              <input name="tach_in" inputmode="decimal" required />
            </label>
            <p id="checkin-estimate" class="wide estimate">Enter Hobbs in to preview the cost.</p>
            <div class="actions wide">
              <button class="btn" type="submit">Check in and bill</button>
            </div>
          </form>
          <script src="/checkin.js" defer></script>
        </section>
      ) : null}
      {props.canManage && entry.status === "scheduled" ? (
        <p class="actions">
          <a class="btn secondary" href={`/reservations/${entry.id}/edit`}>Edit times or aircraft</a>
        </p>
      ) : null}
      {props.canManage && (entry.status === "scheduled" || (entry.status === "checked_out" && props.viewer.role === "admin")) ? (
        <section class="card card-pad">
          <h2>Cancel</h2>
          <form method="post" action={`/reservations/${entry.id}/cancel`} class="stack">
            <label>
              Note
              <input name="reason" maxlength={500} placeholder="Optional" />
            </label>
            <button class="btn danger" type="submit">Cancel reservation</button>
          </form>
        </section>
      ) : null}
    </Layout>
  );
}

export function toLocal(iso: string): string {
  return toDateTimeLocalValue(iso);
}
