import type {
  AnswersAnswerBlock,
  AnswersSnapshot,
  AnswersSource,
  AnswersStepPayload,
  RunEvent,
  RunStep,
  RunStepType,
  SessionAssistantIdentity,
  SessionCapabilities,
  TokenProfileRef,
} from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { resolveQlikAnswersAppContext } from "../providers/model-catalog.js";
import { estimateRequestCost } from "../providers/pricing.js";
import { getTokenCounter } from "../token-counting/profiles.js";
import type { EngineEmit, InteractiveTurns, LoopResult } from "./engine.js";
import { extractAnswerMessage, findMessageById } from "./qlik-answers-message.js";
import { parseReasoningSections } from "./qlik-answers-reasoning.js";
import {
  QlikAnswersSseParser,
  QlikReasoningCleaner,
  type QlikStreamChunk,
} from "./qlik-answers-sse.js";
import type { RunEmitMeta } from "./run-manager.js";
import {
  QLIK_ANSWERS_SESSION_CAPABILITIES,
  QLIK_ANSWERS_WAIT_BUDGET_MS,
  withAssistantIdentity,
} from "./session-capabilities.js";
import {
  DEFAULT_STALL_MS,
  SessionClock,
  type SessionClockCause,
  type SessionClockTime,
} from "./session-clock.js";
import { terminalFor, type TerminalCause } from "./session-terminal.js";

/**
 * Qlik Answers run executor (roadmap/qlik-answers/ — Phase 1 built, **Phase 4 cloud-assistants rework**
 * 2026-07-11; **Unified Sessions WP1.5** 2026-07-16). Qlik Answers is a RAG **product** API, not a
 * chat-completions API, so it never runs through the AI-SDK `LanguageModel` loop in
 * {@link import("./engine.js").runAgentLoop}. This is the sibling executor the run service branches to
 * (WP 1.2) for `qlik_answers` credentials. It emits EXACTLY the same
 * {@link import("@mcp-token-footprint/shared").RunEvent} vocabulary as the engine, so run persistence,
 * the SSE console, replay, reports, grading, suites and Compare all work unchanged.
 *
 * **Unified Sessions (roadmap/unified-sessions/, WP1.5).** This executor previously hand-rolled its own
 * `createDeadline` wall-clock guard, which conflated a duration-cap trip with a genuine user stop into
 * the SAME `outcome: "aborted"` (the bug: a long-running Qlik session that hit the (always-on, 30-min
 * default) wall clock silently reported as "Stopped by you"). It now drives ONE {@link SessionClock}
 * (shared with every other run backend) whose default guard is the STALL detector, not a wall cap —
 * `maxRunDurationMs` is opt-in (D-US3) — and every terminal (`user_stop`/`stalled`/`max_duration`/
 * `wait_expired`/`prompt_rejected`/`rate_limit`/`provider_error`) is produced by the ONE shared
 * {@link terminalFor} table, so the SAME cause yields the SAME `{status, outcome, stopReasonCode}`
 * triple this workstream guarantees across every backend. Interactive turn waits are bracketed with
 * `clock.enterWaiting()`/`resumeFromWaiting()` and surfaced as a `{type:"phase", phase:"waiting_input"}`
 * event carrying the server-authored wait deadline (Qlik's longer 30-min default, D-US7). See
 * {@link QlikAnswersEmit} for how duration accounting reaches persistence, and
 * {@link QlikAnswersRunConfig.onCapabilities} for how the enriched capability manifest does.
 *
 * **The cloud-assistants execution path (Phase 4).** Live testing on a real tenant proved the original
 * `/api/v1/assistants/{aid}/threads/{tid}/actions/{invoke,stream}` path binds NO data source for an
 * **app**-backed assistant → it answers "I don't have any information", zero sources. The real path
 * (mirrored from the customer's `call_answers.py`) binds a Qlik Sense **app** as the data context:
 *   1. resolve the assistant UUID → its bound **app id** ({@link resolveQlikAnswersAppContext}, cached);
 *   2. `POST /api/v1/cloud-assistants/threads` with `context:{type:"app", id: appId, data:{mode:"live"}}`;
 *   3. `POST /api/v1/cloud-assistants/{threadId}/actions/stream` with `{context, content:[{text}]}`
 *      (SSE/NDJSON) → collect the last `messageId` (and, for the `stream` transport, live `delta` text);
 *   4. `GET /api/v1/cloud-assistants/threads/{threadId}/messages` → the message with that id → extract
 *      the answer (Adaptive-Card body, "Conclusion" TextBlock) + the `qMeasures[].qDef.qDef` expressions
 *      ({@link extractAnswerMessage}). The answer + expressions + the raw message go in the step payload.
 *
 * Structural invariants (locked in the plan):
 *   - **Clean session:** this executor NEVER opens an MCP session, tool bridge, or skill context — no
 *     session opener exists here; it emits `toolCalls: 0` with NO `tool_call` steps (`tool_hygiene`
 *     reads `unevaluable`).
 *   - **No real tenant, ever, in tests:** all tenant HTTP (resolution + thread + stream + messages) goes
 *     through the injectable {@link QlikAnswersRunConfig.fetchImpl}; tests inject a stub.
 *   - **Estimated tokens:** the API reports no token usage, so every token figure is OUR estimate (the
 *     run's primary {@link TokenCounter} profile over the prompt / answer text), flagged
 *     `estimatedTokens: true` in the payload.
 *   - **Questions are the cost unit (D-QA5):** each prompt consumes 1 question; `costUsd` =
 *     `questionsConsumed × perRequestPrice` (0 when unpriced — never a run-blocker).
 *   - **Rate-limit retry (WP 1.5 legacy — qlik-answers roadmap):** every tenant fetch (thread, stream,
 *     messages) goes through {@link requestWithRetry} — retries ONLY on HTTP 429 or an `AE-6` body code,
 *     exponential backoff + jitter, bounded attempts, never past the run's deadline/abort. A retry that
 *     eventually succeeds still consumes exactly 1 question (the failed attempts are never counted). Once
 *     retries are EXHAUSTED, the persistent failure now maps to the unified-sessions `rate_limit` cause
 *     (see {@link classifyFailureCause}).
 *
 * **Transport (D-QA3/D-QA2 revised).** The cloud-assistants prompt API is stream-shaped; there is no
 * verified synchronous endpoint. Both `transport` values POST to `actions/stream`: `stream` (default)
 * emits live `delta` events as SSE frames arrive; `invoke` awaits the full stream without live deltas.
 * The old `promptType` axis is GONE (the cloud-assistants body has no `promptType` — thread continuity is
 * the kept thread itself); the opener/follow-up distinction survives only as the payload `promptMode`.
 */

/** Which console behavior the prompt runs with: live `stream` deltas, or a blocking `invoke` (no deltas). */
export type QlikAnswersTransport = "invoke" | "stream";

