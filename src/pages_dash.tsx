/** @jsxImportSource hono/jsx */
import { formatHours, formatMeter, formatMoney, statusLabel } from "./format";
import { formatDateTime, formatTime } from "./time";
import type { Aircraft, Checkout, FlightLogView, MaintenanceBlock, PilotBilling, ScheduleEntry } from "./types";
import { Layout, PageHead, type Viewer } from "./ui";

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
  outbox: Array<{ subject: string; toEmail: string; createdAt: string }>;
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
      <div class="cols">
        <section class="card card-pad">
          <header class="section-head">
            <h2>Today</h2>
            <a href="/schedule">Open the board</a>
          </header>
          {props.today.length === 0 ? <p class="muted">Nothing on the board today.</p> : <ReservationList items={props.today} />}
        </section>
        <section class="card card-pad">
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
                  {down ? <small class="muted">Down: {down.reason}</small> : <small class="muted">Hobbs {formatMeter(item.hobbs)}</small>}
                </li>
              );
            })}
            {props.aircraft.length === 0 ? <li class="muted">No aircraft yet.</li> : null}
          </ul>
        </section>
      </div>
      <section class="card card-pad">
        <header class="section-head">
          <h2>Coming up</h2>
          <a href="/reservations/new">New reservation</a>
        </header>
        {props.upcoming.length === 0 ? <p class="muted">No upcoming reservations.</p> : <ReservationList items={props.upcoming} />}
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
      <section class="card">
        <header class="section-head pad">
          <h2>Flight log</h2>
          <a href="/logs">All logs</a>
        </header>
        <LogTable logs={props.logs} />
      </section>
      {props.viewer.role === "admin" ? (
        <section class="card">
          <header class="section-head pad">
            <h2>Billing by pilot</h2>
            <span class="muted">{formatMoney(props.month.cents)} this month · {props.month.flights} flights</span>
          </header>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pilot</th>
                  <th>Flights</th>
                  <th>Hobbs</th>
                  <th>Billed</th>
                </tr>
              </thead>
              <tbody>
                {props.billing.map((row) => (
                  <tr>
                    <td><a href={`/pilots/${row.id}`}>{row.name}</a></td>
                    <td>{row.flights}</td>
                    <td>{formatHours(row.hours)}</td>
                    <td>{formatMoney(row.totalCents)}</td>
                  </tr>
                ))}
                {props.billing.length === 0 ? (
                  <tr><td colspan={4} class="muted">No closed flights yet. Cost is calculated at check-in.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {props.viewer.role === "admin" ? (
        <section class="card card-pad">
          <header class="section-head">
            <h2>Notifications</h2>
            <span class="muted">Saved here. Not emailed.</span>
          </header>
          {props.outbox.length === 0 ? <p class="muted">No notifications yet.</p> : (
            <ul class="plain">
              {props.outbox.map((item) => (
                <li>
                  <strong>{item.subject}</strong>
                  <span class="muted"> to {item.toEmail} · {formatDateTime(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
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

export function LogTable(props: { logs: FlightLogView[] }) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Pilot</th>
            <th>Aircraft</th>
            <th>Hobbs</th>
            <th>Hours</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {props.logs.map((log) => (
            <tr>
              <td><a href={`/logs/${log.id}`}>{formatDateTime(log.createdAt)}</a></td>
              <td>
                {log.pilotName}
                {log.instructorName ? <small class="muted"> with {log.instructorName}</small> : null}
              </td>
              <td class="tail">{log.tailNumber}</td>
              <td>{formatMeter(log.hobbsOut)}–{formatMeter(log.hobbsIn)}</td>
              <td>{formatHours(log.flightHours)}</td>
              <td>{formatMoney(log.totalCostCents)}</td>
            </tr>
          ))}
          {props.logs.length === 0 ? <tr><td colspan={6} class="muted">No flights logged yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
