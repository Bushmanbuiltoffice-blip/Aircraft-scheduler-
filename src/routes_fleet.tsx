/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import { emailError, hashPassword, newToken, normalizeEmail, passwordError, verifyPassword } from "./auth";
import { pageNotice } from "./copy";
import {
  countAdmins,
  deleteCheckout,
  deleteMaintenance,
  getAircraft,
  getMaintenance,
  getUserById,
  insertAircraft,
  insertMaintenance,
  insertUser,
  isUniqueError,
  listAircraft,
  listCheckoutsForUser,
  listFlightLogs,
  listMaintenanceForAircraft,
  listReservationsForUser,
  listReservationsOverlapping,
  listUsers,
  setAircraftStatus,
  updateAircraft,
  updateUser,
  upsertCheckout,
} from "./db";
import { blankToNull, checked, field, isUuid, readForm, viewerOf } from "./http";
import { parseDollarsToCents, parseMeter } from "./format";
import { AccountPassword, PeoplePage, PersonFormPage, personToForm, type PersonFormValues } from "./pages_people";
import { AircraftFormPage, AircraftListPage, aircraftToForm, type AircraftFormValues } from "./pages_fleet";
import { document, SimpleMessage } from "./ui";
import { addDays, parseDay, parseLocalDateTime, todayInZone, zonedTimeToUtc } from "./time";
import type { Aircraft, AircraftStatus, AppEnv, CertificateType, CheckoutStatus, MedicalClass, RateBasis, Role, User } from "./types";

const ROLES = new Set<Role>(["admin", "instructor", "renter"]);
const CERTS = new Set<CertificateType>(["student", "sport", "recreational", "private", "commercial", "atp", "none"]);
const MEDICALS = new Set<MedicalClass>(["first", "second", "third", "basicmed", "none"]);

