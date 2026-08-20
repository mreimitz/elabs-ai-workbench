import type { MetricsBucket, ProviderKind, RunFilter, RunMetricsGroupBy } from "@mcp-token-footprint/shared";
import { serializeRunFilter } from "@mcp-token-footprint/shared";

/**
 * Testing dashboard — URL-persisted control state (WP 2.2). Pure, React-free (mirrors
 * `analytics-derive.ts`'s style) so the parse/serialize/filter-composition logic is unit-testable
 * without mounting anything. `TestingTab` is the only consumer; it owns the `useSearchParams()`
 * call and reads/writes through these helpers.
 *
 * Keys are namespaced (`t*`) so they coexist with the Dashboard host's own `?tab=` param
 * (`DashboardView.tsx`) and the shared `?range=` without collision.
 *
 * ── THE DATE WINDOW IS NO LONGER THIS MODULE'S (dashboard-bento WP 2.2) ──────────────────────────
 * `from`/`to` used to be persisted here as `?tFrom=`/`?tTo=`, driven by a `DateRangePicker` inside
 * the Testing tab's own toolbar band. The Dashboard now has ONE page-level range shared by Overview,
 * Testing and Issues (`features/dashboard/dashboard-range.ts`), so those two keys are gone from this
 * module: the window arrives as an argument and is copied onto the controls, and only the FACETS
 * (provider / server / environment / suite / model / group-by) round-trip through the URL here.
 * Legacy `?tFrom=`/`?tTo=` links still resolve — `dashboard-range.ts` reads them as a pinned custom
 * range, which is exactly what they always meant.
 */

/** The WP 2.2 spec's group-by control — a narrow, UI-facing subset of the full
 *  {@link RunMetricsGroupBy} vocabulary (which also allows `environment`/`test`/`skill`/
 *  `stopReasonCode`/`provider` — not offered in the global control). */
export type TestingGroupBy = Extract<RunMetricsGroupBy, "model" | "server" | "suite" | "providerKind">;

export const TESTING_GROUP_BY_OPTIONS: readonly TestingGroupBy[] = [
  "model",
  "server",
  "suite",
  "providerKind",
];

export const DEFAULT_TESTING_GROUP_BY: TestingGroupBy = "model";

const DEFAULT_WINDOW_DAYS = 7;

export type TestingDashboardControls = {
  /**
   * The page's shared window, inclusive. Supplied by the caller (`TestingTab`, from
   * `dashboard-range.ts`) as ISO-8601 **instants** — never parsed out of the URL here any more.
   *
   * A legacy date-only `YYYY-MM-DD` value is still accepted and expands to inclusive UTC day bounds
   * (see {@link metricsWindow}), which is what every panel test and every pre-WP-2.2 caller passes.
   */
  from: string;
  to: string;
  groupBy: TestingGroupBy;
  providerKind: ProviderKind[];
  serverId: string[];
  /** The "environment" filter dimension — wire name stays `scenarioId` (D-T rename: UI label only). */
  scenarioId: string[];
  suiteId: string | undefined;
  model: string[];
};

function isoDateOnly(d: Date): string {
  return (d.toISOString().split("T")[0] as string).slice(0, 10);
}

function isValidIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** The default control set: trailing 7 days, grouped by model, no dimension filters. */
export function defaultControls(now: Date = new Date()): TestingDashboardControls {
  const to = isoDateOnly(now);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));
  return {
    from: isoDateOnly(fromDate),
    to,
    groupBy: DEFAULT_TESTING_GROUP_BY,
    providerKind: [],
    serverId: [],
    scenarioId: [],
    suiteId: undefined,
    model: [],
  };
}

const KEYS = {
  groupBy: "tGroupBy",
  providerKind: "tProvider",
  serverId: "tServer",
  scenarioId: "tEnv",
  suiteId: "tSuite",
  model: "tModel",
} as const;

function parseList(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    ),
  ];
}

function isTestingGroupBy(value: string): value is TestingGroupBy {
  return (TESTING_GROUP_BY_OPTIONS as readonly string[]).includes(value);
}

/**
 * Parse the dashboard's URL-persisted FACETS, falling back to {@link defaultControls} field by field
 * (an absent/malformed value never throws — it just falls back).
 *
 * `range` is the page's shared window (WP 2.2). It is not read from `params` because it does not
 * live in this module's keys any more; omit it and the controls fall back to the trailing
 * {@link DEFAULT_WINDOW_DAYS}-day default, which is what the pure unit tests exercise.
 */
export function parseControlsFromSearchParams(
  params: URLSearchParams,
  now: Date = new Date(),
  range?: { from: string; to: string },
): TestingDashboardControls {
  const fallback = defaultControls(now);
  const groupByRaw = params.get(KEYS.groupBy);
  const suiteId = params.get(KEYS.suiteId);
  return {
    from: range?.from ?? fallback.from,
    to: range?.to ?? fallback.to,
    groupBy: groupByRaw && isTestingGroupBy(groupByRaw) ? groupByRaw : fallback.groupBy,
    providerKind: parseList(params.get(KEYS.providerKind)) as ProviderKind[],
    serverId: parseList(params.get(KEYS.serverId)),
    scenarioId: parseList(params.get(KEYS.scenarioId)),
    suiteId: suiteId && suiteId.length > 0 ? suiteId : undefined,
    model: parseList(params.get(KEYS.model)),
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined || value.length === 0) params.delete(key);
  else params.set(key, value);
}

/**
 * Write `controls` onto `params` (a COPY — the input is never mutated), omitting a field that's
 * empty/default so the common case stays a clean URL. The date window is deliberately NOT written:
 * it belongs to the page-level `?range=` param (`dashboard-range.ts`), which is the single place the
 * Dashboard's window is persisted.
 */
