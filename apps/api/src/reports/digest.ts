// ── Scheduled digest report (Observability WP5.5, D-OB22) ──────────────────────────────────────────
// The "since your last visit" briefing, persisted + scheduled: a window-over-window comparison of a
// daily/weekly calendar period against the one before it. THE DERIVED-ONCE INVARIANT: every number in
// a digest is READ (or arranged — summed/diffed) from the WP1.2 metrics services (`computeRunMetrics`/
// `computeScanMetrics`) or the WP5.1 issues registry (`RatingIssueRepository`); this module never
// re-implements a SQL aggregation of its own. `composeDigestReport` only ARRANGES what those services
// already computed — headline counts, top movers, notable runs — into one JSON document (keep the
// Markdown twin, `digest-markdown.ts`, terse: a briefing, not a dashboard dump, per the WP notes).
//
// Three pieces, mirroring the house report pattern (`server-report.ts` composer + `-markdown.ts`
// renderer) plus the append-only persistence pattern (`suites/suite-report-repository.ts`):
//   - window/grid helpers — a calendar-aligned day/Monday-week boundary + an hourUtc-delayed "due"
//     instant, and a bounded catch-up enumerator (mirrors `watch/engine.ts`'s `enumerateWindowEnds`,
//     adapted from a fixed-width epoch grid to a calendar grid).
//   - {@link composeDigestReport} — the pure(-ish; it calls the metrics/issues services with `db`)
//     composer.
//   - {@link DigestReportRepository} — append-only persistence over `digest_reports` (v43).
//   - {@link DigestScheduleService} — the schedule (`app_settings`) + the scheduler's `onDigest` tick +
//     manual on-demand generation, both funneling through the SAME `generateForWindowEnd`.

import { nanoid } from "nanoid";
import {
  APP_SETTING_DIGEST_SCHEDULE_KEY,
  DIGEST_CATCHUP_MAX_WINDOWS,
  DIGEST_SCHEDULE_DEFAULT_HOUR_UTC,
  DIGEST_TOP_N,
  digestScheduleSchema,
  type DigestHeadline,
  type DigestIssueRef,
  type DigestMetricDelta,
  type DigestMover,
  type DigestMoverDimension,
  type DigestNotableRun,
  type DigestNotableRunReason,
  type DigestPruneResult,
  type DigestReport,
  type DigestScanMover,
  type DigestSchedule,
  type DigestWindowKind,
  type MetricsBucket,
  type RatingIssue,
  type RunMetricsMeasure,
  type RunMetricsSeries,
  type RunSummary,
  type ScanMetricsPoint,
  type ScanMetricsResponse,
  type SessionCostBasis,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { DigestReportRow } from "../db/rows.js";
import type { AppSettingsRepository } from "../grading/app-settings-repository.js";
import type { RatingIssueRepository } from "../grading/issue-repository.js";
import { computeRunMetrics, computeScanMetrics } from "../observability/metrics.js";
import type { RunRepository } from "../testing/run-repository.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

// ── Calendar-aligned window grid ────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function windowWidthMs(kind: DigestWindowKind): number {
  return kind === "daily" ? MS_PER_DAY : MS_PER_WEEK;
}

/**
 * Floor `ms` to its UTC calendar boundary — midnight for `daily`, Monday 00:00 UTC for `weekly` — the
 * SAME boundary `observability/metrics.ts`'s `bucketStartUtc` uses for its `day`/`week` buckets, so a
 * digest window is always exactly one metrics bucket wide (the same single-bucket-collapse trick
 * `watch/engine.ts`'s windowed evaluator relies on for its own grid alignment).
 */
function calendarBoundary(ms: number, kind: DigestWindowKind): number {
  const d = new Date(ms);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (kind === "daily") return dayStart;
  const dow = new Date(dayStart).getUTCDay(); // 0=Sun … 6=Sat
  const daysFromMonday = (dow + 6) % 7; // Mon→0 … Sun→6
  return dayStart - daysFromMonday * MS_PER_DAY;
}

