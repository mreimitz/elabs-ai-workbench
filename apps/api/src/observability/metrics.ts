// Observability — metrics computation (roadmap/observability/, WP1.2, D-OB13/D-OB14).
//
// Time-bucketed, group-able aggregates over `runs` + `mcp_scans`, computed ON DEMAND (D-OB13 — no
// rollup cache; every number is recomputable from persisted rows and repeated calls are byte-identical).
// This module owns ALL metrics SQL (the architecture boundary keeps it out of `packages/shared`); the
// runs routes/repository are untouched (WP1.2 scope).
//
// ── Design choices (recorded for the WP report) ──────────────────────────────────────────────────
//  • Percentiles are computed IN-PROCESS (nearest-rank) over each bucket's collected duration values,
//    NOT via SQL window functions. SQLite ships NO PERCENTILE_CONT/DISC, so a SQL path would need a
//    per-(bucket,group) `ORDER BY … LIMIT 1 OFFSET floor(p·n)` correlated subquery — many extra
//    passes over the same rows. We already materialize each bucket's rows to compute count/error/token
//    sums, so sorting the small per-bucket duration array is effectively free (measured: the 50k-run /
//    30-day / day-bucket / grouped query stays well under the 500 ms budget — see metrics-perf.test.ts,
//    which also times a SQL-offset percentile for comparison). Nearest-rank is deterministic (no
//    interpolation), so repeated calls are identical.
//  • The RunFilter → SQL translation below MIRRORS the run-repository's private `buildRunFilterWhere`
//    (WP1.1) exactly. It is REPLICATED here (not imported) because the WP1.2 boundary forbids modifying
//    the runs repo, and `shared` deliberately holds no SQL. Both translations are anchored to the SAME
//    shared `matchesRunFilter` predicate by cross-check tests, so they cannot silently drift.
//  • Score selection REUSES the exported `PRIMARY_GRADER_PRIORITY` from the suites orchestrator and
//    replicates its tiny `pickOutcomeScore` (latest-per-grader → first priority grader with a graded
//    score). `meanScore` therefore equals the suite-analytics mean-grade selection on the same fixture
//    (acceptance #3), without modifying the orchestrator (outside this WP's file allowlist).
//  • Bucketing is floored in UTC (METRICS_TIMEZONE); a `week` bucket starts Monday 00:00:00 UTC.

import type {
  GraderId,
  MetricsBucket,
  ProviderKind,
  RunFilter,
  RunMetricsGroupBy,
  RunMetricsMeasure,
  RunMetricsResponse,
  RunMetricsSeries,
  ScanMetricsPoint,
  ScanMetricsResponse,
  SessionCostBasis,
  SessionTokenAccounting,
} from "@mcp-token-footprint/shared";
import { CAPABILITY_SPLIT_MEASURES, METRICS_TIMEZONE } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import { capabilitiesForProviderKind } from "../testing/session-capabilities.js";
import { PRIMARY_GRADER_PRIORITY } from "../suites/orchestrator.js";

// ── RunFilter → parameterized WHERE (mirror of run-repository's private builder — see header) ──────

