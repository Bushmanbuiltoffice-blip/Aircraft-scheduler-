/** @jsxImportSource hono/jsx */
import { certificateLabel, centsToDollarInput, formatHours, formatMoney, medicalLabel, roleLabel } from "./format";
import { formatDate, formatDateTime } from "./time";
import type { Aircraft, Checkout, FlightLogView, Role, ScheduleEntry, User } from "./types";
import { Errors, Layout, PageHead, type Viewer } from "./ui";
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
      <PageHead title="People" lede="Pilots, instructors, and admins. Medical dates and aircraft checkouts live here.">
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
            </tr>
          </thead>
          <tbody>
            {props.people.map((person) => (
              <tr>
                <td><a href={`/pilots/${person.id}`}>{person.name}</a><small class="muted">{person.email || "No email yet"}</small></td>
                <td>{roleLabel(person.role)}</td>
                <td>{certificateLabel(person.certificateType)}</td>
                <td>
                  <span class={person.medicalState === "expired" ? "pill grounded" : person.medicalState === "soon" ? "pill out" : "pill available"}>
                    {person.medicalExpiration ? formatDate(person.medicalExpiration) : "Missing"}
                  </span>
                </td>
                <td>{person.checkoutCount}</td>
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
        </div>
      </form>
      {props.canEditCheckouts && props.aircraft && props.checkoutAction ? (
        <section class="card card-pad">
          <h2>Aircraft checkouts</h2>
          <p class="muted">Pilots can book themselves only in aircraft with a current checkout. Instructors can still schedule a checkout ride; the board will warn them.</p>
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
            {props.logs.length} flights · {formatHours(props.logs.reduce((sum, log) => sum + log.flightHours, 0))} hours ·{" "}
            {formatMoney(props.logs.reduce((sum, log) => sum + log.totalCostCents, 0))}
          </p>
        </section>
      ) : null}
    </Layout>
  );
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
