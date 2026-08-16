/**
 * Canonical "unknown → message" extractor. Replaces the ~7 verbatim `getErrorMessage`
 * re-declarations (App, EnvironmentsView, TestsView, RunConsole, ServerWizard, SkillWizard,
 * SettingsView) and the many inline `err instanceof Error ? err.message : "…"` variants. Pass a
 * `fallback` for the non-`Error` case (defaults to a generic message); callers that had a bespoke
 * fallback string keep it by passing it here.
 */
export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return humanizeErrorMessage(error instanceof Error ? error.message : fallback);
}

/**
 * The browser's `fetch()` rejects a network-layer failure (DNS miss, connection refused, offline, a
 * malformed URL, a blocked cross-origin request) as an opaque `TypeError` whose `message` is a bare
 * "Failed to fetch" (Chromium/Firefox), "Load failed" (WebKit/Safari), or "NetworkError when
 * attempting to fetch resource." (older Firefox). Node's undici surfaces the same class as
 * "fetch failed". None of those tell an operator what to do — so map them to one actionable line,
 * in the app's own voice (name the problem, say the next step). Every other message passes through
 * verbatim.
 */
export function humanizeErrorMessage(message: string): string {
  return isNetworkFetchFailure(message)
    ? "Couldn’t reach the server — check the URL is correct and reachable, then try again."
    : message;
}

/** True for the handful of opaque browser/undici network-failure strings (see {@link humanizeErrorMessage}). */
export function isNetworkFetchFailure(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "failed to fetch" ||
    normalized === "load failed" ||
    normalized === "fetch failed" ||
    normalized === "networkerror when attempting to fetch resource."
  );
}
