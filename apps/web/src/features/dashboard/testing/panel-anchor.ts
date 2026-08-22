/**
 * Testing dashboard — the PANEL ADDRESS (RM-17 AM-OB3). Pure, React-free (same shape as
 * `dashboard-url-state.ts`) so the id/link composition is unit-testable without mounting anything;
 * the React half — the provider, the copy affordance and the scroll-on-load — lives in
 * `panel-shell.tsx`, the module that already owns panel framing.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────────────────────
 * Everything ABOUT the dashboard was already addressable before this WP: the tab (`?tab=`), the
 * page-wide window (`?range=`, shared by all three tabs), the six Testing facets (`?tGroupBy=`,
 * `?tProvider=`, `?tServer=`, `?tEnv=`, `?tSuite=`, `?tModel=`), the Issues detail sheet (`?issue=`)
 * and a chart click, which navigates to `/testing/runs?filter=…` carrying the exact clicked bucket.
 * What no URL could say was WHICH PANEL — the Testing tab is a long scrolling column, so "look at
 * the cache panel" meant "scroll down, about two thirds, the one with the two token series".
 *
 * `?panel=<id>` closes exactly that: it names one panel, and the panel that recognises its own id
 * scrolls itself into view and marks itself. It is one more key alongside the ones above, never a
 * replacement for any of them — a copied link carries the whole set, so the reader lands on the same
 * tab, the same window, the same facets AND the right panel.
 *
 * ── WHY AN UNKNOWN ID IS SILENT ──────────────────────────────────────────────────────────────────
 * There is deliberately NO registry lookup and no validation on read. A `?panel=` naming a panel
 * that was renamed, removed, or belongs to a deleted custom chart simply matches nothing, so nothing
 * scrolls and nothing is highlighted — the tab, the range and the facets are untouched. Validating
 * it would only buy the ability to throw away a param, which is strictly worse than ignoring it.
 *
 * ── NOT `features/testing/console-anchors.ts` ────────────────────────────────────────────────────
 * The run console has its own anchor layer, and it answers a different question: it links panes
 * WITHIN one already-mounted console, keyed by a `ConsoleNavRef` over turns and tool calls, resolved
 * by an attribute walk inside a given container, with a transient flash. None of it is addressable
 * from outside the page. Widening it to also mean "a dashboard panel named in the URL" would make a
 * run-console module know about dashboard panels; this stays a separate, much smaller vocabulary.
 */

/** The URL key. Namespaced alongside `?tab=` / `?range=` / the `t*` facets, like `?issue=` is. */
export const DASHBOARD_PANEL_PARAM = "panel";

/**
 * The prebuilt Testing-tab panels' stable ids. Stable is the whole point — an id is what a shared
 * link says, so renaming one silently breaks every link anyone sent. Add an entry when you add a
 * panel; never re-point an existing one at a different panel.
 */
export const DASHBOARD_PANEL_IDS = {
  runsErrorRate: "runs-error-rate",
  guardrailStops: "guardrail-stops",
  duration: "duration",
  tokens: "tokens",
  cache: "cache",
  cost: "cost",
  scoreTrend: "score-trend",
  leaderboards: "leaderboards",
  scans: "scans",
} as const;

export type DashboardPanelId = (typeof DASHBOARD_PANEL_IDS)[keyof typeof DASHBOARD_PANEL_IDS];

/** Custom charts inherit the anchor for free by using their PERSISTED row id as the panel key — so a
 *  custom chart's link survives a reload, a reorder and a rename, and only dies with the chart. */
export const CUSTOM_CHART_PANEL_PREFIX = "chart-";

export function customChartPanelId(chartId: string): string {
  return `${CUSTOM_CHART_PANEL_PREFIX}${chartId}`;
}

/** The DOM id a panel renders. Prefixed so it cannot collide with an unrelated element id. */
export function panelDomId(panelId: string): string {
  return `dashboard-panel-${panelId}`;
}

/**
 * The current view's search params PLUS the panel anchor — a copy, the input is never mutated.
 *
 * Everything else rides along untouched on purpose: the point of the copied link is that the reader
 * sees what the sender sees, which is the tab, the window and the facets as well as the panel.
 */
export function withPanelParam(params: URLSearchParams, panelId: string): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(DASHBOARD_PANEL_PARAM, panelId);
  return next;
}

/** `pathname` + the anchored query, as a path (no origin). The absolute form is composed by the
 *  caller, which is the only place that knows whether a `window` exists. */
export function panelLinkPath(pathname: string, params: URLSearchParams, panelId: string): string {
  const query = withPanelParam(params, panelId).toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}
