// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.5, §1.5 / D-AH3 / D-AH17) — the `claude_subscription`
// turn executor.
//
// The session-service's model-resolution branch point (`session-service.ts`) delegates a
// `claude_subscription` dispatch to a `HubSubscriptionExecutor` (its own exported seam type) instead of
// running the AI-SDK `streamText` loop (`turn-engine.ts` — WP1.1). THIS module is that executor's
// production implementation: it drives the SAME `AgentSessionDriver` DI seam the assistant dock
// (`assistant/session-driver.ts`) and the Testing subscription executor
// (`testing/claude-subscription-executor.ts`) already drive, under the SAME shared D-CS10 concurrency
// budget (`testing/subscription-concurrency.ts`) — composed, never forked.
//
// Per settled top-level user message this call receives, it:
//   1. reports queue position (D-US1/D-US6) and acquires a permit on the INJECTED concurrency gate
//      (production wires `SubscriptionConcurrencyPool.runs` — see the module doc on that pool: `.runs`
//      is the budget dedicated to a live, user-facing session, decoupled from `.shared` which only the
//      Auto-Rating CLI judge draws from);
//   2. resolves the decrypted subscription auth + spins up ONE throwaway Agent-SDK child scoped to a
//      per-call temp workspace (never the real assistant home), wiring the session's GRANTED MCP
//      SERVERS into that child (model-identity WP3.2 / D-MI3 — see below);
//   3. sends the triggering message (the settled `user_message` the session-service already persisted
//      BEFORE calling this executor — mirrors `runHubTurn`'s contract) as the opener turn, then drains
//      the durable STEERING queue at each turn boundary (R-SES3), sending each queued message as its
//      own turn on the SAME warm child;
//   4. streams `assistant_delta` live via `sink.onDelta` (transient, never persisted) and persists every
//      SETTLED event (`assistant_message`, `tool_call`/`tool_result`, `turn_done`, `phase`, `limit_error`,
//      `error`) via `sink.onEvent` — the same settled-events-only contract `turn-engine.ts` upholds;
//   5. meters EXACT tokens from the driver's `turn_done.usage` and shadow-prices them (D-CS8) via the
//      SAME `estimateCost`/`MODEL_PRICING` every other kind uses, marked `costBasis:
//      "subscription_reference"` (D-AH17's `$ est. · subscription` marker);
//   6. maps a driver `limit_error` (rate-limit OR auth) onto a `HubLimitErrorEvent` carrying
//      `retrySources` (`retrySourcesFor("claude_subscription")` — reused from `turn-engine.ts`), the
//      explicit retry-on-another-source affordance D-AH17 requires (never a silent switch);
//   7. terminates through the SAME shared `terminalFor` table (`testing/session-terminal.ts`), clocked
//      by the SAME `SessionClock` (`testing/session-clock.ts`) every other kind uses — `abortSignal`
//      (Stop) preserves whatever partial reply had streamed so far with an explicit cut-off note
//      (R-SES11), never silently dropping it.
//
// Cross-domain reuse (composition, not a fork — mirrors `turn-engine.ts`'s own header note): the
// concurrency gate types, `SubscriptionRunError`, `SUBSCRIPTION_DISALLOWED_TOOLS`, and
// `createThrowawayWorkspace` are IMPORTED from `testing/claude-subscription-executor.ts` /
// `testing/subscription-concurrency.ts` (the Testing feature's subscription executor), not
// re-implemented. This module owns NOTHING but the HUB EVENT/SESSION-SHAPED wiring around those shared
// primitives; it never touches the testing tables.
//
// MCP TOOLS (model-identity WP3.2, locked decision D-MI3). Before WP2.1 taught the resolver to honor an
// explicit `providerCredentialId`, this executor was effectively unreachable on any install that also
// held an Anthropic API key (the name heuristic could not emit `claude_subscription` — README §1), which
// hid a second defect: it
// wired ONLY the `ask_user` bridge (`mcpServers: askBridge ? {…} : {}`) and passed `tools: {}` to the
// prompt assembler, while `hubCapabilitiesForKind` reports `toolCalls: true` — a correctly-routed
// subscription chat session was tool-less while claiming tools. The owner chose to WIRE REAL TOOLS.
// The session's granted MCP servers now arrive through the injectable `resolveMcpTools` seam
// (`./subscription-tools.ts`, which reuses the Testing path's proven `buildSubscriptionToolWiring`)
// as Agent-SDK `mcpServers` entries + `mcp__<serverKey>__<toolName>` allow patterns, are fed to
// `assembleSessionPrompt` as the real tool list, and are gated by the SAME default-deny
// `makeAllowListGate` the Testing executor uses (imported, not forked). The `ask_user` bridge is
// MERGED alongside them — never displaced. Decrypted stdio `env` / http auth `headers` reach the child
// config and nothing else: never a persisted event, never a log line, never an error message
// (`.claude/rules/mcp-and-security.md`). An absent `resolveMcpTools` (existing constructions, tests)
// keeps the byte-identical pre-WP3.2 tool-less shape.
//
// Wiring seam (WP1.2's job, not this file's): `index.ts` constructs ONE `createHubSubscriptionAdapter({
// repository, driver: new SdkAgentSessionDriver(), resolveAuth: <the linked-auth resolver>, concurrency:
// pool.runs, resolveMcpTools: createHubSubscriptionMcpResolver({…}), ... })` and passes the returned
// function as `HubSessionServiceDeps.subscriptionExecutor`.
// See the exported `HubSubscriptionAdapterDeps` type below for the exact shape the seam-close needs.

