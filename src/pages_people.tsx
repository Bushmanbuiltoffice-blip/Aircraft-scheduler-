/** @jsxImportSource hono/jsx */
import { certificateLabel, centsToDollarInput, formatHours, formatMoney, medicalLabel, roleLabel } from "./format";
import { formatDate, formatDateTime } from "./time";
import type { Aircraft, Checkout, FlightLogView, Role, ScheduleEntry, User } from "./types";
import { Errors, Layout, PageHead, RolePill, type Viewer } from "./ui";
import { LogTable as Logs } from "./pages_dash";

export type PersonFormValues = {
  name: string;
  email: string;
  role: Role | string;
  phone: string;
  certificateType: string;
  certificateNumber: string;
  medicalClass: string;
  medicalExpiration: string;
  instructorRate: string;
  password: string;
};

const CERTIFICATES = ["student", "sport", "recreational", "private", "commercial", "atp", "none"];
const MEDICALS = ["first", "second", "third", "basicmed", "none"];

export function PeoplePage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  people: Array<User & { medicalState: string; checkoutCount: number }>;
}) {
  return (
    <Layout title="People" user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title="People" lede="Pilots, students, instructors, and admins. Medical dates and aircraft checkouts live here.">
        {props.viewer.role === "admin" ? <a class="btn" href="/pilots/new">Add person</a> : null}
      </PageHead>
      <div class="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Certificate</th>
              <th>Medical</th>
              <th>Checkouts</th>
              {props.viewer.role === "admin" ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {props.people.map((person) => (
              <tr>
                <td><a href={`/pilots/${person.id}`}>{person.name}</a><small class="muted">{person.email || "No email yet"}</small></td>
                <td><RolePill role={person.role} /></td>
                <td>{certificateLabel(person.certificateType)}</td>
                <td>
                  <span class={person.medicalState === "expired" ? "pill grounded" : person.medicalState === "soon" ? "pill out" : "pill available"}>
                    {person.medicalExpiration ? formatDate(person.medicalExpiration) : "Missing"}
                  </span>
                </td>
                <td>{person.checkoutCount}</td>
                {props.viewer.role === "admin" ? (
                  <td>{person.id === props.viewer.id ? null : <a href={`/pilots/${person.id}/delete`}>Delete</a>}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export function PersonFormPage(props: {
  viewer: Viewer;
  path: string;
  notice?: string | null;
  usingDevSecret: boolean;
  mode: "create" | "edit" | "self";
  action: string;
  values: PersonFormValues;
  errors: string[];
  canEditRole: boolean;
  showPassword: boolean;
  passwordHint: string;
  aircraft?: Aircraft[];
  checkouts?: Checkout[];
  checkoutAction?: string;
  canEditCheckouts?: boolean;
  upcoming?: ScheduleEntry[];
  logs?: FlightLogView[];
  icalUrl?: string | null;
  canDelete?: boolean;
  personId?: string;
}) {
  return (
    <Layout title={props.values.name || "Person"} user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret}>
      <PageHead title={props.mode === "create" ? "Add person" : props.values.name} lede={props.mode === "self" ? "Certificate, medical, and your calendar link." : roleLabel((props.values.role || "renter") as Role)}>
        {props.mode !== "self" ? <a class="btn secondary" href="/pilots">All people</a> : null}
      </PageHead>
      <form method="post" action={props.action} class="card card-pad stack">
        <Errors errors={props.errors} />
        <div class="fields">
          <label>
            Name
            <input name="name" required value={props.values.name} />
          </label>
          <label>
            Email
            <input type="email" name="email" value={props.values.email} placeholder="Leave blank if they have no email yet" />
          </label>
          <label>
            Phone
            <input name="phone" value={props.values.phone} autocomplete="tel" />
          </label>
          {props.canEditRole ? (
            <label>
              Role
              <select name="role">
                <option value="renter" selected={props.values.role === "renter"}>Pilot</option>
                <option value="student" selected={props.values.role === "student"}>Student</option>
                <option value="instructor" selected={props.values.role === "instructor"}>Instructor</option>
                <option value="admin" selected={props.values.role === "admin"}>Admin</option>
              </select>
            </label>
          ) : (
            <input type="hidden" name="role" value={props.values.role} />
          )}
          <label>
            Certificate
            <select name="certificate_type">
              {CERTIFICATES.map((item) => (
                <option value={item} selected={props.values.certificateType === item}>{certificateLabel(item)}</option>
              ))}
            </select>
          </label>
          <label>
            Certificate number
            <input name="certificate_number" value={props.values.certificateNumber} />
          </label>
          <label>
            Medical
            <select name="medical_class">
              {MEDICALS.map((item) => (
                <option value={item} selected={props.values.medicalClass === item}>{medicalLabel(item)}</option>
              ))}
            </select>
          </label>
          <label>
            Medical expires
            <input type="date" name="medical_expiration" value={props.values.medicalExpiration} />
          </label>
          {props.values.role === "instructor" || props.canEditRole ? (
            <label>
              Instructor hourly rate
              <input name="instructor_rate" value={props.values.instructorRate} inputmode="decimal" />
              <small>Used when this person is the instructor on a flight. Enter 0 if you do not charge.</small>
            </label>
          ) : null}
          {props.showPassword ? (
            <label class="wide">
              {props.mode === "create" ? "Temporary password" : "New password"}
              <input type="text" name="password" value={props.values.password} autocomplete="off" />
              <small>{props.passwordHint}</small>
            </label>
          ) : null}
        </div>
        <div class="actions">
          <button class="btn" type="submit">Save</button>
          {props.mode === "self" ? <a class="btn secondary" href="/account/password">Change password</a> : null}
          {props.canDelete && props.personId ? <a class="btn danger" href={`/pilots/${props.personId}/delete`}>Delete</a> : null}
        </div>
      </form>
      {props.canEditCheckouts && props.aircraft && props.checkoutAction ? (
        <section class="card card-pad">
          <h2>Aircraft checkouts</h2>
          <p class="muted">Pilots and students can book themselves only in aircraft with a current checkout. Instructors can still schedule a checkout ride; the board will warn them.</p>
          <form method="post" action={props.checkoutAction} class="stack">
            {props.aircraft.map((aircraft) => {
              const checkout = props.checkouts?.find((item) => item.aircraftId === aircraft.id);
              const status = checkout?.status ?? "none";
              return (
                <div class="checkout-row">
                  <span class="tail">{aircraft.tailNumber}</span>
                  <span class="muted">{aircraft.model}</span>
                  <select name={`checkout_status_${aircraft.id}`} aria-label={`${aircraft.tailNumber} checkout`}>
                    <option value="none" selected={status === "none"}>Not checked out</option>
                    <option value="current" selected={status === "current"}>Current</option>
                    <option value="expired" selected={status === "expired"}>Expired</option>
                    <option value="revoked" selected={status === "revoked"}>Revoked</option>
                  </select>
                  <input type="date" name={`checkout_on_${aircraft.id}`} value={checkout?.checkedOutOn ?? ""} aria-label={`${aircraft.tailNumber} checkout date`} />
                  <input type="date" name={`checkout_expires_${aircraft.id}`} value={checkout?.expiresOn ?? ""} aria-label={`${aircraft.tailNumber} checkout expires`} />
                </div>
              );
            })}
            <button class="btn secondary" type="submit">Save checkouts</button>
          </form>
        </section>
      ) : null}
      {props.icalUrl ? (
        <section class="card card-pad">
          <h2>Calendar feed</h2>
          <p class="muted">Subscribe in Apple Calendar, Google Calendar, or any app that accepts an iCal link. Anyone with the link can see this schedule.</p>
          <p><a href={props.icalUrl}>{props.icalUrl}</a></p>
          <form method="post" action="/account/ical">
            <button class="btn secondary" type="submit">Replace calendar link</button>
          </form>
        </section>
      ) : null}
      {props.upcoming && props.upcoming.length > 0 ? (
        <section class="card card-pad">
          <h2>Reservations</h2>
          <ul class="plain">
            {props.upcoming.map((item) => (
              <li>
                <a href={`/reservations/${item.id}`}>
                  {formatDateTime(item.startsAt)} · <span class="tail">{item.tailNumber}</span> · {item.pilotName}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.logs ? (
        <section class="card">
          <header class="section-head pad"><h2>Billing</h2></header>
          <Logs logs={props.logs} />
          <p class="pad muted">
            {billingSummary(props.logs)}
          </p>
        </section>
      ) : null}
    </Layout>
  );
}

export function RemovedPersonPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  person: User;
  logs: FlightLogView[];
}) {
  return (
    <Layout title={props.person.name} user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead title={props.person.name} lede="Removed from the active roster.">
        <RolePill role={props.person.role} />
        <a class="btn secondary" href="/pilots">All people</a>
      </PageHead>
      <section class="card card-pad stack">
        <p>This person was removed{props.person.deletedAt ? ` on ${formatDateTime(props.person.deletedAt)}` : ""}.</p>
        <p>Deleting a person never deletes or alters their flight logs. Past flight logs keep showing their name.</p>
      </section>
      {props.logs.length > 0 ? (
        <section class="card">
          <header class="section-head pad"><h2>Flight logs</h2></header>
          <Logs logs={props.logs} />
        </section>
      ) : null}
    </Layout>
  );
}

export function DeletePersonPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  person: User;
  blockedSelf: boolean;
  blockedLastAdmin: boolean;
  mode: "hard" | "soft";
  flightLogCount: number;
  reservationCount: number;
  futureReservationCount: number;
  juanWarning: boolean;
}) {
  const future = props.futureReservationCount;
  return (
    <Layout title={`Remove ${props.person.name}`} user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead title={`Remove ${props.person.name}?`} lede={roleLabel(props.person.role)}>
        <a class="btn secondary" href={`/pilots/${props.person.id}`}>Back</a>
      </PageHead>
      <section class="card card-pad stack">
        <p>Deleting a person never deletes or alters their flight logs. Past flight logs keep showing their name.</p>
        {props.juanWarning ? <p class="alert warn" role="status">Juan Valdivia is an instructor. You can remove him. His past flight logs stay on the books with his name.</p> : null}
        {props.blockedSelf ? <p class="alert" role="alert">You cannot remove your own account.</p> : null}
        {props.blockedLastAdmin ? <p class="alert" role="alert">This is the last admin. Add another admin before removing this account.</p> : null}
        {props.blockedSelf || props.blockedLastAdmin ? null : props.mode === "hard" ? (
          <p>This person has no flight logs and no reservations, so the account will be removed completely. There are no flight logs to change.</p>
        ) : (
          <>
            <p>
              This person has {countPhrase(props.flightLogCount, "flight log", "flight logs")} and {countPhrase(props.reservationCount, "reservation", "reservations")}.
              They will be hidden from People, pilot lists, and billing. The flight log rows stay as they are, including the name.
            </p>
            <p>
              {future === 0
                ? "No future reservations will be cancelled."
                : `${countPhrase(future, "future reservation", "future reservations")} will be cancelled.`}
              {props.reservationCount > future ? " Reservations that have already started are left as they are." : ""}
            </p>
          </>
        )}
        {props.blockedSelf || props.blockedLastAdmin ? null : (
          <form method="post" action={`/pilots/${props.person.id}/delete`}>
            <div class="actions">
              <button class="btn danger" type="submit">Remove this person</button>
              <a class="btn secondary" href="/pilots">Cancel</a>
            </div>
          </form>
        )}
      </section>
    </Layout>
  );
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function AccountPassword(props: { viewer: Viewer; path: string; usingDevSecret: boolean; error?: string | null }) {
  return (
    <Layout title="Password" user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret}>
      <PageHead title="Change password" />
      <form method="post" action="/account/password" class="card card-pad stack narrow-form">
        {props.error ? <p class="alert" role="alert">{props.error}</p> : null}
        <label>
          Current password
          <input type="password" name="current" autocomplete="current-password" required />
        </label>
        <label>
          New password
          <input type="password" name="password" autocomplete="new-password" required />
        </label>
        <label>
          Confirm
          <input type="password" name="confirm" autocomplete="new-password" required />
        </label>
        <button class="btn" type="submit">Update password</button>
      </form>
    </Layout>
  );
}

function billingSummary(logs: FlightLogView[]): string {
  const inApp = logs.filter((log) => log.billingStatus !== "external");
  const outside = logs.length - inApp.length;
  const cents = inApp.reduce((sum, log) => sum + log.totalCostCents, 0);
  const hours = logs.reduce((sum, log) => sum + log.flightHours, 0);
  const billed = `${inApp.length} billed in this app · ${formatHours(hours)} Hobbs hours on the log · ${formatMoney(cents)} on the balance`;
  if (outside === 0) return billed;
  const noun = outside === 1 ? "flight stays" : "flights stay";
  return `${billed}. ${outside} historical ${noun} on this list as already paid outside the app.`;
}

export function personToForm(user: User): PersonFormValues {
  return {
    name: user.name,
    email: user.email ?? "",
    role: user.role,
    phone: user.phone ?? "",
    certificateType: user.certificateType ?? "none",
    certificateNumber: user.certificateNumber ?? "",
    medicalClass: user.medicalClass ?? "none",
    medicalExpiration: user.medicalExpiration ?? "",
    instructorRate: user.instructorRateCents == null ? "" : centsToDollarInput(user.instructorRateCents),
    password: "",
  };
}