/**
 * The most recent window END that is DUE for generation. A window's OWN bounds are calendar-aligned
 * regardless of `hourUtc` — `hourUtc` only delays WHEN a just-completed window's digest is generated
 * (gives the day's last runs time to land before the briefing is built).
 */
function dueWindowEnd(nowMs: number, kind: DigestWindowKind, hourUtc: number): number {
  const width = windowWidthMs(kind);
  const today = calendarBoundary(nowMs, kind); // start of the CURRENT (possibly partial) period
  const triggerMs = today + hourUtc * 3_600_000;
  return triggerMs <= nowMs ? today : today - width;
}

/**
 * The digest window ENDS with `afterMs < E <= dueWindowEnd(nowMs,…)`, capped to the most recent
 * `maxCount` (mirrors `watch/engine.ts`'s `enumerateWindowEnds` catch-up shape, adapted from a
 * fixed-width epoch grid to an hourUtc-delayed calendar grid). `afterMs === null` (never generated
 * before) returns only the single most recent due window — never an infinite first-sight backlog.
 */
export function enumerateDigestWindowEnds(
  afterMs: number | null,
  nowMs: number,
  kind: DigestWindowKind,
  hourUtc: number,
  maxCount: number,
): { ends: number[]; truncated: boolean } {
  const width = windowWidthMs(kind);
  const due = dueWindowEnd(nowMs, kind, hourUtc);
  if (due < width) return { ends: [], truncated: false }; // defensive: no full window has completed yet
  if (afterMs === null) return { ends: [due], truncated: false };
  const base = calendarBoundary(afterMs, kind);
  if (due <= base) return { ends: [], truncated: false }; // nothing new due since the last generation
  const ends: number[] = [];
  for (let e = base + width; e <= due; e += width) ends.push(e);
  if (ends.length <= maxCount) return { ends, truncated: false };
  return { ends: ends.slice(ends.length - maxCount), truncated: true };
}

// ── Composer — every number DELEGATED to the metrics services + the issues registry ────────────────

export type DigestComposerDeps = {
  db: AppDatabase;
  runs: RunRepository;
  issues: RatingIssueRepository;
};

export type DigestComposeParams = {
  id: string;
  windowKind: DigestWindowKind;
  /** Calendar-aligned window start (inclusive), ISO-8601. */
  windowFrom: string;
  /** Calendar-aligned window end (exclusive), ISO-8601. */
  windowTo: string;
  generatedAt: string;
  late: boolean;
};

/** current/previous straight off two ALREADY-derived numbers — the composer's only "math": a subtraction. */
function delta(current: number, previous: number): DigestMetricDelta {
  return { current, previous, delta: current - previous };
}

/** One non-capability-split measure's value for one (group, bucket) — `undefined` when that bucket had
 *  no backing rows (never fabricated as 0 at this layer; callers decide the honest fallback). */
function scalarAt(
  series: RunMetricsSeries[],
  measure: RunMetricsMeasure,
  group: string | null,
  bucketStart: string,
): number | undefined {
  const s = series.find(
    (s) => s.measure === measure && s.group === group && s.capabilityClass === null,
  );
  return s?.points.find((p) => p.bucketStart === bucketStart)?.value;
}

/**
 * Headline counts from ONE `computeRunMetrics` call spanning both windows (bucket-aligned so the call
 * returns at most two points per series: the previous window's bucket + the current window's bucket).
 * `errorRate` is `null` only when NEITHER window had any run (the honest empty); otherwise a window
 * with zero runs reads as 0% by convention (its `runs.current`/`runs.previous` count of 0 makes that
 * 0% legible in context — never claimed as precision the data doesn't have).
 */