/**
 * Unified Sessions (WP1.5) — this executor's emit channel: a STRICT SUPERSET of the plain `EngineEmit`
 * (`(event: RunEvent) => void`) that optionally accepts the SessionClock-derived {@link RunEmitMeta}
 * duration side-channel on the terminal `status` emit — exactly the shape `RunManager.emit`'s own third
 * parameter already carries (WP1.6). WP1.7 completed the coordination note this type's WP1.5 doc used to
 * flag: `run-service.ts`'s qlik dispatch lambda now forwards the second argument
 * (`(event, meta) => this.runManager.emit(runId, event, meta)`), so durations reach persistence via the
 * normal `RunManager.emit` → `RunRepository.finalize` path, the same way the AI-SDK engine path's do.
 */
export type QlikAnswersEmit = (event: RunEvent, meta?: RunEmitMeta) => void;

/**
 * The CLEAN input the run service (WP 1.2) resolves and hands to {@link runQlikAnswers}. It is a
 * dedicated shape — NOT the AI-SDK {@link import("./engine.js").EngineConfig} — because a Qlik Answers
 * run has no `LanguageModel`, no tools, and no accounting sink. WP 1.2 must satisfy every field below.
 */
export type QlikAnswersRunConfig = {
  /** The tenant assistant this run targets — the run's "model" (`scenario.model`). Resolved → an app id. */
  assistantId: string;
  /** The user's prompt for this run (`test.userPrompt`). Sent verbatim as the cloud-assistants input. */
  prompt: string;
  /**
   * Resolved Qlik Cloud tenant auth from the `qlik_answers` `DecryptedCredential` (WP 0.2 resolves this
   * from an own API key OR a linked MCP server's OAuth/header bearer, transparently):
   *   - `apiKey`  — the bearer token (`Authorization: Bearer <apiKey>`).
   *   - `baseUrl` — the tenant origin (`https://<tenant>[.<region>].qlikcloud.com`).
   */
  auth: { apiKey: string; baseUrl: string };
  /**
   * Effective token profiles for the run (`scenario.defaultProfiles ∪ test.addedProfiles`). The FIRST
   * profile is the primary — its counter estimates the single-valued KPI `tokensIn`/`tokensOut`. Empty
   * falls back to {@link DEFAULT_TOKEN_PROFILE}.
   */
  profiles: TokenProfileRef[];
  /**
   * Console transport for the prompt (from `answersMode.transport`, WP 1.2). Both hit `actions/stream`;
   * `stream` emits live deltas, `invoke` does not. Defaults to `invoke` here — the run service decides
   * the per-run default (D-QA2: `stream`).
   */
  transport?: QlikAnswersTransport;
  /**
   * Unified Sessions (WP1.5, D-US3) — an OPT-IN hard wall cap (ms) on the SessionClock. UNSET (the
   * default) means NO wall cap: the run is bounded only by the stall detector
   * ({@link QlikAnswersRunConfig.stallMs}) and, while `waiting_input`, the wait budget
   * ({@link QlikAnswersRunConfig.waitBudgetMs}). When set, exceeding it fires `max_duration` →
   * `terminalFor("max_duration")` → `stopped`/`stopped_guardrail` (NEVER `aborted` — that terminal is
   * reserved for an actual user stop, the bug this WP fixes). A `<= 0` value is treated as unset.
   */
  maxRunDurationMs?: number;
  /**
   * Unified Sessions (WP1.5, D-US3) — override the SessionClock's stall-detector window (ms): no event
   * emitted for this long while actively running fires `stalled`. Omitted → {@link DEFAULT_STALL_MS}
   * (10 min, the shared app default). Tests use a tiny value to exercise `stalled` deterministically
   * with real timers (mirrors the existing `maxRunDurationMs` test convention — no fake-timer harness
   * needed here).
   */
  stallMs?: number;
  /**
   * Unified Sessions (WP1.5, D-US7) — override the SessionClock's wait budget (ms), armed while
   * `waiting_input` between interactive turns. Omitted → {@link QLIK_ANSWERS_WAIT_BUDGET_MS} (Qlik's
   * longer 30-min default — the thread survives regardless of how long the operator takes, D-US7).
   */
  waitBudgetMs?: number;
  /** Cooperative abort signal (user stop). Aborting → `outcome: "aborted"`. */
  abortSignal?: AbortSignal;
  /**
   * Injectable fetch — ALL tenant HTTP goes through this. Defaults to the global `fetch`; tests inject a
   * stub so NO real tenant is ever contacted. (Mirrors the `FetchLike` seam in `model-catalog.ts`.)
   */
  fetchImpl?: typeof fetch;
  /**
   * WP 1.5 (qlik-answers roadmap) — injectable backoff delay for the 429/`AE-6` rate-limit retry (see
   * {@link requestWithRetry}). Defaults to a real timer that resolves EARLY the moment `signal` aborts.
   * Tests inject a fast/instant stub so a "retries then succeeds" test never actually waits out the
   * real backoff.
   */
  retrySleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * WP 1.5 (qlik-answers roadmap) — injectable jitter source (expected range `[0, 1)`) for the backoff
   * calculation. Defaults to `Math.random`; tests inject a fixed value for determinism.
   */
  retryRandom?: () => number;
  /**
   * Unified Sessions (WP1.5, D-US4) — receives this run's {@link SessionCapabilities} manifest: the
   * static Qlik baseline ({@link QLIK_ANSWERS_SESSION_CAPABILITIES}) enriched with the per-run
   * {@link SessionAssistantIdentity} card as the executor discovers it (assistantId/transport are known
   * immediately; `appId` once resolved; `version` once the first response `Etag` is read). Called more
   * than once as the identity fills in — every call is a full, valid manifest (last write wins).
   *
   * WP1.7 wired this to `RunRepository.setCapabilities(runId, capabilities)` in `run-service.ts`
   * (`resolveAnswers()` now takes `runId` and sets this callback), so the manifest is persisted and
   * queryable via `GET /api/runs/:id` from the moment each enrichment lands. Left unset only by a
   * caller/test that doesn't need persistence — the manifest is still computed either way.
   */
  onCapabilities?: (capabilities: SessionCapabilities) => void;
};

/** The successful-answer shape the prompt flow normalizes to before the shared emit logic. */
type AnswerResult = {
  /** The assistant's full answer text (from the message card) — graders read exactly this. */
  output: string;
  /** Document citations, when a document-backed assistant returned them (app assistants: `[]`). */
  sources: AnswersSource[];
  /** The response `Etag` header = the assistant's version at answer time (drift signal). */
  assistantVersion?: string;
  /** The Qlik Sense app id bound as the run's data context. */
  appId: string;
  /** The cloud-assistants message id that carried this answer. */
  messageId?: string;
  /** The data expressions the assistant computed (`qMeasures[].qDef.qDef`) — the app-assistant evidence. */
  expressions: string[];
  /** The assistant's shown reasoning (card TextBlocks before "Conclusion"), when present. */
  reasoning?: string;
  /** The `Qlik.Snapshot` insights (supporting charts + reason/measures/dimensions). */
  snapshots: AnswersSnapshot[];
  /** The ordered card-body answer sequence (Phase 5, D-QA8) — text blocks interleaved with snapshot refs. */
  blocks?: AnswersAnswerBlock[];
  /** The full official cloud-assistants message object (lossless capture). */
  rawResponse?: unknown;
};

