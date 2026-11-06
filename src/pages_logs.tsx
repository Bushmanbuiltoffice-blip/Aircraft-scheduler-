/** @jsxImportSource hono/jsx */
import { BILLED_OUTSIDE_LABEL, formatFuel, formatGroundHours, formatHours, formatMeter, formatMoney, formatOil, fuelInputValue, fuelTallyText, oilInputValue, oilTallyText, paperPaidLabel, rateLabel, roleLabel, tallyFuel, tallyOil } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView, User } from "./types";
import { LogTable } from "./pages_dash";
import { canMarkPaid, PaymentControl } from "./payment";
import { meterWarnings } from "./domain";
import { canAdjustGround } from "./bills";
import { BillLinks } from "./pages_bills";
import { Layout, PageHead, RolePill, Warnings, type Viewer } from "./ui";

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
      <PageHead title="Flight logs" lede="Hobbs, tach, fuel, oil, and the amount billed at check-in. Fuel or oil left blank stays Not recorded, and 0 means none was added. New rentals start Unpaid until an admin or instructor marks them Paid. A row marked billed outside the app was already paid and is not on a balance." />
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
        <LogTable logs={props.logs} admin={canMarkPaid(props.viewer.role)} returnTo={props.pilotId ? `/logs?pilot=${encodeURIComponent(props.pilotId)}` : "/logs"} />
        <OilSummary logs={props.logs} />
        <FuelSummary logs={props.logs} />
      </section>
    </Layout>
  );
}

export function LogDetailPage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  log: FlightLogView;
  error?: string | null;
}) {
  const log = props.log;
  const canEditOil = props.viewer.role === "admin";
  return (
    <Layout title={`${log.tailNumber} log`} user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title={`${log.tailNumber} · ${formatHours(log.flightHours)} hr`} lede={formatDateTime(log.createdAt)}>
        <a class="btn secondary" href={`/reservations/${log.reservationId}`}>Reservation</a>
      </PageHead>
      {props.error ? <p class="alert" role="alert">{props.error}</p> : null}
      <Warnings
        warnings={
          log.imported
            ? []
            : meterWarnings({ stage: "checkin", hobbsFrom: log.hobbsOut, hobbsTo: log.hobbsIn, tachFrom: log.tachOut, tachTo: log.tachIn ?? log.tachOut ?? 0 })
        }
      />
      <section class="card card-pad detail-grid">
        <dl>
          <div><dt>Pilot</dt><dd><a href={`/pilots/${log.pilotId}`}>{log.pilotName}</a>{log.pilotRole === "student" ? <> <RolePill role="student" /></> : null}</dd></div>
          <div><dt>Instructor</dt><dd>{log.instructorId ? <a href={`/pilots/${log.instructorId}`}>{log.instructorName}</a> : (log.instructorName ?? "Solo")}</dd></div>
          <div><dt>Aircraft</dt><dd>{log.make} {log.model}</dd></div>
          {log.billingStatus === "external" ? null : (
            <div><dt>Rate</dt><dd>{rateLabel(log.rateBasis)} · {formatMoney(log.aircraftRateCents)}/hr</dd></div>
          )}
          <div><dt>Hobbs</dt><dd>{formatMeter(log.hobbsOut)} → {formatMeter(log.hobbsIn)}</dd></div>
          <div><dt>Tach (maintenance, not billed)</dt><dd>{formatMeter(log.tachOut)} → {formatMeter(log.tachIn)}</dd></div>
          <div><dt>Oil added</dt><dd>{formatOil(log.oilAddedQt)}</dd></div>
          <div><dt>Fuel added</dt><dd>{formatFuel(log.fuelAddedGal)}</dd></div>
          {log.billingStatus === "external" ? null : (
            <div><dt>Ground instruction</dt><dd>{log.groundCostCents == null ? (log.groundHours == null ? "Not recorded" : `${formatGroundHours(log.groundHours)} hr on the record, no ground charge`) : `${formatGroundHours(log.groundHours ?? 0)} hr · ${formatMoney(log.groundCostCents)}`}</dd></div>
          )}
          {log.imported ? <HistoricalDetails log={log} /> : null}
        </dl>
        <FlightChargeCard log={log} admin={canMarkPaid(props.viewer.role)} returnTo={`/logs/${log.id}`} />
      </section>
      {canEditOil ? (
        <section class="card card-pad">
          <h2>Oil added</h2>
          <form method="post" action={`/logs/${log.id}/oil`} class="stack oil-form">
            <label>
              Quarts
              <input name="oil_added_qt" inputmode="decimal" pattern="\d{1,2}(\.\d{1,2})?" value={oilInputValue(log.oilAddedQt)} placeholder="Blank if not recorded" />
            </label>
            <p class="muted">Use 0 if none was added. Leave blank for Not recorded. Saving oil does not change Hobbs, tach, charges, payment, or fuel.</p>
            <button class="btn secondary" type="submit">Save oil</button>
          </form>
        </section>
      ) : null}
      {canAdjustGround(props.viewer, log) ? (
        <section class="card card-pad">
          <h2>Ground instruction</h2>
          {log.paid ? <p class="alert" role="status">This flight is already marked paid for the whole rental. Saving ground changes the combined total and does not change that paid mark.</p> : null}
          <form method="post" action={`/logs/${log.id}/ground`} class="stack oil-form">
            <label>
              Hours
              <input name="ground_hours" inputmode="decimal" pattern="\d{1,2}(\.\d{1,2})?" value={log.groundHours == null ? "" : String(log.groundHours)} required placeholder="0 if none" />
            </label>
            <p class="muted">Uses the instructor rate saved on this flight ({formatMoney(log.instructorRateCents)}/hr), the same rate as flight instruction. Does not change Hobbs or the aircraft charge.</p>
            <button class="btn secondary" type="submit">Save ground instruction</button>
          </form>
        </section>
      ) : null}
      {canEditOil ? (
        <section class="card card-pad">
          <h2>Fuel added</h2>
          <form method="post" action={`/logs/${log.id}/fuel`} class="stack oil-form">
            <label>
              Gallons
              <input name="fuel_added_gal" inputmode="decimal" pattern="\d{1,4}(\.\d{1,2})?" value={fuelInputValue(log.fuelAddedGal)} placeholder="Blank if not recorded" />
            </label>
            <p class="muted">US gallons. Use 0 if none was added. Leave blank for Not recorded. Saving fuel does not change Hobbs, tach, charges, payment, or oil.</p>
            <button class="btn secondary" type="submit">Save fuel</button>
          </form>
        </section>
      ) : null}
    </Layout>
  );
}

