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

export function launchRedirect(input: { standalone: boolean; hasSession: boolean; path: string }): "/" | null {
  if (!input.standalone || input.hasSession) return null;
  if (input.path === "/" || input.path.startsWith("/invite/") || input.path.startsWith("/setup")) return null;
  return "/";
}