/** What the `actions/stream` call yields before the answer message is fetched. */
type StreamOutcome = {
  /** The last `messageId` observed across the stream (the answer message's id). */
  messageId?: string;
  /** The concatenated main-answer text streamed into the card body (a fallback if the message fetch is empty). */
  streamedText: string;
  /** The full agent-process text streamed into the reasoning stepper (plan, tool/search findings, answer composition). */
  reasoning: string;
  /** The response `Etag`. */
  assistantVersion?: string;
};

/**
 * A Qlik Answers API error carrying the `AE-x` code (research doc §2.2 error family) when the response
 * body exposed one, plus the raw HTTP status (Unified Sessions WP1.5 — used to classify a persistent
 * 429 as `rate_limit` even when the body carries no `AE-6` code). `AE-4` ("Prompt is rejected") is the
 * assistant's own guardrail declining the prompt — mapped downstream to a DISTINCT terminal
 * (`stopReasonCode: "prompt_rejected"`), never a generic error. Every other code maps to
 * `outcome: "error"` with the code in the message (now carrying `stopReasonCode: "provider_error"`,
 * or `"rate_limit"` for an exhausted-retry 429/AE-6 — see {@link classifyFailureCause}).
 */
class QlikAnswersApiError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
    readonly phase: "thread" | "stream" | "messages",
    readonly assistantVersion?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "QlikAnswersApiError";
  }
}

function qaDebug(label: string, data: unknown): void {
  if (process.env.QLIK_ANSWERS_DEBUG) {
    try {
      console.error(`[QA-DEBUG ${label}]`, JSON.stringify(data ?? null).slice(0, 20000));
    } catch {
      console.error(`[QA-DEBUG ${label}] <unserializable>`);
    }
  }
}

// ── Unified Sessions (WP1.5) — SessionClock wiring shared by both the one-shot and interactive runs ──

/**
 * A REAL (non-unref'd) time source for this executor's {@link SessionClock}, used INSTEAD OF the shared
 * `REAL_SESSION_CLOCK_TIME` (session-clock.ts) default. That default `.unref()`s every scheduled timer,
 * which is safe when other I/O keeps the event loop alive — but THIS executor's only in-flight work is
 * the tenant `fetch`, and in tests (and in a slow/idle process) that can be a bare `Promise` with no
 * underlying socket ref. An unref'd stall/wait/cap timer could then silently never fire once the loop
 * looks "empty", exactly the failure mode the original hand-rolled `createDeadline` timer's own "NOT
 * unref'd" comment called out (superseded by this module, WP1.5). `clock.stop()` runs on EVERY terminal
 * path and clears every pending timer, so a ref'd timer here never outlives a run or blocks a real
 * process's shutdown — the app's own HTTP listener already keeps the process alive regardless.
 */
const QLIK_SESSION_CLOCK_TIME: SessionClockTime = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * Bridge an external user {@link AbortSignal} into an internal {@link AbortController}, so a user stop
 * and a {@link SessionClock} fire (stall / opt-in wall cap / wait-budget) share ONE signal threaded to
 * every tenant fetch. Returns a cleanup that detaches the listener; safe to call more than once.
 */
function bridgeUserAbort(userSignal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!userSignal) return () => undefined;
  if (userSignal.aborted) {
    controller.abort();
    return () => undefined;
  }
  const forward = () => controller.abort();
  userSignal.addEventListener("abort", forward, { once: true });
  return () => userSignal.removeEventListener("abort", forward);
}

/**
 * WHY this run is ending, resolved AFTER the SessionClock has settled (`clock.stop()` already called):
 *   - `user_stop`  — the OPERATOR's own {@link AbortSignal} fired (checked FIRST — an explicit human
 *     action is authoritative even if the clock also happened to fire around the same instant).
 *   - `clock`      — the {@link SessionClock} itself fired (`stalled` / `wait_expired` / `max_duration`).
 *   - `api`        — neither of the above: a tenant/transport failure, classified by
 *     {@link classifyFailureCause} (`prompt_rejected` / `rate_limit` / `provider_error`).
 */
type RunEndCause =
  | { kind: "user_stop" }
  | { kind: "clock"; cause: SessionClockCause }
  | { kind: "api"; cause: "prompt_rejected" | "rate_limit" | "provider_error" };

/**
 * Classify a caught tenant failure — reached only once the user-stop/SessionClock checks above already
 * ruled out an abort-shaped error. AE-4 is its own guardrail stop; a 429 or an `AE-6` body code (WP1.5
 * legacy retry loop already tried and exhausted its attempts) is `rate_limit`; every other AE-x code, a
 * thread/resolution failure, or a network/transport error keeps the EXISTING `outcome: "error"` intent
 * (D-US1's `terminalFor` table) — `provider_error`.
 */
function classifyFailureCause(
  error: unknown,
): Extract<TerminalCause, "prompt_rejected" | "rate_limit" | "provider_error"> {
  if (error instanceof QlikAnswersApiError) {
    if (error.code === "AE-4") return "prompt_rejected";
    if (error.code === "AE-6" || error.httpStatus === 429) return "rate_limit";
  }
  return "provider_error";
}

/** Resolve the {@link RunEndCause} once the run has settled (SessionClock stopped). */
function resolveEndCause(
  abortSignal: AbortSignal | undefined,
  clock: SessionClock,
  error: unknown,
): RunEndCause {
  if (abortSignal?.aborted === true) return { kind: "user_stop" };
  if (clock.fired) return { kind: "clock", cause: clock.fired.cause };
  return { kind: "api", cause: classifyFailureCause(error) };
}

/** The {@link TerminalCause} a {@link RunEndCause} maps to — 1:1 for every branch. */
function terminalCauseFor(cause: RunEndCause): TerminalCause {
  return cause.kind === "user_stop" ? "user_stop" : cause.cause;
}

/** The human-readable `stopReason` text for a {@link RunEndCause} (the `stopReasonCode` machine
 *  counterpart comes from {@link terminalFor} separately). `prompt_rejected` is handled by its own
 *  bespoke branch at each call site (it also needs a special `llm_response` step) and never reaches
 *  here. */
function humanStopReason(
  cause: RunEndCause,
  ctx: { maxRunDurationMs: number | undefined; stallMs: number; waitBudgetMs: number },
  error: unknown,
): string {
  if (cause.kind === "user_stop") return "Run aborted by user";
  if (cause.kind === "clock") {
    // Switch on a plain local (not `cause.cause` directly) — narrowing the LOCAL to `never` in the
    // exhaustiveness guard below, rather than the discriminated-union property access, keeps TS from
    // cascading the never-narrowing back onto `cause` itself.
    const clockCause = cause.cause;
    switch (clockCause) {
      case "max_duration":
        return `maxRunDurationMs (${ctx.maxRunDurationMs}ms) reached`;
      case "stalled":
        return `No activity for ${ctx.stallMs}ms — the session appears stalled`;
      case "wait_expired":
        return `Wait budget of ${ctx.waitBudgetMs}ms exhausted waiting for the next turn`;
      default: {
        // Exhaustiveness guard — SessionClockCause has exactly these 3 members.
        const unreachable: never = clockCause;
        throw new Error(`unhandled SessionClock cause: ${String(unreachable)}`);
      }
    }
  }
  // `api` cause, never `prompt_rejected` here (handled by its own branch before this is called).
  return errorMessage(error);
}

