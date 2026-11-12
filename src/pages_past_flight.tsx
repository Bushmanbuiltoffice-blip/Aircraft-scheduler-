/** @jsxImportSource hono/jsx */
import { OUTSIDE_BILLING_NOTE, type PastFlightForm } from "./past_flight";
import { formatMoney, roleLabel } from "./format";
import type { Aircraft, User } from "./types";
import { Errors, Layout, PageHead, type Viewer } from "./ui";

export function PastFlightPage(props: {
  viewer: Viewer;
  usingDevSecret: boolean;
  aircraft: Aircraft[];
  pilots: User[];
  instructors: User[];
  values: PastFlightForm;
  errors?: string[];
}) {
  const selectedAircraft = props.aircraft.find((item) => item.id === props.values.aircraftId);
  return (
    <Layout title="Add past flight" user={props.viewer} path="/logs" usingDevSecret={props.usingDevSecret}>
      <PageHead
        title="Add past flight"
        lede="Record a flight that already happened. This does not book a reservation, and it does not check medical, insurance, the rental agreement, or a checkout."
      />
      <Errors errors={props.errors} />
      <form id="past-flight-form" method="post" action="/logs/new" class="card card-pad stack">
        <div class="fields">
          <label>
            Date
            <input type="date" name="flight_date" required value={props.values.flightDate} />
            <small>Today or earlier. A future date is rejected.</small>
          </label>
          <label>
            Aircraft
            <select name="aircraft_id" required>
              <option value="">Select aircraft</option>
              {props.aircraft.map((item) => (
                <option value={item.id} selected={item.id === props.values.aircraftId}>
                  {item.tailNumber} · {item.make} {item.model} · wet {formatMoney(item.hourlyWetCents)}/hr
                </option>
              ))}
            </select>
          </label>
          <label>
            Pilot
            <select name="pilot_id" required>
              <option value="">Select pilot</option>
              {props.pilots.map((pilot) => (
                <option value={pilot.id} selected={pilot.id === props.values.pilotId}>
                  {pilot.name} · {roleLabel(pilot.role)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Instructor
            <select name="instructor_id">
              <option value="" selected={props.values.instructorId === ""}>Solo / no instructor</option>
              {props.instructors.map((instructor) => (
                <option value={instructor.id} selected={instructor.id === props.values.instructorId}>
                  {instructor.name} · {formatMoney(instructor.instructorRateCents ?? 0)}/hr
                </option>
              ))}
            </select>
            <small>Optional. An admin who has an instructor rate is on this list.</small>
          </label>
          <label>
            Hobbs out
            <input name="hobbs_out" inputmode="decimal" required value={props.values.hobbsOut} />
          </label>
          <label>
            Hobbs in
            <input name="hobbs_in" inputmode="decimal" required value={props.values.hobbsIn} />
            <small>Hobbs in can equal Hobbs out. It cannot be lower. Hobbs is the only billed time.</small>
          </label>
          <label>
            Tach out
            <input name="tach_out" inputmode="decimal" required value={props.values.tachOut} />
          </label>
          <label>
            Tach in
            <input name="tach_in" inputmode="decimal" required value={props.values.tachIn} />
            <small>Tach is a maintenance reading. It is not used to calculate a charge and is not sent to TBX.</small>
          </label>
          <label>
            Ground instruction hours
            <input name="ground_hours" inputmode="decimal" value={props.values.groundHours} placeholder="Blank if none" />
            <small>Optional. Only when an instructor is chosen. Ground is a line on the instructor bill.</small>
          </label>
          <label>
            Fuel added (gallons)
            <input name="fuel_added_gal" inputmode="decimal" value={props.values.fuelAddedGal} placeholder="Blank if not recorded" />
          </label>
          <label>
            Oil added (quarts)
            <input name="oil_added_qt" inputmode="decimal" value={props.values.oilAddedQt} placeholder="Blank if not recorded" />
          </label>
          <label class="wide">
            Notes / route
            <textarea name="notes" maxlength={2000}>{props.values.notes}</textarea>
          </label>
        </div>
        <fieldset>
          <legend>How should this flight be billed?</legend>
          <label>
            <input type="radio" name="billing" value="in_app" required checked={props.values.billing === "in_app"} />
            Create bills in the app
          </label>
          <p class="muted">
            Aircraft time is wet Hobbs
            {selectedAircraft ? ` at ${formatMoney(selectedAircraft.hourlyWetCents)}/hr` : " at the airplane's saved wet rate"}.
            An instructor bill uses that person's rate and includes ground. Mark paid afterward with cash or check.
          </p>
          <label>
            <input type="radio" name="billing" value="external" required checked={props.values.billing === "external"} />
            Record only, already settled outside the app
          </label>
          <p class="muted">{OUTSIDE_BILLING_NOTE} The flight shows Paid outside app and is not on a balance.</p>
        </fieldset>
        <div class="actions">
          <button class="btn" type="submit">Save past flight</button>
          <a class="btn secondary" href="/logs">Cancel</a>
        </div>
      </form>
    </Layout>
  );
}
