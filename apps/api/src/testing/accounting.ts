import type {
  ContextSegment,
  ContextSnapshot,
  NormalizedToolDefinition,
  ProviderKind,
  RunEvent,
  RunStep,
  TokenProfileRef,
  TokenUsageActual,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import { usageSplitKind } from "@mcp-token-footprint/shared";
import { modelContextLimits } from "../data-pack/thresholds.js";
import type { LanguageModelUsage, ModelMessage, ProviderMetadata } from "ai";
import { estimateCost } from "../providers/pricing.js";
import { getTokenCounter } from "../token-counting/profiles.js";
import type { TokenCounter } from "../token-counting/types.js";

/**
 * WP 1.4 — Token & context accounting. This module is the REAL {@link import("./tool-bridge.js").StepSink}
 * implementation (it replaces WP 1.3's minimal default sink) plus the LLM-step accounting the engine
 * drives from `onStepFinish`. It is the single place that:
 *
 *   1. counts the per-step request/response under every active **estimator lens** (the run's resolved
 *      {@link TokenCounter}s — provider-agnostic, reusing `countText`/`countJson`),
 *   2. extracts **provider-actual** usage from the AI SDK `usage` + `providerMetadata` (centralized in
 *      {@link extractProviderUsage} so WP 2.3 only adds a case per provider), surfacing the
 *      estimate − actual **delta**,
 *   3. builds a {@link ContextSnapshot} per step attributing the live window to segments, and
 *   4. accumulates run KPIs and emits `step` + `kpi` {@link RunEvent}s.
 */

/** The estimate − actual delta for one estimator lens on one llm step. */
export type LensDelta = {
  profile: TokenProfileRef;
  /** Estimator lens: request tokens (messages + tool defs + system) under this profile. */
  estimatedInputTokens: number;
  /** Estimator lens: response tokens (this generation) under this profile. */
  estimatedOutputTokens: number;
  /** Provider-actual − estimator-lens input tokens (signed; null when actual is unknown). */
  inputDelta: number | null;
  /** Provider-actual − estimator-lens output tokens (signed; null when actual is unknown). */
  outputDelta: number | null;
};

/** Per-step record the sink hands persistence (WP 1.6) alongside the emitted RunStep. */
export type LlmStepRecord = {
  step: RunStep;
  /** Estimate − actual delta per active lens (the product's core comparison). */
  deltas: LensDelta[];
};

/** Accumulated run-level KPIs (mirrors the `kpi`/`RunSummary` contract). */
export type RunKpis = {
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  // RM-33 (D-CT2) — the read/write halves of `cachedTokens`. A cache READ is a ~0.1x discount and a
  // cache WRITE a 1.25x premium, so the merged figure above cannot answer "did caching help".
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  peakContextTokens: number;
  /** WP 1.5 — cumulative estimated spend in USD (Σ per-step provider-actual tokens × pricing). */
  costUsd: number;
};

/**
 * WP 5.6 — per-turn tool-call breakdown the session-compatibility tests read. One entry per settled
 * LLM step (turn): how many MCP tool calls that turn issued, and the largest batch issued at once
 * (the parallel-call count). Derived from the tool calls recorded between LLM steps.
 */
export type TurnToolStats = {
  /** Total MCP tool calls issued in this turn. */
  toolCallCount: number;
  /** Largest set of tool calls issued in parallel within the turn (≥ 1 when any call ran). */
  parallelCallCount: number;
};

/**
 * WP 5.6 — one MCP tool result, sized + timed, for SESSION_TOOL_RESULT_SIZE / SESSION_TOOL_TIMEOUT.
 * `tokens` is the result counted under the run's primary lens; `durationMs` is the measured call latency.
 */
export type ToolResultStat = { toolName: string; tokens: number; durationMs: number };

/**
 * WP 5.6 — the session-level instrumentation the run engine exposes for compatibility scoring. All
 * additive on top of the existing KPIs; nothing here changes run persistence or the live stream.
 */
export type SessionStats = {
  /** Peak cumulative context tokens across the session (SESSION_CONTEXT_HIGHWATER). */
  peakContextTokens: number;
  /** Per-turn tool-call / parallel-call counts (SESSION_CALLS_PER_TURN / SESSION_PARALLEL_CALLS). */
  turns: TurnToolStats[];
  /** Per-call result size + latency (SESSION_TOOL_RESULT_SIZE / SESSION_TOOL_TIMEOUT). */
  toolResults: ToolResultStat[];
  /** Fixed static prefix tokens = system prompt + tool definitions (SESSION_CACHE_ELIGIBILITY). */
  systemPromptTokens: number;
  toolDefTokens: number;
  /** Provider-actual token totals (SESSION_COST_PER_TASK). */
  totals: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
  };
  /** Session token rate (input+output tokens per wall-clock minute) (SESSION_RATE_LIMIT_THROUGHPUT). */
  tokensPerMinute: number;
};

