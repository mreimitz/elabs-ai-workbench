import type { MetricsBucket, ProviderKind, RunFilter, RunMetricsGroupBy } from "@mcp-token-footprint/shared";
import { serializeRunFilter } from "@mcp-token-footprint/shared";

/**
 * Testing dashboard — URL-persisted control state (WP 2.2). Pure, React-free (mirrors
 * `analytics-derive.ts`'s style) so the parse/serialize/filter-composition logic is unit-testable
 * without mounting anything. `TestingTab` is the only consumer; it owns the `useSearchParams()`
 * call and reads/writes through these helpers.
 *
 * Keys are namespaced (`t*`) so they coexist with the Dashboard host's own `?tab=` param
 * (`DashboardView.tsx`) and any future Scans-tab URL state without collision.
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
  /** Inclusive ISO date-only (`YYYY-MM-DD`) lower/upper bound — always resolved (never unbounded);
   *  the default window is the trailing {@link DEFAULT_WINDOW_DAYS} days ending today. */
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
  from: "tFrom",
  to: "tTo",
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

/** Parse the dashboard's URL-persisted controls, falling back to {@link defaultControls} field by
 *  field (an absent/malformed value never throws — it just falls back). */
export function parseControlsFromSearchParams(
  params: URLSearchParams,
  now: Date = new Date(),
): TestingDashboardControls {
  const fallback = defaultControls(now);
  const from = params.get(KEYS.from);
  const to = params.get(KEYS.to);
  const groupByRaw = params.get(KEYS.groupBy);
  const suiteId = params.get(KEYS.suiteId);
  return {
    from: from && isValidIsoDateOnly(from) ? from : fallback.from,
    to: to && isValidIsoDateOnly(to) ? to : fallback.to,
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
 * empty/default so the common case stays a clean URL. `from`/`to` are always written once resolved
 * (they "lock in" the window into a shareable link rather than silently drifting with "today").
 */
export function writeControlsToSearchParams(
  params: URLSearchParams,
  controls: TestingDashboardControls,
): URLSearchParams {
  const next = new URLSearchParams(params);
  setOrDelete(next, KEYS.from, controls.from);
  setOrDelete(next, KEYS.to, controls.to);
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

/** The metrics window as inclusive ISO-8601 instants (`from` = start of day, `to` = end of day). */
export function metricsWindow(controls: TestingDashboardControls): { from: string; to: string } {
  return {
    from: `${controls.from}T00:00:00.000Z`,
    to: `${controls.to}T23:59:59.999Z`,
  };
}

/** Whole days spanned by the window (inclusive of both ends — a same-day window is 1 day). */
function windowDays(controls: TestingDashboardControls): number {
  const ms = Date.parse(`${controls.to}T00:00:00.000Z`) - Date.parse(`${controls.from}T00:00:00.000Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
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
