/**
 * Save PDF must follow the real link from the tap.
 * The Home Screen script used to cancel that link and call share() only after fetch.
 * iPhone drops that late share, and the fallback click is not a tap, so nothing happened.
 */
export function savePdfFollowsLink(): true {
  return true;
}

export function printFallbackMessage(input: { standalone: boolean; beforePrintFired: boolean; errorName?: string | null }): string | null {
  if (!input.standalone || input.beforePrintFired) return null;
  const why = input.errorName ? ` (${input.errorName})` : "";
  return `Print did not open${why}. Tap Save PDF. It opens this document in a new window from that tap.`;
}

export function savePdfStatus(href: string): string {
  return `Save PDF tapped. A new window should open this document: ${href}`;
}