/** The per-run {@link SessionAssistantIdentity} card, as much of it as is known so far. */
function assistantIdentity(
  cfg: Pick<QlikAnswersRunConfig, "assistantId" | "transport">,
  appId?: string,
  version?: string,
): SessionAssistantIdentity {
  return {
    kind: "qlik_assistant",
    assistantId: cfg.assistantId,
    transport: cfg.transport ?? "invoke",
    ...(appId ? { appId } : {}),
    ...(version ? { version } : {}),
  };
}

/**
 * Report this run's enriched {@link SessionCapabilities} manifest via
 * {@link QlikAnswersRunConfig.onCapabilities}, when wired. A no-op when the callback is unset (every
 * caller today — see the field's doc). Safe to call more than once as the identity fills in.
 */
function reportCapabilities(
  cfg: Pick<QlikAnswersRunConfig, "assistantId" | "transport" | "onCapabilities">,
  appId?: string,
  version?: string,
): void {
  cfg.onCapabilities?.(
    withAssistantIdentity(QLIK_ANSWERS_SESSION_CAPABILITIES, assistantIdentity(cfg, appId, version)),
  );
}

/**
 * Run one Qlik Answers prompt as a run: resolve the bound app → create a (kept) named thread → stream the
 * prompt → fetch the answer message → emit the standard RunEvent vocabulary → one terminal status.
 * Mirrors {@link import("./engine.js").runAgentLoop}'s emit discipline and contract.
 */
export async function runQlikAnswers(
  runId: string,
  cfg: QlikAnswersRunConfig,
  emit: QlikAnswersEmit,
): Promise<LoopResult> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const transport: QlikAnswersTransport = cfg.transport ?? "invoke";
  const counter = getTokenCounter(cfg.profiles[0] ?? DEFAULT_TOKEN_PROFILE);
  const resolvedStallMs = cfg.stallMs ?? DEFAULT_STALL_MS;
  const resolvedWaitBudgetMs = cfg.waitBudgetMs ?? QLIK_ANSWERS_WAIT_BUDGET_MS;

  // Every token figure is OUR estimate — the API reports no usage. `tokensIn` = the prompt; computed up
  // front because the prompt is sent on every path (success, rejection, or error).
  const tokensIn = await counter.countText(cfg.prompt);

  let stepIndex = 0;
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
    profileTokens: {},
    payload: null,
    ...extra,
  });

  // Unified Sessions (WP1.5) — ONE SessionClock drives this run: the stall detector by DEFAULT, the
  // wall cap only when `cfg.maxRunDurationMs` is explicitly set (D-US3). `onFire` aborts the SAME
  // internal controller a user stop is bridged into, so the in-flight fetch is cut off either way and
  // `resolveEndCause` below (reading `clock.fired` vs `cfg.abortSignal`) tells them apart — the fix for
  // the deadline-vs-user-stop conflation bug.
  const controller = new AbortController();
  const clock = new SessionClock({
    stallMs: cfg.stallMs,
    waitBudgetMs: resolvedWaitBudgetMs,
    ...(cfg.maxRunDurationMs !== undefined && cfg.maxRunDurationMs > 0
      ? { maxDurationMs: cfg.maxRunDurationMs }
      : {}),
    onFire: () => controller.abort(),
    time: QLIK_SESSION_CLOCK_TIME,
  });
  const cleanupAbortBridge = bridgeUserAbort(cfg.abortSignal, controller);
  clock.start();
  // Roll the stall timer on every event this run emits (D-US3: "rolled by every emitted event").
  const noted = (event: RunEvent): void => {
    clock.noteEvent();
    emit(event);
  };

  noted({ type: "status", status: "running" });
  // The opener user turn — the operator's prompt is visible in the timeline (mirrors the engine's F6).
  noted({
    type: "step",
    step: nextStep("user_message", "user", "ok", { payload: { text: cfg.prompt }, turnIndex: 0 }),
  });
  reportCapabilities(cfg); // base manifest — assistantId/transport are known immediately

  let threadId: string | undefined;
  let appId: string | undefined;
  try {
    appId = await resolveQlikAnswersAppContext(cfg.auth, cfg.assistantId, fetchImpl);
    reportCapabilities(cfg, appId);
    threadId = await createThread(runId, fetchImpl, cfg, appId, controller.signal);
    const answer = await performPrompt(transport, fetchImpl, cfg, appId, threadId, controller.signal, noted, 0);

    cleanupAbortBridge();
    clock.stop();
    reportCapabilities(cfg, appId, answer.assistantVersion);
    const durationsMeta: RunEmitMeta = {
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
    };

    // ── Success: one `llm_response` step carrying the full answer + the Answers payload, then KPIs.
    const tokensOut = await counter.countText(answer.output);
    const questionsConsumed = 1;
    const costUsd = estimateRequestCost(cfg.assistantId, questionsConsumed);
    emit({
      type: "step",
      step: nextStep("llm_response", "answer", "ok", {
        assistantText: answer.output,
        // The streamed agent process (plan + tool/search findings + composition) — the console's
        // `Reasoning` disclosure reads this on replay; live, the reasoning `delta`s already built it up.
        ...(answer.reasoning ? { reasoningText: answer.reasoning } : {}),
        turnIndex: 0,
        payload: successPayload(answer, threadId, "oneshot", questionsConsumed),
      }),
    });
    emit({ type: "kpi", turns: 1, toolCalls: 0, tokensIn, tokensOut, contextTokens: 0, costUsd });
    emit({ type: "status", status: "completed", outcome: "completed" }, durationsMeta);
    return {
      status: "completed",
      outcome: "completed",
      turns: 1,
      toolCalls: 0,
      tokensIn,
      tokensOut,
    };
  } catch (error) {
    cleanupAbortBridge();
    clock.stop();
    const durationsMeta: RunEmitMeta = {
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
    };
    const cause = resolveEndCause(cfg.abortSignal, clock, error);

    // ── AE-4 "Prompt is rejected" → a DISTINCT terminal, not a generic error. The assistant's OWN
    // guardrail declined the prompt: a legitimate, replayable, gradeable STOP (`terminalFor("prompt_
    // rejected")` — `status: "stopped"` + `outcome: "stopped_guardrail"` + `stopReasonCode:
    // "prompt_rejected"` + `rejected: true`).
    if (cause.kind === "api" && cause.cause === "prompt_rejected") {
      const err = error as QlikAnswersApiError;
      const questionsConsumed = 1; // the assistant evaluated the prompt through its guardrail.
      const costUsd = estimateRequestCost(cfg.assistantId, questionsConsumed);
      const payload: AnswersStepPayload = {
        sources: [],
        ...(err.assistantVersion ? { assistantVersion: err.assistantVersion } : {}),
        ...(threadId ? { threadId } : {}),
        ...(appId ? { appId } : {}),
        promptMode: "oneshot",
        rejected: true,
        estimatedTokens: true,
        questionsConsumed,
      };
      emit({
        type: "step",
        // No answer text on a rejection — `assistantText` stays empty so graders read no answer
        // (`finalAssistantText` → "" → `unevaluable`), the honest verdict for a rejected prompt.
        step: nextStep("llm_response", "answer", "ok", {
          assistantText: "",
          turnIndex: 0,
          payload,
        }),
      });
      emit({
        type: "kpi",
        turns: 1,
        toolCalls: 0,
        tokensIn,
        tokensOut: 0,
        contextTokens: 0,
        costUsd,
      });
      const verdict = terminalFor("prompt_rejected");
      // Stop-verdict-before-signal ordering (execution plan §1): the "stopping" phase is written before
      // the final status so a reconnecting client sees the wind-down, never a reclassified exit.
      emit({ type: "phase", phase: "stopping" });
      emit(
        {
          type: "status",
          status: verdict.status,
          outcome: verdict.outcome,
          stopReason: "prompt_rejected",
          stopReasonCode: verdict.stopReasonCode,
        },
        durationsMeta,
      );
      return {
        status: verdict.status,
        outcome: verdict.outcome,
        stopReason: "prompt_rejected",
        turns: 1,
        toolCalls: 0,
        tokensIn,
        tokensOut: 0,
      };
    }

    // ── Every other terminal — a user stop, the SessionClock's stall/wall-cap/wait-budget detector, or
    // an API/transport failure (rate-limited retries exhausted / any other AE-x / network error) — ALL
    // route through the ONE shared `terminalFor` table, so the SAME cause produces the SAME triple this
    // workstream guarantees across every run backend.
    const verdict = terminalFor(terminalCauseFor(cause));
    const stopReason = humanStopReason(
      cause,
      { maxRunDurationMs: cfg.maxRunDurationMs, stallMs: resolvedStallMs, waitBudgetMs: resolvedWaitBudgetMs },
      error,
    );
    if (cause.kind === "api") {
      emit({ type: "error", message: stopReason });
    }
    emit({
      type: "kpi",
      turns: 1,
      toolCalls: 0,
      tokensIn,
      tokensOut: 0,
      contextTokens: 0,
      costUsd: 0,
    });
    emit({ type: "phase", phase: "stopping" });
    emit(
      {
        type: "status",
        status: verdict.status,
        outcome: verdict.outcome,
        stopReason,
        stopReasonCode: verdict.stopReasonCode,
      },
      durationsMeta,
    );
    return {
      status: verdict.status,
      outcome: verdict.outcome,
      stopReason,
      turns: 1,
      toolCalls: 0,
      tokensIn,
      tokensOut: 0,
    };
  }
}

