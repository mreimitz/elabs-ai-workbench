// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.1, §1.5 / D-AH3 / D-AH4) — the session-lifecycle
// orchestration between the routes (WP1.2) and the turn engine (`turn-engine.ts`).
//
// It owns the parts of §1.5 that are NOT one turn's pipeline: creating a session (with its capability
// manifest), dispatching a settled user message (the model-resolution BRANCH POINT + running or
// queueing it), the active-session registry + cap (`HUB_MAX_ACTIVE_SESSIONS`), release-on-reply
// (`HUB_SESSION_IDLE_RELEASE_MS`), Stop, and auto-title (deterministic → optional LLM refine,
// `HUB_AUTO_TITLE`). Mirrors the dock's `AssistantSessionManager` shape (a `live` Map + a cap 409 + a
// release grace + a fire-and-forget title refine) but over the hub's own repository/engine, never the
// dock's.
//
// Two deliberate DI seams downstream WPs plug into:
//   • `resolveModel` — the model-resolution branch point. It returns the resolved kind + (for the five
//     AI-SDK kinds) a `buildModel()`. WP1.1 runs ONLY the AI-SDK path; a `claude_subscription`
//     resolution branches to the injectable `subscriptionExecutor` (WP1.5's adapter) — a 501 until it
//     is wired, never a silent AI-SDK fallback.
//   • `citationPostPass` — threaded into every turn so WP1.4's citation post-pass can populate the
//     settled `assistant_message`'s parts/citations before it is persisted (append-only).
//
// The service NEVER touches the testing tables — hub events + `hub_sessions` only.

import type {
  HubApprovalResolution,
  HubAutonomyLevel,
  HubBudgets,
  HubCitation,
  HubEvent,
  HubMcpServerStatusEntry,
  HubMessagePart,
  HubMissionStatus,
  HubResolvedSkillAttachment,
  HubSendMessageInput,
  HubSession,
  HubSessionCreateInput,
  HubToolArtifact,
  HubToolGrants,
  HubToolSource,
  HubUsage,
  ProviderKind,
} from "@mcp-token-footprint/shared";
import { HUB_WEB_FETCH_BUILTIN, HUB_WEB_SEARCH_BUILTIN } from "@mcp-token-footprint/shared";
import type { LanguageModel, Tool } from "ai";
import { nanoid } from "nanoid";
import { httpError, toErrorMessage } from "../utils/errors.js";
import type { McpSession } from "../mcp/client.js";
import type { StepSink } from "../testing/tool-bridge.js";
import type { TokenCounter } from "../token-counting/types.js";
import { assertHubModelKind, hubCapabilitiesForKind, isHubAiSdkKind } from "./capabilities.js";
import {
  extractCitationSources,
  type HubCitationTurn,
  type HubCitationTurnFactory,
} from "./citations.js";
import {
  HubHitlCoordinator,
  normalizeElicitationRequest,
  resolveApprovalGate,
  type HubApprovalMeta,
  type HubElicitationDecision,
  type NormalizedElicitationRequest,
} from "./hitl.js";
import type { HubRepository } from "./repository.js";
import { unionRosterServersIntoScope } from "./roster-scope.js";
import type { HubSessionCreateOptions } from "./repository.js";
import {
  assembleRolePrompt,
  type HubGenuiCatalogInjection,
  type HubPromptMode,
  type HubRoleTemplateInjection,
} from "./prompting/index.js";
import {
  computeSkillListing,
  invocationOrderFromLoads,
  reconstructLoadedSkills,
  type HubSkillReader,
} from "./skill-attachments.js";
import {
  composeWebTools,
  DEFAULT_CHAT_BUILTIN_NAMES,
  missionProposePlan,
  webFetch,
} from "./tools/index.js";
import {
  applyOutputCapToMcpTools,
  buildHubMcpTools,
  buildMissionAgentHitl,
  createSkillsLoadBuiltin,
  DEFAULT_HUB_EAGER_MAX_TOKENS,
  resolveHubToolRegistry,
  type HubMcpServerCatalog,
  type HubToolLoadingPreference,
  type OutputCapConfig,
  type SkillLoadBudgets,
} from "./tools/index.js";
import { ensureHubWorkspaceRoot } from "./workspace.js";
import { compileGenuiCatalogPrompt, createGenuiTools, GENUI_TOOL_NAMES } from "./genui/index.js";
import type { HubBuiltinTool } from "./tools/types.js";
import { createHubCompactor, type HubSummarizer } from "./compaction.js";
import {
  buildHubBuiltinTools,
  HubSteeringQueue,
  runHubTurn,
  type HubCitationPostPass,
  type HubResolvedToolset,
  type HubTurnHitl,
  type HubTurnSink,
  type HubTurnResult,
  type StreamTextProviderOptions,
} from "./turn-engine.js";

/** Deterministic-title cap — a session title should be short (distinct from the DB validation ceiling
 *  `HUB_SESSION_TITLE_MAX_LENGTH`, which merely bounds a manual title). */
export const HUB_AUTO_TITLE_MAX_LENGTH = 60;

/** WP3.4/R-MCP7 — the output-cap fallback when `config.outputCapWarnTokens`/`outputCapMaxTokens` are
 *  omitted (mirrors `config/env.ts`'s own `HUB_MCP_OUTPUT_WARN_TOKENS`/`_MAX_TOKENS` defaults, so an
 *  existing service construction that doesn't thread them through still gets the documented behavior). */
export const DEFAULT_HUB_OUTPUT_CAP: OutputCapConfig = { warnTokens: 10_000, capTokens: 25_000 };

/**
 * The result of resolving a session's (per-message) model id (the model-resolution BRANCH POINT). For
 * the five AI-SDK kinds it carries a `buildModel()` factory + the metering keys; for `claude_subscription`
 * it carries only the kind (the service branches to the subscription executor). `acme_answers` is refused
 * up front (a hub non-goal — D-AH4).
 */
export type HubModelResolution = {
  providerKind: ProviderKind;
  /** The effective model id — the pricing/context key + the `model` stamped on the settled message. */
  modelId: string;
  /** The model's context window (`MODEL_CONTEXT_LIMITS[modelId]`, 0 when unknown). */
  contextWindow: number;
  /** Build the AI-SDK model (`providers/registry.modelFor(cred, modelId)`). Present for the five
   *  AI-SDK kinds; ABSENT for `claude_subscription` (its executor owns model construction). */
  buildModel?: () => LanguageModel;
  /** Provider-native escape hatch (Anthropic cache_control / thinking, from `providerOptions()`). */
  providerOptions?: StreamTextProviderOptions;
};

/**
 * Resolve a model id → its {@link HubModelResolution}. Wired in index.ts (WP1.2): maps the model id to a
 * provider credential, decrypts it, and builds the model; injected in tests as a mock.
 *
 * **model-identity WP2.1 (D-MI1).** `providerCredentialId` is the id of the `provider_credentials` row
 * that OWNS the model — the AUTHORITATIVE answer to "which credential runs this", because a model id
 * alone does NOT identify a provider: the signed-in Claude subscription deliberately reports Anthropic's
 * canonical ids (`providers/subscription-models.ts`), so `claude-sonnet-5` names both an `anthropic` API
 * model and a `claude_subscription` one. Present ⇒ that credential is used and the name heuristic never
 * runs. Absent ⇒ the historical `inferHubModelKind` fallback, byte-identical to pre-WP2.1 behavior (every
 * pre-v55 session/agent row reads back NULL and therefore replays unchanged).
 *
 * **model-identity WP2.2 (D-MI9).** A `providerCredentialId` that is present but unusable — unknown, not
 * hub-eligible, or auth-broken — makes the production resolver THROW a 409. It never degrades to the
 * heuristic: an explicit choice is honoured or refused, never quietly swapped for a different credential
 * (that swap is the original defect). Absent stays a non-error legacy path, and a credential deleted from
 * under a persisted row is blanked by `ON DELETE SET NULL` before it ever reaches here.
 */
export type HubModelResolver = (
  modelId: string,
  providerCredentialId?: string,
) => HubModelResolution | Promise<HubModelResolution>;

/** The context a toolset resolver receives to build the turn's tool surface. */
export type HubToolsetContext = {
  session: HubSession;
  providerKind: ProviderKind;
  modelId: string;
  contextWindow: number;
};

/** Build the granted tool surface for a turn (default: built-ins only; WP1.4 adds MCP server grants). */
export type HubToolsetResolver = (
  ctx: HubToolsetContext,
) => HubResolvedToolset | Promise<HubResolvedToolset>;

/**
 * WP1.4 — the inputs a session-level MCP grant needs (R-MCP1 / §1.6 server grants v1). The provider
 * (wired in index.ts, where the scan catalog + live MCP sessions live) yields the granted servers'
 * scanned tool catalogs plus their OPEN {@link McpSession}s + a measurement {@link StepSink}. Returning
 * `null` (no granted/reachable server) leaves the turn on the built-ins-only surface — a chat is never
 * broken by an MCP server being down (graceful degradation is the provider's job, per D-AS17 posture).
 */
export type HubMcpGrantInputs = {
  grants: HubToolGrants;
  catalog: ReadonlyMap<string, HubMcpServerCatalog>;
  sessions: Map<string, McpSession>;
  sink: StepSink;
  /** hub-fixes WP1.3 (RC3.4) — every granted server this turn actually ATTEMPTED to open, connected or
   *  not (never silently dropped): the rail's per-server chip + the prompt's own "Unreachable this
   *  turn" line both derive from this list. Optional so a stub/test provider that doesn't care about
   *  connection status keeps compiling unchanged (no events emitted, no prompt line added). */
  serverStatuses?: HubMcpServerStatusEntry[];
};

/** Resolve a turn's MCP grant inputs (server-level grants v1). Injected by index.ts; a stub in tests. */
export type HubMcpGrantsProvider = (
  ctx: HubToolsetContext,
) => HubMcpGrantInputs | null | Promise<HubMcpGrantInputs | null>;

/**
 * WP2.4 — the inputs a session's SKILL attachment surface needs (R-SK1…R-SK3): the session's
 * attachments (`hub_session_skills`, read by `index.ts`'s `HubRepository`) resolved to concrete
 * versions/frontmatter/footprint (`resolveHubSkillAttachments`) plus the {@link HubSkillReader} the
 * `skills.load` built-in needs to actually read L2/L3 content at call time. Bundled together (mirrors
 * `HubMcpGrantInputs`) so `resolveToolset` needs only ONE injection point.
 */
export type HubSkillCatalogInputs = {
  resolved: HubResolvedSkillAttachment[];
  reader: HubSkillReader;
};

/** Resolve a turn's skill catalog (session-level attachments only — role-level skills preload into the
 *  mission agent brief instead, see `missions/orchestrator.ts`'s `resolveRoleSkills` seam). Injected by
 *  index.ts; absent → no skills catalog at all (R-SK1's "zero skills" case, WP1.1-3 behavior unchanged). */
export type HubSkillCatalogProvider = (
  ctx: HubToolsetContext,
) => HubSkillCatalogInputs | Promise<HubSkillCatalogInputs>;

/** WP1.5 slot — the `claude_subscription` executor the model-resolution branch point delegates to. */
export type HubSubscriptionExecutor = (
  input: HubSubscriptionExecutorInput,
) => Promise<HubTurnResult>;

export type HubSubscriptionExecutorInput = {
  session: HubSession;
  modelId: string;
  abortSignal: AbortSignal;
  steering: HubSteeringQueue;
  sink: HubTurnSink;
  /** Present ⇒ interactive foreground: expose the `ask_user` tool + advertise `askUser:true`. The
   *  session-service binds this to the shared coordinator's questions mailbox
   *  (`hitl.waitForQuestion(sessionId, …)`), which the `POST …/answers` route resolves; resolves `null`
   *  when the session is stopped before answering. Absent ⇒ byte-identical no-ask behavior — which is
   *  exactly what a mission AGENT turn passes (model-identity WP4.2): a headless child has no operator
   *  watching it, so a blocking question would wedge the mission's parallel join. */
  waitForQuestion?: (questionId: string) => Promise<string | null>;
  /**
   * model-identity WP4.2 (**D-MI4**) — replace the executor's mode-assembled session prompt with a
   * caller-composed one. A mission AGENT turn passes the ROLE prompt here (identity replaced §8.4,
   * plus the prompt-enforced report contract), exactly as the AI-SDK path passes
   * `systemPromptOverride` to `runHubTurn`.
   *
   * It is a FUNCTION, not a string, for one reason: only the executor knows this turn's REAL resolved
   * MCP tool listing (it resolves the granted servers itself, D-MI3), and a role prompt that omitted
   * it would tell a tool-carrying agent it has no tools — the exact RC2 contradiction WP2.1 fixed on
   * the AI-SDK path. The executor calls it with the listing it actually wired.
   *
   * Absent (every chat/research session) ⇒ `assembleSessionPrompt`, byte-identical to pre-WP4.2.
   */
  buildSystemPrompt?: (ctx: {
    /** The `mcp__<server>__<tool>` listing the child was actually given, or undefined when tool-less. */
    toolListText?: string;
  }) => { text: string; promptVersion?: string };
};

