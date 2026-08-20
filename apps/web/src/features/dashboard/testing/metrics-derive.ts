import type {
  DashboardChartScanMeasure,
  ProviderKind,
  RunMetricsGroupBy,
  RunMetricsMeasure,
  RunMetricsSeries,
  RunSummary,
  ScanMetricsPoint,
  ScanMetricsSeries,
  Scenario,
  SessionCostBasis,
  SessionTokenAccounting,
  Test,
} from "@mcp-token-footprint/shared";
import { PROVIDER_KINDS, providerKindLabel } from "@mcp-token-footprint/shared";
import type { TestingGroupBy } from "./dashboard-url-state";

/**
 * Pure derivation layer for the Testing dashboard (WP 2.2) — ALL aggregation/reshaping of
 * `GET /api/metrics/{runs,scans}` responses into chart-ready rows lives here, typed and
 * React-free, mirroring `features/testing/analytics-derive.ts`'s style so the panel components stay
 * presentational. Nothing here fabricates a figure or blends a capability class (D-OB14): a bucket
 * with no data for a series is simply OMITTED from that series' points, never zero-filled, and a
 * capability-split measure (`tokensIn`/`tokensOut`/`costUsd`/`questions`) is always kept as SEPARATE
 * per-class rows — this module never sums across classes into a combined figure.
 */

// ── Small shared helpers ─────────────────────────────────────────────────────────────────────────

/** One pivoted chart row: a bucket's timestamp plus one numeric field per series key present in
 *  that bucket (a key absent from a bucket is OMITTED from the row — never zero-filled). */
export type PivotedRow = { bucketStart: string; x: Date; [seriesKey: string]: unknown };

/**
 * The `bucketStart` of the {@link PivotedRow} a chart datapoint came from.
 *
 * `@elabs-ai/components-charts` hands `onDatapointClick` the RAW data row it plotted (`datum`), typed as
 * `Record<string, unknown>`. Every row this module builds — for the time-scale charts AND for the
 * categorical `BarChart` variants, which only decorate a pivoted row with a `bucketLabel` — carries
 * `bucketStart`, so one narrowing lives here instead of once per panel. Returns `undefined` for
 * anything that is not one of our rows, so a panel can bail out instead of navigating somewhere
 * fabricated.
 */
