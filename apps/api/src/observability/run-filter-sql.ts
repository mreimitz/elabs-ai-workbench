// Observability — the ONE RunFilter → parameterized SQL translation (WP1.1/WP1.2, D-OB1;
// consolidated by RM-17 Phase 6, AM-OB4).
//
// ── Why this file exists ─────────────────────────────────────────────────────────────────────────
// Until AM-OB4 there were TWO byte-identical copies of this builder — one private to
// `testing/run-repository.ts` (the runs feed) and a replica in `observability/metrics.ts` (the
// charts) — kept honest by a comment claiming both were pinned to the shared `matchesRunFilter`
// predicate. Only ONE of them was: the cross-check exercised `queryRuns`, so the metrics replica
// could drift silently, and a drift there is not a crash — it is a chart that quietly answers a
// different question than the feed beside it.
//
// AM-OB4 needed a THIRD use (a ratio's numerator, projected as a column onto the same scan), which
// would have made a two-copy problem a three-copy one. So the copies were collapsed into this
// module instead. It lives in `observability/` beside `rating-filter-sql.ts`, which
// `run-repository.ts` already imports for exactly this reason.
//
// ── The contract ─────────────────────────────────────────────────────────────────────────────────
//  • Every VALUE is bound via a generated `@pN` name — nothing is string-interpolated. Array fields
//    expand to `IN (@p0, @p1, …)`; joins are correlated subqueries against existing tables, so the
//    caller's SELECT stays single-table (no fan-out, no DISTINCT) and nothing is denormalized.
//  • Clauses reference the driving table as `runs`, so a caller must select `FROM runs` (both do).
//  • Semantics MIRROR the pure `matchesRunFilter` predicate in `shared/run-filter.ts` EXACTLY, and
//    `apps/api/test/runs-filter.test.ts` now runs its whole cross-check table through BOTH the
//    repository AND `computeRunMetrics` — so this file is pinned to the predicate from both sides.
//  • `filter.q` (full-text) is NOT handled here. The runs repository ANDs its own FTS subquery in
//    afterwards; the metrics service has no FTS path and its route rejects `q` outright.
//
// ── The one field where "absent" is not "no constraint" ──────────────────────────────────────────
// `derived` DEFAULT-EXCLUDES: an absent (or `false`) `derived` emits `derived_from_run_id IS NULL`,
// because the runs feed hides forks unless asked. Every caller composing a SECOND filter on top of a
// first (AM-OB4's ratio sides) must therefore inherit the parent's `derived` — see
// `inheritDerived` below.

import type { RunFilter } from "@mcp-token-footprint/shared";
import { ratingFindingClause, ratingVerdictClause } from "./rating-filter-sql.js";

/**
 * Carry the parent filter's `derived` onto a sub-filter that does not set one.
 *
 * Needed because `derived` is the single field whose ABSENCE is a constraint (`IS NULL`, above).
 * A ratio numerator like `{ outcome: ["error"] }` says nothing about forks and means "no further
 * constraint on forks" — but composed naively against a `derived: true` chart it would emit
 * `derived_from_run_id IS NULL` and intersect the parent's `IS NOT NULL` to exactly nothing. The
 * numerator would then read as a flat 0%, which is the failure mode this workstream keeps finding:
 * a plausible number that means "the query was impossible".
 */
export function inheritDerived(parent: RunFilter, side: RunFilter): RunFilter {
  if (side.derived !== undefined || parent.derived === undefined) return side;
  return { ...side, derived: parent.derived };
}

// ── RunFilter → parameterized WHERE ───────────────────────────────────────────────────────────────

export function buildRunFilterWhere(filter: RunFilter): {
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
    // AM-OB4 — `any: true` narrows to "carries at least one feedback row", which the correlated
    // EXISTS already expresses on its own: it needs no extra predicate, only the guard below to stop
    // treating the clause as empty. This is the numerator `feedbackRate` is built from.
    if (filter.feedback.any === true || parts.length > 1) {
      clauses.push(`EXISTS (SELECT 1 FROM run_feedback f WHERE ${parts.join(" AND ")})`);
    }
  }

  // Fork lineage (WP3.3, D-OB18) — `runs.derived_from_run_id` is now a REAL column. DEFAULT EXCLUDE:
  // `derived:true` keeps only forked runs, absent/`false` excludes them. Mirrors run-repository's
  // `buildRunFilterWhere` + the pure `matchesRunFilter` predicate EXACTLY — kept in agreement by the
  // cross-check test.
  if (filter.derived === true) clauses.push("derived_from_run_id IS NOT NULL");
  else clauses.push("derived_from_run_id IS NULL");

  // Auto-rating dimensions (RM-17 Phase 6, AM-OB12) — the ONE definition lives in
  // `rating-filter-sql.ts` and is imported by BOTH `buildRunFilterWhere` copies, so these four
  // clauses cannot drift the way the rest of this replica can. AR6: a read of what the graders
  // already persisted, never a write or a reinterpretation.
  if (nonEmpty(filter.answerVerdict)) {
    clauses.push(ratingVerdictClause("answer_validation", filter.answerVerdict, bind, bindList));
  }
  if (nonEmpty(filter.insightVerdict)) {
    clauses.push(ratingVerdictClause("insight_surplus", filter.insightVerdict, bind, bindList));
  }
  if (nonEmpty(filter.errorBucket)) {
    clauses.push(ratingFindingClause("bucket", filter.errorBucket, bind, bindList));
  }
  if (nonEmpty(filter.errorFixTarget)) {
    clauses.push(ratingFindingClause("fixTarget", filter.errorFixTarget, bind, bindList));
  }

  return { clauses, params };
}