/**
 * WP 1.2 — the INTERACTIVE Qlik Answers session. Same clean-session structure as {@link runQlikAnswers}
 * (no MCP session / tool bridge / skill context), but instead of one prompt it runs an opener then, after
 * each answer, awaits the next user turn from {@link InteractiveTurns.nextTurn} and continues the KEPT
 * thread (the cloud-assistants thread itself carries conversation context — no `promptType`, D-QA3
 * revised). The run stays LIVE between turns; a terminal `status` is emitted ONCE the session ends.
 *
 * Unified Sessions (WP1.5) — the wait for the next turn is bracketed with the shared {@link SessionClock}
 * (`enterWaiting()`/`resumeFromWaiting()`, D-US3: the clock PAUSES while waiting on the operator) and
 * surfaced as a `{type:"phase", phase:"waiting_input"}` event carrying the server-authored wait deadline
 * (Qlik's 30-min default, D-US7) so the console renders an authoritative countdown. Every terminal —
 * user stop, the wait budget exhausting (`wait_expired`), a stall/wall-cap trip, or an AE-4/API failure —
 * routes through the ONE shared `terminalFor` table exactly like {@link runQlikAnswers}.
 *
 * Every KPI is CUMULATIVE across the session's turns (turns = answered prompts; tokens/cost = Σ).
 */
