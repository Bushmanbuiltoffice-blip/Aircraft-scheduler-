/** @jsxImportSource hono/jsx */
import { formatHours, formatMeter, formatMoney, rateLabel } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView, User } from "./types";
import { LogTable } from "./pages_dash";
import { Layout, PageHead, type Viewer } from "./ui";

export function LogsPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  logs: FlightLogView[];
  pilots: User[];
  pilotId: string;
}) {
  return (
    <Layout title="Flight logs" user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead title="Flight logs" lede="Hobbs time, tach, and the amount billed when the flight was checked in." />
      {props.viewer.role === "admin" ? (
        <form class="toolbar" method="get" action="/logs">
          <label>
            Pilot
            <select name="pilot">
              <option value="">Everyone</option>
              {props.pilots.map((pilot) => (
                <option value={pilot.id} selected={pilot.id === props.pilotId}>{pilot.name}</option>
              ))}
            </select>
          </label>
          <button class="btn secondary" type="submit">Filter</button>
        </form>
      ) : null}
      <section class="card">
        <LogTable logs={props.logs} />
      </section>
    </Layout>
  );
}

export function LogDetailPage(props: { viewer: Viewer; path: string; usingDevSecret: boolean; log: FlightLogView }) {
  const log = props.log;
  return (
    <Layout title={`${log.tailNumber} log`} user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead title={`${log.tailNumber} · ${formatHours(log.flightHours)} hr`} lede={formatDateTime(log.createdAt)}>
        <a class="btn secondary" href={`/reservations/${log.reservationId}`}>Reservation</a>
      </PageHead>
      <section class="card card-pad detail-grid">
        <dl>
          <div><dt>Pilot</dt><dd><a href={`/pilots/${log.pilotId}`}>{log.pilotName}</a></dd></div>
          <div><dt>Instructor</dt><dd>{log.instructorName ?? "Solo"}</dd></div>
          <div><dt>Aircraft</dt><dd>{log.make} {log.model}</dd></div>
          <div><dt>Rate</dt><dd>{rateLabel(log.rateBasis)} · {formatMoney(log.aircraftRateCents)}/hr</dd></div>
          <div><dt>Hobbs</dt><dd>{formatMeter(log.hobbsOut)} → {formatMeter(log.hobbsIn)}</dd></div>
          <div><dt>Tach</dt><dd>{formatMeter(log.tachOut)} → {formatMeter(log.tachIn)}</dd></div>
        </dl>
        <aside class="cost-card">
          <ul>
            <li>Aircraft {formatHours(log.flightHours)} × {formatMoney(log.aircraftRateCents)} = {formatMoney(log.aircraftCostCents)}</li>
            <li>Instructor {formatHours(log.instructorHours)} × {formatMoney(log.instructorRateCents)} = {formatMoney(log.instructorCostCents)}</li>
          </ul>
          <strong>{formatMoney(log.totalCostCents)}</strong>
        </aside>
      </section>
    </Layout>
  );
}
