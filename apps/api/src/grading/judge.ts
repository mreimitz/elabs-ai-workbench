import type { JudgeMethod, JudgeSettings } from "@mcp-token-footprint/shared";
import { generateText } from "ai";
import { estimateCost } from "../providers/pricing.js";
import type { ProviderService } from "../providers/service.js";
import { toErrorMessage } from "../utils/errors.js";
import { stableStringify } from "../utils/json.js";
import type { GradeContext, Grader, GraderResult } from "./grader.js";

/**
 * The G-Eval outcome judge (B3) — grader `outcome_judge`, kind `llm`. Scores a run's FINAL answer
 * against the test's authored ground truth (`expectedInsight` + `expectedValue`) via ONE provider
 * call, on a 1–10 rubric, using the logprob-weighted expected-rating math ported FAITHFULLY from the
 * InsightBench prototype (`eval_utils.compute_insight_eval`). Adapted from the prototype's
 * Vertex/Gemini specifics to our provider layer — same rubric, same `<rating>N</rating>` protocol,
 * same expected-rating-over-top-k-logprobs weighting.
 *
 * HARD invariants (roadmap/benchmarks/conventions.md + the WP 1.3 spec):
 *   - The judge NEVER executes anything — no MCP call, no code/skill run. It READS the persisted run +
 *     the test's authored expectations (documents) and makes exactly ONE provider call.
 *   - Grading NEVER blocks/mutates a run. A stuck or failed judge yields a `run_grades` row with
 *     status `error` (a bounded timeout guards a hung provider) — it NEVER hangs and NEVER throws into
 *     the caller.
 *   - Judge cost lands ONLY in the `judge_*` ledger of the grade row (B5), NEVER in `runs.cost_usd`
 *     (this module just reports usage/cost on the {@link GraderResult}; the run cost is untouched).
 *   - An unconfigured judge → `unevaluable` (score null, never error, never 0). A test with no ground
 *     truth for the judge → `unevaluable`.
 *
 * The grader is built via a factory so it is offline-testable: {@link OutcomeJudgeDeps.generate} and
 * {@link OutcomeJudgeDeps.resolveJudge} are injected. The production `generate`
 * ({@link createProviderJudgeGenerate}) builds the model through the {@link ProviderService} and calls
 * the AI SDK `generateText` at temperature 0; tests inject a stub (no network).
 */

export const OUTCOME_JUDGE_ID = "outcome_judge";

/** How many top-logprob candidates to request per token (OpenAI supports up to 20; 5 mirrors the prototype). */
export const JUDGE_TOP_LOGPROBS = 5;

/** Default bound (ms) on a single judge call — a stuck provider settles into an `error` grade, never a hang. */
export const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;

/**
 * Default bound (ms) on one grader-level judge INVOCATION — the outer never-hang backstop each grader
 * races its `generate(...)` against. This deliberately differs from {@link DEFAULT_JUDGE_TIMEOUT_MS}:
 * in production `generate` is the CLI-first chain (Auto-Rating WP 2.3) whose CLI leg WAITS in the AR14
 * concurrency semaphore (default 1) before its own post-acquire timeout starts. Under suite load
 * (members × 5 LLM graders + the per-test-group agreement calls all funnelling through one CLI child)
 * that queue wait alone can exceed a minute — with the old 60s outer bound, queued calls timed out
 * BEFORE ever reaching the judge ("judge call timed out after 60000ms" on otherwise-healthy runs).
 * The tight per-call bounds now live INSIDE the legs, where the clock starts when the call actually
 * begins (the CLI one-shot's post-acquire timeout, and {@link createProviderJudgeGenerate}'s own
 * per-call race); this outer value only guards against a genuinely wedged queue — generous by design.
 */
export const DEFAULT_JUDGE_QUEUE_BACKSTOP_MS = 15 * 60_000;

