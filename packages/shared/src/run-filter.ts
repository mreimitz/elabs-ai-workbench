// Observability — RunFilter parse/serialize + the pure per-run predicate (planning/Roadmap/RM-17-observability/,
// WP1.1, D-OB1). ONE helper so web URL state and the API agree byte-for-byte, and so a caller with a
// SINGLE materialized run (watch rules, WP4.1) evaluates the SAME {@link RunFilter} object WITHOUT SQL.
//
// The API run repository translates a RunFilter to parameterized SQL separately (it owns column/join
// knowledge — the architecture boundary keeps SQL out of `shared`); this module owns everything that
// is pure contract logic. The two paths are kept in agreement by a cross-check test in the API.

import { RUN_FILTER_ALIAS_KEYS, RUN_FILTER_PARAM } from "./constants.js";
import {
  runFilterSchema,
  runMetricsRatioConfigSchema,
  runSortDirectionSchema,
  runSortFieldSchema,
} from "./schemas.js";
import type {
  RunCandidateScore,
  RunFeedbackFilter,
  RunFilter,
  RunFilterCandidate,
  RunMetricsRatioConfig,
  RunPhase,
  RunSort,
  RunSortDirection,
  RunStatus,
} from "./types.js";

/**
 * A malformed filter/sort surfaced to the API as a 400. Carries `statusCode`/`code` so the central
 * Fastify error handler renders it without `shared` needing to import an API util. A ZodError from
 * `runFilterSchema.parse` also maps to 400 (with zod detail) by that same handler — see the route.
 */
export class RunFilterError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_RUN_FILTER";
  constructor(message: string) {
    super(message);
    this.name = "RunFilterError";
  }
}

// ── Serialize / parse — the canonical `filter=<json>` round-trip ─────────────────────────────────

/** Recursively sort object keys so `serializeRunFilter` is byte-stable regardless of input key order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Serialize a {@link RunFilter} to the canonical JSON string carried in the `filter=` URL param. The
 * value is schema-normalized first (undefined optionals dropped) and key-sorted, so
 * `parseRunFilter(serializeRunFilter(f))` deep-equals `runFilterSchema.parse(f)` (round-trip, WP1.1
 * acceptance #2). Throws a ZodError for an invalid input filter.
 */
export function serializeRunFilter(filter: RunFilter): string {
  return JSON.stringify(sortKeys(runFilterSchema.parse(filter)));
}

/**
 * Parse the canonical `filter=` JSON string into a validated {@link RunFilter}. A malformed/non-object
 * JSON is a {@link RunFilterError} (→400); an invalid field is a ZodError (→400 with detail).
 */
export function parseRunFilter(raw: string): RunFilter {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RunFilterError("`filter` is not valid JSON");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new RunFilterError("`filter` must be a JSON object");
  }
  return runFilterSchema.parse(json);
}

// ── The `ratio=` param (RM-17 Phase 6, AM-OB4) ───────────────────────────────────────────────────
// `GET /api/metrics/runs` is a GET with no body and `filter=` is ALREADY a JSON blob, so the ratio
// config rides as a SECOND JSON param rather than forcing the endpoint to POST — four callers (the
// dashboard, the chart composer, the watch engine and the scheduled digest) share that GET, and
// converting it would be a breaking change to all of them for no gain.

/** Serialize a {@link RunMetricsRatioConfig} to the canonical `ratio=` JSON — schema-normalized and
 *  key-sorted, so it round-trips byte-stably exactly like `serializeRunFilter`. */
export function serializeRunMetricsRatio(ratio: RunMetricsRatioConfig): string {
  return JSON.stringify(sortKeys(runMetricsRatioConfigSchema.parse(ratio)));
}

/** Parse the canonical `ratio=` JSON string. Malformed/non-object JSON is a {@link RunFilterError}
 *  (→400); an invalid field inside is a ZodError (→400 with detail). */
export function parseRunMetricsRatio(raw: string): RunMetricsRatioConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RunFilterError("`ratio` is not valid JSON");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new RunFilterError("`ratio` must be a JSON object");
  }
  return runMetricsRatioConfigSchema.parse(json);
}

