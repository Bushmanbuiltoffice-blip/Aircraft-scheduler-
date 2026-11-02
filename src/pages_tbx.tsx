/** @jsxImportSource hono/jsx */
import { html } from "hono/html";
import type { TbxEntry } from "./db";
import { formatHours, formatMeter } from "./format";
import { formatDateTime } from "./time";
import type { Aircraft, FlightLogView } from "./types";
import { Layout, PageHead, type Viewer } from "./ui";

export const TBX_URL = "https://www.airworthy.com/";

export function TbxPage(props: {
  viewer: Viewer;
  usingDevSecret: boolean;
  aircraft: Aircraft;
  entries: TbxEntry[];
  flights: FlightLogView[];
  notice?: string | null;
  error?: string | null;
}) {
  const plane = props.aircraft;
  const last = props.entries[0] ?? null;
  const upToDate = last != null && last.hobbs === plane.hobbs && last.tach === plane.tach;
  const hobbs = formatMeter(plane.hobbs);
  const tach = formatMeter(plane.tach);
  return (
    <Layout title={`TBX · ${plane.tailNumber}`} user={props.viewer} path="/aircraft" usingDevSecret={props.usingDevSecret} notice={props.notice} error={props.error}>
      <PageHead
        title={`TBX update · ${plane.tailNumber}`}
        lede="TBX does not offer a public way for other apps to send aircraft times, so enter these in TBX by hand, then mark them entered here."
      >
        <a class="btn secondary" href={`/aircraft/${plane.id}`}>Aircraft</a>
        <a class="btn secondary" href={TBX_URL} target="_blank" rel="noopener">Open TBX</a>
      </PageHead>
      <section class="card card-pad tbx-now" id="tbx-current">
        <h2>Current meters on {plane.tailNumber}</h2>
        <p class={`alert ${upToDate ? "ok" : "warn"}`} role="status">
          {last
            ? upToDate
              ? `TBX is up to date. Entered ${formatDateTime(last.enteredAt)}${last.enteredByName ? ` by ${last.enteredByName}` : ""}.`
              : `Not entered in TBX yet. Last entered: Hobbs ${formatMeter(last.hobbs)} · Tach ${formatMeter(last.tach)} on ${formatDateTime(last.enteredAt)}.`
            : "Nothing has been marked as entered in TBX yet."}
        </p>
        <div class="tbx-meters">
          <div class="tbx-meter">
            <span class="muted">Tach (maintenance time, goes to TBX)</span>
            <strong id="tbx-tach">{tach}</strong>
            <button class="btn secondary small copy-btn" type="button" data-copy={tach}>Copy tach</button>
          </div>
          <div class="tbx-meter">
            <span class="muted">Hobbs (billing time)</span>
            <strong id="tbx-hobbs">{hobbs}</strong>
            <button class="btn secondary small copy-btn" type="button" data-copy={hobbs}>Copy Hobbs</button>
          </div>
        </div>
        <button class="btn secondary small copy-btn" type="button" data-copy={`${plane.tailNumber} Tach ${tach} Hobbs ${hobbs}`}>Copy both</button>
        <span class="muted copy-status" role="status"></span>
        {plane.hobbs != null && plane.tach != null && !upToDate ? (
          <form method="post" action={`/aircraft/${plane.id}/tbx`} class="tbx-mark">
            <input type="hidden" name="hobbs" value={hobbs} />
            <input type="hidden" name="tach" value={tach} />
            <label class="check-confirm">
              <input type="checkbox" name="entered" value="yes" required />
              I entered Tach {tach} and Hobbs {hobbs} into TBX for {plane.tailNumber}.
            </label>
            <button class="btn" type="submit">Mark as entered in TBX</button>
          </form>
        ) : null}
      </section>
      <section class="card" id="tbx-flights">
        <header class="section-head pad">
          <h2>{last ? "Flights since the last TBX entry" : "Flights logged here"}</h2>
          <a class="btn secondary small" href={`/aircraft/${plane.id}/tbx.csv`}>Download CSV</a>
        </header>
        <div class="table-wrap">
          <table class="log-table">
            <thead>
              <tr><th>When</th><th>Pilot</th><th>Tach out → in</th><th>Tach hrs</th><th>Hobbs out → in</th><th>Hobbs hrs</th></tr>
            </thead>
            <tbody>
              {props.flights.map((log) => (
                <tr>
                  <td data-label="When"><a href={`/logs/${log.id}`}>{formatDateTime(log.createdAt)}</a></td>
                  <td data-label="Pilot">{log.pilotName}</td>
                  <td data-label="Tach out → in">{formatMeter(log.tachOut)} → {formatMeter(log.tachIn)}</td>
                  <td data-label="Tach hrs">{log.tachOut != null && log.tachIn != null ? formatHours(log.tachIn - log.tachOut) : "—"}</td>
                  <td data-label="Hobbs out → in">{formatMeter(log.hobbsOut)} → {formatMeter(log.hobbsIn)}</td>
                  <td data-label="Hobbs hrs">{formatHours(log.flightHours)}</td>
                </tr>
              ))}
              {props.flights.length === 0 ? <tr><td colspan={6} class="muted">No flights since the last TBX entry.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {props.entries.length ? (
        <section class="card card-pad">
          <h2>TBX entry history</h2>
          <ul class="plain">
            {props.entries.map((entry) => (
              <li>
                {formatDateTime(entry.enteredAt)} · Tach {formatMeter(entry.tach)} · Hobbs {formatMeter(entry.hobbs)}
                {entry.enteredByName ? ` · ${entry.enteredByName}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {html`<script>
(function () {
  var status = document.querySelector(".copy-status");
  document.querySelectorAll(".copy-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy") || "";
      function done() { if (status) status.textContent = "Copied " + text + "."; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else { var area = document.createElement("textarea"); area.value = text; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove(); done(); }
    });
  });
})();
</script>`}
    </Layout>
  );
}
