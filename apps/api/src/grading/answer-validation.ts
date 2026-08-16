import {
  ANSWER_VALIDATION_VERDICTS,
  type AnswerValidationEvidence,
  type AnswerValidationVerdict,
  CLAUDE_CLI_PROVIDER_ID,
} from "@mcp-token-footprint/shared";
import { isModelPriced } from "../providers/pricing.js";
import { toErrorMessage } from "../utils/errors.js";
import {
  answerStepIndices,
  type BaseRatingJudgeDeps,
  callWithTimeout,
  clipAnswer,
  type ConversationTurn,
  conversationTurns,
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
 * answer_validation (Auto-Rating WP 1.4, AR1) — grader `answer_validation`, kind `llm`,
 * MANDATORY (`mandatory: true`). Does the run's FINAL assistant answer address the test's INITIAL
 * prompt? ONE bounded provider call reads the test's `userPrompt` (the question) + the run's
 * `finalAssistantText` (the produced answer) and returns a verdict
 * (`answered | partial | unanswered`), a 0–1 score, and evidence — verbatim `quotes` from the answer
 * plus deep-linkable `citedSteps` (the `run_steps.idx` of the `llm_response` steps that produced the
 * rated answer). This grades ANSWERED-NESS only — whether the question was addressed — NOT factual
 * correctness against a ground truth (the outcome judge does that).
 *
 * HARD invariants (AR11/B15, mirrored from the outcome/trajectory judges):
 *   - NEVER executes anything (no MCP call, no code/skill run); reads ONLY the persisted run + the
 *     test's authored prompt, and makes exactly ONE provider call.
 *   - NEVER throws/blocks/mutates a run — every failure path returns an honest `error`/`unevaluable`.
 *   - `score` is `null` (NOT 0) when unevaluable: NO final answer (`finalAssistantText` empty) →
 *     verdict `unanswered`, `score: null`, status `unevaluable`, and NO judge call (nothing to grade).
 *     Unconfigured OR unpriced judge → `unevaluable`, NO call (no spend). Unparseable/failed call →
 *     `error`.
 *   - Judge cost lands ONLY in the `judge_*` ledger (B5/AR13), NEVER in `runs.cost_usd`.
 *   - Version-stamped `method` (`answer_validation_v1`, AR15).
 *
 * Built via a factory ({@link BaseRatingJudgeDeps}) so it is offline-testable — `generate` +
 * `resolveJudge` are injected; production reuses WP 1.3's global judge. NOT wired into the grader
 * roster here (the orchestrator injects it with the provider judge after merge).
 */

export const ANSWER_VALIDATION_ID = "answer_validation";

/** Version-stamped method for a real graded verdict (AR15). */
const METHOD_GRADED = "answer_validation_v1";
const METHOD_NO_ANSWER = "answer_validation_no_answer";
const METHOD_UNCONFIGURED = "judge_unconfigured";
const METHOD_UNPRICED = "judge_unpriced";
const METHOD_ERROR = "judge_error";

/** Frames the judge as grading whether the question was answered — not external factual correctness. */
export const ANSWER_VALIDATION_SYSTEM =
  "You are a meticulous evaluator judging whether an AI assistant's FINAL answer actually addresses " +
  "the user's ORIGINAL question. You judge ONLY whether the question was answered — the directness, " +
  "completeness, and relevance of the answer to what was asked — NOT whether the answer is factually " +
  "correct against any external ground truth (a separate grader handles correctness). You respond " +
  "with ONLY the requested JSON.";

/** Build the answer-validation prompt (the question + the produced answer + the JSON response contract). */
export function buildAnswerValidationPrompt(input: {
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

Decide how well the assistant's FINAL answer addresses the user's question above. Judge ONLY whether the question was answered — is the thing that was asked for actually present, directly and completely? Do NOT reward length, restating the question, or unrelated extra material, and do NOT judge factual correctness against outside knowledge.

Assign:
* "verdict":
  - "answered" — the answer directly and completely addresses everything the question asked.
  - "partial" — the answer addresses some of the question but leaves a material part unanswered, hedges without committing, or only partially responds.
  - "unanswered" — the answer does not address the question at all (off-topic, a refusal/failure, or merely restating the question with no actual answer).
* "rating": a single INTEGER 0–10 for how fully the question is answered — 10 = fully and directly answered, 0 = not addressed at all. Keep it consistent with the verdict (answered ≈ 8–10, partial ≈ 4–7, unanswered ≈ 0–3).
* "quotes": an array of SHORT, VERBATIM excerpts copied exactly from the assistant's answer that justify your verdict (the spans that answer — or fail to answer — the question). Use [] when there is nothing to quote.
* "reason": one or two sentences justifying the verdict and rating.

Respond with ONLY raw JSON (no markdown code fences), exactly:
{"verdict": "answered|partial|unanswered", "rating": <integer 0-10>, "quotes": ["<verbatim excerpt>", ...], "reason": "<one or two sentences>"}`;
}

/**
 * Build the answer-validation prompt for a MULTI-TURN / interactive session: the full conversation
 * transcript (each user turn + the assistant's answer to it) + the same verdict contract, but judging
 * whether the assistant addressed the user's questions across the WHOLE conversation — not the opener
 * prompt against every answer glued together. Clips the transcript (disclosed) so a long session is bounded.
 */
export function buildAnswerValidationConversationPrompt(turns: ConversationTurn[]): {
  prompt: string;
  truncated: boolean;
  clippedChars: number;
} {
  const transcript = turns
    .map(
      (turn, index) =>
        `### Turn ${index + 1}\nThe user asked:\n${turn.question || "(no question captured)"}\n\nThe assistant answered:\n${turn.answer || "(the assistant produced no answer for this turn)"}`,
    )
    .join("\n\n");
  const clip = clipAnswer(transcript);
  const clipNote = clip.truncated
    ? "\n(Note: the conversation above was clipped to fit; judge only the portion shown.)"
    : "";
  const prompt = `## The conversation (the user's questions and the assistant's answers, in order)
${clip.text}${clipNote}

---

Decide how well the assistant's answers address the user's questions across this WHOLE conversation. Judge ONLY whether each thing the user asked was actually answered — directly and completely — NOT factual correctness against outside knowledge. Do NOT reward length, restating the question, or unrelated extra material.

Assign:
* "verdict":
  - "answered" — the assistant addressed EVERY question in the conversation directly and completely.
  - "partial" — the assistant addressed some turns but left a material part unanswered, hedged without committing, or only partially responded.
  - "unanswered" — the assistant essentially did not address the user's questions (off-topic, refusals/failures, or no real answers).
* "rating": a single INTEGER 0–10 for how fully the conversation's questions were answered OVERALL — 10 = every question fully and directly answered, 0 = none addressed. Keep it consistent with the verdict (answered ≈ 8–10, partial ≈ 4–7, unanswered ≈ 0–3).
* "quotes": an array of SHORT, VERBATIM excerpts copied exactly from the assistant's answers that justify your verdict. Use [] when there is nothing to quote.
* "reason": one or two sentences justifying the verdict and rating.

Respond with ONLY raw JSON (no markdown code fences), exactly:
{"verdict": "answered|partial|unanswered", "rating": <integer 0-10>, "quotes": ["<verbatim excerpt>", ...], "reason": "<one or two sentences>"}`;
  return { prompt, truncated: clip.truncated, clippedChars: clip.text.length };
}

/** Fallback verdict from the 0–10 rating when the judge omits/garbles the `verdict` string. */
function verdictFromRating(rating: number): AnswerValidationVerdict {
  if (rating >= 8) return "answered";
  if (rating >= 4) return "partial";
  return "unanswered";
}

/**
 * Build the `answer_validation` grader from its deps. Returned grader is `async` + self-contained:
 * short-circuits (free, no call) when there is no final answer / no judge / an unpriced judge, else
 * makes ONE bounded provider call, parses the verdict + rating, and reports the 0–1 score + typed
 * evidence + the SEPARATE judge cost ledger. NEVER throws.
 */
export function createAnswerValidationGrader(deps: BaseRatingJudgeDeps): Grader {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JUDGE_QUEUE_BACKSTOP_MS;

  return {
    id: ANSWER_VALIDATION_ID,
    kind: "llm",
    mandatory: true,
    async grade(ctx: GradeContext): Promise<GraderResult> {
      const answer = ctx.finalAssistantText.trim();
      // No final answer → nothing to validate: verdict `unanswered`, score NULL (not 0), no judge call.
      if (!answer) {
        const evidence: AnswerValidationEvidence = {
          verdict: "unanswered",
          score: null,
          quotes: [],
          citedSteps: [],
        };
        return {
          status: "unevaluable",
          score: null,
          method: METHOD_NO_ANSWER,
          reasoning: "the run produced no final assistant answer to validate",
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
      // Unpriced judge model → refuse the call (mandatory graders auto-run, so the route guard can't
      // protect this path): unevaluable, NO spend. Mirrors failure-buckets.ts's pricing refusal. The
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

      // Session-aware (interactive/multi-turn): validate the WHOLE conversation — each user turn + its
      // answer — not just the test's opener prompt against every answer glued together. A single-prompt
      // run (one user turn) keeps the exact original prompt (opener question + the produced answer).
      const turns = conversationTurns(ctx.run);
      let prompt: string;
      let truncated: boolean;
      let clippedChars: number;
      if (turns.length > 1) {
        const built = buildAnswerValidationConversationPrompt(turns);
        prompt = built.prompt;
        truncated = built.truncated;
        clippedChars = built.clippedChars;
      } else {
        const clip = clipAnswer(answer);
        prompt = buildAnswerValidationPrompt({
          question: ctx.test.userPrompt,
          answer: clip.text,
          truncated: clip.truncated,
        });
        truncated = clip.truncated;
        clippedChars = clip.text.length;
      }

      // ONE provider call, bounded so a stuck provider settles into an `error` grade (never a hang).
      let gen: JudgeGenerateResult;
      try {
        gen = await callWithTimeout(
          (signal) => deps.generate(settings, prompt, { system: ANSWER_VALIDATION_SYSTEM, signal }),
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
        ANSWER_VALIDATION_VERDICTS,
        verdictFromRating(parsed.rating),
      );
      const score = normalizeRating(parsed.rating);
      // citedSteps computed by the app (the llm_response step idxs that produced the rated answer).
      const evidence: AnswerValidationEvidence = {
        verdict,
        score,
        quotes: parsed.quotes,
        citedSteps: answerStepIndices(ctx.run),
      };
      const baseReason = parsed.reason || gen.text.trim();
      const reasoning = truncated
        ? `${baseReason}\n\n(note: the answer/conversation was clipped to ${clippedChars} chars before rating — the rating covers only the shown portion)`
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