/** Cap the judge's own output so a runaway generation can't inflate the separate judge cost ledger. */
const JUDGE_MAX_OUTPUT_TOKENS = 400;

// ── G-Eval prompt (ported + adapted from eval_utils.G_EVAL_BASIC_*) ───────────────────────────────

/**
 * Ported from `eval_utils.G_EVAL_BASIC_SYSTEM_MESSAGE`. Frames the judge as a grader scoring a
 * produced answer against a ground-truth answer on a numeric scale.
 */
export const G_EVAL_JUDGE_SYSTEM =
  "You are a meticulous grader evaluating an AI assistant's answer to a user's question. " +
  "You grade how well the assistant's answer matches the expected (ground-truth) answer and assign a " +
  "single integer rating from 1 to 10, where 10 means the assistant's answer conveys the same " +
  "insight and value as the ground truth and 1 means it does not correspond at all.";

/**
 * Build the G-Eval prompt. Ported from `eval_utils.G_EVAL_BASIC_TEMPLATE`; adapted to carry the
 * original question (the prototype scored answer-vs-gt only, we add the question for grounding), the
 * expected answer (insight + value), the produced answer, and an OPTIONAL per-test rubric override.
 * The `<rating></rating>` tag protocol is preserved verbatim so the logprob token alignment works; a
 * one-sentence justification is requested AFTER the tag so the rating token stays clean and early.
 */
export function buildJudgePrompt(input: {
  question: string;
  expected: string;
  predicted: string;
  rubricOverride?: string;
}): string {
  const rubric = input.rubricOverride?.trim()
    ? `\n### Additional grading rubric:\n${input.rubricOverride.trim()}\n`
    : "";
  return `Below is a question, the ground-truth (expected) answer, and an answer produced by an AI assistant. Judge how well the produced answer matches the ground-truth answer.

### Question:
${input.question}

### Ground Truth Answer:
${input.expected}

### Provided Answer:
${input.predicted || "(the assistant produced no answer)"}
${rubric}
Follow these instructions when writing your response:
* On a scale of 1-10, provide a single INTEGER rating for how close the provided answer is to the ground truth answer, with 10 denoting that the provided answer conveys the same insight/value as the ground truth and 1 denoting no correspondence at all.
* Wrap your numerical rating inside <rating></rating> tags. Example: <rating>7</rating>
* Put the rating tag FIRST, then add ONE short sentence justifying it.
* Check very carefully before answering.

### Response:
`;
}

// ── The generate seam (injectable; production impl calls the provider) ────────────────────────────

/** The judge's provider usage — the two counters that feed the SEPARATE judge cost ledger (B5). */
export type JudgeUsage = { inputTokens: number; outputTokens: number };

/** One top-logprob candidate at the rating-token position (`{ token, logprob }`), used for weighting. */
export type RatingLogprob = { token: string; logprob: number };

/**
 * The judge-provenance overrides the resolution chain (Auto-Rating WP 2.3) stamps onto a
 * {@link JudgeGenerateResult}: the ACTUAL source that produced the text. Every ledger site PREFERS
 * these over the resolver's {@link JudgeSettings} (`result.judgeProviderId ?? settings.providerCredentialId`,
 * etc.) so a CLI→provider fall-through row reads the provider it really used, and a CLI row reads
 * `claude_cli` + cost 0 (AR13). All OPTIONAL + API-internal — a plain provider `generate` omits them
 * (the ledger falls back to `settings`); a chain `generate` always sets them.
 */
export type JudgeProvenance = {
  judgeProviderId?: string | null;
  judgeModel?: string | null;
  judgeCostUsd?: number;
};

/**
 * The result of one judge call: the model's text (carrying the `<rating>` tag + justification), the
 * usage (for the cost ledger), and — when the provider returned them — the top-k logprob candidates at
 * the rating-token position. Absence of `ratingLogprobs` is NORMAL (most providers/models don't return
 * logprobs) and simply routes to the single-sample method. The optional {@link JudgeProvenance} fields
 * carry the resolution chain's actual-source override (WP 2.3).
 */
