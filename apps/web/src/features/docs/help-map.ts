/**
 * help-map.ts — RM-18 WP 1.2. Route → the page of the guide that explains it.
 * =================================================================================================
 *
 * THE WHOLE REASON THE HELP CONTROL LIVES IN THE TOP BAR
 *   The WP calls for "per-view help links". Adding one to each view would mean ~40 file edits, a
 *   collision with every other in-flight work package, and a rule nobody enforces — so the next new
 *   view would ship without one. Instead there is exactly ONE control, in `AppShell`'s top-bar `end`
 *   slot (rendered once, on every route), and exactly ONE table: this file. A new route gets help by
 *   adding a line here, never by editing a view.
 *
 * MATCHING
 *   Entries are ordered MOST SPECIFIC FIRST and matched by exact path or path-prefix, so
 *   `/testing/runs/compare` can point somewhere different from `/testing/runs/:id` without a router.
 *   Kept as a pure function over a pathname (no react-router import) so it is testable without a
 *   render — the same reason `resolveStarterSurface` is pure.
 *
 * THE FALLBACK IS THE POINT
 *   An unmapped route resolves to the guide INDEX, never to nothing. The control must not vanish or
 *   dead-end: "there is no page for this yet, here is the manual" is a useful answer; a disappearing
 *   button is not.
 */
import { CHANGELOG_SUBJECT_ID, DOCS_ROUTE_BASE } from "./docs-manifest";

export type HelpMapEntry = {
  /** A route path prefix (matched exactly, or followed by `/`). */
  prefix: string;
  /** The manifest subject id this route's help lives in (a `planning/user-guide/DC-NN-<slug>` slug). */
  subject: string;
};

/**
 * Route prefix → subject id. MOST SPECIFIC FIRST — the first match wins.
 *
 * Every `subject` here is asserted against the real `planning/user-guide` tree by
 * `help-map.test.ts`, so a renamed or deleted DC folder turns this file red instead of quietly
 * sending an operator to a not-found page.
 */
export const HELP_MAP: readonly HelpMapEntry[] = [
  // ── Testing ────────────────────────────────────────────────────────────────────────────────────
  { prefix: "/testing/runs/compare", subject: "testing-console" },
  { prefix: "/testing/compare", subject: "testing-console" },
  { prefix: "/testing/compatibility", subject: "compatibility" },
  { prefix: "/testing/suites", subject: "suites-and-benchmarks" },
  { prefix: "/testing/suite-runs", subject: "suites-and-benchmarks" },
  { prefix: "/testing/observability", subject: "observability" },
  { prefix: "/testing/review", subject: "observability" },
  { prefix: "/testing/collections", subject: "suites-and-benchmarks" },
  { prefix: "/testing/environments", subject: "testing-console" },
  { prefix: "/testing/scenarios", subject: "testing-console" },
  { prefix: "/testing/runs", subject: "testing-console" },
  { prefix: "/testing", subject: "testing-console" },

  // ── MCP servers, scans, comparison, reports ────────────────────────────────────────────────────
  { prefix: "/servers", subject: "mcp-servers" },
  { prefix: "/scans", subject: "scans-and-footprint" },
  { prefix: "/compare", subject: "comparison" },
  { prefix: "/reports", subject: "reports" },
  // `/advisor` is deliberately ABSENT: DC-25-advisor holds a delivery record and no guide page yet,
  // so there is nothing to open. It falls back to the index — an honest "here is the manual" rather
  // than a link into a not-found. Same for `/illustrations` (DC-20-user-interface) and the security
  // tabs (DC-24-security-posture). Add a line here the day those subjects gain a guide page.

  // ── Skills ─────────────────────────────────────────────────────────────────────────────────────
  { prefix: "/skills", subject: "skills" },

  // ── The Assistant Hub (the full-page assistant; the DOCK is documented under app-assistant) ─────
  { prefix: "/assistant", subject: "assistant-hub" },

  // ── Shell + config ─────────────────────────────────────────────────────────────────────────────
  { prefix: "/settings", subject: "settings-and-features" },
  // The home surface: a new operator landing here wants the tour and the vocabulary, which is DC-01
  // — not the Dashboard's own tab reference in DC-11.
  { prefix: "/dashboard", subject: "getting-started" },
];

/**
 * The guide URL the Help control opens for `pathname`.
 *
 * Always returns a usable route: a mapped subject, or the index. `/docs/*` itself maps to the index
 * so the control is never a no-op that leaves the reader where they already are.
 */
export function resolveHelpTarget(pathname: string): string {
  if (pathname === DOCS_ROUTE_BASE || pathname.startsWith(`${DOCS_ROUTE_BASE}/`)) {
    return DOCS_ROUTE_BASE;
  }
  for (const entry of HELP_MAP) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return `${DOCS_ROUTE_BASE}/${entry.subject}`;
    }
  }
  return DOCS_ROUTE_BASE;
}

/** True when `pathname` has a page of its own (rather than falling back to the index). */
export function hasDedicatedHelp(pathname: string): boolean {
  return resolveHelpTarget(pathname) !== DOCS_ROUTE_BASE;
}

/** The Help control's accessible name — the same string becomes its tooltip (D-TB5). */
export function helpButtonLabel(pathname: string): string {
  return hasDedicatedHelp(pathname)
    ? "Help — open the guide for this page"
    : "Help — open the user guide";
}

/** The changelog's route, linked from the guide index and the Help menu-less fallback copy. */
export const CHANGELOG_ROUTE = `${DOCS_ROUTE_BASE}/${CHANGELOG_SUBJECT_ID}`;
