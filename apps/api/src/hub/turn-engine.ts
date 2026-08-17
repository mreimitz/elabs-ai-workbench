// Assistant Hub (roadmap/assistant-hub/, WP1.1, §1.5 / D-AH3 / D-AH14) — the turn engine for the five
// AI-SDK model kinds.
//
// Per SETTLED user message this drives the §1.5 pipeline exactly once:
//   assemble the prompt (`hub/prompting`, mode-aware) → run the model (`streamText` on the injected
//   AI-SDK `LanguageModel` from `providers/registry.modelFor`) → expose the granted tools
//   (`hub/tools`, built by the caller and passed in) → STREAM (deltas forwarded, settled events
//   PERSISTED via `hub/repository`) → METER (token counting + `MODEL_PRICING`) → terminate through the
//   shared `terminalFor` table, clocked by the shared `SessionClock`.
//
// Composition-not-fork discipline (WP hard rule): the SessionClock / terminalFor / capability manifest
// / `modelFor` / pricing / token-counting / accounting are REUSED from their existing homes
// (`testing/session-clock.ts`, `testing/session-terminal.ts`, `providers/*`, `testing/accounting.ts`)
// — never re-derived here. The cross-domain `testing/*` imports are flagged in the WP report for a
// possible coordinated move to a neutral `sessions/` module (README §6); they are read-only reuse.
//
// The engine NEVER touches the testing tables (runs/run_steps/run_events/suites) — it emits hub events
// only. Streaming text/reasoning DELTAS are forwarded through the sink but are NEVER persisted (only
// settled events land in `hub_events` — the dock's code-quest lesson, R-SES1/§1.3).

import type {
  HubApprovalResolution,
  HubAutonomyLevel,
  HubBudgets,
  HubCitation,
  HubEvent,
  HubLimitRetrySource,
  HubMemory,
  HubMemoryKind,
  HubMessagePart,
  HubMissionStatus,
  HubSession,
  HubTextPart,
  HubToolArtifact,
  HubToolPart,
  HubToolSource,
  HubUsage,
  ProviderKind,
  RunOutcome,
  RunStatus,
  SessionCapabilities,
  StopReasonCode,
  ToolLoadingMode,
  WaitingInputReason,
} from "@mcp-token-footprint/shared";
import {
  HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS,
  HUB_WEB_SEARCH_BUILTIN,
} from "@mcp-token-footprint/shared";
import { convertAttachmentToMarkdown } from "./files/ingest.js";
import {
  stepCountIs,
  streamText,
  tool,
  type FilePart,
  type LanguageModel,
  type ModelMessage,
  type PrepareStepFunction,
  type StopCondition,
  type TextPart,
  type TextStreamPart,
  type Tool,
  type ToolSet,
} from "ai";
import { nanoid } from "nanoid";
import { isAuthRequiredError } from "../mcp/auth-error.js";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import { extractGroundingWebSources } from "../providers/registry.js";
import { extractProviderUsage, isContextOverflowError } from "../testing/accounting.js";
import { type AskUserBridge, buildAskUserAiTool } from "../testing/ask-user-tool.js";
import { SessionClock, type SessionClockTime } from "../testing/session-clock.js";
import { terminalFor, type TerminalCause } from "../testing/session-terminal.js";
import type { HubRepository } from "./repository.js";
import type { HubEventInput } from "./repository.js";
import { buildSessionEffectiveMemory } from "./memory-resolver.js";
import type { HubGenuiCatalogInjection, HubPromptMode } from "./prompting/index.js";
import { assembleSessionPrompt } from "./prompting/index.js";
import {
  credentialFieldName,
  type HubApprovalGateDecision,
  type HubElicitationDecision,
  type HubTurnElicitationResponder,
} from "./hitl.js";
import {
  safeExecuteBuiltin,
  type HubBuiltinTool,
  type HubToolExecutionContext,
} from "./tools/index.js";
import { sanitizeToolNamesForProvider } from "./tools/provider-tool-names.js";

// `providerOptions` is not re-exported from `ai`; derive the field type from `streamText`'s own params
// so it always matches the installed SDK (mirrors `testing/engine.ts`'s identical derivation). Exported
// so the session-service can type its resolver without re-importing `streamText` for a type alone.
export type StreamTextProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

/** Default per-turn step cap when the session declares no `maxTurns` budget (mirrors the Testing
 *  engine's `maxTurns ?? 20`). A single chat turn is usually 1 step; tool loops need a few more. */
export const HUB_DEFAULT_MAX_STEPS = 20;

// ── Streaming deltas (NOT persisted) ──────────────────────────────────────────────────────────────

/** The channel a streaming delta belongs to. `text` builds the answer; `reasoning` the thinking. */
export type HubStreamDeltaChannel = "text" | "reasoning";

/**
 * A streaming text/reasoning delta forwarded to the transport (WP1.2 relays it over SSE) but NEVER
 * persisted — the settled `assistant_message` carries the full text as ordered parts. Deliberately NOT
 * a {@link HubEvent} member: the persisted event log holds settled events only (R-SES1).
 */
export type HubStreamDelta = {
  messageId: string;
  channel: HubStreamDeltaChannel;
  text: string;
};

/**
 * The engine's OUTPUT seam — an emitter/callback the caller (WP1.2 routes) wires to SSE. `onEvent` is a
 * SETTLED, already-PERSISTED {@link HubEvent} (it carries `seq`/`at`) to forward live; `onDelta` is a
 * transient streaming delta to forward live but never persist. Deliberately NOT hard-wired to SSE — the
 * engine only calls functions (mirrors `testing/engine.ts`'s `EngineEmit`).
 */
export type HubTurnSink = {
  onEvent(event: HubEvent): void;
  onDelta(delta: HubStreamDelta): void;
};

/**
 * WP4.3 (R-SES9/R-UX11) — the three hub signals that surface to the app's existing notification
 * center (`waiting_input`/mission-terminal/budget-trip). A minimal, primitive payload (ids + the
 * already-resolved code/reason) rather than full domain objects, so this type has no dependency on
 * `hub/repository.ts`/`hub/missions/*` — the wiring closure (`index.ts`) re-reads whatever richer
 * detail it wants to put in the notification body from the repository itself, keyed off these ids.
 * `hub/routes.ts` fires `waiting_input`/`session_budget_trip`; `hub/missions/routes.ts` fires
 * `mission_terminal` — both accept the SAME optional `notify?: HubNotifySink` on their route deps
 * (absent ⇒ no notification, the established "honest not-yet-actionable" degrade).
 */
export type HubNotifyEvent =
  | { kind: "waiting_input"; sessionId: string; reason?: WaitingInputReason }
  | { kind: "mission_terminal"; missionId: string; sessionId: string; status: HubMissionStatus }
  | { kind: "session_budget_trip"; sessionId: string; stopReasonCode: StopReasonCode };

export type HubNotifySink = (event: HubNotifyEvent) => void;

/** The `StopReasonCode`s that represent a tripped BUDGET meter (max turns/tokens/context/cost/tool
 *  calls) — the R-UX11 "budget-trip" notification trigger, as opposed to a guardrail stop (stall/
 *  wait_expired/user_stop/…) or a genuine failure (provider_error/auth/rate_limit). */
const BUDGET_TRIP_STOP_REASON_CODES: ReadonlySet<StopReasonCode> = new Set([
  "max_turns",
  "max_tokens",
  "max_context_tokens",
  "max_cost",
  "max_tool_calls",
]);

export function isBudgetTripStopReason(code: StopReasonCode | undefined): code is StopReasonCode {
  return code !== undefined && BUDGET_TRIP_STOP_REASON_CODES.has(code);
}

/**
 * Wrap a sink so a `waiting_input` phase event ALSO fires `notify` (WP4.3, R-SES9/R-UX11) — used by
 * `hub/routes.ts`'s `.../messages` handler on the sink it hands the turn engine. A `phase` event only
 * carries `phase:"waiting_input"` on the SINGLE settled event `turn-engine.ts`'s `beginWait` persists
 * per wait bracket (ref-counted — see its own doc), so this fires exactly once per genuine wait onset,
 * never per poll/step. `notify` absent ⇒ returns `base` UNCHANGED (a plain passthrough, zero overhead
 * — every pre-WP4.3 caller keeps working unchanged). Pulled out as its own function (rather than
 * inlined at the route) so this exact wrapping logic is directly unit-testable without a real turn.
 */
export function wrapSinkForWaitingInputNotify(
  base: HubTurnSink,
  sessionId: string,
  notify: HubNotifySink | undefined,
): HubTurnSink {
  if (!notify) return base;
  return {
    onEvent: (event) => {
      if (event.type === "phase" && event.phase === "waiting_input") {
        notify({
          kind: "waiting_input",
          sessionId,
          ...(event.detail?.reason ? { reason: event.detail.reason } : {}),
        });
      }
      base.onEvent(event);
    },
    onDelta: base.onDelta,
  };
}

// ── Steering queue (R-SES3, durable) ──────────────────────────────────────────────────────────────

/** A message typed WHILE a turn is running, queued for injection at the next step boundary. */
export type HubQueuedMessage = {
  queuedMessageId: string;
  text: string;
  model?: string;
  /** model-identity WP6.1 (F4) — the credential REQUESTED for {@link model}. Recorded, never applied:
   *  see {@link HubQueuedUserMessageEvent.providerCredentialId} for why the running turn cannot honour
   *  it. Kept on the in-memory shape so `reconstructPending` round-trips it across a restart. */
  providerCredentialId?: string;
  attachmentFileIds?: string[];
};

/**
 * R-SES3 — the durable steering queue for ONE live session. A message typed while the turn is running is
 * `enqueue`d: it is persisted IMMEDIATELY as a `queued_user_message` event (so it survives a restart —
 * losing one is a bug) and held in an in-memory pending list. The turn engine drains the pending list at
 * a step boundary and injects each as a `user_message`. Durability lives in the persisted events; the
 * in-memory list is a fast path reconstructible from the log via {@link reconstructPending}.
 */
export class HubSteeringQueue {
  private pending: HubQueuedMessage[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly repository: HubRepository,
  ) {}