/** What the engine hands the sink for one settled LLM step (from `onStepFinish`). */
export type LlmStepInput = {
  /** The EXACT messages the SDK serialized into the request for this step (system excluded). */
  requestMessages: ModelMessage[];
  /** The model output content generated in this step (assistant message parts). */
  responseContent: unknown;
  /** AI SDK normalized usage for this step. */
  usage: LanguageModelUsage;
  /** Provider-specific metadata (Anthropic cache fields, etc.). */
  providerMetadata?: ProviderMetadata;
  /** The exact serialized request body the SDK sent, when the provider exposes it (lens input). */
  requestBody?: unknown;
  /**
   * F2 — the assistant text generated in this step (AI SDK `StepResult.text`). Settled onto the
   * emitted `llm_response` RunStep so per-turn prose is persisted/replayable, not just streamed as
   * untracked global deltas. Optional (a tool-only turn has no prose).
   */
  text?: string;
  /**
   * F2 — the reasoning text generated in this step (AI SDK `StepResult.reasoningText`, joined from the
   * reasoning parts when the provider only exposes those). Settled onto the `llm_response` RunStep.
   */
  reasoningText?: string;
  /**
   * Track E — the step's real wall-clock boundary (the engine's `Date.now()` around this `streamText`
   * step). Settled onto the `llm_response` RunStep so the run timeline / Gantt has a per-LLM-step
   * start/end (and real LLM-turn latency). Both ISO-8601, `startedAt <= endedAt`. Optional/additive.
   */
  startedAt?: string;
  endedAt?: string;
};

/** Static run context the sink needs to compute lenses + the context snapshot. */
export type AccountingContext = {
  runId: string;
  /** The run's resolved estimator profiles (a subset of the three). */
  profiles: TokenProfileRef[];
  /** Effective system prompt (the `system` segment). */
  system: string;
  /** ALL allow-listed tool definitions offered to the model (the `tool_defs` segment). */
  allowedTools: NormalizedToolDefinition[];
  /** Resolved model id — keys {@link MODEL_CONTEXT_LIMITS} for the snapshot `limit`. */
  model: string;
  /** Provider kind — selects the provider-actual usage mapping (WP 2.3 extends). */
  providerKind: ProviderKind;
  /**
   * Effective tool-loading mode for the run (additive; defaults to `eager` when omitted). In
   * `deferred` mode the allow-listed tool definitions are withheld from the prompt prefix (Anthropic
   * tool search), so the **resident** `tool_defs` footprint is 0 — the estimator must NOT add the full
   * tool catalog to every turn (that would over-count input vs the provider-actual window, which
   * excludes the deferred defs). Any tool the model later loads on demand shows up in the rolling
   * `history` via the request body. The full-surface footprint is still visible in the scan/footprint
   * views; here we account only for what is actually resident.
   */
  toolLoadingMode?: ToolLoadingMode;
};

const ZERO_SEGMENTS = (): Record<ContextSegment, number> => ({
  system: 0,
  tool_defs: 0,
  history: 0,
  tool_results: 0,
  output: 0,
});

