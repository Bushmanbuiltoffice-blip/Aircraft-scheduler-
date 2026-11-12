/** @jsxImportSource hono/jsx */
import { AGREEMENT_ACK, type AgreementRecord, type AgreementStatus } from "./agreement";
import { AGREEMENT_TEXT, AGREEMENT_TEXT_SHA256, AGREEMENT_VERSION } from "./agreements/canonical";
import { Layout, PageHead, type Viewer } from "./ui";

export function AgreementPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  notice?: string | null;
  error?: string | null;
  record: AgreementRecord | null;
  status: AgreementStatus;
}) {
  return (
    <Layout title="Rental agreement" user={props.viewer} path={props.path} notice={props.notice} usingDevSecret={props.usingDevSecret} error={props.error}>
      <PageHead
        title="Aircraft rental agreement"
        lede="Fire Hound Rental. Read the current agreement, then sign it yourself. An admin cannot sign it for you."
      >
        <a class="btn secondary" href="/agreement/file" download="fire-hound-rental-agreement.pdf">Download unsigned PDF</a>
      </PageHead>
      <section class="card card-pad">
        <pre class="agreement-text">{AGREEMENT_TEXT}</pre>
        <p class="muted">Version {AGREEMENT_VERSION}. SHA-256 {AGREEMENT_TEXT_SHA256}.</p>
      </section>
      <AgreementState viewerName={props.viewer.name} record={props.record} status={props.status} />
    </Layout>
  );
}

function AgreementState(props: { viewerName: string; record: AgreementRecord | null; status: AgreementStatus }) {
  if (props.status === "complete" && props.record) {
    return (
      <section class="card card-pad" id="agreement-status">
        <h2>Signed</h2>
        <p>Signed by {props.record.legalName} at {props.record.renterSignedAt}. This copy is kept. Signing again does not replace it.</p>
        {props.record.guardianLegalName ? <p>Parent or legal guardian: {props.record.guardianLegalName} at {props.record.guardianSignedAt}.</p> : null}
        <p><a class="btn" href="/agreement/signed">Download your signed PDF</a></p>
      </section>
    );
  }
  if (props.status === "awaiting_guardian" && props.record) {
    return (
      <section class="card card-pad" id="agreement-status">
        <h2>Not complete</h2>
        <p class="alert" role="alert">
          {props.record.legalName} signed at {props.record.renterSignedAt}. A parent or legal guardian still has to sign in the form below.
          The renter's name is not parent consent, and check-out stays blocked until that separate signature is saved.
        </p>
        <form method="post" action="/agreement/guardian" class="stack">
          <label>
            Parent or legal guardian full legal name
            <input name="guardian_legal_name" required autocomplete="name" />
          </label>
          <label class="check-confirm">
            <input type="checkbox" name="guardian_consent" value="yes" required />
            I am the parent or legal guardian of {props.record.legalName}. I have read this agreement and I agree to it. My typed name is my signature.
          </label>
          <button class="btn" type="submit">Sign as parent or legal guardian</button>
        </form>
      </section>
    );
  }
  return (
    <section class="card card-pad" id="agreement-sign">
      <h2>Sign online</h2>
      <p>You are signing as {props.viewerName}. The signature is stored for this account only.</p>
      <form method="post" action="/agreement/sign" class="stack">
        <label>
          Full legal name
          <input name="legal_name" required autocomplete="name" />
        </label>
        <fieldset>
          <legend>Age</legend>
          <label class="check-confirm"><input type="radio" name="age" value="adult" required /> I am 18 or older.</label>
          <label class="check-confirm"><input type="radio" name="age" value="minor" /> I am under 18. A parent or legal guardian must sign separately before this agreement is complete.</label>
        </fieldset>
        <label class="check-confirm">
          <input type="checkbox" name="read_ack" value="yes" required />
          {AGREEMENT_ACK}
        </label>
        <label class="check-confirm">
          <input type="checkbox" name="esign_consent" value="yes" required />
          I agree to sign this agreement electronically. My typed full legal name is my signature. This is the scheduling app's own record, not SignWell.
        </label>
        <button class="btn" type="submit">Sign agreement</button>
      </form>
    </section>
  );
}

export function AgreementResourceCard(props: { status: AgreementStatus }) {
  const label = props.status === "complete" ? "Signed" : props.status === "awaiting_guardian" ? "Not complete — guardian must sign" : "Not signed";
  return (
    <section class="card resource-group" id="rental-agreement">
      <h2>Rental agreement</h2>
      <ul class="resource-list">
        <li class="resource-item">
          <div class="resource-text">
            <strong>Aircraft Rental Agreement</strong>
            <span class="muted">Fire Hound Rental · current version · {label}</span>
            <p class="resource-note">Read it and sign online before check-out. An existing account is not signed until you submit the signature yourself.</p>
          </div>
          <div class="resource-actions">
            <a class="btn" href="/agreement">View and sign</a>
            <a class="btn secondary" href="/agreement/file" download="fire-hound-rental-agreement.pdf">Download</a>
          </div>
        </li>
      </ul>
    </section>
  );
}

export function AgreementAccountCard(props: { own: boolean; status: AgreementStatus; record: AgreementRecord | null; downloadHref: string | null }) {
  const label = props.status === "complete" ? "Signed" : props.status === "awaiting_guardian" ? "Not complete — guardian must sign" : "Not signed";
  return (
    <section class="card card-pad" id="rental-agreement">
      <h2>Rental agreement</h2>
      <p>{label}{props.record ? ` · ${props.record.legalName} · ${props.record.renterSignedAt}` : ". Nothing has been signed for the current agreement."}</p>
      <p class="actions">
        {props.own ? <a class="btn secondary" href="/agreement">Open the agreement</a> : null}
        {props.downloadHref ? <a class="btn" href={props.downloadHref}>Download signed PDF</a> : null}
      </p>
    </section>
  );
}