function buildHeadline(
  series: RunMetricsSeries[],
  prevBucketStart: string,
  currBucketStart: string,
): DigestHeadline {
  const countPrev = scalarAt(series, "count", null, prevBucketStart) ?? 0;
  const countCurr = scalarAt(series, "count", null, currBucketStart) ?? 0;
  const errPrev = scalarAt(series, "errorRate", null, prevBucketStart);
  const errCurr = scalarAt(series, "errorRate", null, currBucketStart);
  const errorRate =
    countPrev === 0 && countCurr === 0 ? null : delta(errCurr ?? 0, errPrev ?? 0);

  // costUsd is a CAPABILITY-SPLIT measure (D-OB14) — one series per cost basis; NEVER blended.
  const classes = new Set<string>();
  for (const s of series) {
    if (s.measure === "costUsd" && s.group === null && s.capabilityClass) {
      classes.add(s.capabilityClass);
    }
  }
  const costByBasis: Partial<Record<SessionCostBasis, DigestMetricDelta>> = {};
  for (const cls of classes) {
    const s = series.find(
      (s) => s.measure === "costUsd" && s.group === null && s.capabilityClass === cls,
    );
    const prev = s?.points.find((p) => p.bucketStart === prevBucketStart)?.value ?? 0;
    const curr = s?.points.find((p) => p.bucketStart === currBucketStart)?.value ?? 0;
    costByBasis[cls as SessionCostBasis] = delta(curr, prev);
  }

  return { runs: delta(countCurr, countPrev), errorRate, costByBasis };
}

/** Rank movers worst-first: the biggest |error-rate swing|, then the biggest |cost swing| as a tiebreak
 *  (a simple, explainable two-key sort — no blended "impact score" that would hide which axis moved). */
function moverRank(a: DigestMover, b: DigestMover): number {
  const aErr = Math.abs(a.errorRate?.delta ?? 0);
  const bErr = Math.abs(b.errorRate?.delta ?? 0);
  if (bErr !== aErr) return bErr - aErr;
  return Math.abs(b.costUsd.delta) - Math.abs(a.costUsd.delta);
}

/** Every group present in a grouped `computeRunMetrics` response, with its own error-rate/cost swing.
 *  A group with ZERO runs in BOTH windows is dropped (nothing happened there — never a manufactured
 *  0/0 entry). `names` optionally resolves a group key (e.g. a server id) to a display label. */
function buildMovers(
  dimension: DigestMoverDimension,
  series: RunMetricsSeries[],
  prevBucketStart: string,
  currBucketStart: string,
  names?: Map<string, string>,
): DigestMover[] {
  const groups = new Set<string>();
  for (const s of series) if (s.group !== null) groups.add(s.group);

  const out: DigestMover[] = [];
  for (const key of groups) {
    const countPrev = scalarAt(series, "count", key, prevBucketStart) ?? 0;
    const countCurr = scalarAt(series, "count", key, currBucketStart) ?? 0;
    if (countPrev === 0 && countCurr === 0) continue;
    const errPrev = scalarAt(series, "errorRate", key, prevBucketStart);
    const errCurr = scalarAt(series, "errorRate", key, currBucketStart);
    const errorRate = delta(errCurr ?? 0, errPrev ?? 0);

    let costPrev = 0;
    let costCurr = 0;
    for (const s of series) {
      if (s.measure !== "costUsd" || s.group !== key) continue;
      costPrev += s.points.find((p) => p.bucketStart === prevBucketStart)?.value ?? 0;
      costCurr += s.points.find((p) => p.bucketStart === currBucketStart)?.value ?? 0;
    }

    out.push({
      dimension,
      key,
      label: names?.get(key) ?? key,
      errorRate,
      costUsd: delta(costCurr, costPrev),
    });
  }
  return out;
}

/** Server display names for a batch of ids — plain metadata (not a derived number), mirroring
 *  `computeScanMetrics`'s own `LEFT JOIN mcp_servers` for `server_name`. A deleted server's id simply
 *  falls back to itself as the label (never thrown — a mover must survive its server's later deletion,
 *  same discipline as a `RatingIssue.targetName`). */