/**
 * Centralized provider-actual usage mapping. Reads the AI SDK's normalized `usage` and layers in
 * provider-specific fields from `providerMetadata` / the raw provider payload where the normalized
 * shape loses detail. **All provider field knowledge lives in this ONE switch** — adding a provider
 * means adding a case here, nothing else.
 *
 * Field mapping per provider (raw → `TokenUsageActual`):
 *   - **Anthropic**: `input_tokens`/`output_tokens` + `cache_read_input_tokens` /
 *     `cache_creation_input_tokens` (from `providerMetadata.anthropic`).
 *   - **OpenAI**: `prompt_tokens`/`completion_tokens` + `prompt_tokens_details.cached_tokens` +
 *     `completion_tokens_details.reasoning_tokens` (the AI SDK normalizes these into
 *     `inputTokenDetails.cacheReadTokens` / `outputTokenDetails.reasoningTokens`; we also read the
 *     raw payload as a fallback for SDK versions that don't surface them).
 *   - **Google / Ollama**: map the available fields (`promptTokenCount`/`candidatesTokenCount`
 *     normalized to input/output, plus reasoning when present); a field the provider omits is left
 *     `undefined` — the estimator lens always covers it.
 */
export function extractProviderUsage(
  providerKind: ProviderKind,
  usage: LanguageModelUsage,
  providerMetadata?: ProviderMetadata,
): TokenUsageActual {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  // Normalized cache/reasoning (provider-agnostic; the AI SDK fills these where it can).
  // Cache READ and cache WRITE are kept SEPARATE so {@link estimateCost} can price the cache-read
  // slice (discounted, ~0.1× input) apart from the cache-write slice (1.25× input on Anthropic).
  // The merged `cachedInputTokens` (read + write) is derived at the end for the token KPIs.
  let cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens;
  let cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens;
  const reasoning = usage.outputTokenDetails?.reasoningTokens;

  let reasoningTokens = reasoning;

  switch (providerKind) {
    case "anthropic": {
      // Anthropic surfaces cache_read_input_tokens / cache_creation_input_tokens in providerMetadata
      // when the normalized usage doesn't carry them (depends on SDK version / caching usage).
      const anthropic = readNumericRecord(providerMetadata?.anthropic);
      cacheReadTokens = anthropic.cacheReadInputTokens ?? cacheReadTokens;
      cacheWriteTokens = anthropic.cacheCreationInputTokens ?? cacheWriteTokens;
      break;
    }
    case "openai":
    case "openai_compatible": {
      // OpenAI (and OpenAI-compatible endpoints) report cached prompt tokens — which are cache
      // *reads* (writes are free) — under `prompt_tokens_details.cached_tokens`, and reasoning under
      // `completion_tokens_details.reasoning_tokens`. The AI SDK normalizes these, but fall back to
      // the raw payload for endpoints/SDK versions that don't.
      const raw = readOpenAiRawUsage(usage.raw);
      if (cacheReadTokens === undefined && raw.cachedTokens !== undefined) {
        cacheReadTokens = raw.cachedTokens;
      }
      if (reasoningTokens === undefined && raw.reasoningTokens !== undefined) {
        reasoningTokens = raw.reasoningTokens;
      }
      break;
    }
    case "google":
    case "ollama":
    default:
      // Google + Ollama: the normalized `usage` already maps input/output (+ reasoning where the
      // provider returns it). Gemini's cached-content count maps to the cache-read slice above; any
      // field the provider omits stays `undefined` by design.
      break;
  }

  const cachedInputTokens = sumDefined(cacheReadTokens, cacheWriteTokens);

  const actual: TokenUsageActual = { inputTokens, outputTokens };
  if (cachedInputTokens !== undefined) actual.cachedInputTokens = cachedInputTokens;
  if (cacheReadTokens !== undefined) actual.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) actual.cacheWriteTokens = cacheWriteTokens;
  if (reasoningTokens !== undefined) actual.reasoningTokens = reasoningTokens;
  return actual;
}

/**
 * Detect a provider context-length / prompt-too-large error (decision #12). A provider context-limit
 * error is **ground-truth overflow** regardless of {@link MODEL_CONTEXT_LIMITS}. Anthropic returns a
 * 400 `invalid_request_error` whose message says the prompt is too long / exceeds the context window;
 * OpenAI uses `context_length_exceeded`. We match conservatively on the message/code so a real
 * overflow is recorded as `context_overflow` rather than a generic error.
 */