export async function runQlikAnswersInteractive(
  runId: string,
  cfg: QlikAnswersRunConfig,
  turns: InteractiveTurns,
  emit: QlikAnswersEmit,
): Promise<LoopResult> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const transport: QlikAnswersTransport = cfg.transport ?? "invoke";
  const counter = getTokenCounter(cfg.profiles[0] ?? DEFAULT_TOKEN_PROFILE);
  const resolvedStallMs = cfg.stallMs ?? DEFAULT_STALL_MS;
  const resolvedWaitBudgetMs = cfg.waitBudgetMs ?? QLIK_ANSWERS_WAIT_BUDGET_MS;

  let stepIndex = 0;
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
    profileTokens: {},
    payload: null,
    ...extra,
  });

  // Cumulative session totals — every `kpi` is the running Σ (turns = answered prompts).
  let answered = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;

  // Unified Sessions (WP1.5) — the SAME shared clock construction as `runQlikAnswers` (see its comment).
  const controller = new AbortController();
  const clock = new SessionClock({
    stallMs: cfg.stallMs,
    waitBudgetMs: resolvedWaitBudgetMs,
    ...(cfg.maxRunDurationMs !== undefined && cfg.maxRunDurationMs > 0
      ? { maxDurationMs: cfg.maxRunDurationMs }
      : {}),
    onFire: () => controller.abort(),
    time: QLIK_SESSION_CLOCK_TIME,
  });
  const cleanupAbortBridge = bridgeUserAbort(cfg.abortSignal, controller);
  clock.start();
  const noted = (event: RunEvent): void => {
    clock.noteEvent();
    emit(event);
  };

  noted({ type: "status", status: "running" });
  reportCapabilities(cfg); // base manifest — assistantId/transport are known immediately

  let threadId: string | undefined;
  let appId: string | undefined;

  // Run ONE prompt turn: emit its `user_message`, send it on the (kept) thread, emit the answer step + a
  // cumulative `kpi`. The opener is labelled `oneshot`; every follow-up `thread` (payload label only — the
  // kept thread carries the actual context).
  const runTurn = async (prompt: string, turnIndex: number, promptMode: "oneshot" | "thread") => {
    noted({
      type: "step",
      step: nextStep("user_message", "user", "ok", { payload: { text: prompt }, turnIndex }),
    });
    const promptTokens = await counter.countText(prompt);
    if (appId === undefined) {
      appId = await resolveQlikAnswersAppContext(cfg.auth, cfg.assistantId, fetchImpl);
      reportCapabilities(cfg, appId);
    }
    if (threadId === undefined) {
      threadId = await createThread(runId, fetchImpl, cfg, appId, controller.signal);
    }
    const answer = await performPrompt(
      transport,
      fetchImpl,
      { ...cfg, prompt },
      appId,
      threadId,
      controller.signal,
      noted,
      turnIndex,
    );
    if (turnIndex === 0) reportCapabilities(cfg, appId, answer.assistantVersion);
    const answerTokens = await counter.countText(answer.output);
    answered += 1;
    tokensIn += promptTokens;
    tokensOut += answerTokens;
    costUsd += estimateRequestCost(cfg.assistantId, 1); // each turn draws 1 question (D-QA5)
    noted({
      type: "step",
      step: nextStep("llm_response", "answer", "ok", {
        assistantText: answer.output,
        ...(answer.reasoning ? { reasoningText: answer.reasoning } : {}),
        turnIndex,
        payload: successPayload(answer, threadId as string, promptMode, 1),
      }),
    });
    noted({
      type: "kpi",
      turns: answered,
      toolCalls: 0,
      tokensIn,
      tokensOut,
      contextTokens: 0,
      costUsd,
    });
  };

  // Await the next user turn, bracketed by the SessionClock's `waiting_input` accounting (D-US3: the
  // clock PAUSES here — waiting on the operator is not a stall) and an emitted `phase` event carrying
  // the server-authored wait deadline, so the console renders an authoritative countdown. Resolves
  // `null` the moment the shared controller aborts (a user stop OR the SessionClock firing — most
  // commonly `wait_expired`) so a walked-away interactive run can't out-live its budget awaiting a turn
  // that never comes.
  //
  // Unified Sessions (WP1.7, D-US1 follow-up) — when the wait resumes because the run is CONTINUING
  // (`!controller.signal.aborted`), an additional `{type:"phase",phase:null}` clears the `waiting_input`
  // phase back to "no distinct phase" so it never lingers. The abort path emits none — the imminent
  // `stopping`/terminal phase (emitted once `nextTurnOrStop` resolves `null` and the main loop breaks)
  // already supersedes it.
  const nextTurnOrStop = (): Promise<string | null> => {
    if (controller.signal.aborted) return Promise.resolve(null);
    clock.enterWaiting();
    emit({
      type: "phase",
      phase: "waiting_input",
      detail: { reason: "next_turn", ...(clock.deadlineAt ? { deadlineAt: clock.deadlineAt } : {}) },
    });
    return new Promise<string | null>((resolve) => {
      const onAbort = () => {
        clock.resumeFromWaiting();
        resolve(null);
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      void turns.nextTurn().then((value) => {
        controller.signal.removeEventListener("abort", onAbort);
        if (!controller.signal.aborted) {
          clock.resumeFromWaiting();
          emit({ type: "phase", phase: null });
        }
        resolve(value);
      });
    });
  };

  try {
    await runTurn(cfg.prompt, 0, "oneshot"); // the opener
    let turnIndex = 1;
    while (true) {
      const next = await nextTurnOrStop();
      if (next === null) break; // user stop / SessionClock fire → end the session
      await runTurn(next, turnIndex, "thread");
      turnIndex += 1;
    }
    cleanupAbortBridge();
    clock.stop();
    const durationsMeta: RunEmitMeta = {
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
    };

    // `nextTurn` only resolves `null` on a stop/clock-fire (or the deadline race), so a clean end of the
    // loop is a STOP, never a `completed` — the session was ended by the clock/operator, not finished.
    const cause = resolveEndCause(cfg.abortSignal, clock, undefined);
    const verdict = terminalFor(terminalCauseFor(cause));
    const stopReason = humanStopReason(
      cause,
      { maxRunDurationMs: cfg.maxRunDurationMs, stallMs: resolvedStallMs, waitBudgetMs: resolvedWaitBudgetMs },
      undefined,
    );
    emit({ type: "phase", phase: "stopping" });
    emit(
      {
        type: "status",
        status: verdict.status,
        outcome: verdict.outcome,
        stopReason,
        stopReasonCode: verdict.stopReasonCode,
      },
      durationsMeta,
    );
    return {
      status: verdict.status,
      outcome: verdict.outcome,
      stopReason,
      turns: Math.max(answered, 1),
      toolCalls: 0,
      tokensIn,
      tokensOut,
    };
  } catch (error) {
    cleanupAbortBridge();
    clock.stop();
    const durationsMeta: RunEmitMeta = {
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
    };
    const cause = resolveEndCause(cfg.abortSignal, clock, error);

    if (cause.kind === "api" && cause.cause === "prompt_rejected") {
      const verdict = terminalFor("prompt_rejected");
      emit({ type: "phase", phase: "stopping" });
      emit(
        {
          type: "status",
          status: verdict.status,
          outcome: verdict.outcome,
          stopReason: "prompt_rejected",
          stopReasonCode: verdict.stopReasonCode,
        },
        durationsMeta,
      );
      return {
        status: verdict.status,
        outcome: verdict.outcome,
        stopReason: "prompt_rejected",
        turns: Math.max(answered, 1),
        toolCalls: 0,
        tokensIn,
        tokensOut,
      };
    }

    const verdict = terminalFor(terminalCauseFor(cause));
    const stopReason = humanStopReason(
      cause,
      { maxRunDurationMs: cfg.maxRunDurationMs, stallMs: resolvedStallMs, waitBudgetMs: resolvedWaitBudgetMs },
      error,
    );
    if (cause.kind === "api") {
      emit({ type: "error", message: stopReason });
    }
    emit({ type: "phase", phase: "stopping" });
    emit(
      {
        type: "status",
        status: verdict.status,
        outcome: verdict.outcome,
        stopReason,
        stopReasonCode: verdict.stopReasonCode,
      },
      durationsMeta,
    );
    return {
      status: verdict.status,
      outcome: verdict.outcome,
      stopReason,
      turns: Math.max(answered, 1),
      toolCalls: 0,
      tokensIn,
      tokensOut,
    };
  }
}

