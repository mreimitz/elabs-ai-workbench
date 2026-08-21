// Observability — the RunFilter auto-rating dimensions, translated to SQL (RM-17 Phase 6, AM-OB12).
//
// ONE definition, imported by BOTH `buildRunFilterWhere` copies (`observability/metrics.ts` and the
// module-private one in `testing/run-repository.ts`). The rest of that translation is still
// duplicated — closing THAT is AM-OB4's (WP 6.4) recorded job — but there was no reason to make it
// a three-copy problem on the way past: these clauses are the fiddliest in the grammar, and a
// divergence between them would be a silently wrong quality metric rather than a loud failure.
//
// ── What is being read ────────────────────────────────────────────────────────────────────────────
// RM-06's three always-on base graders write ordinary `run_grades` rows whose `evidence_json` holds
// the verdict (`answer_validation` / `insight_surplus`: one object with a `verdict`) or the finding
// inventory (`error_forensics`: an ARRAY of `ErrorFinding`, each with `bucket` + `fixTarget`).
// Nothing here writes, rescoring or reinterprets a grade — AR6 holds: this is a read.
//
// ── The two rules the pure `matchesRunFilter` predicate also implements ───────────────────────────
//  1. LATEST WINS. `run_grades` is append-only, so a re-rate leaves the old verdict in place. Only
//     the MAX(created_at) row per (run, grader) is consulted — the same rule `scoreGte`/`grader`
//     already use. A `created_at` tie matches EITHER row here, which is why the predicate's
//     candidate carries every tied verdict as an array rather than picking one.
//  2. ABSENT IS NOT A VALUE. A run with no rating (or unreadable evidence) satisfies NO verdict
//     filter. It is excluded, never counted as some default verdict — the AM-OB10 failure mode,
//     where an absence read as a healthy value.
//
// ── JSON safety, which is not optional here ───────────────────────────────────────────────────────
// SQLite's JSON1 functions THROW on malformed input rather than returning NULL: `json_extract('x',
// '$.v')`, `json_type('x')` and `json_each('x')` all raise "malformed JSON", and one such row would
// take down the whole runs feed, not just its own match. `evidence_json` is written by
// `stableStringify` today so it is always valid or NULL, but a filter must not depend on that.
// Hence, verified against SQLite 3.53.2:
//   • `json_valid()` is total — NULL for NULL, 0 for garbage, never a throw.
//   • Every extraction is wrapped in `CASE`, which is the one construct SQLite guarantees evaluates
//     in order; a bare `json_valid(x) AND json_extract(x, …)` may be reordered by the planner, and
//     one reordering is a query that RAISES rather than a row that misses.
//   • `json_each` is fed `'[]'` for anything that is not a valid JSON ARRAY, and yields zero rows for
//     `'[]'`/NULL. The array check matters on its own: `json_each` over an OBJECT walks that object's
//     members, so a nested `{"bucket":…}` would match in SQL while `matchesRunFilter`'s
//     `Array.isArray` refused it. The cross-check caught exactly that.
//   • Each member is then guarded by `je.type = 'object'` before `json_extract`, because an array of
//     scalars yields scalar members and `json_extract('some-string', '$.bucket')` throws.

import type { GraderId } from "@mcp-token-footprint/shared";

/** Registers one bound value and returns its `@pN` placeholder (safe to reference more than once). */
export type SqlBind = (value: string | number) => string;
/** Registers a list of values and returns `@p0, @p1, …` for an `IN (…)`. */
export type SqlBindList = (values: readonly (string | number)[]) => string;

/** The base graders whose single-object evidence carries a `verdict`. Typed as {@link GraderId} so a
 *  rename of the frozen roster is a compile error here rather than a filter that matches nothing. */
export type VerdictGraderId = Extract<GraderId, "answer_validation" | "insight_surplus">;

/** The `ErrorFinding` fields the `error_forensics` inventory can be filtered on. A literal union, so
 *  the JSON path below is never built from caller input. */