export function isContextOverflowError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!message) return false;
  return (
    message.includes("context_length_exceeded") ||
    message.includes("context length") ||
    message.includes("context window") ||
    message.includes("maximum context") ||
    message.includes("too many tokens") ||
    message.includes("prompt is too long") ||
    /prompt.{0,20}too long/.test(message) ||
    (message.includes("max_tokens") && message.includes("exceed")) ||
    (message.includes("token") && message.includes("exceed") && message.includes("limit"))
  );
}

/**
 * The real accounting sink. Owns the active {@link TokenCounter}s, the run KPI accumulator, and the
 * snapshot rollup; emits `step` + `kpi` {@link RunEvent}s through the supplied emit. The engine drives
 * {@link AccountingSink.llmStep} from `onStepFinish` (LLM steps) and routes tool calls through the
 * tool-bridge `StepSink` (handled by the run service's adapter).
 */
export class AccountingSink {
  private readonly counters: TokenCounter[];
  private readonly limit: number;
  private stepIndex = 0;
  // Engine-aligned assistant-turn ordinal: incremented once per `llmStep` CALL (= once per AI-SDK
  // `onStepFinish` = once per `finish-step` part the engine bumps `loopTurn` on), at the TOP of
  // `llmStep` BEFORE any await — so it stays in lockstep with the engine's stream-side `loopTurn`
  // even if this step's accounting later throws (the throw doesn't roll the counter back). This is
  // the `turnIndex` stamped on the `llm_response` step so the client can group a turn deterministically.
  private turnCounter = 0;
  private readonly kpis: RunKpis = {
    turns: 0,
    toolCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    cachedTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    peakContextTokens: 0,
    costUsd: 0,
  };

  // RM-33 (D-CT6) — TWO flags, because "did this run cache" and "can we say how" are different
  // questions and conflating them is how a run that demonstrably cached ends up reported as 0.
  //   `sawCacheSlice`  — any step reported a cache figure at all (merged or split).
  //   `sawExactSplit`  — any step reported the read/write SPLIT specifically.
  // A provider that reports only a merged `cachedInputTokens` (or a legacy replayed step) sets the
  // first and not the second: `cachedTokens` is emitted, the two halves are OMITTED, and every
  // downstream surface correctly reads the split as UNKNOWN rather than as zero.
  private sawCacheSlice = false;
  private sawExactSplit = false;

  // Rolling context segments. `system` + `tool_defs` are fixed per run; `history` grows as turns and
  // tool results accumulate; `output` is the current generation. Tokens are measured under the run's
  // FIRST resolved profile (the primary lens) for the snapshot rollup.
  private readonly primaryCounter: TokenCounter;
  private historyTokens = 0; // prior-turn messages already folded into the window
  private toolResultTokens = 0; // injected tool results folded into the window
  private systemTokens = 0;
  private toolDefsTokens = 0;
  private segmentsReady = false;

  // WP 5.6 — session-level instrumentation (additive; feeds the session-compatibility tests).
  private readonly sessionStartMs = Date.now();
  /** Per-turn tool-call breakdown, one entry per settled LLM step. */
  private readonly turnStats: TurnToolStats[] = [];
  /** Tool calls recorded since the last LLM step — flushed into one turn batch on the next step. */
  private pendingTurnToolCalls = 0;
  /** Every MCP tool result, sized + timed (SESSION_TOOL_RESULT_SIZE / SESSION_TOOL_TIMEOUT). */
  private readonly toolResultStats: ToolResultStat[] = [];

  constructor(
    private readonly ctx: AccountingContext,
    private readonly emit: (event: RunEvent) => void,
  ) {
    this.counters = ctx.profiles.map((p) => getTokenCounter(p));
    this.primaryCounter = this.counters[0] ?? getTokenCounter("generic_o200k");
    this.limit = modelContextLimits()[ctx.model] ?? 0;
  }

  get runKpis(): Readonly<RunKpis> {
    return this.kpis;
  }

  /** The run's primary estimator lens id (the first resolved profile) — keys per-step token counts. */
  get primaryProfile(): TokenProfileRef {
    return this.primaryCounter.id as TokenProfileRef;
  }

