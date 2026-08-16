import {
  CLAUDE_CLI_PROVIDER_ID,
  DEFAULT_TOKEN_PROFILE,
  INSIGHT_SURPLUS_VERDICTS,
  type InsightSurplusEvidence,
  type InsightSurplusVerdict,
} from "@mcp-token-footprint/shared";
import { isModelPriced } from "../providers/pricing.js";
import { getTokenCounter } from "../token-counting/profiles.js";
import { toErrorMessage } from "../utils/errors.js";
import {
  answerStepIndices,
  type BaseRatingJudgeDeps,
  callWithTimeout,
  clipAnswer,
  judgeErrorResult,
  judgeLedger,
  parseVerdictRating,
  truncate,
  unevaluableResult,
  verdictFor,
} from "./base-rating-judge.js";
import type { GradeContext, Grader, GraderResult } from "./grader.js";
import {
  DEFAULT_JUDGE_QUEUE_BACKSTOP_MS,
  type JudgeGenerateResult,
  normalizeRating,
} from "./judge.js";

/**
 * insight_surplus (Auto-Rating WP 1.4, AR8 — DOUBLE-EDGED) — grader `insight_surplus`, kind `llm`,
 * MANDATORY (`mandatory: true`). Grades the BEYOND-ASK content of the run's final answer: grounded,
 * relevant surplus RAISES the score (`valuable`); unrequested padding / dumps LOWER it (`noise`) and
 * their token cost is NAMED (`surplusTokens`); an on-ask answer with no surplus is neutral (`none`).
 * ONE bounded provider call reads the test's `userPrompt` + the run's `finalAssistantText` and returns
 * a verdict (`none | valuable | noise`), a 0–1 score, and evidence — verbatim `quotes` + deep-linkable
 * `citedSteps`. "Double-edged" is enforced by the rubric AND the score bands: padding pulls the score
 * DOWN, never up.
 *
 * `surplusTokens` (present only on `noise`) is the token cost of the padding: the app's token counter
 * ({@link getTokenCounter}, the default `generic_o200k` BPE lens — a stable, model-agnostic
 * approximation of the wasted context) is run over the judge's quoted padding spans. Counting the
 * quoted spans (not the whole answer) keeps the figure grounded in the named noise.
 *
 * HARD invariants (AR11/B15) — identical to {@link import("./answer-validation.js")}: never executes
 * anything, never throws/blocks/mutates a run, `score` is `null` (not 0) when unevaluable (no final
 * answer → verdict `none`, score null, NO call; unconfigured/unpriced judge → unevaluable, no spend;
 * failed/unparseable call → `error`), judge cost ONLY in the `judge_*` ledger, version-stamped
 * `method` (`insight_surplus_v1`, AR15). Offline-testable via injected deps; NOT wired into the roster
 * here (the orchestrator injects it after merge).
 */

export const INSIGHT_SURPLUS_ID = "insight_surplus";

/** Version-stamped method for a real graded verdict (AR15). */
const METHOD_GRADED = "insight_surplus_v1";
const METHOD_NO_ANSWER = "insight_surplus_no_answer";
const METHOD_UNCONFIGURED = "judge_unconfigured";
const METHOD_UNPRICED = "judge_unpriced";
const METHOD_ERROR = "judge_error";

/** The token profile used to price the padding span (the app default; model-agnostic + offline). */
const SURPLUS_TOKEN_PROFILE = DEFAULT_TOKEN_PROFILE;

/** Frames the judge as grading double-edged beyond-ask content — value up, padding down. */
export const INSIGHT_SURPLUS_SYSTEM =
  "You are a meticulous evaluator judging the BEYOND-ASK content in an AI assistant's answer — " +
  "everything it provided that the user did NOT ask for. Beyond-ask content is double-edged: " +
  "grounded, relevant surplus that adds real value RAISES your score; unrequested padding, filler, " +
  "boilerplate, verbose preamble, or raw data dumps LOWER it (they waste tokens). You judge the " +
  "surplus ONLY — not whether the core question was answered (a separate grader handles that). You " +
  "respond with ONLY the requested JSON.";

/** Build the insight-surplus prompt (the question + the answer + the double-edged JSON response contract). */
export function buildInsightSurplusPrompt(input: {
  question: string;
  answer: string;
  truncated: boolean;
}): string {
  const clipNote = input.truncated
    ? "\n(Note: the answer above was clipped to fit; judge only the portion shown.)"
    : "";
  return `## The user's question (what was asked)
${input.question}

## The assistant's final answer (what was produced)
${input.answer || "(the assistant produced no answer)"}${clipNote}

---

Evaluate ONLY the BEYOND-ASK content of the answer — material the user did not explicitly ask for. This is DOUBLE-EDGED:
* Grounded, relevant surplus a user would find genuinely valuable (a pertinent caveat, a directly useful related figure, a concise helpful next step) is GOOD and RAISES the score.
* Unrequested padding — filler, restated boilerplate, verbose preamble, irrelevant tangents, or raw data dumps — is BAD, wastes tokens, and LOWERS the score.

Assign:
* "verdict":
  - "valuable" — the answer adds grounded, relevant beyond-ask insight that genuinely improves it.
  - "none" — the answer stays essentially on-ask with no meaningful surplus (neither adding value nor padding).
  - "noise" — the answer pads with unrequested filler / dumps that add little and waste tokens.
* "rating": a single INTEGER 0–10 for the QUALITY of the beyond-ask content — valuable surplus scores HIGH (≈ 7–10), on-ask/no-surplus is neutral (≈ 5–6), padding/noise scores LOW (≈ 0–4). Padding must PULL THE SCORE DOWN, never up.
* "quotes": an array of SHORT, VERBATIM excerpts copied exactly from the answer. For "noise", quote the PADDING spans (these name the wasted content). For "valuable", quote the valuable surplus. Use [] when there is no surplus.
* "reason": one or two sentences justifying the verdict and rating.

Respond with ONLY raw JSON (no markdown code fences), exactly:
{"verdict": "valuable|none|noise", "rating": <integer 0-10>, "quotes": ["<verbatim excerpt>", ...], "reason": "<one or two sentences>"}`;
}