  /** Persist a steering message (durable) and add it to the pending list. Returns the settled event so
   *  the caller can forward it live to the sink. */
  enqueue(input: {
    text: string;
    model?: string;
    /** model-identity WP6.1 (F4) — recorded on the event so the operator's ask is not lost. */
    providerCredentialId?: string;
    attachmentFileIds?: string[];
  }): HubEvent {
    const queuedMessageId = nanoid();
    const event = this.repository.appendEvent(this.sessionId, {
      type: "queued_user_message",
      queuedMessageId,
      text: input.text,
      ...(input.model ? { model: input.model } : {}),
      ...(input.providerCredentialId ? { providerCredentialId: input.providerCredentialId } : {}),
      ...(input.attachmentFileIds ? { attachmentFileIds: input.attachmentFileIds } : {}),
    });
    this.pending.push({
      queuedMessageId,
      text: input.text,
      model: input.model,
      providerCredentialId: input.providerCredentialId,
      attachmentFileIds: input.attachmentFileIds,
    });
    return event;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Return and clear the pending list (injected by the engine at a step boundary). */
  drainPending(): HubQueuedMessage[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Seed the in-memory pending list from a persisted event log (restart durability): every
   *  `queued_user_message` with NO matching injected `user_message` (correlated by id) is still pending. */
  seedFromEvents(events: HubEvent[]): void {
    this.pending = HubSteeringQueue.reconstructPending(events);
  }

  /**
   * The un-injected queued messages in a session's event log: a `queued_user_message` is injected when a
   * later `user_message` carries its `queuedMessageId` as its `messageId` (the correlation the engine
   * writes). Any queued message without such a match is still pending (survives a restart, R-SES3).
   */
  static reconstructPending(events: HubEvent[]): HubQueuedMessage[] {
    const injectedIds = new Set(
      events.filter((e) => e.type === "user_message").map((e) => e.messageId),
    );
    return events
      .filter(
        (e): e is Extract<HubEvent, { type: "queued_user_message" }> =>
          e.type === "queued_user_message",
      )
      .filter((e) => !injectedIds.has(e.queuedMessageId))
      .map((e) => ({
        queuedMessageId: e.queuedMessageId,
        text: e.text,
        model: e.model,
        providerCredentialId: e.providerCredentialId,
        attachmentFileIds: e.attachmentFileIds,
      }));
  }
}

// ── Tool wiring (the AI-SDK adapter for in-process built-ins — WP1.1 owns it, per `tools/types.ts`) ──

/**
 * Build one AI-SDK `Tool` per granted in-process built-in. The `tools/types.ts` doc notes the AI-SDK
 * adapter is WP1.1's job (the turn engine owns provider wiring); this is it. The built-in's zod
 * `inputSchema` is passed straight to `tool()`; `execute` routes through {@link safeExecuteBuiltin} (so
 * a built-in failure is DATA the model can self-correct on — R-MCP6 — never a thrown turn), returning
 * the MODEL-VISIBLE `modelContent`. An `isError` result is surfaced MCP-style (`{isError:true,…}`) so
 * the stream renders it as a failed `tool_result` step, exactly like a bridged MCP tool.
 *
 * WP3.4 addition: when a built-in also returns a UI-visible `artifact` (e.g. `files.write`/`files.edit`
 * producing a workspace file — R-GUI3's split channel), it is written into `artifactSink` keyed by the
 * AI SDK's own `toolCallId` rather than returned to the model — see `HubResolvedToolset.toolArtifacts`'s
 * doc for how the "tool-result" persist step re-attaches it to the settled event. `artifactSink` is
 * optional so a caller that doesn't care about produced-asset rendering (e.g. an existing test) is
 * unaffected — byte-identical to the pre-WP3.4 behavior when omitted.
 */
export function buildHubBuiltinTools(
  builtins: readonly HubBuiltinTool[],
  ctx: HubToolExecutionContext,
  artifactSink?: Map<string, HubToolArtifact>,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const builtin of builtins) {
    tools[builtin.name] = tool({
      description: builtin.description,
      inputSchema: builtin.inputSchema,
      execute: async (input: unknown, options: { toolCallId?: string }): Promise<unknown> => {
        const result = await safeExecuteBuiltin(builtin, input, ctx);
        if (result.isError) {
          return {
            isError: true,
            content: [{ type: "text", text: result.errorText ?? "tool error" }],
          };
        }
        if (result.artifact && artifactSink && options?.toolCallId) {
          artifactSink.set(options.toolCallId, result.artifact);
        }
        return result.modelContent;
      },
    });
  }
  return tools;
}

/**
 * The resolved tool surface for a turn: the built AI-SDK `tools` map handed to `streamText`, the
 * pre-formatted `toolListText` the prompt's LAYER-3 injection uses, the resolved loading mode, and a
 * `source`/`serverId` lookup so an emitted `tool_call` part is tagged with its origin. Built by the
 * caller (the session-service's `resolveToolset` seam — default built-ins-only; WP1.4 adds MCP).
 */
export type HubResolvedToolset = {
  tools: ToolSet;
  toolListText?: string;
  /** WP2.4/R-SK1 — the attached-skill L1 catalog text (name + truncated description, or bare name for
   *  a demoted/`name_only` entry) — `""`/absent when nothing is attached or every attachment is
   *  `user_only` (R-SK1's "zero skills → no catalog at all"). Injected into the same LAYER-3 prompt
   *  section as `toolListText` (`hub/prompting/layers/tools.ts`). */
  skillsListText?: string;
  loadingMode?: ToolLoadingMode;
  /** WP2.6/R-GUI1 — the compiled GenUI catalog to inject into the prompt's LAYER-4 seam, present iff the
   *  session's toolset includes the `present`/`prompt_user` emission tools. Absent ⇒ the GenUI layer is
   *  omitted and the model is never told about `present` (chat turns stay lighter — Appendix B). */
  genuiCatalog?: HubGenuiCatalogInjection;
  /** Exposed tool name → its source (`builtin`/`mcp`/…). Unknown names default to `builtin`. */
  sources?: Record<string, HubToolSource>;
  /** Exposed tool name → the registered MCP server id (only for `mcp`-source tools). */
  serverIds?: Record<string, string>;
  /**
   * WP1.1 (D-HF1, RC1) — deferred-loading gate. The exposed names of granted MCP tools built into
   * `tools` but NOT resident: each step the engine's `prepareStep` computes `activeTools` = every tool
   * EXCEPT the deferred names that aren't (yet) in `promoted`. Absent/empty ⇒ no per-step gating (eager
   * mode) and `streamText` runs byte-identically to pre-WP1.1 (no `prepareStep`).
   */
  deferredNames?: ReadonlySet<string>;
  /**
   * WP1.1 (D-HF1) — the per-turn promotion set. The `tool_search` built-in ADDS a discovered tool's
   * exposed name here on execute; `prepareStep` then activates it for the NEXT step of the same turn.
   * Shared (same object) with the toolset's `tool_search` closure so a mutation is visible here. Only
   * meaningful alongside `deferredNames`.
   */
  promoted?: ReadonlySet<string>;
  /** WP2.3 — exposed tool name → the R-MCP3 approval-policy metadata the turn's HITL gate resolves
   *  against (source + annotations + server trust). Absent name ⇒ the gate treats it as first-party
   *  (never gated). Populated by the session-service; absent entirely on the WP1.1 built-ins path. */
  approvalMeta?: Record<string, import("./hitl.js").HubApprovalMeta>;
  /**
   * WP3.4 — the R-GUI3 UI-visible result channel for THIS turn's tool calls, keyed by `toolCallId` and
   * mutated DURING execution (the built built-ins/MCP tools write into it as they settle — see
   * `buildHubBuiltinTools`/`hub/tools/output-caps.ts`'s `applyOutputCapToMcpTools`). The turn's
   * "tool-result" persist step reads it back by `toolCallId` to attach `HubToolResultEvent.artifact`
   * (e.g. an output-cap spill reference, or a produced workspace file) without the AI SDK's `execute()`
   * return value having to carry two channels through the model-context path. Absent/no entry ⇒ no
   * artifact — unchanged pre-WP3.4 behavior.
   */
  toolArtifacts?: Map<string, HubToolArtifact>;
};

// ── WP1.4 citation post-pass seam ─────────────────────────────────────────────────────────────────

/** The draft handed to the citation post-pass just BEFORE the settled `assistant_message` is persisted
 *  (events are append-only, so citations must be resolved before persistence, not after — §1.7). */
export type HubAssistantDraft = {
  messageId: string;
  /** The ordered parts built from the stream (text/reasoning/tool refs). */
  parts: HubMessagePart[];
  /** The concatenated assistant text (the `[n]` marker carrier the post-pass scans). */
  text: string;
  /** The settled tool results of this pass — the citation extractor's source material (§1.7). */
  toolResults: Array<{ toolCallId: string; toolName: string; output: unknown; isError: boolean }>;
  /** hub-fixes WP5.1 (RC5, D-HF2) — web sources the PROVIDER surfaced OUTSIDE a mineable tool-result:
   *  Google search-grounding lists its cited pages on the step's `providerMetadata`, not as a tool
   *  output (Anthropic/OpenAI results DO arrive as tool-results and are read from `toolResults`). The
   *  session-service's composed post-pass folds these into the citation ledger. Absent ⇒ none. */
  providerSearchSources?: Array<{
    title: string;
    url?: string;
    snippet?: string;
    toolCallId?: string;
  }>;
};

/**
 * WP1.4's deterministic citation post-pass (D-AH10 / §1.7). Given the assistant draft, it returns the
 * (possibly rewritten) ordered `parts` — e.g. with `citation` parts spliced in — and the resolved
 * `citations[]`. WP1.1 leaves it undefined (no citations); WP1.4 supplies it via the session-service.
 */
export type HubCitationPostPass = (
  draft: HubAssistantDraft,
) =>
  | { parts?: HubMessagePart[]; citations?: HubCitation[] }
  | Promise<{ parts?: HubMessagePart[]; citations?: HubCitation[] }>;

// ── Live HITL seam (WP2.3 — GAP-A/GAP-B) ────────────────────────────────────────────────────────
//
// The turn engine OWNS the interception (emit the event, enter `waiting_input`, resume on the
// decision); this seam is the async bridge to the decision routes + the session's autonomy/annotation
// policy. Built by the session-service around the shared `HubHitlCoordinator`, ALREADY bound to this
// session's id + granted MCP servers. ABSENT (WP1.1 tests, the mission agent runner) ⇒ no gating at
// all — the auto-run/no-gate path stays byte-identical (no wrap, no extra event, no wait).
export type HubTurnHitl = {
  /** The autonomy dial in force this turn (stamped on emitted approval events for audit — R-UX7). */
  autonomy: HubAutonomyLevel;
  /** Resolve whether a tool COULD require approval under the dial+policy (the WRAP decision). `null` /
   *  `{gated:false}` ⇒ the tool is left untouched (byte-identical auto-run). */
  gate(toolName: string): HubApprovalGateDecision | null;
  /** Await an operator decision on a pending approval (the route resolves it). */
  waitForApproval(toolCallId: string): Promise<HubApprovalResolution>;
  /** Session-scoped "don't ask again" (R-MCP3) — checked/recorded at call time (never for destructive). */
  hasAlways(toolName: string): boolean;
  recordAlways(toolName: string): void;
  /** Register the turn's elicitation responder (R-MCP4) so a driven MCP server's `elicitation/create`
   *  routes back here. */
  bindElicitationResponder(responder: HubTurnElicitationResponder): void;
  /** Await an operator response to a pending elicitation (the route resolves it). */
  waitForElicitation(elicitationId: string): Promise<HubElicitationDecision>;
  /** Await the operator's answer to an agent-initiated `ask_user` question (the `POST …/answers` route
   *  resolves it; `null` when stopped before answering). */
  waitForQuestion(questionId: string): Promise<string | null>;
  /** Tear down this turn's HITL state (unbind responder, settle any dangling pending decisions). */
  release(): void;
};

// ── Compaction seam (WP3.3, R-SES8) ───────────────────────────────────────────────────────────────
//
// The turn engine reconstructs its model history from the event log at turn start. When a `compactor`
// is wired (the session-service builds one per dispatch), the engine delegates that reconstruction to it
// so the history can be COMPACTED before the model runs: cold tool outputs cleared, then the cold region
// summarized (persisted as a rolling summary + a `compaction` event via the engine's own `persist`
// choke point). ABSENT ⇒ the engine reconstructs verbatim via `reconstructMessages`, byte-identical to
// pre-WP3.3 (the existing engine tests pass no compactor, so they are unaffected). A `thrash` outcome
// stops the turn honestly BEFORE any model call — never a re-summarize loop (R-SES8).

/** The prepared history for a turn: the (possibly compacted) messages + an optional system-prompt suffix
 *  carrying the rolling summary, OR an honest thrash-stop (compaction could not free enough context). */
export type HubCompactionPrepared =
  | { kind: "ready"; messages: ModelMessage[]; systemSuffix?: string }
  | { kind: "thrash"; message: string };

/** The compaction seam the turn engine consumes. Implemented by `hub/compaction.ts`'s `createHubCompactor`. */
export type HubTurnCompactor = {
  /** Prepare (and, if over budget, compact) the turn's history. Called ONCE at turn start. `persist` is
   *  the engine's single event choke point (so a `compaction` event rolls the clock + streams live). */
  prepareTurn(input: {
    events: HubEvent[];
    systemText: string;
    persist: (event: HubEventInput) => HubEvent;
  }): Promise<HubCompactionPrepared>;
};

/** The model-visible result returned for a DENIED tool call (R-UX1 `output-denied`) — MCP-error shaped
 *  so the stream renders it as a failed step the model self-corrects on, never a session crash. */
const HUB_TOOL_DENIED_RESULT = {
  isError: true,
  content: [
    {
      type: "text",
      text: "The user denied this tool call. Do not retry it; continue without it or ask the user how to proceed.",
    },
  ],
} as const;

// ── Turn engine ─────────────────────────────────────────────────────────────────────────────────

export type HubTurnEngineDeps = {
  repository: HubRepository;
};

export type HubTurnInput = {
  /** The current session snapshot (already flipped to `running` by the session-service). */
  session: HubSession;
  /** The prompt mode LAYER-9 addendum selects (session-service maps `session.mode` → this). */
  promptMode: HubPromptMode;
  /** The AI-SDK model, already built via `providers/registry.modelFor(cred, effectiveModel)`. */
  model: LanguageModel;
  /** The AI-SDK provider kind — selects the provider-actual usage mapping (never `acme_answers`). */
  providerKind: ProviderKind;
  /** The EFFECTIVE per-message model id (override ?? session.model) — the pricing/context key + the
   *  `model` stamped on the settled `assistant_message` (R-SES10 per-message transparency). */
  modelId: string;
  /** The capability manifest for this turn's kind (persisted + surfaced; the UI gates on it — D-US4). */
  capabilities: SessionCapabilities;
  /** The model's context window (`MODEL_CONTEXT_LIMITS[modelId]`) — informational for this WP. */
  contextWindow: number;
  /** The resolved tool surface (built AI-SDK tools + prompt injection metadata). */
  toolset: HubResolvedToolset;
  /** Provider-native escape hatch (e.g. Anthropic cache_control / thinking), from `providerOptions()`. */
  providerOptions?: StreamTextProviderOptions;
  /** Per-session hard-cap budgets (D-AH9) — enforced server-side regardless of any dial. */
  budgets?: HubBudgets;
  /** Stop signal — `session-service.stop()` aborts it; the turn preserves partial work (R-SES3). */
  abortSignal: AbortSignal;
  /** The durable steering queue for this session (R-SES3). */
  steering: HubSteeringQueue;
  /** The output seam (deltas forwarded, settled events persisted + forwarded). */
  sink: HubTurnSink;
  /** SessionClock stall/wait/wall-cap overrides (tests inject a fake time source). */
  clockOptions?: {
    stallMs?: number;
    waitBudgetMs?: number;
    maxDurationMs?: number;
    time?: SessionClockTime;
  };
  /** WP1.4 seam — the citation post-pass run before each settled `assistant_message` is persisted. */
  citationPostPass?: HubCitationPostPass;
  /** WP2.3 seam — live HITL (approval-gated tools + MCP elicitation). Absent ⇒ no gating (byte-identical). */
  hitl?: HubTurnHitl;
  /** WP3.3 seam (R-SES8) — context-window compaction. Absent ⇒ history is reconstructed verbatim
   *  (byte-identical to pre-WP3.3). Present ⇒ the history is compacted at turn start; a `thrash` outcome
   *  stops the turn honestly before any model call. */
  compactor?: HubTurnCompactor;
  ownerName?: string;
  /** ISO date stamped into the prompt's session-context layer (defaults to now). */
  now?: string;
  /** WP3.1 (D-AH11c) — the char cap on the assembled project instructions + pinned files body
   *  (`config.hubProjectContextMaxChars`, `HUB_PROJECT_CONTEXT_MAX_CHARS`). Defaults to
   *  {@link HUB_DEFAULT_PROJECT_CONTEXT_MAX_CHARS} when unset (mirrors `maxSteps`'s own default). */
  projectContextMaxChars?: number;
  /** hub-fixes WP2.1 (RC2, §8.4) — REPLACE the assembled system prompt with this exact text for the
   *  turn. The mission agent-turn seam (`session-service.runAgentTurn`) passes the ROLE prompt here so a
   *  subagent turn runs as a curated specialist (identity replaced), not the general Assistant — the
   *  same isolation the one-shot runner enforced, now on the real turn path. Absent ⇒ byte-identical to
   *  every existing caller (the mode-assembled prompt is used); `promptVersion` is still stamped from the
   *  assembled prompt either way. */
  systemPromptOverride?: string;
};

/** The disposition of one settled turn (returned to the session-service for auto-title / release). */
export type HubTurnResult = {
  status: RunStatus;
  outcome: RunOutcome;
  stopReasonCode?: StopReasonCode;
  /** This turn's cost/tokens (the session-service folds them into the session totals). */
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  activeDurationMs: number;
  totalDurationMs: number;
  /** True on the happy path (the model finished on its own); false on any abnormal terminal. */
  completed: boolean;
};

/** The reason one `streamText` pass ended (drives the steering loop + terminal resolution). */
type PassOutcome = {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  streamError?: string;
  overflowError?: string;
  limitError?: string;
  budgetTrip?: TerminalCause;
};

/** Explicit cut-off notes appended to a preserved partial answer on an abnormal terminal (R-SES11). */
const CUTOFF_NOTES = {
  aborted: "\n\n_(Response stopped.)_",
  limit: "\n\n_(Response cut off — the provider limit was reached.)_",
  error: "\n\n_(Response cut off — an error occurred.)_",
  overflow: "\n\n_(Response cut off — the context window was exceeded.)_",
  budget: "\n\n_(Response stopped — a budget was reached.)_",
} as const;

/**
 * Run ONE turn for a settled user message on an AI-SDK model. The session-service persists the settled
 * `user_message` BEFORE calling this (so the reconstructed history already ends with the current turn)
 * and passes a fresh session snapshot.
 */
export async function runHubTurn(
  deps: HubTurnEngineDeps,
  input: HubTurnInput,
): Promise<HubTurnResult> {
  const { repository } = deps;
  const { session, sink, steering, providerKind, modelId } = input;
  const sessionId = session.id;

  // ── SessionClock (Unified Sessions, D-US3/D-US7) — the ONE timer engine, reused not forked. Firing
  //    any cause aborts `clockAbort`, combined into `effectiveSignal` so the live stream is cut off.
  const clockAbort = new AbortController();
  let clock!: SessionClock;
  clock = new SessionClock({
    ...(input.clockOptions?.stallMs !== undefined ? { stallMs: input.clockOptions.stallMs } : {}),
    ...(input.clockOptions?.waitBudgetMs !== undefined
      ? { waitBudgetMs: input.clockOptions.waitBudgetMs }
      : {}),
    ...(input.clockOptions?.maxDurationMs !== undefined
      ? { maxDurationMs: input.clockOptions.maxDurationMs }
      : input.budgets?.maxDurationMs
        ? { maxDurationMs: input.budgets.maxDurationMs }
        : {}),
    ...(input.clockOptions?.time ? { time: input.clockOptions.time } : {}),
    onFire: () => {
      // Stop ordering (D-US1): `fire()` latched the verdict BEFORE this callback, so surface the
      // transient `stopping` phase, then signal the stop.
      persist({ type: "phase", phase: "stopping" });
      clockAbort.abort();
    },
  });

  // Persist a settled event, roll the stall timer, and forward it live to the sink. The ONE choke point
  // for every settled event this turn emits (mirrors the run manager's single emit point).
  const persist = (event: HubEventInput): HubEvent => {
    const settled = repository.appendEvent(sessionId, event);
    clock.noteEvent();
    sink.onEvent(settled);
    return settled;
  };

  clock.start();
  const effectiveSignal = combineAbortSignals(input.abortSignal, clockAbort.signal);
  const isAborted = (): boolean => input.abortSignal.aborted;

  // ── Live HITL (WP2.3, R-MCP3/R-MCP4/R-UX1) — a ref-counted `waiting_input` bracket + a denied-call
  //    set. Ref-counting (not a bare enter/resume) because the AI-SDK may execute several tool calls of
  //    one step concurrently — two approvals (or an approval + an elicitation) can be pending at once;
  //    only the first arms the SessionClock wait, only the last resumes it.
  const hitl = input.hitl;
  let waitDepth = 0;
  const deniedCallIds = new Set<string>();
  const beginWait = (reason: "approval" | "elicitation" | "question"): void => {
    if (waitDepth === 0 && !clock.isWaiting && !clock.fired) {
      clock.enterWaiting();
      repository.setSessionLifecycle(sessionId, {
        phase: "waiting_input",
        waitDeadlineAt: clock.deadlineAt ?? null,
      });
      persist({
        type: "phase",
        phase: "waiting_input",
        detail: { reason, ...(clock.deadlineAt ? { deadlineAt: clock.deadlineAt } : {}) },
      });
    }
    waitDepth += 1;
  };
  const endWait = (): void => {
    waitDepth = Math.max(0, waitDepth - 1);
    if (waitDepth === 0 && clock.isWaiting) {
      clock.resumeFromWaiting();
      repository.setSessionLifecycle(sessionId, { phase: null, waitDeadlineAt: null });
      persist({ type: "phase", phase: null });
    }
  };
  // Race a pending decision against the turn's abort (Stop / clock fire / wait_expired): an abort
  // during a wait settles the decision to a safe default (deny an approval, cancel an elicitation) so
  // the tool wrapper / responder never hangs while the stream tears down.
  const raceAbort = <T>(promise: Promise<T>, onAbort: T): Promise<T> => {
    if (effectiveSignal.aborted) return Promise.resolve(onAbort);
    return new Promise<T>((resolve) => {
      let settled = false;
      const onAbortEvt = (): void => {
        if (settled) return;
        settled = true;
        resolve(onAbort);
      };
      effectiveSignal.addEventListener("abort", onAbortEvt, { once: true });
      void promise.then((value) => {
        if (settled) return;
        settled = true;
        effectiveSignal.removeEventListener("abort", onAbortEvt);
        resolve(value);
      });
    });
  };

  // The MCP elicitation responder (R-MCP4): emit the request, refuse a credential-shaped field outright,
  // otherwise enter `waiting_input` and await the operator. Bound to the coordinator so a driven MCP
  // server's `elicitation/create` routes here (via the session-service seam) — only when HITL is wired.
  if (hitl) {
    const respondToElicitation: HubTurnElicitationResponder = async (request) => {
      const elicitationId = nanoid();
      const requestedEvent: HubEventInput = {
        type: "elicitation_requested",
        elicitationId,
        mode: request.mode,
        message: request.message,
        ...(request.serverId ? { serverId: request.serverId } : {}),
        ...(request.serverName ? { serverName: request.serverName } : {}),
        ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
        ...(request.requestedSchema !== undefined
          ? { requestedSchema: request.requestedSchema }
          : {}),
        ...(request.url ? { url: request.url } : {}),
      };
      const credField =
        request.mode === "form" ? credentialFieldName(request.requestedSchema) : undefined;
      if (credField) {
        persist(requestedEvent);
        persist({
          type: "elicitation_responded",
          elicitationId,
          action: "decline",
          autoDeclined: true,
          reason: `Refused: the tool asked for a credential-shaped field ("${credField}"). Elicitation never collects secrets.`,
        });
        return { action: "decline" };
      }
      // Register the mailbox BEFORE emitting the request (same reasoning as the approval wrapper).
      const decisionPromise = hitl.waitForElicitation(elicitationId);
      persist(requestedEvent);
      beginWait("elicitation");
      let decision: HubElicitationDecision;
      try {
        decision = await raceAbort<HubElicitationDecision>(decisionPromise, { action: "cancel" });
      } finally {
        endWait();
      }
      persist({ type: "elicitation_responded", elicitationId, action: decision.action });
      return decision;
    };
    hitl.bindElicitationResponder(respondToElicitation);
  }

  // Wrap the granted tools with the approval gate (R-MCP3/R-UX1). Only tools the gate says COULD ask are
  // wrapped; everything else (first-party built-ins, auto-eligible read-only tools under a non-ask dial,
  // or ANY tool when HITL is unwired) is passed straight through — byte-identical to WP1.1.
  const gatedTools: ToolSet = hitl ? gateTools(input.toolset.tools, hitl) : input.toolset.tools;

  // ── Interactive `ask_user` (both hub paths reuse the Testing primitive). Exposed ONLY on interactive
  //    foreground sessions (`capabilities.askUser` — the session-service sets it false for mission
  //    agent/synthesis turns) and only when HITL is wired (the coordinator seam the answer route resolves
  //    through). The bridge translates the tool's `RunEvent`-shaped emits into persisted hub events and
  //    SWALLOWS its own `phase` emit — the engine's ref-counted `beginWait`/`endWait` already own the
  //    `waiting_input` bracket (so a simultaneous approval + question shares one correct clock wait). The
  //    wait is bracketed by `raceAbort` so Stop / clock-fire settles the answer to `null` (→ the tool
  //    returns the honest "stopped without answering" result) rather than hanging.
  let effectiveTools: ToolSet = gatedTools;
  if (input.capabilities.askUser === true && hitl) {
    const askBridge: AskUserBridge = {
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
        }
        // `phase` emits are SWALLOWED — beginWait/endWait own the `waiting_input` bracket here.
      },
      waitForAnswer: (questionId) => raceAbort<string | null>(hitl.waitForQuestion(questionId), null),
      enterWaiting: () => {
        beginWait("question");
        return clock.deadlineAt;
      },
      resumeFromWaiting: () => endWait(),
    };
    effectiveTools = { ...gatedTools, ...buildAskUserAiTool(askBridge) };
  }

  // ── P0 provider tool-name boundary. Providers (notably Anthropic) reject a tool NAME that doesn't
  //    match `^[a-zA-Z0-9_-]{1,128}$`, but the hub's granted tools carry DOTTED internal keys
  //    (`files.write`, `artifacts.create`, `memory.propose_save`, …) — the PERSISTED grant identifiers
  //    referenced by grants/prompt/UI/tests, which must not be renamed. Re-key the toolset to
  //    provider-safe names ONLY for the model call; every emitted tool-call/result/error is translated
  //    BACK to the internal name via `toInternalName`, so sources/serverIds/persistence/UI stay on the
  //    dotted keys. Deterministic + bijective (no tool lost, no two internals collapsed) — see
  //    `tools/provider-tool-names.ts`. `toolCallId` (the result/artifact routing key) is untouched.
  const { providerTools, toInternalName } = sanitizeToolNamesForProvider(effectiveTools);

  // ── WP1.1 (D-HF1, RC1) — deferred-tool promotion gate. In deferred mode the granted-but-not-resident
  //    MCP tools are BUILT into `providerTools` (so they're callable) but must be HIDDEN from the model
  //    each step until a `tool_search` hit promotes them (`input.toolset.promoted`). `prepareStep`
  //    (ai@7) recomputes `activeTools` before every step: every provider tool EXCEPT a deferred name not
  //    yet promoted. The `promoted` set is mutated by `tool_search.execute` DURING a step, so the next
  //    step's `prepareStep` sees the new grant. `deferredNames`/`promoted` are keyed by the internal
  //    (dotted/exposed) name; we map each provider-safe key back via `toInternalName`. Absent deferred
  //    names ⇒ NO `prepareStep` at all (eager mode stays byte-identical to pre-WP1.1).
  const deferredNames = input.toolset.deferredNames;
  const promotedNames = input.toolset.promoted;
  const prepareStep: PrepareStepFunction<ToolSet> | undefined =
    deferredNames && deferredNames.size > 0
      ? () => {
          const activeTools = Object.keys(providerTools).filter((providerName) => {
            const internal = toInternalName(providerName);
            // A deferred tool is inactive until promoted; everything else is always active.
            return !(deferredNames.has(internal) && !promotedNames?.has(internal));
          });
          return { activeTools };
        }
      : undefined;

  // Issue-#10 parity (cost cap only meaningful when priced): warn once, never refuse (hub budgets are
  // advisory in v1). An unpriced model's cost reads a floor of 0.
  if (input.budgets?.maxCostUsd && !isModelPriced(modelId)) {
    console.warn(
      `[hub ${sessionId}] maxCostUsd is set but model "${modelId}" has no known pricing; the cost cap cannot fire.`,
    );
  }

  // ── WP3.1 (D-AH11c) — resolve the project's real name (LAYER 2) + its instructions + pinned files
  //    (LAYER 6b) ONCE per turn. `undefined` when the session isn't in a project. The turn history
  //    itself is reconstructed (and, under WP3.3, compacted) below — see the compaction block.
  const projectContext = session.projectId
    ? resolveProjectContext(
        repository,
        session.projectId,
        input.projectContextMaxChars ?? HUB_DEFAULT_PROJECT_CONTEXT_MAX_CHARS,
      )
    : undefined;

  // WP3.2 (D-AH11) + WP2.0b (WP1.R-B, D-HUX11) — LAYER 6a's injected body: the session's RESOLVED
  // effective memory STACK (profile → project → crew → agent, most-specific-wins), not every active
  // row in the DB. `buildSessionEffectiveMemory` is the WP1.5 resolver — the SAME builder the context
  // inspector's `effectiveMemory` field calls (`context-inspector.ts`) — so the injected set is
  // PROVABLY identical to what the Context panel shows (display/injection parity, the "everything
  // injected is inspectable" invariant). A memory row scoped to another session's project/crew/agent
  // is never a layer here (the builder only adds layers THIS session's OWN project/crew/agent resolve
  // to), so scoped memory never leaks across sessions (hub-turn-engine-memory-injection.test.ts).
  // `summarizeMemory` returns `undefined` on an empty entry list, which OMITS the `memory` key below —
  // `assembleSessionPrompt` then skips the whole layer (its own "conditional layers" contract), so a
  // profile-only DB (every legacy/old session, or any session before scoped-memory creation ships in
  // WP2.7) injects the SAME CONTENT SET as the pre-WP2.0b flat-global read (nothing added, nothing
  // dropped — the resolver excludes only archived/proposed rows, exactly as the old unscoped
  // `listMemory({status:"active"})` did). Bullet ORDER within a kind section may differ from the old
  // `updated_at DESC` read when 2+ rows share a kind: the resolver deliberately orders survivors by
  // `createdAt` ascending (its own documented, tested contract — `memory-resolver.ts`) so the injected
  // order is the SAME canonical order the Context panel will show, which is the point of this fix; this
  // is a one-time, intentional reordering, not data loss. Nothing hidden (D-AH11): this is the SAME
  // text the Memory panel and the context inspector (R-SES7) show, never a separate/filtered view.
  const effectiveMemory = buildSessionEffectiveMemory(repository, sessionId);
  const memorySummary = summarizeMemory(effectiveMemory.entries);

  // WP3.4 — resolve an `attachmentFileIds` entry to its bytes for multimodal pass-through; a deleted/
  // missing file is skipped (never a thrown turn — an upload's lifecycle is independent of a turn's).
  // Threaded into `reconstructMessages` in the compaction block below (the non-compacted path folds
  // attachments in; the compactor path — WP3.3 — reconstructs verbatim without attachments, unchanged).
  //
  // v1-fixes (attachment ingestion) — BEFORE the sync resolver runs, convert every referenced document
  // attachment (pdf/docx/xlsx/pptx/html) to markdown once (content-hash cached across turns), so the
  // resolver can hand `reconstructMessages` model-readable text for EVERY model kind. A conversion
  // failure keeps the pre-fix raw-part behavior — never a failed turn.
  const extractedTextByFileId = new Map<string, string>();
  {
    const referenced = new Set<string>();
    for (const event of repository.listEvents(sessionId)) {
      if (event.type === "user_message" || event.type === "queued_user_message") {
        for (const id of event.attachmentFileIds ?? []) referenced.add(id);
      }
    }
    for (const fileId of referenced) {
      try {
        const file = repository.getFile(fileId);
        const conversion = await convertAttachmentToMarkdown({
          filename: file.filename,
          mime: file.mime,
          content: repository.getFileContent(fileId),
        });
        if (conversion) extractedTextByFileId.set(fileId, conversion.markdown);
      } catch {
        // unconvertible → raw-part behavior
      }
    }
  }
  const resolveAttachment: HubAttachmentResolver = (fileId) => {
    try {
      const file = repository.getFile(fileId);
      const extractedText = extractedTextByFileId.get(fileId);
      return {
        filename: file.filename,
        mime: file.mime,
        content: repository.getFileContent(fileId),
        ...(extractedText ? { extractedText } : {}),
      };
    } catch {
      return undefined;
    }
  };

  // ── Assemble the system prompt (mode-aware) with the tool surface injected into LAYER 3.
  const assembled = assembleSessionPrompt({
    mode: input.promptMode,
    session: {
      sessionTitle: session.title,
      mode: session.mode,
      modelId,
      capabilities: summarizeCapabilities(input.capabilities),
      ...(projectContext ? { projectName: projectContext.projectName } : {}),
      ...(input.ownerName ? { ownerName: input.ownerName } : {}),
      date: input.now ?? new Date().toISOString().slice(0, 10),
      ...(input.budgets ? { budgets: summarizeBudgets(input.budgets) } : {}),
    },
    tools: {
      ...(input.toolset.toolListText ? { toolListText: input.toolset.toolListText } : {}),
      ...(input.toolset.skillsListText ? { skillsListText: input.toolset.skillsListText } : {}),
      ...(input.toolset.loadingMode ? { loadingMode: input.toolset.loadingMode } : {}),
    },
    // The layer itself renders "(no project instructions)" when the body is empty — the assembler
    // only gates on THIS injection object being present, so pass it whenever the session IS in a
    // project (even an empty one), never keyed on whether the body happens to be non-empty.
    ...(projectContext
      ? { project: { projectInstructionsAndPinned: projectContext.projectInstructionsAndPinned } }
      : {}),
    // WP2.6/R-GUI1/2 — advertise `present`/`prompt_user` only when the toolset actually granted them
    // (the compiled catalog rides on the resolved toolset), so prompt and validator stay in lockstep.
    ...(input.toolset.genuiCatalog ? { genuiCatalog: input.toolset.genuiCatalog } : {}),
    ...(memorySummary ? { memory: { memoryAndInstructions: memorySummary } } : {}),
  });

  // Persist the capability manifest + prompt version + running lifecycle at turn start (D-US4/D-AH14).
  repository.setSessionLifecycle(sessionId, {
    status: "running",
    phase: "starting",
    promptVersion: assembled.promptVersion,
    capabilities: input.capabilities,
  });
  persist({ type: "phase", phase: "starting" });
  persist({ type: "phase", phase: null });

  // ── Reconstruct the conversation from the persisted event log (R-SES1). The current user turn was
  //    already persisted by the session-service, so `messages` ends with it. WP3.3: when a `compactor`
  //    is wired, it prepares (and, if over budget, COMPACTS) that history — clearing cold tool outputs
  //    then summarizing (persisting a `compaction` event through THIS turn's `persist` choke point), and
  //    it may extend the system prompt with a `systemSuffix` carrying the rolling summary. A `thrash`
  //    outcome (compaction could not free enough context — R-SES8) stops the turn BEFORE any model call,
  //    never a re-summarize loop. No compactor ⇒ verbatim reconstruction, byte-identical to pre-WP3.3.
  let messages: ModelMessage[];
  // hub-fixes WP2.1 (RC2, §8.4) — a mission agent turn REPLACES the assembled Assistant prompt with its
  // curated ROLE prompt (identity replaced). Absent override ⇒ the mode-assembled prompt, byte-identical.
  let systemText = input.systemPromptOverride ?? assembled.text;
  let thrashError: string | undefined;
  if (input.compactor) {
    const prepared = await input.compactor.prepareTurn({
      events: repository.listEvents(sessionId),
      systemText: assembled.text,
      persist,
    });
    if (prepared.kind === "thrash") {
      thrashError = prepared.message;
      messages = [];
    } else {
      messages = prepared.messages;
      if (prepared.systemSuffix) systemText += prepared.systemSuffix;
    }
  } else {
    // WP3.4 — fold multimodal attachments into the verbatim (non-compacted) history.
    messages = reconstructMessages(repository.listEvents(sessionId), resolveAttachment);
  }

  // ── Metering accumulators for the whole turn (across steering passes).
  let turnCostUsd = 0;
  let turnTokensIn = 0;
  let turnTokensOut = 0;
  // Cross-pass carry for budget accumulation (a budget fires across steering continuations too).
  const carry = { toolCalls: 0, tokens: 0, costUsd: 0 };
  let streamError: string | undefined;
  let overflowError: string | undefined;
  let limitError: string | undefined;
  let budgetTrip: TerminalCause | undefined;

  const maxSteps =
    input.budgets?.maxTurns && input.budgets.maxTurns > 0
      ? input.budgets.maxTurns
      : HUB_DEFAULT_MAX_STEPS;

  // ── Steering loop: pass 1 (opener), then a fresh pass per drained batch of steering messages
  //    (injected at the step boundary the prior pass stopped on). R-SES3. SKIPPED entirely on a
  //    compaction thrash (WP3.3/R-SES8) — the turn stops before any model call, never a re-summarize loop.
  let firstPass = true;
  while (!thrashError) {
    if (!firstPass) {
      const queued = steering.drainPending();
      if (queued.length === 0) break;
      for (const q of queued) {
        // Correlate the injected turn with its queued origin: `messageId` = `queuedMessageId` (so
        // `reconstructPending` can tell an injected queued message from a still-pending one on restart).
        //
        // model-identity WP6.1 (F4) — stamp the model that ACTUALLY RAN, not the one the steering
        // message asked for. This pass runs on `modelId`, whose resolution was fixed before the loop;
        // copying `q.model` recorded a model that never executed a token, and the transcript is the
        // evidence an operator uses to reconstruct which provider billed a turn. The ask itself is not
        // lost — it stays on the correlated `queued_user_message` event. The field is still only
        // stamped when an override was requested, preserving "absent ⇒ the session model".
        persist({
          type: "user_message",
          messageId: q.queuedMessageId,
          text: q.text,
          ...(q.model ? { model: modelId } : {}),
          ...(q.attachmentFileIds ? { attachmentFileIds: q.attachmentFileIds } : {}),
        });
        messages.push({ role: "user", content: q.text });
      }
    }
    firstPass = false;

    const pass = await runPass();
    turnCostUsd += pass.costUsd;
    turnTokensIn += pass.tokensIn;
    turnTokensOut += pass.tokensOut;
    if (pass.streamError) streamError = pass.streamError;
    if (pass.overflowError) overflowError = pass.overflowError;
    if (pass.limitError) limitError = pass.limitError;
    if (pass.budgetTrip) budgetTrip = pass.budgetTrip;

    // Any abnormal terminal (stop / clock / error / overflow / limit / budget) ends the turn now.
    if (isAborted() || clock.fired || streamError || overflowError || limitError || budgetTrip) {
      break;
    }
    // Otherwise continue only if a steering message arrived during this pass; else the model is done.
    if (!steering.hasPending()) break;
  }

  // ── Terminal resolution (the ONE place every ending routes through `terminalFor`, clocked by the
  //    SessionClock — mirrors `testing/engine.ts` + the subscription executor).
  clock.stop();

  const limitEvent = (): void => {
    if (!limitError) return;
    persist({
      type: "limit_error",
      message: limitError,
      retrySources: retrySourcesFor(providerKind),
      limitKind: "rate_limit",
      provider: providerKind,
    });
  };

  let verdict: { status: RunStatus; outcome: RunOutcome; stopReasonCode?: StopReasonCode };
  let completed = false;
  if (thrashError) {
    // WP3.3/R-SES8 — compaction could not free enough context. Surface the honest thrash message (an
    // `error` event the transcript renders) and terminate as `context_overflow` (the closest shared
    // cause — the context genuinely cannot fit). No model call ran; no summary was persisted.
    persist({ type: "error", message: thrashError, recoverable: false });
    persist({ type: "phase", phase: "stopping" });
    verdict = terminalFor("context_overflow");
  } else if (isAborted()) {
    persist({ type: "phase", phase: "stopping" });
    verdict = terminalFor("user_stop");
  } else if (clock.fired) {
    // `onFire` already emitted `stopping`.
    verdict = terminalFor(clock.fired.cause);
  } else if (overflowError) {
    persist({ type: "phase", phase: "stopping" });
    verdict = terminalFor("context_overflow");
  } else if (limitError) {
    limitEvent();
    persist({ type: "phase", phase: "stopping" });
    verdict = terminalFor("rate_limit");
  } else if (streamError) {
    persist({ type: "phase", phase: "stopping" });
    verdict = terminalFor(classifyErrorCause(streamError));
  } else if (budgetTrip) {
    persist({ type: "phase", phase: "stopping" });
    verdict = terminalFor(budgetTrip);
  } else {
    verdict = { status: "completed", outcome: "completed" };
    completed = true;
  }

  // Release the turn's HITL state (unbind the elicitation responder, drop its server routing, settle any
  // dangling pending decision) — always, once terminal (WP2.3). Safe no-op when HITL is unwired.
  hitl?.release();

  // Fold this turn's cost/tokens/durations into the (re-read, fresh) session totals — a multi-turn
  // session accumulates across turns (each turn has its own clock).
  const current = repository.getSession(sessionId);
  repository.setSessionLifecycle(sessionId, {
    status: verdict.status,
    phase: null,
    stopReasonCode: verdict.stopReasonCode ?? null,
    costUsd: current.costUsd + turnCostUsd,
    tokensIn: current.tokensIn + turnTokensIn,
    tokensOut: current.tokensOut + turnTokensOut,
    activeDurationMs: (current.activeDurationMs ?? 0) + clock.activeDurationMs,
    totalDurationMs: (current.totalDurationMs ?? 0) + clock.totalDurationMs,
  });

  return {
    status: verdict.status,
    outcome: verdict.outcome,
    stopReasonCode: verdict.stopReasonCode,
    costUsd: turnCostUsd,
    tokensIn: turnTokensIn,
    tokensOut: turnTokensOut,
    activeDurationMs: clock.activeDurationMs,
    totalDurationMs: clock.totalDurationMs,
    completed,
  };

  // ── One provider round-trip (a `streamText` over the shared `messages`) ──────────────────────────
  async function runPass(): Promise<PassOutcome> {
    const messageId = nanoid();
    const parts: HubMessagePart[] = [];
    const toolResults: HubAssistantDraft["toolResults"] = [];
    let fullText = "";
    let textBuf = "";
    let reasoningBuf = "";
    let activeTextId: string | null = null;
    let passStreamError: string | undefined;
    let passOverflow: string | undefined;
    let passLimit: string | undefined;
    let passBudgetTrip: TerminalCause | undefined;

    const flushText = (): void => {
      if (textBuf) {
        parts.push({ type: "text", text: textBuf });
        textBuf = "";
      }
    };
    const flushReasoning = (): void => {
      if (reasoningBuf) {
        parts.push({ type: "reasoning", text: reasoningBuf });
        reasoningBuf = "";
      }
    };

    // Budget stop predicate (D-AH9): accumulate over the settled steps of THIS pass + the cross-pass
    // carry, and latch the first crossed hard cap. Only wired when a token/cost/tool-call budget is set;
    // the step cap is always `stepCountIs(maxSteps)`.
    const budgetsActive =
      !!input.budgets?.maxTokens || !!input.budgets?.maxCostUsd || !!input.budgets?.maxToolCalls;
    const budgetStop: StopCondition<ToolSet> = ({ steps }) => {
      if (!input.budgets) return false;
      let toolCalls = carry.toolCalls;
      let tokens = carry.tokens;
      let cost = carry.costUsd;
      for (const s of steps) {
        const usage = extractProviderUsage(providerKind, s.usage, s.providerMetadata);
        toolCalls += s.toolCalls.filter((c) => c.providerExecuted !== true).length;
        tokens += usage.inputTokens + usage.outputTokens;
        cost += estimateCost(modelId, usage);
      }
      if (input.budgets.maxToolCalls && toolCalls >= input.budgets.maxToolCalls) {
        passBudgetTrip = "max_tool_calls";
      } else if (input.budgets.maxTokens && tokens >= input.budgets.maxTokens) {
        passBudgetTrip = "max_tokens";
      } else if (input.budgets.maxCostUsd && cost >= input.budgets.maxCostUsd) {
        passBudgetTrip = "max_cost";
      }
      return passBudgetTrip !== undefined;
    };
    const stopWhen: StopCondition<ToolSet>[] = [
      stepCountIs(maxSteps),
      // Cut the pass at the next step boundary when a steering message is pending (R-SES3 "inject at
      // the next step boundary" — the drained batch runs as a fresh pass).
      () => steering.hasPending(),
      ...(budgetsActive ? [budgetStop] : []),
    ];

    const result = streamText({
      model: input.model,
      system: systemText,
      messages,
      tools: providerTools,
      stopWhen,
      // WP1.1 (D-HF1) — per-step deferred-tool gating (undefined in eager mode ⇒ no gating).
      ...(prepareStep ? { prepareStep } : {}),
      abortSignal: effectiveSignal,
      onStepFinish: () => {
        clock.noteEvent();
      },
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    });

    try {
      for await (const part of result.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
        switch (part.type) {
          case "text-delta": {
            if (part.text) {
              flushReasoning();
              // A new content-block id is a paragraph boundary within the answer.
              const boundary = activeTextId !== null && part.id !== activeTextId;
              activeTextId = part.id;
              const piece = boundary ? `\n\n${part.text}` : part.text;
              textBuf += piece;
              fullText += piece;
              sink.onDelta({ messageId, channel: "text", text: piece });
              clock.noteEvent();
            }
            break;
          }
          case "reasoning-delta": {
            if (part.text) {
              flushText();
              reasoningBuf += part.text;
              sink.onDelta({ messageId, channel: "reasoning", text: part.text });
              clock.noteEvent();
            }
            break;
          }
          case "tool-call": {
            flushReasoning();
            flushText();
            // Translate the provider-safe name back to the internal (dotted) name grants/UI/persistence
            // use. `toolCallId` stays as-is — it is the result/artifact routing key, not a tool name.
            const toolName = toInternalName(part.toolName);
            const toolPart: HubToolPart = {
              type: "tool_call",
              toolCallId: part.toolCallId,
              toolName,
              source: sourceOf(toolName),
              state: "input-available",
              args: part.input,
              ...(serverIdOf(toolName) ? { serverId: serverIdOf(toolName) } : {}),
            };
            parts.push(toolPart);
            persist({ type: "tool_call", messageId, part: toolPart });
            break;
          }
          case "tool-result": {
            // A DENIED approval-gated call (R-UX1 `output-denied`): the wrapper returned the model-
            // visible denied result and recorded the id, so the settled state reads `output-denied`,
            // distinct from a tool that ran and errored (`output-error`).
            const denied = deniedCallIds.has(part.toolCallId);
            const isErr = denied || isMcpErrorResult(part.output);
            toolResults.push({
              toolCallId: part.toolCallId,
              toolName: toInternalName(part.toolName),
              output: part.output,
              isError: isErr,
            });
            // WP3.4 — the R-GUI3 UI-visible channel (output-cap spill / produced workspace file),
            // written during execution by `buildHubBuiltinTools`/`applyOutputCapToMcpTools` into the
            // toolset's shared `toolArtifacts` sink, keyed by this same `toolCallId`.
            const artifact = input.toolset.toolArtifacts?.get(part.toolCallId);
            persist({
              type: "tool_result",
              toolCallId: part.toolCallId,
              state: denied ? "output-denied" : isErr ? "output-error" : "output-available",
              modelContent: part.output,
              ...(artifact ? { artifact } : {}),
              ...(isErr ? { isError: true } : {}),
            });
            break;
          }
          case "tool-error": {
            toolResults.push({
              toolCallId: part.toolCallId,
              toolName: toInternalName(part.toolName),
              output: undefined,
              isError: true,
            });
            persist({
              type: "tool_result",
              toolCallId: part.toolCallId,
              state: "output-error",
              isError: true,
              errorText: messageOf(part.error),
            });
            break;
          }
          case "finish-step": {
            activeTextId = null;
            break;
          }
          case "error": {
            const message = messageOf(part.error);
            if (isAborted() || clock.fired) break;
            if (isContextOverflowError(part.error)) passOverflow = message;
            else if (isLimitError(part.error)) passLimit = message;
            else {
              passStreamError = message;
              persist({ type: "error", message, recoverable: false });
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (error) {
      const message = messageOf(error);
      if (isAborted() || clock.fired) {
        // clean stop — the terminal resolution above handles it.
      } else if (isContextOverflowError(error)) {
        passOverflow = message;
      } else if (isLimitError(error)) {
        passLimit = message;
      } else {
        passStreamError = message;
        const authRequired = isAuthRequiredError(error);
        persist({
          type: "error",
          message,
          recoverable: false,
          ...(authRequired ? { authRequired: true } : {}),
        });
      }
    }

    flushReasoning();
    flushText();

    // Price the pass's settled steps (provider-actual usage × pricing — the SAME path the scans/cost
    // KPI use). `result.steps` rejects when the stream produced no output (abort/overflow) — tolerate it.
    const steps = await Promise.resolve(result.steps).catch(
      () => [] as Awaited<typeof result.steps>,
    );
    let passCost = 0;
    let passIn = 0;
    let passOut = 0;
    let passToolCalls = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let reasoningTokens = 0;
    // hub-fixes WP5.1 (RC5, D-HF2) — provider-native web searches this pass (provider-executed, so NOT
    // billed as a maxToolCalls unit) + any Google grounding sources (their cited pages live on the step
    // metadata, not a mineable tool-result — Anthropic/OpenAI results come via `toolResults` instead).
    let passWebSearches = 0;
    const groundingSources: HubAssistantDraft["providerSearchSources"] = [];
    for (const s of steps) {
      const usage = extractProviderUsage(providerKind, s.usage, s.providerMetadata);
      passCost += estimateCost(modelId, usage);
      passIn += usage.inputTokens;
      passOut += usage.outputTokens;
      passToolCalls += s.toolCalls.filter((c) => c.providerExecuted !== true).length;
      passWebSearches += s.toolCalls.filter(
        (c) => c.providerExecuted === true && toInternalName(c.toolName) === HUB_WEB_SEARCH_BUILTIN,
      ).length;
      if (providerKind === "google")
        groundingSources.push(...extractGroundingWebSources(s.providerMetadata));
      cacheReadTokens += usage.cacheReadTokens ?? 0;
      cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      reasoningTokens += usage.reasoningTokens ?? 0;
    }
    carry.toolCalls += passToolCalls;
    carry.tokens += passIn + passOut;
    carry.costUsd += passCost;

    // Post-settle budget backstop: the model may stop on the final step (which the SDK never evaluated
    // `stopWhen` for). Latch a crossed cap here so it still fires + names itself.
    if (budgetsActive && !passBudgetTrip && input.budgets) {
      if (input.budgets.maxToolCalls && carry.toolCalls >= input.budgets.maxToolCalls)
        passBudgetTrip = "max_tool_calls";
      else if (input.budgets.maxTokens && carry.tokens >= input.budgets.maxTokens)
        passBudgetTrip = "max_tokens";
      else if (input.budgets.maxCostUsd && carry.costUsd >= input.budgets.maxCostUsd)
        passBudgetTrip = "max_cost";
    }

    // Carry the assistant/tool transcript so a steering continuation sees the model's own prior turn.
    const generated = await Promise.resolve(result.responseMessages).catch(
      () => [] as Awaited<typeof result.responseMessages>,
    );
    messages.push(...generated);

    // Preserve partial work on an abnormal terminal with an explicit cut-off note (R-SES11).
    const abnormal = isAborted()
      ? "aborted"
      : passLimit
        ? "limit"
        : passOverflow
          ? "overflow"
          : passStreamError
            ? "error"
            : passBudgetTrip
              ? "budget"
              : undefined;
    if (abnormal) {
      flushText();
      parts.push({ type: "text", text: CUTOFF_NOTES[abnormal] });
    }

    const usage: HubUsage = {
      tokensIn: passIn,
      tokensOut: passOut,
      ...(cacheReadTokens ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
      ...(reasoningTokens ? { reasoningTokens } : {}),
      ...(passWebSearches ? { webSearches: passWebSearches } : {}),
    };
    const finishReason =
      abnormal ?? (await Promise.resolve(result.finishReason).catch(() => undefined));

    // WP1.4 citation post-pass (§1.7): resolve `[n]` markers → `citations[]` (+ any part rewrite)
    // BEFORE persistence, since `hub_events` is append-only. WP1.1 leaves it unset → no citations.
    // hub-fixes WP5.1 — `providerSearchSources` (Google grounding) rides along so the composed post-pass
    // can number provider web-search results into the same ledger as MCP-tool sources.
    let finalParts: HubMessagePart[] = parts;
    let citations: HubCitation[] = [];
    if (input.citationPostPass) {
      const out = await input.citationPostPass({
        messageId,
        parts,
        text: fullText,
        toolResults,
        ...(groundingSources.length > 0 ? { providerSearchSources: groundingSources } : {}),
      });
      if (out.parts) finalParts = out.parts;
      if (out.citations) citations = out.citations;
    }

    // Persist the SETTLED assistant message (R-SES2 ordered parts — no flat strings) + a `turn_done`
    // with the final usage/cost.
    persist({
      type: "assistant_message",
      messageId,
      model: modelId,
      parts: finalParts,
      usage,
      citations,
      artifactsTouched: [],
      promptVersion: assembled.promptVersion,
      costUsd: passCost,
      costBasis: "api_exact",
      ...(finishReason ? { finishReason: String(finishReason) } : {}),
    });
    persist({ type: "turn_done", messageId, usage, costUsd: passCost, costBasis: "api_exact" });

    return {
      costUsd: passCost,
      tokensIn: passIn,
      tokensOut: passOut,
      toolCalls: passToolCalls,
      streamError: passStreamError,
      overflowError: passOverflow,
      limitError: passLimit,
      budgetTrip: passBudgetTrip,
    };
  }

  function sourceOf(toolName: string): HubToolSource {
    return input.toolset.sources?.[toolName] ?? (toolName.startsWith("mcp__") ? "mcp" : "builtin");
  }
  function serverIdOf(toolName: string): string | undefined {
    return input.toolset.serverIds?.[toolName];
  }

  // ── HITL tool wrapping (WP2.3) ─────────────────────────────────────────────────────────────────

  /** Wrap only the tools the gate says COULD ask; pass everything else through unchanged (a
   *  provider-executed tool with no `execute` is never wrapped either). */
  function gateTools(tools: ToolSet, h: HubTurnHitl): ToolSet {
    const wrapped: ToolSet = {};
    for (const [name, toolDef] of Object.entries(tools)) {
      const gate = h.gate(name);
      const executable = toolDef as { execute?: unknown };
      if (!gate || !gate.gated || typeof executable.execute !== "function") {
        wrapped[name] = toolDef;
        continue;
      }
      wrapped[name] = wrapGatedTool(name, toolDef, gate, h);
    }
    return wrapped;
  }

  /**
   * Wrap ONE approval-gated tool's `execute` (R-MCP3/R-UX1): before running, emit `approval_requested`,
   * enter `waiting_input`, and await the decision (or a session-scoped "always" → auto-run marked
   * automatic). Deny → record the id (so the settled result reads `output-denied`) and return the
   * model-visible denied result; approve/always → run the real tool.
   */
  function wrapGatedTool(
    name: string,
    toolDef: Tool,
    gate: HubApprovalGateDecision,
    h: HubTurnHitl,
  ): Tool {
    const original = toolDef as Tool & {
      execute: (input: unknown, options: { toolCallId: string }) => unknown | Promise<unknown>;
    };
    const originalExecute = original.execute.bind(original);
    const emitRequested = (toolCallId: string, isAutomatic: boolean): void => {
      persist({
        type: "approval_requested",
        toolCallId,
        toolName: name,
        source: gate.source,
        ...(gate.serverId ? { serverId: gate.serverId } : {}),
        ...(gate.annotations ? { annotations: gate.annotations } : {}),
        options: gate.options,
        isAutomatic,
        autonomy: h.autonomy,
      });
    };
    const gatedExecute = async (
      args: unknown,
      options: { toolCallId: string },
    ): Promise<unknown> => {
      const toolCallId = options.toolCallId;
      // Session-scoped "don't ask again" (never for destructive) → auto-run, marked automatic (R-MCP3).
      if (!gate.destructive && h.hasAlways(name)) {
        emitRequested(toolCallId, true);
        persist({
          type: "approval_responded",
          toolCallId,
          resolution: "always",
          isAutomatic: true,
        });
        return originalExecute(args, options);
      }
      // Register the decision mailbox BEFORE emitting the request, so a decision that arrives the very
      // instant the client sees the event (a synchronous test sink, or a fast SSE round-trip) always
      // finds a pending mailbox to resolve — never a lost decision.
      const decisionPromise = h.waitForApproval(toolCallId);
      emitRequested(toolCallId, false);
      beginWait("approval");
      let resolution: HubApprovalResolution;
      try {
        resolution = await raceAbort<HubApprovalResolution>(decisionPromise, "deny");
      } finally {
        endWait();
      }
      persist({ type: "approval_responded", toolCallId, resolution });
      if (resolution === "deny") {
        deniedCallIds.add(toolCallId);
        return HUB_TOOL_DENIED_RESULT;
      }
      if (resolution === "always") h.recordAlways(name);
      return originalExecute(args, options);
    };
    return { ...toolDef, execute: gatedExecute } as unknown as Tool;
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────

/** WP3.4 — a resolved `hub_files` attachment: the fields `reconstructMessages`' resolver needs to fold
 *  it into the model's context. Deliberately narrow (not the full `HubFile`) so a caller can build it
 *  from `HubRepository.getFile` + `getFileContent` without importing the repository's row types here. */
export type HubResolvedAttachment = {
  filename?: string;
  mime: string;
  content: Buffer;
  /** v1-fixes (attachment ingestion) — markdown extracted from a document format (pdf/docx/xlsx/pptx/
   *  html) by `hub/files/ingest.ts`, so EVERY model kind can read the attachment, not only the few
   *  that accept multimodal `file` parts. Absent ⇒ pre-fix raw-part behavior. */
  extractedText?: string;
};

/** Resolve an `attachmentFileIds` entry to its bytes, or `undefined` when the file no longer exists
 *  (a deleted upload is skipped, never a thrown turn). Injected so `turn-engine.ts` stays DB-agnostic. */
export type HubAttachmentResolver = (fileId: string) => HubResolvedAttachment | undefined;

/** MIME types folded into the message as INLINE TEXT (capped at
 *  {@link HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS}) rather than a multimodal `file` part — a model that
 *  can't see images/PDFs directly still gets a plain-text attachment's actual content. */
function isTextLikeMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  );
}

/** Fold one resolved attachment into `UserContent` parts (WP3.4 multimodal pass-through, revised by
 *  v1-fixes attachment ingestion): text-like content inlines (truncated, never silently unbounded);
 *  a document with `extractedText` inlines its CONVERTED MARKDOWN so every model kind can read it —
 *  and a pdf/image additionally keeps its raw `file` part so a multimodal-capable model still sees
 *  the original; anything else unconvertible stays a raw `file` part (pre-fix behavior). */
export function attachmentToContentParts(file: HubResolvedAttachment): Array<TextPart | FilePart> {
  const label = file.filename ?? "attachment";
  const inline = (body: string, note: string): TextPart => {
    const truncated = body.length > HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS;
    const shown = truncated ? body.slice(0, HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS) : body;
    return {
      type: "text",
      text: `\n\n--- Attached file: ${label}${note} ---\n${shown}${truncated ? "\n… (truncated)" : ""}`,
    };
  };
  if (file.extractedText?.trim()) {
    const parts: Array<TextPart | FilePart> = [
      inline(file.extractedText, " (converted to markdown)"),
    ];
    // A pdf keeps its raw part too — a vision-capable model reads the original layout; a text-only
    // model reads the markdown and ignores the file part per the AI SDK capability contract.
    if (file.mime === "application/pdf" || file.mime.startsWith("image/")) {
      parts.push({ type: "file", data: file.content, mediaType: file.mime, filename: file.filename });
    }
    return parts;
  }
  if (isTextLikeMime(file.mime)) {
    return [inline(file.content.toString("utf8"), "")];
  }
  return [{ type: "file", data: file.content, mediaType: file.mime, filename: file.filename }];
}

/**
 * Reconstruct the AI-SDK `ModelMessage[]` conversation from a session's persisted event log (R-SES1):
 * each settled `user_message` → a user turn, each `assistant_message` → an assistant turn built from its
 * text parts. `queued_user_message` events are ignored (they become `user_message` events when injected).
 * WP1.1 reconstructs text turns only (cross-turn tool history is not re-seeded — a chat-continuity v1;
 * within a single turn the AI-SDK's own `responseMessages` carry the tool transcript).
 *
 * WP3.4 — when a `user_message` carries `attachmentFileIds` AND a `resolveAttachment` is supplied, each
 * resolvable attachment is folded into the SAME user turn as an additional content part (text inlines,
 * everything else becomes a multimodal `file` part) — see {@link attachmentToContentPart}. Omitting the
 * resolver (or an attachment resolving to nothing) leaves the turn as plain text — unchanged pre-WP3.4
 * behavior, so every existing caller/test stays byte-identical.
 */
export function reconstructMessages(
  events: HubEvent[],
  resolveAttachment?: HubAttachmentResolver,
): ModelMessage[] {
  // assistant-hub v1-fixes (F2) — pre-scan the mission_synthesis markers so the synthesis message can be
  // LABELED in reconstruction. Unlabeled, later turns misread it (the observed session attributed the
  // synthesis to the user — "a summary paragraph you wrote").
  const synthesisReportCount = new Map<string, number>();
  for (const event of events) {
    if (event.type === "mission_synthesis" && event.messageId) {
      synthesisReportCount.set(event.messageId, event.agentReportRefs?.length ?? 0);
    }
  }
  const messages: ModelMessage[] = [];
  for (const event of events) {
    if (event.type === "user_message") {
      const attachments = (event.attachmentFileIds ?? [])
        .map((id) => (resolveAttachment ? resolveAttachment(id) : undefined))
        .filter((f): f is HubResolvedAttachment => f !== undefined);
      if (attachments.length === 0) {
        messages.push({ role: "user", content: event.text });
      } else {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: event.text },
            ...attachments.flatMap(attachmentToContentParts),
          ],
        });
      }
    } else if (event.type === "assistant_message") {
      const text = event.parts
        .filter((p): p is HubTextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text.trim()) {
        const reportCount = synthesisReportCount.get(event.messageId);
        const labeled =
          reportCount !== undefined
            ? `[Mission synthesis — composed from ${reportCount} agent report${
                reportCount === 1 ? "" : "s"
              }]\n${text}`
            : text;
        messages.push({ role: "assistant", content: labeled });
      }
    } else if (event.type === "mission_digest") {
      // v1-fixes (F2) — the mission's model-visible memory: fold the digest in as an assistant turn so
      // every later turn can quote what the agents found (its text is already fully framed).
      if (event.text.trim()) messages.push({ role: "assistant", content: event.text });
    }
  }
  return messages;
}

/** The OTHER source(s) a `limit_error` offers to retry on (D-AH17 — never a silent switch). An
 *  API-keyed AI-SDK kind offers the subscription + a model swap; a subscription offers the API key + a
 *  model swap. */
export function retrySourcesFor(kind: ProviderKind): HubLimitRetrySource[] {
  return kind === "claude_subscription"
    ? ["api_key", "other_model"]
    : ["subscription", "other_model"];
}

/** Classify a fatal stream error into its machine-readable {@link TerminalCause} (auth wins as the more
 *  specific signal, then a conservative rate-limit match, else a generic provider error). */
function classifyErrorCause(error: string): TerminalCause {
  if (isAuthRequiredError(error)) return "auth";
  if (isLimitError(error)) return "rate_limit";
  return "provider_error";
}

/** Conservative message-based limit/rate-limit/quota classifier (mirrors the Testing engine's private
 *  `isRateLimitError`; kept local since that one is not exported — a heuristic, not shared logic). */
export function isLimitError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!message) return false;
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("too many requests") ||
    message.includes("quota") ||
    message.includes("insufficient_quota") ||
    message.includes("overloaded")
  );
}

