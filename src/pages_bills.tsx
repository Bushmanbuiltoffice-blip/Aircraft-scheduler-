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
  paymentMethodLabel,
} from "./bills";
import { formatGroundHours, formatHours, formatMeter, formatMoney, rateLabel } from "./format";
import { formatDateTime } from "./time";
import type { FlightLogView } from "./types";
import { MarkBillPaid } from "./payment";
import { Layout, type Viewer } from "./ui";

export function AircraftBillPage(props: { viewer: Viewer; usingDevSecret: boolean; log: FlightLogView; canMark: boolean; notice?: string | null; error?: string | null }) {
  const log = props.log;
  return (
    <Layout title={`Aircraft bill ${log.tailNumber}`} user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret} notice={props.notice}>
      {props.error ? <p class="alert" role="alert">{props.error}</p> : null}
      <BillSheet
        kind="Aircraft rental"
        billId={aircraftBillId(log.id)}
        customer={log.pilotName}
        when={formatDateTime(log.createdAt)}
        pdfHref={`/logs/${log.id}/bill/aircraft.pdf`}
        payment={
          <BillPayment
            log={log}
            bill="aircraft"
            canMark={props.canMark}
            covers="This is the aircraft bill only. It does not mark the instructor bill."
          />
        }
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

export function InstructorBillPage(props: { viewer: Viewer; usingDevSecret: boolean; log: FlightLogView; canMark: boolean; notice?: string | null; error?: string | null }) {
  const log = props.log;
  const covers = log.groundCostCents == null
    ? "This instructor bill covers flight instruction. Ground instruction was not recorded, so it is not charged on this bill."
    : "This instructor bill covers flight instruction and ground instruction. One cash or check choice pays this whole instructor bill.";
  return (
    <Layout title="Instructor bill" user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret} notice={props.notice}>
      {props.error ? <p class="alert" role="alert">{props.error}</p> : null}
      <BillSheet
        kind="Instruction"
        billId={instructorBillId(log.id)}
        customer={log.pilotName}
        when={formatDateTime(log.createdAt)}
        pdfHref={`/logs/${log.id}/bill/instructor.pdf`}
        payment={
          <BillPayment
            log={log}
            bill="instructor"
            canMark={props.canMark}
            covers={covers}
          />
        }
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

function BillPayment(props: {
  log: FlightLogView;
  bill: "aircraft" | "instructor";
  canMark: boolean;
  covers: string;
}) {
  return (
    <>
      {props.canMark ? <MarkBillPaid log={props.log} bill={props.bill} surface="bill" /> : (
        <p class="bill-paid-mark" id="bill-payment-mark">{paymentMethodLabel(props.bill === "aircraft" ? props.log.aircraftPaymentMethod : props.log.instructorPaymentMethod, props.log.paid)}</p>
      )}
      <p class="bill-coverage" id="bill-coverage">{props.covers}</p>
      <p class="bill-pay">{BILL_PAYMENT_NOTE}</p>
    </>
  );
}

function BillSheet(props: {
  kind: string;
  billId: string;
  customer: string;
  when: string;
  pdfHref?: string;
  payment?: Child;
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
      {props.payment}
      <p class="no-print bill-actions">
        <button class="btn browser-print" id="print-bill" type="button">Print</button>
        {props.pdfHref ? <a class="btn save-pdf" id="save-pdf" href={props.pdfHref} target="_blank" rel="noopener">Save PDF</a> : null}
        <a class="btn secondary" href="/logs">Back to flight logs</a>
      </p>
      <p id="print-status" class="no-print alert" role="status" hidden></p>
      <input id="print-url" class="no-print" readonly hidden aria-label="Document address" />
      <script src="/bill-print.js?v=5"></script>
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