export function writeControlsToSearchParams(
  params: URLSearchParams,
  controls: TestingDashboardControls,
): URLSearchParams {
  const next = new URLSearchParams(params);
  setOrDelete(
    next,
    KEYS.groupBy,
    controls.groupBy === DEFAULT_TESTING_GROUP_BY ? undefined : controls.groupBy,
  );
  setOrDelete(
    next,
    KEYS.providerKind,
    controls.providerKind.length > 0 ? controls.providerKind.join(",") : undefined,
  );
  setOrDelete(next, KEYS.serverId, controls.serverId.length > 0 ? controls.serverId.join(",") : undefined);
  setOrDelete(
    next,
    KEYS.scenarioId,
    controls.scenarioId.length > 0 ? controls.scenarioId.join(",") : undefined,
  );
  setOrDelete(next, KEYS.suiteId, controls.suiteId);
  setOrDelete(next, KEYS.model, controls.model.length > 0 ? controls.model.join(",") : undefined);
  return next;
}

/** The dimension-only RunFilter (providerKind/server/environment/suite/model) — NO date bounds; the
 *  metrics endpoints take the window as separate `from`/`to` params (see {@link metricsWindow}), so
 *  folding dates in here too would AND the same bound twice (harmless but redundant). */
export function baseRunFilter(controls: TestingDashboardControls): RunFilter {
  const filter: RunFilter = {};
  if (controls.providerKind.length > 0) filter.providerKind = controls.providerKind;
  if (controls.serverId.length > 0) filter.serverId = controls.serverId;
  if (controls.scenarioId.length > 0) filter.scenarioId = controls.scenarioId;
  if (controls.suiteId !== undefined) filter.suiteId = controls.suiteId;
  if (controls.model.length > 0) filter.model = controls.model;
  return filter;
}

/**
 * The metrics window as inclusive ISO-8601 instants.
 *
 * An instant passes straight through — that is what the shared page range supplies, and re-deriving
 * day bounds from it would widen a "last 24 hours" window to two whole days, so the Overview's pass
 * rate and this tab's KPI row would be measuring different spans under one label.
 *
 * A legacy date-only `YYYY-MM-DD` bound (a pre-WP-2.2 caller, or a unit test) expands to inclusive
 * UTC day bounds, exactly as this function always did.
 */
export function metricsWindow(controls: TestingDashboardControls): { from: string; to: string } {
  return {
    from: isValidIsoDateOnly(controls.from) ? `${controls.from}T00:00:00.000Z` : controls.from,
    to: isValidIsoDateOnly(controls.to) ? `${controls.to}T23:59:59.999Z` : controls.to,
  };
}

/**
 * Whole days spanned by the window (inclusive of both ends — a same-day window is 1 day).
 *
 * Measured off {@link metricsWindow}'s resolved instants so it means the same thing for a shared
 * range and for a legacy date-only pair: a `2026-07-17`..`2026-07-17` day spans 86,399,999 ms, which
 * rounds to 1, and a trailing-24h instant window spans exactly 86,400,000 ms, which also rounds to 1.
 */
function windowDays(controls: TestingDashboardControls): number {
  const bounds = metricsWindow(controls);
  const ms = Date.parse(bounds.to) - Date.parse(bounds.from);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** Pick a sensible bucket granularity for the window span: hourly for a ≤2-day window (the "24h"
 *  preset), daily up to ~60 days (the "7d"/"30d" presets and most custom ranges), weekly beyond
 *  that — keeps a custom multi-month range from returning an unreadable wall of daily buckets. */
export function resolveBucket(controls: TestingDashboardControls): MetricsBucket {
  const days = windowDays(controls);
  if (days <= 2) return "hour";
  if (days <= 60) return "day";
  return "week";
}

/**
 * Compose the drill-down {@link RunFilter} for a chart interaction: the control bar's dimension
 * filter, the resolved date window (folded into `dateFrom`/`dateTo` — the ONLY way the runs feed's
 * `RunFilter` expresses a window), plus any extra per-chart dimension (`stopReasonCode`/`testId`/
 * `serverId`/`model`/…) the caller supplies. `extra` wins on key collision (e.g. a groupBy=server
 * chart drilling into one bar overrides the control bar's own `serverId` selection with the exact
 * bar's server).
 */
export function drillDownFilter(
  controls: TestingDashboardControls,
  extra?: Partial<RunFilter>,
): RunFilter {
  const window = metricsWindow(controls);
  return {
    ...baseRunFilter(controls),
    dateFrom: window.from,
    dateTo: window.to,
    ...extra,
  };
}

/** The runs-feed URL for a drill-down filter (WP 2.3 upgrades the feed to actually READ `filter=`;
 *  until then this is still a valid, correctly-composed link per the WP 2.2 spec). */
export function drillDownHref(filter: RunFilter): string {
  return `/testing/runs?filter=${encodeURIComponent(serializeRunFilter(filter))}`;
}

/** The `[start, end]` ISO-8601 instants a single time-series BUCKET spans, given its `bucketStart`
 *  (already a UTC bucket floor per the API — see `apps/api/src/observability/metrics.ts`
 *  `bucketStartUtc`) and the bucket granularity used for the query that produced it. Used to build a
 *  per-datapoint drill-down filter that scopes the runs feed to exactly that bar/point's window. */
export function bucketRangeIso(bucketStart: string, bucket: MetricsBucket): { from: string; to: string } {
  const start = new Date(bucketStart);
  const end = new Date(start);
  if (bucket === "hour") end.setUTCHours(end.getUTCHours() + 1);
  else if (bucket === "day") end.setUTCDate(end.getUTCDate() + 1);
  else end.setUTCDate(end.getUTCDate() + 7);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}
