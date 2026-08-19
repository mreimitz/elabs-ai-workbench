import type {
  AdvisorRecommendation,
  AdvisorReport,
  AdvisorSeverity,
  MetricsBucket,
  RatingIssue,
  RunMetricsResponse,
  RunMetricsSeries,
  ScanMetricsPoint,
  ScanMetricsResponse,
  ScanMetricsSeries,
  ScanSummary,
  ServerConfig,
} from "@mcp-token-footprint/shared";
import { formatAdvisorSavings } from "../../advisor/advisor-format";
import type {
  AdvisorTeaserData,
  AttentionData,
  AttentionItem,
  CostBasisFigure,
  FootprintData,
  OverviewPoint,
  OverviewRange,
  RunHealthData,
} from "./overview-contract";

/**
 * Pure derivation layer for the Dashboard's Overview tab (dashboard-bento WP 1.1) — every reshaping
 * of `GET /api/metrics/{scans,runs}`, `GET /api/issues` and `GET /api/advisor/report` into the
 * committed {@link OverviewData} lives here, React-free, so each rule is unit-testable against
 * fixtures without rendering. Mirrors `features/dashboard/testing/metrics-derive.ts`.
 *
 * Three honesty rules are load-bearing here, because Phase 0 shipped a defect on each:
 *
 * 1. **A delta covers the SAME population as its value.** `deltaTokens` is summed over exactly the
 *    servers `totalTokens` is summed over — a server measured for the first time in the window
 *    contributes its WHOLE figure (its previous measured total is genuinely 0) and is counted in
 *    `firstTimeServers` so the tile can disclose it. `totalTokens − deltaTokens` therefore always
 *    equals the fleet's previous measured total. Summing Δ over only the servers that HAVE a prior
 *    scan, beside a value covering all of them, is what made a 100k→590k fleet growth render as a
 *    favourable shrink.
 * 2. **An incomparable delta is `null`, never `0`.** `deltaComparable: false` (a differing
 *    `counting_version`, or a point with no success scan) means REFUSE to subtract. One incomparable
 *    server voids the FLEET delta, because a partial delta would no longer cover the population its
 *    value covers — which is rule 1 again.
 * 3. **Cost never blends across bases.** `costUsd` returns one series PER `capabilityClass`
 *    (`api_exact` / `subscription_reference` / …); each becomes its own {@link CostBasisFigure}.
 *    Nothing here adds two bases together (D-OB14).
 */

// ── Window + bucket vocabulary ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Whole days spanned by a range (inclusive of both ends — a same-instant range is 1 day). */
function rangeDays(range: OverviewRange): number {
  const ms = Date.parse(range.to) - Date.parse(range.from);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / MS_PER_DAY));
}

/**
 * Bucket granularity for the Overview's window — hourly for the `24h` preset, daily up to ~60 days,
 * weekly beyond. Deliberately re-derived here rather than imported from
 * `features/dashboard/testing/dashboard-url-state.ts`: that module's vocabulary is the Testing tab's
 * `TestingDashboardControls`, which the Overview does not have (and must not couple to).
 */
export function resolveOverviewBucket(range: OverviewRange): MetricsBucket {
  if (range.preset === "24h") return "hour";
  const days = rangeDays(range);
  if (days <= 2) return "hour";
  if (days <= 60) return "day";
  return "week";
}

/**
 * The equal-length window immediately BEFORE `range` — the only baseline `passRateDeltaPoints` and
 * `CostBasisFigure.previousUsd` are ever computed against. Returns `null` when the range's bounds
 * are unparseable (a caller then simply skips the comparison rather than inventing one).
 */
export function previousRange(range: OverviewRange): { from: string; to: string } | null {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const span = to - from;
  return { from: new Date(from - span).toISOString(), to: new Date(to - span).toISOString() };
}