function buildRunFilterWhere(filter: RunFilter): {
  clauses: string[];
  params: Record<string, string | number>;
} {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  let seq = 0;
  const bind = (value: string | number): string => {
    const name = `p${seq++}`;
    params[name] = value;
    return `@${name}`;
  };
  const bindList = (values: readonly (string | number)[]): string =>
    values.map((value) => bind(value)).join(", ");
  const nonEmpty = (values?: readonly string[]): values is string[] =>
    Array.isArray(values) && values.length > 0;

  if (nonEmpty(filter.status)) clauses.push(`status IN (${bindList(filter.status)})`);
  if (nonEmpty(filter.outcome)) clauses.push(`outcome IN (${bindList(filter.outcome)})`);
  if (nonEmpty(filter.stopReasonCode)) {
    clauses.push(`stop_reason_code IN (${bindList(filter.stopReasonCode)})`);
  }
  if (nonEmpty(filter.phase)) clauses.push(`phase IN (${bindList(filter.phase)})`);
  if (filter.seen !== undefined) clauses.push(`seen = ${bind(filter.seen ? 1 : 0)}`);
  if (nonEmpty(filter.scenarioId)) clauses.push(`scenario_id IN (${bindList(filter.scenarioId)})`);
  if (nonEmpty(filter.testId)) clauses.push(`test_id IN (${bindList(filter.testId)})`);
  if (filter.suiteRunId !== undefined) clauses.push(`suite_run_id = ${bind(filter.suiteRunId)}`);
  if (filter.interactiveOnly === true) clauses.push("mode = 'interactive'");
  // "Needs attention" as a filter (owner-requested) — REPLICATED from run-repository's
  // `buildRunFilterWhere` EXACTLY (mirrors the shared `runNeedsAttention` predicate). NULL-safe via
  // COALESCE so the negation is exact; kept in agreement by the SQL-vs-predicate cross-check test.
  if (filter.needsAttention !== undefined) {
    const predicate =
      "((status = 'running' AND COALESCE(phase, '') = 'waiting_input') OR (COALESCE(seen, 0) = 0 AND status <> 'running'))";
    clauses.push(filter.needsAttention ? predicate : `NOT ${predicate}`);
  }
  if (filter.hasError !== undefined) {
    const predicate = "(status = 'error' OR COALESCE(outcome, '') = 'error')";
    clauses.push(filter.hasError ? predicate : `NOT ${predicate}`);
  }
  if (filter.costUsdGte !== undefined) clauses.push(`cost_usd >= ${bind(filter.costUsdGte)}`);
  if (filter.costUsdLte !== undefined) clauses.push(`cost_usd <= ${bind(filter.costUsdLte)}`);
  if (filter.tokensGte !== undefined) {
    clauses.push(`(tokens_in + tokens_out) >= ${bind(filter.tokensGte)}`);
  }
  if (filter.tokensLte !== undefined) {
    clauses.push(`(tokens_in + tokens_out) <= ${bind(filter.tokensLte)}`);
  }
  if (filter.durationMsGte !== undefined) {
    clauses.push(`COALESCE(active_duration_ms, total_duration_ms) >= ${bind(filter.durationMsGte)}`);
  }
  if (filter.durationMsLte !== undefined) {
    clauses.push(`COALESCE(active_duration_ms, total_duration_ms) <= ${bind(filter.durationMsLte)}`);
  }
  if (filter.dateFrom !== undefined) clauses.push(`started_at >= ${bind(filter.dateFrom)}`);
  if (filter.dateTo !== undefined) clauses.push(`started_at <= ${bind(filter.dateTo)}`);

  if (nonEmpty(filter.providerKind)) {
    clauses.push(
      `scenario_id IN (SELECT s.id FROM scenarios s JOIN provider_credentials pc ON pc.id = s.provider_id WHERE pc.kind IN (${bindList(
        filter.providerKind,
      )}))`,
    );
  }
  if (nonEmpty(filter.model)) {
    clauses.push(
      `scenario_id IN (SELECT id FROM scenarios WHERE model IN (${bindList(filter.model)}))`,
    );
  }
  if (nonEmpty(filter.serverId)) {
    clauses.push(
      `EXISTS (SELECT 1 FROM scenario_servers ss WHERE ss.scenario_id = runs.scenario_id AND ss.server_id IN (${bindList(
        filter.serverId,
      )}))`,
    );
  }
  if (nonEmpty(filter.skillId)) {
    clauses.push(
      `EXISTS (SELECT 1 FROM run_skills rk WHERE rk.run_id = runs.id AND rk.skill_id IN (${bindList(
        filter.skillId,
      )}))`,
    );
  }
  if (filter.suiteId !== undefined) {
    clauses.push(
      `suite_run_id IN (SELECT id FROM suite_runs WHERE suite_id = ${bind(filter.suiteId)})`,
    );
  }
  if (filter.collectionId !== undefined) {
    const collectionParam = bind(filter.collectionId);
    clauses.push(
      `(test_id IN (SELECT id FROM tests WHERE collection_id = ${collectionParam}) OR ` +
        `suite_run_id IN (SELECT sr.id FROM suite_runs sr JOIN suites su ON su.id = sr.suite_id WHERE su.collection_id = ${collectionParam}))`,
    );
  }

  if (
    filter.scoreGte !== undefined ||
    filter.scoreLte !== undefined ||
    filter.grader !== undefined
  ) {
    const parts = ["g.run_id = runs.id", "g.score IS NOT NULL"];
    if (filter.grader !== undefined) parts.push(`g.grader_id = ${bind(filter.grader)}`);
    if (filter.scoreGte !== undefined) parts.push(`g.score >= ${bind(filter.scoreGte)}`);
    if (filter.scoreLte !== undefined) parts.push(`g.score <= ${bind(filter.scoreLte)}`);
    parts.push(
      "g.created_at = (SELECT MAX(g2.created_at) FROM run_grades g2 WHERE g2.run_id = g.run_id AND g2.grader_id = g.grader_id)",
    );
    clauses.push(`EXISTS (SELECT 1 FROM run_grades g WHERE ${parts.join(" AND ")})`);
  }

  // Retention classes (WP1.6) — `runs.pinned` is now a REAL column (mirrors run-repository's
  // `buildRunFilterWhere` `seen` clause exactly). Kept in agreement by the cross-check test.
  if (filter.pinned !== undefined) clauses.push(`pinned = ${bind(filter.pinned ? 1 : 0)}`);

  // Human feedback (WP1.5) — `run_feedback` is now a REAL table (mirrors run-repository's
  // `buildRunFilterWhere` EXACTLY — kept in agreement by the cross-check test). An EMPTY
  // `feedback: {}` imposes NO constraint; `key`/`hasScore:true` narrow via a correlated EXISTS.
  if (filter.feedback !== undefined) {
    const parts = ["f.run_id = runs.id"];
    if (filter.feedback.key !== undefined) parts.push(`f.key = ${bind(filter.feedback.key)}`);
    if (filter.feedback.hasScore === true) parts.push("f.score IS NOT NULL");
    if (parts.length > 1) {
      clauses.push(`EXISTS (SELECT 1 FROM run_feedback f WHERE ${parts.join(" AND ")})`);
    }
  }

  // Fork lineage (WP3.3, D-OB18) — `runs.derived_from_run_id` is now a REAL column. DEFAULT EXCLUDE:
  // `derived:true` keeps only forked runs, absent/`false` excludes them. Mirrors run-repository's
  // `buildRunFilterWhere` + the pure `matchesRunFilter` predicate EXACTLY — kept in agreement by the
  // cross-check test.
  if (filter.derived === true) clauses.push("derived_from_run_id IS NOT NULL");
  else clauses.push("derived_from_run_id IS NULL");

  return { clauses, params };
}

