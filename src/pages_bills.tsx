/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import {
  BILL_BUSINESS_NAME,
  BILL_PAYMENT_NOTE,
  aircraftBillId,
  canPrintAircraftBill,
  canPrintInstructorBill,
  instructorBillId,
  instructorBillTotalCents,
} from "./bills";
import { formatGroundHours, formatHours, formatMeter, formatMoney, rateLabel } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView } from "./types";
import { Layout, type Viewer } from "./ui";

export function AircraftBillPage(props: { viewer: Viewer; usingDevSecret: boolean; log: FlightLogView }) {
  const log = props.log;
  return (
    <Layout title={`Aircraft bill ${log.tailNumber}`} user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret}>
      <BillSheet
        kind="Aircraft rental"
        billId={aircraftBillId(log.id)}
        customer={log.pilotName}
        when={formatDateTime(log.createdAt)}
      >
        <div><dt>Aircraft</dt><dd>{log.tailNumber} · {log.make} {log.model}</dd></div>
        <div><dt>Hobbs</dt><dd>{formatMeter(log.hobbsOut)} → {formatMeter(log.hobbsIn)} · {formatHours(log.flightHours)} hr</dd></div>
        <div><dt>Saved rate</dt><dd>{rateLabel(log.rateBasis)} · {formatMoney(log.aircraftRateCents)}/hr</dd></div>
        <div><dt>Aircraft charge</dt><dd>{formatHours(log.flightHours)} hr × {formatMoney(log.aircraftRateCents)} = {formatMoney(log.aircraftCostCents)}</dd></div>
        <p class="bill-total"><span>Total</span> <strong>{formatMoney(log.aircraftCostCents)}</strong></p>
      </BillSheet>
    </Layout>
  );
}

export function InstructorBillPage(props: { viewer: Viewer; usingDevSecret: boolean; log: FlightLogView }) {
  const log = props.log;
  return (
    <Layout title="Instructor bill" user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret}>
      <BillSheet
        kind="Instruction"
        billId={instructorBillId(log.id)}
        customer={log.pilotName}
        when={formatDateTime(log.createdAt)}
      >
        <div><dt>Instructor</dt><dd>{log.instructorName ?? "Name not on this flight record"}</dd></div>
        <div><dt>Flight instruction</dt><dd>{formatHours(log.instructorHours)} hr × {formatMoney(log.instructorRateCents)}/hr = {formatMoney(log.instructorCostCents)}</dd></div>
        <div><dt>Rate</dt><dd>Saved instructor rate {formatMoney(log.instructorRateCents)}/hr. Ground uses this same rate.</dd></div>
        {log.groundCostCents == null ? (
          <div><dt>Ground instruction</dt><dd>Not recorded. No ground charge is included.</dd></div>
        ) : (
          <div><dt>Ground instruction</dt><dd>{formatGroundHours(log.groundHours ?? 0)} hr × {formatMoney(log.groundRateCents ?? log.instructorRateCents)}/hr = {formatMoney(log.groundCostCents)}</dd></div>
        )}
        <p class="bill-total"><span>Instructor total</span> <strong>{formatMoney(instructorBillTotalCents(log))}</strong></p>
      </BillSheet>
    </Layout>
  );
}

export function NoBillPage(props: { viewer: Viewer; usingDevSecret: boolean; title: string; reason: string }) {
  return (
    <Layout title={props.title} user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret}>
      <article class="card card-pad bill-sheet" id="no-bill">
        <h1>{props.title}</h1>
        <p>{props.reason}</p>
        <p><a class="btn secondary no-print" href="/logs">Back to flight logs</a></p>
      </article>
    </Layout>
  );
}

function BillSheet(props: {
  kind: string;
  billId: string;
  customer: string;
  when: string;
  children?: Child;
}) {
  return (
    <article class="card card-pad bill-sheet" id="bill">
      <header class="bill-head">
        <p class="bill-business">{BILL_BUSINESS_NAME}</p>
        <h1>{props.kind} bill</h1>
        <p class="muted">Bill {props.billId}</p>
      </header>
      <dl class="bill-facts">
        <div><dt>Customer</dt><dd>{props.customer}</dd></div>
        <div><dt>Date</dt><dd>{props.when}</dd></div>
        {props.children}
      </dl>
      <p class="bill-pay">{BILL_PAYMENT_NOTE}</p>
      <p class="no-print bill-actions">
        <button class="btn" id="print-bill" type="button">Print or save PDF</button>
        <a class="btn secondary" href="/logs">Back to flight logs</a>
      </p>
      <script src="/bill-print.js"></script>
    </article>
  );
}

export function BillLinks(props: { log: FlightLogView }) {
  const log = props.log;
  if (!canPrintAircraftBill(log)) {
    return <p class="bill-links muted">Billed outside the app. No new bill.</p>;
  }
  return (
    <p class="bill-links">
      <a href={`/logs/${log.id}/bill/aircraft`}>Print aircraft bill</a>
      {canPrintInstructorBill(log) ? <a href={`/logs/${log.id}/bill/instructor`}>Print instructor bill</a> : <span class="muted">No instructor bill</span>}
    </p>
  );
}
