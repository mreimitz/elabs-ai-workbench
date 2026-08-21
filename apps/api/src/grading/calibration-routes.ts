import type { FastifyInstance } from "fastify";
import {
  gradeFeedbackInputSchema,
  type CalibrationSet,
  type GradeFeedback,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import { httpError } from "../utils/errors.js";
import { buildCalibrationSet } from "./calibration.js";
import { createCalibrationMarkdown } from "./calibration-markdown.js";
import type { GradeFeedbackRepository } from "./grade-feedback-repository.js";

/**
 * Grade feedback + the calibration set (Benchmarks Phase 6, WP 6.1).
 *
 * Registered as its own registrar beside {@link import("./routes.js").registerGradingRoutes} — the
 * grading registrar's positional signature is already long, and these four routes share no
 * dependency with it beyond the database.
 *
 * `POST /api/grades/:gradeId/feedback` → 201, the appended {@link GradeFeedback}. APPEND-ONLY: a
 *   changed mind posts again and a new row lands; the newest per grade wins for display. There is
 *   deliberately **no PUT, PATCH or DELETE** on this resource — not "not implemented yet", but the
 *   contract. An unknown grade is a 404, never an orphan row.
 * `GET /api/runs/:runId/grade-feedback` → every verdict on every grade of one run, oldest first —
 *   the single call a run-scoped surface needs to paint its controls.
 * `GET /api/calibration/json` → the {@link CalibrationSet}: the flagged subset of graded runs that
 *   carry human feedback, composed on read (membership is derived from the feedback rows themselves,
 *   never a stored flag) and persisted nowhere.
 * `GET /api/calibration/markdown` → the same document rendered as Markdown, as an attachment.
 *
 * **AR6 — nothing here writes to `run_grades`.** These routes read grades and write only
 * `grade_feedback`; no score, aggregate or metric anywhere in the app is derived from a human
 * verdict. The regression test (`apps/api/test/grade-feedback.test.ts`) snapshots every grade row
 * around a feedback write and asserts byte equality, so a later change that blends the two goes red.
 */
export async function registerCalibrationRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  feedback: GradeFeedbackRepository,
): Promise<void> {
  app.post("/api/grades/:gradeId/feedback", async (request, reply): Promise<GradeFeedback> => {
    const { gradeId } = request.params as { gradeId: string };
    if (!gradeId) throw httpError(400, "Grade id is required");
    // Parsed here as well as in the repository so a malformed body is a 400 before any DB work —
    // the repository's own parse stays, because it is the guarantee for a non-HTTP caller too.
    const input = gradeFeedbackInputSchema.parse(request.body ?? {});
    const created = feedback.append(gradeId, input);
    reply.code(201);
    return created;
  });

  app.get("/api/runs/:runId/grade-feedback", async (request): Promise<GradeFeedback[]> => {
    const { runId } = request.params as { runId: string };
    if (!runId) throw httpError(400, "Run id is required");
    return feedback.listByRun(runId);
  });

  app.get("/api/calibration/json", async (): Promise<CalibrationSet> => buildCalibrationSet(db));

  app.get("/api/calibration/markdown", async (_request, reply) => {
    const set = buildCalibrationSet(db);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      'attachment; filename="mcp-token-footprint-calibration.md"',
    );
    return createCalibrationMarkdown(set);
  });
}