  /** Fixed segments (`system`, `tool_defs`) computed once under the primary lens. */
  private async ensureFixedSegments(): Promise<void> {
    if (this.segmentsReady) return;
    this.systemTokens = this.ctx.system ? await this.primaryCounter.countText(this.ctx.system) : 0;
    // Deferred runs withhold the tool definitions from the prefix, so the RESIDENT tool_defs footprint
    // is 0 (the catalog is searched on demand). Eager runs count the full allow-list as before.
    let toolDefs = 0;
    if (this.ctx.toolLoadingMode !== "deferred") {
      for (const def of this.ctx.allowedTools) {
        const breakdown = await this.primaryCounter.countToolDefinition(def);
        toolDefs += breakdown.totalTokens;
      }
    }
    this.toolDefsTokens = toolDefs;
    this.segmentsReady = true;
  }

  /**
   * Record one settled LLM step: count lenses over the exact serialized request + response, extract
   * provider-actual usage, compute the context snapshot, accumulate KPIs, and emit `step` + `kpi`.
   * Returns the record for persistence (WP 1.6).
   */
  async llmStep(input: LlmStepInput): Promise<LlmStepRecord> {
    // Stamp the turn ordinal FIRST — synchronously, before any await — so it can't be rolled back by
    // a later throw and stays aligned with the engine's `finish-step`-driven `loopTurn` (one per step).
    const turnIndex = this.turnCounter++;
    await this.ensureFixedSegments();

    // The exact request payload the SDK sent: prefer the provider's serialized body, else the messages
    // the SDK assembled for this step. Either way it is the ground truth for the estimator lens.
    //
    // Deferred mode: the provider STILL serializes every deferred tool's full name/description/schema
    // into the body's `tools` array (it only adds `defer_loading: true`) even though it keeps that
    // catalog OUT of the billed prompt prefix. Counting the body verbatim would therefore re-count the
    // whole catalog every turn — merely relabeling it from `tool_defs` into `history`, and over-counting
    // vs the provider-actual window. Strip the deferred entries so the lens matches what the model is
    // actually charged for. (Non-deferred tools — incl. the tool-search tool — and the message fallback
    // are untouched, so eager runs are unchanged.)
    const requestPayload =
      this.ctx.toolLoadingMode === "deferred" && input.requestBody !== undefined
        ? stripDeferredToolDefs(input.requestBody)
        : (input.requestBody ?? input.requestMessages);

    // Per-lens request/response token counts + delta vs provider-actual.
    const actual = extractProviderUsage(this.ctx.providerKind, input.usage, input.providerMetadata);
    const profileTokens: Partial<Record<TokenProfileRef, number>> = {};
    const deltas: LensDelta[] = [];
    let primaryRequestTokens = 0;
    let primaryResponseTokens = 0;

    for (const counter of this.counters) {
      const requestTokens = await counter.countJson(requestPayload);
      // Tool defs are part of what the SDK sends but live outside `messages`; fold them into the lens.
      const toolDefTokens = await this.countToolDefs(counter);
      const systemTokens = this.ctx.system ? await counter.countText(this.ctx.system) : 0;
      const estimatedInputTokens = requestTokens + toolDefTokens + systemTokens;
      const estimatedOutputTokens = await counter.countJson(input.responseContent);

      // The step's per-profile lens count surfaced on the RunStep is the input+output estimate.
      profileTokens[counter.id as TokenProfileRef] = estimatedInputTokens + estimatedOutputTokens;

      deltas.push({
        profile: counter.id as TokenProfileRef,
        estimatedInputTokens,
        estimatedOutputTokens,
        inputDelta: actual.inputTokens - estimatedInputTokens,
        outputDelta: actual.outputTokens - estimatedOutputTokens,
      });

      if (counter.id === this.primaryCounter.id) {
        primaryRequestTokens = estimatedInputTokens;
        primaryResponseTokens = estimatedOutputTokens;
      }
    }

    // Context snapshot: attribute the live window. `history` = everything in the request minus the
    // fixed system + tool_defs segments (prior turns + injected tool results we've folded in);
    // `output` = this generation. Measured under the primary lens for a stable rollup.
    const requestMinusFixed = Math.max(
      0,
      primaryRequestTokens - this.systemTokens - this.toolDefsTokens,
    );
    const outputTokens = primaryResponseTokens;
    const segments = ZERO_SEGMENTS();
    segments.system = this.systemTokens;
    segments.tool_defs = this.toolDefsTokens;
    segments.tool_results = this.toolResultTokens;
    segments.history = Math.max(0, requestMinusFixed - this.toolResultTokens);
    segments.output = outputTokens;
    const total =
      segments.system +
      segments.tool_defs +
      segments.history +
      segments.tool_results +
      segments.output;
    const snapshot: ContextSnapshot = { total, limit: this.limit, segments };

    // Carry the window forward: this turn's request + output becomes next turn's history baseline.
    this.historyTokens = requestMinusFixed + outputTokens;

    // WP 1.5 — real estimated spend: provider-actual usage × model pricing, accumulated so the cost
    // KPI (and `runs.cost_usd`) is no longer hardcoded 0 and the spend-cap guardrail uses this number.
    // WP2.6 — `estimateCost` resolves through the DB-backed pricing map (the code table is the seed +
    // fallback); passing `providerKind` is an informational hint (resolution keys on the model id).
    const stepCostUsd = estimateCost(this.ctx.model, actual, { provider: this.ctx.providerKind });

    // Accumulate run KPIs.
    this.kpis.turns += 1;
    this.kpis.tokensIn += actual.inputTokens;
    this.kpis.tokensOut += actual.outputTokens;
    this.kpis.cachedTokens += actual.cachedInputTokens ?? 0;
    this.kpis.cacheReadTokens += actual.cacheReadTokens ?? 0;
    this.kpis.cacheWriteTokens += actual.cacheWriteTokens ?? 0;
    const splitKind = usageSplitKind(actual);
    if (splitKind !== "none") this.sawCacheSlice = true;
    if (splitKind === "exact") this.sawExactSplit = true;
    this.kpis.reasoningTokens += actual.reasoningTokens ?? 0;
    this.kpis.peakContextTokens = Math.max(this.kpis.peakContextTokens, total);
    this.kpis.costUsd += stepCostUsd;

    // WP 5.6 — close out this turn's tool-call batch. The tool calls recorded since the previous LLM
    // step were issued together (one assistant message), so the batch size is the turn's parallel-call
    // count; the per-turn count is recorded for SESSION_CALLS_PER_TURN.
    const turnCalls = this.pendingTurnToolCalls;
    this.pendingTurnToolCalls = 0;
    this.turnStats.push({ toolCallCount: turnCalls, parallelCallCount: turnCalls });

    const step: RunStep = {
      id: `${this.ctx.runId}:acct:${this.stepIndex}`,
      runId: this.ctx.runId,
      index: this.stepIndex++,
      type: "llm_response",
      label: this.ctx.model,
      status: "ok",
      turnIndex,
      profileTokens,
      usageActual: actual,
      context: snapshot,
      // WP 5.6 — running cumulative context tokens through this step (the window total at this point).
      cumulativeTokens: total,
      // F2 — per-turn assistant prose + reasoning, settled on the closing llm_response step (redacted +
      // size-bounded on persistence). Only set when present so a tool-only turn carries no empty field.
      ...(input.text ? { assistantText: input.text } : {}),
      ...(input.reasoningText ? { reasoningText: input.reasoningText } : {}),
      // Track E — per-step wall-clock (the engine's `Date.now()` around this `streamText` step) so the
      // run timeline / Gantt has a per-LLM-step start/end. Only set when the engine supplied timing.
      ...(input.startedAt ? { startedAt: input.startedAt } : {}),
      ...(input.endedAt ? { endedAt: input.endedAt } : {}),
      // Redacted opaque payload: lens vs actual deltas + the snapshot (never the raw request/secrets).
      payload: { deltas, snapshot },
    };

    this.emit({ type: "step", step });
    this.emitKpi(snapshot.total);
    return { step, deltas };
  }