/** Fallback verdict from the 0–10 rating when the judge omits/garbles the `verdict` string. */
function verdictFromRating(rating: number): InsightSurplusVerdict {
  if (rating >= 7) return "valuable";
  if (rating >= 5) return "none";
  return "noise";
}

/**
 * The token cost of the named padding: the app's default-profile BPE lens over the quoted padding
 * spans. Empty quotes → 0 (still populated on `noise`, so the cost is always named). Non-negative int.
 */
async function countSurplusTokens(quotes: readonly string[]): Promise<number> {
  const span = quotes
    .map((quote) => quote.trim())
    .filter((quote) => quote.length > 0)
    .join("\n");
  if (!span) return 0;
  const tokens = await getTokenCounter(SURPLUS_TOKEN_PROFILE).countText(span);
  return Math.max(0, Math.round(tokens));
}

/**
 * Build the `insight_surplus` grader from its deps. Returned grader is `async` + self-contained:
 * short-circuits (free, no call) when there is no final answer / no judge / an unpriced judge, else
 * makes ONE bounded provider call, parses the double-edged verdict + rating, names the padding token
 * cost on `noise`, and reports the 0–1 score + typed evidence + the SEPARATE judge cost ledger. NEVER
 * throws.
 */
export function createInsightSurplusGrader(deps: BaseRatingJudgeDeps): Grader {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JUDGE_QUEUE_BACKSTOP_MS;

  return {
    id: INSIGHT_SURPLUS_ID,
    kind: "llm",
    mandatory: true,
    async grade(ctx: GradeContext): Promise<GraderResult> {
      const answer = ctx.finalAssistantText.trim();
      // No final answer → no surplus to grade: verdict `none`, score NULL (not 0), no judge call.
      if (!answer) {
        const evidence: InsightSurplusEvidence = {
          verdict: "none",
          score: null,
          quotes: [],
          citedSteps: [],
        };
        return {
          status: "unevaluable",
          score: null,
          method: METHOD_NO_ANSWER,
          reasoning: "the run produced no final assistant answer to evaluate for surplus insight",
          evidence,
        };
      }

      const settings = deps.resolveJudge();
      // Unconfigured judge → unevaluable (NOT error, NOT 0). The default judge is optional.
      if (!settings || !settings.providerCredentialId || !settings.model) {
        return unevaluableResult(
          METHOD_UNCONFIGURED,
          "no default judge is configured (set one in grading settings)",
        );
      }
      // Unpriced judge model → refuse the call (mandatory graders auto-run): unevaluable, NO spend. The
      // guard is CLI-AWARE (WP 2.3): the Claude-CLI judge runs on the subscription (cost 0), so the
      // unpriced-provider guard does NOT apply to it — the chain routes the actual call + provenance.
      if (
        settings.providerCredentialId !== CLAUDE_CLI_PROVIDER_ID &&
        !isModelPriced(settings.model)
      ) {
        return unevaluableResult(
          METHOD_UNPRICED,
          `the configured judge model "${settings.model}" has no known pricing; refusing to run (no spend)`,
        );
      }

      const clip = clipAnswer(answer);
      const prompt = buildInsightSurplusPrompt({
        question: ctx.test.userPrompt,
        answer: clip.text,
        truncated: clip.truncated,
      });

      // ONE provider call, bounded so a stuck provider settles into an `error` grade (never a hang).
      let gen: JudgeGenerateResult;
      try {
        gen = await callWithTimeout(
          (signal) => deps.generate(settings, prompt, { system: INSIGHT_SURPLUS_SYSTEM, signal }),
          timeoutMs,
        );
      } catch (error) {
        return judgeErrorResult(settings, METHOD_ERROR, toErrorMessage(error));
      }

      const parsed = parseVerdictRating(gen.text);
      if (!parsed) {
        return judgeErrorResult(
          settings,
          METHOD_ERROR,
          `judge produced no parseable rating: ${truncate(gen.text)}`,
          gen.usage,
          gen,
        );
      }

      const verdict = verdictFor(
        parsed.verdict,
        INSIGHT_SURPLUS_VERDICTS,
        verdictFromRating(parsed.rating),
      );
      const score = normalizeRating(parsed.rating);
      // Name the wasted-token cost ONLY when the surplus is noise (padding). Absent otherwise.
      const surplusTokens =
        verdict === "noise" ? await countSurplusTokens(parsed.quotes) : undefined;
      const evidence: InsightSurplusEvidence = {
        verdict,
        score,
        quotes: parsed.quotes,
        citedSteps: answerStepIndices(ctx.run),
        ...(surplusTokens !== undefined ? { surplusTokens } : {}),
      };
      const baseReason = parsed.reason || gen.text.trim();
      const reasoning = clip.truncated
        ? `${baseReason}\n\n(note: the answer was clipped to ${clip.text.length} chars before rating — the rating covers only the shown portion)`
        : baseReason;

      return {
        status: "graded",
        score,
        rawScore: parsed.rating,
        method: METHOD_GRADED,
        reasoning,
        evidence,
        ...judgeLedger(settings, gen.usage, gen),
      };
    },
  };
}