export function registerFleet(app: Hono<AppEnv>): void {
  app.get("/aircraft", async (c) => {
    const user = mustUser(c);
    const aircraft = await listAircraft(c.env.DB);
    return c.html(
      document(
        <AircraftListPage
          viewer={viewerOf(user)}
          path="/aircraft"
          notice={pageNotice(c.req.query("notice"))}
          usingDevSecret={c.get("usingDevSecret")}
          aircraft={aircraft}
        />,
      ),
    );
  });

  app.get("/aircraft/new", (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    return c.html(
      document(
        <AircraftFormPage
          viewer={viewerOf(user)}
          path="/aircraft/new"
          usingDevSecret={c.get("usingDevSecret")}
          mode="create"
          action="/aircraft"
          values={emptyAircraft()}
          errors={[]}
        />,
      ),
    );
  });

  app.post("/aircraft", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const parsed = parseAircraft(await readForm(c));
    if (parsed.errors.length || !parsed.aircraft) {
      return c.html(
        document(
          <AircraftFormPage
            viewer={viewerOf(user)}
            path="/aircraft/new"
            usingDevSecret={c.get("usingDevSecret")}
            mode="create"
            action="/aircraft"
            values={parsed.values}
            errors={parsed.errors}
          />,
        ),
        422,
      );
    }
    const aircraft: Aircraft = { ...parsed.aircraft, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    try {
      await insertAircraft(c.env.DB, aircraft);
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return c.html(
        document(
          <AircraftFormPage
            viewer={viewerOf(user)}
            path="/aircraft/new"
            usingDevSecret={c.get("usingDevSecret")}
            mode="create"
            action="/aircraft"
            values={parsed.values}
            errors={["That tail number is already on the fleet."]}
          />,
        ),
        422,
      );
    }
    return c.redirect(`/aircraft/${aircraft.id}?notice=aircraft-saved`, 303);
  });

  app.get("/aircraft/:id", async (c) => renderAircraft(c, c.req.param("id"), [], null));

  app.post("/aircraft/:id", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const existing = await getAircraft(c.env.DB, c.req.param("id"));
    if (!existing) return c.notFound();
    const parsed = parseAircraft(await readForm(c));
    if (parsed.errors.length || !parsed.aircraft) return renderAircraft(c, existing.id, parsed.errors, parsed.values);
    const aircraft = { ...parsed.aircraft, id: existing.id, createdAt: existing.createdAt };
    try {
      await updateAircraft(c.env.DB, aircraft);
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return renderAircraft(c, existing.id, ["That tail number is already on the fleet."], parsed.values);
    }
    return c.redirect(`/aircraft/${existing.id}?notice=aircraft-saved`, 303);
  });

  app.post("/aircraft/:id/maintenance", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const aircraft = await getAircraft(c.env.DB, c.req.param("id"));
    if (!aircraft) return c.notFound();
    const data = await readForm(c);
    const startsLocal = parseLocalDateTime(field(data, "starts_at"));
    const endsLocal = parseLocalDateTime(field(data, "ends_at"));
    const reason = field(data, "reason");
    if (!startsLocal || !endsLocal) return renderAircraft(c, aircraft.id, ["Enter a start and end for the maintenance."], null);
    const startsAt = zonedTimeToUtc(startsLocal).toISOString();
    const endsAt = zonedTimeToUtc(endsLocal).toISOString();
    if (endsAt <= startsAt) return renderAircraft(c, aircraft.id, ["Maintenance has to end after it starts."], null);
    if (reason.length < 2 || reason.length > 300) return renderAircraft(c, aircraft.id, ["Add a short reason for the downtime."], null);
    const now = new Date();
    await insertMaintenance(c.env.DB, {
      id: crypto.randomUUID(),
      aircraftId: aircraft.id,
      startsAt,
      endsAt,
      reason,
      createdBy: user.id,
      createdAt: now.toISOString(),
    });
    if (checked(data, "ground_now") || (startsAt <= now.toISOString() && endsAt > now.toISOString())) {
      await setAircraftStatus(c.env.DB, aircraft.id, "grounded");
    }
    return c.redirect(`/aircraft/${aircraft.id}?notice=maintenance-saved`, 303);
  });

  app.post("/aircraft/:id/return", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const aircraft = await getAircraft(c.env.DB, c.req.param("id"));
    if (!aircraft) return c.notFound();
    await setAircraftStatus(c.env.DB, aircraft.id, "available");
    return c.redirect(`/aircraft/${aircraft.id}?notice=returned`, 303);
  });

  app.post("/maintenance/:id/delete", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const block = await getMaintenance(c.env.DB, c.req.param("id"));
    if (!block) return c.notFound();
    await deleteMaintenance(c.env.DB, block.id);
    return c.redirect(`/aircraft/${block.aircraftId}?notice=maintenance-removed`, 303);
  });

  app.get("/pilots", async (c) => {
    const user = mustUser(c);
    if (user.role === "renter") return c.redirect("/account");
    const today = todayInZone();
    const people = await listUsers(c.env.DB);
    const checkoutCounts = new Map<string, number>();
    await Promise.all(
      people.map(async (person) => {
        const rows = await listCheckoutsForUser(c.env.DB, person.id);
        checkoutCounts.set(person.id, rows.filter((row) => row.status === "current" && (!row.expiresOn || row.expiresOn >= today)).length);
      }),
    );
    return c.html(
      document(
        <PeoplePage
          viewer={viewerOf(user)}
          path="/pilots"
          notice={pageNotice(c.req.query("notice"))}
          usingDevSecret={c.get("usingDevSecret")}
          people={people.map((person) => ({
            ...person,
            medicalState: medicalState(person.medicalExpiration, today),
            checkoutCount: checkoutCounts.get(person.id) ?? 0,
          }))}
        />,
      ),
    );
  });

  app.get("/pilots/new", (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    return personResponse(c, "create", emptyPerson(), [], null);
  });

  app.post("/pilots", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const parsed = await parsePerson(await readForm(c), { mode: "create", actor: user, current: null });
    if (parsed.errors.length || !parsed.draft) return personResponse(c, "create", parsed.values, parsed.errors, null);
    try {
      await insertUser(c.env.DB, parsed.draft);
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return personResponse(c, "create", parsed.values, ["That email is already in use."], null);
    }
    return c.redirect(`/pilots/${parsed.draft.id}?notice=pilot-saved`, 303);
  });


  app.get("/pilots/:id", async (c) => {
    const user = mustUser(c);
    const person = await getUserById(c.env.DB, c.req.param("id"));
    if (!person) return c.notFound();
    if (user.role === "renter" && user.id !== person.id) return forbidden(c);
    if (user.role === "renter") return c.redirect("/account");
    return personResponse(c, "edit", personToForm(person), [], person);
  });

  app.post("/pilots/:id", async (c) => {
    const user = mustUser(c);
    if (user.role !== "admin") return forbidden(c);
    const person = await getUserById(c.env.DB, c.req.param("id"));
    if (!person) return c.notFound();
    const parsed = await parsePerson(await readForm(c), { mode: "edit", actor: user, current: person });
    if (parsed.errors.length || !parsed.draft) return personResponse(c, "edit", parsed.values, parsed.errors, person);
    if (person.role === "admin" && parsed.draft.role !== "admin" && (await countAdmins(c.env.DB, person.id)) === 0) {
      return personResponse(c, "edit", parsed.values, ["Keep at least one admin."], person);
    }
    try {
      await updateUser(c.env.DB, { ...person, ...parsed.draft, id: person.id, createdAt: person.createdAt, icalToken: person.icalToken });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return personResponse(c, "edit", parsed.values, ["That email is already in use."], person);
    }
    return c.redirect(`/pilots/${person.id}?notice=pilot-saved`, 303);
  });

  app.post("/pilots/:id/checkouts", async (c) => {
    const user = mustUser(c);
    if (user.role === "renter") return forbidden(c);
    const person = await getUserById(c.env.DB, c.req.param("id"));
    if (!person) return c.notFound();
    const data = await readForm(c);
    const aircraft = await listAircraft(c.env.DB);
    const today = todayInZone();
    for (const item of aircraft) {
      const status = field(data, `checkout_status_${item.id}`);
      if (status === "none" || status === "") {
        await deleteCheckout(c.env.DB, person.id, item.id);
        continue;
      }
      if (status !== "current" && status !== "expired" && status !== "revoked") continue;
      const checkedOutOn = parseDay(field(data, `checkout_on_${item.id}`)) ?? today;
      const expiresRaw = field(data, `checkout_expires_${item.id}`);
      const expiresOn = expiresRaw ? parseDay(expiresRaw) : null;
      if (expiresRaw && !expiresOn) continue;
      await upsertCheckout(c.env.DB, {
        userId: person.id,
        aircraftId: item.id,
        status: status as CheckoutStatus,
        checkedOutOn,
        expiresOn,
      });
    }
    return c.redirect(`/pilots/${person.id}?notice=pilot-saved`, 303);
  });

  app.get("/account", async (c) => {
    const user = mustUser(c);
    return personResponse(c, "self", personToForm(user), [], user);
  });

  app.post("/account", async (c) => {
    const user = mustUser(c);
    const parsed = await parsePerson(await readForm(c), { mode: "self", actor: user, current: user });
    if (parsed.errors.length || !parsed.draft) return personResponse(c, "self", parsed.values, parsed.errors, user);
    try {
      await updateUser(c.env.DB, {
        ...user,
        ...parsed.draft,
        id: user.id,
        role: user.role,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
        icalToken: user.icalToken,
        instructorRateCents: user.role === "instructor" ? parsed.draft.instructorRateCents : user.instructorRateCents,
      });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      return personResponse(c, "self", parsed.values, ["That email is already in use."], user);
    }
    return c.redirect("/account?notice=account-saved", 303);
  });

  app.get("/account/password", (c) => {
    const user = mustUser(c);
    return c.html(
      document(
        <AccountPassword viewer={viewerOf(user)} path="/account" usingDevSecret={c.get("usingDevSecret")} />,
      ),
    );
  });

  app.post("/account/password", async (c) => {
    const user = mustUser(c);
    const data = await readForm(c);
    const nextPassword = data.password ?? "";
    const problem = passwordError(nextPassword);
    const errors: string[] = [];
    if (!(await verifyPassword(data.current ?? "", user.passwordHash))) errors.push("Current password is incorrect.");
    if (problem) errors.push(problem);
    if (nextPassword !== (data.confirm ?? "")) errors.push("Those passwords do not match.");
    if (errors.length) {
      return c.html(
        document(
          <AccountPassword viewer={viewerOf(user)} path="/account" usingDevSecret={c.get("usingDevSecret")} error={errors.join(" ")} />,
        ),
        422,
      );
    }
    await updateUser(c.env.DB, { ...user, passwordHash: await hashPassword(nextPassword) });
    return c.redirect("/account?notice=password-saved", 303);
  });

  app.post("/account/ical", async (c) => {
    const user = mustUser(c);
    await updateUser(c.env.DB, { ...user, icalToken: newToken() });
    return c.redirect("/account?notice=ical-reset", 303);
  });

  }

