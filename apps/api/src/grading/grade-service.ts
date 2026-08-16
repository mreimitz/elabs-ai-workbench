import type { GraderId, RunGrade } from "@mcp-token-footprint/shared";
import type { RunRepository } from "../testing/run-repository.js";
import type { TestService } from "../testing/test-service.js";
import { toErrorMessage } from "../utils/errors.js";
import type { GradeInsert, GradeRepository } from "./grade-repository.js";
import {
  DETERMINISTIC_GRADERS,
  finalAssistantText,
  type GradeContext,
  type Grader,
  type GraderResult,
} from "./grader.js";

/**
 * Runs a run's graders and appends their verdicts to `run_grades`. This is BOTH the auto-grade entry
 * point (called from the run-service post-completion hook) AND the re-grade entry point (WP 1.3's
 * endpoint calls the same method) — it is re-entrant by design: append-only, so calling it again just
 * adds fresh rows and latest-per-grader wins for display.
 *
 * The grader roster is injectable (defaults to the free deterministic graders). WP 1.3 wires its LLM
 * judge by passing a longer list to the constructor — this file does NOT change to add a grader.
 *
 * HARD invariants: grading NEVER mutates the run (this only inserts grade rows), NEVER throws into the
 * caller (each grader is individually guarded → an `error` row), and NEVER executes anything (graders
 * read the persisted run + authored expectations only). `unevaluable` is never a failure / never a 0.
 */
export class GradeService {
  private readonly graders: readonly Grader[];
  /**
   * Auto-Rating ops kill-switch (WP 1.2, AR5). When `false`, MANDATORY base-rating graders are skipped
   * ENTIRELY (expectation grading is UNAFFECTED). INJECTED (defaults `true`) rather than read from
   * `config` so the service stays offline-testable; `apps/api/src/index.ts` passes
   * `config.autoRatingEnabled`.
   */
  private readonly autoRatingEnabled: boolean;

  /**
   * Observability (WP3.1, D-OB17) — when `true`, a completed review ALSO persists a `rating` span step
   * with one `judge_call` child per LLM grade (the run's step TREE, consumed by WP3.2). ADDITIVE +
   * FORWARD-ONLY: default `false` so the many direct-construction grading tests observe NO extra steps
   * (the "grading/suite/report tests stay green untouched" guardrail); `apps/api/src/index.ts` passes
   * `true` so real runs get the span. The metadata is emitted through {@link RunRepository.appendDerivedStep}
   * (persistence only) and never touches the grade rows / run totals / assistantText.
   */
  private readonly emitReviewSpans: boolean;

  constructor(
    private readonly gradeRepo: GradeRepository,
    private readonly tests: TestService,
    private readonly runs: RunRepository,
    graders: readonly Grader[] = DETERMINISTIC_GRADERS,
    opts: { autoRatingEnabled?: boolean; emitReviewSpans?: boolean } = {},
  ) {
    this.graders = graders;
    this.autoRatingEnabled = opts.autoRatingEnabled ?? true;
    this.emitReviewSpans = opts.emitReviewSpans ?? false;
  }

  /**
   * Grade `runId`. Loads the persisted run + its test's authored expectations, builds the read-only
   * {@link GradeContext} ALWAYS, and runs each ELIGIBLE grader — all registered, or the `graderIds`
   * subset (re-grade). Each grader is individually try/caught; a grader that throws yields a persisted
   * `error` row rather than propagating. Returns the rows inserted by THIS call (the append-only history
   * is read via the repository).
   *
   * Eligibility is decided PER grader ({@link isEligible}, AR5): MANDATORY base-rating graders run on
   * ANY terminal run status, with or without `expectations` (gated only by the injected
   * `AUTO_RATING_ENABLED` kill-switch); EXPECTATION (non-mandatory) graders keep TODAY's gate EXACTLY —
   * only a cleanly `completed` run whose test carries authored `expectations`. So a test with no
   * expectations (and a roster of expectation graders only) still persists ZERO rows, as before.
   */
  async gradeRun(runId: string, opts?: { graderIds?: GraderId[] }): Promise<RunGrade[]> {
    const run = this.runs.getRun(runId);
    const test = this.tests.get(run.testId);
    // Build the read-only context ALWAYS — a mandatory grader needs it even when the test has no
    // authored expectations and the run did not cleanly complete (AR5). There is no blanket
    // short-circuit anymore: eligibility is a per-grader decision below.
    const ctx: GradeContext = { run, test, finalAssistantText: finalAssistantText(run) };
    const graderIds = opts?.graderIds;
    const selected = graderIds
      ? this.graders.filter((g) => graderIds.includes(g.id))
      : this.graders;
    // Two gates, applied PER grader:
    //  (1) Applicability (WP 2.2, unchanged): a grader whose `appliesTo` returns false is skipped
    //      ENTIRELY — no `grade()` call and no row (not even `unevaluable`). Graders without `appliesTo`
    //      (the deterministic set + the outcome judge) always apply. Lets `trajectory_judge` opt out
    //      (no wasted judge call) when the test carries no `referenceLogic`.
    //  (2) Eligibility (AR5, {@link isEligible}): mandatory base-rating graders run on any terminal
    //      status w/o expectations (gated only by the kill-switch); expectation graders only on
    //      `completed` + `expectations`. The re-grade path narrows `selected` first, then the SAME two
    //      gates apply — so re-rating a mandatory grader on an `error` run still runs it. An ineligible
    //      grader gets NO row, exactly as a no-expectations test produced zero rows before.
    const applicable = selected.filter(
      (g) => (g.appliesTo ? g.appliesTo(ctx) : true) && this.isEligible(g, ctx),
    );

    const inserted: RunGrade[] = [];
    for (const grader of applicable) {
      let result: GraderResult;
      try {
        result = await grader.grade(ctx);
      } catch (error) {
        // A grader crash is surfaced as an `error` grade — never propagated, never a silent 0.
        result = {
          status: "error",
          score: null,
          method: "grader_threw",
          reasoning: toErrorMessage(error),
        };
      }
      inserted.push(this.gradeRepo.insert(toInsert(runId, grader, result)));
    }
    // Observability (WP3.1, D-OB17) — record this review as a `rating` span step with its LLM judge
    // invocations as `judge_call` children. Gated (default off) + fully guarded: it is PURE persisted
    // hierarchy metadata (never a grade row / run total / assistantText), so a failure here must never
    // taint the append-only grade history the caller relies on.
    if (this.emitReviewSpans && inserted.length > 0) {
      try {
        this.emitReviewSpan(runId, inserted);
      } catch {
        // Hierarchy metadata is best-effort — a persist failure never propagates into the grade chain.
      }
    }
    return inserted;
  }