export type ErrorFindingField = "bucket" | "fixTarget";

/** `g.created_at = (SELECT MAX(…))` — the append-only latest-per-(run, grader) restriction. */
function latestRowOnly(graderParam: string): string {
  return (
    "g.created_at = (SELECT MAX(g2.created_at) FROM run_grades g2 " +
    `WHERE g2.run_id = g.run_id AND g2.grader_id = ${graderParam})`
  );
}

/** `evidence_json` when it is valid JSON, `'[]'` otherwise — total, never a throw. */
const SAFE_EVIDENCE = "CASE WHEN json_valid(g.evidence_json) THEN g.evidence_json ELSE '[]' END";

/**
 * The `json_each` source for a findings inventory: the evidence when it is a JSON ARRAY, `'[]'`
 * otherwise.
 *
 * The array check is NOT optional and NOT cosmetic. `json_each` over a JSON *object* walks that
 * object's top-level members, so `{"nested":{"bucket":"skill"}}` would yield an object member
 * carrying a real bucket and MATCH — while `matchesRunFilter`, which requires `Array.isArray`,
 * would not. That divergence was caught by the cross-check, not reasoned about in advance: a
 * finding is an ELEMENT OF the inventory array, never any object that happens to sit somewhere
 * inside the evidence.
 *
 * `json_type` throws on invalid JSON exactly like `json_extract`, so it is fed the already-sanitized
 * expression rather than the raw column, and the whole thing is written as nested `CASE` rather than
 * `json_valid(x) AND json_type(x) = 'array'` — SQLite does not guarantee the evaluation order of an
 * `AND`'s operands, and one reordering would be a query that raises instead of a row that misses.
 */
const FINDINGS_ARRAY = `CASE WHEN json_type(${SAFE_EVIDENCE}) = 'array' THEN ${SAFE_EVIDENCE} ELSE '[]' END`;

/**
 * `answerVerdict` / `insightVerdict` → an EXISTS over the run's LATEST grade row for that base
 * grader, matching the `verdict` inside its evidence object. A run with no such grade row, or one
 * whose evidence is NULL/malformed/not an object, yields no row and therefore does not match.
 */
export function ratingVerdictClause(
  grader: VerdictGraderId,
  verdicts: readonly string[],
  bind: SqlBind,
  bindList: SqlBindList,
): string {
  const graderParam = bind(grader);
  return (
    "EXISTS (SELECT 1 FROM run_grades g " +
    `WHERE g.run_id = runs.id AND g.grader_id = ${graderParam} ` +
    `AND (CASE WHEN json_type(${SAFE_EVIDENCE}) = 'object' THEN json_extract(${SAFE_EVIDENCE}, '$.verdict') END) ` +
    `IN (${bindList(verdicts)}) AND ${latestRowOnly(graderParam)})`
  );
}

/**
 * `errorBucket` / `errorFixTarget` → an EXISTS over the findings of the run's LATEST
 * `error_forensics` grade. ANY finding carrying one of the values matches the run. A clean run
 * (`evidence_json` = `'[]'`, the graded-no-findings case) yields zero members and matches nothing —
 * an empty inventory is a clean run, not a run in some default bucket.
 */
export function ratingFindingClause(
  field: ErrorFindingField,
  values: readonly string[],
  bind: SqlBind,
  bindList: SqlBindList,
): string {
  const graderParam = bind("error_forensics" satisfies GraderId);
  return (
    "EXISTS (SELECT 1 FROM run_grades g, " +
    `json_each(${FINDINGS_ARRAY}) je ` +
    `WHERE g.run_id = runs.id AND g.grader_id = ${graderParam} ` +
    `AND (CASE WHEN je.type = 'object' THEN json_extract(je.value, '$.${field}') END) ` +
    `IN (${bindList(values)}) AND ${latestRowOnly(graderParam)})`
  );
}