// ── UTC bucketing (timezone-safe — METRICS_TIMEZONE) ──────────────────────────────────────────────

/** Floor an ISO-8601 timestamp to its bucket START in UTC, returned as an ISO-8601 string. `week` is a
 *  Monday-start ISO week. Returns `null` when the timestamp is unparseable (row excluded, never guessed). */
export function bucketStartUtc(iso: string, bucket: MetricsBucket): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  if (bucket === "hour") {
    return new Date(Date.UTC(y, mo, day, d.getUTCHours())).toISOString();
  }
  if (bucket === "day") {
    return new Date(Date.UTC(y, mo, day)).toISOString();
  }
  // week — floor to the Monday 00:00:00 UTC of this date's ISO week.
  const midnight = Date.UTC(y, mo, day);
  const dow = new Date(midnight).getUTCDay(); // 0=Sun … 6=Sat
  const daysFromMonday = (dow + 6) % 7; // Mon→0, Sun→6
  return new Date(midnight - daysFromMonday * 86_400_000).toISOString();
}

/** Nearest-rank percentile (`p` in 0..100) over a value array; caller guarantees `values.length > 0`. */
function percentileNearestRank(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = Math.ceil((p / 100) * n);
  const idx = Math.min(Math.max(rank, 1), n) - 1;
  return sorted[idx] as number;
}

// ── Capability class resolution (D-OB14 — from persisted capabilities_json, NOT a providerKind fork) ──

type CapabilityClass = { tokens: SessionTokenAccounting; costBasis: SessionCostBasis };

