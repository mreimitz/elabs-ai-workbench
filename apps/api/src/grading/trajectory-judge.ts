import type { JudgeSettings, ReferenceLogic, RunStep } from "@mcp-token-footprint/shared";
import { estimateCost } from "../providers/pricing.js";
import { toErrorMessage } from "../utils/errors.js";
import { stableStringify } from "../utils/json.js";
import type { GradeContext, Grader, GraderResult } from "./grader.js";
import {
  DEFAULT_JUDGE_QUEUE_BACKSTOP_MS,
  type JudgeGenerate,
  type JudgeGenerateResult,
  type JudgeProvenance,
  type JudgeUsage,
  normalizeRating,
} from "./judge.js";

/**
 * trajectory_judge (B6.2, WP 2.2) — grader `trajectory_judge`, kind `llm`. Compares HOW a run actually
 * used its tools (the persisted `run_steps` tool-call chain) against the test's authored
 * `expectations.referenceLogic` (a DOCUMENT describing the correct calculation logic), via ONE provider
 * call on a 0–10 rubric ported FAITHFULLY from the InsightBench `compare_tools_vs_code` prototype
 * (dimensions / measures / aggregations / filters / groupings / sort; omissions; redundancy). Adapted
 * from the prototype's Vertex/Gemini + pandas-code specifics to our provider layer + MCP tool traces —
 * same rubric table, same JSON response contract, same fence/truncation-tolerant parsing.
 *
 * OPT-OUT (the reason `Grader.appliesTo` exists): {@link createTrajectoryJudge} sets `appliesTo` to
 * `ctx => !!ctx.test.expectations?.referenceLogic`. A test WITHOUT `referenceLogic` is skipped ENTIRELY
 * by {@link import("./grade-service.js").GradeService} — NO grade row (not even `unevaluable`) and, key
 * point, NO provider call (no wasted judge cost). `grade()` is therefore only ever reached with a
 * present `referenceLogic`.
 *
 * HARD invariants (roadmap/benchmarks/conventions.md + the WP 2.2 spec):
 *   - NEVER executes anything — no MCP call, no code/skill run. It READS the persisted run's steps + the
 *     test's authored `referenceLogic` (a document handed to the judge, NEVER run) and makes exactly ONE
 *     provider call. Tool arguments/results in the digest are OPAQUE data (redacted on persistence).
 *   - Grading NEVER blocks/mutates a run. A stuck or failed judge yields a `run_grades` row with status
 *     `error` (a bounded timeout guards a hung provider); it NEVER hangs and NEVER throws into the caller.
 *   - Judge cost lands ONLY in the `judge_*` ledger of the grade row (B5), NEVER in `runs.cost_usd`.
 *   - An unconfigured default judge (referenceLogic present but no judge set) → `unevaluable` (score
 *     null, never error, never 0). A provider failure → `error`.
 *
 * The grader is built via a factory so it is offline-testable: {@link TrajectoryJudgeDeps.generate} and
 * {@link TrajectoryJudgeDeps.resolveJudge} are injected. Production reuses WP 1.3's global judge
 * (`createProviderJudgeGenerate(providers)` + `judgeResolver(appSettings)` — the SAME default judge).
 */

export const TRAJECTORY_JUDGE_ID = "trajectory_judge";

/** Cap on a single operation's stringified result inside the digest (the unbounded part — tool outputs). */
export const OP_RESULT_CHAR_CAP = 1500;

/**
 * Cap on the whole digest string handed to the judge, so a 200-step run cannot blow the judge context.
 * Reached by dropping trailing operations (and disclosing how many) rather than silently overflowing.
 */
export const DIGEST_TOTAL_CHAR_CAP = 48_000;

const METHOD_GRADED = "trajectory_reference_v1";
const METHOD_UNCONFIGURED = "judge_unconfigured";
const METHOD_NO_REFERENCE = "judge_no_reference_logic";
const METHOD_ERROR = "judge_error";

// ── Operations digest (pure; the run's tool-call chain as the agent's trajectory) ───────────────────

/**
 * One "Operation" in the trajectory digest: an args-bearing `tool_call` paired with its `tool_result`.
 * `resultSummary` is the truncated stringification of the result (bounded by {@link OP_RESULT_CHAR_CAP});
 * `resultTruncated` flags a per-op cap hit so the disclosure is honest. Args are OPAQUE data, never run.
 */
export type TrajectoryOperation = {
  stepIdx: number;
  toolName: string;
  args: unknown;
  resultSummary: string;
  resultTruncated: boolean;
};

