/** @jsxImportSource hono/jsx */
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

/**
 * The Paid / Unpaid badge, plus a one-tap toggle for admins and instructors. The form posts the value it will
 * set, so a double tap cannot flip it back by accident.
 */
export function PaymentControl(props: { log: FlightLogView; admin: boolean; returnTo: string; showWho?: boolean }) {
  const log = props.log;
  const state = paymentState(log);
  const who =
    props.showWho && state === "paid" && log.paidAt
      ? `Marked paid ${formatDateTime(log.paidAt)}${log.paidByName ? ` by ${log.paidByName}` : ""}`
      : null;
  return (
    <span class="pay-control">
      <PaidBadge log={log} />
      {props.admin && state !== "outside" ? (
        <form method="post" action={`/logs/${log.id}/paid`} class="pay-form">
          <input type="hidden" name="paid" value={state === "paid" ? "0" : "1"} />
          <input type="hidden" name="next" value={props.returnTo} />
          <button
            class={`pay-toggle ${state === "paid" ? "to-unpaid" : "to-paid"}`}
            type="submit"
            aria-label={`${state === "paid" ? "Mark unpaid" : "Mark paid"}: ${log.pilotName}, ${log.tailNumber}, ${formatDateTime(log.createdAt)}`}
          >
            {state === "paid" ? "Mark unpaid" : "Mark paid"}
          </button>
        </form>
      ) : null}
      {who ? <small class="muted pay-who">{who}</small> : null}
    </span>
  );
}