/** WP2.x-friendly seam — refine the deterministic title with a cheap LLM one-shot. Returns a refined
 *  title, or undefined to keep the deterministic one. WP1.1 leaves it unset (deterministic-only). */
export type HubTitleRefiner = (input: {
  sessionId: string;
  userText: string;
  assistantText: string;
  deterministic: string;
}) => Promise<string | undefined>;

export type HubSessionServiceConfig = {
  /** Max concurrent live turns (`HUB_MAX_ACTIVE_SESSIONS`). */
  maxActiveSessions: number;
  /** Release-on-reply grace in ms (`HUB_SESSION_IDLE_RELEASE_MS`; 0 = release the instant a turn ends). */
  idleReleaseMs: number;
  /** Auto-title on (`HUB_AUTO_TITLE`). */
  autoTitle: boolean;
  /** The `/data` volume root for per-session workspaces (`config.dataDirectory`). */
  dataDir: string;
  /** Default tool-loading PREFERENCE for the built-in toolset (`config.hubToolLoadingDefault`). Widened
   *  in WP1.1 (D-HF1) from `ToolLoadingMode` to `HubToolLoadingPreference` so the flipped default `auto`
   *  (eager under the threshold, deferred-with-promotion above) flows through. */
  toolLoadingDefault: HubToolLoadingPreference;
  /** The `auto` loading-mode heuristic fraction (`config.hubToolSearchAutoFraction`). */
  autoFraction: number;
  /** WP1.1 (D-HF1) — absolute token cap on the `auto`-resolves-eager threshold
   *  (`config.hubToolEagerMaxTokens`, `HUB_TOOL_EAGER_MAX_TOKENS`). Optional so existing service
   *  constructions keep the pure fraction heuristic. */
  eagerMaxTokens?: number;
  /** WP1.1 (D-HF1) — per-`tool_search` promotion token cap (`config.hubToolPromoteMaxTokens`,
   *  `HUB_TOOL_PROMOTE_MAX_TOKENS`). Optional; the built-in falls back to its own default. */
  promoteMaxTokens?: number;
  /** WP2.4/R-SK1 — the L1 skill-listing budget as a fraction of the context window
   *  (`config.hubSkillListingBudgetFraction`). */
  skillListingBudgetFraction: number;
  /** WP2.4/R-SK1 — per-entry description truncation in the L1 catalog (`config.hubSkillEntryMaxChars`). */
  skillEntryMaxChars: number;
  /** WP2.4/R-SK2 — the `skills.load` compaction-protection budgets (`config.hubSkillCompactionTokens*`). */
  skillLoadBudgets: SkillLoadBudgets;
  /** WP2.6/R-GUI4 — the bounded GenUI repair-loop budget (`config.hubGenuiMaxRepairAttempts`,
   *  `HUB_GENUI_MAX_REPAIR_ATTEMPTS`). Optional so existing service constructions default it to 2. */
  genuiMaxRepairAttempts?: number;
  /** WP2.3 — the autonomy dial applied when a session sets none (`config.hubDefaultAutonomy`,
   *  `HUB_DEFAULT_AUTONOMY`). The dial governs live HITL tool-approval gating (D-AH6/R-MCP3). Optional
   *  so existing service constructions default it to the safe `always_ask`. */
  defaultAutonomy?: HubAutonomyLevel;
  /** WP3.3/R-SES8 — compact the model history when it reaches this fraction of the model's context
   *  window (`config.hubCompactionThresholdFraction`, `HUB_COMPACTION_THRESHOLD_FRACTION`). Optional so
   *  existing constructions default it to the compactor's own default (0.75). */
  compactionThresholdFraction?: number;
  /** WP3.3/R-SES8 — how many recent user turns stay HOT (verbatim) through compaction
   *  (`config.hubCompactionKeepRecentTurns`, `HUB_COMPACTION_KEEP_RECENT_TURNS`; default 4). */
  compactionKeepRecentTurns?: number;
  /** WP3.1/D-AH11c — the char cap on a project's assembled instructions + pinned files body before
   *  LAYER 6b injection (`config.hubProjectContextMaxChars`, `HUB_PROJECT_CONTEXT_MAX_CHARS`).
   *  Optional so existing service constructions fall back to `turn-engine.ts`'s own default. */
  projectContextMaxChars?: number;
  /** WP3.4/R-MCP7 — the live MCP output-cap thresholds (`config.hubMcpOutputWarnTokens`/
   *  `hubMcpOutputMaxTokens`, `HUB_MCP_OUTPUT_WARN_TOKENS`/`_MAX_TOKENS`). Optional; defaults to
   *  {@link DEFAULT_HUB_OUTPUT_CAP} (the same 10K/25K `config/env.ts` itself defaults to). */
  outputCapWarnTokens?: number;
  outputCapMaxTokens?: number;
  /** hub-fixes WP5.1 (RC5, D-HF2) — the web-tools kill switch (`config.hubWebToolsEnabled`,
   *  `HUB_WEB_TOOLS`). `false` removes `web.search` + `web.fetch` everywhere, including mission agents.
   *  Optional/undefined ⇒ enabled (a service constructed without it keeps web tools on by default). */
  webToolsEnabled?: boolean;
};

export type HubSessionServiceDeps = {
  repository: HubRepository;
  tokenCounter: TokenCounter;
  resolveModel: HubModelResolver;
  config: HubSessionServiceConfig;
  /** assistant-hub v1-fixes (F6) — the app-level `web.search` FALLBACK builtin (provider chain, built
   *  once at the composition root via `createFallbackWebSearchTool`). Used by `composeWebTools` for
   *  models with no provider-native search so search works on EVERY model kind. Absent ⇒ pre-fix
   *  native-only behavior. */
  webSearchFallback?: HubBuiltinTool;
  /** Default: the built-in resolver below (built-ins + any MCP grants from `mcpGrantsProvider`). A test
   *  may inject a fully-formed toolset directly, bypassing the built-in path. */
  resolveToolset?: HubToolsetResolver;
  /** WP1.4 — server-level MCP tool grants v1 (R-MCP1). Absent → built-ins only (WP1.1 behavior). */
  mcpGrantsProvider?: HubMcpGrantsProvider;
  /** WP2.4 — session-level skill attachment (R-SK1…R-SK3). Absent → no skills catalog at all (R-SK1's
   *  "zero skills" case — pre-WP2.4 behavior unchanged). */
  skillCatalogProvider?: HubSkillCatalogProvider;
  /** Default: deterministic-only titling (a refiner is wired later). */
  refineTitle?: HubTitleRefiner;
  /** WP1.5 slot — undefined until the subscription adapter is wired (a 501 branch). */
  subscriptionExecutor?: HubSubscriptionExecutor;
  /** WP1.4 — the per-dispatch citation apparatus (§1.7): seeds a stable-per-session ledger, wraps the
   *  toolset for numbered-source injection, and yields the `[n]`→`citations[]` post-pass. Wired from
   *  index.ts (`beginHubCitationTurn`); absent → no citations (WP1.1 behavior, existing tests unchanged). */
  beginCitationTurn?: HubCitationTurnFactory;
  /** WP1.4 seam — a static citation post-pass (overridden per-dispatch by `beginCitationTurn` when set). */
  citationPostPass?: HubCitationPostPass;
  /** WP2.3 — the shared live-HITL coordinator (approval mailboxes + elicitation routing). Optional so
   *  existing constructions get a fresh one; index.ts injects the SAME instance the decision routes +
   *  the MCP elicitation handler use, so a turn's pending approval/elicitation is reachable from them. */
  hitlCoordinator?: HubHitlCoordinator;
  /** WP3.3/R-SES8 — the compaction summarizer. Absent → the deterministic offline default (clears cold
   *  tool outputs + preserves user constraints + compresses the assistant narrative mechanically). A
   *  later WP may wire a model one-shot here; the fidelity guarantee (verbatim user constraints) does not
   *  depend on it. */
  summarizer?: HubSummarizer;
  /** hub-fixes WP6.1 (RC7) — the `auto`-mode chat-vs-mission ROUTING BRIDGE. When a top-level `auto`
   *  session's routing turn calls the `mission.propose_plan` builtin (the model's structured "this is a
   *  mission" signal), `dispatchMessage` invokes this seam AFTER the turn settles to hand the ask to the
   *  mission orchestrator (`HubMissionService.proposePlan`, which owns the planner + autonomy gate + the
   *  `plan_proposed` board event). Wired at the composition root (index.ts) to break the
   *  session-service↔mission-service construction cycle; absent ⇒ `auto` sessions never propose (the
   *  builtin call still validates/echoes, just no board — the pre-WP6.1 behavior for existing tests). */
  proposeMissionForTurn?: HubProposeMissionForTurn;
  /** End-user UX pass — the `@`-mention HANDOFF bridge. When a message carries `mentionedAgentIds`,
   *  `dispatchMessage` invokes this seam INSTEAD of running a chat turn: it hands the ask to the mission
   *  orchestrator as a deterministic explicit-agent team (`HubMissionService.proposePlan({ agentIds })`),
   *  which proposes a team card gated by the autonomy dial (approve-first). Wired at the composition root
   *  (index.ts, same reason as `proposeMissionForTurn` — breaks the construction cycle); absent ⇒ a
   *  mention message falls through to a normal chat turn. */
  handoffToAgentsForTurn?: HubHandoffToAgentsForTurn;
  logger?: { warn?: (msg: string) => void };
};

/** hub-fixes WP6.1 (RC7) — the `auto`-mode routing bridge seam (see `proposeMissionForTurn`). Returns
 *  when the proposal has settled (its `plan_proposed` — and, on an autonomy that auto-approves, the
 *  launch — already fanned out over the SAME live `sink`). Rejecting is caught + logged by the caller;
 *  a failed proposal never fails the routing turn that already completed. */
export type HubProposeMissionForTurn = (input: {
  sessionId: string;
  /** The user's ask that the routing turn just handled (already persisted by `dispatchMessage` — the
   *  bridge passes `echoUserMessage: false` so it is not doubled). */
  text: string;
  /** The live turn sink so the proposal streams over the same SSE channel. */
  sink: HubTurnSink;
}) => Promise<void>;

/** End-user UX pass — the `@`-mention handoff seam (see `handoffToAgentsForTurn`). Hands the ask to the
 *  mission orchestrator as an explicit deterministic team over the same live sink. `dispatchMessage`
 *  persists the ask before calling this (passes `echoUserMessage: false` so it is not doubled). */
export type HubHandoffToAgentsForTurn = (input: {
  sessionId: string;
  text: string;
  agentIds: string[];
  sink: HubTurnSink;
}) => Promise<void>;

/** The outcome of a dispatch: it ran a turn, was queued as steering (a mid-run message), was handed off
 *  to an explicit `@`-mention agent team (no chat turn ran), or was REFUSED before any turn started.
 *
 *  model-identity WP4.4 — `failed` is the settled-refusal outcome: the model could not be resolved (most
 *  visibly a WP2.2/D-MI9 **409** on an unusable per-message `providerCredentialId`), so the turn never
 *  began and the refusal was emitted as `error` + `turn_done` over the live sink. It is NOT a rejection:
 *  the route dispatches fire-and-forget behind a 202, so a rejection here is only ever a `log.warn` the
 *  operator never sees. Api-internal (this union is not on the wire), so adding a member is additive. */
export type HubDispatchResult =
  | { kind: "ran"; result: HubTurnResult }
  | { kind: "queued"; event: HubEvent }
  | { kind: "handoff" }
  | { kind: "failed"; message: string };

