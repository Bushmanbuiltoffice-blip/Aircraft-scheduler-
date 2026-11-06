/** @jsxImportSource hono/jsx */
import { html } from "hono/html";
import { formatDateTime } from "./time";
import type { User } from "./types";
import { Errors, GuestShell, Layout, PageHead, type Viewer } from "./ui";

export function InviteLinkPage(props: {
  viewer: Viewer;
  usingDevSecret: boolean;
  person: User;
  url: string;
  expiresAt: string;
  reset: boolean;
  smsHref: string;
  mailtoHref: string | null;
  message: string;
  /** True right after Add person saved this person. */
  justAdded?: boolean;
}) {
  const label = props.reset ? "Reset link" : "Invite link";
  return (
    <Layout title={`${label} · ${props.person.name}`} user={props.viewer} path="/pilots" usingDevSecret={props.usingDevSecret}>
      <PageHead
        title={`${label} for ${props.person.name}`}
        lede={`Single use. Expires ${formatDateTime(props.expiresAt)}. Any older unused link for ${props.person.name} no longer works.`}
      >
        {props.justAdded ? <a class="btn secondary" href={`/pilots/${props.person.id}`}>Open profile</a> : null}
        <a class="btn secondary" href="/pilots">Back to People</a>
      </PageHead>
      {props.justAdded ? (
        <p class="alert ok" role="status">
          {props.person.name} is saved with no password. They can't sign in until they open this link and choose one.
        </p>
      ) : null}
      <section class="card invite-card" role="dialog" aria-labelledby="invite-heading">
        <h2 id="invite-heading">Send this link to {props.person.name}</h2>
        <p class="muted">
          This page is the only time the full link is shown. Nothing is sent automatically. Use Copy, Text, or Email below.
        </p>
        <label>
          Link
          <input id="invite-url" type="text" readonly value={props.url} onfocus="this.select()" />
        </label>
        <div class="actions">
          <button class="btn" type="button" id="copy-invite" data-url={props.url}>Copy link</button>
          <a class="btn secondary" href={props.smsHref}>Text</a>
          {props.mailtoHref ? <a class="btn secondary" href={props.mailtoHref}>Email</a> : null}
          <span id="copy-status" class="muted" role="status"></span>
        </div>
        <p class="muted">Message: {props.message}</p>
        {props.mailtoHref ? null : <p class="muted">No email on file, so there is no Email button. They will enter an email when they open the link.</p>}
      </section>
      {html`<script>
(function () {
  var button = document.getElementById("copy-invite");
  var input = document.getElementById("invite-url");
  var status = document.getElementById("copy-status");
  if (!button || !input) return;
  button.addEventListener("click", function () {
    function done() { if (status) status.textContent = "Copied."; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); document.execCommand("copy"); done(); });
    } else { input.select(); document.execCommand("copy"); done(); }
  });
})();
</script>`}
    </Layout>
  );
}

export function InvitePage(props: { name: string; email: string; errors?: string[]; action: string }) {
  return (
    <GuestShell title="Set your password" kicker="Invitation" lede="Set your own password to see the schedule and book flights.">
      <h2>Welcome, {props.name}</h2>
      <Errors errors={props.errors} />
      <form method="post" action={props.action} class="stack">
        <label>
          Email
          <input type="email" name="email" autocomplete="username" required value={props.email} />
          <small>You sign in with this email.</small>
        </label>
        <label>
          New password
          <input type="password" name="password" required minlength={10} autocomplete="new-password" />
          <small>At least 10 characters, with a letter and a number.</small>
        </label>
        <label>
          Confirm password
          <input type="password" name="confirm" required autocomplete="new-password" />
        </label>
        <button class="btn" type="submit">Save password and sign in</button>
      </form>
    </GuestShell>
  );
}

export function InviteInvalidPage(props: { reason: string }) {
  const message =
    props.reason === "used"
      ? "This link was already used."
      : props.reason === "expired"
        ? "This link has expired."
        : "This link is not valid anymore.";
  return (
    <GuestShell title="Link not valid" kicker="Invitation" lede="Invite links work once and expire after 7 days.">
      <h2>{message}</h2>
      <p>Ask the office admin to send you a new invite link. If you already set a password, <a href="/login">sign in</a>.</p>
    </GuestShell>
  );
}