/** Floor an instant to its UTC bucket start, exactly as the API does (`week` = Monday 00:00 UTC). */
export function bucketFloorUtc(value: Date, bucket: MetricsBucket): Date {
  const floored = new Date(value.getTime());
  floored.setUTCMilliseconds(0);
  floored.setUTCSeconds(0);
  floored.setUTCMinutes(0);
  if (bucket === "hour") return floored;
  floored.setUTCHours(0);
  if (bucket === "day") return floored;
  // ISO-8601 week: Monday-start. `getUTCDay()` is 0=Sunday, so Sunday walks back 6 days.
  const weekday = floored.getUTCDay();
  floored.setUTCDate(floored.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return floored;
}

/** Hard cap on generated axis buckets — a malformed range can never spin the browser. */
const MAX_AXIS_BUCKETS = 2000;

/**
 * Every bucket start the window covers, ascending — the DENSE x-axis the metrics endpoints
 * deliberately do not return (they omit empty buckets, never zero-fill). The upper bound is clamped
 * to `now`, so a window whose `to` runs to the end of today does not sprout fabricated buckets for
 * hours that have not happened yet.
 */
export function buildBucketAxis(
  fromIso: string,
  toIso: string,
  bucket: MetricsBucket,
  now: Date = new Date(),
): string[] {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const upper = Math.min(to, now.getTime());
  if (upper < from) return [];
  const axis: string[] = [];
  const cursor = bucketFloorUtc(new Date(from), bucket);
  while (cursor.getTime() <= upper && axis.length < MAX_AXIS_BUCKETS) {
    axis.push(cursor.toISOString());
    if (bucket === "hour") cursor.setUTCHours(cursor.getUTCHours() + 1);
    else if (bucket === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return axis;
}

/**
 * Densify a COUNT series onto `axis`: a bucket the API omitted had zero runs, and zero is the
 * truthful value for a count — so filling it is honest, and NOT filling it makes a sparkline lie
 * about cadence (two points a week apart drawn side by side read as consecutive).
 *
 * This is only ever applied to counts. A MEASUREMENT series (a server's footprint) is never
 * zero-filled: a bucket with no successful scan is a real gap, and zero-filling it would claim the
 * surface collapsed to nothing. Any point whose bucket is outside `axis` is kept (never dropped) and
 * the result is sorted ascending, so a bucket/window mismatch degrades into an odd axis rather than
 * silently losing data.
 */
export function densifyCounts(
  points: readonly { bucketStart: string; value: number }[],
  axis: readonly string[],
): OverviewPoint[] {
  const byBucket = new Map<string, number>();
  for (const point of points) {
    byBucket.set(point.bucketStart, (byBucket.get(point.bucketStart) ?? 0) + point.value);
  }
  const out: OverviewPoint[] = axis.map((bucketStart) => ({
    bucketStart,
    value: byBucket.get(bucketStart) ?? 0,
  }));
  const onAxis = new Set(axis);
  for (const [bucketStart, value] of byBucket) {
    if (!onAxis.has(bucketStart)) out.push({ bucketStart, value });
  }
  return out.sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

// ── Footprint (GET /api/metrics/scans) ───────────────────────────────────────────────────────────

/** A point that actually carries a measurement (the bucket had a successful scan). */
type MeasuredPoint = ScanMetricsPoint & { totalTokens: number };

function isMeasured(point: ScanMetricsPoint): point is MeasuredPoint {
  return point.totalTokens !== null;
}

/**
 * One server's contribution to the fleet figures, after profile selection.
 * `deltaTokens === null` means "refuse to subtract" — NOT zero.
 */
type ServerFootprint = {
  serverId: string;
  serverName: string;
  points: OverviewPoint[];
  latest: MeasuredPoint;
  deltaTokens: number | null;
  firstMeasured: boolean;
};

/**
 * `GET /api/metrics/scans` is grouped by (server, **tokenProfile**), so one server scanned under two
 * profiles comes back as two series — summing both would double-count the fleet. Pick exactly ONE
 * series per server: the one whose most recent MEASURED bucket is newest (i.e. the profile the
 * operator most recently scanned with), tie-broken lexicographically by `tokenProfile` so the choice
 * is deterministic. A series with no measured point at all loses to one that has any.
 */
/** Candidate-vs-incumbent ordering for {@link pickSeriesPerServer}: a measured series always beats
 *  an unmeasured one, then the newest measurement wins, then the lexicographically first profile. */
function isBetterSeries(
  candidateLatest: string | null,
  incumbentLatest: string | null,
  candidateProfile: string,
  incumbentProfile: string,
): boolean {
  if (candidateLatest !== incumbentLatest) {
    if (candidateLatest === null) return false;
    if (incumbentLatest === null) return true;
    return candidateLatest > incumbentLatest;
  }
  return candidateProfile.localeCompare(incumbentProfile) < 0;
}

export function pickSeriesPerServer(response: ScanMetricsResponse): ScanMetricsSeries[] {
  const best = new Map<string, { series: ScanMetricsSeries; latest: string | null }>();
  for (const series of response.servers) {
    const measured = series.points.filter(isMeasured);
    const latest =
      measured.length > 0 ? (measured[measured.length - 1]?.bucketStart ?? null) : null;
    const current = best.get(series.serverId);
    if (current === undefined) {
      best.set(series.serverId, { series, latest });
      continue;
    }
    if (isBetterSeries(latest, current.latest, series.tokenProfile, current.series.tokenProfile)) {
      best.set(series.serverId, { series, latest });
    }
  }
  return [...best.values()]
    .map((entry) => entry.series)
    .sort((a, b) => a.serverId.localeCompare(b.serverId));
}

function resolveServerName(
  series: ScanMetricsSeries,
  serversById: ReadonlyMap<string, string>,
): string {
  return series.serverName ?? serversById.get(series.serverId) ?? series.serverId;
}

function buildServerFootprint(
  series: ScanMetricsSeries,
  serversById: ReadonlyMap<string, string>,
): ServerFootprint | null {
  const measured = series.points.filter(isMeasured);
  const latest = measured[measured.length - 1];
  if (latest === undefined) return null;
  const hasEarlierMeasurement = measured.length > 1;
  // The API's own verdict on `latest` vs the point immediately before it. `true` guarantees BOTH
  // points had a success scan under the SAME `counting_version` — the only case where subtracting is
  // honest. `false` with no earlier measurement means "first measured in this window", which is a
  // real, non-comparable state (previous total genuinely 0), not an incomparability.
  const deltaTokens =
    latest.deltaComparable && latest.deltaTotalTokens !== null
      ? latest.deltaTotalTokens
      : hasEarlierMeasurement
        ? null
        : latest.totalTokens;
  return {
    serverId: series.serverId,
    serverName: resolveServerName(series, serversById),
    // Measured points only — a bucket without a successful scan stays a REAL GAP (see `densifyCounts`).
    points: measured.map((point) => ({ bucketStart: point.bucketStart, value: point.totalTokens })),
    latest,
    deltaTokens,
    firstMeasured: !hasEarlierMeasurement,
  };
}

/**
 * The hero tile's data. Returns `null` when no server has a single successful scan in the window —
 * the section is then `empty` and the tile removes itself rather than rendering an empty box.
 *
 * `servers` supplies display-name fallbacks for a series whose `serverName` is null (a deleted
 * server keeps its id); it never widens or narrows the population.
 */
export function buildFootprintData(
  response: ScanMetricsResponse,
  servers: readonly ServerConfig[] = [],
): FootprintData | null {
  const serversById = new Map(servers.map((server) => [server.id, server.name] as const));
  const perServer = pickSeriesPerServer(response)
    .map((series) => buildServerFootprint(series, serversById))
    .filter((entry): entry is ServerFootprint => entry !== null);
  if (perServer.length === 0) return null;

  const totalTokens = perServer.reduce((sum, entry) => sum + entry.latest.totalTokens, 0);
  const firstTimeServers = perServer.filter((entry) => entry.firstMeasured).length;

  // Population integrity (rule 1): the Δ is stated only when EVERY server in the population can be
  // accounted for, and only when at least one of them has a real prior measurement to compare
  // against — otherwise there is no previous fleet total for the figure to be a delta OF.
  const anyIncomparable = perServer.some((entry) => entry.deltaTokens === null);
  const anyComparable = perServer.some((entry) => !entry.firstMeasured);
  const deltaTokens =
    anyIncomparable || !anyComparable
      ? null
      : perServer.reduce((sum, entry) => sum + (entry.deltaTokens ?? 0), 0);

  const mix = perServer.reduce(
    (acc, entry) => ({
      toolTokens: acc.toolTokens + (entry.latest.toolTokens ?? 0),
      resourceTokens: acc.resourceTokens + (entry.latest.resourceTokens ?? 0),
      promptTokens: acc.promptTokens + (entry.latest.promptTokens ?? 0),
    }),
    { toolTokens: 0, resourceTokens: 0, promptTokens: 0 },
  );

  return {
    perServer: perServer.map((entry) => ({
      serverId: entry.serverId,
      serverName: entry.serverName,
      points: entry.points,
    })),
    totalTokens,
    deltaTokens,
    firstTimeServers,
    mix,
  };
}

// ── Run health (GET /api/metrics/runs) ───────────────────────────────────────────────────────────

function seriesFor(response: RunMetricsResponse, measure: string): RunMetricsSeries[] {
  return response.series.filter((series) => series.measure === measure);
}

function sumValues(series: readonly RunMetricsSeries[]): number {
  return series.reduce(
    (sum, entry) => sum + entry.points.reduce((inner, point) => inner + point.value, 0),
    0,
  );
}

/**
 * Window-wide pass rate as a percentage, or `null` when NO run reached a terminal state (a `0` there
 * would read as "everything failed"). `errorRate` points are rates over `n` runs, so collapsing them
 * to one window figure is a weighted average — reconstructing each bucket's error COUNT as
 * `value * n` (both exact integer ratios from the API) rather than averaging rates of unequal size.
 */
export function windowPassRatePercent(response: RunMetricsResponse): number | null {
  let errors = 0;
  let runs = 0;
  for (const series of seriesFor(response, "errorRate")) {
    for (const point of series.points) {
      errors += Math.round(point.value * point.n);
      runs += point.n;
    }
  }
  if (runs === 0) return null;
  return (1 - errors / runs) * 100;
}

/** Cost-basis label for a `costUsd` series. The measure is capability-SPLIT, so a series should
 *  always carry a class; a wire that somehow does not is labelled `none` rather than blended away. */
function costBasisOf(series: RunMetricsSeries): string {
  return series.capabilityClass ?? "none";
}

/**
 * One {@link CostBasisFigure} per cost basis present — `api_exact` money billed and
 * `subscription_reference` shadow pricing are different KINDS of number (D-OB14) and are never
 * added together, here or downstream.
 *
 * `previousUsd` is `null` unless the previous window is genuinely comparable (it was fetched AND it
 * contained runs) — a window with no runs at all offers no baseline, and calling that `$0` would
 * read as "spend dropped to zero". Within a comparable previous window, a basis with no series
 * really did spend nothing, so it reads `0`. A basis that spent nothing in BOTH windows is omitted:
 * it has nothing to say, and a `$0.00` row is noise, not information.
 */
export function buildCostByBasis(
  current: RunMetricsResponse,
  previous: RunMetricsResponse | null,
): CostBasisFigure[] {
  const previousComparable = previous !== null && sumValues(seriesFor(previous, "count")) > 0;
  const currentByBasis = new Map<string, number>();
  for (const series of seriesFor(current, "costUsd")) {
    const basis = costBasisOf(series);
    currentByBasis.set(basis, (currentByBasis.get(basis) ?? 0) + sumValues([series]));
  }
  const previousByBasis = new Map<string, number>();
  if (previous !== null) {
    for (const series of seriesFor(previous, "costUsd")) {
      const basis = costBasisOf(series);
      previousByBasis.set(basis, (previousByBasis.get(basis) ?? 0) + sumValues([series]));
    }
  }
  const bases = [...new Set([...currentByBasis.keys(), ...previousByBasis.keys()])].sort();
  const figures: CostBasisFigure[] = [];
  for (const basis of bases) {
    const currentUsd = currentByBasis.get(basis) ?? 0;
    const previousUsd = previousComparable ? (previousByBasis.get(basis) ?? 0) : null;
    if (currentUsd === 0 && (previousUsd === null || previousUsd === 0)) continue;
    figures.push({ basis, currentUsd, previousUsd });
  }
  return figures;
}

/**
 * The run-health tile's data. Returns `null` when the window contains no runs at all — the section
 * is `empty` and its tiles remove themselves.
 */
export function buildRunHealthData(
  current: RunMetricsResponse,
  previous: RunMetricsResponse | null,
  options: { range: OverviewRange; bucket: MetricsBucket; now?: Date },
): RunHealthData | null {
  const countSeries = seriesFor(current, "count");
  const runCount = sumValues(countSeries);
  if (runCount === 0) return null;

  const passRatePercent = windowPassRatePercent(current);
  const previousPassRate = previous === null ? null : windowPassRatePercent(previous);
  const passRateDeltaPoints =
    passRatePercent === null || previousPassRate === null
      ? null
      : passRatePercent - previousPassRate;

  const axis = buildBucketAxis(
    options.range.from,
    options.range.to,
    options.bucket,
    options.now ?? new Date(),
  );
  const runsOverTime = densifyCounts(
    countSeries.flatMap((series) => series.points),
    axis,
  );

  return {
    runCount,
    passRatePercent,
    passRateDeltaPoints,
    runsOverTime,
    costByBasis: buildCostByBasis(current, previous),
  };
}

// ── Attention (servers + scans + fleet issues) ───────────────────────────────────────────────────

/** The newest scan per server (any status) — `scans` need not be pre-sorted. */
function latestScanByServer(scans: readonly ScanSummary[]): Map<string, ScanSummary> {
  const latest = new Map<string, ScanSummary>();
  for (const scan of scans) {
    const current = latest.get(scan.serverId);
    if (current === undefined || Date.parse(scan.scannedAt) > Date.parse(current.scannedAt)) {
      latest.set(scan.serverId, scan);
    }
  }
  return latest;
}

/** How many rows the tile is handed. `AttentionData.total` still reports the true count. */
export const ATTENTION_ITEM_LIMIT = 8;

/**
 * The "needs you" queue. Deliberately **not** windowed by `range`: a server that has never been
 * scanned, a latest scan that failed, and an open regression are all statements about the fleet's
 * CURRENT state — narrowing them to the last 24 hours would quietly hide work that still needs
 * doing. Triage order is fixed and deterministic: broken now (failed scans) → a fix that broke again
 * (regressed issues) → open issues → never measured (unscanned servers).
 *
 * Returns `null` when nothing needs the operator.
 */
export function buildAttentionData(
  servers: readonly ServerConfig[],
  scans: readonly ScanSummary[],
  issues: readonly RatingIssue[],
): AttentionData | null {
  const latest = latestScanByServer(scans);
  const byName = [...servers].sort((a, b) => a.name.localeCompare(b.name));

  const failedScans: AttentionItem[] = byName
    .map((server) => ({ server, scan: latest.get(server.id) }))
    .filter(
      (row): row is { server: ServerConfig; scan: ScanSummary } => row.scan?.status === "failed",
    )
    .map(({ server, scan }) => ({
      kind: "scan_failed" as const,
      label: server.name,
      detail: scan.errorMessage ?? "Latest scan failed",
      href: `/scans/${encodeURIComponent(scan.id)}`,
      serverId: server.id,
    }));

  const unscanned: AttentionItem[] = byName
    .filter((server) => !latest.has(server.id))
    .map((server) => ({
      kind: "server_unscanned" as const,
      label: server.name,
      detail: null,
      href: `/servers/${encodeURIComponent(server.id)}`,
      serverId: server.id,
    }));

  const fleetIssues = issues.filter((issue) => issue.fleet != null);
  const issueItem = (
    issue: RatingIssue,
    kind: "issue_regressed" | "issue_open",
  ): AttentionItem => ({
    kind,
    label: issue.title,
    detail: issue.targetName.length > 0 ? issue.targetName : null,
    href: `/dashboard?tab=issues&issue=${encodeURIComponent(issue.id)}`,
    serverId: null,
  });
  const byLastSeen = (a: RatingIssue, b: RatingIssue) =>
    (b.fleet?.lastSeenAt ?? "").localeCompare(a.fleet?.lastSeenAt ?? "");
  const regressed = fleetIssues
    .filter((issue) => issue.fleet?.lifecycle === "regressed")
    .sort(byLastSeen)
    .map((issue) => issueItem(issue, "issue_regressed"));
  const open = fleetIssues
    .filter((issue) => issue.fleet?.lifecycle === "open")
    .sort(byLastSeen)
    .map((issue) => issueItem(issue, "issue_open"));

  const items = [...failedScans, ...regressed, ...open, ...unscanned];
  if (items.length === 0) return null;
  return { items: items.slice(0, ATTENTION_ITEM_LIMIT), total: items.length };
}

// ── Advisor (GET /api/advisor/report?scope=fleet) ────────────────────────────────────────────────

/** `AdvisorSeverity` is `high | medium | info`; the contract's teaser speaks `high | medium | low`. */
const SEVERITY_RANK: Record<AdvisorSeverity, number> = { high: 0, medium: 1, info: 2 };
const SEVERITY_TO_TEASER: Record<AdvisorSeverity, AdvisorTeaserData["severity"]> = {
  high: "high",
  medium: "medium",
  info: "low",
};

/**
 * The single recommendation worth surfacing on the Overview: the most severe one, ties broken by the
 * report's own (already deterministic) ordering. `savingsLabel` is `null` when the rule named no
 * defensible estimate — the tile then renders nothing rather than "0 tokens saved". The label goes
 * through the app's one savings formatter, so the figure can never be read as a measurement.
 *
 * Returns `null` when the report has no recommendations.
 */
export function buildAdvisorTeaser(report: AdvisorReport): AdvisorTeaserData | null {
  let top: AdvisorRecommendation | null = null;
  for (const recommendation of report.recommendations) {
    if (top === null || SEVERITY_RANK[recommendation.severity] < SEVERITY_RANK[top.severity]) {
      top = recommendation;
    }
  }
  if (top === null) return null;
  return {
    title: top.title,
    detail: top.detail,
    savingsLabel: top.savings ? formatAdvisorSavings(top.savings).amount : null,
    severity: SEVERITY_TO_TEASER[top.severity],
    href: "/advisor",
  };
}