/**
 * hub-fixes WP2.1 (RC2) — the input the mission agent-turn seam ({@link HubSessionService.runAgentTurn})
 * receives to run one PLANNED mission agent as a REAL child hub session through the turn engine. The
 * `roleTemplate` is the curated Appendix-A role (identity replaced §8.4); `brief` is the child's SOLE
 * user turn (never the parent transcript — D-AH9). Everything here is composed by the mission
 * orchestrator from the frozen plan.
 */
export type HubAgentTurnInput = {
  agentSessionId: string;
  roleTemplate: HubRoleTemplateInjection;
  brief: string;
  budgets?: HubBudgets;
  abortSignal: AbortSignal;
  /** Optional live sink for the child turn's events (WP4.3 wires the child's own SSE channel here;
   *  hub-fixes WP2.5 wires the orchestrator's BOARD-APPROVAL MIRROR here for an `always_ask` mission).
   *  Absent ⇒ persist-only — the events still land in the child session log (the turn engine's persist
   *  choke point), just not fanned out live. */
  sink?: HubTurnSink;
  /** hub-fixes WP2.5 (D-HF6) — the mission's approval policy for this child turn. Absent ⇒ the safe
   *  `auto` default (read-only auto-runs, the rest auto-decline — WP2.1 byte-compatible). */
  missionApproval?: {
    /** The mission autonomy that governs child-call gating (D-HF6). `always_ask` queues every gated
     *  call to the board; `auto`/`threshold` auto-decline destructive/unannotated ones. */
    autonomy: HubAutonomyLevel;
    /** `always_ask` auto-deny budget (ms); a pending board decision auto-denies after it elapses (a
     *  mission MUST terminate). ≤0/absent ⇒ wait indefinitely. */
    approvalTimeoutMs?: number;
    /** The shared ledger the timeout auto-deny records toolCallIds into — the orchestrator's
     *  board-mirror sink reads it to stamp `agent_approval_responded.reason: "timeout"`. */
    timedOut?: Set<string>;
  };
};

/** The outcome of one mission agent turn: the raw {@link HubTurnResult} (real usage/cost/status) plus
 *  the count of gated MCP calls the mission-autonomy approval policy DENIED this turn (auto-declined
 *  under auto/threshold, or operator-denied / timed-out under always_ask — hub-fixes WP2.5), surfaced as
 *  a report note by the runner. `timedOutToolCalls` is the subset auto-denied by the approval TIMEOUT. */
export type HubAgentTurnResult = {
  result: HubTurnResult;
  deniedToolCalls: number;
  /** hub-fixes WP2.5 — the subset of `deniedToolCalls` auto-denied by the approval timeout (a distinct
   *  report note). Optional so a pre-WP2.5 stub result stays byte-compatible. */
  timedOutToolCalls?: number;
};

/**
 * hub-fixes WP3.2 (RC4, D-HF4) — the input the mission SYNTHESIS-turn seam
 * ({@link HubSessionService.runSynthesisTurn}) receives to run the mission's final answer as a REAL turn
 * of the PARENT session through the turn engine, with the GenUI `present` tools granted (MCP tools are NOT
 * — the synthesis reasons over the agent reports; it never re-queries). Modeled on {@link HubAgentTurnInput}
 * (bounded, bypasses the active-session slot cap): the fully-assembled synthesizer prompt (synthesizer
 * layers + GenUI catalog + the reports digest + numbered source list + compose instructions) is passed as
 * `systemPromptOverride`; the `citations` are the merged, re-numbered set the caller stamps onto the
 * settled `assistant_message` (so every `[n]` resolves) via the citation post-pass, and `partialPrefix`
 * (when the mission is partial) is prepended to the first text part there. Everything here is composed by
 * the mission synthesizer ({@link synthesizeMission}) from the frozen plan + the agent reports.
 */
export type HubSynthesisTurnInput = {
  /** The PARENT (mission) session — the synthesis is a real turn of it (its assistant_message + turn_done
   *  are persisted into ITS log, exactly where a synthesis message lands today). */
  sessionId: string;
  /** The effective synthesis model id (the plan's first agent model, else the parent session model). */
  model: string;
  /** model-identity WP2.1 (D-MI1) — the credential that owns {@link model} (the plan's first agent's own
   *  `providerCredentialId` when the model came from there). Absent ⇒ the PARENT session's pin, then the
   *  unchanged name heuristic — so a pre-WP2.1 caller resolves exactly as it did before. */
  providerCredentialId?: string;
  /** The fully-assembled synthesizer system prompt (REPLACES the mode-assembled prompt for this turn). */
  systemPromptOverride: string;
  /** The merged, re-numbered session-level citation set stamped onto the settled `assistant_message`. */
  citations: HubCitation[];
  /** When the mission is PARTIAL, the note prepended to the first text part (kept in {@link synthesizeMission}
   *  as the single source of the wording); absent ⇒ no prefix. */
  partialPrefix?: string;
  /** Abort the synthesis turn (the mission's own abort); absent ⇒ a never-aborted signal. */
  abortSignal?: AbortSignal;
  /** The mission (parent) live sink — the synthesis assistant_message/turn_done fan out here, exactly as
   *  the fallback text path's own appended events do. */
  sink: HubTurnSink;
};

/** The outcome of the mission synthesis turn: the id of the settled synthesis `assistant_message` (the
 *  turn engine persisted it; the caller links the `mission_synthesis` marker to it) + the turn's REAL
 *  cost/usage. `runSynthesisTurn` THROWS on failure (no message persisted) so the caller falls back to the
 *  byte-compatible text synthesizer without ever double-persisting. */
export type HubSynthesisTurnResult = {
  messageId: string;
  costUsd: number;
  usage?: HubUsage;
};

/** One live turn holding an active-session slot. */
type ActiveTurn = {
  sessionId: string;
  abort: AbortController;
  steering: HubSteeringQueue;
  sink: HubTurnSink;
  running: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
};

/**
 * hub-fixes WP1.3 (RC3.4) — a tiny per-id cache over a live resource's opener, pulled out of what used
 * to be a bare `Map` + closure inline in `index.ts` (`hubMcpSessions`) so the eviction behavior a
 * "reconnect" action needs is unit-testable in isolation, not just exercised end-to-end through a live
 * MCP server. `get` caches the IN-FLIGHT promise (never opens the same id twice concurrently); a
 * REJECTED open auto-evicts itself so the next `get` retries fresh — this is the exact pre-WP1.3
 * behavior `index.ts`'s `getHubMcpSession` already had ("evict a failed open so a later turn can
 * retry"), unchanged. `evict` is the NEW half: force-drop a cached entry (failed OR successfully open),
 * best-effort closing whatever it resolved to, so the next `get` is guaranteed a fresh connection
 * attempt — the whole job of `POST /api/hub/servers/:id/reconnect`.
 */
export class HubResourcePool<T extends { close(): Promise<void> }> {
  private readonly live = new Map<string, Promise<T>>();

  async get(id: string, open: () => Promise<T>): Promise<T> {
    let pending = this.live.get(id);
    if (!pending) {
      pending = open();
      this.live.set(id, pending);
    }
    try {
      return await pending;
    } catch (error) {
      // Only evict THIS attempt — a concurrent `evict`/newer `get` may already have replaced it.
      if (this.live.get(id) === pending) this.live.delete(id);
      throw error;
    }
  }

  /** Drop `id`'s cached entry (if any), best-effort closing whatever it resolved to. Never throws —
   *  an already-failed or already-closed resource has nothing further to do. */
  async evict(id: string): Promise<void> {
    const pending = this.live.get(id);
    this.live.delete(id);
    if (!pending) return;
    try {
      const resource = await pending;
      await resource.close();
    } catch {
      // The cached attempt had already failed (nothing to close) or close() itself failed — either
      // way the entry is already gone from `live` above, so the next `get` opens fresh regardless.
    }
  }
}

export class HubSessionService {
  private readonly live = new Map<string, ActiveTurn>();
  /** WP2.3 — the shared HITL coordinator (approval + elicitation mailboxes, session-scoped "always",
   *  serverId→session routing). Constructed once here; index.ts injects the SAME instance so the
   *  decision routes + the MCP elicitation handler resolve the turn's pending decisions. */
  private readonly hitl: HubHitlCoordinator;
  /** hub-fixes WP1.3 (RC3.4) — per-session, per-server LAST KNOWN MCP connection status, so a
   *  `mcp_server_status` event is only appended when it actually CHANGES (never every turn — the
   *  spec's own dedupe requirement). Purely an in-memory emission gate; the durable truth is the
   *  persisted event log itself. */
  private readonly lastMcpStatus = new Map<string, Map<string, "connected" | "error">>();

  constructor(private readonly deps: HubSessionServiceDeps) {
    this.hitl = deps.hitlCoordinator ?? new HubHitlCoordinator();
  }

  /** The session's effective autonomy dial (D-AH6): its own setting, else the configured default
   *  (`HUB_DEFAULT_AUTONOMY`, else the safe `always_ask`). */
  resolveAutonomy(session: Pick<HubSession, "autonomy">): HubAutonomyLevel {
    return session.autonomy ?? this.deps.config.defaultAutonomy ?? "always_ask";
  }

  // ── Live HITL decision application (WP2.3) — called by the decision routes ───────────────────────

  /** Resolve a pending approval-gated tool call (R-MCP3/R-UX1). Returns false when nothing is pending
   *  for this tool call (the route surfaces a 404/409). */
  decideApproval(
    sessionId: string,
    toolCallId: string,
    resolution: HubApprovalResolution,
  ): boolean {
    return this.hitl.resolveApproval(sessionId, toolCallId, resolution);
  }

  /** Respond to a pending MCP elicitation (R-MCP4). Returns false when nothing is pending. */
  respondElicitation(
    sessionId: string,
    elicitationId: string,
    decision: HubElicitationDecision,
  ): boolean {
    return this.hitl.resolveElicitation(sessionId, elicitationId, decision);
  }

  /** Answer a pending agent-initiated `ask_user` question (the `POST …/answers` route). Unblocks the
   *  paused `ask_user` tool, which emits `question_resolved` over the session's SSE. Returns false when
   *  no question is pending for that id (the route surfaces a 409). */
  answerQuestion(sessionId: string, questionId: string, answer: string): boolean {
    return this.hitl.resolveQuestion(sessionId, questionId, answer);
  }

  /** Route an MCP server's `elicitation/create` to whichever session's turn is currently driving that
   *  server (the MCP client's registered handler — index.ts wiring). Declines when no turn is driving
   *  it. `context` carries the server's display name for the emitted event. */
  handleElicitation(
    serverId: string,
    params: unknown,
    context?: { serverName?: string },
  ): Promise<HubElicitationDecision> {
    const request: NormalizedElicitationRequest = normalizeElicitationRequest(params, {
      serverId,
      ...(context?.serverName ? { serverName: context.serverName } : {}),
    });
    return this.hitl.handleElicitation(serverId, request);
  }

  /**
   * Create a session and resolve + persist its capability manifest (D-US4 — the UI gates on it). The
   * session starts `pending`; its first dispatch flips it to `running`.
   */
  async createSession(input: HubSessionCreateInput | HubSessionCreateOptions): Promise<HubSession> {
    // hub-fixes (Defect 1a) — union the scoped-in roster's server grants into the session's tool scope so
    // a reused server-bound role's MCP server stays reachable (else the mission plan clamp strips it and
    // the agent runs tool-less). No-op for an auto (null/absent) scope or an empty roster.
    const scoped = unionRosterServersIntoScope(this.deps.repository, input.toolScope, input.roster);
    // model-identity WP2.2 (D-MI9) — resolve BEFORE the row is written. WP2.1 resolved against the
    // PERSISTED pin, which is equivalent (`createSession` writes `input.providerCredentialId ?? null`
    // verbatim — no trim, no coercion — and `toSession` reads the column straight back, so
    // `session.providerCredentialId ?? undefined` and `input.providerCredentialId ?? undefined` are the
    // same value in every case; the route schema `hubProviderCredentialIdSchema` has already trimmed and
    // rejected an empty string). It was NOT equivalent in one respect that matters now: with the INSERT
    // first, an UNKNOWN pin died on the `provider_credential_id` foreign key — a raw better-sqlite3
    // `SQLITE_CONSTRAINT`, which carries `code` and not `statusCode`, so `index.ts`'s error handler
    // returned a **500** and the resolver never ran at all. D-MI9 anchors its refusal to the module's
    // `NO_PROVIDER_MESSAGE` posture — the HTTP response, not just an internal function — so the check has
    // to happen before the write. The FK stays as a backstop; it is no longer the mechanism.
    //
    // Resolving first also means a refused create writes NO row: previously any throw here (this one, or
    // `assertHubModelKind` below) left an orphan `hub_sessions` row whose id the client never learned.
    // An omitted pin still reads as undefined ⇒ the unchanged heuristic ⇒ historical replay intact.
    const resolution = await this.deps.resolveModel(
      input.model,
      input.providerCredentialId ?? undefined,
    );
    assertHubModelKind(resolution.providerKind);
    const session = this.deps.repository.createSession(
      scoped && scoped !== input.toolScope ? { ...input, toolScope: scoped } : input,
    );
    // Interactive foreground sessions (chat/research) expose `ask_user`; a mission agent child does not.
    const capabilities = hubCapabilitiesForKind(resolution.providerKind, session.kind !== "agent");
    return this.deps.repository.setSessionLifecycle(session.id, { capabilities });
  }

