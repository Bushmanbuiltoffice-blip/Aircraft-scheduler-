/** @jsxImportSource hono/jsx */
import { BILLED_OUTSIDE_LABEL, formatHours, formatMeter, formatMoney, formatQuantity, paperPaidLabel, rateLabel, roleLabel } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView, User } from "./types";
import { LogTable } from "./pages_dash";
import { Layout, PageHead, RolePill, type Viewer } from "./ui";

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
      <PageHead title="Flight logs" lede="Hobbs, tach, fuel, oil, and the amount billed at check-in. A row marked billed outside the app was already paid and is not on a balance." />
      {props.viewer.role === "admin" ? (
        <form class="toolbar" method="get" action="/logs">
          <label>
            Pilot
            <select name="pilot">
              <option value="">Everyone</option>
              {props.pilots.map((pilot) => (
                <option value={pilot.id} selected={pilot.id === props.pilotId}>{pilot.name} · {roleLabel(pilot.role)}</option>
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
          <div><dt>Pilot</dt><dd><a href={`/pilots/${log.pilotId}`}>{log.pilotName}</a>{log.pilotRole === "student" ? <> <RolePill role="student" /></> : null}</dd></div>
          <div><dt>Instructor</dt><dd>{log.instructorId ? <a href={`/pilots/${log.instructorId}`}>{log.instructorName}</a> : (log.instructorName ?? "Solo")}</dd></div>
          <div><dt>Aircraft</dt><dd>{log.make} {log.model}</dd></div>
          {log.billingStatus === "external" ? null : (
            <div><dt>Rate</dt><dd>{rateLabel(log.rateBasis)} · {formatMoney(log.aircraftRateCents)}/hr</dd></div>
          )}
          <div><dt>Hobbs</dt><dd>{formatMeter(log.hobbsOut)} → {formatMeter(log.hobbsIn)}</dd></div>
          <div><dt>Tach</dt><dd>{formatMeter(log.tachOut)} → {formatMeter(log.tachIn)}</dd></div>
          {log.imported ? <HistoricalDetails log={log} /> : null}
        </dl>
        <FlightChargeCard log={log} />
      </section>
    </Layout>
  );
}

export function HistoricalDetails(props: { log: FlightLogView }) {
  const log = props.log;
  return (
    <>
      <div><dt>Flight type</dt><dd>{log.rentalType ?? "—"}</dd></div>
      <div><dt>Ground</dt><dd>{log.groundHours == null ? "—" : `${formatHours(log.groundHours)} hr`}</dd></div>
      <div><dt>Fuel added</dt><dd>{formatQuantity(log.fuelAddedGal, "gal")}</dd></div>
      <div><dt>Oil added</dt><dd>{formatQuantity(log.oilAddedQt, "qt")}</dd></div>
      <div><dt>Paper log</dt><dd>{paperPaidLabel(log)}</dd></div>
      {log.billingStatus === "external" ? <div><dt>Billing</dt><dd>{log.billingNote ?? BILLED_OUTSIDE_LABEL}</dd></div> : null}
    </>
  );
}

export function FlightChargeCard(props: { log: FlightLogView }) {
  const log = props.log;
  if (log.billingStatus === "external") {
    return (
      <aside class="cost-card">
        <h2>Not billed here</h2>
        <p>{log.billingNote ?? BILLED_OUTSIDE_LABEL}</p>
        <ul>
          <li>Aircraft charge {formatMoney(0)}</li>
          <li>Instructor charge {formatMoney(0)}</li>
        </ul>
        <strong>{formatMoney(0)}</strong>
        <p>This flight is not on the pilot's balance.</p>
      </aside>
    );
  }
  return (
    <aside class="cost-card">
      <ul>
        <li>Aircraft {formatHours(log.flightHours)} × {formatMoney(log.aircraftRateCents)} = {formatMoney(log.aircraftCostCents)}</li>
        <li>Instructor {formatHours(log.instructorHours)} × {formatMoney(log.instructorRateCents)} = {formatMoney(log.instructorCostCents)}</li>
      </ul>
      <strong>{formatMoney(log.totalCostCents)}</strong>
    </aside>
  );
}
