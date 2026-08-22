import type {
  ReviewRubric,
  RunFeedback,
  RunFeedbackSummary,
  RunSummary,
} from "@mcp-token-footprint/shared";

/**
 * Observability WP4.5 (D-OB22) — review-queue progress, DERIVED (never persisted): a "review session"
 * is ephemeral config (a source filter + a picked rubric), so "N/M reviewed" is computed here, purely,
 * from the SAME {@link RunSummary.feedback} aggregate the runs feed already carries (WP1.5's run-level
 * feedback chip) — no new API surface. A run counts as reviewed once EVERY rubric key has a
 * `run_feedback` row for it (presence, regardless of score being `null` — a note-only key's row still
 * has `score: null` but IS present, see `fetchRunFeedbackSummaries`'s doc). Skipping a run (moving the
 * queue pointer on without answering every key) simply leaves it short of that — no separate "skipped"
 * flag is persisted anywhere; the math below already accounts for it (a partially- or un-reviewed run
 * just doesn't count).
 *
 * Pure + React-free so it's unit-testable without mounting anything (mirrors `run-filter-url.ts`'s
 * style).
 */

/** True once every one of `rubric`'s keys has a run-level feedback entry on `run` (by key name,
 *  case-sensitive — key names are stored/compared verbatim, matching `run_feedback.key`). */
export function isRunReviewed(run: RunSummary, rubric: ReviewRubric): boolean {
  const present = new Set((run.feedback ?? []).map((entry) => entry.key));
  return rubric.keys.every((keyDef) => present.has(keyDef.key));
}

/** How many of `runs` are fully reviewed against `rubric` (see {@link isRunReviewed}). */
export function countReviewed(runs: readonly RunSummary[], rubric: ReviewRubric): number {
  let n = 0;
  for (const run of runs) if (isRunReviewed(run, rubric)) n++;
  return n;
}

/** Which of `rubric`'s keys still lack a run-level feedback entry on `run` — drives the "answer the
 *  remaining N keys" affordance / the per-key completion dot. */
export function missingKeys(run: RunSummary, rubric: ReviewRubric): string[] {
  const present = new Set((run.feedback ?? []).map((entry) => entry.key));
  return rubric.keys.filter((keyDef) => !present.has(keyDef.key)).map((keyDef) => keyDef.key);
}

/**
 * Immutable optimistic update: return a COPY of `run` with its `feedback` aggregate reflecting the
 * freshly saved row (upsert — replaces any existing entry for that key, mirroring the server's own
 * upsert semantics) — so the queue's progress footer updates INSTANTLY after a commit without a full
 * re-fetch of every run in the queue.
 *
 * It takes the whole saved {@link RunFeedback} row rather than a `(key, score)` pair (AM-OB2) so the
 * derived `hasComment` can never drift from what the server persisted — a comment-only row must
 * still show up as feedback, which is exactly what a score-shaped argument would have lost.
 */
export function withUpsertedFeedback(run: RunSummary, saved: RunFeedback): RunSummary {
  const next: RunFeedbackSummary[] = (run.feedback ?? []).filter(
    (entry) => entry.key !== saved.key,
  );
  next.push({
    key: saved.key,
    score: saved.score ?? null,
    hasComment: (saved.comment ?? "").trim().length > 0,
  });
  return { ...run, feedback: next };
}
