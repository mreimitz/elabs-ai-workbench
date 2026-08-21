import {
  type CalibrationGrade,
  type CalibrationRun,
  type CalibrationSet,
  type CalibrationTotals,
  type GradeFeedback,
  type GradeKind,
  type GraderId,
  type GradeStatus,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";

/**
 * The calibration set (Benchmarks Phase 6, WP 6.1) — **the flagged subset of graded runs that carry
 * human feedback**, composed on read and persisted nowhere.
 *
 * ## Membership is derived, never a stored flag
 * A run is in the set exactly when at least one of its `run_grades` rows has at least one
 * `grade_feedback` row. There is no `is_calibration` column to forget to clear, and no way for the
 * set to disagree with the feedback it is made of: recording a verdict adds a run, and there is no
 * operation that removes one (feedback is append-only).
 *
 * ## AR6 — reads grades, changes nothing
 * Every statement here is a `SELECT`. The set REPORTS each grade's own score/method/version
 * alongside the human verdict, side by side and separately labelled; it never combines them, never
 * derives a "corrected" score, and never writes back. `RunGrade.score` and every expectation metric
 * built on it mean exactly what they meant before anyone clicked a thumb.
 *
 * ## No secrets, by construction
 * The projected columns are ids, grader/judge NAMES, numbers, timestamps and the human's own note.
 * `judge_provider_id` is deliberately NOT projected (it is a local provider-credential reference,
 * exactly the class of value B12 keeps out of exported files), and neither is the run transcript,
 * the tool arguments, nor the judge's `reasoning`. A caller wanting any of that has the `runId` and
 * the in-app drill-down. `apps/api/test/grade-feedback.test.ts` seeds real secret material around a
 * member run and asserts none of it reaches either export.
 */
export function buildCalibrationSet(db: AppDatabase, now: Date = new Date()): CalibrationSet {
  const rows = db
    .prepare(
      `SELECT
         g.id            AS grade_id,
         g.run_id        AS run_id,
         g.grader_id     AS grader_id,
         g.kind          AS kind,
         g.status        AS status,
         g.score         AS score,
         g.raw_score     AS raw_score,
         g.method        AS method,
         g.grading_version AS grading_version,
         g.judge_model   AS judge_model,
         g.created_at    AS graded_at,
         r.status        AS run_status,
         r.started_at    AS run_started_at,
         r.test_id       AS test_id,
         t.name          AS test_name,
         r.scenario_id   AS scenario_id,
         s.name          AS scenario_name,
         s.model         AS model,
         f.id            AS feedback_id,
         f.verdict       AS verdict,
         f.note          AS note,
         f.created_at    AS feedback_created_at
       FROM grade_feedback f
       JOIN run_grades g ON g.id = f.grade_id
       JOIN runs r       ON r.id = g.run_id
       LEFT JOIN tests t     ON t.id = r.test_id
       LEFT JOIN scenarios s ON s.id = r.scenario_id
       ORDER BY r.started_at DESC, r.id ASC, g.created_at ASC, g.id ASC,
                f.created_at ASC, f.rowid ASC`,
    )
    .all() as CalibrationJoinRow[];

  // One pass, insertion-ordered: the SQL already sorts runs newest-first and each grade's verdicts
  // oldest-first, so the Maps preserve exactly the order the wire type documents.
  const runs = new Map<string, CalibrationRun>();
  const grades = new Map<string, CalibrationGrade>();

  for (const row of rows) {
    let run = runs.get(row.run_id);
    if (!run) {
      run = {
        runId: row.run_id,
        testId: row.test_id,
        testName: row.test_name,
        scenarioId: row.scenario_id,
        scenarioName: row.scenario_name,
        model: row.model,
        status: row.run_status,
        startedAt: row.run_started_at,
        grades: [],
      };
      runs.set(row.run_id, run);
    }

    const feedback: GradeFeedback = {
      id: row.feedback_id,
      gradeId: row.grade_id,
      runId: row.run_id,
      verdict: row.verdict,
      ...(row.note === null ? {} : { note: row.note }),
      createdAt: row.feedback_created_at,
    };

    const grade = grades.get(row.grade_id);
    if (grade) {
      grade.feedback.push(feedback);
      // Rows arrive oldest-first, so the LAST one seen is the newest — the verdict a surface shows.
      grade.latestVerdict = feedback.verdict;
      continue;
    }
    const created: CalibrationGrade = {
      gradeId: row.grade_id,
      graderId: row.grader_id,
      kind: row.kind,
      status: row.status,
      score: row.score,
      rawScore: row.raw_score,
      method: row.method,
      gradingVersion: row.grading_version,
      judgeModel: row.judge_model,
      gradedAt: row.graded_at,
      feedback: [feedback],
      latestVerdict: feedback.verdict,
    };
    grades.set(row.grade_id, created);
    run.grades.push(created);
  }

  const memberRuns = [...runs.values()];
  const memberGrades = [...grades.values()];
  const totals: CalibrationTotals = {
    runs: memberRuns.length,
    gradesWithFeedback: memberGrades.length,
    verdicts: rows.length,
    agree: memberGrades.filter((grade) => grade.latestVerdict === "agree").length,
    disagree: memberGrades.filter((grade) => grade.latestVerdict === "disagree").length,
    notes: rows.filter((row) => row.note !== null).length,
  };

  return {
    generatedAt: now.toISOString(),
    // WP 6.2's agreement math must not average across grading versions silently — the distinct set
    // is reported so a consumer cannot pretend not to know that this sample spans two methods.
    gradingVersions: [...new Set(memberGrades.map((grade) => grade.gradingVersion))].sort(
      (a, b) => a - b,
    ),
    totals,
    runs: memberRuns,
  };
}

/** The flat join row `buildCalibrationSet` folds into the nested wire shape. */
type CalibrationJoinRow = {
  grade_id: string;
  run_id: string;
  grader_id: GraderId;
  kind: GradeKind;
  status: GradeStatus;
  score: number | null;
  raw_score: number | null;
  method: string;
  grading_version: number;
  judge_model: string | null;
  graded_at: string;
  run_status: string;
  run_started_at: string | null;
  test_id: string | null;
  test_name: string | null;
  scenario_id: string | null;
  scenario_name: string | null;
  model: string | null;
  feedback_id: string;
  verdict: "agree" | "disagree";
  note: string | null;
  feedback_created_at: string;
};
