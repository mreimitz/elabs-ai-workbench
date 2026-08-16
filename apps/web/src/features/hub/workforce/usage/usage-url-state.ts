import { HUB_USAGE_GROUP_BYS, type HubUsageGroupBy } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub UX WP2.6 (D-HUX10) — URL-persisted control state for the workforce Usage tab, pure
 * and React-free (mirrors `features/dashboard/testing/dashboard-url-state.ts`'s style so the parse/
 * serialize logic is unit-testable without mounting anything). `UsageTab.tsx` is the only consumer;
 * it owns the single `useSearchParams()` call and reads/writes through these helpers.
 *
 * Keys are namespaced (`u*`) so they coexist with `WorkforceView`'s own `tab`/`scope`/`settings`
 * params on the same URL (e.g. `/assistant/agents?tab=usage&uGroupBy=crew&uProject=proj_1`).
 *
 * RANGE SEMANTICS: unlike the Testing dashboard's control set (which always resolves a trailing
 * window), an ABSENT `from`/`to` here is a genuine, first-class "all time" selection — the same
 * convention `AuditView`/`SessionsView` already use for their own `DateRangePicker`s (placeholder
 * "All time", `dateRange === undefined`). `/api/hub/usage/rollup` accepts optional `from`/`to`, so
 * "all time" is a real, honestly-labeled server query, not a client-side illusion.
 */

export type UsageControls = {
  /** Inclusive ISO date-only (`YYYY-MM-DD`) lower/upper bound. Both absent = all time. */
  from: string | undefined;
  to: string | undefined;
  groupBy: HubUsageGroupBy;
  /** The single narrowable server-side filter `/api/hub/usage/rollup` accepts (D-HUX10's `projectId`
   *  — see the module doc on why this is the only dimension the "row → narrow filter" drill can be
   *  backed by honestly: `agent`/`crew`/`model`/`mode` have no such query param on the rollup route). */
  projectId: string | undefined;
};

export const DEFAULT_USAGE_GROUP_BY: HubUsageGroupBy = "agent";

export function defaultUsageControls(): UsageControls {
  return { from: undefined, to: undefined, groupBy: DEFAULT_USAGE_GROUP_BY, projectId: undefined };
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isHubUsageGroupBy(value: string): value is HubUsageGroupBy {
  return (HUB_USAGE_GROUP_BYS as readonly string[]).includes(value);
}

const KEYS = {
  from: "uFrom",
  to: "uTo",
  groupBy: "uGroupBy",
  projectId: "uProject",
} as const;

/** Parses the tab's URL-persisted controls; an absent/malformed value falls back to
 *  {@link defaultUsageControls} field-by-field (never throws). */
export function parseUsageControlsFromSearchParams(params: URLSearchParams): UsageControls {
  const fallback = defaultUsageControls();
  const from = params.get(KEYS.from);
  const to = params.get(KEYS.to);
  const groupByRaw = params.get(KEYS.groupBy);
  const projectId = params.get(KEYS.projectId);
  return {
    from: from && isIsoDateOnly(from) ? from : fallback.from,
    to: to && isIsoDateOnly(to) ? to : fallback.to,
    groupBy: groupByRaw && isHubUsageGroupBy(groupByRaw) ? groupByRaw : fallback.groupBy,
    projectId: projectId && projectId.length > 0 ? projectId : fallback.projectId,
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined || value.length === 0) params.delete(key);
  else params.set(key, value);
}

/** Writes `controls` onto a COPY of `params` (input never mutated), omitting a field at its default
 *  so the common ("all time", grouped by agent, no project narrow) case stays a clean URL — a
 *  narrowed/regrouped/dated view still round-trips exactly (shareable per D-HUX10). */
export function writeUsageControlsToSearchParams(
  params: URLSearchParams,
  controls: UsageControls,
): URLSearchParams {
  const next = new URLSearchParams(params);
  setOrDelete(next, KEYS.from, controls.from);
  setOrDelete(next, KEYS.to, controls.to);
  setOrDelete(
    next,
    KEYS.groupBy,
    controls.groupBy === DEFAULT_USAGE_GROUP_BY ? undefined : controls.groupBy,
  );
  setOrDelete(next, KEYS.projectId, controls.projectId);
  return next;
}

/** The `/api/hub/usage/rollup` + `/api/hub/usage` query shape for the current controls. */
export function usageRangeQuery(controls: UsageControls): {
  from?: string;
  to?: string;
  projectId?: string;
} {
  return {
    ...(controls.from ? { from: controls.from } : {}),
    ...(controls.to ? { to: controls.to } : {}),
    ...(controls.projectId ? { projectId: controls.projectId } : {}),
  };
}

const MIN_SUMMARY_DAYS = 1;
const MAX_SUMMARY_DAYS = 90;
const DEFAULT_SUMMARY_DAYS = 30;

/**
 * The `days` window to request from `/api/hub/usage/summary` for the stacked-over-time chart, sized
 * to the selected range's SPAN (clamped to the route's [1, 90] bound) — or the 30-day default when
 * no range is selected. NOTE (flagged WP1.6 API gap): `/summary` has no `to` parameter — its window
 * always ENDS TODAY (real wall-clock "now"), so a range with a `to` in the past only matches this
 * chart's span, not its exact historical end date; the KPI row and ranked table (both backed by
 * `/rollup`, which DOES take `from`/`to`) stay exact for any range.
 */
export function summaryDaysFor(controls: UsageControls): number {
  if (!controls.from && !controls.to) return DEFAULT_SUMMARY_DAYS;
  const fromMs = controls.from ? Date.parse(`${controls.from}T00:00:00.000Z`) : undefined;
  // Start-of-day for BOTH ends (mirrors `dashboard/testing/dashboard-url-state.ts`'s `windowDays`) —
  // an end-of-day `to` would inflate a same-day-inclusive span by an extra fractional day before
  // rounding (e.g. "2026-06-01".."2026-06-10" is 10 calendar days, not 11).
  const toMs = controls.to ? Date.parse(`${controls.to}T00:00:00.000Z`) : Date.now();
  if (fromMs === undefined || Number.isNaN(fromMs) || Number.isNaN(toMs))
    return DEFAULT_SUMMARY_DAYS;
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  return Math.min(MAX_SUMMARY_DAYS, Math.max(MIN_SUMMARY_DAYS, days));
}
