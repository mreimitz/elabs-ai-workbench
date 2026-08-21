import type {
  GuardrailConfig,
  ProviderKind,
  RunEvent,
  RunOutcome,
  RunStatus,
  RunStep,
  RunStepType,
  StopReasonCode,
  TokenProfileRef,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  type StopCondition,
  type TextStreamPart,
  type Tool,
  type ToolSet,
} from "ai";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import { isAuthRequiredError } from "../mcp/auth-error.js";
import { extractProviderUsage, isContextOverflowError } from "./accounting.js";
import { check, initialGuardrailState, type GuardrailState } from "./guardrails.js";
import type { RunEmitMeta } from "./run-manager.js";
import { SessionClock } from "./session-clock.js";
import { terminalFor, type TerminalCause } from "./session-terminal.js";

// `ProviderOptions` is not re-exported from `ai` v6; derive the field type from streamText's own
// parameter object so it always matches the installed SDK (the provider escape hatch — WP 2.3).
type StreamTextProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

/**
 * Everything the loop needs that is NOT the live MCP/provider plumbing. The run service resolves
 * these from the scenario ∪ test before calling {@link runAgentLoop}.
 */
export type EngineConfig = {
  /** Resolved by the run service via `modelFor(cred, scenario.model)`; injectable for tests. */
  model: LanguageModel;
  /** Effective system prompt (test override ?? scenario prompt). */
  system: string;
  /** Opener user turn (test.userPrompt). Interactive mode appends more turns later (WP 2.2). */
  userPrompt: string;
  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — fork seed. When a run is a FORK of a prior
   * run, the reconstructed conversation prefix (`fork.ts`) is prepended BEFORE the opener user turn, so
   * the model continues from the parent's transcript with the (possibly overridden) final user prompt as
   * the new turn. ADDITIVE: an ordinary run omits it → `messages` is exactly `[{role:"user",...}]` as
   * before. The prefix steps are NOT re-emitted as this run's own steps (the parent's history is reached
   * via the lineage banner, not duplicated) — only the opener user turn is emitted, unchanged.
   */
  messagePrefix?: ModelMessage[];
  /**
   * Observability (WP3.3, D-OB18) — an explicit sampling temperature for `streamText`, set ONLY by a
   * fork's `temperature` override. ADDITIVE + guarded by presence: a non-fork run (and a fork with no
   * temperature override) passes none, so `streamText` uses the provider default exactly as before — no
   * behavior change to any existing run.
   */
  temperature?: number;
  /** Allow-list-filtered AI SDK tools, keyed by tool name. */
  tools: ToolSet;
  /** scenario.guardrails.maxTurns ?? 20 — the step cap for the multi-step loop. */
  maxTurns: number;
  /**
   * WP 1.5 budget guardrails (tool calls / token / context / spend). `maxTurns` is enforced by
   * `stepCountIs(maxTurns)`; the rest are enforced by a `stopWhen` predicate that accumulates over the
   * settled steps and, on trip, stops the loop with `outcome: "stopped_guardrail"` + `stop_reason` =
   * the named key. Omit / leave empty (or `0`) for no budget. (Decision #11 — no wall-clock.)
   */
  guardrails?: GuardrailConfig;
  /**
   * Resolved model id (e.g. `claude-sonnet-4`) — keys {@link import("../providers/pricing.js").MODEL_PRICING}
   * so the spend-cap guardrail prices the SAME provider-actual usage the cost KPI uses. Defaults to the
   * per-step `model.modelId` the SDK reports when omitted.
   */
  modelId?: string;
  /** Provider kind — selects the provider-actual usage mapping for the spend/token guardrails (WP 1.5). */
  providerKind?: ProviderKind;
  /** Effective token profiles (scenario defaults ∪ test additions); WP 1.4 fills profileTokens. */
  profiles: TokenProfileRef[];
  /**
   * Tool-loading decision for this run (additive). Set ONLY when the scenario requested `deferred`:
   * the engine emits a `context_event` notice describing whether deferred tool search is **active**
   * or **fell back** to eager (unsupported provider/model), so the decision is visible, persisted, and
   * replayable. Omitted for plain eager runs (no notice). `reason` explains a fallback.
   */
  toolLoading?: { requested: ToolLoadingMode; effective: ToolLoadingMode; reason?: string };
  /** Optional provider escape hatch (e.g. Anthropic cache_control / thinking), wired in WP 2.3. */
  providerOptions?: StreamTextProviderOptions;
  /**
   * Returns a fatal MCP transport-error message if one occurred during a tool call, else undefined.
   * Set by the run service from the tool bridge. A transport failure FAILS the run (a tool-level
   * `isError:true`, by contrast, is only a failed step). Checked after the stream settles.
   */
  getTransportError?: () => string | undefined;
  /**
   * WP 1.4 token & context accounting hook. Called once per settled LLM round-trip with the exact
   * request the SDK assembled + the response usage/metadata; the {@link AccountingSink} computes
   * lenses, provider-actual usage, the context snapshot, KPIs, and emits the `step`/`kpi` events. On
   * a provider context-limit error the engine calls {@link AccountingHooks.onOverflow} and ends the
   * run with `outcome: "context_overflow"` (decision #12).
   */
  accounting?: AccountingHooks;
  /**
   * WP 2.2 — abort signal threaded to `streamText`. When the run is stopped (`POST /api/runs/:id/stop`)
   * the run service aborts this controller; the engine ends the run with `outcome: "aborted"`. A
   * provider stream that throws/emits an abort while this signal is aborted is treated as a clean
   * abort, never a fatal `error`.
   */
  abortSignal?: AbortSignal;
  /**
   * WP 2.2 — interactive turn provider. When present, after the model stops on its own the engine
   * awaits the next user turn ({@link InteractiveTurns.nextTurn}); a returned string is appended as a
   * `user` message and the loop resumes for another provider round-trip, accumulating KPIs/cost across
   * turns. `null` (or an aborted run) ends the conversation. Omitted ⇒ single-turn automated run (the
   * pre-WP-2.2 behavior, unchanged).
   */
  interactive?: InteractiveTurns;
  /**
   * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US3/D-US7) — SessionClock stall/wait-budget
   * tuning OVERRIDES, for tests only. Omitted (the production path) uses the library defaults (10 min
   * stall / 10 min wait; see `session-clock.ts`). The wall-cap deadline is NOT configured here — it is
   * derived from `guardrails.maxRunDurationMs` (opt-in: undefined/0 ⇒ no cap, per D-US3 — no wall
   * clock by default).
   */
  sessionClockOptions?: { stallMs?: number; waitBudgetMs?: number };
  /**
   * Unified Sessions (WP1.3) — invoked SYNCHRONOUSLY, exactly once, immediately after this run's
   * {@link SessionClock} is constructed (before the loop awaits anything). Lets the caller (the run
   * service) capture a live reference to the SAME clock instance driving this run, so it can wire the
   * `ask_user` tool's bridge — built BEFORE this `EngineConfig` exists — to bracket its wait with the
   * identical stall/wait-budget timeline a `nextTurn` wait uses (D-US3: the wait budget applies to
   * BOTH). `clockAbortSignal` is the SAME signal the engine combines into its own `effectiveSignal`
   * (aborts when the clock fires ANY cause) — the bridge's `waitForAnswer` must ALSO race against it
   * (alongside the existing user-stop signal), otherwise a clock fire while a question is pending
   * would leave that wait hanging forever (nothing else unblocks it). Optional; a caller/test that
   * doesn't need the ask_user coupling omits it.
   */
  onSessionClockReady?: (clock: SessionClock, clockAbortSignal: AbortSignal) => void;
};