  /**
   * Dispatch a settled user message. If a turn is already RUNNING for the session, the message is durable
   * STEERING (R-SES3): it is enqueued (persisted as `queued_user_message`) and forwarded live, to be
   * injected at the running turn's next step boundary. Otherwise it acquires an active-session slot (409
   * over the cap), persists the `user_message`, and runs the turn on the resolved model.
   *
   * model-identity WP4.4 — a message whose MODEL cannot be resolved (a WP2.2/D-MI9 409 on an unusable
   * per-message `providerCredentialId`, or a non-hub model kind) returns `{ kind: "failed" }` after
   * emitting `error` + `turn_done` over the sink, rather than rejecting into the route's fire-and-forget
   * `.catch` where nobody sees it. See the guard's own comment for why the surrounding steps stay put.
   */
  async dispatchMessage(
    sessionId: string,
    input: HubSendMessageInput,
    sink: HubTurnSink,
  ): Promise<HubDispatchResult> {
    const session = this.deps.repository.getSession(sessionId);

    // Steering: a message typed while the turn is running queues durably and injects at a step boundary.
    // (A mention sent mid-turn queues as plain text here — a handoff needs the session free, so it can't
    // run concurrently with a live turn; the `@Name` stays in the queued text.)
    const existing = this.live.get(sessionId);
    if (existing?.running) {
      // model-identity WP6.1 (F4) — the caller's `providerCredentialId` used to be DROPPED here: the
      // enqueue signature had no slot for it, so a mid-turn "Retry on the other auth source" queued
      // onto the running credential with nothing recording what had been asked for. It is now persisted
      // on the `queued_user_message` as the operator's REQUEST.
      //
      // It is deliberately NOT applied. The running turn's `HubModelResolution` is fixed before the
      // steering loop drains (`runHubTurn`/the subscription adapter receive an already-built model), so
      // honouring a queued credential would mean rebuilding the provider model mid-turn — and for a
      // `claude_subscription` pin, switching executors entirely, mid-stream, on a warm child. That is a
      // structural change to the turn loop, out of scope for this remediation WP and REPORTED rather
      // than half-done. What is fixed is the dishonesty: the ask is recorded, and the injected
      // `user_message` is stamped with the model that genuinely ran.
      if (input.providerCredentialId || input.model) {
        this.deps.logger?.warn?.(
          `hub steering (session ${sessionId}): a queued message requested a model/credential override ` +
            "while a turn was running; the running turn's resolution is already fixed, so the override " +
            "is recorded on the queued_user_message but NOT applied to the injected turn",
        );
      }
      const event = existing.steering.enqueue({
        text: input.text,
        ...(input.model ? { model: input.model } : {}),
        ...(input.providerCredentialId
          ? { providerCredentialId: input.providerCredentialId }
          : {}),
        ...(input.attachmentFileIds ? { attachmentFileIds: input.attachmentFileIds } : {}),
      });
      existing.sink.onEvent(event);
      return { kind: "queued", event };
    }

    // End-user UX pass — a message that `@`-mentions saved agents HANDS THE TASK OFF to exactly those
    // agents as a deterministic team (approve-first, gated by the autonomy dial) instead of running a
    // chat turn. Persist the ask (transcript) + set the title as a normal send would, then bridge to the
    // mission orchestrator over the same sink (no chat turn, no parent slot). Absent seam ⇒ fall through
    // to a normal chat turn (the ids are simply ignored).
    if (input.mentionedAgentIds && input.mentionedAgentIds.length > 0 && this.deps.handoffToAgentsForTurn) {
      const agentIds = input.mentionedAgentIds;
      if (this.deps.config.autoTitle && session.titleState === "pending") {
        const title = hubDeterministicTitle(input.text);
        if (title) this.deps.repository.setAutoTitle(sessionId, title);
      }
      const userEvent = this.deps.repository.appendEvent(sessionId, {
        type: "user_message",
        messageId: nanoid(),
        text: input.text,
        ...(input.model ? { model: input.model } : {}),
        ...(input.attachmentFileIds ? { attachmentFileIds: input.attachmentFileIds } : {}),
      });
      sink.onEvent(userEvent);
      try {
        await this.deps.handoffToAgentsForTurn({ sessionId, text: input.text, agentIds, sink });
      } catch (error) {
        // A handoff can throw — e.g. a 409 (a mission is already in progress for this session) or a 400
        // (every mentioned agent has since been deleted → nothing to resolve). Surface it as a SETTLED
        // error turn so the client isn't left with a dangling, un-answered user message.
        const message =
          error instanceof Error ? error.message : "The agent handoff could not be started.";
        sink.onEvent(this.deps.repository.appendEvent(sessionId, { type: "error", message }));
        sink.onEvent(this.deps.repository.appendEvent(sessionId, { type: "turn_done" }));
      }
      return { kind: "handoff" };
    }

    const effectiveModel = input.model ?? session.model;
    // model-identity WP2.1 (D-MI1) — the message's own credential (sent alongside a per-turn `model`
    // override; this is what makes the limit-error "retry on the other auth source" action actually
    // switch source) wins over the session's persisted pin; neither ⇒ the unchanged name heuristic.
    const effectiveCredentialId =
      input.providerCredentialId ?? session.providerCredentialId ?? undefined;
    // model-identity WP4.4 — MODEL RESOLUTION MUST SETTLE OVER THE SINK, NOT VANISH.
    //
    // `POST /api/hub/sessions/:id/messages` answers **202** and dispatches fire-and-forget into a
    // `.catch(log.warn)` (`routes.ts`), so anything that throws HERE — before `acquireSlot`, before the
    // `user_message` is persisted, before a single `sink.onEvent` — reaches the operator through exactly
    // nothing. WP2.2 (D-MI9) made an unusable per-message credential pin a **409**; on this path that 409
    // was a silent no-op, and WP4.3's "retry on the other auth source" button (which sends a DIFFERENT
    // `providerCredentialId` on purpose) therefore did nothing at all when the other source was refused.
    // A dead button is worse than an error.
    //
    // The fix is the one this method already uses a few lines ABOVE for a failed `@`-mention handoff
    // ("so the client isn't left with a dangling, un-answered user message"): settle the turn honestly
    // over the SAME live sink (`error` + `turn_done`) rather than changing the 202 contract. Both events
    // are append-only and replay, so a client that reconnects still sees the refusal.
    //
    // Deliberate boundaries:
    //   • `assertHubModelKind` is inside the guard — it is the other half of "resolve this model", fails
    //     the same way (a thrown `httpError` before anything is persisted), and was silent for the same
    //     reason.
    //   • `acquireSlot` stays OUTSIDE it. It runs strictly AFTER this guard, so on this path no slot has
    //     been acquired and there is none to release or double-release. Its own cap-409 keeps REJECTING
    //     (`hub-session-service.test.ts` "the active-session cap 409s…" asserts exactly that, and the
    //     direct in-process callers rely on it). NOTE, honestly: over the 202 route that cap-409 is
    //     silent for the same structural reason this WP fixes. That is a real, separate gap; it is not
    //     this WP's (a busy cap is a retry-later condition, not a refused credential), so it is reported
    //     rather than widened into here.
    //   • Nothing is persisted before this point on the non-handoff path, so a refused send leaves **no
    //     dangling `user_message`** — the outcome the handoff catch exists to guarantee.
    //   • No `STOP_REASON_CODES`/`TerminalCause` value is minted or repurposed for this (README §3): a
    //     turn that never started has no stop reason, and inventing one corrupts every observability and
    //     auto-rating bucket that reads them.
    let resolution: HubModelResolution;
    try {
      resolution = await this.deps.resolveModel(effectiveModel, effectiveCredentialId);
      assertHubModelKind(resolution.providerKind);
    } catch (error) {
      // Same shape as the handoff catch above: the thrown message IS the operator-facing one (the D-MI9
      // 409 names the credential by its REDACTED label and says which check failed — never a key).
      const message =
        error instanceof Error
          ? error.message
          : "This message could not be sent — its model could not be resolved.";
      this.deps.logger?.warn?.(
        `hub model resolution failed for session ${sessionId} (model "${effectiveModel}"): ${message}`,
      );
      sink.onEvent(this.deps.repository.appendEvent(sessionId, { type: "error", message }));
      sink.onEvent(this.deps.repository.appendEvent(sessionId, { type: "turn_done" }));
      return { kind: "failed", message };
    }

    // Acquire (or reuse an in-grace) slot; enforce the concurrency cap for a genuinely NEW live session.
    const slot = this.acquireSlot(sessionId, sink);

    // Deterministic title from the very first user message (before the turn — mirrors the dock).
    const isFirstTurn = session.titleState === "pending";
    if (this.deps.config.autoTitle && isFirstTurn) {
      const title = hubDeterministicTitle(input.text);
      if (title) this.deps.repository.setAutoTitle(sessionId, title);
    }

    // Persist the settled user turn (event-sourced history) + forward it live.
    const userEvent = this.deps.repository.appendEvent(sessionId, {
      type: "user_message",
      messageId: nanoid(),
      text: input.text,
      ...(input.model ? { model: input.model } : {}),
      ...(input.attachmentFileIds ? { attachmentFileIds: input.attachmentFileIds } : {}),
    });
    sink.onEvent(userEvent);

    try {
      const fresh = this.deps.repository.getSession(sessionId);
      // `dispatchMessage` is the FOREGROUND user-turn path (mission agent/synthesis turns run through
      // `runAgentTurn`/`runSynthesisTurn`), so it exposes the interactive `ask_user` tool.
      const askUserExposed = fresh.kind !== "agent";
      const capabilities = hubCapabilitiesForKind(resolution.providerKind, askUserExposed);

      // hub-fixes WP6.1 (RC7) — snapshot the log length BEFORE the routing turn so the post-turn bridge
      // only inspects THIS turn's events for a `mission.propose_plan` call (see `maybeRouteAutoMission`).
      const eventCountBeforeTurn = this.deps.repository.listEvents(sessionId).length;

      // ── Model-resolution branch point. WP1.1 runs the AI-SDK path; a subscription session delegates
      //    to the (injected) WP1.5 executor.
      let result: HubTurnResult;
      if (resolution.providerKind === "claude_subscription") {
        if (!this.deps.subscriptionExecutor) {
          throw httpError(
            501,
            "Claude subscription sessions are not available yet (the WP1.5 adapter is not wired).",
          );
        }
        result = await this.deps.subscriptionExecutor({
          session: fresh,
          modelId: resolution.modelId,
          abortSignal: slot.abort.signal,
          steering: slot.steering,
          sink,
          ...(askUserExposed
            ? {
                waitForQuestion: (questionId: string) =>
                  this.hitl.waitForQuestion(sessionId, questionId),
              }
            : {}),
        });
      } else {
        if (!isHubAiSdkKind(resolution.providerKind) || !resolution.buildModel) {
          throw httpError(500, `Model "${effectiveModel}" resolved with no AI-SDK model builder.`);
        }
        const baseToolset = await this.resolveToolset(
          {
            session: fresh,
            providerKind: resolution.providerKind,
            modelId: resolution.modelId,
            contextWindow: resolution.contextWindow,
          },
          sink,
        );
        // ── WP1.4 citation apparatus (§1.7): a per-dispatch ledger seeded from THIS session's prior
        //    citations (the current user turn is persisted above; its assistant reply isn't yet). The
        //    ledger is shared by the toolset wrapper (numbers sources at execution time — what the model
        //    sees) and the post-pass (resolves the `[n]` markers back), so numbering can never drift.
        const citation = this.deps.beginCitationTurn?.(this.deps.repository.listEvents(sessionId));
        const toolset = citation ? citation.wrapToolset(baseToolset) : baseToolset;
        // hub-fixes WP5.1 (RC5, D-HF2) — provider-native web-search results are NOT numbered by the
        // WP1.4 execution-time wrapper (they have no local `execute`), so compose a post-pass that first
        // records their sources into the SAME ledger (Anthropic/OpenAI from the tool-results, Google from
        // the step-metadata `providerSearchSources`), then delegates. Absent citation apparatus ⇒ the base
        // post-pass unchanged.
        const citationPostPass = composeWebCitationPostPass(
          citation,
          citation?.postPass ?? this.deps.citationPostPass,
        );
        // ── WP2.3 live HITL seam — the per-turn bridge to the shared coordinator, already bound to this
        //    session's id + the granted MCP servers (so a pooled connection's `elicitation/create` routes
        //    here). The autonomy dial + per-tool annotation policy resolve the WRAP decision; the turn
        //    engine owns emitting the events + the `waiting_input` pause.
        const hitl = this.buildTurnHitl(sessionId, fresh, toolset);
        // ── WP3.3 compaction seam (R-SES8) — bound to THIS turn's model window + the user's optional aim.
        //    Compaction clears cold tool outputs then summarizes when the history approaches the window,
        //    persisting a rolling summary + a `compaction` marker (through the engine's persist choke
        //    point). A thrash outcome stops the turn honestly rather than looping.
        const compactor = createHubCompactor({
          repository: this.deps.repository,
          tokenCounter: this.deps.tokenCounter,
          ...(this.deps.summarizer ? { summarizer: this.deps.summarizer } : {}),
          config: {
            sessionId,
            contextWindow: resolution.contextWindow,
            skillBudgets: this.deps.config.skillLoadBudgets,
            ...(this.deps.config.compactionThresholdFraction !== undefined
              ? { thresholdFraction: this.deps.config.compactionThresholdFraction }
              : {}),
            ...(this.deps.config.compactionKeepRecentTurns !== undefined
              ? { keepRecentTurns: this.deps.config.compactionKeepRecentTurns }
              : {}),
            ...(input.compactionAim ? { userAim: input.compactionAim } : {}),
          },
        });
        result = await runHubTurn(
          { repository: this.deps.repository },
          {
            session: fresh,
            promptMode: promptModeFor(fresh),
            model: resolution.buildModel(),
            providerKind: resolution.providerKind,
            modelId: resolution.modelId,
            capabilities,
            contextWindow: resolution.contextWindow,
            toolset,
            ...(resolution.providerOptions ? { providerOptions: resolution.providerOptions } : {}),
            ...(fresh.budgets ? { budgets: fresh.budgets } : {}),
            abortSignal: slot.abort.signal,
            steering: slot.steering,
            sink,
            hitl,
            compactor,
            ...(citationPostPass ? { citationPostPass } : {}),
            ...(this.deps.config.projectContextMaxChars
              ? { projectContextMaxChars: this.deps.config.projectContextMaxChars }
              : {}),
          },
        );
      }

      // Auto-title refine after the first COMPLETED turn (fire-and-forget; never blocks the reply).
      if (isFirstTurn && result.completed && this.deps.config.autoTitle && this.deps.refineTitle) {
        void this.maybeRefineTitle(sessionId).catch(() => undefined);
      }

      // hub-fixes WP6.1 (RC7) — `auto`-mode chat-vs-mission routing: if this routing turn called
      // `mission.propose_plan`, hand the ask to the mission orchestrator (proposal streams over the same
      // sink). Awaited so its `plan_proposed` lands before dispatch resolves; never fails the settled turn.
      await this.maybeRouteAutoMission(fresh, input.text, eventCountBeforeTurn, sink);

      return { kind: "ran", result };
    } finally {
      slot.running = false;
      this.scheduleRelease(slot);
      // Defensive HITL teardown (the turn engine also releases on its own terminal — idempotent): settle
      // any dangling pending approval/elicitation + drop the server routing even if the turn threw.
      this.hitl.releaseTurn(sessionId);
    }
  }

