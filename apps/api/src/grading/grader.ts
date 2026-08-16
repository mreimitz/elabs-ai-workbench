import type { GradeKind, GraderId, RunDetail, Test } from "@mcp-token-footprint/shared";
import { rouge1Grader } from "./rouge1.js";
import { valueMatchGrader } from "./value-match.js";

/**
 * Benchmarks — the Grader seam (B2/B4). Mirrors the {@link import("../token-counting/counter.js")}
 * `TokenCounter` interface: a small, stable contract behind which each grader lives, so new graders
 * (the LLM judges land in WP 1.3, the tool-hygiene / trajectory / conformance graders in WP 2.x) plug
 * in WITHOUT changing persistence or the auto-grade wiring.
 *
 * HARD invariants (roadmap/benchmarks/conventions.md): a grader NEVER executes anything — no MCP call,
 * no code run, no skill execution. It reads ONLY the persisted run + the test's authored expectations
 * (documents), and returns a verdict. Grading never blocks/fails/mutates a run; `unevaluable` is never
 * a failure and never a 0 score.
 */

/** The read-only inputs a grader sees: the persisted run, its test (with authored expectations), and
 *  the run's produced final answer text. NOTHING here is a live session or an executor. */
export type GradeContext = {
  run: RunDetail;
  test: Test;
  /** The run's produced answer — see {@link finalAssistantText}. */
  finalAssistantText: string;
};

/**
 * A grader's honest verdict. `status`:
 *   - `graded`      — a real score was produced (`score` is a 0–1 number).
 *   - `unevaluable` — the test carried no ground truth this grader needs (`score` is `null`, NEVER 0).
 *   - `error`       — the grader failed to run (`score` is `null`, surfaced, never a silent 0).
 * `method` is an honest algorithm stamp; `rawScore` is a grader-native score (unused by the two
 * deterministic graders — the LLM judges use it, e.g. a 0–10 rubric value).
 *
 * The optional `judge*` fields carry an LLM judge's SEPARATE cost ledger (B5, WP 1.3) — provider/model
 * refs, token counts, estimated USD — through {@link import("./grade-service.js").GradeService} to the
 * `judge_*` columns of the grade row. They are ADDITIVE and OPTIONAL: the deterministic graders omit
 * them entirely (the ledger stays 0/null), and this cost NEVER folds into `runs.cost_usd`.
 */
export type GraderResult = {
  status: "graded" | "unevaluable" | "error";
  score: number | null;
  rawScore?: number | null;
  method: string;
  reasoning?: string;
  evidence?: unknown;
  judgeProviderId?: string | null;
  judgeModel?: string | null;
  judgeTokensIn?: number;
  judgeTokensOut?: number;
  judgeCostUsd?: number;
};

/** One grader: a stable id + family, and a pure `grade(ctx)` producing a {@link GraderResult}. */
export interface Grader {
  readonly id: GraderId;
  readonly kind: GradeKind;
  grade(ctx: GradeContext): GraderResult | Promise<GraderResult>;
  /**
   * OPTIONAL applicability gate (WP 2.2). When present and it returns `false`, the grader is skipped
   * ENTIRELY — {@link import("./grade-service.js").GradeService} produces NO grade row (not even
   * `unevaluable`) and calls neither `appliesTo`'s grader's `grade()` — so an LLM judge that needs a
   * specific authored input (e.g. `trajectory_judge` needs `expectations.referenceLogic`) opts out with
   * NO wasted provider call. Omitting it (the deterministic graders + the outcome judge) means "always
   * applies" — those self-report `unevaluable` from inside `grade()` when they have nothing to judge.
   */
  appliesTo?(ctx: GradeContext): boolean;
  /**
   * OPTIONAL always-on flag (Auto-Rating WP 1.2, AR5). Omitted/`false` = an EXPECTATION grader (today's
   * roster): {@link import("./grade-service.js").GradeService} runs it ONLY on a cleanly `completed` run
   * whose test carries authored `expectations` — the pre-Auto-Rating gate, byte-for-byte unchanged.
   * `true` = a MANDATORY base-rating grader (see
   * {@link import("@mcp-token-footprint/shared").BASE_RATING_GRADER_IDS} —
   * `answer_validation`/`insight_surplus`/`error_forensics`): it runs on EVERY terminal run status
   * (`completed | stopped | error | aborted`) and WITHOUT `expectations`, gated ONLY by the injected
   * `AUTO_RATING_ENABLED` ops kill-switch. This flag is the mechanism the gate reads; what a mandatory
   * grader RETURNS on a run with no final answer (e.g. `unevaluable`) is the grader's own concern
   * (WP 1.4). The real base graders set this and are injected into the roster in WP 1.3/1.4 — NOT here.
   */
  readonly mandatory?: boolean;
}

/**
 * The deterministic (offline, no model call) grader registry, in a stable order. WP 1.3 registers the
 * LLM judge by INJECTING it into the {@link import("./grade-service.js").GradeService} grader list — it
 * is deliberately NOT added here (this list is the free, always-on set).
 */
export const DETERMINISTIC_GRADERS: readonly Grader[] = [rouge1Grader, valueMatchGrader];

/**
 * The run's produced answer: the assistant prose settled on the run's `llm_response` steps, in step
 * order. Each turn's prose is joined with a newline so multi-turn answers don't glue two words
 * together; the whole thing is trimmed. Empty string when the run produced no assistant text.
 */
export function finalAssistantText(run: RunDetail): string {
  return run.steps
    .filter((step) => step.type === "llm_response")
    .map((step) => step.assistantText ?? "")
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
}