/**
 * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US3) — this engine no longer defaults its OWN
 * wall-clock cap to 30 min: the cap is opt-in only (undefined/0 on `guardrails.maxRunDurationMs` ⇒ no
 * cap), and idle/stall detection is now owned by {@link SessionClock}'s stall + wait-budget timers
 * (10 min / 10 min defaults), not a bespoke idle timer (the old `DEFAULT_IDLE_TIMEOUT_MS`/
 * `EngineConfig.idleTimeoutMs` are removed). This constant is KEPT (unchanged name/value) because the
 * sibling `claude-subscription-executor.ts` still imports it as ITS OWN
 * fallback default until their own adoption WPs (1.4/1.5) land — do not repurpose or remove it.
 */
export const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60_000; // 30 min

/** Combine two AbortSignals into one that aborts when either does (user stop ∪ run deadline). */
function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn([a, b]);
  // Fallback for runtimes without AbortSignal.any: forward either abort into a fresh controller.
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  if (a.aborted || b.aborted) controller.abort();
  else {
    a.addEventListener("abort", forward, { once: true });
    b.addEventListener("abort", forward, { once: true });
  }
  return controller.signal;
}

/**
 * Await the next interactive turn, racing it against `stopSignal` (the run's combined abort signal —
 * user stop ∪ any {@link SessionClock}-fired cause) so a wait can never hold the loop open past
 * either. Resolves `null` when the signal wins (the caller then finalizes via `aborted()` or
 * `clock.fired`, whichever applies) or when {@link InteractiveTurns.nextTurn} itself resolves `null`
 * (the run service's own end-of-conversation signal). Unified Sessions (WP1.3) replaces the old
 * bespoke idle-timeout racer — the wait BUDGET that used to bound this wait is now
 * {@link SessionClock}'s, armed by the caller's `clock.enterWaiting()` before this is called.
 */
async function awaitNextTurn(
  interactive: InteractiveTurns,
  stopSignal: AbortSignal,
): Promise<string | null> {
  if (stopSignal.aborted) return null;
  const racers: Array<Promise<string | null>> = [interactive.nextTurn()];
  let onStop: (() => void) | undefined;
  racers.push(
    new Promise<null>((resolve) => {
      onStop = () => resolve(null);
      stopSignal.addEventListener("abort", onStop, { once: true });
    }),
  );
  try {
    return await Promise.race(racers);
  } finally {
    if (onStop) stopSignal.removeEventListener("abort", onStop);
  }
}

/**
 * Conservative message-based 429/rate-limit classifier for a fatal provider/transport error, mirroring
 * `accounting.ts`'s {@link isContextOverflowError} style (no dedicated SDK error shape to rely on
 * across every provider). Checked only after {@link isAuthRequiredError} — a 401/403 is the more
 * specific classification and wins.
 */
function isRateLimitError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!message) return false;
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("too many requests")
  );
}

/**
 * Unified Sessions (WP1.3) — the tripped guardrail-meter → {@link TerminalCause} mapping.
 * `maxTokens`/`maxContextTokens`/`maxCostUsd`/`maxToolCalls` each have a dedicated `StopReasonCode`.
 * (WP1.1 originally shipped `maxToolCalls` with NO dedicated code — a discovered gap in the WP1.1
 * contract, reported rather than silently patched at the time, see the WP1.3 report — WP1.7 closed it
 * by additively appending `max_tool_calls` to `STOP_REASON_CODES`.)
 */
const GUARDRAIL_TRIP_CAUSES: Partial<Record<NonNullable<GuardrailState["tripped"]>, TerminalCause>> = {
  maxToolCalls: "max_tool_calls",
  maxTokens: "max_tokens",
  maxContextTokens: "max_context_tokens",
  maxCostUsd: "max_cost",
};

/** WP 2.2 interactive driver: the HTTP `POST /api/runs/:id/turns` route feeds turns through this. */
export type InteractiveTurns = {
  /**
   * Resolve the next user turn once the model stops, or `null` to end the conversation. The run
   * service blocks here until a `/turns` POST arrives or the run is stopped (then it resolves `null`).
   */
  nextTurn(): Promise<string | null>;
};

/**
 * F3 — the accounting sink's rolled-up run totals, read by the engine's FINAL `kpi` so the KPI
 * "Turns" equals the number of settled `llm_response` steps (== the context chart's columns) by
 * construction, instead of the engine's own `onStepFinish` step count. Mirrors the
 * {@link import("./accounting.js").RunKpis} fields the run KPIs need.
 */
export type RunKpiTotals = {
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  /** Cumulative spend in USD (Σ per-step provider-actual tokens × pricing). */
  costUsd: number;
  /** Peak cumulative context tokens across the run (for the `contextTokens` KPI). */
  peakContextTokens: number;
};

/**
 * Track E — real wall-clock around one settled LLM step (`streamText` step boundary): the engine
 * captures `Date.now()` at the prior boundary (pass start, or the previous `onStepFinish`) as
 * `startedAt` and at THIS boundary as `endedAt`, both ISO-8601, with `startedAt <= endedAt`. Threaded
 * to the accounting sink so it stamps the `llm_response` step + yields real LLM-turn latency.
 */
