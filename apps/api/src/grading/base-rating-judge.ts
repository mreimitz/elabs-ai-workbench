import type { JudgeSettings, RunDetail, RunStep } from "@mcp-token-footprint/shared";
import { estimateCost } from "../providers/pricing.js";
import type { GraderResult } from "./grader.js";
import type { JudgeGenerate, JudgeProvenance, JudgeUsage } from "./judge.js";

/**
 * Shared plumbing for the two LLM base-rating graders (Auto-Rating WP 1.4) — `answer_validation`
 * ({@link import("./answer-validation.js")}) and `insight_surplus`
 * ({@link import("./insight-surplus.js")}). Both are MANDATORY (`mandatory: true`) `llm` graders that
 * run on EVERY terminal run (AR5): each judges the run's FINAL answer against the test's ORIGINAL
 * prompt via ONE bounded provider call, returns a verdict + a 0–1 score + evidence (`quotes` +
 * deep-linkable `citedSteps`), and reports the SEPARATE judge cost ledger (B5, AR13).
 *
 * This module keeps the shared, non-rubric machinery in one place so each grader file is just its
 * (careful) rubric + verdict mapping: the injected-deps shape (mirrors {@link
 * import("./judge.js").OutcomeJudgeDeps}), answer clipping + truncation disclosure, the deep-link
 * `citedSteps` computation, the tolerant verdict/rating JSON parse, the verdict-enum coercion, and the
 * cost-ledger / never-hang helpers (mirrored from `judge.ts`/`trajectory-judge.ts`, which are read-only
 * on this WP's file surface).
 *
 * HARD invariants (AR11/B15, mirrored from the outcome/trajectory judges): a grader NEVER executes
 * anything (no MCP call, no code/skill run) and NEVER throws into the caller — every failure path
 * settles into an honest `error`/`unevaluable` verdict, never a silent or forced 0. Judge cost lands
 * ONLY in the `judge_*` ledger, NEVER in `runs.cost_usd`.
 */

/**
 * Dependencies for a base-rating LLM grader — the SAME shape as {@link
 * import("./judge.js").OutcomeJudgeDeps}. Production reuses WP 1.3's global judge
 * (`createProviderJudgeGenerate(providers)` + `judgeResolver(appSettings)` — the SAME default judge);
 * tests inject a stub `generate` + a fixed `resolveJudge` (no network).
 */
export type BaseRatingJudgeDeps = {
  /** The currently-configured default judge, or `null` when unconfigured (→ `unevaluable`). */
  resolveJudge: () => JudgeSettings | null;
  /** The one provider call (production: `createProviderJudgeGenerate`; tests: a stub). */
  generate: JudgeGenerate;
  /** Bound on a single judge call; defaults to {@link import("./judge.js").DEFAULT_JUDGE_TIMEOUT_MS}. */
  timeoutMs?: number;
};

/**
 * Max characters of the produced answer handed to the judge. Answers are prose (not 200-step traces),
 * so the cap is generous; a longer answer is CLIPPED and the clip is disclosed (`truncated`) so a
 * clipped rating is visible (AR risk: stamp truncation so a clipped rating is not silently trusted).
 */
export const MAX_ANSWER_CHARS = 24_000;

/** Clip a long answer to `cap`, returning the clipped text + whether a clip happened (for disclosure). */
export function clipAnswer(
  answer: string,
  cap: number = MAX_ANSWER_CHARS,
): { text: string; truncated: boolean } {
  if (answer.length <= cap) return { text: answer, truncated: false };
  return {
    text: `${answer.slice(0, cap)}… (+${answer.length - cap} chars omitted)`,
    truncated: true,
  };
}

/**
 * The `run_steps.idx` values of the `llm_response` steps whose `assistantText` contributed the final
 * answer — the deep-linkable `citedSteps` evidence (the SAME step-citation mechanic as the trajectory
 * judge's evidence and `AssertionResult.evidence`). Computed by the APP (the judge cannot know step
 * indices), so `citedSteps` ALWAYS resolve to real run steps. Mirrors the {@link
 * import("./grader.js").finalAssistantText} step filter so the cited steps are exactly the ones whose
 * text was rated. Empty when the run produced no assistant prose.
 */
export function answerStepIndices(run: RunDetail): number[] {
  return (run.steps ?? [])
    .filter((step) => step.type === "llm_response" && (step.assistantText ?? "").trim().length > 0)
    .map((step) => step.index);
}

// ── Conversation reconstruction (multi-turn / interactive session awareness) ─────────────────────────

/** One user turn + the assistant's answer to it. A conversation is an ordered list of these. */
export type ConversationTurn = { question: string; answer: string };

/**
 * Reconstruct the run's conversation as USER turns. Each `user_message` step opens a turn whose `answer`
 * is the `assistantText` of the `llm_response` steps that follow it (until the next `user_message`),
 * joined. A single-prompt run (a scripted qlik answer or an agent loop) yields ONE turn; an INTERACTIVE
 * session yields one turn per user message. This is what makes session validation "see the conversation"
 * rather than comparing only the test's opener prompt against every answer glued together.
 *
 * Empty questions/answers are preserved as `""` so a session stopped mid-turn is still represented (the
 * caller decides how to grade a turn with no answer). Read-only; never executes anything.
 */
export function conversationTurns(run: RunDetail): ConversationTurn[] {
  const turns: { question: string; answers: string[] }[] = [];
  let current: { question: string; answers: string[] } | undefined;
  for (const step of run.steps ?? []) {
    if (step.type === "user_message") {
      if (current) turns.push(current);
      current = { question: userMessageText(step), answers: [] };
    } else if (step.type === "llm_response" && current) {
      const answer = (step.assistantText ?? "").trim();
      if (answer) current.answers.push(answer);
    }
  }
  if (current) turns.push(current);
  return turns.map((turn) => ({ question: turn.question.trim(), answer: turn.answers.join("\n").trim() }));
}