function toStringArray(value: unknown): string[] {
  const parts = (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return [...new Set(parts)];
}

function firstString(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build a {@link RunFilter} from a parsed query object: the canonical `filter=` JSON (if present) as
 * the base, overlaid with the ergonomic scalar aliases ({@link RUN_FILTER_ALIAS_KEYS}) — each accepting
 * a comma-joined or repeated value for the array fields. The merged object is validated ONCE, so an
 * invalid alias value (e.g. a bad `status`) is a ZodError (→400). Used by `GET /api/runs`; the web URL
 * state can build the same object and serialize it back through {@link serializeRunFilter}.
 */
export function parseRunFilterFromQuery(query: Record<string, unknown>): RunFilter {
  const base: Record<string, unknown> = {};

  const rawFilter = firstString(query[RUN_FILTER_PARAM]);
  if (rawFilter !== undefined) {
    let json: unknown;
    try {
      json = JSON.parse(rawFilter);
    } catch {
      throw new RunFilterError("`filter` is not valid JSON");
    }
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      throw new RunFilterError("`filter` must be a JSON object");
    }
    Object.assign(base, json);
  }

  // Aliases overlay the JSON base (last write wins). Array aliases split commas / flatten repeats.
  const overlayArray = (key: "testId" | "scenarioId" | "status") => {
    if (key in query) {
      const values = toStringArray(query[key]);
      if (values.length > 0) base[key] = values;
    }
  };
  const overlayScalar = (key: "suiteId" | "suiteRunId" | "collectionId" | "q") => {
    if (key in query) {
      const value = firstString(query[key]);
      if (value !== undefined) base[key] = value;
    }
  };
  overlayArray("testId");
  overlayArray("scenarioId");
  overlayArray("status");
  overlayScalar("suiteId");
  overlayScalar("suiteRunId");
  overlayScalar("collectionId");
  overlayScalar("q");

  return runFilterSchema.parse(base);
}

/** True when the query carries ANY run-filter/sort/pagination param, so the no-param `GET /api/runs`
 *  path can stay byte-identical to today (WP1.1 acceptance #4). */
export function hasRunQueryParams(query: Record<string, unknown>): boolean {
  if (RUN_FILTER_PARAM in query) return true;
  for (const key of ["sort", "limit", "offset", ...RUN_FILTER_ALIAS_KEYS]) {
    if (key in query) return true;
  }
  return false;
}

/**
 * Parse `sort=<field>[:<asc|desc>]` into a validated {@link RunSort}. An unknown field/direction is a
 * {@link RunFilterError} (→400). Direction defaults to `desc` when omitted. Absent/empty → undefined
 * (the repository then applies the default `startedAt` DESC).
 */
export function parseRunSort(raw: string | undefined): RunSort | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const [fieldPart, dirPart] = trimmed.split(":");
  const field = runSortFieldSchema.safeParse(fieldPart);
  if (!field.success) throw new RunFilterError(`Unknown sort field: ${fieldPart}`);
  let direction: RunSortDirection = "desc";
  if (dirPart !== undefined) {
    const dir = runSortDirectionSchema.safeParse(dirPart);
    if (!dir.success) throw new RunFilterError(`Unknown sort direction: ${dirPart}`);
    direction = dir.data;
  }
  return { field: field.data, direction };
}

