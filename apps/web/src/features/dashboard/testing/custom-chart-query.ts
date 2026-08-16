import type { ProviderKind, RunFilter } from "@mcp-token-footprint/shared";
import { baseRunFilter, metricsWindow, type TestingDashboardControls } from "./dashboard-url-state";

/**
 * Custom chart composer (WP 2.7) — pure composition of the dashboard's GLOBAL control-bar filter with
 * a custom chart's OWN stored filter into ONE `RunFilter` (mirrors `dashboard-url-state.ts`'s style:
 * pure, React-free, independently unit-testable). This is the documented AND composition rule
 * (D-OB22 design note "chart-local filter COMPOSES with the global bar — AND"):
 *
 *  - The DATE WINDOW is ALWAYS the dashboard's global window (`dateFrom`/`dateTo`) — the composer's
 *    `RunFilterBar` never offers a `date` field (see ChartComposerDialog), so a chart's own filter
 *    never carries one; this field is simply not merged from either side.
 *  - LIST-valued dimension fields (status/outcome/stopReasonCode/phase/providerKind/model/serverId/
 *    scenarioId/skillId) INTERSECT when BOTH sides set them — the true AND of two `IN (...)`
 *    predicates over the same column. An empty intersection is a genuinely IMPOSSIBLE constraint
 *    (global says server ∈ {A}, chart says server ∈ {B} — no run can satisfy both); `RunFilter`
 *    treats a literal empty array as "unconstrained" rather than "matches nothing", so an impossible
 *    intersection is represented by {@link NEVER_MATCHES_SENTINEL}, an id no real row can carry.
 *  - NUMERIC RANGE pairs (score/cost/tokens/duration Gte/Lte) take the TIGHTER bound on each side
 *    (max of the two `*Gte`, min of the two `*Lte`) — the true AND of two inequalities.
 *  - Every remaining scalar/object field (suiteId, suiteRunId, testId, collectionId, seen,
 *    interactiveOnly, pinned, derived, grader, hasError, feedback, q) is a SINGLE value — `RunFilter`
 *    has no way to express "equals both X and Y" for those, so when both sides set one, the CHART'S
 *    OWN value wins (a documented, narrow exception to strict AND; in practice these fields are set
 *    on at most one side, since the global bar only ever sets the list-valued dimension fields above).
 */

/** A sentinel id no real row can ever carry — represents an impossible (empty-intersection) list
 *  constraint, since `RunFilter` treats a literal `[]` as "unconstrained", not "matches nothing". */
export const NEVER_MATCHES_SENTINEL = "__dashboard_chart_composer_never_matches__";

function intersectLists<T extends string>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const bSet = new Set(b);
  const intersection = a.filter((v) => bSet.has(v));
  return intersection.length > 0 ? intersection : ([NEVER_MATCHES_SENTINEL] as T[]);
}

function tighterGte(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function tighterLte(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Compose the dashboard's global control-bar filter (`baseRunFilter(controls)`) with a custom
 * chart's own stored `RunFilter` into ONE filter expressing their logical AND. Deliberately does NOT
 * touch `dateFrom`/`dateTo` (the composer's `RunFilterBar` never sets them on a chart's own filter,
 * and the global window is folded in separately by {@link composeChartRunFilterForControls}) — see
 * the module doc above for the exact per-field rule.
 */
export function composeChartRunFilter(global: RunFilter, chartFilter: RunFilter): RunFilter {
  return {
    ...global,
    ...chartFilter,
    status: intersectLists(global.status, chartFilter.status),
    outcome: intersectLists(global.outcome, chartFilter.outcome),
    stopReasonCode: intersectLists(global.stopReasonCode, chartFilter.stopReasonCode),
    phase: intersectLists(global.phase, chartFilter.phase),
    providerKind: intersectLists(global.providerKind, chartFilter.providerKind) as
      | ProviderKind[]
      | undefined,
    model: intersectLists(global.model, chartFilter.model),
    serverId: intersectLists(global.serverId, chartFilter.serverId),
    scenarioId: intersectLists(global.scenarioId, chartFilter.scenarioId),
    skillId: intersectLists(global.skillId, chartFilter.skillId),
    scoreGte: tighterGte(global.scoreGte, chartFilter.scoreGte),
    scoreLte: tighterLte(global.scoreLte, chartFilter.scoreLte),
    costUsdGte: tighterGte(global.costUsdGte, chartFilter.costUsdGte),
    costUsdLte: tighterLte(global.costUsdLte, chartFilter.costUsdLte),
    tokensGte: tighterGte(global.tokensGte, chartFilter.tokensGte),
    tokensLte: tighterLte(global.tokensLte, chartFilter.tokensLte),
    durationMsGte: tighterGte(global.durationMsGte, chartFilter.durationMsGte),
    durationMsLte: tighterLte(global.durationMsLte, chartFilter.durationMsLte),
  };
}

/** Build the composed `RunFilter` for a `source: "runs"` custom chart panel/preview, from the
 *  dashboard's current global controls + the chart's own stored filter. */
export function composeChartRunFilterForControls(
  controls: TestingDashboardControls,
  chartFilter: RunFilter,
): RunFilter {
  const window = metricsWindow(controls);
  return {
    ...composeChartRunFilter(baseRunFilter(controls), chartFilter),
    dateFrom: window.from,
    dateTo: window.to,
  };
}

/**
 * The `serverId` scope for a `source: "scans"` custom chart — `computeScanMetrics` only accepts a
 * SINGLE optional `serverId` (it is already grouped by server), so this is a scalar composition, not
 * a list intersection: the chart's own `serverId` wins when set; otherwise, if the global control bar
 * has EXACTLY ONE server selected, that single server scopes the chart too (an unscoped chart with a
 * multi-server or empty global selection shows ALL servers — scan metrics aren't run-scoped, so the
 * global bar's other dimensions never apply to a scans chart).
 */
export function composeChartScanServerId(
  controls: TestingDashboardControls,
  chartServerId: string | undefined,
): string | undefined {
  if (chartServerId !== undefined) return chartServerId;
  return controls.serverId.length === 1 ? controls.serverId[0] : undefined;
}
