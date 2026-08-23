import {
  answerValidationEvidenceSchema,
  AUTO_RATING_VERSION,
  BASE_RATING_GRADER_IDS,
  errorFindingSchema,
  insightSurplusEvidenceSchema,
  type AnswerValidationEvidence,
  type ErrorFinding,
  type GraderId,
  type InsightSurplusEvidence,
  type RunBaseRating,
  type RunGrade,
  type RunReport,
} from "@mcp-token-footprint/shared";
import { z, type ZodType } from "zod";
import { dataPackStamp } from "../data-pack/stamp.js";
import type { GradeRepository } from "./grade-repository.js";
import type { RunRepository } from "../testing/run-repository.js";

/**
 * Auto-Rating WP 1.5 (AR1) — composes the on-demand {@link RunReport} from ALREADY-PERSISTED state:
 * the run's {@link RunSummary} (status/outcome/KPIs/assertionResults) + its latest-per-grader
 * {@link RunGrade} rows (the three always-on base graders, WP 1.3/1.4, PLUS whatever expectation
 * graders ran). NOTHING is persisted here and NOTHING is (re-)computed by calling a grader or a judge —
 * this is a pure READ + assemble (AR11: never blocks, never grades, never mutates, never executes).
 *
 * `GET /api/runs/:id/report` (`./routes.ts`) and the run JSON/MD export (`../reports/routes.ts`) both
 * call {@link RunReportService.compose} so the two surfaces can never disagree.
 */
export class RunReportService {
  constructor(
    private readonly grades: GradeRepository,
    private readonly runs: RunRepository,
  ) {}

  /** Assemble the {@link RunReport} for `runId`. Throws the repository's own 404 for an unknown run. */
  compose(runId: string): RunReport {
    const summary = this.runs.getSummary(runId); // 404s via RunRepository.getSummary if unknown
    const latest = this.grades.latestByGrader(runId);
    const byGrader = new Map(latest.map((grade) => [grade.graderId, grade]));

    const baseRating: RunBaseRating = {
      answerValidation: parseEvidence(
        byGrader.get("answer_validation"),
        answerValidationEvidenceSchema,
        DEFAULT_ANSWER_VALIDATION,
      ),
      insightSurplus: parseEvidence(
        byGrader.get("insight_surplus"),
        insightSurplusEvidenceSchema,
        DEFAULT_INSIGHT_SURPLUS,
      ),
      errorForensics: parseEvidence(
        byGrader.get("error_forensics"),
        ERROR_FORENSICS_EVIDENCE_SCHEMA,
        [],
      ),
    };

    return {
      runId: summary.id,
      status: summary.status,
      ...(summary.outcome !== undefined ? { outcome: summary.outcome } : {}),
      baseRating,
      // AR6 — expectation grades EXCLUDE the three base-rating ids; base rating is a separate dimension.
      expectationGrades: latest.filter((grade) => !BASE_GRADER_ID_SET.has(grade.graderId)),
      // Normalized to `[]` (unlike RunSummary.assertionResults, which is absent when the test declared none).
      assertionResults: summary.assertionResults ?? [],
      kpis: {
        turns: summary.turns,
        toolCalls: summary.toolCalls,
        peakContextTokens: summary.peakContextTokens,
        tokensIn: summary.tokensIn,
        tokensOut: summary.tokensOut,
        costUsd: summary.costUsd,
        ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
      },
      judgeProvenance: pickJudgeProvenance(latest),
      ratingVersion: AUTO_RATING_VERSION,
      generatedAt: new Date().toISOString(),
      // RM-38 D-DP8 — the pack whose thresholds (the failure-bucket floor, the quality weights)
      // stand behind the numbers a reader compares across runs.
      ...dataPackStamp(),
    };
  }
}

const BASE_GRADER_ID_SET: ReadonlySet<GraderId> = new Set(BASE_RATING_GRADER_IDS);

const ERROR_FORENSICS_EVIDENCE_SCHEMA = z.array(errorFindingSchema);

/**
 * Honest default facet for a base grader that never ran at all (e.g. the run predates Auto-Rating, or
 * `AUTO_RATING_ENABLED` was off) — NOT a claim about the answer, just the neutral "no signal" shape the
 * required {@link RunBaseRating} type demands. `score: null` (never 0). Used for BOTH:
 *   (1) an entirely ABSENT grade row (the grader never ran), and
 *   (2) a PRESENT row whose `evidence` fails to parse against the WP 1.1 schema (e.g. a base grader
 *       short-circuited to `unevaluable` with no typed evidence at all — the unconfigured/unpriced-judge
 *       paths in `answer-validation.ts`/`insight-surplus.ts` return no `evidence`). Case (2) still HAD a
 *       real grade row (with its own honest `reasoning`/`method`), but `RunBaseRating`'s shape only carries
 *       the typed evidence, so both cases fall back to the same documented default here.
 */
const DEFAULT_ANSWER_VALIDATION: AnswerValidationEvidence = {
  verdict: "unanswered",
  score: null,
  quotes: [],
  citedSteps: [],
};

/** Honest default for `insight_surplus` when absent/unparseable — `"none"` (no surplus signal), not a claim. */
const DEFAULT_INSIGHT_SURPLUS: InsightSurplusEvidence = {
  verdict: "none",
  score: null,
  quotes: [],
  citedSteps: [],
};

/** Parse a grade row's `evidence` against its typed schema; fall back to `fallback` when absent/invalid. */
function parseEvidence<T>(row: RunGrade | undefined, schema: ZodType<T>, fallback: T): T {
  if (!row) return fallback;
  const parsed = schema.safeParse(row.evidence);
  return parsed.success ? parsed.data : fallback;
}

/**
 * Which judge source rated the LLM base-rating facets (AR2/AR3) — the first base grader row (in
 * {@link BASE_RATING_GRADER_IDS} order) that actually stamped a `judgeProviderId` (a real call ran,
 * CLI or provider). `{null, null}` when no base grader ever made a judge call (e.g. no judge configured,
 * or every base grader is still on its deterministic/inventory-only path).
 */
function pickJudgeProvenance(
  latest: readonly RunGrade[],
): Pick<RunGrade, "judgeProviderId" | "judgeModel"> {
  for (const graderId of BASE_RATING_GRADER_IDS) {
    const row = latest.find((grade) => grade.graderId === graderId);
    if (row?.judgeProviderId)
      return { judgeProviderId: row.judgeProviderId, judgeModel: row.judgeModel };
  }
  return { judgeProviderId: null, judgeModel: null };
}
