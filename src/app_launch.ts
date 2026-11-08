/**
 * Cold open of the installed app goes to the dashboard.
 * A normal browser, an in-app click, a refresh, and a form result do not.
 * Invite links stay on the invite even on a cold open.
 */
export const WEB_MANIFEST = `{
  "name": "Firehound Rental",
  "short_name": "Firehound",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#12263a",
  "theme_color": "#12263a",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ]
}
`;

export function launchRedirect(input: { standalone: boolean; hasSession: boolean; path: string; pdfHold?: boolean }): "/" | null {
  if (!input.standalone || input.hasSession || input.pdfHold) return null;
  if (input.path === "/" || input.path.startsWith("/invite/") || input.path.startsWith("/setup")) return null;
  if (input.path.endsWith(".pdf")) return null;
  return "/";
}

/** A background return shorter than this is treated as a focus blip, not an app open. */
export const RESUME_AWAY_MS = 1000;

export function resumeRedirect(input: {
  standalone: boolean;
  path: string;
  hiddenMs: number;
  printing: boolean;
  formDirty: boolean;
  filePicker: boolean;
  pdfHold?: boolean;
}): "/" | null {
  if (!input.standalone) return null;
  if (input.pdfHold) return null;
  if (input.path === "/" || input.path.startsWith("/invite/") || input.path.startsWith("/setup")) return null;
  if (input.path === "/agreement" || input.path.startsWith("/agreement/")) return null;
  if (input.path.endsWith(".pdf")) return null;
  if (input.printing || input.formDirty || input.filePicker) return null;
  if (input.hiddenMs < RESUME_AWAY_MS) return null;
  return "/";
}

export type ResumeEvent =
  | { type: "visibility"; state: "hidden" | "visible"; at: number }
  | { type: "pagehide"; at: number; persisted: boolean }
  | { type: "pageshow"; at: number; persisted: boolean }
  | { type: "beforeprint"; at: number }
  | { type: "afterprint"; at: number }
  | { type: "file"; at: number }
  | { type: "resume"; at: number };

/**
 * Replays hide/show, print, and history events for one installed-app page.
 * A live page that was hidden and shown again goes to the dashboard.
 * A fast back-button restore does not. Print and a file picker do not.
 */
export function replayResume(input: {
  standalone: boolean;
  path: string;
  formDirty: boolean;
  pdfHold?: boolean;
  events: ResumeEvent[];
}): "/" | null {
  let hiddenAt: number | null = null;
  let pageHideAt: number | null = null;
  let navigatedAway = false;
  let lastHistoryShow = -1_000_000;
  let printing = false;
  let printGraceUntil = 0;
  let filePicker = false;
  const printingAt = (at: number) => printing || at < printGraceUntil;
  const decide = (at: number, hiddenMs: number, picker: boolean): "/" | null =>
    resumeRedirect({
      standalone: input.standalone,
      path: input.path,
      hiddenMs,
      printing: printingAt(at),
      formDirty: input.formDirty,
      filePicker: picker,
      pdfHold: input.pdfHold,
    });

  for (const event of input.events) {
    if (event.type === "beforeprint") {
      printing = true;
      continue;
    }
    if (event.type === "afterprint") {
      printing = false;
      printGraceUntil = event.at + 3000;
      continue;
    }
    if (event.type === "file") {
      filePicker = true;
      continue;
    }
    if (event.type === "visibility" && event.state === "hidden") {
      hiddenAt = event.at;
      navigatedAway = false;
      continue;
    }
    if (event.type === "pagehide") {
      pageHideAt = event.at;
      if (!event.persisted) navigatedAway = true;
      continue;
    }
    if (event.type === "pageshow") {
      if (!event.persisted) continue;
      lastHistoryShow = event.at;
      const away = pageHideAt == null ? 0 : event.at - pageHideAt;
      const choice = decide(event.at, away, filePicker);
      filePicker = false;
      if (choice) return choice;
      continue;
    }
    if (event.type === "resume") {
      if (event.at - lastHistoryShow < RESUME_AWAY_MS) continue;
      const away = hiddenAt == null ? RESUME_AWAY_MS : event.at - hiddenAt;
      const choice = decide(event.at, navigatedAway ? 0 : away, filePicker);
      filePicker = false;
      if (choice) return choice;
      continue;
    }
    if (event.type === "visibility" && event.state === "visible") {
      const away = hiddenAt == null ? 0 : event.at - hiddenAt;
      hiddenAt = null;
      const picker = filePicker;
      filePicker = false;
      if (navigatedAway) continue;
      const choice = decide(event.at, away, picker);
      if (choice) return choice;
    }
  }
  return null;
}
