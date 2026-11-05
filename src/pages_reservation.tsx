/** @jsxImportSource hono/jsx */
import { soloInsuranceMissingMessage } from "./copy";
import { canMarkPaid } from "./payment";
import { formatFuel, formatMeter, formatOil, rateLabel, statusLabel } from "./format";
import { classifyExpiration, insuranceFlagMessage, type ExpirationSource } from "./policy_expiration";
import { todayInZone } from "./time";
import { formatDateTime, toDateTimeLocalValue } from "./time";
import type { FlightLogView, ScheduleEntry } from "./types";
import { FlightChargeCard, HistoricalDetails } from "./pages_logs";
import { Layout, PageHead, RolePill, Warnings, type Viewer } from "./ui";

export function ReservationPage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  entry: ScheduleEntry;
  canManage: boolean;
  warnings: string[];
  log: FlightLogView | null;
  hobbsSuggestion: string;
  tachSuggestion: string;
  aircraftRateCents: number | null;
  instructorRateCents: number | null;
  actionError?: string | null;
  aircraftHobbs?: number | null;
  aircraftTach?: number | null;
  /** Set only for a solo flight that is still scheduled. Dual flights leave this null. */
  soloInsurance?: { onFile: boolean; uploadHref: string | null; pilotName: string } | null;
  /** Set when an insurance PDF is on file, for solo and dual. A missing PDF leaves this null. */
  insuranceFlag?: { pilotName: string; date: string | null; source: ExpirationSource | null } | null;
}) {
  const entry = props.entry;
  const estimateRate = props.instructorRateCents ?? 0;
  const insuranceBlock = props.soloInsurance && !props.soloInsurance.onFile ? props.soloInsurance : null;
  return (
    <Layout title={entry.tailNumber} user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title={`${entry.tailNumber} reservation`} lede={`${entry.make} ${entry.model}`}>
        <a class="btn secondary" href="/schedule">Back to schedule</a>
      </PageHead>
      <Warnings warnings={props.warnings} />
      {props.actionError ? <p class="alert" role="alert">{props.actionError}</p> : null}
      <section class="card card-pad detail-grid">
        <div>
          <p class={`pill ${entry.status}`}>{statusLabel(entry.status)}</p>
          <h2>{formatDateTime(entry.startsAt)} – {formatDateTime(entry.endsAt)}</h2>
          <dl>
            <div><dt>Pilot</dt><dd><a href={`/pilots/${entry.pilotId}`}>{entry.pilotName}</a>{entry.pilotRole === "student" ? <> <RolePill role="student" /></> : null}</dd></div>
            <div><dt>Instructor</dt><dd>{entry.instructorId ? <a href={`/pilots/${entry.instructorId}`}>{entry.instructorName}</a> : (entry.instructorName ?? "Solo")}</dd></div>
            <div><dt>Rate basis</dt><dd>{rateLabel(entry.rateBasis)}</dd></div>
            <div><dt>Aircraft</dt><dd><a class="tail" href={`/aircraft/${entry.aircraftId}`}>{entry.tailNumber}</a></dd></div>
            <div><dt>Hobbs out / in</dt><dd>{formatMeter(entry.hobbsOut)} / {formatMeter(entry.hobbsIn)}</dd></div>
            <div><dt>Tach out / in (maintenance, not billed)</dt><dd>{formatMeter(entry.tachOut)} / {formatMeter(entry.tachIn)}</dd></div>
            {props.log ? <div><dt>Oil added</dt><dd>{formatOil(props.log.oilAddedQt)}</dd></div> : null}
            {props.log ? <div><dt>Fuel added</dt><dd>{formatFuel(props.log.fuelAddedGal)}</dd></div> : null}
            {props.log?.imported ? <HistoricalDetails log={props.log} /> : null}
          </dl>
          {entry.notes ? <p class="notes">{entry.notes}</p> : null}
        </div>
        {props.log ? (
          <div>
            <FlightChargeCard log={props.log} admin={canMarkPaid(props.viewer.role)} returnTo={`/reservations/${entry.id}`} />
            <p><a href={`/logs/${props.log.id}`}>Open the log</a></p>
          </div>
        ) : (
          <aside class="cost-card">
            <h2>Billing</h2>
            <p>Nothing is billed until check-in. Aircraft time and instructor time both use the Hobbs difference.</p>
          </aside>
        )}
      </section>
      {props.insuranceFlag ? <InsuranceFlagNotice flag={props.insuranceFlag} /> : null}
      {props.canManage && entry.status === "scheduled" && insuranceBlock ? (
        <section class="card card-pad" id="solo-insurance">
          <h2>Insurance PDF needed</h2>
          {props.actionError ? null : (
            <p class="alert" role="alert">{soloInsuranceMissingMessage(insuranceBlock.pilotName)}</p>
          )}
          {insuranceBlock.uploadHref ? (
            <p><a class="btn" href={insuranceBlock.uploadHref}>Upload insurance PDF</a></p>
          ) : (
            <p>Ask {insuranceBlock.pilotName} to upload their insurance PDF from Account.</p>
          )}
        </section>
      ) : null}
      {props.canManage && entry.status === "scheduled" && !insuranceBlock ? (
        <section class="card card-pad">
          <h2>Check out</h2>
          {props.soloInsurance?.onFile ? <p class="muted">Insurance PDF is on file.</p> : null}
          <p class="muted">
            Read both meters on the airplane before every flight. The boxes start with the last recorded readings
            {props.aircraftHobbs != null || props.aircraftTach != null
              ? ` (Hobbs ${formatMeter(props.aircraftHobbs ?? null)} · Tach ${formatMeter(props.aircraftTach ?? null)})`
              : ""}
            . Change them if the airplane shows something different.
          </p>
          <form method="post" action={`/reservations/${entry.id}/checkout`} class="fields meter-form">
            <label>
              Hobbs out (required, billed)
              <input name="hobbs_out" inputmode="decimal" pattern="\d{1,6}(\.\d)?" required value={props.hobbsSuggestion} aria-describedby="meter-format" />
            </label>
            <label>
              Tach out (required, maintenance only, not billed)
              <input name="tach_out" inputmode="decimal" pattern="\d{1,6}(\.\d)?" required value={props.tachSuggestion} aria-describedby="meter-format" />
            </label>
            <small id="meter-format" class="wide muted">Hours with one decimal, like 318.6. Charges use Hobbs only. Tach is for maintenance tracking (TBX) and is not billed.</small>
            <label class="wide check-confirm">
              <input type="checkbox" name="meters_confirmed" value="yes" required />
              I read Hobbs and tach on the airplane's meters.
            </label>
            <div class="actions wide">
              <button class="btn amber" type="submit">Check out</button>
            </div>
          </form>
        </section>
      ) : null}
      {props.canManage && entry.status === "checked_out" ? (
        <section class="card card-pad">
          <h2>Check in</h2>
          <form
            id="checkin-form"
            method="post"
            action={`/reservations/${entry.id}/checkin`}
            class="fields"
            data-hobbs-out={String(entry.hobbsOut ?? "")}
            data-aircraft-rate={props.aircraftRateCents == null ? "" : String(props.aircraftRateCents)}
            data-instructor-rate={entry.instructorId ? String(estimateRate) : "0"}
          >
            <p class="wide muted">Hobbs out {formatMeter(entry.hobbsOut)} · Tach out {formatMeter(entry.tachOut)}</p>
            <label>
              Hobbs in (required, billed)
              <input name="hobbs_in" inputmode="decimal" pattern="\d{1,6}(\.\d)?" required placeholder={`more than ${formatMeter(entry.hobbsOut)}`} />
            </label>
            <label>
              Tach in (required, maintenance only, not billed)
              <input name="tach_in" inputmode="decimal" pattern="\d{1,6}(\.\d)?" required placeholder={`at least ${formatMeter(entry.tachOut)}`} />
            </label>
            <small class="wide muted">Read both meters after shutdown. Hours with one decimal. Charges use Hobbs only. Tach is for maintenance tracking (TBX) and never changes the bill.</small>
            <label>
              Oil added (quarts)
              <input name="oil_added_qt" inputmode="decimal" pattern="\d{1,2}(\.\d{1,2})?" placeholder="Blank if not recorded" aria-describedby="oil-hint" />
            </label>
            <label>
              Fuel added (gallons)
              <input name="fuel_added_gal" inputmode="decimal" pattern="\d{1,4}(\.\d{1,2})?" placeholder="Blank if not recorded" aria-describedby="fuel-hint" />
            </label>
            <small id="oil-hint" class="wide muted">Optional. Use 0 if none was added. Leave blank if it was not recorded. Oil and fuel do not change the Hobbs bill.</small>
            <small id="fuel-hint" class="wide muted">Fuel is US gallons. Use 0 if none was added. Leave blank if it was not recorded.</small>
            <p id="checkin-estimate" class="wide estimate">Enter Hobbs in to preview the cost.</p>
            <div class="actions wide">
              <button class="btn" type="submit">Check in and bill</button>
            </div>
          </form>
          <script src="/checkin.js" defer></script>
        </section>
      ) : null}
      {props.canManage && entry.status === "scheduled" ? (
        <p class="actions">
          <a class="btn secondary" href={`/reservations/${entry.id}/edit`}>Edit times or aircraft</a>
        </p>
      ) : null}
      {props.canManage && (entry.status === "scheduled" || (entry.status === "checked_out" && props.viewer.role === "admin")) ? (
        <section class="card card-pad">
          <h2>Cancel</h2>
          <form method="post" action={`/reservations/${entry.id}/cancel`} class="stack">
            <label>
              Note
              <input name="reason" maxlength={500} placeholder="Optional" />
            </label>
            <button class="btn danger" type="submit">Cancel reservation</button>
          </form>
        </section>
      ) : null}
    </Layout>
  );
}

function InsuranceFlagNotice(props: { flag: { pilotName: string; date: string | null; source: ExpirationSource | null } }) {
  const today = todayInZone();
  const { flag } = classifyExpiration(props.flag.date, today);
  const tone = flag === "expired" ? "alert" : flag === "current" ? "muted" : "alert warn";
  return (
    <p class={tone} id="insurance-expiration" role={flag === "current" ? "status" : "alert"}>
      {insuranceFlagMessage({ ...props.flag, today })}
    </p>
  );
}

export function toLocal(iso: string): string {
  return toDateTimeLocalValue(iso);
}