export type JudgeGenerateResult = {
  text: string;
  usage: JudgeUsage;
  ratingLogprobs?: RatingLogprob[];
} & JudgeProvenance;

/** The one provider round-trip. Injected so the grader is offline-testable (tests pass a stub). */
export type JudgeGenerate = (
  settings: JudgeSettings,
  prompt: string,
  opts: { system: string; signal: AbortSignal },
) => Promise<JudgeGenerateResult>;

/** Dependencies for {@link createOutcomeJudge}. `resolveJudge` reads the persisted default judge (KV). */
export type OutcomeJudgeDeps = {
  /** The currently-configured default judge, or `null` when unconfigured (→ `unevaluable`). */
  resolveJudge: () => JudgeSettings | null;
  /** The one provider call (production: {@link createProviderJudgeGenerate}; tests: a stub). */
  generate: JudgeGenerate;
  /** Outer bound on one judge invocation (incl. queue wait); defaults to {@link DEFAULT_JUDGE_QUEUE_BACKSTOP_MS}. */
  timeoutMs?: number;
};

// ── Rating parse + logprob weighting (ported from eval_utils) ─────────────────────────────────────

/**
 * Parse the judge's rating. Ported from `eval_utils._parse_raw_score`, but returns `null` (not `0.0`)
 * on total failure — an unparseable judge response is an `error`, NEVER a silent 0. Primary: the digits
 * inside `<rating>…</rating>`; fallback: the FIRST number anywhere in the text (handles a dropped tag,
 * e.g. "Rating: 8"). `ratingStr` is the raw matched digit string (drives multi-digit weighting).
 */
export function parseRating(text: string): { rating: number; ratingStr: string } | null {
  if (!text) return null;
  const tagged = text.match(/<rating>\s*(\d+(?:\.\d+)?)\s*<\/rating>/i);
  if (tagged?.[1]) return { rating: Number.parseFloat(tagged[1]), ratingStr: tagged[1] };
  const firstNumber = text.match(/\d+(?:\.\d+)?/);
  if (firstNumber?.[0])
    return { rating: Number.parseFloat(firstNumber[0]), ratingStr: firstNumber[0] };
  return null;
}

/**
 * The logprob-weighted expected rating over the top-k candidates at the rating-token position. Ported
 * FAITHFULLY from `eval_utils.compute_insight_eval` step 4:
 *   - keep only candidates whose (trimmed) token is a run of digits;
 *   - multi-digit handling — if the actual rating is multi-digit (e.g. "10") and this candidate is its
 *     LEADING digit (e.g. "1"), assign the full numeric value (10), not the digit (1);
 *   - convert each kept logprob to a probability (`exp`), RENORMALIZE across the numeric candidates,
 *     and return the dot product Σ rating·prob (the expected rating).
 * Returns `null` when no numeric candidate is present (the caller falls back to the single parsed rating).
 */
export function weightedExpectedRating(
  candidates: RatingLogprob[],
  targetRatingStr: string,
): number | null {
  // Keep (rating, unnormalized-prob) TOGETHER so there is no parallel-array indexing to reason about.
  const numeric: Array<{ rating: number; prob: number }> = [];
  for (const cand of candidates) {
    const token = cand.token.trim();
    if (!/^\d+$/.test(token)) continue; // non-numeric candidate (e.g. " the") is dropped
    // Leading digit of a multi-digit rating ("1" of "10") → the full value; otherwise the digit itself.
    const rating =
      targetRatingStr.length > 1 && token === targetRatingStr[0]
        ? Number.parseFloat(targetRatingStr)
        : Number.parseFloat(token);
    numeric.push({ rating, prob: Math.exp(cand.logprob) });
  }
  if (numeric.length === 0) return null;
  const sum = numeric.reduce((acc, c) => acc + c.prob, 0);
  if (!(sum > 0)) return null;
  // Renormalize the probabilities across the numeric candidates and take the expected rating.
  return numeric.reduce((acc, c) => acc + c.rating * (c.prob / sum), 0);
}

