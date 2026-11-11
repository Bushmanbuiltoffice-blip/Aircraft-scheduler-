/** @jsxImportSource hono/jsx */
import { BILLED_OUTSIDE_LABEL, formatFuel, formatGroundHours, formatHours, formatMeter, formatOil } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView } from "./types";
import { Layout, type Viewer } from "./ui";

const NOT_RECORDED = "Not recorded";

function recordedMeter(value: number | null): string {
  return value == null ? NOT_RECORDED : formatMeter(value);
}

function recordedHours(value: number | null): string {
  return value == null ? NOT_RECORDED : `${formatGroundHours(value)} hr`;
}

function tachDuration(out: number | null, inn: number | null): string {
  if (out == null || inn == null) return NOT_RECORDED;
  return `${formatHours(Math.round((inn - out) * 10) / 10)} hr`;
}

export function FlightRecordPage(props: { viewer: Viewer; usingDevSecret: boolean; log: FlightLogView }) {
  const log = props.log;
  const external = log.billingStatus === "external";
  return (
    <Layout title={`Flight record ${log.tailNumber}`} user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret}>
      <article class="card card-pad bill-sheet" id="flight-record">
        <header class="bill-head">
          <p class="bill-business">Firehound Rental</p>
          <h1>Flight record</h1>
          <p class="muted">Record {log.id}</p>
        </header>
        <p class="bill-coverage">
          This is a copy of the flight saved in Firehound Rental. It is not a signed pilot logbook or a maintenance logbook, and it does not create a charge.
        </p>
        <dl class="bill-facts">
          <div><dt>When</dt><dd>{formatDateTime(log.createdAt)} Pacific</dd></div>
          <div><dt>Aircraft</dt><dd>{log.tailNumber} · {log.make} {log.model}</dd></div>
          <div><dt>Pilot</dt><dd>{log.pilotName}</dd></div>
          <div><dt>Instructor</dt><dd>{log.instructorName ?? "Solo"}</dd></div>
          <div><dt>Flight type</dt><dd>{log.rentalType ?? NOT_RECORDED}</dd></div>
          <div><dt>Hobbs out</dt><dd>{recordedMeter(log.hobbsOut)}</dd></div>
          <div><dt>Hobbs in</dt><dd>{recordedMeter(log.hobbsIn)}</dd></div>
          <div><dt>Hobbs time</dt><dd>{formatHours(log.flightHours)} hr</dd></div>
          <div><dt>Tach out</dt><dd>{recordedMeter(log.tachOut)}</dd></div>
          <div><dt>Tach in</dt><dd>{recordedMeter(log.tachIn)}</dd></div>
          <div><dt>Tach time</dt><dd>{tachDuration(log.tachOut, log.tachIn)}</dd></div>
          <div><dt>Ground</dt><dd>{recordedHours(log.groundHours)}</dd></div>
          <div><dt>Fuel added</dt><dd>{formatFuel(log.fuelAddedGal)}</dd></div>
          <div><dt>Oil added</dt><dd>{formatOil(log.oilAddedQt)}</dd></div>
          {log.maintenanceFlight ? <div><dt>Maintenance</dt><dd>Recorded as a maintenance flight.</dd></div> : null}
        </dl>
        <p class="bill-pay">
          {external
            ? `${log.billingNote ?? BILLED_OUTSIDE_LABEL} This page is not an invoice.`
            : "Hobbs is the billed time. Tach is a maintenance reading and is not used to calculate a charge. Saved charges, if any, stay on the separate bills."}
        </p>
        <p class="no-print bill-actions">
          <button class="btn browser-print" id="print-record" type="button">Print</button>
          <a class="btn save-pdf" id="save-pdf" href={`/logs/${log.id}/record.pdf`} target="_blank" rel="noopener">Save PDF</a>
          <a class="btn secondary" href={`/logs/${log.id}`}>Back to this flight</a>
        </p>
        <p id="print-status" class="no-print alert" role="status" hidden></p>
        <input id="print-url" class="no-print" readonly hidden aria-label="Document address" />
        <script src="/bill-print.js?v=5"></script>
      </article>
    </Layout>
  );
}