/** The `llm_response` payload for a successful answer (both scripted + interactive share this). */
function successPayload(
  answer: AnswerResult,
  threadId: string,
  promptMode: "oneshot" | "thread",
  questionsConsumed: number,
): AnswersStepPayload {
  // Phase 5 (D-QA11): structure the reasoning stream into typed sections at emit time (the same
  // derivation the replay read does for legacy runs). Flags drafts that duplicate `answer.output`.
  const reasoningSections = answer.reasoning
    ? parseReasoningSections(answer.reasoning, answer.output)
    : [];
  return {
    sources: answer.sources,
    ...(answer.assistantVersion ? { assistantVersion: answer.assistantVersion } : {}),
    threadId,
    appId: answer.appId,
    ...(answer.messageId ? { messageId: answer.messageId } : {}),
    ...(answer.expressions.length > 0 ? { expressions: answer.expressions } : {}),
    ...(answer.reasoning ? { reasoning: answer.reasoning } : {}),
    ...(answer.snapshots.length > 0 ? { snapshots: answer.snapshots } : {}),
    // Answer rendering (Phase 5, D-QA8/D-QA11) — additive; `assistantText`/`reasoning` are unchanged.
    ...(answer.blocks && answer.blocks.length > 0 ? { blocks: answer.blocks } : {}),
    ...(reasoningSections.length > 0 ? { reasoningSections } : {}),
    ...(answer.rawResponse !== undefined ? { rawResponse: answer.rawResponse } : {}),
    promptMode,
    estimatedTokens: true,
    questionsConsumed,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof QlikAnswersApiError
    ? formatApiError(error)
    : error instanceof Error
      ? error.message
      : String(error);
}

// ── Transport dispatch ────────────────────────────────────────────────────────────────────────

/**
 * Run the prompt: stream it to the cloud-assistants API (emitting live `delta` text for the `stream`
 * transport), then fetch + extract the answer message. Both transports POST to `actions/stream`; only the
 * live-deltas behavior differs. Returns the fully normalized {@link AnswerResult}.
 */
async function performPrompt(
  transport: QlikAnswersTransport,
  fetchImpl: typeof fetch,
  cfg: QlikAnswersRunConfig,
  appId: string,
  threadId: string,
  signal: AbortSignal,
  emit: EngineEmit,
  turnIndex: number,
): Promise<AnswerResult> {
  const emitDeltas = transport === "stream";
  const stream = await streamPrompt(
    fetchImpl,
    cfg,
    appId,
    threadId,
    signal,
    emitDeltas ? emit : undefined,
    turnIndex,
  );
  const message = await fetchAnswerMessage(fetchImpl, cfg, threadId, stream.messageId, signal);
  const extracted = extractAnswerMessage(message);
  return {
    // Prefer the card-extracted answer; fall back to the live streamed text if the card had none.
    output: extracted.answer || stream.streamedText,
    sources: [],
    ...(stream.assistantVersion ? { assistantVersion: stream.assistantVersion } : {}),
    appId,
    ...(stream.messageId ? { messageId: stream.messageId } : {}),
    expressions: extracted.expressions,
    // Prefer the FULL streamed agent process (plan + tool/search findings + composition); fall back to
    // the card's pre-Conclusion reasoning when the prompt wasn't streamed (e.g. the `invoke` transport).
    ...((stream.reasoning || extracted.reasoning)
      ? { reasoning: stream.reasoning || (extracted.reasoning as string) }
      : {}),
    snapshots: extracted.snapshots,
    // The ordered card-body answer sequence (D-QA8) — text blocks interleaved with snapshot references.
    ...(extracted.blocks && extracted.blocks.length > 0 ? { blocks: extracted.blocks } : {}),
    rawResponse: message,
  };
}

// ── Rate-limit retry (WP 1.5, qlik-answers roadmap) ────────────────────────────────────────────────
//
// Qlik invoke/stream/thread endpoints are Tier 2 (research doc §3.4): 100 req/min/tenant. The
// orchestrator's per-provider concurrency cap (`suites/orchestrator.ts`, `QLIK_ANSWERS_MAX_CONCURRENCY`)
// already keeps a mass-run's bursts modest, but a single tenant can still be transiently rate-limited —
// retry with a small exponential backoff + jitter rather than failing the whole run outright.

/** 1 initial attempt + up to this many retries before giving up and letting the caller classify it. */
const RATE_LIMIT_MAX_ATTEMPTS = 4;
/** Exponential backoff base (ms) — doubles per retry, capped by {@link RATE_LIMIT_MAX_DELAY_MS}. */
const RATE_LIMIT_BASE_DELAY_MS = 200;
/** Never let a single backoff wait (incl. a server `Retry-After`) balloon past a few seconds. */
const RATE_LIMIT_MAX_DELAY_MS = 4_000;

/**
 * Is this non-OK response a RATE LIMIT: HTTP 429, OR an `AE-6` code in the body? Every other AE-x / HTTP
 * status is NOT rate-limited — returned unmodified so it flows into the SAME terminal classification.
 * Reads the body via `.clone()` so the ORIGINAL response's body stays unconsumed for the caller.
 */
async function isRateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  try {
    const code = extractApiError(await response.clone().json()).code;
    return code === "AE-6";
  } catch {
    return false; // non-JSON / unparsable body — not classified as rate-limited
  }
}

/** Parse a `Retry-After` header (delta-seconds OR an HTTP-date) into a millisecond wait, if present. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

/**
 * The backoff wait for retry attempt `attempt` (0-indexed). A server `Retry-After` header takes precedence
 * when present (still capped); otherwise exponential-doubling from {@link RATE_LIMIT_BASE_DELAY_MS} plus up
 * to 25% jitter (jitter only ever ADDS).
 */
function backoffDelayMs(attempt: number, retryAfterHeader: string | null, random: () => number): number {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, RATE_LIMIT_MAX_DELAY_MS);
  const exponential = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
  return Math.round(exponential + exponential * 0.25 * random());
}

/**
 * The DEFAULT backoff sleep: a real timer that resolves EARLY (without throwing) the instant `signal`
 * aborts, so a deadline/user-stop firing mid-backoff is honored promptly. The caller's next loop iteration
 * then re-attempts the fetch with the SAME (now-aborted) signal, which throws the identical `AbortError`.
 */
function defaultRetrySleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Issue one HTTP request, retrying the SAME request on a rate-limit response (WP 1.5) with exponential
 * backoff + jitter, up to {@link RATE_LIMIT_MAX_ATTEMPTS} total attempts. A non-rate-limit failure or a
 * thrown fetch error (network / `AbortError`) is NOT retried — it propagates exactly as a single
 * `fetchImpl` call would, so every existing terminal classification is unchanged.
 */
async function requestWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  cfg: Pick<QlikAnswersRunConfig, "retrySleep" | "retryRandom">,
): Promise<Response> {
  const sleep = cfg.retrySleep ?? defaultRetrySleep;
  const random = cfg.retryRandom ?? Math.random;
  let attempt = 0;
  while (true) {
    const response = await fetchImpl(url, init);
    if (response.ok) return response;
    const canRetry = attempt + 1 < RATE_LIMIT_MAX_ATTEMPTS && (await isRateLimited(response));
    if (!canRetry) return response; // not rate-limited, or attempts exhausted — the caller classifies it
    await sleep(backoffDelayMs(attempt, response.headers.get("retry-after"), random), signal);
    attempt += 1;
  }
}

// ── Tenant HTTP (all through the injectable fetch) ──────────────────────────────────────────────

/**
 * Create the cloud-assistants conversation thread required before any prompt, binding the resolved app as
 * its data context. Named `mcpfp run <runId>` and KEPT (never deleted — D-QA4) so it is auditable in the
 * Qlik Answers UI. Returns the thread id.
 */
async function createThread(
  runId: string,
  fetchImpl: typeof fetch,
  cfg: QlikAnswersRunConfig,
  appId: string,
  signal: AbortSignal,
): Promise<string> {
  const url = joinUrl(cfg.auth.baseUrl, "api/v1/cloud-assistants/threads");
  const requestBody = { name: `mcpfp run ${runId}`, context: appContext(appId) };
  qaDebug("thread POST", { url, body: requestBody });
  const response = await requestWithRetry(
    fetchImpl,
    url,
    { method: "POST", headers: authHeaders(cfg.auth.apiKey), body: JSON.stringify(requestBody), signal },
    signal,
    cfg,
  );
  if (!response.ok) throw await apiError(response, "thread");
  const body = (await response.json().catch(() => ({}))) as { id?: unknown };
  qaDebug("thread response", body);
  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new QlikAnswersApiError(undefined, "Qlik Answers thread create returned no thread id", "thread");
  }
  return body.id;
}

/**
 * Stream the prompt: `POST /api/v1/cloud-assistants/{threadId}/actions/stream` with
 * `{context:{type:"app", id, data:{mode:"live"}}, content:[{text: prompt}]}`. The response is line-based
 * SSE/NDJSON — fed into a {@link QlikAnswersSseParser} that yields the last `messageId` and best-effort
 * live delta text. When `emit` is provided (the `stream` transport), each delta is surfaced as a live
 * `delta` RunEvent. Returns the collected {@link StreamOutcome}; the answer itself is fetched separately.
 */