/**
 * The token / cost-basis capability class of a run. Read from the persisted `capabilities_json` manifest;
 * a legacy run (NULL manifest, persisted before Unified Sessions) falls back to the STATIC per-kind
 * manifest (`capabilitiesForProviderKind`) — the SAME session-contract source of truth the executors
 * emit, never a bespoke `providerKind === …` branch in the aggregation.
 */
function capabilityClassForRun(
  capabilitiesJson: string | null,
  providerKind: ProviderKind,
): CapabilityClass {
  if (capabilitiesJson) {
    try {
      const parsed = JSON.parse(capabilitiesJson) as Partial<CapabilityClass>;
      if (
        (parsed.tokens === "exact" ||
          parsed.tokens === "estimated" ||
          parsed.tokens === "none") &&
        (parsed.costBasis === "api_exact" ||
          parsed.costBasis === "subscription_reference" ||
          parsed.costBasis === "questions" ||
          parsed.costBasis === "none")
      ) {
        return { tokens: parsed.tokens, costBasis: parsed.costBasis };
      }
    } catch {
      // fall through to the static manifest
    }
  }
  const fallback = capabilitiesForProviderKind(providerKind);
  return { tokens: fallback.tokens, costBasis: fallback.costBasis };
}

// ── Runs metrics ─────────────────────────────────────────────────────────────────────────────────

export type RunMetricsParams = {
  filter: RunFilter;
  from?: string;
  to?: string;
  bucket: MetricsBucket;
  groupBy?: RunMetricsGroupBy;
  measures: RunMetricsMeasure[];
};

type RunRowForMetrics = {
  id: string;
  started_at: string;
  status: string;
  outcome: string | null;
  active_duration_ms: number | null;
  total_duration_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  turns: number;
  capabilities_json: string | null;
  scenario_id: string;
  test_id: string;
  suite_run_id: string | null;
  stop_reason_code: string | null;
};

/** Per-(group, bucket) accumulator built in ONE pass over the filtered run rows. */
type BucketAcc = {
  count: number;
  errorCount: number;
  guardrailCount: number;
  durations: number[];
  durationFallbackUsed: boolean;
  scoreSum: number;
  scoreN: number;
  tokens: Map<SessionTokenAccounting, { inSum: number; outSum: number; n: number }>;
  cost: Map<SessionCostBasis, { sum: number; n: number }>;
  questionsSum: number;
  questionsN: number;
};

function newBucketAcc(): BucketAcc {
  return {
    count: 0,
    errorCount: 0,
    guardrailCount: 0,
    durations: [],
    durationFallbackUsed: false,
    scoreSum: 0,
    scoreN: 0,
    tokens: new Map(),
    cost: new Map(),
    questionsSum: 0,
    questionsN: 0,
  };
}