function toInt(value: unknown): number | undefined {
  const raw = firstString(value) ?? (typeof value === "number" ? String(value) : undefined);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

/** Parse `limit`/`offset` pagination params — a positive integer `limit`, a non-negative `offset`;
 *  anything else is ignored (unbounded), mirroring the repository's tolerant `LIMIT` handling. */
export function parseRunPagination(query: Record<string, unknown>): {
  limit?: number;
  offset?: number;
} {
  const out: { limit?: number; offset?: number } = {};
  const limit = toInt(query.limit);
  if (limit !== undefined && limit > 0) out.limit = limit;
  const offset = toInt(query.offset);
  if (offset !== undefined && offset >= 0) out.offset = offset;
  return out;
}

// ── Pure per-run predicate (watch rules, WP4.1) ──────────────────────────────────────────────────

function intersects(candidateValues: string[] | undefined, filterValues: string[]): boolean {
  if (!candidateValues || candidateValues.length === 0) return false;
  const set = new Set(candidateValues);
  return filterValues.some((v) => set.has(v));
}

/** The latest-per-grader scores must satisfy the (optionally grader-scoped) score bound. */
function matchesScore(scores: RunCandidateScore[] | undefined, filter: RunFilter): boolean {
  if (!scores || scores.length === 0) return false;
  const scoped =
    filter.grader !== undefined ? scores.filter((s) => s.grader === filter.grader) : scores;
  return scoped.some(
    (s) =>
      (filter.scoreGte === undefined || s.score >= filter.scoreGte) &&
      (filter.scoreLte === undefined || s.score <= filter.scoreLte),
  );
}

function matchesFeedback(candidate: RunFilterCandidate, feedback: RunFeedbackFilter): boolean {
  if (feedback.key !== undefined && !(candidate.feedbackKeys ?? []).includes(feedback.key)) {
    return false;
  }
  if (feedback.hasScore === true && !(candidate.hasFeedbackScore ?? false)) return false;
  // AM-OB4 — "carries ANY feedback row". A candidate with no `feedbackKeys` at all is conservatively
  // NOT a match (absent is not a value), mirroring the SQL `EXISTS (… run_feedback …)`. Note a
  // note-only row still has a `key`, so this is not a synonym for `hasScore`.
  if (feedback.any === true && (candidate.feedbackKeys ?? []).length === 0) return false;
  return true;
}

/**
 * The CANONICAL "needs attention" rule — ONE definition (unified-sessions WP3.3, execution-plan §2, and
 * the owner-requested follow-up that surfaces it as `RunFilter.needsAttention`). A run needs attention
 * when it is a LIVE run paused on the operator (`running` + `waiting_input` — the same facet combination
 * `deriveRunStatusView` renders as "Waiting for you") OR an unseen run that isn't currently running
 * (`seen === false && status !== "running"` — `seen` defaults false for every run, so this ALSO catches
 * a queued-not-yet-opened run, not only a finished one).
 *
 * PURE — no React, no fetch, no SQL. Consumed by BOTH the web feed (`needs-attention.ts` re-exports it)
 * and `matchesRunFilter`'s `needsAttention` field, so there is exactly one place the rule's MEANING is
 * expressed; the API SQL translation (`buildRunFilterWhere` in run-repository.ts + its metrics.ts
 * replica) mirrors this formula and is kept in agreement by the SQL-vs-predicate cross-check test — the
 * same 3-way guarantee `pinned`/`derived`/`feedback` have. `seen === false` (strict, NOT `?? false`):
 * a candidate with an ABSENT `seen` is conservatively NOT treated as unseen.
 */
export function runNeedsAttention(run: {
  status: RunStatus;
  phase?: RunPhase;
  seen?: boolean;
}): boolean {
  const pendingInput = run.status === "running" && run.phase === "waiting_input";
  const unseen = run.seen === false && run.status !== "running";
  return pendingInput || unseen;
}

/**
 * Evaluate a {@link RunFilter} against a SINGLE materialized run WITHOUT SQL — the reuse path watch
 * rules (WP4.1) drive. Semantics MIRROR the repository's SQL translation exactly (kept in agreement by
 * the API cross-check test): all present fields AND-combine; array fields match ANY value; an omitted
 * field imposes no constraint; an ENRICHED (joined) field the caller left `undefined` cannot satisfy a
 * filter that requires it (conservative "no match"). `q` is never evaluated here — full-text search is
 * an FTS5 index the API owns (WP1.3), with no per-run content on this candidate, so a `q` present in the
 * filter imposes NO constraint in this pure predicate (a watch rule matches on its other fields; the
 * feed's FTS join is where `q` actually filters). Duration is the ACTIVE duration (activeDurationMs ?? totalDurationMs, D-US3);
 * `pinned` (WP1.6) and `feedback` (WP1.5) are LIVE; `derived` remains forward-compatible (see their
 * {@link RunFilter} docs). The auto-rating dimensions (AM-OB12 — `answerVerdict`/`insightVerdict`/
 * `errorBucket`/`errorFixTarget`) are LIVE and read the caller-supplied latest-rating arrays; an
 * unrated run supplies none and therefore matches none.
 */
export function matchesRunFilter(candidate: RunFilterCandidate, filter: RunFilter): boolean {
  if (filter.status && filter.status.length > 0 && !filter.status.includes(candidate.status)) {
    return false;
  }
  if (
    filter.outcome &&
    filter.outcome.length > 0 &&
    (candidate.outcome === undefined || !filter.outcome.includes(candidate.outcome))
  ) {
    return false;
  }
  if (
    filter.stopReasonCode &&
    filter.stopReasonCode.length > 0 &&
    (candidate.stopReasonCode === undefined ||
      !filter.stopReasonCode.includes(candidate.stopReasonCode))
  ) {
    return false;
  }
  if (
    filter.phase &&
    filter.phase.length > 0 &&
    (candidate.phase === undefined || !filter.phase.includes(candidate.phase))
  ) {
    return false;
  }
  if (filter.seen !== undefined && (candidate.seen ?? false) !== filter.seen) return false;
  if (
    filter.providerKind &&
    filter.providerKind.length > 0 &&
    (candidate.providerKind === undefined || !filter.providerKind.includes(candidate.providerKind))
  ) {
    return false;
  }
  if (
    filter.model &&
    filter.model.length > 0 &&
    (candidate.model === undefined || !filter.model.includes(candidate.model))
  ) {
    return false;
  }
  if (
    filter.serverId &&
    filter.serverId.length > 0 &&
    !intersects(candidate.serverIds, filter.serverId)
  ) {
    return false;
  }
  if (
    filter.scenarioId &&
    filter.scenarioId.length > 0 &&
    !filter.scenarioId.includes(candidate.scenarioId)
  ) {
    return false;
  }
  if (filter.suiteId !== undefined && candidate.suiteId !== filter.suiteId) return false;
  if (filter.suiteRunId !== undefined && candidate.suiteRunId !== filter.suiteRunId) return false;
  if (filter.testId && filter.testId.length > 0 && !filter.testId.includes(candidate.testId)) {
    return false;
  }
  if (
    filter.skillId &&
    filter.skillId.length > 0 &&
    !intersects(candidate.skillIds, filter.skillId)
  ) {
    return false;
  }
  if (
    filter.collectionId !== undefined &&
    !(candidate.collectionIds ?? []).includes(filter.collectionId)
  ) {
    return false;
  }
  if (filter.interactiveOnly === true && candidate.mode !== "interactive") return false;
  // "Needs attention" as a filter (owner-requested) — the ONE canonical rule; `true` requires a match,
  // `false` requires a non-match, absent imposes nothing. Mirrored by the API SQL translation.
  if (filter.needsAttention !== undefined && runNeedsAttention(candidate) !== filter.needsAttention) {
    return false;
  }
  if (filter.pinned !== undefined && (candidate.pinned ?? false) !== filter.pinned) return false;
  // Fork lineage — DEFAULT EXCLUDE: `derived:true` keeps only derived runs; absent/`false` excludes
  // them. Forward-compatible: no run is derived until WP3.3, so this is a no-op on today's candidates.
  if (filter.derived === true) {
    if (!(candidate.derived ?? false)) return false;
  } else if (candidate.derived ?? false) {
    return false;
  }
  if (
    (filter.scoreGte !== undefined ||
      filter.scoreLte !== undefined ||
      filter.grader !== undefined) &&
    !matchesScore(candidate.scores, filter)
  ) {
    return false;
  }
  if (filter.costUsdGte !== undefined && candidate.costUsd < filter.costUsdGte) return false;
  if (filter.costUsdLte !== undefined && candidate.costUsd > filter.costUsdLte) return false;
  const tokens = candidate.tokensIn + candidate.tokensOut;
  if (filter.tokensGte !== undefined && tokens < filter.tokensGte) return false;
  if (filter.tokensLte !== undefined && tokens > filter.tokensLte) return false;
  const duration = candidate.activeDurationMs ?? candidate.totalDurationMs;
  if (
    filter.durationMsGte !== undefined &&
    (duration === undefined || duration < filter.durationMsGte)
  ) {
    return false;
  }
  if (
    filter.durationMsLte !== undefined &&
    (duration === undefined || duration > filter.durationMsLte)
  ) {
    return false;
  }
  if (filter.dateFrom !== undefined && candidate.startedAt < filter.dateFrom) return false;
  if (filter.dateTo !== undefined && candidate.startedAt > filter.dateTo) return false;
  if (filter.feedback !== undefined && !matchesFeedback(candidate, filter.feedback)) return false;
  if (filter.hasError !== undefined) {
    const hasError = candidate.status === "error" || candidate.outcome === "error";
    if (hasError !== filter.hasError) return false;
  }
  // Auto-rating dimensions (RM-17 Phase 6, AM-OB12) — `intersects` already encodes the rule that
  // matters here: an ABSENT or EMPTY candidate array cannot satisfy the filter. So an UNRATED run
  // never lands in a verdict-filtered set, and therefore never inflates a share's numerator; it is
  // excluded outright rather than being read as some default verdict.
  if (
    filter.answerVerdict &&
    filter.answerVerdict.length > 0 &&
    !intersects(candidate.answerVerdicts, filter.answerVerdict)
  ) {
    return false;
  }
  if (
    filter.insightVerdict &&
    filter.insightVerdict.length > 0 &&
    !intersects(candidate.insightVerdicts, filter.insightVerdict)
  ) {
    return false;
  }
  if (
    filter.errorBucket &&
    filter.errorBucket.length > 0 &&
    !intersects(candidate.errorBuckets, filter.errorBucket)
  ) {
    return false;
  }
  if (
    filter.errorFixTarget &&
    filter.errorFixTarget.length > 0 &&
    !intersects(candidate.errorFixTargets, filter.errorFixTarget)
  ) {
    return false;
  }
  return true;
}