  /**
   * hub-fixes WP6.1 (RC7) — the `auto`-mode chat-vs-mission ROUTING BRIDGE. Runs AFTER a top-level
   * `auto` session's routing turn settles: if the model called the `mission.propose_plan` builtin during
   * THIS turn (its structured "this ask is a mission" signal), hand the ask to the mission orchestrator
   * (`proposeMissionForTurn` seam → `HubMissionService.proposePlan`), which owns the planner, the
   * autonomy gate (D-AH6 — an `always_ask` session still WAITS for approval; nothing launches silently),
   * and the `plan_proposed` board event. Passes `echoUserMessage: false` inside the seam so the ask
   * `dispatchMessage` already persisted isn't doubled. A no-op for every non-`auto` session, for an
   * `auto` turn that did NOT propose, when the seam is unwired, or when a non-terminal mission already
   * exists (the model can't stack two). A failed proposal is logged, never re-thrown — the routing turn
   * already completed.
   */
  private async maybeRouteAutoMission(
    session: HubSession,
    text: string,
    eventCountBeforeTurn: number,
    sink: HubTurnSink,
  ): Promise<void> {
    if (!canAutoRouteMission(session) || !this.deps.proposeMissionForTurn) return;

    const events = this.deps.repository.listEvents(session.id);
    const proposedThisTurn = events
      .slice(eventCountBeforeTurn)
      .some((e) => e.type === "tool_call" && e.part.toolName === MISSION_PROPOSE_TOOL_NAME);
    if (!proposedThisTurn) return;

    // One mission per session (D-AH8): don't stack a proposal on a still-running one.
    const existing = this.deps.repository.getMissionBySession(session.id);
    if (existing && !isMissionTerminal(existing.status)) return;

    try {
      await this.deps.proposeMissionForTurn({ sessionId: session.id, text, sink });
    } catch (error) {
      this.deps.logger?.warn?.(
        `hub auto-mode mission routing failed for session ${session.id}: ${toErrorMessage(error)}`,
      );
    }
  }

  /**
   * hub-fixes WP2.1 (RC2) — the AGENT-KIND turn entry seam: run ONE planned mission agent as a REAL child
   * hub session through the SAME turn engine main sessions use, so its granted MCP tools are callable, its
   * tool calls stream into the CHILD log, and it accumulates real usage/cost — replacing the tool-less
   * one-shot `generateObject` runner (the orchestrator then extracts a structured report from the settled
   * transcript). Deliberately does NOT go through {@link dispatchMessage}: a mission agent must not draw an
   * active-session slot (it is bounded by the mission's own `maxParallel`), auto-title, or the citation
   * apparatus — its report contract carries citations. The curated ROLE prompt is passed as the turn's
   * `systemPromptOverride` (identity replaced §8.4), assembled here WITH the turn's REAL resolved tool
   * listing so the prompt tells the agent its actual granted tools (killing RC2's "No MCP tools are
   * granted" contradiction). Approvals follow the FULL mission-autonomy policy (hub-fixes WP2.5, D-HF6):
   * `always_ask` queues every gated child call to the board (the shared HITL coordinator, resolved by
   * the child session's own `/approvals` route, bounded by the approval timeout); `auto`/`threshold`
   * auto-run read-only-annotated MCP tools and auto-decline the rest — see `tools/approval-policy.ts`.
   */
  async runAgentTurn(input: HubAgentTurnInput): Promise<HubAgentTurnResult> {
    const child = this.deps.repository.getSession(input.agentSessionId);
    // model-identity WP2.1 — the child session's OWN pin (the orchestrator copies the planned agent's
    // `providerCredentialId` onto it at spawn); NULL on a pre-v55 child ⇒ the unchanged heuristic.
    const resolution = await this.deps.resolveModel(
      child.model,
      child.providerCredentialId ?? undefined,
    );
    assertHubModelKind(resolution.providerKind);
    // ── model-identity WP4.2 (D-MI4) — the SUBSCRIPTION branch. Before WP2.1 this was unreachable (the
    //    name heuristic structurally cannot emit `claude_subscription`, README §1); now that a planned
    //    agent's pin crosses parent→child at spawn, a subscription-pinned agent lands here and must RUN,
    //    not throw the 500 below. Its report comes from the prompt-enforced contract the orchestrator
    //    folded into the role prompt (`missions/agent-report-contract.ts`), never from `generateObject`.
    if (resolution.providerKind === "claude_subscription") {
      return this.runSubscriptionAgentTurn(child, resolution, input);
    }
    if (!isHubAiSdkKind(resolution.providerKind) || !resolution.buildModel) {
      throw httpError(
        500,
        `Mission agent model "${child.model}" resolved with no AI-SDK model builder.`,
      );
    }
    const sink: HubTurnSink = input.sink ?? { onEvent: () => {}, onDelta: () => {} };

    // ISOLATION (D-AH9): the curated brief is the child's SOLE user turn — the parent conversation never
    // enters its context. Persisted BEFORE the turn so the reconstructed history already ends with it
    // (exactly as `dispatchMessage` persists a `user_message` before `runHubTurn`).
    const userEvent = this.deps.repository.appendEvent(input.agentSessionId, {
      type: "user_message",
      messageId: nanoid(),
      text: input.brief,
    });
    sink.onEvent(userEvent);

    const fresh = this.deps.repository.getSession(input.agentSessionId);
    const ctx: HubToolsetContext = {
      session: fresh,
      providerKind: resolution.providerKind,
      modelId: resolution.modelId,
      contextWindow: resolution.contextWindow,
    };
    // The child now HAS a `toolScope` (the plan grants, set at creation), so the normal grants provider
    // (WP1.2 honor + WP1.1 loading) yields its granted MCP tools as CALLABLE AI-SDK tools.
    const toolset = await this.resolveToolset(ctx, sink);

    // The ROLE prompt WITH this turn's real resolved tool listing (RC2 fix): identity replaced §8.4 +
    // honest granted-tools guidance (deferred `tool_search` note carried when the mode defers).
    const rolePrompt = assembleRolePrompt({
      role: input.roleTemplate,
      tools: {
        ...(toolset.toolListText ? { toolListText: toolset.toolListText } : {}),
        ...(toolset.skillsListText ? { skillsListText: toolset.skillsListText } : {}),
        ...(toolset.loadingMode ? { loadingMode: toolset.loadingMode } : {}),
      },
    });

    // hub-fixes WP2.5 (D-HF6) — the mission-autonomy approval policy. The coordinator interactions are
    // the SAME `this.hitl` a normal user turn uses, but scoped to the CHILD session id, so the board's
    // per-child-session `/approvals` route (`decideApproval`) resolves an always_ask card and the timeout
    // never leaves a mailbox dangling (releaseTurn settles it on turn end). Absent policy ⇒ safe `auto`.
    const missionAutonomy = input.missionApproval?.autonomy ?? "auto";
    const agentHitl = buildMissionAgentHitl({
      toolset,
      autonomy: missionAutonomy,
      ...(input.missionApproval?.approvalTimeoutMs !== undefined
        ? { approvalTimeoutMs: input.missionApproval.approvalTimeoutMs }
        : {}),
      ...(input.missionApproval?.timedOut ? { timedOut: input.missionApproval.timedOut } : {}),
      waitForOperatorDecision: (toolCallId) =>
        this.hitl.waitForApproval(input.agentSessionId, toolCallId),
      hasAlways: (toolName) => this.hitl.hasAlways(input.agentSessionId, toolName),
      recordAlways: (toolName) => this.hitl.recordAlways(input.agentSessionId, toolName),
      release: () => this.hitl.releaseTurn(input.agentSessionId),
    });
    const capabilities = hubCapabilitiesForKind(resolution.providerKind);

    const result = await runHubTurn(
      { repository: this.deps.repository },
      {
        session: fresh,
        promptMode: promptModeFor(fresh),
        model: resolution.buildModel(),
        providerKind: resolution.providerKind,
        modelId: resolution.modelId,
        capabilities,
        contextWindow: resolution.contextWindow,
        toolset,
        systemPromptOverride: rolePrompt.text,
        ...(resolution.providerOptions ? { providerOptions: resolution.providerOptions } : {}),
        ...(input.budgets ? { budgets: input.budgets } : {}),
        abortSignal: input.abortSignal,
        steering: new HubSteeringQueue(input.agentSessionId, this.deps.repository),
        sink,
        hitl: agentHitl.hitl,
      },
    );
    return {
      result,
      deniedToolCalls: agentHitl.deniedCount(),
      timedOutToolCalls: agentHitl.timedOutCount(),
    };
  }

