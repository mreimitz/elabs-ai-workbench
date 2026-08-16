import {
  APP_SETTING_JUDGE_KEY,
  type GraderId,
  type JudgeSettings,
  type JudgeSettingsResolved,
  judgeSettingsUpdateSchema,
  type RatingState,
  type RunGrade,
  type RunReport,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { isModelPriced } from "../providers/pricing.js";
import { httpError } from "../utils/errors.js";
import type { AppSettingsRepository } from "./app-settings-repository.js";
import {
  readProviderJudge,
  resolveCliJudgeModel,
  resolveJudgeSource,
  writeCliJudgeModel,
} from "./judge-chain.js";
import { OUTCOME_JUDGE_ID } from "./judge.js";
import type { GradeService } from "./grade-service.js";
import type { RunReportService } from "./run-report.js";

/**
 * Benchmarks grading routes (B2/B3/B5). Reads over the append-only `run_grades` history, plus the WP 1.3
 * judge-settings KV and the re-grade endpoint. No route ever executes a run or an MCP tool — a re-grade
 * only READS the persisted run + expectations and (for the LLM judge) makes one provider call.
 *
 * `GET /api/runs/:id/grades` → `{ grades, latest }` (full history + newest-per-grader).
 * `GET /api/grading/judge-settings` → the configured provider {@link JudgeSettings} PLUS the resolved
 *   judge source (Auto-Rating WP 2.3, AR3): CLI availability, the resolved CLI model, and which source
 *   (`claude_cli` → `provider` → `none`) rates a run now. The subscription token is NEVER included.
 * `PUT /api/grading/judge-settings` → validate + reject an UNPRICED PROVIDER model (400, exactly like a
 *   run) + store; ALSO persists the optional CLI judge model (a subscription model → NOT pricing-guarded).
 * `POST /api/runs/:id/grade` → re-grade (append-only); optional `{ graderIds }` subset. Naming the LLM
 *   judge with an unpriced configured PROVIDER judge model → 400 (never a silently-uncapped judge spend).
 * `GET /api/runs/:id/report` (Auto-Rating WP 1.5, AR1) → the composed {@link RunReport}: base rating +
 *   expectation grades + assertions + KPIs + judge provenance, assembled fresh on every read by
 *   {@link RunReportService.compose} — a pure read, never grades/executes/mutates a run (AR11). 404s on
 *   an unknown run (the same `RunRepository.getSummary` guard `listGrades` already relies on).
 *
 * `cliAvailable` is a server-side probe (a Claude subscription is signed in). It NEVER exposes the token.
 */
export async function registerGradingRoutes(
  app: FastifyInstance,
  grades: GradeService,
  appSettings: AppSettingsRepository,
  judge: { cliAvailable: () => boolean },
  runReports: RunReportService,
  /**
   * Rating Issues registry (optional, additive) — when wired, a manual re-grade also re-folds the
   * run's error_forensics findings into the per-skill / per-server issue registry, the SAME fully
   * guarded way the run-service post-terminal hook does. Absent → zero behavior change.
   */
  issues?: { processRun(runId: string): Promise<void> },
  /**
   * Rating axis (AR11, optional, additive) — when wired, a manual re-grade transitions the run's
   * `rating_state` around the grade call (`rating` → `rated`/`failed`) and appends the transitions to
   * the persisted run_events log, so a later replayed stream converges on the re-rate's outcome. The
   * run's live SSE channel is typically long gone by re-rate time, so no live emit is attempted here
   * (the persisted row + log ARE the convergence path). Absent → zero behavior change.
   */
  runs?: {
    setRatingState(runId: string, state: RatingState): void;
    appendRatingEvent(runId: string, state: RatingState): void;
  },
): Promise<void> {
  // Persist one rating-axis transition (row + replay log), fully guarded — a rating bookkeeping
  // failure must never fail the re-grade itself (mirrors the run-service transition discipline).
  const transitionRating = (runId: string, state: RatingState): void => {
    if (!runs) return;
    try {
      runs.setRatingState(runId, state);
      runs.appendRatingEvent(runId, state);
    } catch {
      // Never let rating bookkeeping break the grade response.
    }
  };
  app.get(
    "/api/runs/:id/grades",
    async (request): Promise<{ grades: RunGrade[]; latest: RunGrade[] }> => {
      const { id } = request.params as { id: string };
      if (!id) throw httpError(400, "Run id is required");
      return grades.listGrades(id);
    },
  );

  // Auto-Rating WP 1.5 — the composed per-run report (AR1). Thin route → service; the compose is a pure
  // read (never grades/executes/mutates, AR11) so it is always safe to call, including mid-run.
  app.get("/api/runs/:id/report", async (request): Promise<RunReport> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Run id is required");
    return runReports.compose(id);
  });

  // The configured provider judge (references only) + the resolved judge source (WP 2.3, AR3).
  app.get("/api/grading/judge-settings", async (): Promise<JudgeSettingsResolved> => {
    return buildResolvedJudge(appSettings, judge.cliAvailable);
  });

  // Set the judge. Reject an unpriced PROVIDER model with 400 exactly like a cost-capped run (issue #10):
  // a provider judge on a model we cannot price would spend unbounded and read cost 0 in the SEPARATE
  // judge ledger. The optional CLI judge model is a subscription (cost 0) → NOT subject to that guard.
  app.put("/api/grading/judge-settings", async (request): Promise<JudgeSettingsResolved> => {
    const body = judgeSettingsUpdateSchema.parse(request.body);
    if (body.model && !isModelPriced(body.model)) {
      throw httpError(
        400,
        `Judge model "${body.model}" has no known pricing; refusing to set it as the provider judge ` +
          "(the judge cost ledger would read 0 and spend would be uncapped). Pick a priced model.",
      );
    }
    const settings: JudgeSettings = {
      providerCredentialId: body.providerCredentialId,
      model: body.model,
    };
    appSettings.put(APP_SETTING_JUDGE_KEY, settings);
    if (body.cliModel !== undefined) writeCliJudgeModel(appSettings, body.cliModel);
    return buildResolvedJudge(appSettings, judge.cliAvailable);
  });

  // Re-grade a run (append-only): runs the selected graders again, adding fresh rows (older rows kept,
  // latest-per-grader wins). A subset naming the LLM judge with an unpriced configured judge → 400.
  app.post("/api/runs/:id/grade", async (request): Promise<{ inserted: RunGrade[] }> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Run id is required");
    const body = (request.body ?? {}) as { graderIds?: GraderId[] };
    const graderIds = body.graderIds;

    const namesJudge = !graderIds || graderIds.includes(OUTCOME_JUDGE_ID);
    if (namesJudge) {
      // Only the PROVIDER judge model is pricing-guarded here — a re-grade that would fall to the CLI
      // (no provider configured) reads `null` and is not blocked (the CLI is a cost-0 subscription).
      const provider = readProviderJudge(appSettings);
      if (provider?.model && !isModelPriced(provider.model)) {
        throw httpError(
          400,
          `The configured judge model "${provider.model}" has no known pricing; refusing to re-grade with ` +
            "the outcome judge. Pick a priced judge model in grading settings.",
        );
      }
    }

    // AR11 — a re-rate is a review pass too: set `rating` before the grade call and settle to
    // `rated`/`failed` after, mirroring the run-service axis (persisted only; see `transitionRating`).
    // A grade failure still surfaces as the route's error (unchanged) — the axis just records it.
    transitionRating(id, "rating");
    let inserted: RunGrade[];
    try {
      inserted = await grades.gradeRun(id, graderIds ? { graderIds } : undefined);
    } catch (error) {
      transitionRating(id, "failed");
      throw error;
    }
    // Rating Issues registry — re-fold the (possibly refreshed) error_forensics findings. Guarded:
    // an issue-processing failure never fails the re-grade response (the grades were already written).
    if (issues) {
      try {
        await issues.processRun(id);
      } catch {
        // processRun is self-guarded; this is defense in depth for a faulty injected service.
      }
    }
    transitionRating(id, "rated");
    return { inserted };
  });
}

/**
 * Compose the {@link JudgeSettingsResolved} response (WP 2.3): the configured provider judge settings
 * (references only, `{null,null}` when unconfigured), whether the Claude-CLI judge is available, the
 * resolved CLI model, and which source rates a run now. The subscription token never appears here.
 */
function buildResolvedJudge(
  appSettings: AppSettingsRepository,
  cliAvailable: () => boolean,
): JudgeSettingsResolved {
  const provider = readProviderJudge(appSettings);
  return {
    settings: provider ?? { providerCredentialId: null, model: null },
    cliAvailable: cliAvailable(),
    cliModel: resolveCliJudgeModel(appSettings),
    resolvedSource: resolveJudgeSource({ cliAvailable, resolveProviderJudge: () => provider }),
  };
}

/**
 * The production judge-resolver for the OPT-IN failure-bucket clustering (`FailureBucketService`): reads
 * the PROVIDER judge from the app-settings KV. Exported so `index.ts` keeps wiring the provider-only
 * resolution there (the mandatory / expectation graders now use the CLI-first chain in `judge-chain.ts`).
 */
export function judgeResolver(appSettings: AppSettingsRepository): () => JudgeSettings | null {
  return () => readProviderJudge(appSettings);
}
