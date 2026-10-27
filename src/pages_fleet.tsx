/** @jsxImportSource hono/jsx */
import { centsToDollarInput, formatMeter, formatMoney, statusLabel } from "./format";
import { formatDateTime } from "./time";
import type { Aircraft, AircraftStatus, MaintenanceBlock, RateBasis, ScheduleEntry } from "./types";
import { Errors, Layout, PageHead, type Viewer } from "./ui";

export type AircraftFormValues = {
  tailNumber: string;
  make: string;
  model: string;
  year: string;
  wet: string;
  dry: string;
  defaultRate: RateBasis | string;
  status: AircraftStatus | string;
  hobbs: string;
  tach: string;
  notes: string;
};

export function AircraftListPage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  aircraft: Aircraft[];
}) {
  return (
    <Layout title="Aircraft" user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title="Fleet" lede="Wet and dry rates, status, and the meters used at check-in.">
        {props.viewer.role === "admin" ? <a class="btn" href="/aircraft/new">Add aircraft</a> : null}
      </PageHead>
      <div class="cards">
        {props.aircraft.map((item) => (
          <a class="card card-pad fleet-card" href={`/aircraft/${item.id}`}>
            <div class="section-head">
              <strong class="tail">{item.tailNumber}</strong>
              <span class={`pill ${item.status}`}>{statusLabel(item.status)}</span>
            </div>
            <p>{item.year ? `${item.year} ` : ""}{item.make} {item.model}</p>
            <p>{formatMoney(item.hourlyWetCents)} wet · {formatMoney(item.hourlyDryCents)} dry</p>
            <p class="muted">Hobbs {formatMeter(item.hobbs)} · Tach {formatMeter(item.tach)}</p>
          </a>
        ))}
      </div>
      {props.aircraft.length === 0 ? <p class="card card-pad">No aircraft yet.</p> : null}
    </Layout>
  );
}

export function AircraftFormPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  mode: "create" | "edit";
  action: string;
  values: AircraftFormValues;
  errors: string[];
  blocks?: MaintenanceBlock[];
  upcoming?: ScheduleEntry[];
  groundedNow?: boolean;
}) {
  return (
    <Layout title={props.values.tailNumber || "Aircraft"} user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead
        title={props.mode === "create" ? "Add aircraft" : props.values.tailNumber}
        lede={props.mode === "edit" ? "Rates are what check-in will bill." : "Tail number, rates, and starting meters."}
      >
        {props.mode === "edit" ? <a class="btn secondary" href="/aircraft">All aircraft</a> : null}
      </PageHead>
      {props.viewer.role === "admin" ? (
        <form method="post" action={props.action} class="card card-pad stack">
          <Errors errors={props.errors} />
          <AircraftFields values={props.values} />
          <button class="btn" type="submit">{props.mode === "create" ? "Add aircraft" : "Save aircraft"}</button>
        </form>
      ) : (
        <section class="card card-pad">
          <p><span class={`pill ${props.values.status}`}>{statusLabel(props.values.status as AircraftStatus)}</span></p>
          <p>{props.values.year} {props.values.make} {props.values.model}</p>
          <p>{props.values.wet} wet · {props.values.dry} dry · default {props.values.defaultRate}</p>
          <p class="muted">Hobbs {props.values.hobbs || "—"} · Tach {props.values.tach || "—"}</p>
          {props.values.notes ? <p>{props.values.notes}</p> : null}
        </section>
      )}
      {props.mode === "edit" && props.viewer.role === "admin" ? (
        <section class="card card-pad">
          <h2>Down for maintenance</h2>
          <p class="muted">Any reservation that overlaps this window is rejected, even if the airplane is otherwise available.</p>
          <form method="post" action={`${props.action}/maintenance`} class="fields">
            <label>
              Starts (Pacific)
              <input type="datetime-local" name="starts_at" required />
            </label>
            <label>
              Ends (Pacific)
              <input type="datetime-local" name="ends_at" required />
            </label>
            <label class="wide">
              Reason
              <input name="reason" required maxlength={300} placeholder="Annual inspection" />
            </label>
            <label class="check wide">
              <input type="checkbox" name="ground_now" value="yes" checked />
              Also mark the aircraft grounded now
            </label>
            <div class="actions wide">
              <button class="btn amber" type="submit">Save maintenance block</button>
            </div>
          </form>
          {props.groundedNow ? (
            <form method="post" action={`${props.action}/return`} class="actions">
              <button class="btn secondary" type="submit">Return to service</button>
            </form>
          ) : null}
          <ul class="plain">
            {(props.blocks ?? []).map((block) => (
              <li>
                <span>{formatDateTime(block.startsAt)} – {formatDateTime(block.endsAt)} · {block.reason}</span>
                <form method="post" action={`/maintenance/${block.id}/delete`}>
                  <button class="text-btn" type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.upcoming && props.upcoming.length > 0 ? (
        <section class="card card-pad">
          <h2>On the board</h2>
          <ul class="plain">
            {props.upcoming.map((item) => (
              <li>
                <a href={`/reservations/${item.id}`}>
                  {formatDateTime(item.startsAt)} · {item.pilotName} · {statusLabel(item.status)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Layout>
  );
}

function AircraftFields(props: { values: AircraftFormValues }) {
  const values = props.values;
  return (
    <div class="fields">
      <label>
        Tail number
        <input name="tail_number" required value={values.tailNumber} class="mono" />
      </label>
      <label>
        Status
        <select name="status">
          <option value="available" selected={values.status === "available"}>Available</option>
          <option value="grounded" selected={values.status === "grounded"}>Grounded</option>
        </select>
      </label>
      <label>
        Make
        <input name="make" required value={values.make} />
      </label>
      <label>
        Model
        <input name="model" required value={values.model} />
      </label>
      <label>
        Year
        <input name="year" value={values.year} inputmode="numeric" />
      </label>
      <label>
        Default rate
        <select name="default_rate">
          <option value="wet" selected={values.defaultRate === "wet"}>Wet</option>
          <option value="dry" selected={values.defaultRate === "dry"}>Dry</option>
        </select>
      </label>
      <label>
        Wet hourly rate
        <input name="wet" required value={values.wet} inputmode="decimal" />
      </label>
      <label>
        Dry hourly rate
        <input name="dry" required value={values.dry} inputmode="decimal" />
      </label>
      <label>
        Current Hobbs
        <input name="hobbs" value={values.hobbs} inputmode="decimal" />
      </label>
      <label>
        Current tach
        <input name="tach" value={values.tach} inputmode="decimal" />
      </label>
      <label class="wide">
        Notes
        <textarea name="notes" maxlength={2000}>{values.notes}</textarea>
      </label>
    </div>
  );
}

export function aircraftToForm(aircraft: Aircraft): AircraftFormValues {
  return {
    tailNumber: aircraft.tailNumber,
    make: aircraft.make,
    model: aircraft.model,
    year: aircraft.year ? String(aircraft.year) : "",
    wet: centsToDollarInput(aircraft.hourlyWetCents),
    dry: centsToDollarInput(aircraft.hourlyDryCents),
    defaultRate: aircraft.defaultRate,
    status: aircraft.status,
    hobbs: aircraft.hobbs == null ? "" : formatMeter(aircraft.hobbs),
    tach: aircraft.tach == null ? "" : formatMeter(aircraft.tach),
    notes: aircraft.notes ?? "",
  };
}