/**
 * The size-bounded digest built from a run's steps: the INCLUDED operations (post total-cap), the
 * prompt-ready `text` (with an explicit truncation disclosure when anything was dropped/shortened),
 * a `truncated` flag, and `droppedOps` (operations omitted entirely to fit the total cap).
 */
export type TrajectoryDigest = {
  operations: TrajectoryOperation[];
  text: string;
  truncated: boolean;
  droppedOps: number;
};

type RawOp = {
  stepIdx: number;
  toolName: string;
  args: unknown;
  result: unknown;
  hasResult: boolean;
};

/**
 * Build the ordered operations digest from a run's persisted steps. Pairs each args-bearing `tool_call`
 * step (the engine writes the model's tool input as `payload.args`; the MCP-sink duplicate carries no
 * `args` and is skipped) with its following `tool_result` — by shared `toolCallId`, else the next
 * not-yet-consumed `tool_result` after it. SIZE-BOUND: each op's result is truncated to `opResultCharCap`
 * and operations are included only while the running total stays under `totalCharCap`; the remainder is
 * dropped and DISCLOSED in the text. Pure + deterministic (caps injectable for tests).
 */
export function buildTrajectoryDigest(
  steps: readonly RunStep[],
  opts?: { opResultCharCap?: number; totalCharCap?: number },
): TrajectoryDigest {
  const opResultCap = opts?.opResultCharCap ?? OP_RESULT_CHAR_CAP;
  const totalCap = opts?.totalCharCap ?? DIGEST_TOTAL_CHAR_CAP;

  const allOps: TrajectoryOperation[] = extractRawOps(steps).map((raw) => {
    const full = raw.hasResult ? summarizeResult(raw.result) : "(no result recorded)";
    const { text, truncated } = truncateChars(full, opResultCap);
    return {
      stepIdx: raw.stepIdx,
      toolName: raw.toolName,
      args: raw.args,
      resultSummary: text,
      resultTruncated: truncated,
    };
  });

  // Include operation blocks until the total char budget is exhausted; drop (and count) the rest.
  const included: TrajectoryOperation[] = [];
  const blocks: string[] = [];
  let total = 0;
  let droppedOps = 0;
  for (const op of allOps) {
    const block = formatOperation(op, included.length + 1);
    // Always keep at least one op; otherwise stop before overflowing the total budget.
    if (included.length > 0 && total + block.length > totalCap) {
      droppedOps = allOps.length - included.length;
      break;
    }
    included.push(op);
    blocks.push(block);
    total += block.length + 2; // + the "\n\n" separator
  }

  const shortenedCount = included.filter((op) => op.resultTruncated).length;
  const truncated = droppedOps > 0 || shortenedCount > 0;

  let text =
    included.length > 0 ? blocks.join("\n\n") : "No tool operations were recorded in this run.";
  if (truncated) {
    const parts: string[] = [];
    if (droppedOps > 0) parts.push(`${droppedOps} operation(s) omitted`);
    if (shortenedCount > 0) parts.push(`${shortenedCount} result(s) shortened`);
    text += `\n\n… (digest truncated to fit the judge context: ${parts.join("; ")})`;
  }

  return { operations: included, text, truncated, droppedOps };
}

/** Extract the ordered raw operations (tool_call → tool_result) from the run steps. */
function extractRawOps(steps: readonly RunStep[]): RawOp[] {
  // Index the first tool_result per toolCallId for correlated pairing.
  const resultByCallId = new Map<string, RunStep>();
  for (const step of steps) {
    if (step.type !== "tool_result") continue;
    const tcid = toolCallIdOf(step);
    if (tcid && !resultByCallId.has(tcid)) resultByCallId.set(tcid, step);
  }

  const consumed = new Set<string>();
  const ops: RawOp[] = [];
  for (const step of steps) {
    if (step.type !== "tool_call") continue;
    const payload = asRecord(step.payload);
    if (!payload || !("args" in payload)) continue; // MCP-sink duplicate (no args) → skip

    const tcid = toolCallIdOf(step);
    let result: RunStep | undefined;
    if (tcid && resultByCallId.has(tcid)) {
      result = resultByCallId.get(tcid);
    } else {
      // Positional fallback: the next not-yet-consumed tool_result after this call.
      result = steps.find(
        (r) => r.type === "tool_result" && r.index > step.index && !consumed.has(r.id),
      );
    }
    if (result) consumed.add(result.id);

    ops.push({
      stepIdx: step.index,
      toolName: step.toolName ?? step.label ?? "",
      args: payload.args,
      result: result ? resultValueOf(result) : undefined,
      hasResult: result !== undefined,
    });
  }
  return ops;
}