export type LlmStepTiming = {
  startedAt: string; // ISO-8601
  endedAt: string; // ISO-8601
};

/** The accounting seam the engine drives (provided by {@link import("./accounting.js").AccountingSink}). */
export type AccountingHooks = {
  /**
   * Settled LLM step: pass the exact request + response so the sink can count lenses vs actual. The
   * optional {@link LlmStepTiming} carries the step's real wall-clock boundary (Track E); it is
   * additive/backward-compatible so existing callers that ignore it still compile.
   */
  onLlmStep(step: StepResult<ToolSet>, timing?: LlmStepTiming): void | Promise<void>;
  /** Emit a terminal `context_event` step for a provider context-limit overflow. */
  onOverflow(message: string): void;
  /**
   * F3 — the accounting sink's current rolled-up run totals (turns = number of settled `llm_response`
   * steps, plus tokens/cost/peak-context). The engine reads this for its FINAL `kpi` so KPI "Turns"
   * can no longer diverge from the context chart's columns. Wired from `accounting.runKpis`.
   */
  getRunKpis(): RunKpiTotals;
  /**
   * RM-33 (D-CT6) — the cache-composition fields for a `kpi` event, or `{}` when this run has seen no
   * cache slice. Optional on the seam so a test double that predates RM-33 still satisfies it; the
   * real sink (`AccountingSink.cacheKpiFields`) owns the omit-when-absent rule so this final kpi and
   * the sink's per-turn ones cannot disagree.
   */
  cacheKpiFields?(): { cachedTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
};

/** How the loop ended, mapped to the shared status/outcome contract. */
export type LoopResult = {
  status: RunStatus;
  outcome: RunOutcome;
  stopReason?: string;
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
};

/**
 * The loop emits ordered {@link RunEvent}s through this sink (the run manager in production).
 * Unified Sessions (WP1.3) — the optional `meta` param carries SessionClock-derived durations
 * (`activeDurationMs`/`totalDurationMs`), forwarded verbatim to `RunManager.emit`'s own optional
 * `meta` (see {@link RunEmitMeta}); a caller that only ever calls `emit(event)` is unaffected.
 */
export type EngineEmit = (event: RunEvent, meta?: RunEmitMeta) => void;

const ZERO_PROFILE_TOKENS = (
  profiles: TokenProfileRef[],
): Partial<Record<TokenProfileRef, number>> => {
  const out: Partial<Record<TokenProfileRef, number>> = {};
  for (const p of profiles) out[p] = 0;
  return out;
};

/** True when a tool result is an MCP `{ isError: true }` result (a tool-level failure). */
function isMcpErrorResult(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { isError?: unknown }).isError === true
  );
}

/**
 * Count only the CLIENT-executed tool calls in a settled step. Provider-executed tools — notably the
 * Anthropic tool-search tool used in `deferred` mode — run server-side and are NOT MCP tool calls, so
 * they must not consume the `maxToolCalls` budget: counting them would make a deferred run trip the
 * guardrail at a different point than the same eager run AND disagree with the reported `toolCalls`
 * KPI (which counts only the MCP-bridge `execute` path, i.e. client-executed calls). The AI SDK flags
 * provider-executed calls with `providerExecuted: true`.
 */
function clientToolCallCount(step: StepResult<ToolSet>): number {
  return step.toolCalls.filter((call) => call.providerExecuted !== true).length;
}

/**
 * Run the agent loop for one run, streaming via the AI SDK and emitting {@link RunEvent}s.
 *
 * - `model` is injected (production passes `modelFor(...)`; tests pass a mock) so the loop never
 *   hard-depends on a real provider.
 * - The allow-list is enforced by construction: `tools` only ever contains allowed tools.
 * - Tool output is **untrusted**: it is handed straight to the model + the step sink, never `eval`'d
 *   and never echoed as a secret.
 *
 * Translation of the high-level `fullStream` parts:
 *   - `text-delta` / `reasoning-delta` → `delta` RunEvents
 *   - `tool-call` → a running `tool_call` step; `tool-result` → an `ok` `tool_result` step;
 *     `tool-error` → an `error` `tool_result` step (a tool-level failure is a failed step, NOT a
 *     thrown run)
 *   - `finish` → final `kpi` + a terminal `status`
 *   - `error` → an `error` RunEvent + an `error` terminal status (a transport/request failure)
 *
 * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3) — lifecycle timing is now owned by a per-run
 * {@link SessionClock} (stall / wait-budget / opt-in wall-cap) instead of the old bespoke idle-timeout
 * racer + hard-coded 30-min deadline; EVERY terminal path resolves its `{status,outcome,stopReasonCode}`
 * triple through the shared `terminalFor` table (`session-terminal.ts`) so the same cause produces the
 * same triple on every executor.
 */
