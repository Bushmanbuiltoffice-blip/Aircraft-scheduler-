/** @jsxImportSource hono/jsx */
import { Errors, GuestShell } from "./ui";

export function LoginPage(props: { error?: string | null; email?: string; next?: string }) {
  return (
    <GuestShell
      title="Sign in"
      kicker="Sign in"
      lede="The dispatch board for rentals, instruction, and the maintenance shop. One schedule for the airplanes and the instructors."
    >
      <h2>Welcome back</h2>
      {props.error ? <p class="alert" role="alert">{props.error}</p> : null}
      <form method="post" action="/login" class="stack">
        <input type="hidden" name="next" value={props.next ?? "/"} />
        <label>
          Email
          <input type="email" name="email" autocomplete="username" required value={props.email ?? ""} />
        </label>
        <label>
          Password
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <button class="btn" type="submit">Sign in</button>
      </form>
    </GuestShell>
  );
}

export function SetupPage(props: { errors?: string[]; name?: string; email?: string }) {
  return (
    <GuestShell
      title="Create the owner account"
      kicker="First-time setup"
      lede="Nobody has an account yet. Create the owner login, then add airplanes and pilots. This page closes itself after the first account exists."
    >
      <h2>Create the owner account</h2>
      <Errors errors={props.errors} />
      <form method="post" action="/setup" class="stack">
        <label>
          Your name
          <input type="text" name="name" required value={props.name ?? ""} autocomplete="name" placeholder="Kyle Bushman" />
        </label>
        <label>
          Email
          <input type="email" name="email" required value={props.email ?? ""} autocomplete="username" />
        </label>
        <label>
          Password
          <input type="password" name="password" required autocomplete="new-password" />
          <small>At least 10 characters, with a letter and a number.</small>
        </label>
        <label>
          Confirm password
          <input type="password" name="confirm" required autocomplete="new-password" />
        </label>
        <button class="btn" type="submit">Create admin account</button>
      </form>
    </GuestShell>
  );
}