  /**
   * Record an injected tool result so the next step's `tool_results` segment reflects it. WP 5.6 also
   * records the per-call result size + latency (for SESSION_TOOL_RESULT_SIZE / SESSION_TOOL_TIMEOUT)
   * and counts the call toward the current turn's tool-call batch (SESSION_CALLS_PER_TURN /
   * SESSION_PARALLEL_CALLS). Returns the result tokens counted under the primary lens so the caller
   * can surface them on the persisted `tool_call` step.
   */
  async recordToolResult(
    result: unknown,
    ctx?: { toolName?: string; durationMs?: number },
  ): Promise<number> {
    this.kpis.toolCalls += 1;
    this.pendingTurnToolCalls += 1;
    const tokens = await this.primaryCounter.countJson(result);
    this.toolResultTokens += tokens;
    this.toolResultStats.push({
      toolName: ctx?.toolName ?? "",
      tokens,
      durationMs: ctx?.durationMs ?? 0,
    });
    return tokens;
  }

  /**
   * WP 5.6 — the session-level instrumentation snapshot for compatibility scoring. Flushes any
   * trailing tool-call batch (a final turn whose LLM step never settled — e.g. a stopped run) so the
   * per-turn counts are complete, then derives the token rate from wall-clock elapsed.
   */
  sessionStats(): SessionStats {
    const turns = [...this.turnStats];
    if (this.pendingTurnToolCalls > 0) {
      turns.push({
        toolCallCount: this.pendingTurnToolCalls,
        parallelCallCount: this.pendingTurnToolCalls,
      });
    }
    const elapsedMs = Math.max(1, Date.now() - this.sessionStartMs);
    const totalTokens = this.kpis.tokensIn + this.kpis.tokensOut;
    const tokensPerMinute = (totalTokens * 60_000) / elapsedMs;
    return {
      peakContextTokens: this.kpis.peakContextTokens,
      turns,
      toolResults: [...this.toolResultStats],
      systemPromptTokens: this.systemTokens,
      toolDefTokens: this.toolDefsTokens,
      totals: {
        inputTokens: this.kpis.tokensIn,
        outputTokens: this.kpis.tokensOut,
        cachedTokens: this.kpis.cachedTokens,
        cacheReadTokens: this.kpis.cacheReadTokens,
        cacheWriteTokens: this.kpis.cacheWriteTokens,
        reasoningTokens: this.kpis.reasoningTokens,
      },
      tokensPerMinute,
    };
  }