import { nanoid } from "nanoid";
import type {
  HubBudgets,
  HubEvent,
  HubMessagePart,
  HubToolPart,
  HubUsage,
  RunOutcome,
  RunStatus,
  SessionCapabilities,
  StopReasonCode,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import type { AgentSessionDriver, DriverEvent, DriverUsage } from "../assistant/session-driver.js";
import { type AssistantAuthSource, buildAssistantSpawnEnv } from "../assistant/spawn-env.js";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import {
  ASK_USER_MCP_KEY,
  type AskUserBridge,
  askUserToolPattern,
  buildAskUserSdkServer,
} from "../testing/ask-user-tool.js";
import {
  createThrowawayWorkspace,
  makeAllowListGate,
  SUBSCRIPTION_DISALLOWED_TOOLS,
  SubscriptionRunError,
  type CreateThrowawayWorkspace,
  type ThrowawayWorkspace,
} from "../testing/claude-subscription-executor.js";
import { SessionClock, type SessionClockTime } from "../testing/session-clock.js";
import { terminalFor, type TerminalCause } from "../testing/session-terminal.js";
import type { ConcurrencyGate, QueueVisibleGate } from "../testing/subscription-concurrency.js";
import { hubCapabilitiesForKind } from "./capabilities.js";
import { assembleSessionPrompt, type HubPromptMode } from "./prompting/index.js";
import type { HubEventInput, HubRepository } from "./repository.js";
import {
  parseSubscriptionToolName,
  type HubSubscriptionMcpResolver,
  type HubSubscriptionToolWiring,
} from "./subscription-tools.js";
import {
  HUB_DEFAULT_MAX_STEPS,
  retrySourcesFor,
  type HubTurnResult,
  type HubTurnSink,
} from "./turn-engine.js";
import type { HubSubscriptionExecutor, HubSubscriptionExecutorInput } from "./session-service.js";

/** The hub model kind this executor is bound to — the ONE `provider`/marker string every persisted
 *  `HubLimitErrorEvent`/pricing lookup below uses. */
const SUBSCRIPTION_KIND = "claude_subscription" as const;

/**
 * The dependencies `index.ts` (WP1.2's seam-close) must supply. `concurrency` is REQUIRED and
 * deliberately carries NO module-level default — production wires `SubscriptionConcurrencyPool.runs`
 * (the shared D-CS10 budget already created once in `index.ts`); this module never constructs its own
 * pool/semaphore (composition, not a fork). `driver`/`resolveAuth` are the same two DI seams the Testing
 * subscription executor takes — production wires the real `SdkAgentSessionDriver` + the linked-auth
 * resolver; tests inject a scripted fake driver + a stub token (no real child is ever spawned here).
 */
export type HubSubscriptionAdapterDeps = {
  repository: HubRepository;
  driver: AgentSessionDriver;
  /** Resolve the DECRYPTED subscription auth source, or `null` when unsigned (→ an honest `auth` error
   *  BEFORE anything is spawned — mirrors the Testing executor's `resolveAuth` seam). */
  resolveAuth: () => AssistantAuthSource | null;
  /** The shared D-CS10 concurrency gate — production injects `SubscriptionConcurrencyPool.runs`. */
  concurrency: ConcurrencyGate;
  /**
   * model-identity WP3.2 (**D-MI3**) — resolve this session's granted MCP servers into the Agent-SDK
   * `mcpServers` config + `mcp__<serverKey>__<toolName>` allow patterns (see `./subscription-tools.ts`).
   * Production wires {@link import("./subscription-tools.js").createHubSubscriptionMcpResolver} at the
   * composition root; ABSENT ⇒ no MCP tools at all, i.e. byte-identical to the pre-WP3.2 shape (the
   * `ask_user` bridge alone, `tools: {}` in the prompt) — so every existing construction/test is
   * unaffected.
   *
   * The resolved `mcpServers` value is SECRET-BEARING (decrypted stdio `env` / http auth `headers`):
   * this executor hands it to `driver.start()` and nowhere else — never to a persisted event, never to
   * a log line, never into an error message (`.claude/rules/mcp-and-security.md`).
   */
  resolveMcpTools?: HubSubscriptionMcpResolver;
  /** Name-only warnings (a tool-resolution failure). NEVER receives a config or a secret. */
  logger?: { warn?: (message: string) => void };
  /** Throwaway-workspace factory; defaults to {@link createThrowawayWorkspace} under the OS temp dir. */
  createWorkspace?: CreateThrowawayWorkspace;
  /** Built-in SDK tools removed from the model. Defaults to {@link HUB_SUBSCRIPTION_DISALLOWED_TOOLS}
   *  (the Testing executor's block list MINUS the web tools — see that constant). */
  disallowedTools?: readonly string[];
  /**
   * web-access-fix (2026-07-27) — whether the hub's web capability is on (`HUB_WEB_TOOLS`, wired from
   * `config.hubWebToolsEnabled`). `false` restores `WebSearch`/`WebFetch` to the block list, so the
   * kill switch stays absolute on THIS path too. Absent ⇒ `true`, matching the env default.
   *
   * Only consulted for the DEFAULT list: an explicit {@link disallowedTools} is used verbatim (a test
   * or a caller that hands over a list means it).
   */
  webToolsEnabled?: boolean;
  /** SDK internal turn cap for this call's whole child session. Defaults to `session.budgets?.maxTurns`
   *  or {@link HUB_DEFAULT_MAX_STEPS} (mirrors the AI-SDK turn engine's default). */
  maxTurns?: number;
  /** SessionClock stall/wait/time overrides — tests inject a fake time source. */
  clockOptions?: {
    stallMs?: number;
    waitBudgetMs?: number;
    time?: SessionClockTime;
  };
};

/**
 * Build a {@link HubSubscriptionExecutor} bound to `deps`. The returned function matches
 * `session-service.ts`'s `HubSubscriptionExecutor` type EXACTLY — `index.ts` wires it straight into
 * `HubSessionServiceDeps.subscriptionExecutor` with no adaptation needed.
 */
export function createHubSubscriptionAdapter(
  deps: HubSubscriptionAdapterDeps,
): HubSubscriptionExecutor {
  return (input: HubSubscriptionExecutorInput): Promise<HubTurnResult> =>
    runHubSubscriptionTurn(deps, input);
}

/**
 * web-access-fix (2026-07-27, owner decision) — **the HUB's block list: the Testing executor's, minus
 * the web tools.**
 *
 * The hub imported `SUBSCRIPTION_DISALLOWED_TOOLS` wholesale, and that list blocks `WebSearch` and
 * `WebFetch`. For the Testing feature that is right — a run measures an MCP tool surface, and an agent
 * doing its own web research would pollute the measurement. For the HUB it was a silent capability
 * hole: a `claude_subscription` session had **no internet at all**, because it is also not an AI-SDK
 * kind, so it never reaches `composeWebTools` either (`HUB_WEB_SEARCH_PROVIDER_KINDS`' own note says
 * so). An API-keyed session got `web.search` + `web.fetch` by default; the subscription twin of the
 * very same model got nothing, and said nothing about it.
 *
 * Everything else stays blocked, deliberately: `Bash`/`Read`/`Write`/`Edit`/`Glob`/`Grep` would let the
 * SDK child reach the real filesystem, bypassing the hub's own sandboxed `files.*` builtins over the
 * session workspace; the meta-tools (`Task`/`Agent`/`Skill`/`TodoWrite`/…) have no API-path equivalent,
 * so allowing them would make a subscription turn diverge from its metered twin.
 *
 * KNOWN GAP, stated rather than papered over: the subscription path emits `citations: []`, so web
 * research on this path is real but **uncited** — unlike the AI-SDK path, whose `web.search` results
 * are mined into the numbered citation ledger. Wiring the Agent SDK's `WebSearch` results into that
 * ledger is a separate piece of work (owner-deferred 2026-07-27).
 */
export const HUB_SUBSCRIPTION_DISALLOWED_TOOLS: readonly string[] =
  SUBSCRIPTION_DISALLOWED_TOOLS.filter((tool) => tool !== "WebSearch" && tool !== "WebFetch");

/** D-CS8 — the KPI `costBasis` marker for every subscription-priced Hub event (D-AH17's "est. ·
 *  subscription" marker). Mirrors the Testing executor's identical constant. */
const SUBSCRIPTION_COST_BASIS = "subscription_reference" as const;

/** Explicit cut-off note appended to a preserved partial answer on an abnormal terminal (R-SES11) —
 *  mirrors `turn-engine.ts`'s `CUTOFF_NOTES`. */
const STOP_CUTOFF_NOTE = "\n\n_(Response stopped.)_";

// ── The turn ──────────────────────────────────────────────────────────────────────────────────────

async function runHubSubscriptionTurn(
  deps: HubSubscriptionAdapterDeps,
  input: HubSubscriptionExecutorInput,
): Promise<HubTurnResult> {
  const { session, modelId, abortSignal, steering, sink } = input;
  const sessionId = session.id;
  const repository = deps.repository;
  const gate = deps.concurrency;
  const createWorkspace = deps.createWorkspace ?? createThrowawayWorkspace();
  // web-access-fix (2026-07-27) — the hub's own list (web tools allowed), unless the operator's kill
  // switch is off, in which case the Testing list's full block (web included) is exactly right.
  const disallowedTools =
    deps.disallowedTools ??
    (deps.webToolsEnabled === false
      ? SUBSCRIPTION_DISALLOWED_TOOLS
      : HUB_SUBSCRIPTION_DISALLOWED_TOOLS);
  const maxTurns = deps.maxTurns ?? session.budgets?.maxTurns ?? HUB_DEFAULT_MAX_STEPS;

  // Running, cumulative totals for THIS call (the session-service folds them into the session's
  // cumulative totals via the returned HubTurnResult — mirrors runHubTurn's contract).
  const totals = { costUsd: 0, tokensIn: 0, tokensOut: 0 };
  let toolCallCount = 0;

  // The child's own controller — aborted exactly once, AFTER the terminal verdict is written (D-US2
  // "write the verdict before killing the child" ordering, mirrored from the Testing executor).
  const controller = new AbortController();
  let settled: HubTurnResult | undefined;

  // A settled event BEFORE the clock exists (used only for the queued-phase visibility events, which
  // can legitimately happen before `clock.start()`). No `clock.noteEvent()` call — there is no clock yet.
  const rawPersist = (event: HubEventInput): HubEvent => {
    const e = repository.appendEvent(sessionId, event);
    sink.onEvent(e);
    return e;
  };

  // ── Queue visibility BEFORE the concurrency permit (D-US1/D-US6) — mirrors the Testing executor's
  //    `acquireGate`: emit BOTH `queued`(+position) and `starting` ONLY when the gate is genuinely
  //    contended; an uncontended acquire emits neither (adversarially locked behavior — see
  //    claude-subscription-session.test.ts).
  const withQueue = gate as Partial<QueueVisibleGate>;
  const contended = withQueue.willQueue === true;
  if (contended) {
    rawPersist({
      type: "phase",
      phase: "queued",
      detail: { position: (withQueue.queueLength ?? 0) + 1 },
    });
    repository.setSessionLifecycle(sessionId, { phase: "queued" });
  }
  await gate.acquire();
  if (contended) rawPersist({ type: "phase", phase: "starting" });

  // ── SessionClock (D-US3/D-US7) — the ONE timer engine every backend drives, reused not forked.
  const clock = new SessionClock({
    ...(deps.clockOptions?.stallMs !== undefined ? { stallMs: deps.clockOptions.stallMs } : {}),
    ...(deps.clockOptions?.waitBudgetMs !== undefined
      ? { waitBudgetMs: deps.clockOptions.waitBudgetMs }
      : {}),
    ...(session.budgets?.maxDurationMs ? { maxDurationMs: session.budgets.maxDurationMs } : {}),
    ...(deps.clockOptions?.time ? { time: deps.clockOptions.time } : {}),
    onFire: (fire) => stopFor(fire.cause),
  });

  const persist = (event: HubEventInput): HubEvent => {
    const e = repository.appendEvent(sessionId, event);
    clock.noteEvent();
    sink.onEvent(e);
    return e;
  };

  /**
   * The ONE choke point every terminal path writes through — idempotent (first cause wins). Writes the
   * terminal verdict (DB lifecycle patch, folding this call's totals into the session's cumulative ones)
   * BEFORE aborting `controller` (D-US2 "verdict before kill" ordering) — aborting here, rather than only
   * in the outer `finally`, is what makes Stop actually interrupt an in-flight child turn (instead of
   * letting it run to its own completion): it immediately ends the driver's event stream, which
   * `consumeSubscriptionTurn` observes via `controller.signal.aborted` and returns whatever partial reply
   * had streamed so far (R-SES11) rather than throwing a driver error.
   */
  function finalize(
    verdict: { status: RunStatus; outcome: RunOutcome; stopReasonCode?: StopReasonCode },
    completed: boolean,
  ): HubTurnResult {
    if (settled) return settled;
    clock.stop();
    const current = repository.getSession(sessionId);
    repository.setSessionLifecycle(sessionId, {
      status: verdict.status,
      phase: null,
      stopReasonCode: verdict.stopReasonCode ?? null,
      costUsd: current.costUsd + totals.costUsd,
      tokensIn: current.tokensIn + totals.tokensIn,
      tokensOut: current.tokensOut + totals.tokensOut,
      activeDurationMs: (current.activeDurationMs ?? 0) + clock.activeDurationMs,
      totalDurationMs: (current.totalDurationMs ?? 0) + clock.totalDurationMs,
    });
    settled = {
      status: verdict.status,
      outcome: verdict.outcome,
      stopReasonCode: verdict.stopReasonCode,
      costUsd: totals.costUsd,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
      completed,
    };
    controller.abort();
    return settled;
  }

  /** An ABNORMAL terminal (stop / clock fire / limit / driver error / budget trip). Persists the
   *  `stopping` phase (+ an optional `limit_error`/`error` event) and finalizes — idempotent. */
  function stopFor(
    cause: TerminalCause,
    opts?: {
      errorMessage?: string;
      authRequired?: boolean;
      limitMessage?: string;
      limitKind?: "auth" | "rate_limit";
    },
  ): HubTurnResult {
    if (settled) return settled;
    persist({ type: "phase", phase: "stopping" });
    if (opts?.limitMessage) {
      persist({
        type: "limit_error",
        message: opts.limitMessage,
        retrySources: retrySourcesFor(SUBSCRIPTION_KIND),
        limitKind: opts.limitKind ?? "rate_limit",
        provider: SUBSCRIPTION_KIND,
      });
    } else if (opts?.errorMessage) {
      persist({
        type: "error",
        message: opts.errorMessage,
        recoverable: false,
        ...(opts.authRequired ? { authRequired: true } : {}),
      });
    }
    return finalize(terminalFor(cause), false);
  }

  clock.start();

  // ── Running lifecycle + capability manifest (D-US4) — established BEFORE the abort signal is wired,
  //    so a Stop that arrived while queued never races ahead of "running" in the event log (mirrors the
  //    Testing executor's WP1.R fix: checking the signal before `running` is emitted orphaned a run).
  // Interactive `ask_user` (the SAME primitive the AI-SDK path uses). A subscription session is always
  // foreground (mission agents run through the AI-SDK engine, never this executor), so the seam's presence
  // both advertises `askUser:true` AND wires our own `ask_user` MCP tool while blocking the SDK-native
  // `AskUserQuestion` (which the hub can neither render interactively nor answer-route). The bridge lets
  // `runAsk` drive the `phase` event (there is no ref-counted `beginWait` here — one wait at a time, the
  // child blocks on the MCP result), and races the answer against `controller` so Stop settles it to `null`.
  const exposeAsk = !!input.waitForQuestion;
  const askBridge: AskUserBridge | undefined = exposeAsk
    ? {
        newQuestionId: () => nanoid(),
        emit: (event) => {
          if (event.type === "question") {
            persist({
              type: "question",
              questionId: event.questionId,
              prompt: event.prompt,
              ...(event.options && event.options.length > 0 ? { options: event.options } : {}),
              allowOther: event.allowOther ?? true,
            });
          } else if (event.type === "question_resolved") {
            persist({ type: "question_resolved", questionId: event.questionId, answer: event.answer });
          } else if (event.type === "phase") {
            persist({
              type: "phase",
              phase: event.phase,
              ...(event.detail ? { detail: event.detail } : {}),
            });
          }
        },
        waitForAnswer: (questionId) =>
          new Promise<string | null>((resolve) => {
            if (controller.signal.aborted) {
              resolve(null);
              return;
            }
            let done = false;
            const settle = (value: string | null): void => {
              if (done) return;
              done = true;
              resolve(value);
            };
            void input.waitForQuestion?.(questionId).then(settle);
            controller.signal.addEventListener("abort", () => settle(null), { once: true });
          }),
        enterWaiting: () => {
          clock.enterWaiting();
          repository.setSessionLifecycle(sessionId, {
            phase: "waiting_input",
            waitDeadlineAt: clock.deadlineAt ?? null,
          });
          return clock.deadlineAt;
        },
        resumeFromWaiting: () => {
          if (!clock.fired) {
            clock.resumeFromWaiting();
            repository.setSessionLifecycle(sessionId, { phase: null, waitDeadlineAt: null });
            persist({ type: "phase", phase: null });
          }
        },
      }
    : undefined;
  const effectiveDisallowed = exposeAsk ? [...disallowedTools, "AskUserQuestion"] : disallowedTools;

  const capabilities: SessionCapabilities = hubCapabilitiesForKind(SUBSCRIPTION_KIND, exposeAsk);
  repository.setSessionLifecycle(sessionId, { status: "running", phase: "starting", capabilities });
  persist({ type: "phase", phase: null });

  if (abortSignal.aborted) stopFor("user_stop");
  else abortSignal.addEventListener("abort", () => stopFor("user_stop"), { once: true });
  if (settled) {
    gate.release();
    return settled;
  }

  if (session.budgets?.maxCostUsd && !isModelPriced(modelId)) {
    // Advisory only (hub budgets are advisory in v1, mirrors turn-engine.ts) — never a pre-flight refusal.
    console.warn(
      `[hub subscription ${sessionId}] maxCostUsd is set but model "${modelId}" has no known pricing; the cost cap cannot fire.`,
    );
  }

  let workspace: ThrowawayWorkspace | undefined;
  try {
    const auth = deps.resolveAuth();
    if (!auth) {
      return stopFor("auth", {
        errorMessage:
          "The Assistant needs a signed-in Claude subscription. Sign in from Settings, or switch this session to an API-keyed model.",
        authRequired: true,
      });
    }
    if (settled) return settled; // a stop/clock-fire raced in while resolving auth.

    workspace = await createWorkspace();
    if (settled) return settled; // …or while creating the throwaway workspace.

    // ── model-identity WP3.2 (D-MI3) — the session's REAL MCP tool surface. Resolving it is
    //    best-effort (the hub's D-AS17 posture): a resolution failure degrades this turn to the
    //    tool-less surface with a NAME-ONLY warning rather than failing a chat the operator is
    //    waiting on. `mcpWiring.mcpServers` is secret-bearing and flows ONLY into `driver.start()`
    //    below — it is never persisted, logged, or returned (`.claude/rules/mcp-and-security.md`).
    let mcpWiring: HubSubscriptionToolWiring | null = null;
    try {
      mcpWiring = (await deps.resolveMcpTools?.(session)) ?? null;
    } catch (error) {
      // The message comes from OUR resolver (name-only by construction); the config never reaches it.
      deps.logger?.warn?.(
        `[hub subscription ${sessionId}] MCP tools could not be resolved for this turn ` +
          `(${error instanceof Error ? error.message : "unknown error"}); continuing without them.`,
      );
    }

    const promptMode: HubPromptMode = session.mode === "research" ? "research" : "chat";
    // model-identity WP4.2 (D-MI4) — a mission AGENT turn composes its OWN prompt (the role template,
    // identity replaced §8.4, plus the prompt-enforced report contract) and is handed THIS turn's real
    // resolved tool listing so the role prompt names the tools the child actually got. Every chat /
    // research session takes the `assembleSessionPrompt` branch below, unchanged.
    const assembled: { text: string; promptVersion?: string } = input.buildSystemPrompt
      ? input.buildSystemPrompt(
          mcpWiring ? { toolListText: mcpWiring.toolListText } : {},
        )
      : assembleSessionPrompt({
          mode: promptMode,
          session: {
            sessionTitle: session.title,
            mode: session.mode,
            modelId,
            capabilities: describeCapabilities(capabilities),
            ...(session.projectId ? { projectName: session.projectId } : {}),
            date: new Date().toISOString().slice(0, 10),
            ...(session.budgets ? { budgets: describeBudgets(session.budgets) } : {}),
          },
          // WP3.2 (D-MI3): the REAL granted surface, by fully-qualified `mcp__<server>__<tool>` name —
          // not the hardcoded `{}` that made a tool-carrying session claim `toolCalls: true` while
          // telling the model "No MCP tools are granted in this session". `loadingMode: "eager"` because
          // the Agent-SDK child holds every wired server's definitions from connect time: there is no
          // deferred/`tool_search` promotion on this path (that built-in is an in-process AI-SDK tool).
          tools: mcpWiring ? { toolListText: mcpWiring.toolListText, loadingMode: "eager" } : {},
        });

    // The child's MCP surface: the granted servers PLUS (never displaced by) the in-process
    // `ask_user` bridge, which owns the reserved `ASK_USER_MCP_KEY` ("ask") map key. A registered
    // server can never collide with it — the keys here are nanoid server ids.
    const mcpServers: Record<string, unknown> = {
      ...(mcpWiring?.mcpServers ?? {}),
      ...(askBridge ? { [ASK_USER_MCP_KEY]: buildAskUserSdkServer(askBridge) } : {}),
    };
    // The auto-allow patterns AND — mirroring the Testing executor (`makeAllowListGate`, imported not
    // forked) — the DEFAULT-DENY `canUseTool` gate built over the SAME set. The patterns alone only
    // auto-approve; the gate is what makes a NON-granted tool on a partially-granted server genuinely
    // uncallable. Empty set (no grants, no ask bridge) ⇒ neither is passed, so a tool-less session's
    // driver options stay byte-identical to the pre-WP3.2 shape.
    const grantedPatterns = [
      ...(mcpWiring?.allowedTools ?? []),
      ...(askBridge ? [askUserToolPattern()] : []),
    ];
    /**
     * web-access-fix (2026-07-27, follow-up) — **the allow-list gate is DEFAULT-DENY BY EXACT TOOL
     * NAME, so it denies the SDK's own built-ins too.**
     *
     * Dropping `WebSearch`/`WebFetch` from {@link HUB_SUBSCRIPTION_DISALLOWED_TOOLS} was necessary but
     * NOT sufficient: the moment a session has any MCP grant (or the ask bridge), `grantedPatterns` is
     * non-empty, `makeAllowListGate` is installed, and every call the model makes to a name that is not
     * on that list is refused — `Tool "WebSearch" is not on this run's allow-list and cannot be used.`
     * The model could finally SEE web search and still could not use it, which is worse than not
     * offering it: it burns a turn discovering the refusal.
     *
     * So the web tools join the list precisely when the gate will exist. When `grantedPatterns` is
     * empty no gate is installed at all (a tool-less session's options stay byte-identical to the
     * pre-WP3.2 shape, per the note above) and the SDK's own default already permits anything not
     * disallowed — so adding them there would CREATE a gate where there was none and start denying
     * every other built-in. Hence the `length > 0` condition rather than an unconditional append.
     */
    const allowedTools =
      grantedPatterns.length > 0 && deps.webToolsEnabled !== false
        ? [...grantedPatterns, "WebSearch", "WebFetch"]
        : grantedPatterns;
    const env = buildAssistantSpawnEnv({ auth, assistantDataDir: workspace.dir });
    const driverSession = deps.driver.start({
      model: modelId,
      cwd: workspace.dir,
      maxTurns,
      systemPrompt: assembled.text,
      env,
      mcpServers,
      disallowedTools: effectiveDisallowed,
      ...(allowedTools.length > 0
        ? { allowedTools, canUseTool: makeAllowListGate(allowedTools) }
        : {}),
      abortController: controller,
    });
    const events = driverSession.events[Symbol.asyncIterator]();
    // WP3.2 — name-only lookup so a settled `tool_call` part can carry its origin `serverId` (the
    // console's per-server chips, R-MCP11) instead of only the opaque `mcp__…` string. Never holds a
    // config or a secret.
    const grantedServerIds = new Set((mcpWiring?.servers ?? []).map((s) => s.serverId));

    /** Send one turn on the warm child, consume it to `turn_done`, and persist the settled
     *  `assistant_message`/`turn_done` pair. Settles the call (via `stopFor`) on a limit/driver error or
     *  a tripped budget; a Stop/clock-fire that raced in mid-turn still gets its partial reply persisted
     *  with an explicit cut-off note (R-SES11) rather than silently dropped. */
    async function runOneSend(text: string, messageId: string): Promise<void> {
      driverSession.send({ text });
      let turn: { parts: HubMessagePart[]; usage?: HubUsage };
      try {
        turn = await consumeSubscriptionTurn(
          events,
          messageId,
          persist,
          sink,
          clock,
          controller.signal,
          grantedServerIds,
        );
      } catch (error) {
        if (settled) return; // the stream ended because we already stopped it — nothing more to classify.
        if (error instanceof SubscriptionRunError) {
          if (error.kind === "driver") {
            stopFor("provider_error", { errorMessage: error.message });
          } else {
            stopFor(error.kind, { limitMessage: error.message, limitKind: error.kind });
          }
          return;
        }
        stopFor("provider_error", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      if (settled) {
        // Stopped mid-turn (Stop / clock fire) — the terminal verdict is already written; still persist
        // whatever partial reply had streamed so far, honestly cut off (R-SES11), rather than dropping it.
        if (turn.parts.length > 0) {
          persistAssistantTurn([...turn.parts, { type: "text", text: STOP_CUTOFF_NOTE }]);
        }
        return;
      }

      persistAssistantTurn(turn.parts, turn.usage);
      toolCallCount += turn.parts.filter((p) => p.type === "tool_call").length;

      const budgets = session.budgets;
      if (budgets?.maxToolCalls && toolCallCount >= budgets.maxToolCalls) {
        stopFor("max_tool_calls");
        return;
      }
      if (budgets?.maxTokens && totals.tokensIn + totals.tokensOut >= budgets.maxTokens) {
        stopFor("max_tokens");
        return;
      }
      if (budgets?.maxCostUsd && totals.costUsd >= budgets.maxCostUsd) {
        stopFor("max_cost");
      }

      /** Persist the settled `assistant_message` + `turn_done` pair for one turn and fold its usage/cost
       *  into this call's running totals. `usage` is absent on a preserved partial reply (no `turn_done`
       *  ever arrived), matching turn-engine's cut-off shape (parts carry the note, usage/cost is $0). */
      function persistAssistantTurn(parts: HubMessagePart[], usage?: HubUsage): void {
        const cost = usage ? estimateCost(modelId, usageForPricing(usage)) : 0;
        persist({
          type: "assistant_message",
          messageId,
          model: modelId,
          parts,
          ...(usage ? { usage } : {}),
          citations: [],
          artifactsTouched: [],
          ...(assembled.promptVersion ? { promptVersion: assembled.promptVersion } : {}),
          costUsd: cost,
          costBasis: SUBSCRIPTION_COST_BASIS,
        });
        persist({
          type: "turn_done",
          messageId,
          ...(usage ? { usage } : {}),
          costUsd: cost,
          costBasis: SUBSCRIPTION_COST_BASIS,
        });
        if (usage) {
          totals.tokensIn += usage.tokensIn;
          totals.tokensOut += usage.tokensOut;
          totals.costUsd += cost;
        }
      }
    }

    // ── The opener: the settled `user_message` that triggered this dispatch (already persisted by the
    //    session-service BEFORE this executor was called — mirrors runHubTurn's documented contract).
    const openerText = lastUserMessageText(repository.listEvents(sessionId));
    await runOneSend(openerText, nanoid());

    // ── Steering loop (R-SES3): drain whatever queued while the opener (or a prior drained batch) was
    //    running, injecting each as its own turn on the SAME warm child, until nothing more is pending.
    while (!settled && steering.hasPending()) {
      const queued = steering.drainPending();
      for (const q of queued) {
        if (settled) break;
        // model-identity WP6.1 (F4) — as in `runHubTurn`: stamp the model this warm child is ACTUALLY
        // running (`modelId`), never the queued override, which cannot be applied to an already-started
        // subscription child. The ask survives on the correlated `queued_user_message`.
        persist({
          type: "user_message",
          messageId: q.queuedMessageId,
          text: q.text,
          ...(q.model ? { model: modelId } : {}),
          ...(q.attachmentFileIds ? { attachmentFileIds: q.attachmentFileIds } : {}),
        });
        await runOneSend(q.text, nanoid());
      }
    }

    return settled ?? finalize({ status: "completed", outcome: "completed" }, true);
  } catch (error) {
    if (settled) return settled;
    const message = error instanceof Error ? error.message : String(error);
    return stopFor("provider_error", { errorMessage: message });
  } finally {
    clock.stop();
    controller.abort(); // tear the (warm) child down whichever way this call settled.
    await workspace?.cleanup().catch(() => {});
    gate.release();
  }
}

// ── Turn consumption (the driver's normalized event stream → Hub events, one settled turn) ──────────

/**
 * Walk the driver's normalized event stream for ONE user turn: stream `assistant_delta` live (also
 * buffering it locally, in case the stream is cut off before its settled `assistant_message` arrives),
 * persist `tool_call`/`tool_result` as they settle (LIVE since model-identity WP3.2 / D-MI3 — the
 * session's granted MCP servers are now genuinely wired into the child, and a `mcp__<serverId>__<tool>`
 * call is split back into its human tool name + origin `serverId` via `grantedServerIds`), accumulate
 * ordered `parts`, and RETURN with the turn's usage on
 * `turn_done`. A `limit_error` throws a {@link SubscriptionRunError} (reused from the Testing executor)
 * so the caller can classify auth vs rate-limit uniformly; the stream ending WITHOUT a `turn_done` throws
 * too, UNLESS `abortSignal` is already aborted — in that case the partial `parts` accumulated so far
 * (PLUS whatever delta text never made it into a settled block) are returned (usage-less) so the caller
 * can preserve them with an explicit cut-off note (R-SES11) instead of treating an expected, Stop-induced
 * stream close as a driver failure.
 */
async function consumeSubscriptionTurn(
  events: AsyncIterator<DriverEvent>,
  messageId: string,
  persist: (event: HubEventInput) => HubEvent,
  sink: HubTurnSink,
  clock: SessionClock,
  abortSignal: AbortSignal,
  /** WP3.2 — the granted server ids, so a `mcp__<serverId>__<tool>` call can be attributed. */
  grantedServerIds: ReadonlySet<string> = new Set(),
): Promise<{ parts: HubMessagePart[]; usage?: HubUsage }> {
  const parts: HubMessagePart[] = [];
  // Buffers the CURRENT (not-yet-settled) text block's deltas; cleared once its settled `assistant_message`
  // arrives (which carries the authoritative full text — pushing both would duplicate it). Flushed onto
  // `parts` only if the stream ends before that settled event ever shows up (an abort mid-generation).
  let deltaBuf = "";
  while (true) {
    const next = await events.next();
    if (next.done) {
      if (abortSignal.aborted) {
        if (deltaBuf) parts.push({ type: "text", text: deltaBuf });
        return { parts };
      }
      throw new SubscriptionRunError(
        "driver",
        "The Assistant's subscription session ended before replying.",
      );
    }
    const event = next.value;
    switch (event.type) {
      case "assistant_delta":
        if (event.text) {
          deltaBuf += event.text;
          sink.onDelta({ messageId, channel: "text", text: event.text });
          clock.noteEvent();
        }
        break;
      case "assistant_message":
        if (event.text) parts.push({ type: "text", text: event.text });
        deltaBuf = "";
        break;
      case "tool_call": {
        // WP3.2 — the SDK reports a tool by its fully-qualified `mcp__<serverId>__<toolName>` name.
        // Split it so the part carries the human tool name + its origin `serverId` (the console's
        // per-server chips), falling back to the raw name for anything that isn't one of ours.
        const qualified = parseSubscriptionToolName(event.toolName);
        const attributed = qualified && grantedServerIds.has(qualified.serverId) ? qualified : null;
        const part: HubToolPart = {
          type: "tool_call",
          toolCallId: event.toolUseId,
          toolName: attributed ? attributed.toolName : event.toolName,
          source: "mcp",
          ...(attributed ? { serverId: attributed.serverId } : {}),
          state: "input-available",
          args: event.input,
        };
        parts.push(part);
        persist({ type: "tool_call", messageId, part });
        break;
      }
      case "tool_result":
        persist({
          type: "tool_result",
          toolCallId: event.toolUseId,
          state: event.isError ? "output-error" : "output-available",
          modelContent: event.result,
          ...(event.isError ? { isError: true } : {}),
        });
        break;
      case "turn_done":
        return { parts, usage: event.usage ? toHubUsage(event.usage) : undefined };
      case "limit_error":
        throw new SubscriptionRunError(event.kind, event.message);
      case "error":
        throw new SubscriptionRunError("driver", event.message);
      default:
        // "session" — the SDK session id; not modeled in the hub event vocabulary. Ignore.
        break;
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────

/**
 * Map the driver's raw `turn_done.usage` (Anthropic counters: `inputTokens` EXCLUDES the cache slice)
 * onto {@link HubUsage} (`tokensIn` INCLUDES it) — the SAME convention the Testing executor's
 * `toUsageActual` establishes, so a subscription Hub turn's `tokensIn` means the same thing an
 * API-keyed AI-SDK turn's does. Counts are EXACT (no estimation, D-CS4/D-AH17).
 */
function toHubUsage(usage: DriverUsage): HubUsage {
  const cacheReadTokens = usage.cacheReadInputTokens;
  const cacheWriteTokens = usage.cacheCreationInputTokens;
  const tokensIn = usage.inputTokens + cacheReadTokens + cacheWriteTokens;
  const out: HubUsage = { tokensIn, tokensOut: usage.outputTokens };
  if (cacheReadTokens > 0) out.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens > 0) out.cacheWriteTokens = cacheWriteTokens;
  return out;
}

/** {@link HubUsage} → the minimal {@link TokenUsageActual} shape `estimateCost` needs, preserving the
 *  cache-read/write split so cached tokens price at the cache rate rather than the full input rate. */
function usageForPricing(usage: HubUsage): TokenUsageActual {
  return {
    inputTokens: usage.tokensIn,
    outputTokens: usage.tokensOut,
    ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
  };
}

/** The text of the LAST settled `user_message` in a session's event log — the message that triggered
 *  this dispatch (the session-service always persists it immediately before calling this executor). */
function lastUserMessageText(events: HubEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === "user_message") return event.text;
  }
  return "";
}

/** A one-line capabilities summary for the prompt's session-context layer — mirrors turn-engine.ts's
 *  private `summarizeCapabilities` (duplicated here; not exported from that module). */
function describeCapabilities(caps: SessionCapabilities): string {
  const bits: string[] = [];
  if (caps.toolCalls) bits.push("tools");
  if (caps.contextWindow) bits.push("context accounting");
  bits.push(`tokens: ${caps.tokens}`);
  bits.push(`cost: ${caps.costBasis}`);
  if (caps.liveReasoning !== "none") bits.push(`reasoning: ${caps.liveReasoning}`);
  return bits.join(" · ");
}

/** A one-line budgets summary for the prompt's session-context layer — mirrors turn-engine.ts's private
 *  `summarizeBudgets` (duplicated here; not exported from that module). */
function describeBudgets(budgets: HubBudgets): string {
  const bits: string[] = [];
  if (budgets.maxTurns) bits.push(`${budgets.maxTurns} turns`);
  if (budgets.maxTokens) bits.push(`${budgets.maxTokens} tokens`);
  if (budgets.maxToolCalls) bits.push(`${budgets.maxToolCalls} tool calls`);
  if (budgets.maxCostUsd) bits.push(`$${budgets.maxCostUsd}`);
  if (budgets.maxDurationMs) bits.push(`${Math.round(budgets.maxDurationMs / 1000)}s`);
  return bits.length > 0 ? bits.join(" · ") : "none";
}