export function OilSummary(props: { logs: Array<{ oilAddedQt: number | null }> }) {
  if (props.logs.length === 0) return null;
  return <p class="oil-summary">{oilTallyText(tallyOil(props.logs.map((log) => log.oilAddedQt)))}</p>;
}

export function FuelSummary(props: { logs: Array<{ fuelAddedGal: number | null }> }) {
  if (props.logs.length === 0) return null;
  return <p class="oil-summary">{fuelTallyText(tallyFuel(props.logs.map((log) => log.fuelAddedGal)))}</p>;
}

export function HistoricalDetails(props: { log: FlightLogView }) {
  const log = props.log;
  return (
    <>
      <div><dt>Flight type</dt><dd>{log.rentalType ?? "—"}</dd></div>
      <div><dt>Ground</dt><dd>{log.groundHours == null ? "—" : `${formatHours(log.groundHours)} hr`}</dd></div>
      <div><dt>Paper log</dt><dd>{paperPaidLabel(log)}</dd></div>
      {log.billingStatus === "external" ? <div><dt>Billing</dt><dd>{log.billingNote ?? BILLED_OUTSIDE_LABEL}</dd></div> : null}
    </>
  );
}

export function FlightChargeCard(props: { log: FlightLogView; admin?: boolean; returnTo?: string }) {
  const log = props.log;
  const control = <PaymentControl log={log} admin={Boolean(props.admin)} returnTo={props.returnTo ?? `/logs/${log.id}`} showWho />;
  if (log.billingStatus === "external") {
    return (
      <aside class="cost-card">
        <h2>Not billed here</h2>
        <p>{log.billingNote ?? BILLED_OUTSIDE_LABEL}</p>
        <BillLinks log={log} />
        <ul>
          <li>Aircraft charge {formatMoney(0)}</li>
          <li>Instructor charge {formatMoney(0)}</li>
        </ul>
        <strong>{formatMoney(0)}</strong>
        <div class="cost-pay">{control}</div>
        <p>This flight is not on the pilot's balance.</p>
      </aside>
    );
  }
  return (
    <aside class="cost-card">
      <ul>
        <li>Aircraft {formatHours(log.flightHours)} × {formatMoney(log.aircraftRateCents)} = {formatMoney(log.aircraftCostCents)}</li>
        <li>Flight instruction {formatHours(log.instructorHours)} × {formatMoney(log.instructorRateCents)} = {formatMoney(log.instructorCostCents)}</li>
        {log.groundCostCents == null ? null : (
          <li>Ground instruction {formatGroundHours(log.groundHours ?? 0)} × {formatMoney(log.groundRateCents ?? log.instructorRateCents)} = {formatMoney(log.groundCostCents)}</li>
        )}
      </ul>
      <strong>{formatMoney(log.totalCostCents)}</strong>
      <BillLinks log={log} />
      <div class="cost-pay">{control}</div>
    </aside>
  );
}