async function streamPrompt(
  fetchImpl: typeof fetch,
  cfg: QlikAnswersRunConfig,
  appId: string,
  threadId: string,
  signal: AbortSignal,
  emit: EngineEmit | undefined,
  turnIndex: number,
): Promise<StreamOutcome> {
  const url = joinUrl(
    cfg.auth.baseUrl,
    `api/v1/cloud-assistants/${encodeURIComponent(threadId)}/actions/stream`,
  );
  const requestBody = promptBody(appId, cfg.prompt);
  qaDebug("stream POST", { url, body: requestBody });
  const response = await requestWithRetry(
    fetchImpl,
    url,
    { method: "POST", headers: authHeaders(cfg.auth.apiKey), body: JSON.stringify(requestBody), signal },
    signal,
    cfg,
  );
  if (!response.ok) throw await apiError(response, "stream");

  const parser = new QlikAnswersSseParser();
  // The reasoning stream carries the assistant's `<plan>`/`<final>` wrapper tags — strip them cleanly
  // even when a tag is split across two frames (the cleaner holds a trailing partial until it completes).
  const reasoningCleaner = new QlikReasoningCleaner();
  let messageId: string | undefined;
  let streamedText = "";
  let reasoning = "";
  let rawDebug = "";
  // Apply one parsed chunk: keep the latest messageId; stream reasoning/answer text as live `delta`
  // events (channel per the chunk kind) AND accumulate it (reasoning is persisted on the answer step so
  // replay shows the process too). Reasoning is accumulated regardless of `emit` — `invoke` transport
  // just doesn't surface it live.
  const apply = (chunk: QlikStreamChunk): void => {
    if (chunk.kind === "messageId") {
      messageId = chunk.messageId;
    } else if (chunk.kind === "reasoning") {
      const clean = reasoningCleaner.push(chunk.text);
      if (clean) {
        reasoning += clean;
        emit?.({ type: "delta", channel: "reasoning", text: clean, turnIndex });
      }
    } else if (chunk.kind === "answer") {
      streamedText += chunk.text;
      emit?.({ type: "delta", channel: "text", text: chunk.text, turnIndex });
    }
  };

  const body = response.body;
  if (body) {
    // Decode with `{ stream: true }` so a multi-byte UTF-8 character split across two network chunks is
    // buffered correctly by the decoder rather than corrupting the text handed to the parser.
    const decoder = new TextDecoder();
    // TS's DOM lib types don't declare `ReadableStream`'s async iterator even though Node's runtime
    // supports it — narrow through `unknown` rather than mis-declare the DOM type.
    const iterable = body as unknown as AsyncIterable<Uint8Array>;
    for await (const bytes of iterable) {
      const decoded = decoder.decode(bytes, { stream: true });
      if (process.env.QLIK_ANSWERS_DEBUG) rawDebug += decoded;
      for (const chunk of parser.push(decoded)) apply(chunk);
    }
    const tail = decoder.decode();
    if (tail) {
      if (process.env.QLIK_ANSWERS_DEBUG) rawDebug += tail;
      for (const chunk of parser.push(tail)) apply(chunk);
    }
  } else {
    const text = await response.text();
    if (process.env.QLIK_ANSWERS_DEBUG) rawDebug = text;
    for (const chunk of parser.push(text)) apply(chunk);
  }
  for (const chunk of parser.finish()) apply(chunk);
  const reasoningTail = reasoningCleaner.flush();
  if (reasoningTail) {
    reasoning += reasoningTail;
    emit?.({ type: "delta", channel: "reasoning", text: reasoningTail, turnIndex });
  }

  qaDebug("stream body", {
    rawSample: rawDebug.slice(0, 8000),
    messageId,
    streamedTextLen: streamedText.length,
    reasoningLen: reasoning.length,
  });
  return {
    messageId,
    streamedText,
    reasoning: reasoning.trim(),
    assistantVersion: response.headers.get("etag") ?? undefined,
  };
}

/**
 * Fetch the answer message: `GET /api/v1/cloud-assistants/threads/{threadId}/messages`, then pick the
 * message whose `id === messageId` (fallback: the last message). Throws if the thread has no messages.
 */
async function fetchAnswerMessage(
  fetchImpl: typeof fetch,
  cfg: QlikAnswersRunConfig,
  threadId: string,
  messageId: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const url = joinUrl(
    cfg.auth.baseUrl,
    `api/v1/cloud-assistants/threads/${encodeURIComponent(threadId)}/messages`,
  );
  const response = await requestWithRetry(
    fetchImpl,
    url,
    { method: "GET", headers: authHeaders(cfg.auth.apiKey), signal },
    signal,
    cfg,
  );
  if (!response.ok) throw await apiError(response, "messages");
  const payload = await response.json().catch(() => undefined);
  qaDebug("messages response", payload);
  const message = findMessageById(payload, messageId);
  if (message === undefined) {
    throw new QlikAnswersApiError(undefined, "Qlik Answers returned no messages for the thread", "messages");
  }
  return message;
}

/** Build a {@link QlikAnswersApiError} from a non-OK response, extracting the `AE-x` code if present. */
async function apiError(
  response: Response,
  phase: "thread" | "stream" | "messages",
): Promise<QlikAnswersApiError> {
  let code: string | undefined;
  let message = `Qlik Answers ${phase} request failed (HTTP ${response.status})`;
  try {
    const body = await response.json();
    const extracted = extractApiError(body);
    if (extracted.code) code = extracted.code;
    if (extracted.message) message = extracted.message;
  } catch {
    // Non-JSON error body — keep the HTTP-status message.
  }
  const assistantVersion = response.headers.get("etag") ?? undefined;
  return new QlikAnswersApiError(code, message, phase, assistantVersion, response.status);
}

/**
 * Pull the `AE-x` code + a human message out of a Qlik error body. Tolerant of the two shapes seen in the
 * wild: the REST envelope `{ errors: [{ code, title, detail }] }` and a flat `{ code, message }`, plus a
 * last-resort scan for an `AE-\d` token anywhere in the serialized body.
 */
function extractApiError(body: unknown): { code?: string; message?: string } {
  const record = asRecord(body);
  if (!record) return {};
  const errors = Array.isArray(record.errors) ? record.errors : undefined;
  const first = errors ? asRecord(errors[0]) : undefined;
  const code = asString(first?.code) ?? asString(record.code) ?? scanAeCode(body);
  const message =
    asString(first?.title) ??
    asString(first?.detail) ??
    asString(record.message) ??
    asString(record.title) ??
    asString(record.detail);
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
  };
}

function scanAeCode(body: unknown): string | undefined {
  try {
    return JSON.stringify(body).match(/AE-\d/)?.[0];
  } catch {
    return undefined;
  }
}

function formatApiError(error: QlikAnswersApiError): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────

/** The cloud-assistants data context binding a Qlik Sense app in live mode (mirrors `call_answers.py`). */
function appContext(appId: string): { type: "app"; id: string; data: { mode: "live" } } {
  return { type: "app", id: appId, data: { mode: "live" } };
}

/** The cloud-assistants prompt body: the app data context + the question as a single content part. */
function promptBody(appId: string, prompt: string): {
  context: { type: "app"; id: string; data: { mode: "live" } };
  content: { text: string }[];
} {
  return { context: appContext(appId), content: [{ text: prompt }] };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

/** Join a tenant origin + a path, tolerating a trailing slash on the origin (mirrors model-catalog). */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