  /**
   * Emit a terminal `context_event` step + (the engine emits) the `context_overflow` status. Records
   * the provider's overflow message as a legitimate step, not a crash (decision #12).
   */
  emitOverflowStep(message: string): void {
    const snapshot: ContextSnapshot = {
      total: this.kpis.peakContextTokens,
      limit: this.limit,
      segments: {
        system: this.systemTokens,
        tool_defs: this.toolDefsTokens,
        history: Math.max(0, this.historyTokens - this.toolResultTokens),
        tool_results: this.toolResultTokens,
        output: 0,
      },
    };
    const step: RunStep = {
      id: `${this.ctx.runId}:acct:${this.stepIndex}`,
      runId: this.ctx.runId,
      index: this.stepIndex++,
      type: "context_event",
      label: "context_overflow",
      status: "error",
      profileTokens: {},
      context: snapshot,
      payload: { overflow: true, message },
    };
    this.emit({ type: "step", step });
  }

  /** Emit the rolled-up `kpi` RunEvent with the current accumulator + the latest context total. */
  private emitKpi(contextTokens: number): void {
    this.emit({
      type: "kpi",
      turns: this.kpis.turns,
      toolCalls: this.kpis.toolCalls,
      tokensIn: this.kpis.tokensIn,
      tokensOut: this.kpis.tokensOut,
      contextTokens,
      // WP 1.5 — real estimated spend (provider-actual tokens × pricing), no longer hardcoded 0.
      costUsd: this.kpis.costUsd,
      // RM-33 (D-CT1/D-CT2) — the cache composition of `tokensIn`, which stays GROSS above.
      ...this.cacheKpiFields(),
    });
  }