/** True when a tool result is an MCP `{ isError: true }` result (a tool-level, model-visible failure). */
function isMcpErrorResult(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { isError?: unknown }).isError === true
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Combine two abort signals into one that aborts when either does (Stop ∪ SessionClock fire). Mirrors
 *  the Testing engine's private `combineSignals`, kept local (that one is not exported). */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn([a, b]);
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  if (a.aborted || b.aborted) controller.abort();
  else {
    a.addEventListener("abort", forward, { once: true });
    b.addEventListener("abort", forward, { once: true });
  }
  return controller.signal;
}

/** A one-line capabilities summary for the prompt's session-context layer (LAYER 2). */
function summarizeCapabilities(caps: SessionCapabilities): string {
  const bits: string[] = [];
  if (caps.toolCalls) bits.push("tools");
  if (caps.contextWindow) bits.push("context accounting");
  bits.push(`tokens: ${caps.tokens}`);
  bits.push(`cost: ${caps.costBasis}`);
  if (caps.liveReasoning !== "none") bits.push(`reasoning: ${caps.liveReasoning}`);
  return bits.join(" · ");
}

/** A one-line budgets summary for the prompt's session-context layer (LAYER 2). */
function summarizeBudgets(budgets: HubBudgets): string {
  const bits: string[] = [];
  if (budgets.maxTurns) bits.push(`${budgets.maxTurns} turns`);
  if (budgets.maxTokens) bits.push(`${budgets.maxTokens} tokens`);
  if (budgets.maxToolCalls) bits.push(`${budgets.maxToolCalls} tool calls`);
  if (budgets.maxCostUsd) bits.push(`$${budgets.maxCostUsd}`);
  if (budgets.maxDurationMs) bits.push(`${Math.round(budgets.maxDurationMs / 1000)}s`);
  return bits.length > 0 ? bits.join(" · ") : "none";
}

