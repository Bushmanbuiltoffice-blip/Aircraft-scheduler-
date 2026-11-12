/** @jsxImportSource hono/jsx */
import { BILL_PAYMENT_QUESTION, canPrintInstructorBill, paymentMethodLabel, type BillKind } from "./bills";
import { formatDateTime } from "./time";
import type { FlightLogView, Role } from "./types";

/** Admins and instructors can mark rentals paid or unpaid. Renters and students see the badge only. */
export function canMarkPaid(role: Role): boolean {
  return role === "admin" || role === "instructor";
}

export type PaymentState = "paid" | "unpaid" | "outside";

/** Historical flights billed outside the app count as paid there and never get a toggle. */
export function paymentState(log: Pick<FlightLogView, "billingStatus" | "paid">): PaymentState {
  if (log.billingStatus === "external") return "outside";
  return log.paid ? "paid" : "unpaid";
}

const LABEL: Record<PaymentState, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  outside: "Paid outside app",
};

export function PaidBadge(props: { log: Pick<FlightLogView, "billingStatus" | "paid"> }) {
  const state = paymentState(props.log);
  return <span class={`pay-badge pay-${state}`}>{LABEL[state]}</span>;
}

/** Only relative, same-site paths are allowed as a return target. */
export function safeReturnPath(value: string | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

/** Adds a notice without breaking a query string or a hash on the return path. */
export function withNotice(path: string, notice: string): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const before = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const join = before.includes("?") ? "&" : "?";
  return `${before}${join}notice=${encodeURIComponent(notice)}${hash}`;
}

/** In-app flights have an aircraft bill, plus an instructor bill when that charge or ground is saved. Imports have neither. */
export function payableBills(log: Pick<FlightLogView, "billingStatus" | "instructorId" | "instructorName" | "instructorCostCents" | "groundCostCents">): BillKind[] {
  if (log.billingStatus === "external") return [];
  const bills: BillKind[] = ["aircraft"];
  if (canPrintInstructorBill(log)) bills.push("instructor");
  return bills;
}

/**
 * Cash or check for one bill. Nothing is selected. Mark unpaid appears only after a method is saved,
 * so the unpaid question and the unpaid button are never on screen together.
 */
export function MarkBillPaid(props: { log: FlightLogView; bill: BillKind; returnTo?: string; surface?: "bill" | "row" }) {
  const log = props.log;
  const method = props.bill === "aircraft" ? log.aircraftPaymentMethod : log.instructorPaymentMethod;
  const status = paymentMethodLabel(method, log.paid);
  const heading = props.bill === "aircraft" ? "Aircraft bill" : "Instructor bill";
  const onBill = props.surface === "bill";
  const slotId = onBill ? "bill-pay-slot" : `mark-paid-${props.bill}-${log.id}`;
  const formId = onBill ? "bill-pay-form" : undefined;
  const markId = onBill ? "bill-payment-mark" : undefined;
  const when = `${log.pilotName}, ${log.tailNumber}, ${formatDateTime(log.createdAt)}`;
  const groundNote = !onBill && props.bill === "instructor" && (log.groundCostCents ?? 0) > 0
    ? "Ground instruction is included on this instructor bill."
    : null;
  return (
    <div class="bill-pay-slot" id={slotId}>
      <p class="bill-paid-mark" id={markId}>{onBill ? status : `${heading}: ${status}`}</p>
      {groundNote ? <p class="muted bill-ground-note">{groundNote}</p> : null}
      {method ? (
        <form method="post" action={`/logs/${log.id}/bill/${props.bill}/payment`} class={onBill ? "no-print" : "bill-pay-form"}>
          {props.returnTo ? <input type="hidden" name="next" value={props.returnTo} /> : null}
          <button class="btn secondary" type="submit" name="action" value="clear" aria-label={`Mark ${heading} unpaid: ${when}`}>
            Mark this bill unpaid
          </button>
        </form>
      ) : (
        <form method="post" action={`/logs/${log.id}/bill/${props.bill}/payment`} id={formId} class={onBill ? "no-print bill-pay-form" : "bill-pay-form"}>
          <fieldset>
            <legend id={onBill ? "pay-question" : undefined}>{onBill ? BILL_PAYMENT_QUESTION : `${heading}. ${BILL_PAYMENT_QUESTION}`}</legend>
            <label><input type="radio" name="method" value="cash" required /> Cash</label>
            <label><input type="radio" name="method" value="check" required /> Check</label>
          </fieldset>
          <button class="btn" type="submit" name="action" value="record" aria-label={`Mark ${heading} paid: ${when}`}>
            Mark paid
          </button>
          <button class="btn secondary" type="reset">Cancel</button>
          {props.returnTo ? <input type="hidden" name="next" value={props.returnTo} /> : null}
        </form>
      )}
    </div>
  );
}

/**
 * The Paid / Unpaid badge, plus cash or check on each real bill. Renters see the badge only.
 * A rental already marked paid with no cash or check choice keeps a way to clear that rental mark.
 */
export function PaymentControl(props: { log: FlightLogView; admin: boolean; returnTo: string; showWho?: boolean }) {
  const log = props.log;
  const state = paymentState(log);
  const who =
    props.showWho && state === "paid" && log.paidAt
      ? `Marked paid ${formatDateTime(log.paidAt)}${log.paidByName ? ` by ${log.paidByName}` : ""}`
      : null;
  const bills = props.admin ? payableBills(log) : [];
  const legacyPaid = state === "paid" && !log.aircraftPaymentMethod && !log.instructorPaymentMethod;
  return (
    <span class="pay-control">
      <PaidBadge log={log} />
      {bills.length ? (
        <span class="pay-bills">
          {bills.map((bill) => <MarkBillPaid log={log} bill={bill} returnTo={props.returnTo} />)}
        </span>
      ) : null}
      {props.admin && legacyPaid ? (
        <form method="post" action={`/logs/${log.id}/paid`} class="pay-form">
          <input type="hidden" name="paid" value="0" />
          <input type="hidden" name="next" value={props.returnTo} />
          <button class="pay-toggle to-unpaid" type="submit" aria-label={`Mark unpaid: ${log.pilotName}, ${log.tailNumber}, ${formatDateTime(log.createdAt)}`}>
            Mark unpaid
          </button>
        </form>
      ) : null}
      {who ? <small class="muted pay-who">{who}</small> : null}
    </span>
  );
}