  /**
   * model-identity WP4.2 (**D-MI4**) — run ONE mission agent on the `claude_subscription` (Agent-SDK)
   * executor.
   *
   * The owner chose to make a subscription-pinned agent WORK in a mission rather than refuse it at
   * save/plan time, so this is the mission-agent twin of {@link dispatchMessage}'s subscription branch.
   * It reuses the SAME executor — no second implementation of the Agent-SDK lifecycle, no forked
   * concurrency budget, no forked terminal table — and differs from a chat dispatch in exactly the four
   * ways a headless child differs from a foreground one:
   *
   *   1. **Isolation (D-AH9).** The curated brief is persisted as the child's SOLE user turn BEFORE the
   *      executor runs (it reads the last `user_message` as its opener, mirroring `runHubTurn`'s own
   *      contract). The parent conversation never enters the child's context.
   *   2. **The ROLE prompt replaces the session prompt** (§8.4), and carries the prompt-enforced report
   *      contract. It is passed as `buildSystemPrompt` so the executor can splice in THIS turn's real
   *      resolved MCP tool listing — a role prompt that claimed "no tools" while the child held real
   *      ones is the RC2 contradiction WP2.1 already fixed on the AI-SDK path.
   *   3. **No `ask_user`.** Nobody is watching a headless child; a blocking question would wedge the
   *      mission's parallel join. Omitting `waitForQuestion` is what suppresses the tool (and the
   *      `askUser` capability), exactly as it does for any non-foreground caller.
   *   4. **No slot, no auto-title.** Like {@link runAgentTurn}, this bypasses `dispatchMessage`: a
   *      mission agent is bounded by the mission's own `maxParallel`, not the active-session cap.
   *
   * MCP tools, approvals and denials: the Agent-SDK child connects the granted servers itself (D-CS9)
   * behind the executor's default-deny `canUseTool` allow-list, so there is no in-process HITL to
   * count — `deniedToolCalls` is honestly 0 rather than a fabricated number. `mission.autonomy`'s
   * board-approval queue has no counterpart on this transport; a tool the allow-list does not cover is
   * simply uncallable.
   */
  private async runSubscriptionAgentTurn(
    child: HubSession,
    resolution: HubModelResolution,
    input: HubAgentTurnInput,
  ): Promise<HubAgentTurnResult> {
    if (!this.deps.subscriptionExecutor) {
      throw httpError(
        501,
        `Mission agent model "${child.model}" is pinned to a Claude subscription credential, but the subscription executor is not wired.`,
      );
    }
    const sink: HubTurnSink = input.sink ?? { onEvent: () => {}, onDelta: () => {} };

    // ISOLATION (D-AH9) — the brief is the child's SOLE user turn, persisted BEFORE the executor so the
    // opener it reads back is exactly this brief (the AI-SDK path persists it here too).
    const userEvent = this.deps.repository.appendEvent(child.id, {
      type: "user_message",
      messageId: nanoid(),
      text: input.brief,
    });
    sink.onEvent(userEvent);

    const fresh = this.deps.repository.getSession(child.id);
    const result = await this.deps.subscriptionExecutor({
      session: fresh,
      modelId: resolution.modelId,
      abortSignal: input.abortSignal,
      steering: new HubSteeringQueue(child.id, this.deps.repository),
      sink,
      // The role prompt, re-assembled with the executor's OWN resolved tool listing (see the docstring).
      buildSystemPrompt: ({ toolListText }) => {
        const rolePrompt = assembleRolePrompt({
          role: input.roleTemplate,
          // `eager`: the Agent-SDK child holds every wired server's definitions from connect time —
          // there is no deferred/`tool_search` promotion on this transport.
          tools: toolListText ? { toolListText, loadingMode: "eager" } : {},
        });
        return { text: rolePrompt.text, promptVersion: rolePrompt.promptVersion };
      },
    });
    return { result, deniedToolCalls: 0, timedOutToolCalls: 0 };
  }

