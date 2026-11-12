/** @jsxImportSource hono/jsx */
import { formatBytes, MAX_UPLOAD_BYTES, REFERENCE_NOTE, type Resource, type ResourceGroup } from "./resources";
import type { Aircraft } from "./types";
import { AgreementResourceCard } from "./pages_agreement";
import type { AgreementStatus } from "./agreement";
import { Layout, PageHead, type Viewer } from "./ui";

export function ResourcesPage(props: {
  viewer: Viewer;
  path: string;
  usingDevSecret: boolean;
  groups: ResourceGroup[];
  aircraft: Aircraft[];
  notice?: string | null;
  error?: string | null;
  agreementStatus: AgreementStatus;
}) {
  const admin = props.viewer.role === "admin";
  return (
    <Layout title="Resources" user={props.viewer} path={props.path} usingDevSecret={props.usingDevSecret} notice={props.notice} error={props.error}>
      <PageHead title="Resources" lede="Manuals and reference documents for the fleet. The rental agreement can be read and signed here. Tap View to open a PDF on your phone, or Download to keep a copy." />
      <AgreementResourceCard status={props.agreementStatus} />
      {props.groups.length === 0 ? (
        <section class="card card-pad"><p class="muted">No documents yet.</p></section>
      ) : (
        props.groups.map((group) => (
          <section class="card resource-group" id={`resources-${group.key}`}>
            <h2>{group.label}</h2>
            <ul class="resource-list">
              {group.items.map((item) => (
                <ResourceRow item={item} admin={admin} />
              ))}
            </ul>
          </section>
        ))
      )}
      {admin ? <UploadForm aircraft={props.aircraft} /> : null}
    </Layout>
  );
}

function ResourceRow(props: { item: Resource; admin: boolean }) {
  const item = props.item;
  return (
    <li class="resource-item">
      <div class="resource-text">
        <strong>{item.title}</strong>
        <span class="muted">PDF · {formatBytes(item.sizeBytes)}</span>
        <p class="resource-note">{item.notes ?? REFERENCE_NOTE}</p>
      </div>
      <div class="resource-actions">
        <a class="btn" href={`/resources/${item.id}/view`} target="_blank" rel="noopener">View</a>
        <a class="btn secondary" href={`/resources/${item.id}/download`} download={item.fileName}>Download</a>
        {props.admin ? (
          <details class="resource-delete">
            <summary class="btn secondary small">Delete</summary>
            <form method="post" action={`/resources/${item.id}/delete`} class="inline-form">
              <button class="btn danger small" type="submit">Delete for everyone</button>
            </form>
          </details>
        ) : null}
      </div>
    </li>
  );
}

function UploadForm(props: { aircraft: Aircraft[] }) {
  return (
    <section class="card card-pad resource-upload">
      <h2>Add a PDF</h2>
      <p class="muted">Admins only. PDF files up to {formatBytes(MAX_UPLOAD_BYTES)}. Everyone signed in can view them.</p>
      <form method="post" action="/resources" enctype="multipart/form-data" class="fields">
        <label>
          Title
          <input name="title" required maxlength={120} placeholder="Weight and balance worksheet" />
        </label>
        <label>
          Aircraft
          <select name="aircraft_id">
            <option value="">General (no aircraft)</option>
            {props.aircraft.map((plane) => (
              <option value={plane.id}>{plane.tailNumber} · {plane.make} {plane.model}</option>
            ))}
          </select>
        </label>
        <label class="field-wide">
          Notes
          <input name="notes" maxlength={300} placeholder={REFERENCE_NOTE} />
        </label>
        <label class="field-wide">
          PDF file
          <input name="file" type="file" accept="application/pdf,.pdf" required />
        </label>
        <div class="field-wide">
          <button class="btn" type="submit">Upload PDF</button>
        </div>
      </form>
    </section>
  );
}