// WP3.1 (D-AH11c) — the project's real name (LAYER 2) + its instructions + pinned files, assembled
// into ONE budget-capped body (LAYER 6b, `prompting/layers/project.ts`'s `projectInstructionsAndPinned`
// injection — "content is rendered AND budget-capped BY THE CALLER", per that layer's own doc note).
// A default so `HUB_PROJECT_CONTEXT_MAX_CHARS` reaches here even through a test harness that never set
// `HubSessionServiceConfig.projectContextMaxChars` (mirrors `HUB_DEFAULT_MAX_STEPS` above).
// Exported (WP4.1) — the context inspector (`hub/context-inspector.ts`) calls this SAME resolver to
// measure the REAL injected project body on its own, isolated from LAYER 6b's static frame.
export const HUB_DEFAULT_PROJECT_CONTEXT_MAX_CHARS = 8_000;

/** Resolved once per turn from `session.projectId`. `undefined` when the session isn't in a project
 *  (or the project was deleted after the session joined it — degrades quietly, never fails the turn). */
export function resolveProjectContext(
  repository: HubRepository,
  projectId: string,
  maxChars: number,
): { projectName: string; projectInstructionsAndPinned?: string } | undefined {
  let project: ReturnType<HubRepository["getProject"]>;
  try {
    project = repository.getProject(projectId);
  } catch {
    return undefined;
  }
  const sections: string[] = [];
  if (project.instructions?.trim()) sections.push(project.instructions.trim());
  const pinnedLinks = repository
    .listFileLinksForTarget("project", projectId)
    .filter((link) => link.role === "pinned");
  if (pinnedLinks.length > 0) {
    const files = pinnedLinks.map((link) => {
      const file = repository.getFile(link.fileId);
      const content = repository.getFileContent(link.fileId).toString("utf8");
      return `### ${file.filename ?? file.id}\n${content}`;
    });
    sections.push(`Pinned files:\n\n${files.join("\n\n")}`);
  }
  if (sections.length === 0) return { projectName: project.name };
  let body = sections.join("\n\n");
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n…(truncated at ${maxChars} characters)`;
  }
  return { projectName: project.name, projectInstructionsAndPinned: body };
}

// WP3.2 (D-AH11) — LAYER 6a memory body. Grouped by kind in a fixed, readable order (not DB order,
// which is `updated_at DESC`) so the model — and a human reading the context inspector — sees
// "Profile" / "Preferences" / "Standing instructions" as stable sections. Capped to a hard character
// budget: `prompting/budgets.ts`'s per-section token budget covers only the layer's STATIC frame (its
// own doc), so bounding the size of the INJECTED body is this function's job — an unbounded memory
// list must never be able to blow out the prompt the way an unbounded tool result could.
const HUB_MEMORY_PROMPT_MAX_CHARS = 1600;
const MEMORY_KIND_ORDER: readonly HubMemoryKind[] = ["profile", "preference", "instruction"];
const MEMORY_KIND_TITLES: Record<HubMemoryKind, string> = {
  profile: "Profile",
  preference: "Preferences",
  instruction: "Standing instructions",
};

// Exported (WP4.1) — the context inspector calls this SAME summarizer so its "memory" layer measures
// the identical body the turn engine actually injects (and the Memory panel shows), never a re-derived
// approximation ("a human reading the context inspector" — this doc's own words, above).
export function summarizeMemory(memories: readonly HubMemory[]): string | undefined {
  if (memories.length === 0) return undefined;
  const byKind = new Map<HubMemoryKind, string[]>();
  for (const memory of memories) {
    const bucket = byKind.get(memory.kind) ?? [];
    bucket.push(`- ${memory.content}`);
    byKind.set(memory.kind, bucket);
  }
  const sections = MEMORY_KIND_ORDER.filter((kind) => byKind.has(kind)).map(
    (kind) => `${MEMORY_KIND_TITLES[kind]}:\n${(byKind.get(kind) ?? []).join("\n")}`,
  );
  const text = sections.join("\n\n");
  return text.length > HUB_MEMORY_PROMPT_MAX_CHARS
    ? `${text.slice(0, HUB_MEMORY_PROMPT_MAX_CHARS)}\n… (truncated — see the Memory panel for the full list)`
    : text;
}