/**
 * Normalize a 1–10 rating to a 0–1 score. Mirrors the prototype's `raw / 10.0` (see
 * `compare_insights.evaluate_question`) but does NOT round — the exact value is kept so the raw ⇄
 * normalized relationship is lossless (the prototype's 4-dp rounding was JSON-tidiness only). Clamped
 * to [0,1] to defend against an out-of-range rating.
 */
export function normalizeRating(rawRating: number): number {
  return Math.min(1, Math.max(0, rawRating / 10));
}

// ── The grader ────────────────────────────────────────────────────────────────────────────────────

const METHOD_UNCONFIGURED = "judge_unconfigured";
const METHOD_NO_GROUND_TRUTH = "judge_no_ground_truth";
const METHOD_ERROR = "judge_error";

/**
 * Build the `outcome_judge` grader from its deps. The returned grader is `async` and self-contained:
 * it resolves the judge, short-circuits to `unevaluable` when unconfigured or when the test has no
 * ground truth, otherwise builds the G-Eval prompt, makes ONE (timeout-bounded) provider call, parses
 * the rating, applies logprob weighting when available, and reports the score + the SEPARATE judge cost
 * ledger. It NEVER throws — every failure path returns an honest `error`/`unevaluable` verdict.
 */
export function createOutcomeJudge(deps: OutcomeJudgeDeps): Grader {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JUDGE_QUEUE_BACKSTOP_MS;

  return {
    id: OUTCOME_JUDGE_ID,
    kind: "llm",
    async grade(ctx: GradeContext): Promise<GraderResult> {
      const settings = deps.resolveJudge();
      // Unconfigured judge → unevaluable (NOT error, NOT 0). The default judge is optional.
      if (!settings || !settings.providerCredentialId || !settings.model) {
        return {
          status: "unevaluable",
          score: null,
          method: METHOD_UNCONFIGURED,
          reasoning: "no default judge is configured (set one in grading settings)",
        };
      }

      const exp = ctx.test.expectations;
      const insight = typeof exp?.expectedInsight === "string" ? exp.expectedInsight.trim() : "";
      const hasInsight = insight.length > 0;
      const hasValue = exp?.expectedValue !== undefined;
      // No authored ground truth for the judge to score against → unevaluable (never 0).
      if (!hasInsight && !hasValue) {
        return {
          status: "unevaluable",
          score: null,
          method: METHOD_NO_GROUND_TRUTH,
          reasoning:
            "test declares no expectedInsight or expectedValue for the judge to score against",
        };
      }

      const expectedParts: string[] = [];
      if (hasInsight) expectedParts.push(insight);
      if (hasValue) expectedParts.push(stableStringify(exp?.expectedValue));
      const prompt = buildJudgePrompt({
        question: ctx.test.userPrompt,
        expected: expectedParts.join("\n"),
        predicted: ctx.finalAssistantText,
        ...(exp?.rubricOverride ? { rubricOverride: exp.rubricOverride } : {}),
      });

      // ONE provider call, bounded by a timeout so a stuck provider settles into an `error` grade.
      let gen: JudgeGenerateResult;
      try {
        gen = await callWithTimeout(
          (signal) => deps.generate(settings, prompt, { system: G_EVAL_JUDGE_SYSTEM, signal }),
          timeoutMs,
        );
      } catch (error) {
        // A thrown/timed-out call has no usage → the judge ledger stays 0 on this error row.
        return errorResult(settings, toErrorMessage(error));
      }

      const parsed = parseRating(gen.text);
      if (!parsed) {
        // Unparseable rating: the call still spent tokens, so the cost is recorded honestly on the error row.
        return errorResult(
          settings,
          `judge produced no parseable rating: ${truncate(gen.text)}`,
          gen.usage,
          gen,
        );
      }

      // Logprob-weighted expected rating when the provider returned candidates; else the single sample.
      let rawRating = parsed.rating;
      let method: JudgeMethod = "single_sample";
      if (gen.ratingLogprobs && gen.ratingLogprobs.length > 0) {
        const weighted = weightedExpectedRating(gen.ratingLogprobs, parsed.ratingStr);
        if (weighted !== null) {
          rawRating = weighted;
          method = "logprob_weighted";
        }
      }

      return {
        status: "graded",
        score: normalizeRating(rawRating),
        rawScore: rawRating,
        method,
        // The model's written justification (the full response, carrying the rating tag + rationale).
        reasoning: gen.text.trim(),
        ...judgeLedger(settings, gen.usage, gen),
      };
    },
  };
}