async function renderAircraft(c: Context<AppEnv>, id: string, errors: string[], values: AircraftFormValues | null): Promise<Response> {
  const user = mustUser(c);
  if (!isUuid(id)) return c.notFound();
  const aircraft = await getAircraft(c.env.DB, id);
  if (!aircraft) return c.notFound();
  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 86_400_000).toISOString();
  const [blocks, upcomingAll] = await Promise.all([
    listMaintenanceForAircraft(c.env.DB, aircraft.id),
    listReservationsOverlapping(c.env.DB, now.toISOString(), horizon),
  ]);
  return c.html(
    document(
      <AircraftFormPage
        viewer={viewerOf(user)}
        path="/aircraft"
        usingDevSecret={c.get("usingDevSecret")}
        mode="edit"
        action={`/aircraft/${aircraft.id}`}
        values={values ?? aircraftToForm(aircraft)}
        errors={errors}
        blocks={blocks}
        upcoming={upcomingAll.filter((item) => item.aircraftId === aircraft.id)}
        groundedNow={aircraft.status === "grounded"}
      />,
    ),
    errors.length ? 422 : 200,
  );
}

async function personResponse(
  c: Context<AppEnv>,
  mode: "create" | "edit" | "self",
  values: PersonFormValues,
  errors: string[],
  person: User | null,
): Promise<Response> {
  const user = mustUser(c);
  const aircraft = person ? await listAircraft(c.env.DB) : [];
  const checkouts = person ? await listCheckoutsForUser(c.env.DB, person.id) : [];
  const upcoming = person ? await listReservationsForUser(c.env.DB, person.id, new Date(Date.now() - 86_400_000).toISOString()) : [];
  const logs = person && (user.role === "admin" || user.id === person.id) ? await listFlightLogs(c.env.DB, { pilotId: person.id, limit: 20 }) : undefined;
  const icalUrl = mode === "self" ? new URL(`/ical/${user.icalToken}`, c.req.url).toString() : null;
  return c.html(
    document(
      <PersonFormPage
        viewer={viewerOf(user)}
        path={mode === "self" ? "/account" : "/pilots"}
        notice={pageNotice(c.req.query("notice"))}
        usingDevSecret={c.get("usingDevSecret")}
        mode={mode}
        action={mode === "create" ? "/pilots" : mode === "self" ? "/account" : `/pilots/${person?.id}`}
        values={values}
        errors={errors}
        canEditRole={user.role === "admin" && mode !== "self"}
        showPassword={user.role === "admin" && mode !== "self"}
        passwordHint={mode === "create" ? "Share this once. At least 10 characters, with a letter and a number." : "Leave blank to keep the current password."}
        aircraft={aircraft}
        checkouts={checkouts}
        checkoutAction={person ? `/pilots/${person.id}/checkouts` : undefined}
        canEditCheckouts={Boolean(person) && mode === "edit" && user.role !== "renter"}
        upcoming={upcoming}
        logs={logs}
        icalUrl={icalUrl}
      />,
    ),
    errors.length ? 422 : 200,
  );
}

function mustUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) throw new Error("Sign-in required.");
  return user;
}

function forbidden(c: Context<AppEnv>) {
  return c.html(document(<SimpleMessage title="Not allowed" message="Your role cannot do that." />), 403);
}

function emptyAircraft(): AircraftFormValues {
  return {
    tailNumber: "",
    make: "",
    model: "",
    year: "",
    wet: "",
    dry: "",
    defaultRate: "wet",
    status: "available",
    hobbs: "",
    tach: "",
    notes: "",
  };
}

function emptyPerson(): PersonFormValues {
  return {
    name: "",
    email: "",
    role: "renter",
    phone: "",
    certificateType: "private",
    certificateNumber: "",
    medicalClass: "third",
    medicalExpiration: "",
    instructorRate: "",
    password: "",
  };
}

function parseAircraft(data: Record<string, string>): { values: AircraftFormValues; errors: string[]; aircraft: Omit<Aircraft, "id" | "createdAt"> | null } {
  const values: AircraftFormValues = {
    tailNumber: field(data, "tail_number").toUpperCase().replace(/\s+/g, ""),
    make: field(data, "make"),
    model: field(data, "model"),
    year: field(data, "year"),
    wet: field(data, "wet"),
    dry: field(data, "dry"),
    defaultRate: field(data, "default_rate") || "wet",
    status: field(data, "status") || "available",
    hobbs: field(data, "hobbs"),
    tach: field(data, "tach"),
    notes: field(data, "notes"),
  };
  const errors: string[] = [];
  if (!/^[A-Z0-9-]{2,8}$/.test(values.tailNumber)) errors.push("Use a tail number of 2–8 letters or numbers, like N1561Y.");
  if (values.make.length < 2 || values.make.length > 40) errors.push("Enter the make.");
  if (values.model.length < 1 || values.model.length > 40) errors.push("Enter the model.");
  let year: number | null = null;
  if (values.year) {
    if (!/^\d{4}$/.test(values.year) || Number(values.year) < 1940 || Number(values.year) > 2100) errors.push("Year should look like 2018.");
    else year = Number(values.year);
  }
  const wet = parseDollarsToCents(values.wet);
  const dry = values.dry.trim() ? parseDollarsToCents(values.dry) : null;
  if (wet == null) errors.push("Enter a wet hourly rate, like 155.00.");
  if (values.dry.trim() && dry == null) errors.push("Dry hourly rate should look like 120.00, or be left blank.");
  if (values.defaultRate === "dry" && dry == null) errors.push("Set a dry rate, or choose wet as the default.");
  if (values.defaultRate !== "wet" && values.defaultRate !== "dry") errors.push("Choose wet or dry as the default rate.");
  if (values.status !== "available" && values.status !== "grounded") errors.push("Choose a status.");
  let hobbs: number | null = null;
  let tach: number | null = null;
  if (values.hobbs) {
    hobbs = parseMeter(values.hobbs);
    if (hobbs == null) errors.push("Hobbs is a number with at most one decimal, like 4120.4.");
  }
  if (values.tach) {
    tach = parseMeter(values.tach);
    if (tach == null) errors.push("Tach is a number with at most one decimal.");
  }
  if (values.notes.length > 2000) errors.push("Notes are too long.");
  if (errors.length || wet == null) return { values, errors, aircraft: null };
  return {
    values,
    errors,
    aircraft: {
      tailNumber: values.tailNumber,
      make: values.make,
      model: values.model,
      year,
      hourlyWetCents: wet,
      hourlyDryCents: dry,
      defaultRate: values.defaultRate as RateBasis,
      status: values.status as AircraftStatus,
      hobbs,
      tach,
      notes: blankToNull(values.notes),
    },
  };
}