  /**
   * hub-fixes WP3.2 (RC4, D-HF4) — the SYNTHESIS-turn entry seam: run the mission's final answer as a REAL
   * turn of the PARENT session through the SAME turn engine, with the GenUI `present`/`prompt_user` tools
   * granted so the answer can compose Table/StatGroup/Chart widgets plus prose — replacing the pre-fix
   * tool-less `generateText` synthesizer (RC4). Modeled on {@link runAgentTurn}: it goes straight to
   * {@link runHubTurn} (never {@link dispatchMessage}), so the synthesis draws no active-session slot and
   * skips auto-title. MCP tools are deliberately NOT granted for this turn ({@link resolveSynthesisToolset})
   * — the synthesis reasons over the reports, it never re-queries. The caller ({@link synthesizeMission})
   * passes the fully-assembled synthesizer prompt (synthesizer layers + GenUI catalog + reports digest +
   * numbered sources) as `systemPromptOverride`; the reconstructed history's last user turn is the mission
   * ask. A citation post-pass stamps the MERGED, re-numbered citation set onto the settled message (so every
   * `[n]` resolves — the §1.7 contract, unchanged) and prepends the partial note when the mission is partial.
   * THROWS when the turn persisted no assistant message, so the caller can fall back to the byte-compatible
   * text synthesizer without ever double-persisting.
   */
  async runSynthesisTurn(input: HubSynthesisTurnInput): Promise<HubSynthesisTurnResult> {
    const session = this.deps.repository.getSession(input.sessionId);
    // model-identity WP2.1 — the plan's own credential for this model, else the PARENT session's pin.
    const resolution = await this.deps.resolveModel(
      input.model,
      input.providerCredentialId ?? session.providerCredentialId ?? undefined,
    );
    assertHubModelKind(resolution.providerKind);
    if (!isHubAiSdkKind(resolution.providerKind) || !resolution.buildModel) {
      throw httpError(
        500,
        `Mission synthesis model "${input.model}" resolved with no AI-SDK model builder.`,
      );
    }

    const ctx: HubToolsetContext = {
      session,
      providerKind: resolution.providerKind,
      modelId: resolution.modelId,
      contextWindow: resolution.contextWindow,
    };
    const toolset = this.resolveSynthesisToolset(ctx);

    // The turn engine generates the messageId internally + persists the settled `assistant_message` (with
    // any GenUI `present` parts) itself; the post-pass is the ONE hook that runs BEFORE that append, so it
    // both CAPTURES the id (to link the `mission_synthesis` marker) and STAMPS the merged citations + the
    // partial prefix (§1.7 — citations must be resolved before persistence, the log is append-only).
    let capturedMessageId: string | null = null;
    const citationPostPass: HubCitationPostPass = ({ messageId, parts }) => {
      capturedMessageId = messageId;
      const finalParts = input.partialPrefix
        ? prependSynthesisPartialPrefix(parts, input.partialPrefix)
        : parts;
      return { parts: finalParts, citations: input.citations };
    };

    const capabilities = hubCapabilitiesForKind(resolution.providerKind);
    const abortSignal = input.abortSignal ?? new AbortController().signal;
    const result = await runHubTurn(
      { repository: this.deps.repository },
      {
        session,
        promptMode: "synthesizer",
        model: resolution.buildModel(),
        providerKind: resolution.providerKind,
        modelId: resolution.modelId,
        capabilities,
        contextWindow: resolution.contextWindow,
        toolset,
        systemPromptOverride: input.systemPromptOverride,
        ...(resolution.providerOptions ? { providerOptions: resolution.providerOptions } : {}),
        abortSignal,
        steering: new HubSteeringQueue(input.sessionId, this.deps.repository),
        sink: input.sink,
        citationPostPass,
      },
    );

    if (!capturedMessageId) {
      // The turn ended without persisting an assistant message (an immediate setup failure) — surface it
      // so `synthesizeMission` falls back to the deterministic/text synthesis rather than a silent no-op.
      throw httpError(500, "The mission synthesis turn produced no assistant message.");
    }
    return {
      messageId: capturedMessageId,
      costUsd: result.costUsd,
      usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut },
    };
  }

  /**
   * hub-fixes WP3.2 (D-HF4) — the SYNTHESIS toolset: the GenUI `present`/`prompt_user` emission tools ONLY
   * (tagged `source: "genui"` so their tool_call parts render as widgets — the existing `GenUiPart` path),
   * over the parent session's confined workspace. MCP tools, skills, and web tools are deliberately NOT
   * granted (a synthesis reasons over the agent reports; it must not re-query). The GenUI catalog itself is
   * carried in the caller's `systemPromptOverride`, so nothing here needs to inject a prompt layer.
   */
  private resolveSynthesisToolset(ctx: HubToolsetContext): HubResolvedToolset {
    const workspaceRoot = ensureHubWorkspaceRoot(this.deps.config.dataDir, ctx.session.id);
    const execCtx = {
      sessionId: ctx.session.id,
      workspaceRoot,
      repository: this.deps.repository,
      tokenCounter: this.deps.tokenCounter,
    };
    const toolArtifacts = new Map<string, HubToolArtifact>();
    const genuiTools = createGenuiTools({
      maxRepairAttempts: this.deps.config.genuiMaxRepairAttempts ?? 2,
    });
    const tools = buildHubBuiltinTools(genuiTools, execCtx, toolArtifacts);
    const sources: Record<string, HubToolSource> = {};
    for (const name of GENUI_TOOL_NAMES) sources[name] = "genui";
    return { tools, sources, toolArtifacts };
  }

  /**
   * WP2.3 — build the per-turn {@link HubTurnHitl} seam around the shared coordinator, bound to this
   * session's id + the granted MCP servers (from the resolved toolset's `serverIds`). `gate()` resolves
   * the WRAP decision from the toolset's per-tool approval metadata + the session's autonomy dial; a
   * tool absent from the metadata is treated as first-party (never gated).
   */
  private buildTurnHitl(
    sessionId: string,
    session: HubSession,
    toolset: HubResolvedToolset,
  ): HubTurnHitl {
    const autonomy = this.resolveAutonomy(session);
    const approvalMeta = toolset.approvalMeta ?? {};
    const serverIds = [...new Set(Object.values(toolset.serverIds ?? {}))];
    const metaFor = (toolName: string): HubApprovalMeta =>
      approvalMeta[toolName] ?? { source: toolset.sources?.[toolName] ?? "builtin" };
    return {
      autonomy,
      gate: (toolName) => resolveApprovalGate(metaFor(toolName), autonomy),
      waitForApproval: (toolCallId) => this.hitl.waitForApproval(sessionId, toolCallId),
      hasAlways: (toolName) => this.hitl.hasAlways(sessionId, toolName),
      recordAlways: (toolName) => this.hitl.recordAlways(sessionId, toolName),
      bindElicitationResponder: (responder) =>
        this.hitl.bindElicitationResponder(sessionId, responder, serverIds),
      waitForElicitation: (elicitationId) => this.hitl.waitForElicitation(sessionId, elicitationId),
      waitForQuestion: (questionId) => this.hitl.waitForQuestion(sessionId, questionId),
      release: () => this.hitl.releaseTurn(sessionId),
    };
  }

  /** Stop the running turn for a session — cancels the running step but the engine PRESERVES completed
   *  work with an explicit cut-off note (R-SES3). A no-op when nothing is running. */
  stop(sessionId: string): void {
    const active = this.live.get(sessionId);
    if (!active) return;
    active.abort.abort();
  }

  /** True when a turn is actively running for the session (holds the running slot). */
  isRunning(sessionId: string): boolean {
    return this.live.get(sessionId)?.running === true;
  }

  /** The count of live slots held (running + in-grace) — the value the cap is checked against. */
  activeCount(): number {
    return this.live.size;
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────

  private acquireSlot(sessionId: string, sink: HubTurnSink): ActiveTurn {
    const existing = this.live.get(sessionId);
    if (existing) {
      // Reuse an in-grace slot (a follow-up within the release window): cancel its release, re-arm.
      this.clearReleaseTimer(existing);
      existing.abort = new AbortController();
      existing.steering = new HubSteeringQueue(sessionId, this.deps.repository);
      existing.sink = sink;
      existing.running = true;
      return existing;
    }
    if (this.live.size >= this.deps.config.maxActiveSessions) {
      throw httpError(
        409,
        `The Assistant is already running ${this.deps.config.maxActiveSessions} sessions. Stop one or let it idle out before starting another.`,
      );
    }
    const slot: ActiveTurn = {
      sessionId,
      abort: new AbortController(),
      steering: new HubSteeringQueue(sessionId, this.deps.repository),
      sink,
      running: true,
    };
    this.live.set(sessionId, slot);
    return slot;
  }

  /** Release-on-reply: free the slot immediately (grace 0) or after the grace window. */
  private scheduleRelease(slot: ActiveTurn): void {
    if (this.deps.config.idleReleaseMs <= 0) {
      this.release(slot.sessionId);
      return;
    }
    this.clearReleaseTimer(slot);
    slot.releaseTimer = setTimeout(
      () => this.release(slot.sessionId),
      this.deps.config.idleReleaseMs,
    );
    slot.releaseTimer.unref?.();
  }

  private clearReleaseTimer(slot: ActiveTurn): void {
    if (slot.releaseTimer) {
      clearTimeout(slot.releaseTimer);
      slot.releaseTimer = undefined;
    }
  }

  private release(sessionId: string): void {
    const slot = this.live.get(sessionId);
    if (!slot || slot.running) return;
    this.clearReleaseTimer(slot);
    this.live.delete(sessionId);
  }

  /**
   * The default toolset resolver: the standard chat built-ins PLUS the session's granted MCP servers
   * (server-level grants v1 — R-MCP1 / §1.6), built into AI-SDK tools over the session's confined
   * workspace. MCP grant inputs (catalogs + open sessions) come from the injected `mcpGrantsProvider`
   * (index.ts owns the live scan/MCP wiring); absent → built-ins only, unchanged from WP1.1. A test may
   * inject `resolveToolset` directly to bypass this path entirely.
   */
  private async resolveToolset(
    ctx: HubToolsetContext,
    sink: HubTurnSink,
  ): Promise<HubResolvedToolset> {
    if (this.deps.resolveToolset) return this.deps.resolveToolset(ctx);

    const mcp = (await this.deps.mcpGrantsProvider?.(ctx)) ?? null;

    // hub-fixes WP1.3 (RC3.4) — kill the silent grant-drop: surface every granted server's connection
    // outcome. A `mcp_server_status` event is appended (+ forwarded live) only when the status actually
    // CHANGED from the session's last known state (deduped — never every turn, so the transcript isn't
    // flooded); the "Unreachable this turn" prompt line below is built EVERY turn regardless of dedup —
    // the model needs the current truth every time, not just on change.
    const unreachableLines: string[] = [];
    if (mcp?.serverStatuses && mcp.serverStatuses.length > 0) {
      const known =
        this.lastMcpStatus.get(ctx.session.id) ?? new Map<string, "connected" | "error">();
      for (const outcome of mcp.serverStatuses) {
        if (known.get(outcome.serverId) !== outcome.status) {
          known.set(outcome.serverId, outcome.status);
          const statusEvent = this.deps.repository.appendEvent(ctx.session.id, {
            type: "mcp_server_status",
            serverId: outcome.serverId,
            serverName: outcome.serverName,
            status: outcome.status,
            ...(outcome.message ? { message: outcome.message } : {}),
            ...(outcome.authRequired ? { authRequired: true } : {}),
          });
          sink.onEvent(statusEvent);
        }
        if (outcome.status === "error") {
          unreachableLines.push(
            `Unreachable this turn: ${outcome.serverName} (${outcome.message ?? "connection failed"})`,
          );
        }
      }
      this.lastMcpStatus.set(ctx.session.id, known);
    }

    const baseGrants: HubToolGrants = mcp?.grants ?? {
      servers: {},
      builtins: DEFAULT_CHAT_BUILTIN_NAMES,
    };
    // hub-fixes WP6.1 (RC7) — a top-level `auto` session additionally grants the planner-only
    // `mission.propose_plan` builtin (excluded from `DEFAULT_CHAT_BUILTIN_NAMES`) so the model can SIGNAL
    // "this ask is a mission"; `dispatchMessage`'s post-turn bridge turns that call into a real proposal.
    // Every OTHER mode's toolset is byte-identical to pre-WP6.1 (nothing is added for chat/research/
    // mission or any agent child session).
    const grants = grantMissionProposeForAuto(baseGrants, ctx.session);
    const resolution = await resolveHubToolRegistry({
      grants,
      mcpCatalog: mcp?.catalog ?? new Map(),
      loadingPreference: this.deps.config.toolLoadingDefault,
      tokenCounter: this.deps.tokenCounter,
      contextWindow: ctx.contextWindow,
      autoFraction: this.deps.config.autoFraction,
      // WP1.1 (D-HF1) — the `auto` absolute cap + the promotion cap. Fall back to the shared defaults
      // when the config doesn't thread the env override, so both caps are active by default (the env
      // OVERRIDES `HUB_TOOL_EAGER_MAX_TOKENS`/`HUB_TOOL_PROMOTE_MAX_TOKENS` are wired at the composition
      // root — see `config/env.ts`). `promoteMaxTokens` undefined ⇒ `tool_search` uses its own default.
      eagerMaxTokens: this.deps.config.eagerMaxTokens ?? DEFAULT_HUB_EAGER_MAX_TOKENS,
      ...(this.deps.config.promoteMaxTokens !== undefined
        ? { promoteMaxTokens: this.deps.config.promoteMaxTokens }
        : {}),
    });

    const workspaceRoot = ensureHubWorkspaceRoot(this.deps.config.dataDir, ctx.session.id);
    const execCtx = {
      sessionId: ctx.session.id,
      workspaceRoot,
      repository: this.deps.repository,
      tokenCounter: this.deps.tokenCounter,
    };

    // WP3.4 — the R-GUI3 UI-visible-result sink for THIS turn: built-ins (files.write/edit, via
    // `buildHubBuiltinTools`) and MCP calls (via `applyOutputCapToMcpTools`, R-MCP7) write into it as
    // they settle; `turn-engine.ts`'s "tool-result" persist step reads it back by `toolCallId`. Always
    // attached to the returned toolset (even before anything has been written into it) so the turn
    // engine can look it up regardless of whether this pass actually produces any artifacts.
    const toolArtifacts = new Map<string, HubToolArtifact>();

    const tools: Record<string, Tool> = {
      ...buildHubBuiltinTools(resolution.builtins, execCtx, toolArtifacts),
    };
    const sources: Record<string, HubToolSource> = {};
    for (const builtin of resolution.builtins) sources[builtin.name] = "builtin";

    // Granted MCP tools, keyed by their (collision-namespaced) exposed name — WP0.5's `buildHubMcpTools`.
    // WP1.1 (D-HF1, RC1): in deferred mode we build the DEFERRED tools too (not just the resident/pinned
    // subset), so a `tool_search` hit can be PROMOTED and actually called later in the SAME turn — the
    // turn engine gates the deferred names OFF each step (via `prepareStep`/`activeTools`) until they are
    // promoted. In eager mode `mcpDeferred` is empty, so this is byte-identical to the pre-WP1.1 path.
    // `serverIds` lets the turn engine tag each emitted `tool_call` part with its origin server (R-MCP11
    // chips); `approvalMeta` (WP2.3) carries each MCP tool's R-MCP3 annotations so the turn's HITL gate
    // can resolve its approval requirement (no owner-trust store exists yet, so `serverTrusted` is false
    // — the strict default: an untrusted server's annotations can only make policy stricter, never looser).
    const serverIds: Record<string, string> = {};
    const approvalMeta: Record<string, HubApprovalMeta> = {};
    const grantedMcp = [...resolution.mcpResident, ...resolution.mcpDeferred];
    if (mcp && grantedMcp.length > 0) {
      const mcpTools = buildHubMcpTools(grantedMcp, mcp.sessions, mcp.sink);
      // WP3.4/R-MCP7 — the live output-cap wrapper (warn at `outputCapWarnTokens`, spill to the
      // workspace above `outputCapMaxTokens`). Wraps `execute` only; routing/telemetry inside each
      // MCP tool is untouched (still the reused, behavior-frozen `testing/tool-bridge.ts` translation).
      const cappedMcpTools = applyOutputCapToMcpTools(mcpTools, {
        workspaceRoot,
        tokenCounter: this.deps.tokenCounter,
        config: {
          warnTokens: this.deps.config.outputCapWarnTokens ?? DEFAULT_HUB_OUTPUT_CAP.warnTokens,
          capTokens: this.deps.config.outputCapMaxTokens ?? DEFAULT_HUB_OUTPUT_CAP.capTokens,
        },
        artifactSink: toolArtifacts,
      });
      for (const [name, entry] of Object.entries(cappedMcpTools)) tools[name] = entry;
      for (const resolved of grantedMcp) {
        sources[resolved.exposedName] = "mcp";
        serverIds[resolved.exposedName] = resolved.serverId;
        approvalMeta[resolved.exposedName] = {
          source: "mcp",
          serverId: resolved.serverId,
          serverTrusted: false,
          ...(resolved.annotations ? { annotations: resolved.annotations } : {}),
        };
      }
    }

    // Deferred mode: the per-turn tool-search built-in over the not-yet-resident MCP definitions.
    if (resolution.toolSearch) {
      const searchTools = buildHubBuiltinTools([resolution.toolSearch], execCtx);
      for (const [name, entry] of Object.entries(searchTools)) tools[name] = entry;
      sources[resolution.toolSearch.name] = "builtin";
    }

    // WP2.4/R-SK1…R-SK3 — the session's attached-skill L1 catalog + (when anything is loadable) the
    // enum-constrained `skills.load` built-in, tagged `source: "skill"` so its tool_call parts render
    // distinctly from a generic built-in. Absent provider ⇒ no catalog at all (R-SK1's "zero skills").
    const skillsListText = await this.buildSkillsListing(ctx, execCtx, tools, sources);

    // WP2.6/R-GUI1/2 — the `present`/`prompt_user` GenUI emission tools + the compiled catalog to inject
    // at the prompt's LAYER-4 seam. Tagged `source: "genui"` so their tool_call parts render as WIDGETS
    // (not tool cards). One repair tracker per turn (bounded by `genuiMaxRepairAttempts`). Granted for
    // interactive top-level sessions only (a `capabilities.toolCalls`-capable, non-agent session): a model
    // that can't call tools can't emit UI, and a mission subagent produces a structured report, not UI.
    let genuiCatalog: HubGenuiCatalogInjection | undefined;
    if (ctx.session.kind !== "agent") {
      const genuiTools = createGenuiTools({
        maxRepairAttempts: this.deps.config.genuiMaxRepairAttempts ?? 2,
      });
      const builtGenui = buildHubBuiltinTools(genuiTools, execCtx);
      for (const [name, entry] of Object.entries(builtGenui)) tools[name] = entry;
      for (const name of GENUI_TOOL_NAMES) sources[name] = "genui";
      const compiled = compileGenuiCatalogPrompt();
      genuiCatalog = { catalogText: compiled.catalogText, specVersion: compiled.specVersion };
    }

    // hub-fixes WP5.1 (RC5, D-HF2), revised by v1-fixes (F6) — the "web" capability: `web.search` as
    // the model-native tool when the kind supports it, else the app-level provider-chain FALLBACK
    // builtin (`deps.webSearchFallback`), plus the SSRF-guarded `web.fetch`. EVERY session gets both by
    // default (scoped or not — the pre-fix rule silently dropped search from any custom Access scope),
    // web-access-fix (2026-07-27) INCLUDING mission agents, which previously depended on a planner
    // grant the planner never knew how to emit. `web.promptNote` explains an absence;
    // `web.freshnessNote` carries the search-first rule whenever search is exposed.
    const web = composeWebTools({
      providerKind: ctx.providerKind,
      grantedBuiltins: grants.builtins,
      webToolsEnabled: this.deps.config.webToolsEnabled !== false,
      ...(this.deps.webSearchFallback ? { fallbackSearch: this.deps.webSearchFallback } : {}),
    });
    if (web.searchTool) {
      tools[HUB_WEB_SEARCH_BUILTIN] = web.searchTool;
      sources[HUB_WEB_SEARCH_BUILTIN] = "builtin";
    } else if (web.fallbackSearchTool) {
      const searchTools = buildHubBuiltinTools([web.fallbackSearchTool], execCtx, toolArtifacts);
      for (const [name, entry] of Object.entries(searchTools)) tools[name] = entry;
      sources[HUB_WEB_SEARCH_BUILTIN] = "builtin";
    }
    if (web.includeFetch) {
      const fetchTools = buildHubBuiltinTools([webFetch], execCtx, toolArtifacts);
      for (const [name, entry] of Object.entries(fetchTools)) tools[name] = entry;
      sources[HUB_WEB_FETCH_BUILTIN] = "builtin";
    }

    // hub-fixes WP1.3 (RC3.4) — append the unreachable-server lines (if any) to whatever tool-list text
    // the registry produced (WP1.4's compressed eager/deferred listing, or "" in eager mode with
    // nothing to list). Applies regardless of loading mode: the model needs to know a GRANTED server
    // dropped even when it never had a name-list to begin with. hub-fixes WP5.1 folds in the web-tool
    // note (why `web.search` is absent when a scope asked for it).
    const toolListText = [
      resolution.toolListText?.trim() ?? "",
      unreachableLines.join("\n"),
      web.promptNote ?? "",
      // v1-fixes (F6) — the search-first freshness rule rides the tools layer whenever search exists.
      web.freshnessNote ?? "",
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");

    return {
      tools,
      ...(toolListText ? { toolListText } : {}),
      ...(skillsListText ? { skillsListText } : {}),
      ...(genuiCatalog ? { genuiCatalog } : {}),
      loadingMode: resolution.loading.mode,
      sources,
      ...(Object.keys(serverIds).length > 0 ? { serverIds } : {}),
      ...(Object.keys(approvalMeta).length > 0 ? { approvalMeta } : {}),
      // WP1.1 (D-HF1) — the deferred-gate + promotion sets for the turn engine's `prepareStep`. Only
      // attached in deferred mode (non-empty `deferredNames`), so the eager path's toolset shape is
      // byte-identical to pre-WP1.1.
      ...(resolution.deferredNames.size > 0
        ? { deferredNames: resolution.deferredNames, promoted: resolution.promoted }
        : {}),
      toolArtifacts,
    };
  }

  /** WP2.4 — resolve + measure the session's skill catalog (R-SK1), mutating `tools`/`sources` in place
   *  with the `skills.load` built-in when anything is loadable. Returns the L1 catalog text for the
   *  prompt injection (`""`/absent ⇒ nothing to inject). Split out of `resolveToolset` to keep that
   *  method's control flow readable — this is its own well-scoped unit. */
  private async buildSkillsListing(
    ctx: HubToolsetContext,
    execCtx: {
      sessionId: string;
      workspaceRoot: string;
      repository: HubRepository;
      tokenCounter: TokenCounter;
    },
    tools: Record<string, Tool>,
    sources: Record<string, HubToolSource>,
  ): Promise<string> {
    if (!this.deps.skillCatalogProvider) return "";
    const { resolved, reader } = await this.deps.skillCatalogProvider(ctx);
    if (resolved.length === 0) return "";

    const loadedSkills = reconstructLoadedSkills(this.deps.repository.listEvents(ctx.session.id));
    // NOTE: `listing` (the itemized per-entry budget measurement) is recomputed on demand by the
    // GET /api/hub/sessions/:id/skills route for the context inspector (R-SK5) — this call only needs
    // the rendered `listingText` for the prompt injection, so it's discarded here.
    const { listingText } = await computeSkillListing(resolved, {
      tokenCounter: this.deps.tokenCounter,
      contextWindow: ctx.contextWindow,
      budgetFraction: this.deps.config.skillListingBudgetFraction,
      entryMaxChars: this.deps.config.skillEntryMaxChars,
      invocationOrder: invocationOrderFromLoads(loadedSkills),
    });

    const loadable = resolved.filter((r) => r.invocationMode !== "user_only");
    if (loadable.length > 0) {
      const skillsLoad = createSkillsLoadBuiltin(
        loadable,
        reader,
        this.deps.config.skillLoadBudgets,
      );
      if (skillsLoad) {
        const built = buildHubBuiltinTools([skillsLoad], execCtx);
        for (const [name, entry] of Object.entries(built)) tools[name] = entry;
        sources[skillsLoad.name] = "skill";
      }
    }
    return listingText;
  }

  /** Refine the deterministic title with the injected refiner, guarded so a manual rename or a failure
   *  never clobbers a good title (mirrors the dock's `runTitleOneShot` guard). */
  private async maybeRefineTitle(sessionId: string): Promise<void> {
    if (!this.deps.refineTitle) return;
    const session = this.deps.repository.getSession(sessionId);
    // A user-set title wins forever — never overwrite a manual title with an auto refine.
    if (session.titleState === "manual") return;
    const events = this.deps.repository.listEvents(sessionId);
    const firstUser = events.find(
      (e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message",
    );
    const firstAssistant = events.find(
      (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
    );
    if (!firstUser || !firstAssistant) return;
    const assistantText = firstAssistant.parts
      .filter(
        (p): p is Extract<(typeof firstAssistant.parts)[number], { type: "text" }> =>
          p.type === "text",
      )
      .map((p) => p.text)
      .join("");
    const titleBefore = session.title;
    const refined = await this.deps.refineTitle({
      sessionId,
      userText: firstUser.text,
      assistantText,
      deterministic: hubDeterministicTitle(firstUser.text),
    });
    const clean = refined ? hubDeterministicTitle(refined) : "";
    if (!clean) return;
    // Re-read: skip if the title changed (a manual rename) while the refine ran.
    const current = this.deps.repository.getSession(sessionId);
    if (current.title === titleBefore && current.titleState !== "manual") {
      this.deps.repository.setAutoTitle(sessionId, clean);
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────

/**
 * hub-fixes WP5.1 (RC5, D-HF2) — wrap the WP1.4 citation post-pass so provider-native `web.search`
 * results become numbered citations in the SAME ledger as MCP-tool sources. The execution-time wrapper
 * (`wrapToolsetWithCitations`) can only number tools with a LOCAL `execute`; a provider-executed web
 * search has none, so its sources reach us only as settled data: Anthropic/OpenAI as `tool-result`
 * outputs (mined from `draft.toolResults` for the `web.search` tool), Google as step-metadata
 * (`draft.providerSearchSources`, extracted by the turn engine). We record BOTH into the ledger BEFORE
 * delegating (so the base pass can tag the `web.search` tool_call part), then union the recorded
 * citations into the result so every web source appears even when the model wrote no inline `[n]`
 * marker (graceful). No citation apparatus (no ledger) ⇒ the base post-pass is returned unchanged.
 */
export function composeWebCitationPostPass(
  citation: HubCitationTurn | undefined,
  base: HubCitationPostPass | undefined,
): HubCitationPostPass | undefined {
  if (!citation) return base;
  const ledger = citation.ledger;
  return async (draft) => {
    const recorded: HubCitation[] = [];
    // Anthropic/OpenAI: the web-search results arrived as a mineable tool-result output.
    for (const tr of draft.toolResults) {
      if (tr.toolName !== HUB_WEB_SEARCH_BUILTIN || tr.isError) continue;
      const sources = extractCitationSources(tr.output);
      if (sources.length > 0) recorded.push(...ledger.record(tr.toolCallId, sources));
    }
    // Google (and any other provider-surfaced sources): folded in from the step metadata.
    for (const source of draft.providerSearchSources ?? []) {
      recorded.push(
        ...ledger.record(source.toolCallId ?? "", [
          {
            title: source.title,
            ...(source.url ? { url: source.url } : {}),
            ...(source.snippet ? { snippet: source.snippet } : {}),
          },
        ]),
      );
    }
    const out = base
      ? await Promise.resolve(base(draft))
      : { parts: draft.parts, citations: [] as HubCitation[] };
    if (recorded.length === 0) return out;
    const byId = new Map<string, HubCitation>();
    for (const citationEntry of out.citations ?? []) byId.set(citationEntry.id, citationEntry);
    for (const citationEntry of recorded) byId.set(citationEntry.id, citationEntry);
    return {
      parts: out.parts ?? draft.parts,
      citations: [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)),
    };
  };
}

/** Map a session's WIRE mode to the prompt engine's addendum mode. hub-fixes WP6.1 (RC7): `auto` maps
 *  to its own routing-rubric addendum. assistant-hub v1-fixes (F4): `mission` maps to the
 *  `mission-followup` addendum — a mission session's ordinary turns are POST-mission turns (the first
 *  ask runs the planner via the propose route), and the pre-fix `chat` mapping left the model with no
 *  legitimate path to a second mission, which is how the observed session ended up staging fake
 *  "agents" with `tasks.create` instead of proposing one. */
export function promptModeFor(session: Pick<HubSession, "mode">): HubPromptMode {
  if (session.mode === "research") return "research";
  if (session.mode === "auto") return "auto";
  if (session.mode === "mission") return "mission-followup";
  return "chat";
}

/** hub-fixes WP6.1 (RC7) + v1-fixes (F4) — true when this session may route a mission-shaped ask (or a
 *  `mission.propose_plan` tool call) into a real proposal: a TOP-LEVEL `auto` OR `mission` session.
 *  Excludes agent children and chat/research. The one-live-mission invariant (D-AH8) is enforced by the
 *  bridge's own terminal-status check, not here. */
export function canAutoRouteMission(session: Pick<HubSession, "mode" | "kind">): boolean {
  return (session.mode === "auto" || session.mode === "mission") && session.kind !== "agent";
}

/** hub-fixes WP6.1 (RC7) + v1-fixes (F4) — return `grants` with the planner-only `mission.propose_plan`
 *  builtin added for a top-level `auto` or `mission` session (idempotent — never duplicated). Any other
 *  session gets `grants` unchanged (referentially identical), so no other mode's toolset shape moves. */
export function grantMissionProposeForAuto(
  grants: HubToolGrants,
  session: Pick<HubSession, "mode" | "kind">,
): HubToolGrants {
  if (!canAutoRouteMission(session)) return grants;
  const builtins = grants.builtins ?? [];
  if (builtins.includes(missionProposePlan.name)) return grants;
  return { ...grants, builtins: [...builtins, missionProposePlan.name] };
}

/** hub-fixes WP6.1 (RC7) — the internal (dotted) name the routing turn's `mission.propose_plan` call is
 *  persisted under (the turn engine translates the provider-safe form back before persisting). */
const MISSION_PROPOSE_TOOL_NAME = missionProposePlan.name;

/** hub-fixes WP6.1 (RC7) — a mission is terminal (a new one may be proposed) once completed/stopped/
 *  failed. Inlined (not imported from `missions/orchestrator.ts`) to keep the session-service free of a
 *  dependency on the mission service — mirrors that module's `isTerminalMissionStatus`. */
function isMissionTerminal(status: HubMissionStatus): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}

/** hub-fixes WP3.2 — prepend the mission's PARTIAL note to the settled synthesis parts, deterministically
 *  (the turn engine may not have marked it partial itself). Prepends to the FIRST text part so it leads the
 *  answer; if the answer is all-widget (no text part), inserts a leading text part carrying the note. Never
 *  mutates the input array. */
function prependSynthesisPartialPrefix(
  parts: readonly HubMessagePart[],
  prefix: string,
): HubMessagePart[] {
  const firstTextIndex = parts.findIndex((p) => p.type === "text");
  if (firstTextIndex < 0) {
    return [{ type: "text", text: prefix }, ...parts];
  }
  const next = [...parts];
  const target = next[firstTextIndex] as Extract<HubMessagePart, { type: "text" }>;
  next[firstTextIndex] = { ...target, text: `${prefix}${target.text}` };
  return next;
}

/**
 * A deterministic session title from a user message (D-AS26 pattern, hub-local): collapse whitespace,
 * prefer the opening sentence when it fits, else clip to a word boundary with an ellipsis. Empty in →
 * empty out (the caller skips titling).
 */
export function hubDeterministicTitle(
  text: string,
  maxLength: number = HUB_AUTO_TITLE_MAX_LENGTH,
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  const sentence = collapsed.match(/^(.+?[.!?])(?:\s|$)/);
  const candidate = sentence?.[1] && sentence[1].length <= maxLength ? sentence[1] : collapsed;
  if (candidate.length <= maxLength) return candidate;
  const clipped = candidate.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(maxLength / 2) ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}
