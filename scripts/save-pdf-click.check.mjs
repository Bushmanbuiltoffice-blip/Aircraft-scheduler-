import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";

const script = readFileSync(new URL("../public/bill-print.js", import.meta.url), "utf8");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

function pageHtml() {
  return `<!doctype html><html><body>
<button id="print-bill" type="button">Print</button>
<a class="btn save-pdf" id="save-pdf" href="/doc.pdf" target="_blank" rel="noopener">Save PDF</a>
<p id="print-status" class="no-print alert" role="status" hidden></p>
<input id="print-url" readonly hidden />
<script src="/bill-print.js?v=5"></script>
</body></html>`;
}

test("Save PDF does not cancel the link", () => {
  assert.equal(script.includes("navigator.share"), false);
  assert.equal(script.includes("window.open"), false);
  const guard = script.slice(script.indexOf("a.save-pdf"));
  assert.match(guard, /if \(!link\.target \|\| link\.target === "_self"\) \{\s*event\.preventDefault\(\)/);
});

test("a real click opens the PDF in a new window and does not cancel the link", { timeout: 25_000 }, async () => {
  const hits = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    hits.push(path);
    if (path === "/bill-print.js") {
      res.setHeader("content-type", "text/javascript; charset=utf-8");
      res.end(script);
      return;
    }
    if (path === "/doc.pdf") {
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="doc.pdf"',
        "cache-control": "private, no-store",
      });
      res.end(pdf);
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(pageHtml());
  });
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const profile = mkdtempSync(`${tmpdir()}/save-pdf-chrome-`);
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  chrome.stdout.on("data", (chunk) => { log += chunk.toString(); });
  chrome.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not open a debugging port.\n${log}`)), 10_000);
    const scan = () => {
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (!found) return;
      clearTimeout(timer);
      resolve(found[1]);
    };
    chrome.stdout.on("data", scan);
    chrome.stderr.on("data", scan);
  });
  const ws = new WebSocket(browserUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const events = [];
  let next = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else events.push(message);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
  const waitFor = (predicate, timeoutMs = 8_000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out. Last events: ${events.slice(-8).map((event) => event.method).join(", ")}`)), timeoutMs);
    const check = setInterval(() => {
      const found = events.find(predicate);
      if (!found) return;
      clearInterval(check);
      clearTimeout(timer);
      resolve(found);
    }, 20);
  });
  try {
    await send("Target.setDiscoverTargets", { discover: true });
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/bill` }, sessionId);
    for (let attempt = 0; attempt < 40; attempt++) {
      const href = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId);
      if (href.result.value.endsWith("/bill")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const defined = await send("Runtime.evaluate", {
      expression: `Object.defineProperty(window.navigator, "standalone", { configurable: true, get() { return true; } }); standaloneApp()`,
      returnByValue: true,
    }, sessionId);
    assert.equal(defined.result.value, true);
    await send("Runtime.evaluate", {
      expression: `document.addEventListener('click', (event) => { const link = event.target.closest && event.target.closest('a'); window.__lastClick = { defaultPrevented: event.defaultPrevented, href: link ? link.href : '', target: link ? link.target : '' }; }, false);`,
    }, sessionId);
    const point = await send("Runtime.evaluate", {
      expression: `(() => { const r = document.querySelector('#save-pdf').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      returnByValue: true,
    }, sessionId);
    const { x, y } = point.result.value;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, sessionId);
    }
    const opened = await waitFor((event) => {
      const url = event.params?.targetInfo?.url || event.params?.url || "";
      return url.endsWith("/doc.pdf");
    });
    assert.equal((opened.params.targetInfo?.url || opened.params.url).endsWith("/doc.pdf"), true);
    assert.equal(hits.includes("/doc.pdf"), true);
    const click = await send("Runtime.evaluate", { expression: "window.__lastClick", returnByValue: true }, sessionId);
    assert.equal(click.result.value.defaultPrevented, false);
    assert.equal(click.result.value.target, "_blank");
    const status = await send("Runtime.evaluate", { expression: "document.getElementById('print-status').textContent", returnByValue: true }, sessionId);
    const shown = await send("Runtime.evaluate", { expression: "document.getElementById('print-url').value", returnByValue: true }, sessionId);
    const hidden = await send("Runtime.evaluate", { expression: "document.getElementById('print-url').hidden", returnByValue: true }, sessionId);
    assert.match(status.result.value, /^Save PDF tapped\. A new window should open this document: http:\/\/127\.0\.0\.1:\d+\/doc\.pdf$/);
    assert.equal(shown.result.value, click.result.value.href);
    assert.equal(hidden.result.value, false);
    assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
    assert.ok(hits.filter((path) => path === "/doc.pdf").length >= 1);
  } finally {
    ws.close();
    chrome.kill("SIGKILL");
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* the profile is only a temp directory */ }
  }
});