async function parsePerson(
  data: Record<string, string>,
  input: { mode: "create" | "edit" | "self"; actor: User; current: User | null },
): Promise<{ values: PersonFormValues; errors: string[]; draft: Parameters<typeof insertUser>[1] | null }> {
  const roleInput = field(data, "role");
  const role = input.mode === "self" ? input.actor.role : ROLES.has(roleInput as Role) ? (roleInput as Role) : "renter";
  const values: PersonFormValues = {
    name: field(data, "name"),
    email: normalizeEmail(field(data, "email")),
    role,
    phone: field(data, "phone"),
    certificateType: field(data, "certificate_type") || "none",
    certificateNumber: field(data, "certificate_number"),
    medicalClass: field(data, "medical_class") || "none",
    medicalExpiration: field(data, "medical_expiration"),
    instructorRate: field(data, "instructor_rate"),
    password: data.password ?? "",
  };
  const errors: string[] = [];
  if (values.name.length < 2 || values.name.length > 120) errors.push("Enter a name.");
  const emailProblem = emailError(values.email);
  if (emailProblem) errors.push(emailProblem);
  if (values.phone.length > 40) errors.push("Phone number is too long.");
  if (!CERTS.has(values.certificateType as CertificateType)) errors.push("Choose a certificate type.");
  if (values.certificateNumber.length > 40) errors.push("Certificate number is too long.");
  if (!MEDICALS.has(values.medicalClass as MedicalClass)) errors.push("Choose a medical class.");
  let medicalExpiration: string | null = null;
  if (values.medicalExpiration) {
    medicalExpiration = parseDay(values.medicalExpiration);
    if (!medicalExpiration) errors.push("Medical expiration should be a real date.");
  }
  let instructorRateCents: number | null = null;
  if (role === "instructor") {
    if (!values.instructorRate) errors.push("Enter an instructor hourly rate, or 0.");
    else {
      instructorRateCents = parseDollarsToCents(values.instructorRate);
      if (instructorRateCents == null) errors.push("Instructor rate should look like 75.00.");
    }
  }
  let passwordHash = input.current?.passwordHash ?? "";
  if (input.mode === "create") {
    const problem = passwordError(values.password);
    if (problem) errors.push(problem);
  } else if (input.mode === "edit" && values.password) {
    const problem = passwordError(values.password);
    if (problem) errors.push(problem);
  }
  if (errors.length) return { values, errors, draft: null };
  if (input.mode === "create" || (input.mode === "edit" && values.password)) passwordHash = await hashPassword(values.password);
  return {
    values,
    errors,
    draft: {
      id: input.current?.id ?? crypto.randomUUID(),
      email: values.email,
      passwordHash,
      name: values.name,
      role,
      phone: blankToNull(values.phone),
      certificateType: values.certificateType as CertificateType,
      certificateNumber: blankToNull(values.certificateNumber),
      medicalClass: values.medicalClass as MedicalClass,
      medicalExpiration,
      instructorRateCents,
      icalToken: input.current?.icalToken ?? newToken(),
      createdAt: input.current?.createdAt ?? new Date().toISOString(),
    },
  };
}

function medicalState(expiration: string | null, today: string): string {
  if (!expiration || expiration < today) return "expired";
  const soon = addDays(today, 30);
  if (expiration <= soon) return "soon";
  return "ok";
}