export async function runAgentLoop(
  runId: string,
  cfg: EngineConfig,
  emit: EngineEmit,
): Promise<LoopResult> {
  // WP3.3 (D-OB18) — a forked run seeds the reconstructed parent-conversation prefix ahead of the
  // opener user turn; a non-fork run has no prefix, so this is byte-identical to the pre-WP shape.
  const messages: ModelMessage[] = [
    ...(cfg.messagePrefix ?? []),
    { role: "user", content: cfg.userPrompt },
  ];

  // Issue #10 — a spend cap is only meaningful if we can price the model. For a model with NO known
  // price, `estimateCost` returns 0 forever, so `maxCostUsd` could never trip and the run would spend
  // UNBOUNDED while appearing capped. Policy: REJECT such a run up front with a clear error rather than
  // run it silently uncapped. (A genuinely free/local model in the zero-price allowlist is "priced" and
  // is unaffected.) Uses the resolved `modelId` the spend cap prices with.
  //
  // This early-rejection path runs BEFORE any SessionClock exists (the run never actually starts —
  // `turns: 0` — so there is nothing to clock).
  const costCapModelId = cfg.modelId;
  if (cfg.guardrails?.maxCostUsd && costCapModelId && !isModelPriced(costCapModelId)) {
    const message =
      `Cost cap (maxCostUsd=${cfg.guardrails.maxCostUsd}) is set but model "${costCapModelId}" has no ` +
      `known pricing, so the spend cap cannot be enforced (estimated cost would always be 0). Refusing ` +
      `to run — add the model to the pricing table or remove maxCostUsd.`;
    console.warn(`[run ${runId}] ${message}`);
    emit({ type: "error", message });
    emit({ type: "status", status: "error", outcome: "error", stopReason: message });
    return {
      status: "error",
      outcome: "error",
      stopReason: message,
      turns: 0,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
  // Issue #10 — even without a cost cap, surface (once) that an unpriced model's cost KPI is a floor of 0.
  if (!cfg.guardrails?.maxCostUsd && costCapModelId && !isModelPriced(costCapModelId)) {
    console.warn(
      `[run ${runId}] Model "${costCapModelId}" has no known pricing; estimated run cost will read 0.`,
    );
  }

  let stepIndex = 0;
  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let steps = 0;
  // Run-level assistant-turn ordinal for the STREAM side: every `delta`/`tool_call`/`tool_result`
  // emitted while step K is streaming is tagged `turnIndex: loopTurn` (= K), and `loopTurn` is bumped
  // on each `finish-step` part (one per AI-SDK step). It is NOT reset between interactive passes, and
  // it advances in lockstep with the accounting sink's per-`llmStep` `turnCounter` (also one per step),
  // so the engine's stream steps and the post-drain `llm_response` step share the same `turnIndex`.
  let loopTurn = 0;
  let streamError: string | undefined;
  let overflowError: string | undefined;
  // F4 — count accounting failures so they are observable rather than silently swallowed. Accounting
  // is non-fatal (a token-counting error must not fail an otherwise-good run), so we DON'T set
  // `streamError`; instead we emit a non-fatal `{type:"error"}` RunEvent + log, and keep a count.
  let accountingErrors = 0;
  // `onStepFinish` is async (it counts lenses); collect the in-flight accounting work so we can await
  // it before settling the run, otherwise a `step`/`kpi` event could land after the terminal status.
  const accountingWork: Promise<void>[] = [];

  // WP 1.5 — budget guardrails config, read EARLY (before the SessionClock below): a configured
  // `guardrails.maxRunDurationMs`, if any, seeds the clock's wall cap. `guardrailsActive`/
  // `guardrailState`/`carry` (used by the `stopWhen` predicate) are declared further down, where
  // they're first read.
  const guardrailCfg = cfg.guardrails ?? {};

  // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US3/D-US7) — the ONE timer engine driving
  // this run's stall / wait-budget / (opt-in) wall-cap timers, replacing the old bespoke idle-timeout
  // racer + hard-coded 30-min deadline. `clockAbort` is the abort signal the clock drives: firing ANY
  // cause (stalled / wait_expired / max_duration) aborts it, which is combined into `effectiveSignal`
  // below so the live `streamText` call (or an interactive wait) is actually cut off when a timer
  // fires. `emitNoted` is the wrapped emit every IN-LOOP event goes through so the stall timer rolls
  // on every emitted event (D-US3); `clock` is declared with `let` (not `const`) so `emitNoted`'s
  // closure — needed by the clock's own `onFire` — can reference it before it's assigned.
  const clockAbort = new AbortController();
  let clock!: SessionClock;
  const emitNoted: EngineEmit = (event, meta) => {
    clock.noteEvent();
    emit(event, meta);
  };
  const configuredMaxDurationMs =
    guardrailCfg.maxRunDurationMs && guardrailCfg.maxRunDurationMs > 0
      ? guardrailCfg.maxRunDurationMs
      : undefined; // D-US3 — no wall cap by default; opt-in only via the guardrail.
  clock = new SessionClock({
    ...(cfg.sessionClockOptions?.stallMs !== undefined
      ? { stallMs: cfg.sessionClockOptions.stallMs }
      : {}),
    ...(cfg.sessionClockOptions?.waitBudgetMs !== undefined
      ? { waitBudgetMs: cfg.sessionClockOptions.waitBudgetMs }
      : {}),
    ...(configuredMaxDurationMs !== undefined ? { maxDurationMs: configuredMaxDurationMs } : {}),
    onFire: () => {
      // Stop ordering (D-US1, "steal from cdesktop"): `SessionClock.fire()` already latched
      // `clock.fired` (the cause + a duration snapshot) BEFORE invoking this callback, so the verdict
      // is fixed before the live stream is ever signaled to stop — an exit racing the abort that's
      // about to propagate can never be reclassified as a generic stream error. Surface the transient
      // "stopping" phase, then actually signal the stop.
      emitNoted({ type: "phase", phase: "stopping" });
      clockAbort.abort();
    },
  });
  cfg.onSessionClockReady?.(clock, clockAbort.signal);
  clock.start();

  const nextStep = (
    type: RunStepType,
    label: string,
    status: RunStep["status"],
    extra: Partial<RunStep>,
  ): RunStep => ({
    id: `${runId}:step:${stepIndex}`,
    runId,
    index: stepIndex++,
    type,
    label,
    status,
    profileTokens: ZERO_PROFILE_TOKENS(cfg.profiles),
    payload: null,
    ...extra,
  });

  /**
   * F6 — emit a `user_message` step carrying the user's text so the operator's own turns are visible
   * in the stream + persisted for replay (previously they were never represented at all). These steps
   * carry no token accounting (`profileTokens: {}`) and flow through the same `nextStep`/manager path,
   * so each gets a monotonic index (F1) and is persisted (the text lands in the redacted `payload`).
   */
  const emitUserMessage = (text: string): void => {
    emitNoted({
      type: "step",
      // A user turn precedes the assistant turn it opens — tag it with the upcoming `loopTurn` so it
      // sits ahead of that turn in the timeline.
      step: nextStep("user_message", "user", "ok", {
        profileTokens: {},
        payload: { text },
        turnIndex: loopTurn,
      }),
    });
  };

  // Unified Sessions (WP1.1/WP1.3, D-US1) — `starting` fires before `running`: the session has just
  // spun up (SessionClock armed). Fires through `emitNoted` like every other in-loop event.
  emitNoted({ type: "phase", phase: "starting" });
  emitNoted({ type: "status", status: "running" });
  // Unified Sessions (WP1.7, D-US1 follow-up) — clear the transient `starting` phase now that the run
  // is ordinarily running: without this, `runs.phase` would linger at `starting` for the rest of the
  // run (there was previously no way to express "no distinct phase" on the wire — see the `RunEvent`
  // `phase` member's doc). Mirrors the SAME clear emitted after each resumed `waiting_input` wait below.
  emitNoted({ type: "phase", phase: null });

  // Tool-loading notice (deferred-requested runs only): surface — as a persisted, replayable
  // `context_event` step — whether deferred tool search is ACTIVE or FELL BACK to eager because the
  // provider/model can't do tool search. Plain eager runs leave `toolLoading` unset and emit nothing.
  if (cfg.toolLoading) {
    const { requested, effective, reason } = cfg.toolLoading;
    const label =
      effective === "deferred"
        ? "tool loading · deferred (Anthropic tool search)"
        : `tool loading · eager (deferred unavailable${reason ? `: ${reason}` : ""})`;
    emitNoted({
      type: "step",
      step: nextStep("context_event", label, "ok", {
        profileTokens: {},
        payload: { toolLoading: { requested, effective, ...(reason ? { reason } : {}) } },
      }),
    });
  }

  // F6 — the OPENER user turn, before the first provider round-trip, so the run starts with the
  // operator's prompt visible in the timeline.
  emitUserMessage(cfg.userPrompt);

  // WP 1.5 — budget guardrails (tool calls / token / context / spend). Enforced by a `stopWhen`
  // predicate that ACCUMULATES over the SDK's settled `steps` (the authoritative, race-free source):
  // it recomputes the cumulative tool-call / token / context / cost totals each time the SDK asks
  // whether to continue, then `check()` names the first crossed budget. Pricing the SAME
  // provider-actual usage the cost KPI uses keeps the spend cap and the reported cost consistent.
  //
  // WP 2.2 — interactive runs span MANY `streamText` passes (one per user turn). Guardrails, cost,
  // and the priced totals ACCUMULATE across passes via the run-level `priorTurns` carry-over so a
  // budget still fires across turns and the run cost is the sum over all turns.
  const guardrailsActive =
    !!guardrailCfg.maxToolCalls ||
    !!guardrailCfg.maxTokens ||
    !!guardrailCfg.maxContextTokens ||
    !!guardrailCfg.maxCostUsd;
  const guardrailState: GuardrailState = initialGuardrailState();
  // Carry-over of settled guardrail totals from prior interactive turns (zero for an automated run).
  const carry: GuardrailState = initialGuardrailState();

  // Unified Sessions (WP1.3) — the live call (and an interactive wait) is cut off by EITHER the user's
  // stop signal OR the SessionClock firing (stalled / wait_expired / max_duration).
  const effectiveSignal = combineSignals(cfg.abortSignal, clockAbort.signal);

  const guardrailStop: StopCondition<ToolSet> = ({ steps: settled }) => {
    // Recompute the accumulator from scratch over all settled steps in THIS pass + the carry-over
    // from prior turns. `contextTokens` is the LATEST step's window (input+output).
    const state = initialGuardrailState();
    state.turns = carry.turns;
    state.toolCalls = carry.toolCalls;
    state.tokens = carry.tokens;
    state.costUsd = carry.costUsd;
    for (const s of settled) {
      const usage = extractProviderUsage(cfg.providerKind ?? "openai", s.usage, s.providerMetadata);
      const stepModel = cfg.modelId ?? s.model.modelId;
      state.turns += 1;
      state.toolCalls += clientToolCallCount(s);
      state.tokens += usage.inputTokens + usage.outputTokens;
      state.contextTokens = usage.inputTokens + usage.outputTokens;
      state.costUsd += estimateCost(stepModel, usage);
    }
    const tripped = check(state, guardrailCfg);
    if (tripped) {
      // Latch the tripped budget + the totals so the engine reports the named reason after settling.
      guardrailState.turns = state.turns;
      guardrailState.toolCalls = state.toolCalls;
      guardrailState.tokens = state.tokens;
      guardrailState.contextTokens = state.contextTokens;
      guardrailState.costUsd = state.costUsd;
      guardrailState.tripped = tripped;
    }
    return tripped !== undefined;
  };

  // `stepCountIs(maxTurns)` keeps the step cap (the default applies when no budgets are set); the
  // budget predicate is added only when at least one budget is configured.
  const stopWhen: StopCondition<ToolSet>[] = guardrailsActive
    ? [stepCountIs(cfg.maxTurns), guardrailStop]
    : [stepCountIs(cfg.maxTurns)];

  // Run-level cumulative cost over ALL turns (the final `kpi` carries this; `RunRepository.finalize`
  // reads it for `runs.cost_usd`). `lastFinishReason` / `hitTurnCap` track the most recent pass.
  let runCostUsd = 0;
  let lastFinishReason: string | undefined;
  let hitTurnCap = false;

  /** Was the run aborted (stop)? An abort wins over every other terminal outcome. */
  const aborted = (): boolean => cfg.abortSignal?.aborted === true;

  /**
   * Run ONE provider round-trip pass (a `streamText` over the shared `messages`). Streams parts as
   * `RunEvent`s, accumulates the run-level counters, and folds the priced totals into `runCostUsd` +
   * the guardrail carry-over for the next pass. Sets `streamError`/`overflowError` on failure.
   */
  const runTurn = async (): Promise<void> => {
    // Track E — real wall-clock per LLM step boundary. The first step of this pass started when the
    // pass began; each subsequent step started at the PRIOR `onStepFinish` boundary. `Date.now()` at
    // each `onStepFinish` is the step's end; the previous boundary is its start (startedAt <= endedAt).
    let priorBoundaryMs = Date.now();
    const result = streamText({
      model: cfg.model,
      system: cfg.system,
      messages,
      tools: cfg.tools,
      stopWhen,
      abortSignal: effectiveSignal,
      // WP3.3 (D-OB18) — a fork's temperature override; guarded by presence so a non-fork run is unchanged.
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
      onStepFinish: (step) => {
        // Per-step accounting seam (WP 1.4): hand the EXACT request + response usage/metadata to the
        // accounting sink, which computes lenses, provider-actual usage, the snapshot, and KPIs. Count
        // provider round-trips as turns for the KPI rail.
        steps += 1;
        // Track E — close THIS step's wall-clock window and roll the boundary forward for the next step.
        const boundaryMs = Date.now();
        const timing: LlmStepTiming = {
          startedAt: new Date(priorBoundaryMs).toISOString(),
          endedAt: new Date(boundaryMs).toISOString(),
        };
        priorBoundaryMs = boundaryMs;
        if (cfg.accounting) {
          // F4 — accounting failure is NON-FATAL but must be OBSERVABLE: never silently swallowed.
          // Surface a non-fatal `error` RunEvent + a structured console.error + a count, but do NOT
          // fail the run (the run still completes; only the per-step lens/snapshot for this step is
          // lost). This catches a throwing OR rejecting `onLlmStep` (the `Promise.resolve(...)` chain).
          accountingWork.push(
            Promise.resolve(cfg.accounting.onLlmStep(step, timing)).catch((error: unknown) => {
              accountingErrors += 1;
              const message = error instanceof Error ? error.message : String(error);
              console.error(`[run ${runId}] accounting step failed (non-fatal): ${message}`);
              emitNoted({ type: "error", message: `Accounting step failed (non-fatal): ${message}` });
            }),
          );
        }
      },
      ...(cfg.providerOptions ? { providerOptions: cfg.providerOptions } : {}),
    });

    // WP 0.4 (T6e) — the `id` of the text content block whose deltas we're currently streaming. A
    // provider can emit MORE THAN ONE text block per step (text · thinking · text; a pre-tool remark
    // then a post-tool remark). The AI SDK's own `StepResult.text` glues those blocks with the empty
    // string, so accumulated live deltas read "Let me begin!Now let me search". When a `text-delta`
    // arrives under a NEW `id` (a second `text-start` in this turn) we prefix a paragraph break so the
    // web's raw delta accumulation ends up with separate paragraphs — deltas WITHIN one block still
    // concatenate raw. Reset per turn on `finish-step` (each step = a new `turnIndex` bucket, so the
    // next turn's first block must not inherit a leading break).
    let activeTextId: string | null = null;
    try {
      for await (const part of result.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
        switch (part.type) {
          case "text-delta": {
            if (part.text) {
              // A different block id than the one we're mid-stream on is a PART boundary → separate the
              // two blocks with a paragraph break. The first block of the turn gets no leading break.
              const boundary = activeTextId !== null && part.id !== activeTextId;
              activeTextId = part.id;
              emitNoted({
                type: "delta",
                channel: "text",
                text: boundary ? `\n\n${part.text}` : part.text,
                turnIndex: loopTurn,
              });
            }
            break;
          }
          case "reasoning-delta": {
            if (part.text)
              emitNoted({ type: "delta", channel: "reasoning", text: part.text, turnIndex: loopTurn });
            break;
          }
          case "tool-call": {
            toolCalls += 1;
            emitNoted({
              type: "step",
              step: nextStep("tool_call", part.toolName, "running", {
                toolName: part.toolName,
                turnIndex: loopTurn,
                payload: { toolCallId: part.toolCallId, args: part.input },
              }),
            });
            break;
          }
          case "tool-result": {
            // An MCP tool that ran but failed resolves with `{ isError: true }` (it is returned to the
            // model, so the SDK surfaces it as a tool-RESULT, not a tool-error). Mark such a step failed.
            const toolLevelError = isMcpErrorResult(part.output);
            emitNoted({
              type: "step",
              step: nextStep("tool_result", part.toolName, toolLevelError ? "error" : "ok", {
                toolName: part.toolName,
                turnIndex: loopTurn,
                payload: { toolCallId: part.toolCallId, result: part.output },
              }),
            });
            break;
          }
          case "tool-error": {
            // A tool that ran but failed (tool-level error). Surface a FAILED step; the run continues.
            emitNoted({
              type: "step",
              step: nextStep("tool_result", part.toolName, "error", {
                toolName: part.toolName,
                turnIndex: loopTurn,
                payload: {
                  toolCallId: part.toolCallId,
                  error: part.error instanceof Error ? part.error.message : String(part.error),
                },
              }),
            });
            break;
          }
          case "finish-step": {
            // One `finish-step` per AI-SDK step — bump the stream-side turn ordinal so the NEXT step's
            // deltas/tool steps are tagged with the next `turnIndex`. Stays in lockstep with the
            // accounting sink's per-`llmStep` `turnCounter`, so a turn's stream steps and its
            // post-drain `llm_response` step share one `turnIndex`.
            loopTurn += 1;
            // WP 0.4 (T6e) — new turn = a fresh `deltasByTurn` bucket; forget the previous turn's text
            // block so the next turn's first block never inherits a leading paragraph break.
            activeTextId = null;
            break;
          }
          case "finish": {
            // Accumulate across turns (each pass reports ITS pass's totalUsage).
            tokensIn += part.totalUsage.inputTokens ?? 0;
            tokensOut += part.totalUsage.outputTokens ?? 0;
            break;
          }
          case "error": {
            // A transport/request failure (e.g. provider error, or a tool's transport error rethrown).
            // An abort (the run was stopped, or the SessionClock fired) is a clean stop, not a fatal
            // error. A provider context-limit error is GROUND-TRUTH overflow (decision #12).
            const message = part.error instanceof Error ? part.error.message : String(part.error);
            if (aborted() || clock.fired) break;
            if (isContextOverflowError(part.error)) {
              overflowError = message;
            } else {
              streamError = message;
              emitNoted({ type: "error", message: streamError });
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (error) {
      // An abort (the run was stopped, or the SessionClock fired) throws out of the stream — swallow
      // it as a clean stop. Some providers throw the context-limit error instead of emitting an
      // `error` part — treat that as ground-truth overflow; otherwise it's a fatal stream error.
      const message = error instanceof Error ? error.message : String(error);
      if (aborted() || clock.fired) {
        // clean stop (user stop or SessionClock fire) — handled by the terminal resolution below
      } else if (isContextOverflowError(error)) {
        overflowError = message;
      } else {
        streamError = message;
        emitNoted({ type: "error", message: streamError });
      }
    }

    // Settle in-flight per-step accounting for THIS pass before the next turn / terminal events so a
    // `step`/`kpi` event never arrives after the terminal `status`.
    if (accountingWork.length > 0) {
      await Promise.all(accountingWork.splice(0));
    }

    // ── Carry conversation history across interactive turns (the canonical AI SDK multi-turn pattern).
    // `streamText` does NOT mutate the input `messages`; the assistant message(s), their tool calls, and
    // the tool-result messages generated across ALL steps of this pass live in `result.responseMessages`
    // (ai v7: "the accumulated response messages of all steps that were generated during the call" — an
    // assistant message potentially containing tool calls plus a tool message with the tool results).
    // NOTE (ai v6 → v7 migration): the old `result.response.messages` now returns only the FINAL step's
    // messages (it is deprecated), so it would drop the tool-call/tool-result history; `responseMessages`
    // is the accumulated transcript. We APPEND them to the shared `messages` so the NEXT interactive
    // turn's `streamText` sees the full transcript. Without this, the next turn is sent only
    // `[opener, …user turns]` — the model loses all memory of its own prior turns/tool results and starts
    // over, and the context window sawtooths (grows within a pass, collapses at each turn boundary)
    // instead of growing monotonically. Guarded: `responseMessages` rejects when the pass produced no
    // output (overflow/fatal/abort) — harmless, the loop ends and there is no next turn. Only needed for
    // interactive runs (automated runs make a single pass).
    if (cfg.interactive) {
      const generated = await Promise.resolve(result.responseMessages).catch(
        () => [] as Awaited<typeof result.responseMessages>,
      );
      messages.push(...generated);
    }

    // Price this pass's settled steps, fold into the run cost + the guardrail carry-over. `result.steps`
    // rejects when the stream produced NO output (overflow/fatal/abort) — tolerate that.
    const settledSteps = await Promise.resolve(result.steps).catch(
      () => [] as Awaited<typeof result.steps>,
    );
    for (const s of settledSteps) {
      const usage = extractProviderUsage(cfg.providerKind ?? "openai", s.usage, s.providerMetadata);
      const stepModel = cfg.modelId ?? s.model.modelId;
      runCostUsd += estimateCost(stepModel, usage);
      carry.turns += 1;
      carry.toolCalls += clientToolCallCount(s);
      carry.tokens += usage.inputTokens + usage.outputTokens;
      carry.contextTokens = usage.inputTokens + usage.outputTokens;
      carry.costUsd += estimateCost(stepModel, usage);
    }

    // Post-settle guardrail backstop: if a budget crossed on the FINAL step (where the model stopped
    // on its own, so the SDK never evaluated `stopWhen` for it), latch it here so the budget still
    // FIRES and names itself. The carry-over already reflects every settled step.
    if (guardrailsActive && !guardrailState.tripped) {
      const tripped = check(carry, guardrailCfg);
      if (tripped) {
        Object.assign(guardrailState, carry, { tripped });
      }
    }

    const finishReason = await Promise.resolve(result.finishReason).catch(() => undefined);
    lastFinishReason = finishReason;
    hitTurnCap = finishReason === "tool-calls" && steps >= cfg.maxTurns;
  };

  // Drive the conversation: the opener turn, then (interactive only) await + replay each follow-up
  // turn until the model is stopped and no more turns arrive, a budget trips, an error/overflow
  // occurs, the SessionClock fires, or the run is aborted.
  await runTurn();
  if (cfg.interactive) {
    while (
      !aborted() &&
      !clock.fired &&
      !streamError &&
      !overflowError &&
      !guardrailState.tripped &&
      !hitTurnCap &&
      lastFinishReason === "stop"
    ) {
      // Unified Sessions (WP1.3, D-US1/D-US3) — bracket the wait for the next user turn: enter
      // `waiting_input` (pauses the stall timer, arms the wait budget — the SAME budget an `ask_user`
      // wait uses) and emit the phase transition with the clock's server-authored deadline.
      clock.enterWaiting();
      emitNoted({
        type: "phase",
        phase: "waiting_input",
        detail: {
          reason: "next_turn",
          ...(clock.deadlineAt ? { deadlineAt: clock.deadlineAt } : {}),
        },
      });
      const next = await awaitNextTurn(cfg.interactive, effectiveSignal);
      // Only resume (re-arm the stall timer + clear the persisted phase) when the run is actually
      // CONTINUING — not when the clock itself just fired (a fired clock already latched its own
      // duration snapshot at the fire instant; resuming afterward would skew it, see SessionClock's
      // own doc on `resumeFromWaiting`). WP1.7 — the clear is now a real `{type:"phase",phase:null}`
      // event through `emitNoted` (the same choke point `waiting_input` was entered through), not the
      // old `cfg.clearPhase` direct-DB-write escape hatch: a fired clock's own terminal path (below)
      // writes its own phase (`stopping`), so skipping the clear there is still correct.
      if (!clock.fired) {
        clock.resumeFromWaiting();
        emitNoted({ type: "phase", phase: null });
      }
      if (next === null || aborted() || clock.fired) break;
      messages.push({ role: "user", content: next });
      // F6 — represent each interactive follow-up turn in the stream BEFORE its provider round-trip.
      emitUserMessage(next);
      await runTurn();
    }
  }

  // F4 — if any per-step accounting failed, log a run-level summary so the count is observable in the
  // server logs (each failure also emitted a non-fatal `error` RunEvent above). Never fails the run.
  if (accountingErrors > 0) {
    console.error(`[run ${runId}] ${accountingErrors} accounting step(s) failed (non-fatal).`);
  }

  // F3 — single KPI source. When accounting is wired (production + most tests), the FINAL kpi reads
  // the accounting sink's rolled-up totals so KPI "Turns" == the number of settled `llm_response`
  // steps == the context chart's columns, by construction. `tokensIn/out`, `costUsd`, and the context
  // total come from the SAME accounting accumulator the per-step kpis use, so the live and final kpi
  // agree. We fall back to the engine's own counters ONLY when no accounting is present (tests inject
  // runs without it). The engine's own `steps`/`tokensIn`/`tokensOut`/`runCostUsd` remain the source
  // for the returned LoopResult so its meaning (per-pass round-trips) is unchanged.
  const acctKpis = cfg.accounting?.getRunKpis();
  const turns = acctKpis ? Math.max(acctKpis.turns, 1) : Math.max(steps, 1);
  const kpiToolCalls = acctKpis ? acctKpis.toolCalls : toolCalls;
  const kpiTokensIn = acctKpis ? acctKpis.tokensIn : tokensIn;
  const kpiTokensOut = acctKpis ? acctKpis.tokensOut : tokensOut;
  const kpiContextTokens = acctKpis ? acctKpis.peakContextTokens : tokensIn + tokensOut;
  const kpiCostUsd = acctKpis ? acctKpis.costUsd : runCostUsd;

  emit({
    type: "kpi",
    turns,
    toolCalls: kpiToolCalls,
    tokensIn: kpiTokensIn,
    tokensOut: kpiTokensOut,
    contextTokens: kpiContextTokens,
    costUsd: kpiCostUsd,
    // RM-33 — the cache composition of `tokensIn` (which stays GROSS above). This is the FINAL kpi,
    // the one `RunRepository.finalize` persists the run row from, so without it the split would reach
    // the live console and then be dropped on the way to the database.
    ...(cfg.accounting?.cacheKpiFields?.() ?? {}),
  });

  /**
   * Unified Sessions (WP1.3) — the ONE terminal-emit path every ending below routes through: stops the
   * clock (freezing its `activeDurationMs`/`totalDurationMs` getters at this instant), builds the
   * `meta` duration side-channel `RunManager.emit` threads to `RunRepository.finalize`, and emits the
   * terminal `status` (with the optional machine-readable `stopReasonCode`). `turns`/`toolCalls`/
   * `tokensIn`/`tokensOut` close over the engine's own raw counters — unchanged meaning, the per-pass
   * round-trip totals `LoopResult` has always reported (NOT the accounting-derived `kpi` totals above).
   */
  const emitTerminal = (
    status: RunStatus,
    outcome: RunOutcome,
    stopReason?: string,
    stopReasonCode?: StopReasonCode,
  ): LoopResult => {
    clock.stop();
    const meta: RunEmitMeta = {
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
    };
    const terminal: LoopResult = {
      status,
      outcome,
      ...(stopReason ? { stopReason } : {}),
      turns,
      toolCalls,
      tokensIn,
      tokensOut,
    };
    emit(
      {
        type: "status",
        status,
        outcome,
        ...(stopReason ? { stopReason } : {}),
        ...(stopReasonCode ? { stopReasonCode } : {}),
      },
      meta,
    );
    return terminal;
  };

  // WP 2.2 — an abort (the run was stopped) is the terminal outcome and WINS over every other path.
  if (aborted()) {
    const verdict = terminalFor("user_stop");
    return emitTerminal(verdict.status, verdict.outcome, "Run aborted by user", verdict.stopReasonCode);
  }

  // Unified Sessions (WP1.3, D-US3) — the SessionClock fired (stalled / wait_expired / max_duration):
  // route the latched cause through the SAME `terminalFor` table every executor uses. Read the getter
  // ONCE into a local so TS can narrow the destructure below (a getter isn't narrowed automatically).
  const firedEvent = clock.fired;
  if (firedEvent) {
    const verdict = terminalFor(firedEvent.cause);
    const stopReason =
      firedEvent.cause === "max_duration"
        ? `SessionClock max duration (${configuredMaxDurationMs}ms) reached`
        : firedEvent.cause === "stalled"
          ? "SessionClock stall detected — no events for the stall window while running"
          : "SessionClock wait budget exhausted awaiting the operator";
    return emitTerminal(verdict.status, verdict.outcome, stopReason, verdict.stopReasonCode);
  }

  // Provider context-limit overflow (decision #12 — no app-side intervention): emit a `context_event`
  // step + a terminal `status` with `outcome: "context_overflow"`, persisted as a legitimate result.
  // This is checked BEFORE the generic error path so a real overflow is never misreported as `error`.
  if (overflowError) {
    cfg.accounting?.onOverflow(overflowError);
    const verdict = terminalFor("context_overflow");
    return emitTerminal(verdict.status, verdict.outcome, overflowError, verdict.stopReasonCode);
  }

  // A fatal MCP transport failure during a tool call fails the run (the SDK keeps looping after a
  // thrown execute, so we fail it explicitly here). A stream-level error does the same.
  const transportError = cfg.getTransportError?.();
  const fatal = streamError ?? transportError;
  if (fatal) {
    // A fatal MCP transport error may be an expired OAuth token mid-run; flag it so the console can
    // offer reauth (the web derives the servers from the scenario allow-list). Only the transport
    // path is reauth-relevant — a stream/provider error already emitted its own `error` event.
    if (!streamError) {
      const authRequired = transportError ? isAuthRequiredError(transportError) : false;
      emit({ type: "error", message: fatal, ...(authRequired ? { authRequired: true } : {}) });
    }
    // Unified Sessions (WP1.3) — classify the fatal error into its machine-readable cause: a 401/403
    // wins as the more specific auth signal, then a conservative 429/rate-limit match, else the
    // generic provider/transport error.
    const cause: TerminalCause = isAuthRequiredError(fatal)
      ? "auth"
      : isRateLimitError(fatal)
        ? "rate_limit"
        : "provider_error";
    const verdict = terminalFor(cause);
    return emitTerminal(verdict.status, verdict.outcome, fatal, verdict.stopReasonCode);
  }

  // Natural completion vs a guardrail stop. A budget guardrail (tool calls / token / context / spend)
  // that tripped names ITSELF in `stop_reason`; the step cap (`maxTurns`) is reported the same way; a
  // model-driven stop is a clean completion.
  if (guardrailState.tripped) {
    const causeForTrip = GUARDRAIL_TRIP_CAUSES[guardrailState.tripped];
    // `stop_reason` is the named key so the UI + `runs.stop_reason` surface exactly which limit fired
    // (decision #11). Every meter `check()` can actually trip (`maxToolCalls`/`maxTokens`/
    // `maxContextTokens`/`maxCostUsd`) has a `GUARDRAIL_TRIP_CAUSES` entry as of WP1.7, so `causeForTrip`
    // is always defined in practice; the fallback stays as a defensive, non-code guardrail-stop shape in
    // case a future meter is added to `GuardrailState["tripped"]` before its own `TerminalCause` lands.
    const verdict: { status: RunStatus; outcome: RunOutcome; stopReasonCode?: StopReasonCode } =
      causeForTrip ? terminalFor(causeForTrip) : { status: "stopped", outcome: "stopped_guardrail" };
    return emitTerminal(
      verdict.status,
      verdict.outcome,
      guardrailState.tripped,
      verdict.stopReasonCode,
    );
  }
  if (hitTurnCap) {
    const verdict = terminalFor("max_turns");
    return emitTerminal(
      verdict.status,
      verdict.outcome,
      `maxTurns (${cfg.maxTurns}) reached`,
      verdict.stopReasonCode,
    );
  }
  return emitTerminal("completed", "completed");
}

// Re-export the AI SDK Tool/ToolSet aliases so the run service can type its tools map without
// importing from `ai` directly in two places.
export type { Tool, ToolSet };