/** The result value a tool_result step carries: its `result`, else an `{ error }` object, else the payload. */
function resultValueOf(step: RunStep): unknown {
  const payload = asRecord(step.payload);
  if (!payload) return step.payload;
  if ("result" in payload) return payload.result;
  if ("error" in payload) return { error: payload.error };
  return payload;
}

function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return "(empty result)";
  return typeof result === "string" ? result : stableStringify(result);
}

/** One digest block, ported from the prototype's `format_operations` (with the source step idx). */
function formatOperation(op: TrajectoryOperation, ordinal: number): string {
  return [
    `### Operation ${ordinal} (step ${op.stepIdx})`,
    `Tool: ${op.toolName || "(unnamed)"}`,
    "Args:",
    stableStringify(op.args),
    "Result:",
    op.resultSummary,
  ].join("\n");
}

function truncateChars(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: `${text.slice(0, cap)}… (+${text.length - cap} chars)`, truncated: true };
}

function toolCallIdOf(step: RunStep): string | undefined {
  const payload = asRecord(step.payload);
  return payload && typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// ── Prompt (ported + adapted from compare_tools_vs_code SYSTEM_MESSAGE + COMPARISON_PROMPT) ─────────

/**
 * Ported from the prototype's `SYSTEM_MESSAGE`, generalized from Qlik/SQL-vs-pandas to any MCP tool
 * chain vs a reference-logic document. Frames the judge as a reviewer grading calculation LOGIC only.
 */
export const TRAJECTORY_JUDGE_SYSTEM =
  "You are an expert data analyst and reviewer. You compare an AI agent's ACTUAL tool-call trajectory " +
  "(the ordered operations it ran to answer a question) against a REFERENCE description of the correct " +
  "logic for that question. Evaluate whether the agent's operations are logically equivalent to the " +
  "reference by comparing dimensions, measures, aggregation functions, filters/selections, groupings, " +
  "and sort order — noting omissions (reference steps with no agent counterpart) and redundancy (agent " +
  "steps with no reference counterpart). Ground your assessment ENTIRELY in the operations and the " +
  "reference logic. Be concise and precise; focus on calculation logic, not implementation syntax or " +
  "natural-language phrasing.";

/**
 * Build the comparison prompt. Ported FAITHFULLY from `compare_tools_vs_code.COMPARISON_PROMPT`: the
 * agent trajectory (the operations digest) vs the reference logic, the same 0–10 rubric table, and the
 * same raw-JSON response contract (`calculation_comparison` + a 0–10 score + a reason). Adapted to carry
 * the run's question, the reference logic's kind/language, and the digest (which discloses any truncation).
 */
export function buildTrajectoryPrompt(input: {
  question: string;
  reference: ReferenceLogic;
  digest: string;
}): string {
  const ref = input.reference;
  const refLabel =
    ref.kind === "code"
      ? `Reference logic (correct calculation — ${ref.language ?? "code"})`
      : "Reference logic (correct calculation — prose)";
  const refBlock =
    ref.kind === "code" ? `\`\`\`${ref.language ?? ""}\n${ref.body}\n\`\`\`` : ref.body;
  return `## Question
${input.question}

## ${refLabel}
${refBlock}

## Agent tool-call trajectory (the operations that make the analytic calculations)
${input.digest}

---

Analyse the above and answer the following three points.

### 1. Calculation Comparison
Compare the logic of the agent's operations against the reference logic step by step:
- Are the same columns / dimensions used?
- Are the measures and aggregation functions (sum, count, mean, max, …) equivalent?
- Are the filters / selections matching the reference's filtering conditions?
- Are groupings (GROUP BY equivalents) the same?
- Is the sort order consistent?
- Are there extra agent operations with no counterpart in the reference (redundancy)?
- Are there reference steps with no counterpart in any agent operation (omissions)?
Selections/filters may appear inside an operation's Args or a query's WHERE clause — consider both.

### 2. Trajectory Score (0 – 10)
Score how well the agent's operations match the reference logic using this scale:

| Score | Meaning |
|-------|---------|
| 10 | Perfect match — identical logic: same dimensions, measures, filters, and aggregations. |
| 9  | Near-perfect — logically equivalent result; only cosmetic or ordering differences. |
| 8  | Correct with redundancy — correct result but extra, unnecessary operations. |
| 7  | Mostly correct — core logic right; one minor omission or slightly off aggregation. |
| 6  | Partial — minor gap — one filter, dimension, or aggregation step missing or slightly wrong. |
| 5  | Partial — roughly half the logic correct; one significant calculation or filter wrong/absent. |
| 4  | Partial — major gap — a critical calculation, grouping, or filter missing or wrong. |
| 3  | Largely incorrect — a few correct steps but substantial logical errors dominate. |
| 2  | Mostly wrong — very little logical equivalence with the reference. |
| 1  | Almost no match — operations almost entirely different; only superficially similar. |
| 0  | No match — operations bear no logical relation to the reference. |

Assign a single integer score.

### 3. Score Justification
Justify the score by referencing SPECIFIC operations by their step index (e.g. "Operation at step 3"):
explain exactly which agent operation is wrong, missing, or redundant relative to the reference, and how
that gap affects the computed result. If the score is 10, confirm every reference step has a correct
agent counterpart and vice-versa. Do NOT justify the score by phrasing — only operations-vs-reference logic.

Return your answer as raw JSON (no markdown code fences), exactly:
{
  "calculation_comparison": "<step-by-step comparison of the agent operations vs the reference logic>",
  "trajectory_score": <integer 0-10>,
  "score_reason": "<explain the score by referencing specific operation step idxs: what matches, what is wrong/missing/redundant>"
}`;
}

// ── Parse (fence/truncation-tolerant; ported from compare_tools_vs_code._parse_llm_response_json) ────

/** The judge's parsed verdict: a 0–10 score + the comparison/justification text. */
export type TrajectoryParse = { rawScore: number; comparison: string };

/**
 * Parse the judge response. Ported from the prototype's `_parse_llm_response_json`, but returns `null`
 * (not 0) on total failure — an unparseable response is an `error`, NEVER a silent 0. Chain:
 *   1. Structured JSON — strip a code fence, take the first `{` … last `}`, read `trajectory_score`
 *      (accepting the prototype's `tools_vs_code_score` / a bare `score`) + `calculation_comparison`/`score_reason`.
 *   2. Truncation-tolerant field regex — a JSON cut off mid-string still yields the bare score integer
 *      and the partial `calculation_comparison`.
 *   3. First bare number anywhere — a dropped/renamed score key.
 * The score is clamped to [0, 10].
 */
export function parseTrajectoryResponse(text: string): TrajectoryParse | null {
  if (!text) return null;
  const cleaned = stripFences(text);

  // 1. Structured JSON (tolerant of any preamble/postamble around the object).
  const obj = firstJsonObject(cleaned);
  if (obj) {
    const score = coerceNumber(obj.trajectory_score ?? obj.score ?? obj.tools_vs_code_score);
    if (score !== null) {
      const comparison = joinNonEmpty([
        asString(obj.calculation_comparison),
        asString(obj.score_reason ?? obj.reason ?? obj.tools_vs_code_reason),
      ]);
      return { rawScore: clampScore(score), comparison: comparison || cleaned.trim() };
    }
  }

  // 2. Truncation-tolerant field regex (a JSON that was cut off before it closed).
  const fieldComparison = matchStringField(cleaned, "calculation_comparison");
  const fieldScore = matchScoreField(cleaned);
  if (fieldScore !== null) {
    return { rawScore: clampScore(fieldScore), comparison: fieldComparison ?? cleaned.trim() };
  }

  // 3. First bare number anywhere (a dropped/renamed key). Never a silent 0 when there is no number.
  const firstNumber = cleaned.match(/\d+(?:\.\d+)?/);
  if (firstNumber?.[0]) {
    return {
      rawScore: clampScore(Number.parseFloat(firstNumber[0])),
      comparison: fieldComparison ?? cleaned.trim(),
    };
  }

  return null;
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
    const parsed = JSON.parse(text.slice(start, end + 1));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function matchScoreField(text: string): number | null {
  const m = text.match(/"(?:trajectory_score|tools_vs_code_score|score)"\s*:\s*(\d+(?:\.\d+)?)/i);
  return m?.[1] ? Number.parseFloat(m[1]) : null;
}

function matchStringField(text: string, field: string): string | null {
  const m = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "s"));
  if (!m?.[1]) return null;
  return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
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

function joinNonEmpty(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("\n\n");
}

function clampScore(n: number): number {
  return Math.min(10, Math.max(0, n));
}

// ── The grader ──────────────────────────────────────────────────────────────────────────────────────

/** Dependencies for {@link createTrajectoryJudge} — the SAME shape/reuse as the WP 1.3 outcome judge. */
export type TrajectoryJudgeDeps = {
  /** The currently-configured default judge, or `null` when unconfigured (→ `unevaluable`). */
  resolveJudge: () => JudgeSettings | null;
  /** The one provider call (production: `createProviderJudgeGenerate`; tests: a stub). */
  generate: JudgeGenerate;
  /** Outer bound on one judge invocation (incl. queue wait); defaults to {@link DEFAULT_JUDGE_QUEUE_BACKSTOP_MS}. */
  timeoutMs?: number;
};

/**
 * Build the `trajectory_judge` grader. `appliesTo` makes it opt out ENTIRELY when the test has no
 * `referenceLogic` (no row, no call). When it does apply, `grade()` builds the operations digest, makes
 * ONE (timeout-bounded) provider call comparing it to the reference logic, parses the 0–10 score, and
 * reports the normalized score + the SEPARATE judge cost ledger. It NEVER throws — every failure path
 * returns an honest `error`/`unevaluable` verdict.
 */
export function createTrajectoryJudge(deps: TrajectoryJudgeDeps): Grader {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JUDGE_QUEUE_BACKSTOP_MS;

  return {
    id: TRAJECTORY_JUDGE_ID,
    kind: "llm",
    // The whole point of the WP: absent referenceLogic → skipped by GradeService (no row, no judge call).
    appliesTo(ctx: GradeContext): boolean {
      return Boolean(ctx.test.expectations?.referenceLogic?.body?.trim());
    },
    async grade(ctx: GradeContext): Promise<GraderResult> {
      // Defensive: grade() is only reached when appliesTo returned true, but re-check the document.
      const reference = ctx.test.expectations?.referenceLogic;
      if (!reference || !reference.body.trim()) {
        return {
          status: "unevaluable",
          score: null,
          method: METHOD_NO_REFERENCE,
          reasoning: "test declares no referenceLogic for the trajectory judge to compare against",
        };
      }

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

      const digest = buildTrajectoryDigest(ctx.run.steps ?? []);
      const prompt = buildTrajectoryPrompt({
        question: ctx.test.userPrompt,
        reference,
        digest: digest.text,
      });

      // ONE provider call, bounded so a stuck provider settles into an `error` grade (never a hang).
      let gen: JudgeGenerateResult;
      try {
        gen = await callWithTimeout(
          (signal) => deps.generate(settings, prompt, { system: TRAJECTORY_JUDGE_SYSTEM, signal }),
          timeoutMs,
        );
      } catch (error) {
        return errorResult(settings, toErrorMessage(error));
      }

      const parsed = parseTrajectoryResponse(gen.text);
      if (!parsed) {
        return errorResult(
          settings,
          `judge produced no parseable score: ${truncate(gen.text)}`,
          gen.usage,
          gen,
        );
      }

      return {
        status: "graded",
        // rawScore is the 0–10 rubric value; score = rawScore / 10 clamped to [0,1] (WP 1.3 normalizeRating).
        score: normalizeRating(parsed.rawScore),
        rawScore: parsed.rawScore,
        method: METHOD_GRADED,
        reasoning: parsed.comparison || gen.text.trim(),
        // Evidence: the step idxs of the operations the judge examined — deep-linkable, always resolve to
        // real run steps (like assertion evidence). Empty when the run recorded no tool calls.
        evidence: digest.operations.map((op) => op.stepIdx),
        ...judgeLedger(settings, gen.usage, gen),
      };
    },
  };
}

// ── Judge-cost ledger + control-flow helpers ───────────────────────────────────────────────────────
// These mirror the private helpers in judge.js; that module is read-only here (WP 2.2 file surface), so
// the SAME cost-isolation + never-hang guarantees are reproduced locally rather than exported from it.

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
 * The SEPARATE judge cost ledger (B5) carried on the {@link GraderResult}. `estimateCost` returns 0 for
 * an unpriced model (best-effort). This NEVER touches `runs.cost_usd`. The optional {@link JudgeProvenance}
 * (Auto-Rating WP 2.3) is PREFERRED over `settings` so a chain fall-through / CLI row reports the ACTUAL
 * source it used (CLI → cost 0, real tokens).
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
 * Race `run` (given a fresh abort signal) against a timeout so `grade()` ALWAYS settles even if the
 * provider ignores the abort — the guarantee "never a hang". The timer is always cleared.
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