  /**
   * RM-33 (D-CT6) — the cache fields for a `kpi` event, or `{}` when this run has never seen a cache
   * slice. There are TWO kpi emitters (this sink's per-turn one and the engine's final one, which
   * reads {@link getRunKpis}), and they must agree byte-for-byte — so the omit-when-absent rule lives
   * here once rather than being re-implemented at each site.
   *
   * Why omit rather than send zeros: "additive" has to mean it. A backend that does not report cache
   * must keep emitting the pre-RM-33 event shape, because a consumer cannot tell a `cacheReadTokens:
   * 0` meaning "no cache happened" from one meaning "this backend never tells us".
   */
  cacheKpiFields(): {
    cachedTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  } {
    if (!this.sawCacheSlice) return {};
    return {
      cachedTokens: this.kpis.cachedTokens,
      // Only when the split was actually reported. Emitting `cacheReadTokens: 0` for a merged-only
      // run would turn "we cannot tell" into "there were no reads" — and since a cache READ is a 0.1x
      // discount while a cache WRITE is a 1.25x premium, that mislabels the run's economics as well
      // as its tokens.
      ...(this.sawExactSplit
        ? {
            cacheReadTokens: this.kpis.cacheReadTokens,
            cacheWriteTokens: this.kpis.cacheWriteTokens,
          }
        : {}),
    };
  }

  private async countToolDefs(counter: TokenCounter): Promise<number> {
    // Deferred runs keep the tool definitions out of the prefix, so they contribute 0 to the per-turn
    // input estimate — matching the provider-actual window (which excludes the deferred defs). A tool
    // the model later loads on demand is captured in the request-body lens (attributed to `history`).
    if (this.ctx.toolLoadingMode === "deferred") return 0;
    let total = 0;
    for (const def of this.ctx.allowedTools) {
      const breakdown = await counter.countToolDefinition(def);
      total += breakdown.totalTokens;
    }
    return total;
  }
}

function sumDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Drop deferred tool definitions (`defer_loading: true`) from an Anthropic request body's `tools`
 * array so the estimator lens excludes the searchable catalog the provider keeps OUT of the billed
 * prompt prefix (deferred mode). The provider serializes every deferred tool's full
 * name/description/input_schema into the body and only adds `defer_loading: true`, so without this the
 * deferred catalog would be counted every turn. Returns the body unchanged when it is not a
 * tools-bearing object or when nothing is deferred (so a fresh copy is only made when it matters).
 */
function stripDeferredToolDefs(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const record = body as Record<string, unknown>;
  const tools = record.tools;
  if (!Array.isArray(tools)) return body;
  const resident = tools.filter(
    (t) =>
      !(
        t !== null &&
        typeof t === "object" &&
        (t as Record<string, unknown>).defer_loading === true
      ),
  );
  return resident.length === tools.length ? body : { ...record, tools: resident };
}

/** Read a provider-metadata sub-record's numeric fields safely (providerMetadata is loosely typed). */
function readNumericRecord(value: unknown): {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
} {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const read = record.cacheReadInputTokens;
  const write = record.cacheCreationInputTokens;
  return {
    cacheReadInputTokens: typeof read === "number" ? read : undefined,
    cacheCreationInputTokens: typeof write === "number" ? write : undefined,
  };
}

/**
 * Read OpenAI's raw usage shape (`usage.raw` — the provider's payload verbatim) for the cached /
 * reasoning detail fields the normalized usage may not carry. OpenAI nests them under
 * `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`.
 */
function readOpenAiRawUsage(raw: unknown): { cachedTokens?: number; reasoningTokens?: number } {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const promptDetails = record.prompt_tokens_details;
  const completionDetails = record.completion_tokens_details;
  const cached =
    promptDetails && typeof promptDetails === "object"
      ? (promptDetails as Record<string, unknown>).cached_tokens
      : undefined;
  const reasoning =
    completionDetails && typeof completionDetails === "object"
      ? (completionDetails as Record<string, unknown>).reasoning_tokens
      : undefined;
  return {
    cachedTokens: typeof cached === "number" ? cached : undefined,
    reasoningTokens: typeof reasoning === "number" ? reasoning : undefined,
  };
}