export function datapointBucketStart(datum: unknown): string | undefined {
  if (typeof datum !== "object" || datum === null) return undefined;
  const value = (datum as { bucketStart?: unknown }).bucketStart;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A named points list this module derives from a `RunMetricsSeries`/`ScanMetricsSeries` slice —
 *  the common shape every "pivot to chart rows" helper below consumes. */
export type NamedPoints = { key: string; label: string; points: { bucketStart: string; value: number }[] };

/** Pivot N named point-lists that share a bucket axis into wide rows keyed by `key`, ascending by
 *  bucket. A series lacking a value for a given bucket leaves that bucket's key OMITTED (never 0).
 *
 *  Every row carries `x: Date` (the API emits `bucketStart` as an ISO-8601 string — see
 *  `bucketStartUtc`), which is what the time-scale charts (`Line`/`Area`/`ComposedChart`, fed
 *  `xDataKey="x"`) require. DEFENSIVE GUARD: a bucketStart that `new Date()` can't parse would yield an
 *  Invalid Date, and a time-scale axis calling `.toISOString()` on it throws "Invalid time value" —
 *  crashing the whole panel. Such a bucket is SKIPPED here (degrade one bad point, never take down the
 *  dashboard) rather than propagated as an Invalid Date. In practice the API never emits one; this is
 *  belt-and-suspenders against a malformed response. */
export function pivotToRows(series: NamedPoints[]): PivotedRow[] {
  const bucketStarts = [...new Set(series.flatMap((s) => s.points.map((p) => p.bucketStart)))].sort();
  const rows: PivotedRow[] = [];
  for (const bucketStart of bucketStarts) {
    const x = new Date(bucketStart);
    if (Number.isNaN(x.getTime())) continue; // unparseable bucket → skip, never feed an Invalid Date to a chart
    const row: PivotedRow = { bucketStart, x };
    for (const s of series) {
      const point = s.points.find((p) => p.bucketStart === bucketStart);
      if (point !== undefined) row[s.key] = point.value;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Weighted-average a RATE measure (`value = numerator / n`) across several series that share a
 * bucket axis but differ in another dimension (e.g. one series per `groupBy` value) — reconstructs
 * each bucket's numerator as `value * n` (both are exact integer ratios from the API, so this is
 * lossless up to floating-point rounding, corrected with `Math.round`). Used for an "overall" rate
 * line alongside a per-group breakdown, and for collapsing a leaderboard's per-group series across
 * ALL its (coarse) buckets into one window-wide rate.
 */
export function weightedRateByKey<K extends string>(
  series: { key: K; points: { bucketStart: string; value: number; n: number }[] }[],
  keyOf: (bucketStart: string) => string,
): Map<string, { value: number; n: number }> {
  const acc = new Map<string, { numerator: number; n: number }>();
  for (const s of series) {
    for (const p of s.points) {
      const k = keyOf(p.bucketStart);
      const entry = acc.get(k) ?? { numerator: 0, n: 0 };
      entry.numerator += Math.round(p.value * p.n);
      entry.n += p.n;
      acc.set(k, entry);
    }
  }
  const out = new Map<string, { value: number; n: number }>();
  for (const [k, entry] of acc) out.set(k, { value: entry.n > 0 ? entry.numerator / entry.n : 0, n: entry.n });
  return out;
}

/** Snake/camel-ish machine id → a readable label ("max_turns" → "Max turns"). Fallback humanizer for
 *  any vocabulary this module has no explicit label map for. */
export function humanize(id: string): string {
  const spaced = id.replace(/[_-]+/g, " ").trim();
  return spaced.length > 0 ? spaced[0]?.toUpperCase() + spaced.slice(1) : id;
}

/**
 * Provider-kind display labels — `FilterControls.tsx`'s facet options AND the
 * `groupBy="providerKind"` label resolver below both read this.
 *
 * D-MI6 (`planning/Roadmap/RM-16-model-identity/`, WP 2.3): this is now a **derived projection** of the one
 * registry in `packages/shared` (`PROVIDER_KIND_META` / {@link providerKindLabel}), not a
 * hand-written vocabulary. It authors no strings, so it cannot drift from Settings / the Hub
 * picker / the Environment views the way the map it replaced did. The symbol name is kept so
 * existing importers are untouched; new code should prefer `providerKindLabel(kind)` directly.
 */
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = Object.fromEntries(
  PROVIDER_KINDS.map((kind) => [kind, providerKindLabel(kind)]),
) as Record<ProviderKind, string>;

/** A group-key → human-label resolver for whichever dimension `groupBy` currently is. `model` and
 *  `providerKind` group values are already-human strings (a model id / a `ProviderKind` literal);
 *  `server`/`suite` group values are opaque ids that need the catalog lookup the caller supplies. */
export function makeGroupLabelResolver(
  groupBy: TestingGroupBy,
  catalog: { serverName: (id: string) => string; suiteName: (id: string) => string },
): (group: string) => string {
  switch (groupBy) {
    case "model":
      return (group) => group;
    case "providerKind":
      return (group) => PROVIDER_KIND_LABELS[group as ProviderKind] ?? group;
    case "server":
      return catalog.serverName;
    case "suite":
      return catalog.suiteName;
  }
}

// ── Panel 1 — Runs & error rate over time ───────────────────────────────────────────────────────

export type RunsOverTimeResult = {
  rows: PivotedRow[];
  /** The distinct `groupBy` values present, sorted by total run count descending (stable render/legend order). */
  groups: string[];
  /** True when there is at least one run count in the window (drives the panel's empty state). */
  hasData: boolean;
};

/**
 * Panel 1: `count` (grouped by the dashboard's global `groupBy`) stacked per bucket, plus an
 * OVERALL error-rate line (weighted across every group so it reads as the window's true rate, not
 * one group's). Both measures come from ONE `groupBy=<control>` request (`measures=count,errorRate`).
 */
export function buildRunsOverTimeRows(series: RunMetricsSeries[]): RunsOverTimeResult {
  const countSeries = series.filter((s) => s.measure === "count" && s.group !== null);
  const errorRateSeries = series.filter((s) => s.measure === "errorRate");

  const totalsByGroup = new Map<string, number>();
  for (const s of countSeries) {
    const group = s.group as string;
    const total = s.points.reduce((sum, p) => sum + p.value, 0);
    totalsByGroup.set(group, (totalsByGroup.get(group) ?? 0) + total);
  }
  const groups = [...totalsByGroup.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);

  const named: NamedPoints[] = countSeries.map((s) => ({
    key: s.group as string,
    label: s.group as string,
    points: s.points,
  }));
  const rows = pivotToRows(named);

  const overallErrorRate = weightedRateByKey(
    errorRateSeries.map((s) => ({ key: "errorRate", points: s.points })),
    (bucketStart) => bucketStart,
  );
  for (const row of rows) {
    const rate = overallErrorRate.get(row.bucketStart);
    row.errorRatePercent = (rate?.value ?? 0) * 100;
  }

  return { rows, groups, hasData: groups.length > 0 && rows.length > 0 };
}

// ── Panel 2 — Guardrail stops by stopReasonCode (stacked) ──────────────────────────────────────

export type GuardrailStopsResult = {
  rows: PivotedRow[];
  codes: string[];
  labels: Record<string, string>;
  hasData: boolean;
};

/** Panel 2: `count` grouped by `stopReasonCode`, pivoted into stacked-bar rows. Stacking here is
 *  legitimate (unlike a capability-class chart) — it is EXPLICITLY the requested visualization
 *  (a total-stops bar broken into its reasons), not a blend across an accounting-fidelity boundary. */
export function buildGuardrailStopRows(series: RunMetricsSeries[]): GuardrailStopsResult {
  const codeSeries = series.filter((s) => s.measure === "count" && s.group !== null);
  const codes = [...new Set(codeSeries.map((s) => s.group as string))].sort(
    (a, b) => codeSeries.filter((s) => s.group === b).reduce((sum, s) => sum + s.points.reduce((n, p) => n + p.value, 0), 0) -
      codeSeries.filter((s) => s.group === a).reduce((sum, s) => sum + s.points.reduce((n, p) => n + p.value, 0), 0),
  );
  const labels = Object.fromEntries(codes.map((c) => [c, humanize(c)]));
  const rows = pivotToRows(codeSeries.map((s) => ({ key: s.group as string, label: humanize(s.group as string), points: s.points })));
  return { rows, codes, labels, hasData: codes.length > 0 && rows.length > 0 };
}

// ── Panel 3 — Duration p50/p95 ──────────────────────────────────────────────────────────────────

export type DurationResult = {
  rows: PivotedRow[];
  /** True when ANY bucket in EITHER series fell back to `totalDurationMs` (D-US3 — MARK, never hide). */
  fallbackUsed: boolean;
  /** The latest bucket's p95, for the KPI header (reuses this fetch — no extra call). `null` if none. */
  latestP95: number | null;
  hasData: boolean;
};

/** Panel 3: `p50DurationMs` + `p95DurationMs`, ungrouped (ACTIVE duration per D-US3; a fallback to
 *  wall-clock `totalDurationMs` is marked, never silently hidden — mirrors `AnalyticsPanel`). */
export function buildDurationRows(series: RunMetricsSeries[]): DurationResult {
  const p50 = series.find((s) => s.measure === "p50DurationMs");
  const p95 = series.find((s) => s.measure === "p95DurationMs");
  const named: NamedPoints[] = [];
  if (p50) named.push({ key: "p50", label: "p50", points: p50.points });
  if (p95) named.push({ key: "p95", label: "p95", points: p95.points });
  const rows = pivotToRows(named);
  const fallbackUsed = Boolean(p50?.durationFallback) || Boolean(p95?.durationFallback);
  const latestP95 = p95 && p95.points.length > 0 ? (p95.points[p95.points.length - 1]?.value ?? null) : null;
  return { rows, fallbackUsed, latestP95, hasData: rows.length > 0 };
}

// ── Panel 4 / 5 — Capability-split measures (tokens / cost) — D-OB14, NEVER blended ───────────────

export type CapabilityClassSeries = {
  /** The capability class id (`SessionTokenAccounting`/`SessionCostBasis`/`"questions"`). */
  cls: string;
  label: string;
  points: { bucketStart: string; value: number }[];
  /** This class's OWN total — never summed with another class's total anywhere in this module. */
  total: number;
};

// Exported (additive, WP 2.7) so the custom chart composer's generic renderer can label a capability
// class identically to the prebuilt Tokens/Cost panels, without redefining the map.
export const TOKEN_CLASS_LABELS: Record<SessionTokenAccounting, string> = {
  exact: "Exact (provider-metered)",
  none: "Not measured",
};

export const COST_CLASS_LABELS: Record<Exclude<SessionCostBasis, "questions">, string> = {
  api_exact: "$ Exact (API-metered)",
  subscription_reference: "$ Est. (subscription reference)",
  none: "Not priced",
};

/**
 * Extract ONE `CapabilityClassSeries` per capability class PRESENT for `measure` — D-OB14: classes
 * are NEVER merged. `labels` maps a known class id to a human label; an unknown id falls back to
 * {@link humanize}. Callers render one chart series per returned entry (grouped, never stacked, so
 * no visual sum implies a blended total either).
 */
export function buildCapabilityClassSeries(
  series: RunMetricsSeries[],
  measure: RunMetricsMeasure,
  labels: Record<string, string>,
): CapabilityClassSeries[] {
  return series
    .filter((s): s is RunMetricsSeries & { capabilityClass: string } => s.measure === measure && s.capabilityClass !== null)
    .map((s) => ({
      cls: s.capabilityClass,
      label: labels[s.capabilityClass] ?? humanize(s.capabilityClass),
      points: s.points.map((p) => ({ bucketStart: p.bucketStart, value: p.value })),
      total: s.points.reduce((sum, p) => sum + p.value, 0),
    }))
    .sort((a, b) => b.total - a.total);
}

export type TokensResult = {
  inRows: PivotedRow[];
  outRows: PivotedRow[];
  inClasses: CapabilityClassSeries[];
  outClasses: CapabilityClassSeries[];
  hasData: boolean;
};

/** Panel 4: `tokensIn`/`tokensOut`, each split into its present capability classes. */
export function buildTokensResult(series: RunMetricsSeries[]): TokensResult {
  const inClasses = buildCapabilityClassSeries(series, "tokensIn", TOKEN_CLASS_LABELS);
  const outClasses = buildCapabilityClassSeries(series, "tokensOut", TOKEN_CLASS_LABELS);
  const inRows = pivotToRows(inClasses.map((c) => ({ key: c.cls, label: c.label, points: c.points })));
  const outRows = pivotToRows(outClasses.map((c) => ({ key: c.cls, label: c.label, points: c.points })));
  return { inRows, outRows, inClasses, outClasses, hasData: inClasses.length > 0 || outClasses.length > 0 };
}

export type CostResult = {
  costRows: PivotedRow[];
  costClasses: CapabilityClassSeries[];
  hasData: boolean;
};

/** Panel 5: `costUsd` split by cost-basis — its own grouped, un-stacked series per class, never a
 *  blended total across classes. */
export function buildCostResult(series: RunMetricsSeries[]): CostResult {
  const costClasses = buildCapabilityClassSeries(series, "costUsd", COST_CLASS_LABELS);
  const costRows = pivotToRows(costClasses.map((c) => ({ key: c.cls, label: c.label, points: c.points })));
  return { costRows, costClasses, hasData: costClasses.length > 0 };
}

// ── Panel 6 — Score trend ───────────────────────────────────────────────────────────────────────

export type ScoreTrendResult = { rows: PivotedRow[]; hasData: boolean };

/** Panel 6: `meanScore`, ungrouped. The API's `meanScore` measure already resolves the
 *  latest-per-grader → primary-priority-grader score chain server-side (mirrors suite analytics'
 *  mean-grade selection) — there is no per-grader breakdown to expose here. */
export function buildScoreTrendRows(series: RunMetricsSeries[]): ScoreTrendResult {
  const scoreSeries = series.find((s) => s.measure === "meanScore");
  const rows = scoreSeries
    ? pivotToRows([{ key: "meanScore", label: "Mean score", points: scoreSeries.points }])
    : [];
  return { rows, hasData: rows.length > 0 };
}

// ── Panel 7 — Leaderboards ──────────────────────────────────────────────────────────────────────

export type FailingLeaderboardRow = { group: string; label: string; count: number; errorCount: number; errorRate: number };

/**
 * Panel 7 (a/b): the top-N groups (tests or servers) by error COUNT within the window — a
 * non-bucketed `groupBy=test|server` query (`measures=count,errorRate`) collapsed across whatever
 * (coarse) buckets the request returned. Only groups with at least one error are returned (honest —
 * a clean group simply doesn't appear, never a 0-row).
 */
export function buildFailingLeaderboard(
  series: RunMetricsSeries[],
  labelOf: (group: string) => string,
  limit = 8,
): FailingLeaderboardRow[] {
  const countSeries = series.filter((s) => s.measure === "count" && s.group !== null);
  const errorRateSeries = series.filter((s) => s.measure === "errorRate" && s.group !== null);

  const counts = new Map<string, number>();
  for (const s of countSeries) {
    const group = s.group as string;
    counts.set(group, (counts.get(group) ?? 0) + s.points.reduce((sum, p) => sum + p.value, 0));
  }
  const errors = new Map<string, { numerator: number; n: number }>();
  for (const s of errorRateSeries) {
    const group = s.group as string;
    const acc = errors.get(group) ?? { numerator: 0, n: 0 };
    for (const p of s.points) {
      acc.numerator += Math.round(p.value * p.n);
      acc.n += p.n;
    }
    errors.set(group, acc);
  }

  const rows: FailingLeaderboardRow[] = [];
  for (const [group, count] of counts) {
    const err = errors.get(group);
    const errorCount = err?.numerator ?? 0;
    if (errorCount <= 0) continue;
    rows.push({
      group,
      label: labelOf(group),
      count,
      errorCount,
      errorRate: err && err.n > 0 ? err.numerator / err.n : 0,
    });
  }
  return rows.sort((a, b) => b.errorCount - a.errorCount || b.errorRate - a.errorRate).slice(0, limit);
}

export type ExpensiveRunRow = {
  runId: string;
  label: string;
  scenarioName: string;
  costUsd: number;
  startedAt: string;
  testId: string;
  scenarioId: string;
};

/** Panel 7 (c): the top-N most expensive runs (already sorted server-side), joined against the
 *  tests/scenarios catalog for a readable label. A missing catalog entry degrades to the raw id
 *  (never a blank/broken row). */
export function buildExpensiveRunRows(
  runs: RunSummary[],
  testsById: Map<string, Test>,
  scenariosById: Map<string, Scenario>,
): ExpensiveRunRow[] {
  return runs.map((run) => ({
    runId: run.id,
    label: testsById.get(run.testId)?.name ?? `Test ${run.testId}`,
    scenarioName: scenariosById.get(run.scenarioId)?.name ?? run.scenarioId,
    costUsd: run.costUsd,
    startedAt: run.startedAt,
    testId: run.testId,
    scenarioId: run.scenarioId,
  }));
}

// ── Panel 8 — Scans strip (footprint tokens over time, per server) ─────────────────────────────

export type ScansStripSeries = { serverId: string; serverName: string; points: { bucketStart: string; value: number }[] };
export type ScansStripResult = { rows: PivotedRow[]; series: ScansStripSeries[]; hasData: boolean };

/** Panel 8: whole-surface `totalTokens` (tools+resources+prompts) per server, over time — the
 *  representative (latest-success) scan per bucket. A bucket with no successful scan is OMITTED
 *  (never zero-filled — mirrors the API's own honesty guard on `totalTokens: null`). */
export function buildScansStripResult(series: ScanMetricsSeries[]): ScansStripResult {
  // Multiple token profiles for the same server would double-plot it; keep the profile with the
  // most points (the one actually being scanned regularly) per server — still never blended (each
  // server stays its own series either way).
  const bestByServer = new Map<string, ScanMetricsSeries>();
  for (const s of series) {
    const existing = bestByServer.get(s.serverId);
    if (!existing || s.points.length > existing.points.length) bestByServer.set(s.serverId, s);
  }
  const named: ScansStripSeries[] = [...bestByServer.values()]
    .map((s) => ({
      serverId: s.serverId,
      serverName: s.serverName ?? s.serverId,
      points: s.points.filter((p) => p.totalTokens !== null).map((p) => ({ bucketStart: p.bucketStart, value: p.totalTokens as number })),
    }))
    .filter((s) => s.points.length > 0);
  const rows = pivotToRows(named.map((s) => ({ key: s.serverId, label: s.serverName, points: s.points })));
  return { rows, series: named, hasData: named.length > 0 };
}

// ── KPI header ───────────────────────────────────────────────────────────────────────────────────

export type TestingKpis = {
  runCount: number;
  errorRatePercent: number;
  /** One entry per cost-basis class present. */
  costByBasis: { cls: string; label: string; total: number }[];
  /** The latest bucket's p95 ACTIVE duration (ms), or `null` when no duration data exists. */
  latestP95DurationMs: number | null;
};

/** The KPI header row — reuses Panel 1's count/errorRate series, Panel 5's cost series, and Panel
 *  3's `latestP95` (no extra network round trip for the header). */
export function buildTestingKpis(
  runsOverTime: RunsOverTimeResult,
  cost: CostResult,
  duration: DurationResult,
): TestingKpis {
  let runCount = 0;
  for (const row of runsOverTime.rows) {
    for (const group of runsOverTime.groups) {
      const v = row[group];
      if (typeof v === "number") runCount += v;
    }
  }
  const errorPoints = runsOverTime.rows
    .map((r) => (typeof r.errorRatePercent === "number" ? r.errorRatePercent : null))
    .filter((v): v is number => v !== null);
  // Weighted by bucket run count so a big bucket counts more than a quiet one.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const row of runsOverTime.rows) {
    const bucketCount = runsOverTime.groups.reduce((sum, g) => sum + (typeof row[g] === "number" ? (row[g] as number) : 0), 0);
    if (bucketCount > 0 && typeof row.errorRatePercent === "number") {
      weightedSum += row.errorRatePercent * bucketCount;
      weightTotal += bucketCount;
    }
  }
  const errorRatePercent = weightTotal > 0 ? weightedSum / weightTotal : errorPoints.length > 0 ? 0 : 0;

  return {
    runCount,
    errorRatePercent,
    costByBasis: cost.costClasses.map((c) => ({ cls: c.cls, label: c.label, total: c.total })),
    latestP95DurationMs: duration.latestP95,
  };
}

// ── Custom chart composer (WP 2.7) — GENERIC pivot for an ARBITRARY measure/groupBy selection ─────
// Unlike the fixed per-panel builders above (each hard-coded to one measure/groupBy shape), a custom
// chart's config picks its own measures + optional groupBy, so this pivot makes NO assumption about
// which axes are present — it labels each returned series by whichever of measure/group/capability-
// class it actually carries and pivots them onto one bucket-keyed row set. Still NEVER blends a
// capability class into another (D-OB14): a capability-split measure keeps returning one series per
// class from the API, and each becomes its OWN named series here — never summed.

export type GenericChartSeries = { key: string; label: string };
export type GenericChartResult = { rows: PivotedRow[]; series: GenericChartSeries[]; hasData: boolean };

/** camelCase/snake_case measure id → a readable, sentence-case label ("p50DurationMs" → "P50
 *  duration ms", "errorRate" → "Error rate") — splits camelCase boundaries, lowercases the whole
 *  thing (so a mid-word capital doesn't survive as its own Title-Cased word), then reuses
 *  {@link humanize} to capitalize only the leading letter. */
export function humanizeMeasure(measure: string): string {
  const spaced = measure.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return humanize(spaced.replace(/_/g, " "));
}

const GROUP_LABEL_BY_DIMENSION: Partial<Record<RunMetricsGroupBy, (group: string) => string>> = {
  providerKind: (group) => PROVIDER_KIND_LABELS[group as ProviderKind] ?? group,
  stopReasonCode: (group) => humanize(group),
};

/** Resolve one group VALUE's display label for a `groupBy` dimension, given the small catalog lookups
 *  the caller already has on hand (server/suite/test/environment names). A dimension with no catalog
 *  entry (model/provider/skill/…) or an unresolved id falls back to the raw value — the same honest
 *  degradation the fixed panels use (`catalog.serverName(id) ?? id`, etc.). */
export function resolveGroupLabel(
  groupBy: RunMetricsGroupBy | undefined,
  group: string,
  catalog: {
    serverName?: (id: string) => string;
    suiteName?: (id: string) => string;
    testName?: (id: string) => string;
    environmentName?: (id: string) => string;
  },
): string {
  if (groupBy === "server" && catalog.serverName) return catalog.serverName(group);
  if (groupBy === "suite" && catalog.suiteName) return catalog.suiteName(group);
  if (groupBy === "test" && catalog.testName) return catalog.testName(group);
  if (groupBy === "environment" && catalog.environmentName) return catalog.environmentName(group);
  const fn = groupBy ? GROUP_LABEL_BY_DIMENSION[groupBy] : undefined;
  return fn ? fn(group) : group;
}

/**
 * Pivot an arbitrary `RunMetricsSeries[]` (any measures/groupBy the caller's config requested) into
 * chart-ready rows. `groupLabel` resolves a group VALUE to a display label (pass `resolveGroupLabel`
 * bound to a catalog, or omit to show raw ids); `capabilityClassLabel` resolves a capability class id
 * for a given measure (pass `TOKEN_CLASS_LABELS`/`COST_CLASS_LABELS`-backed lookups, or omit to fall
 * back to {@link humanize}). The measure name is included in each series' label only when the config
 * carries MORE THAN ONE measure (a single-measure chart doesn't need to repeat its own name per line).
 */
export function buildGenericRunSeriesRows(
  series: RunMetricsSeries[],
  measureCount: number,
  groupLabel?: (group: string) => string,
  capabilityClassLabel?: (measure: RunMetricsMeasure, cls: string) => string,
): GenericChartResult {
  const showMeasure = measureCount > 1;
  const named: NamedPoints[] = series.map((s) => {
    const parts: string[] = [];
    if (showMeasure) parts.push(humanizeMeasure(s.measure));
    if (s.group !== null) parts.push(groupLabel ? groupLabel(s.group) : s.group);
    if (s.capabilityClass !== null) {
      parts.push(
        capabilityClassLabel ? capabilityClassLabel(s.measure, s.capabilityClass) : humanize(s.capabilityClass),
      );
    }
    // A structured (not string-concatenated) key — avoids ambiguous double-separators when
    // group/capabilityClass are absent, and stays collision-safe if a group value ever contained the
    // separator itself. Not user-facing (only `label` is shown); used as the pivoted row's object key
    // and the chart's `dataKey`, either of which is happy with any unique string.
    const key = JSON.stringify([s.measure, s.group, s.capabilityClass]);
    const label = parts.length > 0 ? parts.join(" · ") : humanizeMeasure(s.measure);
    return { key, label, points: s.points };
  });
  const rows = pivotToRows(named);
  const uniqueSeries = new Map<string, string>();
  for (const n of named) uniqueSeries.set(n.key, n.label);
  return {
    rows,
    series: [...uniqueSeries.entries()].map(([key, label]) => ({ key, label })),
    hasData: rows.length > 0 && uniqueSeries.size > 0,
  };
}

/** Read one `DashboardChartScanMeasure` field off a `ScanMetricsPoint`; `null` mirrors the API's own
 *  honesty guard (a bucket with no successful scan carries `null` footprint fields). */
function scanMeasureValue(point: ScanMetricsPoint, measure: DashboardChartScanMeasure): number | null {
  switch (measure) {
    case "scanCount":
      return point.scanCount;
    case "failureRate":
      return point.failureRate;
    case "totalTokens":
      return point.totalTokens;
    case "toolTokens":
      return point.toolTokens;
    case "resourceTokens":
      return point.resourceTokens;
    case "promptTokens":
      return point.promptTokens;
    case "totalTools":
      return point.totalTools;
    case "totalResources":
      return point.totalResources;
    case "totalResourceTemplates":
      return point.totalResourceTemplates;
    case "totalPrompts":
      return point.totalPrompts;
  }
}

/**
 * Pivot an arbitrary `ScanMetricsSeries[]` + the chart's selected scan measures into chart-ready rows
 * — one named series per (server, measure) combination present, NEVER aggregated across servers (a
 * scans chart shows exactly the per-server series `computeScanMetrics` already returns). The server
 * name ALWAYS anchors the label (scans are inherently server-dimensioned — mirrors how
 * `buildGenericRunSeriesRows` always includes a non-null `group`); the measure name is appended only
 * when the chart carries MORE THAN ONE measure (a single-measure chart doesn't need to repeat it on
 * every line — the panel's own title already says what's being plotted).
 */
export function buildGenericScanSeriesRows(
  series: ScanMetricsSeries[],
  measures: DashboardChartScanMeasure[],
): GenericChartResult {
  const showMeasure = measures.length > 1;
  const named: NamedPoints[] = [];
  for (const s of series) {
    for (const measure of measures) {
      const points = s.points
        .map((p) => ({ bucketStart: p.bucketStart, value: scanMeasureValue(p, measure) }))
        .filter((p): p is { bucketStart: string; value: number } => p.value !== null);
      if (points.length === 0) continue;
      const parts: string[] = [s.serverName ?? s.serverId];
      if (showMeasure) parts.push(humanizeMeasure(measure));
      const label = parts.join(" · ");
      named.push({ key: `${s.serverId}··${measure}`, label, points });
    }
  }
  const rows = pivotToRows(named);
  return {
    rows,
    series: named.map((n) => ({ key: n.key, label: n.label })),
    hasData: rows.length > 0 && named.length > 0,
  };
}