  /**
   * Observability (WP3.1, D-OB17) — persist the run-review step subtree: one `rating` PARENT span, then
   * one `judge_call` CHILD per LLM grade (a real judge invocation), carrying the model + the separate
   * judge token/cost ledger. Deterministic grades are NOT judge calls, so they get no child (the span
   * still records the review). Appended AFTER the run's execution steps (MAX idx+1) — a rendering of
   * parent links, never a reordering.
   */
  private emitReviewSpan(runId: string, grades: RunGrade[]): void {
    const judgeCalls = grades.filter((g) => g.kind === "llm");
    const parentId = this.runs.appendDerivedStep(runId, {
      spanKind: "rating",
      label: "Run review",
      status: grades.some((g) => g.status === "error") ? "error" : "ok",
      payload: { graders: grades.length, judgeCalls: judgeCalls.length },
    });
    for (const g of judgeCalls) {
      this.runs.appendDerivedStep(runId, {
        spanKind: "judge_call",
        label: g.judgeModel ?? g.graderId,
        status: g.status === "error" ? "error" : "ok",
        parentStepId: parentId,
        payload: {
          graderId: g.graderId,
          judgeModel: g.judgeModel,
          judgeProviderId: g.judgeProviderId,
          judgeTokensIn: g.judgeTokensIn,
          judgeTokensOut: g.judgeTokensOut,
          judgeCostUsd: g.judgeCostUsd,
        },
      });
    }
  }

  /**
   * Per-grader eligibility (AR5). A MANDATORY base-rating grader is eligible on ANY terminal run status,
   * with or without authored expectations — the only gate is the injected `AUTO_RATING_ENABLED`
   * kill-switch (so `false` skips mandatory graders entirely). An EXPECTATION (non-mandatory) grader
   * keeps TODAY's behavior byte-for-byte: eligible only when the run cleanly `completed` AND its test
   * carries authored `expectations`.
   */
  private isEligible(grader: Grader, ctx: GradeContext): boolean {
    if (grader.mandatory) return this.autoRatingEnabled;
    return ctx.run.status === "completed" && Boolean(ctx.test.expectations);
  }

  /** Read side (thin) — the run's full append-only grade history + the latest row per grader. */
  listGrades(runId: string): { grades: RunGrade[]; latest: RunGrade[] } {
    this.runs.getSummary(runId); // 404 if the run doesn't exist
    return {
      grades: this.gradeRepo.listByRun(runId),
      latest: this.gradeRepo.latestByGrader(runId),
    };
  }
}

/**
 * Map a grader + its result to a persistence row. Deterministic graders leave the `judge_*` ledger
 * 0/null (they omit the optional judge fields); the LLM judge (WP 1.3) forwards its SEPARATE cost
 * ledger (provider/model refs, token counts, estimated USD) here so the repository writes the
 * `judge_*` columns — this cost NEVER folds into `runs.cost_usd` (B5).
 */
function toInsert(runId: string, grader: Grader, result: GraderResult): GradeInsert {
  return {
    runId,
    graderId: grader.id,
    kind: grader.kind,
    status: result.status,
    score: result.score,
    rawScore: result.rawScore ?? null,
    method: result.method,
    reasoning: result.reasoning ?? null,
    evidence: result.evidence,
    judgeProviderId: result.judgeProviderId ?? null,
    judgeModel: result.judgeModel ?? null,
    judgeTokensIn: result.judgeTokensIn ?? 0,
    judgeTokensOut: result.judgeTokensOut ?? 0,
    judgeCostUsd: result.judgeCostUsd ?? 0,
  };
}