/** An `error` verdict that still stamps the judge provider/model (and cost, when a call actually ran). */
function errorResult(
  settings: JudgeSettings,
  reason: string,
  usage?: JudgeUsage,
  provenance?: JudgeProvenance,
): GraderResult {
  return {
    status: "error",
    score: null,
    method: METHOD_ERROR,
    reasoning: reason,
    ...(usage
      ? judgeLedger(settings, usage, provenance)
      : {
          judgeProviderId: provenance?.judgeProviderId ?? settings.providerCredentialId,
          judgeModel: provenance?.judgeModel ?? settings.model,
        }),
  };
}

/**
 * The SEPARATE judge cost ledger (B5) carried on the {@link GraderResult}: provider + model refs, token
 * counts, and the estimated USD cost. `estimateCost` returns 0 for an unpriced model (best-effort);
 * `settings.model` is non-null here (guarded by the caller). This NEVER touches `runs.cost_usd`. The
 * optional {@link JudgeProvenance} (Auto-Rating WP 2.3) is PREFERRED over `settings` so a chain
 * fall-through / CLI row reports the ACTUAL source it used (CLI → cost 0, real tokens).
 */
function judgeLedger(settings: JudgeSettings, usage: JudgeUsage, provenance?: JudgeProvenance) {
  const model = provenance?.judgeModel ?? settings.model;
  return {
    judgeProviderId: provenance?.judgeProviderId ?? settings.providerCredentialId,
    judgeModel: model,
    judgeTokensIn: usage.inputTokens,
    judgeTokensOut: usage.outputTokens,
    judgeCostUsd:
      provenance?.judgeCostUsd ??
      (model
        ? estimateCost(model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        : 0),
  } as const;
}

/**
 * Race `run` (given a fresh abort signal) against a timeout. On timeout the signal is aborted (so a
 * signal-aware provider call is cut off) AND the race rejects, so `grade()` ALWAYS settles even if the
 * underlying provider call ignores the abort — the guarantee "never a hang". The timer is always cleared.
 */
async function callWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`judge call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Truncate a possibly-long judge response for an error message (bounded reasoning payload). */
function truncate(text: string, max = 200): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

// ── Production `generate` — the single provider round-trip ─────────────────────────────────────────

/**
 * The production {@link JudgeGenerate}: build the judge model through the {@link ProviderService}
 * (decrypts the credential behind the runtime boundary — never in the browser) and call the AI SDK
 * `generateText` at temperature 0. Requests top-logprobs where the provider supports it (OpenAI) and
 * reads them DEFENSIVELY from the result's provider metadata — absence is normal and simply yields the
 * single-sample path. This is the only place the judge touches the provider; it makes exactly ONE call.
 */
export function createProviderJudgeGenerate(
  providers: ProviderService,
  perCallTimeoutMs: number = DEFAULT_JUDGE_TIMEOUT_MS,
): JudgeGenerate {
  return async (settings, prompt, opts) => {
    if (!settings.providerCredentialId || !settings.model) {
      throw new Error("judge is not fully configured (missing provider credential or model)");
    }
    const model = providers.modelFor(settings.providerCredentialId, settings.model);
    // The TIGHT per-call bound lives HERE (the clock starts when the provider call actually begins),
    // combined with the caller's signal — the grader-level race is only the generous queue backstop
    // (see DEFAULT_JUDGE_QUEUE_BACKSTOP_MS). A stuck provider is aborted and settles into an `error`
    // grade, never a hang.
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), perCallTimeoutMs);
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model,
        system: opts.system,
        prompt,
        temperature: 0,
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
        abortSignal: controller.signal,
        // OpenAI: request top-logprobs (ignored by providers that don't read this key).
        providerOptions: { openai: { logprobs: JUDGE_TOP_LOGPROBS } },
      });
    } catch (error) {
      // Name the timeout honestly (an abort we raised ourselves would otherwise surface as a generic
      // provider abort error) — but never mask a caller-driven abort.
      if (controller.signal.aborted && !opts.signal.aborted) {
        throw new Error(`provider judge call timed out after ${perCallTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onCallerAbort);
    }
    const usage: JudgeUsage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    };
    const ratingLogprobs = extractRatingLogprobs(result.text, result.providerMetadata);
    return { text: result.text, usage, ...(ratingLogprobs ? { ratingLogprobs } : {}) };
  };
}