function resolveServerNames(db: AppDatabase, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, name FROM mcp_servers WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

function toIssueRef(issue: RatingIssue): DigestIssueRef {
  return {
    id: issue.id,
    title: issue.title,
    severity: issue.severity,
    targetKind: issue.targetKind,
    targetName: issue.targetName,
    // Mirrors the fleet-regression notification's own deep link (`index.ts` `notifyRegression`).
    linkPath: `/dashboard?tab=issues&issue=${issue.id}`,
  };
}

function toNotableRun(run: RunSummary, reason: DigestNotableRunReason): DigestNotableRun {
  return {
    runId: run.id,
    testId: run.testId,
    scenarioId: run.scenarioId,
    costUsd: run.costUsd,
    stopReasonCode: run.stopReasonCode ?? null,
    reason,
    linkPath: `/testing/runs/${run.id}`,
  };
}

/** Every server/profile scan series with CURRENT-window activity, ranked by |Δ total tokens| — the
 *  delta is read straight off `computeScanMetrics`'s own bucket-over-bucket comparison (never
 *  recomputed here); `deltaComparable:false` (a counting-version change, or no prior-window scan)
 *  simply carries a null-ish delta through, honestly. */
function buildScanMovers(scanMetrics: ScanMetricsResponse, currBucketStart: string): DigestScanMover[] {
  const withCurrent: Array<{ series: ScanMetricsResponse["servers"][number]; point: ScanMetricsPoint }> =
    [];
  for (const series of scanMetrics.servers) {
    const point = series.points.find((p) => p.bucketStart === currBucketStart);
    if (point) withCurrent.push({ series, point });
  }
  withCurrent.sort(
    (a, b) => Math.abs(b.point.deltaTotalTokens ?? 0) - Math.abs(a.point.deltaTotalTokens ?? 0),
  );
  return withCurrent.slice(0, DIGEST_TOP_N).map(({ series, point }) => ({
    serverId: series.serverId,
    serverName: series.serverName,
    tokenProfile: series.tokenProfile,
    totalTokens: point.totalTokens,
    deltaTotalTokens: point.deltaTotalTokens,
    deltaComparable: point.deltaComparable,
  }));
}

/**
 * Build the full {@link DigestReport} for one calendar window. Every number is DELEGATED: headline +
 * movers to `computeRunMetrics`, scan movers to `computeScanMetrics`, new/regressed/resolved issues to
 * `RatingIssueRepository.listAll`, notable runs to `RunRepository.queryRuns` (an existing filter/sort
 * query, not a new aggregation). This function only arranges + diffs those already-derived numbers.
 */
export function composeDigestReport(
  deps: DigestComposerDeps,
  params: DigestComposeParams,
): DigestReport {
  const { db, runs, issues } = deps;
  const { id, windowKind, windowFrom, windowTo, generatedAt, late } = params;
  const width = windowWidthMs(windowKind);
  const windowToMs = Date.parse(windowTo);
  const prevWindowFrom = new Date(windowToMs - 2 * width).toISOString();
  const prevWindowTo = windowFrom;
  const bucket: MetricsBucket = windowKind === "daily" ? "day" : "week";
  // Inclusive upper bound one ms before windowTo — keeps the [prevWindowFrom, windowTo) span to
  // EXACTLY two grid-aligned buckets (mirrors `watch/engine.ts`'s `computeWindowValue` `endMs - 1`).
  const spanTo = new Date(windowToMs - 1).toISOString();

  const headlineSeries = computeRunMetrics(db, {
    filter: {},
    from: prevWindowFrom,
    to: spanTo,
    bucket,
    measures: ["count", "errorRate", "costUsd"],
  }).series;
  const headline = buildHeadline(headlineSeries, prevWindowFrom, windowFrom);

  const serverSeries = computeRunMetrics(db, {
    filter: {},
    from: prevWindowFrom,
    to: spanTo,
    bucket,
    groupBy: "server",
    measures: ["count", "errorRate", "costUsd"],
  }).series;
  const modelSeries = computeRunMetrics(db, {
    filter: {},
    from: prevWindowFrom,
    to: spanTo,
    bucket,
    groupBy: "model",
    measures: ["count", "errorRate", "costUsd"],
  }).series;
  const suiteSeries = computeRunMetrics(db, {
    filter: {},
    from: prevWindowFrom,
    to: spanTo,
    bucket,
    groupBy: "suite",
    measures: ["count", "errorRate", "costUsd"],
  }).series;

  const serverIds = [...new Set(serverSeries.filter((s) => s.group !== null).map((s) => s.group as string))];
  const serverNames = resolveServerNames(db, serverIds);

  const movers = [
    ...buildMovers("server", serverSeries, prevWindowFrom, windowFrom, serverNames),
    ...buildMovers("model", modelSeries, prevWindowFrom, windowFrom),
    ...buildMovers("suite", suiteSeries, prevWindowFrom, windowFrom),
  ]
    .sort(moverRank)
    .slice(0, DIGEST_TOP_N);

  // New/regressed/resolved fleet issues (WP5.1) — "new" spans EVERY issue kind's firstSeenAt then
  // narrows to fleet ones client-side (a per-run auto-rating issue has no `fleet` block); regressed/
  // resolved are ALREADY fleet-only (a per-run issue's `lifecycle` column is NULL, so the lifecycle
  // filter excludes it at the SQL layer).
  const newIssues = issues
    .listAll({ firstSeenFrom: windowFrom, firstSeenTo: spanTo })
    .filter((i) => i.fleet !== undefined)
    .slice(0, DIGEST_TOP_N)
    .map(toIssueRef);
  const regressedIssues = issues
    .listAll({ lifecycle: "regressed", lastSeenFrom: windowFrom, lastSeenTo: spanTo })
    .slice(0, DIGEST_TOP_N)
    .map(toIssueRef);
  const resolvedIssues = issues
    .listAll({ lifecycle: "resolved", resolvedFrom: windowFrom, resolvedTo: spanTo })
    .slice(0, DIGEST_TOP_N)
    .map(toIssueRef);

  const topCostRuns = runs
    .queryRuns({ dateFrom: windowFrom, dateTo: spanTo }, { sort: { field: "costUsd", direction: "desc" }, limit: DIGEST_TOP_N })
    .filter((r) => r.costUsd > 0)
    .map((r) => toNotableRun(r, "top_cost"));
  const guardrailRuns = runs
    .queryRuns({ dateFrom: windowFrom, dateTo: spanTo, outcome: ["stopped_guardrail"] }, { limit: DIGEST_TOP_N })
    .map((r) => toNotableRun(r, "guardrail_stop"));

  const scanMetrics = computeScanMetrics(db, { from: prevWindowFrom, to: spanTo, bucket });
  const scanMovers = buildScanMovers(scanMetrics, windowFrom);

  return {
    id,
    windowKind,
    windowFrom,
    windowTo,
    prevWindowFrom,
    prevWindowTo,
    generatedAt,
    late,
    headline,
    newIssues,
    regressedIssues,
    resolvedIssues,
    movers,
    notableRuns: [...topCostRuns, ...guardrailRuns],
    scanMovers,
  };
}

// ── Persistence — append-only over `digest_reports` (v43), mirroring suite-run-reports ─────────────

export type DigestReportInsert = {
  windowKind: DigestWindowKind;
  windowFrom: string;
  windowTo: string;
  generatedAt: string;
  late: boolean;
  report: DigestReport;
};

export type DigestListFilter = {
  kind?: DigestWindowKind;
  limit?: number;
};

export class DigestReportRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Insert one digest row (append-only — `report.id` is the primary key, stamped by the composer). */
  insert(input: DigestReportInsert): DigestReport {
    this.db
      .prepare(
        `INSERT INTO digest_reports (id, window_kind, window_from, window_to, generated_at, late, report_json)
         VALUES (@id, @windowKind, @windowFrom, @windowTo, @generatedAt, @late, @reportJson)`,
      )
      .run({
        id: input.report.id,
        windowKind: input.windowKind,
        windowFrom: input.windowFrom,
        windowTo: input.windowTo,
        generatedAt: input.generatedAt,
        late: input.late ? 1 : 0,
        reportJson: stableStringify(input.report),
      });
    return this.get(input.report.id);
  }

  get(id: string): DigestReport {
    const row = this.db.prepare("SELECT * FROM digest_reports WHERE id = ?").get(id) as
      | DigestReportRow
      | undefined;
    if (!row) throw httpError(404, "Digest report not found");
    return toDigestReport(row);
  }

  /** Newest-first, optionally narrowed to one cadence. `limit` defaults to 25 (mirrors the collections/
   *  skills list conventions), capped implicitly by the caller's own zod-validated query bound. */
  list(filter: DigestListFilter = {}): DigestReport[] {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (filter.kind) {
      where.push("window_kind = @kind");
      params.kind = filter.kind;
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit =
      typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0
        ? Math.floor(filter.limit)
        : 25;
    const rows = this.db
      .prepare(
        `SELECT * FROM digest_reports ${whereSql} ORDER BY generated_at DESC, rowid DESC LIMIT @limit`,
      )
      .all({ ...params, limit }) as DigestReportRow[];
    return rows.map(toDigestReport);
  }

  /** The latest `window_to` EVER generated for a cadence (scheduled OR manual — a manual generate
   *  "counts" as covering that period too, so the scheduler never duplicates it). `null` = never
   *  generated. The scheduler's catch-up baseline. */
  latestWindowToByKind(kind: DigestWindowKind): string | null {
    const row = this.db
      .prepare(
        "SELECT window_to FROM digest_reports WHERE window_kind = ? ORDER BY window_to DESC LIMIT 1",
      )
      .get(kind) as { window_to: string } | undefined;
    return row?.window_to ?? null;
  }

  /** Prune digests older (by `generated_at`) than `days`; `days <= 0` is a no-op (mirrors
   *  `prune-notifications`'/`prune-assistant`'s "0 = disabled" convention). */
  pruneOlderThan(days: number): DigestPruneResult {
    if (!Number.isFinite(days) || days <= 0) {
      return { retentionDays: days, prunedDigestIds: [] };
    }
    const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();
    const victims = this.db
      .prepare("SELECT id FROM digest_reports WHERE generated_at < ?")
      .all(cutoff) as Array<{ id: string }>;
    if (victims.length === 0) return { retentionDays: days, prunedDigestIds: [] };
    const ids = victims.map((v) => v.id);
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM digest_reports WHERE id IN (${placeholders})`).run(...ids);
    return { retentionDays: days, prunedDigestIds: ids };
  }
}

function toDigestReport(row: DigestReportRow): DigestReport {
  return parseJsonObject<DigestReport>(row.report_json, emptyReportFallback(row));
}

/** A defensive fallback if a stored report_json is ever unparseable (should never happen — we
 *  serialize it ourselves via `stableStringify`). Mirrors `suite-report-repository.ts`'s own fallback. */
function emptyReportFallback(row: DigestReportRow): DigestReport {
  return {
    id: row.id,
    windowKind: row.window_kind,
    windowFrom: row.window_from,
    windowTo: row.window_to,
    prevWindowFrom: row.window_from,
    prevWindowTo: row.window_from,
    generatedAt: row.generated_at,
    late: row.late === 1,
    headline: { runs: { current: 0, previous: 0, delta: 0 }, errorRate: null, costByBasis: {} },
    newIssues: [],
    regressedIssues: [],
    resolvedIssues: [],
    movers: [],
    notableRuns: [],
    scanMovers: [],
  };
}

// ── Schedule — off | daily | weekly (+ hour), scheduler tick + manual on-demand generation ─────────

export type DigestNotifyFn = (report: DigestReport) => void;

/**
 * Owns the persisted {@link DigestSchedule} (`app_settings`) and the ONE generation path both the
 * scheduler tick and the manual route funnel through (`generateForWindowEnd`) — so a scheduled and a
 * manual digest for the same window are byte-for-byte the same shape, differing only in `late`.
 */
export class DigestScheduleService {
  constructor(
    private readonly deps: DigestComposerDeps,
    private readonly appSettings: AppSettingsRepository,
    private readonly repository: DigestReportRepository,
    private readonly notify: DigestNotifyFn,
    /** Injectable clock — defaults to `Date.now`; a test drives it deterministically (mirrors
     *  `WatchScheduler`'s own `now` seam). */
    private readonly now: () => number = Date.now,
  ) {}

  getSchedule(): DigestSchedule {
    const raw = this.appSettings.get(APP_SETTING_DIGEST_SCHEDULE_KEY);
    const parsed = digestScheduleSchema.safeParse(raw);
    return parsed.success ? parsed.data : { mode: "off", hourUtc: DIGEST_SCHEDULE_DEFAULT_HOUR_UTC };
  }

  setSchedule(schedule: DigestSchedule): DigestSchedule {
    const validated = digestScheduleSchema.parse(schedule);
    this.appSettings.put(APP_SETTING_DIGEST_SCHEDULE_KEY, validated);
    return validated;
  }

  /**
   * The `WatchScheduler`'s additive `onDigest` tick (boot catch-up once, then every interval — see
   * `watch/scheduler.ts`). Generates every DUE-and-not-yet-generated window for the current schedule
   * mode; each window is independently guarded (one failing generation can't blank the rest of a
   * catch-up run) — a strict observer, same discipline as the WP5.1 sweep riding the same ticker.
   */
  maybeGenerateDue(nowMs: number, opts: { boot: boolean }): void {
    const schedule = this.getSchedule();
    if (schedule.mode === "off") return;
    const kind = schedule.mode;
    const lastWindowTo = this.repository.latestWindowToByKind(kind);
    const lastMs = lastWindowTo ? Date.parse(lastWindowTo) : null;
    const { ends } = enumerateDigestWindowEnds(
      lastMs,
      nowMs,
      kind,
      schedule.hourUtc,
      DIGEST_CATCHUP_MAX_WINDOWS,
    );
    const late = opts.boot && lastMs !== null; // completed while the app was away (D-OB19)
    for (const endMs of ends) {
      try {
        this.generateForWindowEnd(kind, endMs, late);
      } catch {
        // Isolate — one failing window must never block the rest of a catch-up pass.
      }
    }
  }

  /**
   * Manual, on-demand generation (`POST /api/reports/digest/generate?window=…`) — always the most
   * recently COMPLETED calendar window for that cadence, regardless of the saved schedule/hour (an
   * explicit operator action wants the freshest data now, not to wait for the trigger hour). Never
   * flagged `late` — this IS the operator visiting, not a catch-up.
   */
  generateOnDemand(kind: DigestWindowKind): DigestReport {
    const endMs = calendarBoundary(this.now(), kind);
    return this.generateForWindowEnd(kind, endMs, false);
  }

  private generateForWindowEnd(kind: DigestWindowKind, endMs: number, late: boolean): DigestReport {
    const width = windowWidthMs(kind);
    const windowFrom = new Date(endMs - width).toISOString();
    const windowTo = new Date(endMs).toISOString();
    const generatedAt = new Date(this.now()).toISOString();
    const report = composeDigestReport(this.deps, {
      id: nanoid(),
      windowKind: kind,
      windowFrom,
      windowTo,
      generatedAt,
      late,
    });
    this.repository.insert({ windowKind: kind, windowFrom, windowTo, generatedAt, late, report });
    this.notify(report);
    return report;
  }
}
