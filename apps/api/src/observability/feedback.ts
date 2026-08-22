// Observability — human feedback (planning/Roadmap/RM-17-observability/, WP1.5, D-OB15).
//
// One generic primitive for human signal on a run: a score and/or note, scoped to the run as a whole
// or to one of its steps (turns). STRICTLY SEPARATE from grading (AR6/D-OB15) — nothing in
// grading/suites/compare reads `run_feedback`; see the separation regression test in
// `apps/api/test/run-feedback.test.ts`. The console UI that WRITES this is WP2.5; the review queue is
// WP4.5 — this module is the table repository + the RunSummary aggregate helper WP1.5 delivers (the
// route registration lives in `observability/routes.ts`; the RunFilter join lives in
// `testing/run-repository.ts` and its replica in `observability/metrics.ts`).
//
// Upsert identity is (run_id, step_id, key, source) — a re-thumb on the SAME (step, key) REPLACES the
// prior row (same id, refreshed score/comment/created_at) rather than appending. Enforced in
// APPLICATION code below, not a DB UNIQUE index: SQLite's NULL != NULL semantics would let a
// UNIQUE(run_id, step_id, key, source) silently admit duplicate run-level (`step_id IS NULL`) rows for
// the same key — see the schema.ts table comment.

import { nanoid } from "nanoid";
import {
  RUN_FEEDBACK_KEY_VERDICT,
  runFeedbackInputSchema,
  type RunFeedback,
  type RunFeedbackInput,
  type RunFeedbackSource,
  type RunFeedbackSummary,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { RunFeedbackRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

const DEFAULT_KEY = RUN_FEEDBACK_KEY_VERDICT;
// The only source this API writes today; 'auto' exists on the wire for a FUTURE rule-written row
// (WP4.1's run-grader action does NOT write here — grades stay grades).
const WRITE_SOURCE: RunFeedbackSource = "human";

export class RunFeedbackRepository {
  constructor(private readonly db: AppDatabase) {}

  list(runId: string): RunFeedback[] {
    this.assertRunExists(runId);
    const rows = this.db
      .prepare("SELECT * FROM run_feedback WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as RunFeedbackRow[];
    return rows.map(toPublic);
  }

  /**
   * Upsert per (run, step, key, source='human'): a re-thumb REPLACES the prior row's score/comment/
   * created_at (same id) rather than appending a new one. `stepId`, when present, must belong to THIS
   * run — the DB's FK alone can't express that cross-column constraint.
   */
  upsert(runId: string, input: RunFeedbackInput): RunFeedback {
    this.assertRunExists(runId);
    const parsed = runFeedbackInputSchema.parse(input);
    const key = parsed.key ?? DEFAULT_KEY;
    if (parsed.stepId !== undefined) this.assertStepBelongsToRun(runId, parsed.stepId);

    const now = new Date().toISOString();
    const existing = this.findExisting(runId, parsed.stepId, key);

    const id = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE run_feedback SET score = @score, comment = @comment, created_at = @now WHERE id = @id`,
          )
          .run({
            id: existing.id,
            score: parsed.score ?? null,
            comment: parsed.comment ?? null,
            now,
          });
        return existing.id;
      }
      const newId = nanoid();
      this.db
        .prepare(
          `INSERT INTO run_feedback (id, run_id, step_id, key, score, comment, source, created_at)
           VALUES (@id, @runId, @stepId, @key, @score, @comment, @source, @now)`,
        )
        .run({
          id: newId,
          runId,
          stepId: parsed.stepId ?? null,
          key,
          score: parsed.score ?? null,
          comment: parsed.comment ?? null,
          source: WRITE_SOURCE,
          now,
        });
      return newId;
    })();

    return this.getRow(id);
  }

  /** Hard delete, scoped to the given run (a feedbackId belonging to a DIFFERENT run 404s). */
  delete(runId: string, feedbackId: string): void {
    const result = this.db
      .prepare("DELETE FROM run_feedback WHERE id = ? AND run_id = ?")
      .run(feedbackId, runId);
    if (result.changes === 0) {
      throw httpError(404, "Feedback not found");
    }
  }

  private findExisting(
    runId: string,
    stepId: string | undefined,
    key: string,
  ): RunFeedbackRow | undefined {
    if (stepId === undefined) {
      return this.db
        .prepare(
          "SELECT * FROM run_feedback WHERE run_id = ? AND step_id IS NULL AND key = ? AND source = ?",
        )
        .get(runId, key, WRITE_SOURCE) as RunFeedbackRow | undefined;
    }
    return this.db
      .prepare(
        "SELECT * FROM run_feedback WHERE run_id = ? AND step_id = ? AND key = ? AND source = ?",
      )
      .get(runId, stepId, key, WRITE_SOURCE) as RunFeedbackRow | undefined;
  }

  private getRow(id: string): RunFeedback {
    const row = this.db.prepare("SELECT * FROM run_feedback WHERE id = ?").get(id) as
      | RunFeedbackRow
      | undefined;
    if (!row) throw httpError(404, "Feedback not found");
    return toPublic(row);
  }

  private assertRunExists(runId: string): void {
    const row = this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId);
    if (!row) throw httpError(404, "Run not found");
  }

  /** Acceptance #1 — step-level rows accepted ONLY for a step that belongs to THIS run. */
  private assertStepBelongsToRun(runId: string, stepId: string): void {
    const row = this.db
      .prepare("SELECT 1 FROM run_steps WHERE id = ? AND run_id = ?")
      .get(stepId, runId);
    if (!row) throw httpError(400, "`stepId` does not belong to this run");
  }
}

function toPublic(row: RunFeedbackRow): RunFeedback {
  return {
    id: row.id,
    runId: row.run_id,
    ...(row.step_id !== null ? { stepId: row.step_id } : {}),
    key: row.key,
    ...(row.score !== null ? { score: row.score } : {}),
    ...(row.comment !== null ? { comment: row.comment } : {}),
    source: row.source,
    createdAt: row.created_at,
  };
}

// ── RunSummary aggregate (WP1.5) — a MINIMAL per-run chip payload for testing/run-repository.ts ─────

/**
 * The RUN-LEVEL (`step_id IS NULL`) feedback aggregate for a batch of runs: one entry per distinct
 * key, the LATEST write (by `created_at`) wins across sources. Batched — one query for the whole page
 * — mirroring `observability/search.ts`'s `fetchSnippets`. Consumed ONLY by `RunRepository`'s summary
 * builder; never by grading/suites/compare (the D-OB15/AR6 separation this WP's regression test proves).
 *
 * RM-17 Phase 6 (AM-OB2) — each entry also reports `hasComment`, a BOOLEAN and never the text: a
 * comment-only row (`corrected_output`, a `note` rubric key) has `score: null`, and a chip that keys
 * only off the score renders nothing for it, so a captured correction looked exactly like no
 * feedback at all. The summary stays cheap on purpose — a surface that needs the text calls the full
 * `GET /api/runs/:id/feedback` list.
 */
export function fetchRunFeedbackSummaries(
  db: AppDatabase,
  runIds: readonly string[],
): Map<string, RunFeedbackSummary[]> {
  const out = new Map<string, RunFeedbackSummary[]>();
  if (runIds.length === 0) return out;
  const placeholders = runIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT run_id, key, score, comment, created_at FROM run_feedback
        WHERE step_id IS NULL AND run_id IN (${placeholders})
        ORDER BY created_at ASC`,
    )
    .all(...runIds) as Array<{
    run_id: string;
    key: string;
    score: number | null;
    comment: string | null;
    created_at: string;
  }>;

  // Ascending created_at, last-write-wins per (run_id, key) — handles the (currently theoretical)
  // case of both a 'human' and an 'auto' row under the same key.
  const perRun = new Map<string, Map<string, { score: number | null; hasComment: boolean }>>();
  for (const row of rows) {
    let keyMap = perRun.get(row.run_id);
    if (!keyMap) {
      keyMap = new Map();
      perRun.set(row.run_id, keyMap);
    }
    keyMap.set(row.key, {
      score: row.score,
      // Whitespace-only text is not text — it would make the chip claim a note nobody can read.
      hasComment: (row.comment ?? "").trim().length > 0,
    });
  }
  for (const [runId, keyMap] of perRun) {
    out.set(
      runId,
      [...keyMap.entries()].map(([key, value]) => ({
        key,
        score: value.score,
        hasComment: value.hasComment,
      })),
    );
  }
  return out;
}
