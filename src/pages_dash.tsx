/** @jsxImportSource hono/jsx */
import { BILLED_OUTSIDE_LABEL, formatHours, formatMeter, formatMoney, formatOil, statusLabel } from "./format";
import { formatDateTime, formatTime } from "./time";
import { canMarkPaid, PaymentControl } from "./payment";
import type { Aircraft, Checkout, FlightLogView, MaintenanceBlock, PilotBilling, ScheduleEntry } from "./types";
import { Layout, PageHead, RolePill, type Viewer } from "./ui";

/** The dashboard shows only the most recent flights; /logs has the full list. */
export const DASHBOARD_LOG_LIMIT = 3;

export function DashboardPage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  todayLabel: string;
  today: ScheduleEntry[];
  upcoming: ScheduleEntry[];
  aircraft: Aircraft[];
  maintenance: MaintenanceBlock[];
  logs: FlightLogView[];
  billing: PilotBilling[];
  month: { hours: number; cents: number; flights: number; label: string };
  medicalBanner: string | null;
  checkouts: Array<Checkout & { tail: string }>;
}) {
  const grounded = props.aircraft.filter((item) => item.status === "grounded");
  const available = props.aircraft.length - grounded.length;
  const active = props.today.filter((item) => item.status === "checked_out").length;
  return (
    <Layout title="Dashboard" user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title={props.viewer.role === "admin" ? "Dispatch" : "Your day"} lede={props.todayLabel} />
      {props.medicalBanner ? <p class="alert" role="alert">{props.medicalBanner}</p> : null}
      {/* Kyle's order: Coming up, then Aircraft, then everything else. Same order on phones. */}
      <section class="card card-pad" id="dash-coming-up">
        <header class="section-head">
          <h2>Coming up</h2>
          <a href="/reservations/new">New reservation</a>
        </header>
        {props.upcoming.length === 0 ? <p class="muted">No upcoming reservations.</p> : <ReservationList items={props.upcoming} />}
      </section>
      <section class="card card-pad" id="dash-aircraft">
        <header class="section-head">
          <h2>Aircraft</h2>
          {props.viewer.role === "admin" ? <a href="/aircraft/new">Add aircraft</a> : <a href="/aircraft">Fleet</a>}
        </header>
        <ul class="fleet-list">
          {props.aircraft.map((item) => {
            const down = props.maintenance.find((block) => block.aircraftId === item.id);
            return (
              <li>
                <a href={`/aircraft/${item.id}`}>
                  <span class="tail">{item.tailNumber}</span>
                  <span>{item.make} {item.model}</span>
                </a>
                <span class={`pill ${item.status}`}>{statusLabel(item.status)}</span>
                {down ? <small class="muted">Down: {down.reason}</small> : <small class="muted">Hobbs {formatMeter(item.hobbs)} · Tach {formatMeter(item.tach)}</small>}
                {props.viewer.role === "admin" ? <a class="tbx-link" href={`/aircraft/${item.id}/tbx`}>TBX update</a> : null}
              </li>
            );
          })}
          {props.aircraft.length === 0 ? <li class="muted">No aircraft yet.</li> : null}
        </ul>
      </section>
      <section class="stats">
        <article class="stat">
          <strong>{props.today.length}</strong>
          <span>On today's board</span>
        </article>
        <article class="stat">
          <strong>{active}</strong>
          <span>Checked out now</span>
        </article>
        <article class="stat">
          <strong>{available}</strong>
          <span>Aircraft available</span>
        </article>
        <article class="stat">
          <strong>{formatHours(props.month.hours)}</strong>
          <span>Hobbs hours in {props.month.label}</span>
        </article>
      </section>
      <section class="card card-pad" id="dash-today">
        <header class="section-head">
          <h2>Today</h2>
          <a href="/schedule">Open the board</a>
        </header>
        {props.today.length === 0 ? <p class="muted">Nothing on the board today.</p> : <ReservationList items={props.today} />}
      </section>
      {props.viewer.role !== "admin" ? (
        <section class="card card-pad">
          <h2>Your checkouts</h2>
          {props.checkouts.length === 0 ? (
            <p class="muted">You are not checked out in any aircraft yet. An instructor can add that on your person page.</p>
          ) : (
            <ul class="plain">
              {props.checkouts.map((checkout) => (
                <li>
                  <span class="tail">{checkout.tail}</span> {checkout.status}
                  {checkout.expiresOn ? ` · through ${checkout.expiresOn}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <section class="card" id="dash-flight-log">
        <header class="section-head pad">
          <h2>Last {DASHBOARD_LOG_LIMIT} flights</h2>
          <a href="/logs">View all flight logs</a>
        </header>
        <LogTable logs={props.logs.slice(0, DASHBOARD_LOG_LIMIT)} admin={canMarkPaid(props.viewer.role)} returnTo="/" />
      </section>
      {props.viewer.role === "admin" ? (
        <section class="card">
          <header class="section-head pad">
            <h2>Billing by pilot</h2>
            <span class="muted">{formatMoney(props.month.cents)} billed this month · {props.month.flights} in-app flights</span>
          </header>
          <p class="pad billing-outstanding" id="dash-outstanding">
            <strong>{formatMoney(props.billing.reduce((sum, row) => sum + row.unpaidCents, 0))}</strong> outstanding (unpaid rentals)
            {" · "}
            <a href="/logs">Mark rentals paid on the flight log</a>
          </p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pilot</th>
                  <th>Flights</th>
                  <th>Hobbs</th>
                  <th>Billed</th>
                  <th>Paid</th>
                  <th>Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {props.billing.map((row) => (
                  <tr>
                    <td><a href={`/pilots/${row.id}`}>{row.name}</a></td>
                    <td>{row.flights}</td>
                    <td>{formatHours(row.hours)}</td>
                    <td>{formatMoney(row.totalCents)}</td>
                    <td>{formatMoney(row.paidCents)}</td>
                    <td class={row.unpaidCents > 0 ? "owed" : ""}>
                      {formatMoney(row.unpaidCents)}
                      {row.unpaidFlights > 0 ? <small class="muted"> · {row.unpaidFlights} unpaid</small> : null}
                    </td>
                  </tr>
                ))}
                {props.billing.length === 0 ? (
                  <tr><td colspan={6} class="muted">No in-app charges yet. Cost is calculated at check-in. Flights billed outside the app stay on the flight log.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </Layout>
  );
}

function ReservationList(props: { items: ScheduleEntry[] }) {
  return (
    <ul class="booking-list">
      {props.items.map((item) => (
        <li>
          <a href={`/reservations/${item.id}`}>
            <span class={`pill ${item.status}`}>{statusLabel(item.status)}</span>
            <span class="tail">{item.tailNumber}</span>
            <strong>{formatTime(item.startsAt)}–{formatTime(item.endsAt)}</strong>
            <span>{item.pilotName}{item.instructorName ? ` · ${item.instructorName}` : " · Solo"}</span>
            <small class="muted">{formatDateTime(item.startsAt)}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function LogTable(props: { logs: FlightLogView[]; admin?: boolean; returnTo?: string }) {
  const returnTo = props.returnTo ?? "/logs";
  return (
    <div class="table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Pilot</th>
            <th>Aircraft</th>
            <th>Type</th>
            <th>Hobbs</th>
            <th>Hours</th>
            <th>Oil</th>
            <th>Total</th>
            <th>Payment</th>
          </tr>
        </thead>
        <tbody>
          {props.logs.map((log) => (
            <tr id={`log-${log.id}`}>
              <td data-label="When"><a href={`/logs/${log.id}`}>{formatDateTime(log.createdAt)}</a></td>
              <td data-label="Pilot">
                {log.pilotName}
                {log.pilotRole === "student" ? <> <RolePill role="student" /></> : null}
                {log.instructorName ? <small class="muted"> with {log.instructorName}</small> : null}
              </td>
              <td data-label="Aircraft" class="tail">{log.tailNumber}</td>
              <td data-label="Type">{log.rentalType ?? "—"}</td>
              <td data-label="Hobbs">{formatMeter(log.hobbsOut)}–{formatMeter(log.hobbsIn)}</td>
              <td data-label="Hours">
                {formatHours(log.flightHours)}
                {log.groundHours != null && log.groundHours > 0 ? <small class="muted">{formatHours(log.groundHours)} ground</small> : null}
              </td>
              <td data-label="Oil">{formatOil(log.oilAddedQt)}</td>
              <td data-label="Total">
                {log.billingStatus === "external" ? (
                  <>
                    <span class="pill external">Billed outside</span>
                    <small class="muted">{log.billingNote ?? BILLED_OUTSIDE_LABEL}</small>
                  </>
                ) : (
                  <span class="amount">{formatMoney(log.totalCostCents)}</span>
                )}
              </td>
              <td class="pay-cell" data-label="Payment">
                <PaymentControl log={log} admin={Boolean(props.admin)} returnTo={`${returnTo}#log-${log.id}`} />
              </td>
            </tr>
          ))}
          {props.logs.length === 0 ? <tr><td colspan={9} class="muted">No flights logged yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
