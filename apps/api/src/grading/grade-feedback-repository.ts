import { nanoid } from "nanoid";
import {
  gradeFeedbackInputSchema,
  type GradeFeedback,
  type GradeFeedbackInput,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { GradeFeedbackJoinedRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

/**
 * APPEND-ONLY persistence over `grade_feedback` (Benchmarks Phase 6, WP 6.1) — one HUMAN verdict
 * (`agree` / `disagree`) plus an optional note ON ONE `run_grades` row.
 *
 * **AR6 — feedback is never a grade, and this class is where that is enforced structurally.**
 *
 *  - It has **no `update` and no `delete`**, so a verdict can only ever be *added*. A changed mind
 *    INSERTs a second row and the newest per grade wins for display — the same discipline
 *    `run_grades` itself keeps, and the deliberate opposite of Observability's `run_feedback`
 *    upsert (D-OB15), which replaces.
 *  - Every statement below reads or writes `grade_feedback` **only**. The single mention of
 *    `run_grades` is a `SELECT … JOIN` — for existence checks and to resolve the grade's `run_id`.
 *    There is no `UPDATE run_grades` anywhere in this module, and
 *    `apps/api/test/grade-feedback.test.ts` proves the point the hard way: it snapshots every
 *    `run_grades` row before and after a feedback write and asserts byte equality, so a future edit
 *    that "helpfully" folds a human verdict into a score turns that test red.
 *
 * Wire shapes come from `@mcp-token-footprint/shared`; validation is the shared `.strict()` zod
 * schema, so an unknown key (a smuggled `score`, say) is a 400 rather than a silently-dropped field.
 */
export class GradeFeedbackRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Append one verdict to a grade. 404s on an unknown `gradeId` (never creates an orphan row the
   * calibration set would then have to explain). Returns the inserted {@link GradeFeedback}.
   */
  append(gradeId: string, input: GradeFeedbackInput): GradeFeedback {
    const runId = this.runIdForGrade(gradeId);
    const parsed = gradeFeedbackInputSchema.parse(input);
    const id = nanoid();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO grade_feedback (id, grade_id, verdict, note, created_at)
         VALUES (@id, @gradeId, @verdict, @note, @createdAt)`,
      )
      .run({ id, gradeId, verdict: parsed.verdict, note: parsed.note ?? null, createdAt });
    return toGradeFeedback({
      id,
      grade_id: gradeId,
      verdict: parsed.verdict,
      note: parsed.note ?? null,
      created_at: createdAt,
      run_id: runId,
    });
  }

  /** One grade's verdicts, oldest first (the append-only history). `rowid` breaks same-ms ties. */
  listByGrade(gradeId: string): GradeFeedback[] {
    const rows = this.db
      .prepare(
        `SELECT f.*, g.run_id AS run_id
           FROM grade_feedback f JOIN run_grades g ON g.id = f.grade_id
          WHERE f.grade_id = ?
          ORDER BY f.created_at ASC, f.rowid ASC`,
      )
      .all(gradeId) as GradeFeedbackJoinedRow[];
    return rows.map(toGradeFeedback);
  }

  /**
   * Every verdict on every grade of one run, oldest first — the one call a run-scoped surface
   * (the run console's Grade panel, a suite matrix cell) needs to render its controls.
   */
  listByRun(runId: string): GradeFeedback[] {
    const rows = this.db
      .prepare(
        `SELECT f.*, g.run_id AS run_id
           FROM grade_feedback f JOIN run_grades g ON g.id = f.grade_id
          WHERE g.run_id = ?
          ORDER BY f.created_at ASC, f.rowid ASC`,
      )
      .all(runId) as GradeFeedbackJoinedRow[];
    return rows.map(toGradeFeedback);
  }

  /** The grade's run id, or a 404 — the existence check `append` needs, without a second query. */
  private runIdForGrade(gradeId: string): string {
    const row = this.db.prepare("SELECT run_id FROM run_grades WHERE id = ?").get(gradeId) as
      | { run_id: string }
      | undefined;
    if (!row) throw httpError(404, "Grade not found");
    return row.run_id;
  }
}

function toGradeFeedback(row: GradeFeedbackJoinedRow): GradeFeedback {
  return {
    id: row.id,
    gradeId: row.grade_id,
    runId: row.run_id,
    verdict: row.verdict,
    ...(row.note === null ? {} : { note: row.note }),
    createdAt: row.created_at,
  };
}