/**
 * Best-effort extraction of the top-k logprob candidates at the rating-token position, DEFENSIVELY read
 * from provider metadata (currently the OpenAI shape: `providerMetadata.openai.logprobs` is an array of
 * per-output-token `{ token, logprob, top_logprobs: [{ token, logprob }] }`). Aligns the rating digit
 * to its output token by character offset (ported from `eval_utils.compute_insight_eval` step 3), then
 * returns that token's `top_logprobs`. Returns `undefined` on any absence/mismatch/parse issue — the
 * judge then uses the single parsed rating. NEVER throws.
 */
function extractRatingLogprobs(
  text: string,
  providerMetadata: unknown,
): RatingLogprob[] | undefined {
  try {
    const perToken = readOpenAiLogprobs(providerMetadata);
    if (!perToken) return undefined;
    const tag = text.match(/<rating>(\d+)<\/rating>/i);
    if (tag?.index === undefined || !tag[1]) return undefined;
    const targetCharIdx = tag.index + tag[0].indexOf(tag[1]); // char offset of the first rating digit

    let charCount = 0;
    for (const entry of perToken) {
      const tokenText = typeof entry.token === "string" ? entry.token : "";
      if (charCount <= targetCharIdx && targetCharIdx < charCount + tokenText.length) {
        const top = entry.top_logprobs;
        if (!Array.isArray(top)) return undefined;
        const candidates = top
          .filter(
            (c): c is RatingLogprob =>
              typeof c?.token === "string" && typeof c?.logprob === "number",
          )
          .map((c) => ({ token: c.token, logprob: c.logprob }));
        return candidates.length > 0 ? candidates : undefined;
      }
      charCount += tokenText.length;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

type OpenAiTokenLogprob = { token?: unknown; logprob?: unknown; top_logprobs?: unknown };

/** Defensively read OpenAI's per-token logprob array from provider metadata; `undefined` when absent. */
function readOpenAiLogprobs(providerMetadata: unknown): OpenAiTokenLogprob[] | undefined {
  if (typeof providerMetadata !== "object" || providerMetadata === null) return undefined;
  const openai = (providerMetadata as Record<string, unknown>).openai;
  if (typeof openai !== "object" || openai === null) return undefined;
  const logprobs = (openai as Record<string, unknown>).logprobs;
  if (!Array.isArray(logprobs) || logprobs.length === 0) return undefined;
  return logprobs as OpenAiTokenLogprob[];
}