/** The prompt text a `user_message` step carries (its `payload.text`), or `""` when absent. */
function userMessageText(step: RunStep): string {
  const payload = step.payload;
  if (payload && typeof payload === "object" && "text" in payload) {
    const text = (payload as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

// ── Verdict/rating JSON parse (fence/truncation-tolerant; mirrors trajectory-judge's parser) ─────────

/**
 * The judge's parsed verdict signal: the raw `verdict` string (lower-cased, validated against an enum by
 * the caller via {@link verdictFor}), a 0–10 `rating` (the numeric score before normalization), the
 * verbatim `quotes`, and a free-text `reason`.
 */
export type VerdictRatingParse = {
  verdict: string | null;
  rating: number;
  quotes: string[];
  reason: string;
};

/**
 * Parse the judge response into a {@link VerdictRatingParse}, tolerant of code fences / preamble. Chain:
 *   1. Structured JSON — strip a fence, take the first `{`…last `}`, read `verdict` + `rating` (accepting
 *      a bare `score`) + `quotes` + `reason`.
 *   2. Truncation-tolerant field regex — a JSON cut off mid-string still yields the bare rating integer
 *      and the `verdict` string (quotes/reason default empty).
 *   3. First bare number anywhere — a dropped/renamed rating key.
 * Returns `null` (NOT 0) on total failure — an unparseable response is an `error`, never a silent 0. The
 * rating is clamped to [0, 10]. `verdict` is left as-is (never invented) for the caller to enum-check.
 */
export function parseVerdictRating(text: string): VerdictRatingParse | null {
  if (!text) return null;
  const cleaned = stripFences(text);

  const obj = firstJsonObject(cleaned);
  if (obj) {
    const rating = coerceNumber(obj.rating ?? obj.score);
    if (rating !== null) {
      const verdict = asString(obj.verdict);
      return {
        verdict: verdict ? verdict.toLowerCase() : null,
        rating: clampRating(rating),
        quotes: asStringArray(obj.quotes),
        reason: asString(obj.reason ?? obj.justification),
      };
    }
  }

  // Truncation-tolerant: the bare rating field + verdict field from a JSON that never closed.
  const fieldVerdict = matchStringField(cleaned, "verdict");
  const fieldRating = matchNumberField(cleaned, "rating") ?? matchNumberField(cleaned, "score");
  if (fieldRating !== null) {
    return {
      verdict: fieldVerdict ? fieldVerdict.toLowerCase() : null,
      rating: clampRating(fieldRating),
      quotes: [],
      reason: "",
    };
  }

  // First bare number anywhere (a dropped/renamed key). Never a silent 0 when there is no number at all.
  const firstNumber = cleaned.match(/\d+(?:\.\d+)?/);
  if (firstNumber?.[0]) {
    return {
      verdict: fieldVerdict ? fieldVerdict.toLowerCase() : null,
      rating: clampRating(Number.parseFloat(firstNumber[0])),
      quotes: [],
      reason: "",
    };
  }
  return null;
}

/** Coerce a raw verdict string to a value of the grader's enum; falls back to a rating-band default. */
export function verdictFor<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```\s*$/, "")
    .trim();
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function matchNumberField(text: string, field: string): number | null {
  const m = text.match(new RegExp(`"${field}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`, "i"));
  return m?.[1] ? Number.parseFloat(m[1]) : null;
}

function matchStringField(text: string, field: string): string | null {
  const m = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s"));
  return m?.[1] ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim() : null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Keep only the non-empty string members of a possibly-mixed array; `[]` when absent/not an array. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function clampRating(n: number): number {
  return Math.min(10, Math.max(0, n));
}

// ── Result + control-flow helpers (mirror the private helpers in judge.ts / trajectory-judge.ts) ─────

/** An `unevaluable` verdict (score null, never 0) — an optional typed `evidence` carries the verdict. */
export function unevaluableResult(
  method: string,
  reason: string,
  evidence?: unknown,
): GraderResult {
  return {
    status: "unevaluable",
    score: null,
    method,
    reasoning: reason,
    ...(evidence !== undefined ? { evidence } : {}),
  };
}

/** An `error` verdict that still stamps the judge provider/model (and cost, when a call actually ran). */
export function judgeErrorResult(
  settings: JudgeSettings,
  method: string,
  reason: string,
  usage?: JudgeUsage,
  provenance?: JudgeProvenance,
): GraderResult {
  return {
    status: "error",
    score: null,
    method,
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
 * The SEPARATE judge cost ledger (B5/AR13) carried on the {@link GraderResult}: provider + model refs,
 * token counts, and the estimated USD cost. `estimateCost` returns 0 for an unpriced model (best-effort);
 * this NEVER touches `runs.cost_usd`. The optional {@link JudgeProvenance} (Auto-Rating WP 2.3) is
 * PREFERRED over `settings` so a chain fall-through / CLI row reports the ACTUAL source it used (CLI →
 * cost 0, real tokens).
 */
export function judgeLedger(
  settings: JudgeSettings,
  usage: JudgeUsage,
  provenance?: JudgeProvenance,
) {
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
 * Race `run` (given a fresh abort signal) against a timeout so `grade()` ALWAYS settles even if the
 * provider ignores the abort — the guarantee "never a hang". The timer is always cleared.
 */
export async function callWithTimeout<T>(
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
export function truncate(text: string, max = 200): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