/** Compose the shared filter WHERE with the metrics window into one clause list + param bag. */
function composeWindowWhere(params: RunMetricsParams): {
  where: string;
  bind: Record<string, string | number>;
} {
  const built = buildRunFilterWhere(params.filter);
  const clauses = [...built.clauses];
  const bind = { ...built.params };
  if (params.from !== undefined) {
    clauses.push("started_at >= @__from");
    bind.__from = params.from;
  }
  if (params.to !== undefined) {
    clauses.push("started_at <= @__to");
    bind.__to = params.to;
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", bind };
}

export function computeRunMetrics(db: AppDatabase, params: RunMetricsParams): RunMetricsResponse {
  const { where, bind } = composeWindowWhere(params);
  const measures = params.measures;
  const wantMeanScore = measures.includes("meanScore");

  const rows = db
    .prepare(
      `SELECT id, started_at, status, outcome, active_duration_ms, total_duration_ms,
              tokens_in, tokens_out, cost_usd, turns, capabilities_json, scenario_id, test_id,
              suite_run_id, stop_reason_code
         FROM runs ${where}`,
    )
    .all(bind) as RunRowForMetrics[];

  // Small lookup maps (whole-table reads; scenarios/providers/suite_runs are low-cardinality).
  const scenarioMeta = new Map<string, { model: string; providerKind: ProviderKind; providerId: string }>();
  for (const r of db
    .prepare(
      "SELECT s.id AS id, s.model AS model, s.provider_id AS provider_id, pc.kind AS kind FROM scenarios s JOIN provider_credentials pc ON pc.id = s.provider_id",
    )
    .all() as Array<{ id: string; model: string; provider_id: string; kind: ProviderKind }>) {
    scenarioMeta.set(r.id, { model: r.model, providerKind: r.kind, providerId: r.provider_id });
  }
  const suiteBySuiteRun = new Map<string, string | null>();
  for (const r of db.prepare("SELECT id, suite_id FROM suite_runs").all() as Array<{
    id: string;
    suite_id: string | null;
  }>) {
    suiteBySuiteRun.set(r.id, r.suite_id);
  }

  const scenarioServers = new Map<string, string[]>();
  if (params.groupBy === "server") {
    for (const r of db.prepare("SELECT scenario_id, server_id FROM scenario_servers").all() as Array<{
      scenario_id: string;
      server_id: string;
    }>) {
      const list = scenarioServers.get(r.scenario_id) ?? [];
      list.push(r.server_id);
      scenarioServers.set(r.scenario_id, list);
    }
  }
  const runSkills = new Map<string, string[]>();
  if (params.groupBy === "skill") {
    for (const r of db
      .prepare(
        `SELECT run_id, skill_id FROM run_skills WHERE run_id IN (SELECT id FROM runs ${where})`,
      )
      .all(bind) as Array<{ run_id: string; skill_id: string }>) {
      const list = runSkills.get(r.run_id) ?? [];
      list.push(r.skill_id);
      runSkills.set(r.run_id, list);
    }
  }

  // Per-run outcome score (only when meanScore requested) — latest-per-grader, PRIMARY_GRADER_PRIORITY.
  const outcomeScoreByRun = new Map<string, number>();
  if (wantMeanScore) {
    const gradeRows = db
      .prepare(
        `SELECT run_id, grader_id, score FROM run_grades
          WHERE status = 'graded' AND score IS NOT NULL
            AND run_id IN (SELECT id FROM runs ${where})
          ORDER BY created_at ASC, rowid ASC`,
      )
      .all(bind) as Array<{ run_id: string; grader_id: string; score: number }>;
    // last-write-wins per (run, grader) mirrors GradeRepository.latestByRun (created_at ASC, rowid ASC).
    const latest = new Map<string, Map<string, number>>();
    for (const g of gradeRows) {
      let byGrader = latest.get(g.run_id);
      if (!byGrader) {
        byGrader = new Map();
        latest.set(g.run_id, byGrader);
      }
      byGrader.set(g.grader_id, g.score);
    }
    for (const [runId, byGrader] of latest) {
      for (const graderId of PRIMARY_GRADER_PRIORITY) {
        const score = byGrader.get(graderId as GraderId);
        if (score !== undefined) {
          outcomeScoreByRun.set(runId, score);
          break;
        }
      }
    }
  }

  // Resolve the group key(s) a run contributes to (empty ⇒ the run has no value for the dimension).
  const groupKeysFor = (row: RunRowForMetrics): (string | null)[] => {
    switch (params.groupBy) {
      case undefined:
        return [null];
      case "model": {
        const v = scenarioMeta.get(row.scenario_id)?.model;
        return v ? [v] : [];
      }
      case "provider": {
        const v = scenarioMeta.get(row.scenario_id)?.providerId;
        return v ? [v] : [];
      }
      case "providerKind": {
        const v = scenarioMeta.get(row.scenario_id)?.providerKind;
        return v ? [v] : [];
      }
      case "environment":
        return [row.scenario_id];
      case "test":
        return [row.test_id];
      case "stopReasonCode":
        return row.stop_reason_code ? [row.stop_reason_code] : [];
      case "suite": {
        const suiteId = row.suite_run_id ? suiteBySuiteRun.get(row.suite_run_id) : undefined;
        return suiteId ? [suiteId] : [];
      }
      case "server":
        return scenarioServers.get(row.scenario_id) ?? [];
      case "skill":
        return runSkills.get(row.id) ?? [];
    }
  };

  // group → bucketStart → acc
  const byGroup = new Map<string | null, Map<string, BucketAcc>>();
  for (const row of rows) {
    const bucketStart = bucketStartUtc(row.started_at, params.bucket);
    if (bucketStart === null) continue;
    const meta = scenarioMeta.get(row.scenario_id);
    const cap = capabilityClassForRun(row.capabilities_json, meta?.providerKind ?? "anthropic");
    const isError = row.status === "error" || row.outcome === "error";
    const isGuardrail = row.outcome === "stopped_guardrail";
    const duration = row.active_duration_ms ?? row.total_duration_ms;
    const usedFallback = row.active_duration_ms === null && row.total_duration_ms !== null;
    const outcomeScore = outcomeScoreByRun.get(row.id);

    for (const group of groupKeysFor(row)) {
      let buckets = byGroup.get(group);
      if (!buckets) {
        buckets = new Map();
        byGroup.set(group, buckets);
      }
      let acc = buckets.get(bucketStart);
      if (!acc) {
        acc = newBucketAcc();
        buckets.set(bucketStart, acc);
      }
      acc.count += 1;
      if (isError) acc.errorCount += 1;
      if (isGuardrail) acc.guardrailCount += 1;
      if (duration !== null && duration !== undefined) {
        acc.durations.push(duration);
        if (usedFallback) acc.durationFallbackUsed = true;
      }
      if (outcomeScore !== undefined) {
        acc.scoreSum += outcomeScore;
        acc.scoreN += 1;
      }
      const tk = acc.tokens.get(cap.tokens) ?? { inSum: 0, outSum: 0, n: 0 };
      tk.inSum += row.tokens_in;
      tk.outSum += row.tokens_out;
      tk.n += 1;
      acc.tokens.set(cap.tokens, tk);
      const ct = acc.cost.get(cap.costBasis) ?? { sum: 0, n: 0 };
      ct.sum += row.cost_usd;
      ct.n += 1;
      acc.cost.set(cap.costBasis, ct);
      if (cap.costBasis === "questions") {
        acc.questionsSum += row.turns;
        acc.questionsN += 1;
      }
    }
  }

  const series = buildRunSeries(byGroup, measures);
  const unavailableMeasures = measures.filter((m) => m === "feedbackRate");

  return {
    bucket: params.bucket,
    timezone: METRICS_TIMEZONE,
    from: params.from ?? null,
    to: params.to ?? null,
    groupBy: params.groupBy ?? null,
    measures,
    unavailableMeasures,
    series,
  };
}

/** Turn the per-(group,bucket) accumulators into the flat, deterministically-ordered series list. */
function buildRunSeries(
  byGroup: Map<string | null, Map<string, BucketAcc>>,
  measures: RunMetricsMeasure[],
): RunMetricsSeries[] {
  const out: RunMetricsSeries[] = [];
  // Deterministic group order: nulls last, otherwise lexical (repeated calls identical — acceptance #5).
  const groups = [...byGroup.keys()].sort((a, b) => {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const group of groups) {
    const buckets = byGroup.get(group) as Map<string, BucketAcc>;
    const bucketStarts = [...buckets.keys()].sort();
    for (const measure of measures) {
      if (measure === "feedbackRate") continue; // no backing store yet (→ unavailableMeasures)

      if (!(CAPABILITY_SPLIT_MEASURES as readonly string[]).includes(measure)) {
        const points: { bucketStart: string; value: number; n: number }[] = [];
        let durationFallback = false;
        for (const bucketStart of bucketStarts) {
          const acc = buckets.get(bucketStart) as BucketAcc;
          const point = scalarPoint(measure, acc, bucketStart);
          if (point) {
            points.push(point);
            if ((measure === "p50DurationMs" || measure === "p95DurationMs") && acc.durationFallbackUsed) {
              durationFallback = true;
            }
          }
        }
        if (points.length === 0) continue;
        const s: RunMetricsSeries = { measure, group, capabilityClass: null, points };
        if (measure === "p50DurationMs" || measure === "p95DurationMs") s.durationFallback = durationFallback;
        out.push(s);
        continue;
      }

      // Capability-split measure → one labelled series per class present (never a blended sum).
      const classPoints = new Map<string, { bucketStart: string; value: number; n: number }[]>();
      for (const bucketStart of bucketStarts) {
        const acc = buckets.get(bucketStart) as BucketAcc;
        for (const [cls, value, n] of splitPoints(measure, acc)) {
          const list = classPoints.get(cls) ?? [];
          list.push({ bucketStart, value, n });
          classPoints.set(cls, list);
        }
      }
      for (const cls of [...classPoints.keys()].sort()) {
        out.push({
          measure,
          group,
          capabilityClass: cls,
          points: classPoints.get(cls) as { bucketStart: string; value: number; n: number }[],
        });
      }
    }
  }
  return out;
}

/** A non-split measure's point for one bucket, or `null` to OMIT the bucket (no data — never zero-fill). */
function scalarPoint(
  measure: RunMetricsMeasure,
  acc: BucketAcc,
  bucketStart: string,
): { bucketStart: string; value: number; n: number } | null {
  switch (measure) {
    case "count":
      return { bucketStart, value: acc.count, n: acc.count };
    case "errorRate":
      return { bucketStart, value: acc.errorCount / acc.count, n: acc.count };
    case "guardrailRate":
      return { bucketStart, value: acc.guardrailCount / acc.count, n: acc.count };
    case "p50DurationMs":
      if (acc.durations.length === 0) return null;
      return { bucketStart, value: percentileNearestRank(acc.durations, 50), n: acc.durations.length };
    case "p95DurationMs":
      if (acc.durations.length === 0) return null;
      return { bucketStart, value: percentileNearestRank(acc.durations, 95), n: acc.durations.length };
    case "meanScore":
      if (acc.scoreN === 0) return null; // no graded run in this bucket — omit (never a 0)
      return { bucketStart, value: acc.scoreSum / acc.scoreN, n: acc.scoreN };
    default:
      return null;
  }
}

/** A capability-split measure's per-class values for one bucket: `[classLabel, value, n]`. */
function splitPoints(measure: RunMetricsMeasure, acc: BucketAcc): [string, number, number][] {
  const out: [string, number, number][] = [];
  if (measure === "tokensIn") {
    for (const [cls, t] of acc.tokens) out.push([cls, t.inSum, t.n]);
  } else if (measure === "tokensOut") {
    for (const [cls, t] of acc.tokens) out.push([cls, t.outSum, t.n]);
  } else if (measure === "costUsd") {
    for (const [cls, c] of acc.cost) out.push([cls, c.sum, c.n]);
  } else if (measure === "questions") {
    if (acc.questionsN > 0) out.push(["questions", acc.questionsSum, acc.questionsN]);
  }
  return out;
}

// ── Scans metrics ────────────────────────────────────────────────────────────────────────────────

export type ScanMetricsParams = {
  from?: string;
  to?: string;
  bucket: MetricsBucket;
  serverId?: string;
};

type ScanRow = {
  server_id: string;
  server_name: string | null;
  token_profile: string;
  scanned_at: string;
  status: string;
  total_tokens: number;
  total_resource_tokens: number;
  total_prompt_tokens: number;
  total_tools: number;
  total_resources: number;
  total_resource_templates: number;
  total_prompts: number;
  counting_version: number;
};

export function computeScanMetrics(db: AppDatabase, params: ScanMetricsParams): ScanMetricsResponse {
  const clauses: string[] = [];
  const bind: Record<string, string> = {};
  if (params.from !== undefined) {
    clauses.push("scanned_at >= @from");
    bind.from = params.from;
  }
  if (params.to !== undefined) {
    clauses.push("scanned_at <= @to");
    bind.to = params.to;
  }
  if (params.serverId !== undefined) {
    clauses.push("sc.server_id = @serverId");
    bind.serverId = params.serverId;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT sc.server_id AS server_id, srv.name AS server_name, sc.token_profile AS token_profile,
              sc.scanned_at AS scanned_at, sc.status AS status, sc.total_tokens AS total_tokens,
              sc.total_resource_tokens AS total_resource_tokens, sc.total_prompt_tokens AS total_prompt_tokens,
              sc.total_tools AS total_tools, sc.total_resources AS total_resources,
              sc.total_resource_templates AS total_resource_templates, sc.total_prompts AS total_prompts,
              sc.counting_version AS counting_version
         FROM mcp_scans sc LEFT JOIN mcp_servers srv ON srv.id = sc.server_id ${where}`,
    )
    .all(bind) as ScanRow[];

  // (server, profile) → bucketStart → the bucket's scans.
  type BucketScans = { scans: ScanRow[] };
  const bySeries = new Map<string, { serverName: string | null; buckets: Map<string, BucketScans> }>();
  const seriesKey = (serverId: string, profile: string) => `${serverId} ${profile}`;

  for (const row of rows) {
    const bucketStart = bucketStartUtc(row.scanned_at, params.bucket);
    if (bucketStart === null) continue;
    const key = seriesKey(row.server_id, row.token_profile);
    let series = bySeries.get(key);
    if (!series) {
      series = { serverName: row.server_name, buckets: new Map() };
      bySeries.set(key, series);
    }
    let bucket = series.buckets.get(bucketStart);
    if (!bucket) {
      bucket = { scans: [] };
      series.buckets.set(bucketStart, bucket);
    }
    bucket.scans.push(row);
  }

  const seriesList = [...bySeries.entries()]
    .map(([key, series]) => {
      const [serverId, tokenProfile] = key.split(" ") as [string, string];
      const points: ScanMetricsPoint[] = [];
      const bucketStarts = [...series.buckets.keys()].sort();
      let prev: ScanMetricsPoint | null = null;
      for (const bucketStart of bucketStarts) {
        const scans = (series.buckets.get(bucketStart) as BucketScans).scans;
        const terminal = scans.filter((s) => s.status === "success" || s.status === "failed");
        const failed = scans.filter((s) => s.status === "failed").length;
        // Representative footprint = the LATEST SUCCESS scan in the bucket (a point-in-time snapshot).
        const successes = scans
          .filter((s) => s.status === "success")
          .sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : a.scanned_at > b.scanned_at ? 1 : 0));
        const rep = successes.length > 0 ? (successes[successes.length - 1] as ScanRow) : null;
        const toolTokens = rep ? rep.total_tokens : null;
        const resourceTokens = rep ? rep.total_resource_tokens : null;
        const promptTokens = rep ? rep.total_prompt_tokens : null;
        const totalTokens =
          rep ? rep.total_tokens + rep.total_resource_tokens + rep.total_prompt_tokens : null;
        const countingVersion = rep ? rep.counting_version : null;
        // Δ vs previous — only when both points have a footprint under the SAME counting_version.
        const deltaComparable =
          prev !== null &&
          prev.totalTokens !== null &&
          totalTokens !== null &&
          prev.countingVersion !== null &&
          countingVersion !== null &&
          prev.countingVersion === countingVersion;
        const point: ScanMetricsPoint = {
          bucketStart,
          scanCount: scans.length,
          failureRate: terminal.length > 0 ? failed / terminal.length : 0,
          countingVersion,
          totalTokens,
          toolTokens,
          resourceTokens,
          promptTokens,
          totalTools: rep ? rep.total_tools : null,
          totalResources: rep ? rep.total_resources : null,
          totalResourceTemplates: rep ? rep.total_resource_templates : null,
          totalPrompts: rep ? rep.total_prompts : null,
          deltaTotalTokens: deltaComparable
            ? (totalTokens as number) - (prev?.totalTokens as number)
            : null,
          deltaComparable: Boolean(deltaComparable),
        };
        points.push(point);
        prev = point;
      }
      return { serverId, serverName: series.serverName, tokenProfile, points };
    })
    // Deterministic series order (server, then profile).
    .sort((a, b) =>
      a.serverId < b.serverId
        ? -1
        : a.serverId > b.serverId
          ? 1
          : a.tokenProfile < b.tokenProfile
            ? -1
            : a.tokenProfile > b.tokenProfile
              ? 1
              : 0,
    );

  return {
    bucket: params.bucket,
    timezone: METRICS_TIMEZONE,
    from: params.from ?? null,
    to: params.to ?? null,
    servers: seriesList,
  };
}
