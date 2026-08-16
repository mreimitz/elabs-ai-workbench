// Claude subscription run executor (roadmap/claude-subscription/, WP 1.1 — the CRUX).
//
// The app has TWO inference stacks. A regular run rides the Vercel-AI-SDK loop
// ({@link import("./engine.js").runAgentLoop} → `streamText`). The owner's Claude *subscription*
// cannot: the Claude Agent SDK never exposes an AI-SDK `LanguageModel`, so a subscription run runs
// on its OWN executor branch — exactly like `qlik_answers` ({@link import("./qlik-answers-executor.js")}).
// WP 1.2 adds the `RunService.execute()` fork that CALLS this module (parallel to the qlik branch);
// THIS module is that executor.
//
// It GENERALIZES the Auto-Rating Claude-CLI judge ({@link import("../grading/claude-cli-judge.js")}),
// which already "runs the subscription as an LLM without an API key" but as a `maxTurns: 1`, tools-less
// ONE-SHOT. Here it becomes a MULTI-TURN agent loop over the raw {@link AgentSessionDriver}: the SDK's
// internal `maxTurns` bounds the tool loop within one user message; interactive mode drives follow-up
// user turns via the driver's `send()`. Every {@link DriverEvent} is mapped onto the SAME
// {@link import("@mcp-token-footprint/shared").RunEvent}/`RunStep`/KPI vocabulary the AI-SDK path emits
// (D-CS3), so run persistence, the SSE console, replay, reports, grading, suites and Compare all render
// a subscription run IDENTICALLY to an API-keyed Claude run.
//
// Structural invariants (locked in the plan):
//   - **Tools + skills wired (WP 1.3 + 1.4).** `mcpServers` carries the scenario's allow-listed MCP
//     servers PLUS (D-CS9, WP 1.4) a `"skills"` in-process server exposing a read-only disclosure tool
//     over the run's attached skills, materialized read-only into the throwaway workspace's `skills/`
//     subtree (see `subscription-skill-tools.ts`). Every exec/network/native-file built-in
//     (`Bash`/`Read`/`Glob`/`Grep`/`Edit`/`Write`/…) stays unconditionally disallowed — that sandbox is
//     what keeps a skill's own scripts from EVER running (the app never spawns/evals skill content; it
//     only reads bytes it wrote itself). A run with no allow-listed tools/skills wires neither —
//     byte-for-byte the tools-less/skill-less shape from WP 1.1/1.2.
//   - **Exact token counts (D-CS4).** `turn_done.usage` carries provider-EXACT token counts → mapped
//     straight onto {@link RunStep.usageActual} (no estimator, no "est." badge on the counts). Only the
//     turn-granular `peak_context` is coarser than the AI-SDK step-granular path → the `llm_response`
//     step is flagged {@link RunStep.meteringEstimated} to mark that its context/footprint is estimated.
//     Per-tool AND per-skill-disclosure-call metering (WP 1.3/1.4) rides the SAME generic
//     `tool_call`/`tool_result` DriverEvent handling — every MCP-shaped tool result (a real MCP tool or
//     the skills server) is counted LOCALLY under the run's profiles and flagged `meteringEstimated`,
//     and NEVER folded into `usageActual`. A SHADOW cost (WP 1.5, D-CS8) is priced: `costUsd` = the
//     run's EXACT tokens × the Anthropic list price ({@link estimateCost}), flagged
//     `costBasis: "subscription_reference"` (marginal subscription cost is $0), and the SAME
//     `maxCostUsd` cap the AI-SDK path enforces stops the run once the cumulative shadow cost crosses it.
//   - **Honest degradation (D-CS7).** Auth-broken / rate-limit / timeout / driver error → a real
//     failed/stopped run outcome with a TRUTHFUL message — never a fabricated success or fake step.
//   - **Secret boundary (`.claude/rules/mcp-and-security.md`, D-AS17).** The decrypted subscription token
//     stays server-side, injected ONLY into a throwaway child env by `buildAssistantSpawnEnv`; it is
//     never logged nor placed in an error message. A per-run THROWAWAY temp dir scopes the SDK's HOME /
//     CLAUDE_CONFIG_DIR + cwd and is removed in a `finally` — the real assistant home is never touched.
//   - **DI seams (WP 1.2 / 2.1 wire the real ones).** The driver, the auth resolver, and the
//     concurrency gate are all INJECTED — tests pass a scripted stub driver + a stub token, so the
//     suite spawns NO real Claude child and needs NO real sign-in.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CostBasis,
  RunStep,
  RunStepType,
  SessionCapabilities,
  TokenProfileRef,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverCanUseTool,
  DriverEvent,
  DriverSession,
  DriverUsage,
} from "../assistant/session-driver.js";
import { type AssistantAuthSource, buildAssistantSpawnEnv } from "../assistant/spawn-env.js";
import { config } from "../config/env.js";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import {
  AsyncSemaphore,
  type ConcurrencyGate,
  type QueueVisibleGate,
} from "./subscription-concurrency.js";
import { SUBSCRIPTION_SESSION_CAPABILITIES } from "./session-capabilities.js";
import {
  DEFAULT_STALL_MS,
  DEFAULT_WAIT_BUDGET_MS,
  SessionClock,
  type SessionClockTime,
} from "./session-clock.js";
import { terminalFor, type TerminalCause } from "./session-terminal.js";
import { getTokenCounter } from "../token-counting/profiles.js";
import type { EngineEmit, InteractiveTurns, LoopResult } from "./engine.js";
import type { ResolvedSkill } from "./skill-context.js";
import {
  buildSubscriptionSkillToolServer,
  materializeSkills,
  SUBSCRIPTION_SKILLS_MCP_KEY,
  subscriptionSkillToolPatterns,
  type SkillFileBytesReader,
} from "./subscription-skill-tools.js";

/**
 * D-CS8 — the KPI `costBasis` marker for a subscription run. The MARGINAL cost of a subscription run is
 * $0 (the flat subscription already paid for it), but the reported `costUsd` is a SHADOW REFERENCE: the
 * run's EXACT token counts × the Anthropic list price ({@link estimateCost}) — priced the SAME way an
 * API-keyed Claude run is, so the cost cap keeps working and cost analytics/compare stay meaningful.
 * This marker flags that figure as a reference estimate (UI/reports label it "est. · subscription"),
 * not a billed charge.
 */
const SUBSCRIPTION_COST_BASIS: CostBasis = "subscription_reference";

/**
 * The SDK BUILT-IN tools removed from a subscription run. Mirrors the CLI judge's disallow list: it
 * strips the SDK's exec/network/mutation/native-file built-ins so a wayward agent cannot shell out, hit
 * the network, or touch the filesystem. It is deliberately the SAME list whether or not MCP tools are
 * wired (WP 1.3) — the allow-listed MCP tools flow through `mcpServers` + `allowedTools`, NOT this list,
 * so blocking the built-ins here is exactly the right "narrowing": the run can call only the scenario's
 * allow-listed MCP tools and nothing else (a non-allow-listed MCP tool is denied by the executor's
 * default-deny `canUseTool` gate). Kept INJECTABLE ({@link ClaudeSubscriptionRunConfig.disallowedTools})
 * so a scenario that legitimately needs a built-in can override it.
 *
 * Also blocked (post-live-review, 2026-07-13): the SDK's own AGENT META-TOOLS — `Skill`, `ToolSearch`,
 * `TodoWrite`, `SlashCommand`, `ExitPlanMode`. These have NO equivalent on the API-keyed path, so
 * leaving them enabled (a) makes a subscription run an unfaithful, apples-to-oranges test surface, and
 * (b) actively broke skill loading: the model reached for the native `Skill` tool (which looks in the
 * SDK's own `.claude/skills/` dir, empty here) instead of this app's injected `read_skill_file`
 * disclosure tool + `<available_skills>` block (WP 1.4) — so an attached skill was never disclosed
 * (`disclosureReads: 0`). Blocking them forces the run onto the SAME skill/tool mechanism the API path
 * uses (our MCP tools + our skill-disclosure tools only).
 */
export const SUBSCRIPTION_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "BashOutput",
  "KillShell",
  "WebSearch",
  "WebFetch",
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "TaskStop",
  "Agent",
  "Monitor",
  // SDK agent meta-tools with no API-path equivalent — see the note above (skill-loading fix + fidelity).
  "Skill",
  "ToolSearch",
  "TodoWrite",
  "SlashCommand",
  "ExitPlanMode",
];

/** The failure category a {@link SubscriptionRunError} carries so the terminal classifier can report it. */
export type SubscriptionRunErrorKind =
  /** No Claude subscription is signed in — the run cannot start (→ `error`). */
  | "auth"
  /** The CLI hit a usage/capacity limit (`limit_error` rate_limit / overloaded) (→ `error`). */
  | "rate_limit"
  /** The driver surfaced a generic error, or the stream ended without a completed turn (→ `error`). */
  | "driver";

/**
 * A distinguishable, catchable failure of a subscription run's driver. Its `kind` lets the terminal
 * classifier report the honest degraded outcome (D-CS7). NEVER carries the token or any secret.
 */
export class SubscriptionRunError extends Error {
  readonly kind: SubscriptionRunErrorKind;
  constructor(kind: SubscriptionRunErrorKind, message: string) {
    super(message);
    this.name = "SubscriptionRunError";
    this.kind = kind;
  }
}

// The shared concurrency gate (D-CS10) lives in `subscription-concurrency.ts` — the ONE budget both a
// subscription RUN and the Auto-Rating CLI JUDGE draw from (WP 2.1). {@link ConcurrencyGate} +
// {@link AsyncSemaphore} are re-exported here for back-compat (existing importers pull them from this
// module) and because the run config's `concurrency` seam is typed against `ConcurrencyGate`.
export { AsyncSemaphore };
export type { ConcurrencyGate, QueueVisibleGate };

/**
 * The module-level DEFAULT gate — a single semaphore shared across every subscription run that does not
 * inject its own, so concurrent runs are actually bounded (a per-call gate would be no bound at all).
 * Production INJECTS a pool gate (`SubscriptionConcurrencyPool`, wired from `index.ts`) via
 * {@link ClaudeSubscriptionRunConfig.concurrency}; this fallback only ever applies to a caller/test that
 * injects nothing. Sized by `config.subscriptionRunsMaxConcurrency` (Unified Sessions, WP1.4, D-US6) —
 * DECOUPLED from the judge's `autoRatingMaxConcurrency`, its own counter. Lazily created so importing
 * this module never reads `config` at load time (keeps unit tests hermetic — they always inject their
 * own gate).
 */
let defaultGate: ConcurrencyGate | undefined;
function getDefaultGate(): ConcurrencyGate {
  if (!defaultGate) defaultGate = new AsyncSemaphore(config.subscriptionRunsMaxConcurrency);
  return defaultGate;
}

/** A throwaway workspace for one run: a directory + its idempotent, defensive cleanup. */
export type ThrowawayWorkspace = { dir: string; cleanup: () => Promise<void> };

/** Factory for a {@link ThrowawayWorkspace}. Injected in tests so they never touch the real filesystem. */
export type CreateThrowawayWorkspace = () => Promise<ThrowawayWorkspace>;

/**
 * The production {@link CreateThrowawayWorkspace}: a fresh, unique temp dir under `tempRoot`
 * (default `os.tmpdir()`). It scopes the child's HOME / CLAUDE_CONFIG_DIR + cwd, so the SDK's per-run
 * JSONL transcript lands here and is removed by `cleanup` — the real assistant home is never touched.
 * `cleanup` is defensive (recursive+force, swallows errors) so it can run in a `finally`.
 */
export function createThrowawayWorkspace(tempRoot: string = os.tmpdir()): CreateThrowawayWorkspace {
  return async () => {
    const dir = await fs.mkdtemp(path.join(tempRoot, "mcpfp-subscription-run-"));
    return {
      dir,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  };
}

/**
 * The CLEAN input the run service (WP 1.2) resolves and hands to {@link runClaudeSubscription} /
 * {@link runClaudeSubscriptionInteractive}. It is a dedicated shape — NOT the AI-SDK
 * {@link import("./engine.js").EngineConfig} — because a subscription run has no `LanguageModel`, no
 * AI-SDK tools, and no accounting sink. WP 1.2 must satisfy every non-optional field below.
 */
export type ClaudeSubscriptionRunConfig = {
  /** The Claude model id to run (the run's "model", `scenario.model`) — e.g. `claude-sonnet-4-5`. */
  model: string;
  /** The user's opener prompt for this run (`test.userPrompt`). Sent verbatim as the first user turn. */
  prompt: string;
  /** Effective system prompt (test override ?? scenario prompt) — forwarded as the driver's `systemPrompt`. */
  system: string;
  /**
   * SDK internal turn cap for ONE user message's tool loop (`scenario.guardrails.maxTurns`). Passed to
   * `driver.start({ maxTurns })`; the SDK bounds its own assistant/tool iterations, then emits one
   * `turn_done`. NOT the count of interactive user turns (that loop is unbounded here — the wall-clock
   * deadline + a `null` next-turn end it).
   */
  maxTurns: number;
  /**
   * DI seam — the raw SDK driver ({@link SdkAgentSessionDriver} in production, a scripted fake in tests).
   * Its `.start()` is the session factory: one live session per run, driven to completion.
   */
  driver: AgentSessionDriver;
  /**
   * DI seam — resolve the DECRYPTED subscription auth source, or `null` when unsigned (→ honest `auth`
   * degradation BEFORE anything is spawned). WP 1.2 wires WP 0.2's real linked-auth resolver; tests pass
   * a stub token.
   */
  resolveAuth: () => AssistantAuthSource | null;
  /**
   * Overall run wall-clock cap (ms) — the ONLY time guardrail here (the SDK owns the per-message turn
   * loop; there is no separate per-turn timeout). When it elapses the driver is aborted →
   * `outcome: "stopped_guardrail"`. Defaults to {@link DEFAULT_MAX_RUN_DURATION_MS}.
   */
  maxRunDurationMs?: number;
  /**
   * WP 1.5 (D-CS8) — the per-run SPEND CAP (`scenario.guardrails.maxCostUsd`), the SAME source the
   * AI-SDK agent-loop path reads. When set, the executor (a) SHADOW-PRICES each settled turn's EXACT
   * usage via {@link estimateCost} and (b) STOPS the run with `outcome: "stopped_guardrail"` once the
   * cumulative shadow cost REACHES it (`>=`). When set on an UNPRICED model the run is REJECTED at start
   * (an unpriced model prices at 0 forever, so the cap could never trip → unbounded spend), mirroring
   * the engine's Issue #10 rejection. Unset/0 ⇒ no cap (an unpriced model then merely reports a cost
   * floor of $0). GRANULARITY: the Agent SDK owns the intra-message tool loop, so the cap is evaluated
   * at each SETTLED turn (between user turns interactive / after the single message automated) — the
   * finest granularity this stack exposes (no per-token/per-tool callback exists here).
   */
  maxCostUsd?: number;
  /** Cooperative abort signal (user stop). Aborting → `outcome: "aborted"` (wins over the deadline). */
  abortSignal?: AbortSignal;
  /**
   * DI seam (D-CS10) — the shared runs+judge concurrency gate. Defaults to the module-level gate bounded
   * by `config.autoRatingMaxConcurrency`. WP 2.1 injects the single shared gate.
   */
  concurrency?: ConcurrencyGate;
  /** Throwaway-workspace factory; defaults to {@link createThrowawayWorkspace} under the OS temp dir. */
  createWorkspace?: CreateThrowawayWorkspace;
  /**
   * WP 1.3 — the Agent SDK `mcpServers` config map (`driver.start({ mcpServers })`): one entry per
   * allow-listed server (stdio command/args/env OR http url/headers), built by the run service from the
   * scenario's allow-list ({@link import("./subscription-tools.js").buildSubscriptionToolWiring}). The
   * SDK connects/spawns these servers in its CHILD (D-CS9 — unlike qlik_answers, MCP tools DO work on
   * the subscription path). Defaults to `{}` (tools-less). Typed loosely (the SDK's `McpServerConfig`
   * union lives at the driver seam); the real driver casts at the `query()` boundary.
   */
  mcpServers?: Record<string, unknown>;
  /**
   * WP 1.3 — the scenario allow-list as `mcp__<serverKey>__<toolName>` SDK tool-name patterns (built
   * alongside {@link mcpServers}). When present + non-empty the executor (a) passes them as the SDK's
   * auto-allow `allowedTools` and (b) wires a DEFAULT-DENY `canUseTool` gate over the SAME set, so a
   * tool NOT on the allow-list (incl. a non-allow-listed tool on a partially-allow-listed server) is
   * genuinely uncallable — the faithful mapping D-CS9 requires. Absent/empty → tools-less (no gate).
   */
  allowedTools?: readonly string[];
  /**
   * Built-in tools removed from the model. Defaults to {@link SUBSCRIPTION_DISALLOWED_TOOLS} (the
   * exec/network/native-file built-in blocks) — the SAME list whether or not MCP tools are wired, since
   * the allow-listed MCP tools ride {@link mcpServers}/{@link allowedTools}, not this list.
   */
  disallowedTools?: readonly string[];
  /**
   * WP 1.3 — the effective token profiles (scenario defaults ∪ test additions). Drives the ESTIMATED,
   * MARKED per-tool metering: each `tool_result` step's `profileTokens` lenses (+ `resultBytes`) are
   * counted LOCALLY from the tool-result payload under these profiles (D-CS4 — the footprint is our
   * estimate, not provider-reported, so the step is flagged `meteringEstimated`). Defaults to
   * `generic_o200k` when absent. The EXACT token totals (`usageActual`) still come only from
   * `turn_done.usage`; tool-result metering never inflates them.
   */
  profiles?: readonly string[];
  /**
   * WP 1.4 (D-CS9, skills half) — this run's resolved skill attachments (the SAME
   * `ScenarioService.resolveAllowedSkills` resolution the AI-SDK path uses, threaded in by the run
   * service). Each resolved skill's files are MATERIALIZED READ-ONLY into the throwaway workspace's
   * `skills/` subtree (see {@link materializeSkillWorkspace}) so the run's own read-only disclosure
   * tool (an in-process MCP server — see `subscription-skill-tools.ts`) can serve their contents; the
   * L1 `<available_skills>` metadata block is already folded into {@link system} by the run service
   * (mirroring the AI-SDK path), so THIS module never touches the system prompt. Defaults to `[]` (or
   * absent) — a scenario with no attached skills stays byte-for-byte unchanged: no skills dir, no
   * extra `mcpServers` entry, no extra `allowedTools` pattern, no `additionalDirectories`.
   */
  resolvedSkills?: readonly ResolvedSkill[];
  /**
   * WP 1.4 — reads a resolved skill version's RAW file bytes for materialization (binary-safe, unlike
   * the AI-SDK path's text-only `SkillFileReader`). Required when {@link resolvedSkills} is non-empty;
   * the run service supplies a thin adapter over its `SkillRepository` (kept out of this module's
   * dependency graph, mirroring every other DI seam here — {@link driver}, {@link resolveAuth}, …).
   */
  skillFileReader?: SkillFileBytesReader;
  /**
   * Unified Sessions (roadmap/unified-sessions/, WP1.4, D-US4) — persist this run's capability manifest
   * ({@link SUBSCRIPTION_SESSION_CAPABILITIES}) at session start. Wired by the run service to
   * `RunRepository.setCapabilities` bound to this run's id (there is no `RunEvent` wire member for a
   * capability manifest — `RunSummary.capabilities` is read back from `capabilities_json`, WP1.6).
   * Defaults to a no-op: an existing caller/test that injects nothing behaves byte-identically (the
   * manifest simply isn't persisted). ALWAYS called with exactly {@link SUBSCRIPTION_SESSION_CAPABILITIES}
   * — a subscription run declares one static manifest.
   */
  recordCapabilities?: (capabilities: SessionCapabilities) => void;
  /**
   * Unified Sessions (WP1.4, D-US3) — persist the {@link SessionClock}-derived durations at the run's
   * terminal, alongside emitting the terminal `status` event. Wired by the run service to
   * `RunRepository.recordDurations` bound to this run's id (the `emit` closure the run service builds
   * for THIS executor forwards no `RunEmitMeta`, so this DI seam is the executor's own path to the same
   * persisted columns `RunManager.emit`'s `meta` parameter otherwise carries). Defaults to a no-op — the
   * durations then simply aren't recorded (as before this WP).
   */
  recordDurations?: (durations: { activeDurationMs?: number; totalDurationMs?: number }) => void;
  /**
   * Unified Sessions (WP1.4) — the {@link SessionClock} time/timer seam, injectable so a test can drive
   * stall/wait-budget/wall-cap firing deterministically with a fake clock instead of real `setTimeout`
   * waits. Defaults to {@link REAL_SESSION_CLOCK_TIME} (real wall-clock) when omitted.
   */
  clockTime?: SessionClockTime;
};

/** Running, cumulative KPI totals across a subscription run's turns (each `kpi` is the running Σ). */
type RunTotals = {
  /** Answered turns (= settled `llm_response` steps = the context chart's columns). */
  turns: number;
  /** Client-executed tool calls (0 at THIS WP; the seam bumps it for WP 1.3). */
  toolCalls: number;
  /** Σ provider-EXACT billed input tokens (incl. the cache slice), from `turn_done.usage`. */
  tokensIn: number;
  /** Σ provider-EXACT output tokens, from `turn_done.usage`. */
  tokensOut: number;
  /** Turn-granular PEAK context tokens (max over turns of input+output) — coarser than the AI-SDK path. */
  peakContextTokens: number;
  /**
   * Σ SHADOW reference cost in USD (D-CS8) — the run's EXACT usage priced via {@link estimateCost}, the
   * SAME pricing an API-keyed Claude run uses. Marginal subscription cost is $0; this is the reference
   * estimate (reported as `costUsd` with `costBasis: "subscription_reference"`) that also feeds the cost
   * cap. An unpriced model contributes 0 (a floor), never inflating the total.
   */
  costUsd: number;
};

/** A settled turn: the accumulated assistant prose + the turn's exact usage (from `turn_done`). */
type SettledTurn = { assistantText: string; usage: DriverUsage | undefined; endedMs: number };

/**
 * Map a raw {@link DriverUsage} (raw Anthropic counters: `input_tokens` EXCLUDES the cache slice) onto the
 * persisted {@link TokenUsageActual} contract, whose `inputTokens` INCLUDES the cache slice (cache read +
 * write) — so a subscription run's `usageActual.inputTokens` means the SAME thing the AI-SDK anthropic
 * path's does, keeping KPIs consistent across the two stacks. Counts are EXACT (no estimation, D-CS4).
 */
function toUsageActual(usage: DriverUsage): TokenUsageActual {
  const cacheReadTokens = usage.cacheReadInputTokens;
  const cacheWriteTokens = usage.cacheCreationInputTokens;
  const cachedInputTokens = cacheReadTokens + cacheWriteTokens;
  // Billed input INCLUDES the cached slice (contract of TokenUsageActual.inputTokens); raw Anthropic
  // `input_tokens` reports it separately, so add it back to match the AI-SDK-normalized path.
  const inputTokens = usage.inputTokens + cachedInputTokens;
  const actual: TokenUsageActual = { inputTokens, outputTokens: usage.outputTokens };
  if (cachedInputTokens > 0) actual.cachedInputTokens = cachedInputTokens;
  if (cacheReadTokens > 0) actual.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens > 0) actual.cacheWriteTokens = cacheWriteTokens;
  return actual;
}

/** The ESTIMATED, MARKED footprint of one MCP `tool_result` payload (D-CS4) — no `usageActual` here. */
type ToolResultFootprint = {
  /** Estimator lenses (run's effective profiles) over the serialized tool-result payload. */
  profileTokens: Partial<Record<TokenProfileRef, number>>;
  /** UTF-8 byte length of the serialized result payload (undefined when it can't be serialized). */
  resultBytes?: number;
};

/** Meters a tool-result payload under the run's effective profiles (async — the counters are async). */
type ToolResultMeter = (result: unknown) => Promise<ToolResultFootprint>;

/**
 * Build a {@link ToolResultMeter} over the run's effective profiles. Mirrors how the AI-SDK path meters
 * a tool result (`AccountingSink.recordToolResult` → `countJson`), but LOCAL + ESTIMATED (D-CS9): the
 * Agent SDK runs the MCP tools in its child and never reports their token cost, so we count the
 * `tool_result` payload ourselves under the SAME {@link TokenCounter}s the rest of the app uses.
 * Defaults to `generic_o200k` when no profiles were resolved (matches the accounting sink's fallback).
 */
function createToolResultMeter(profiles: readonly string[]): ToolResultMeter {
  const ids = (profiles.length > 0 ? profiles : ["generic_o200k"]) as readonly TokenProfileRef[];
  const counters = ids.map((id) => getTokenCounter(id));
  return async (result) => {
    const profileTokens: Partial<Record<TokenProfileRef, number>> = {};
    for (const counter of counters) {
      profileTokens[counter.id as TokenProfileRef] = await counter.countJson(result);
    }
    return { profileTokens, resultBytes: serializedByteLength(result) };
  };
}

/** UTF-8 byte size of a JSON-serialized value; `undefined` when it isn't serializable (e.g. a cycle). */
function serializedByteLength(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return undefined;
  }
}

/**
 * A DEFAULT-DENY tool-permission gate over the allow-list patterns (the SDK's `canUseTool`, D-CS9). The
 * SDK reports a tool use by its fully-qualified `mcp__<serverKey>__<toolName>` name; a call whose name
 * is in the allow set runs, anything else is DENIED with a truthful message. This is what makes a
 * non-allow-listed tool (e.g. an extra tool on a partially-allow-listed server) genuinely uncallable —
 * the allow patterns alone only auto-approve; this gate is the guarantee.
 *
 * EXPORTED (model-identity WP3.2 / D-MI3) so the Hub's subscription adapter (`hub/subscription-adapter.ts`)
 * reuses the SAME gate rather than forking a second one — the adapter's whole design premise is
 * "composed, never forked" (see its module header). Nothing about the gate is Testing-specific.
 */
export function makeAllowListGate(allowedTools: readonly string[]): DriverCanUseTool {
  const allow = new Set(allowedTools);
  return async (request) =>
    allow.has(request.toolName)
      ? { behavior: "allow" }
      : {
          behavior: "deny",
          message: `Tool "${request.toolName}" is not on this run's allow-list and cannot be used.`,
        };
}

/**
 * A per-run monotonic {@link RunStep} allocator (mirrors the engine / qlik-answers executor). Steps carry
 * no estimator lenses by default (`profileTokens: {}`); a `tool_result` step overrides it with the
 * ESTIMATED per-tool lenses (WP 1.3).
 */
function stepAllocator(runId: string): (
  type: RunStepType,
  label: string,
  status: RunStep["status"],
  extra: Partial<RunStep>,
) => RunStep {
  let stepIndex = 0;
  return (type, label, status, extra) => ({
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
}

/**
 * Unified Sessions (roadmap/unified-sessions/, WP1.4, D-US1/D-US6) — acquire a concurrency permit,
 * emitting a `{type:"phase",phase:"queued",detail:{position}}` event FIRST when the gate has no free
 * permit right now, then clearing to `{type:"phase",phase:"starting"}` once the permit is actually
 * granted. A gate whose next `acquire()` would resolve IMMEDIATELY (a free permit) emits NEITHER phase
 * event — the run proceeds exactly as it did before this WP (byte-identical event shape for the common,
 * uncontended case). `position`/`willQueue` are read from the OPTIONAL {@link QueueVisibleGate} facet;
 * a bare {@link ConcurrencyGate} test double that doesn't implement it just queues silently (still
 * correct, only without the visibility).
 */
async function acquireGate(gate: ConcurrencyGate, emit: EngineEmit): Promise<void> {
  const withQueue = gate as Partial<QueueVisibleGate>;
  if (withQueue.willQueue === true) {
    const position = (withQueue.queueLength ?? 0) + 1;
    emit({ type: "phase", phase: "queued", detail: { position } });
    await gate.acquire();
    emit({ type: "phase", phase: "starting" });
    return;
  }
  await gate.acquire();
}

/** Human-readable `stopReason` text for a clock/abort-driven terminal cause (D-US2/D-US3). */
function describeCause(cause: TerminalCause, cfg: ClaudeSubscriptionRunConfig): string {
  switch (cause) {
    case "user_stop":
      return "Run aborted by user";
    case "stalled":
      return `No activity for ${Math.round(DEFAULT_STALL_MS / 60_000)} min — the run appears stalled.`;
    case "wait_expired":
      return `No reply within ${Math.round(DEFAULT_WAIT_BUDGET_MS / 60_000)} min — the wait budget expired.`;
    case "max_duration":
      return `maxRunDurationMs (${cfg.maxRunDurationMs}ms) reached`;
    case "max_cost":
      return `maxCostUsd ($${cfg.maxCostUsd}) reached`;
    default:
      // Not reachable from this executor today (session_ended/max_turns/etc. belong to other adopters);
      // kept total/defensive rather than throwing.
      return `Run stopped (${cause})`;
  }
}

/** Map a caught failure to the {@link TerminalCause} `terminalFor` expects (D-CS7 honest degradation). */
function classifyErrorCause(error: unknown): TerminalCause {
  if (error instanceof SubscriptionRunError) {
    if (error.kind === "auth") return "auth";
    if (error.kind === "rate_limit") return "rate_limit";
  }
  return "provider_error";
}

/**
 * Unified Sessions (WP1.4, D-US1/D-US2/D-US3) — owns this run's `driver.start()` {@link AbortController}
 * and the "write verdict before kill" ordering. `terminateWith`/`terminateWithError`/
 * `terminateAfterFreshKpi` are the ONLY paths that ever write this run's terminal `status` event for a
 * clock/abort/error/guardrail-driven stop: all three are idempotent (first cause wins, mirroring
 * {@link SessionClock}'s own "first cause wins" rule) and, CRUCIALLY, emit the terminal event (+ record
 * durations) BEFORE aborting the controller wired into `driver.start()` — so the child's resulting
 * stream-end can never race ahead of, or reclassify, the verdict already on the wire (D-US2, "steal from
 * cdesktop"). Because settling is idempotent, the main loop / catch block can ALWAYS call
 * `terminateWith(error)` on a caught failure without checking whether a clock/abort fire got there first
 * — a race just resolves to the FIRST (correct) cause.
 */
type Termination = {
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly settled: LoopResult | undefined;
  /** Clock fire / user-stop: MAY have interrupted mid-turn, so re-broadcasts a fresh `kpi` first. */
  terminateWith(cause: TerminalCause): LoopResult;
  /** A genuine driver/auth/rate-limit failure: emits an `error` event too, then a fresh `kpi`. */
  terminateWithError(cause: TerminalCause, message: string): LoopResult;
  /**
   * A guardrail that trips immediately AFTER a turn just settled (the cost cap; the interactive loop's
   * clean "no more turns" fallback) — `accumulateAndEmitKpi` (or nothing new) already put the LATEST
   * totals on the wire, so this SKIPS the redundant re-emission (matches the pre-WP1.4 shape: no
   * double-KPI on a cost-cap trip).
   */
  terminateAfterFreshKpi(cause: TerminalCause): LoopResult;
};

function createTermination(
  cfg: ClaudeSubscriptionRunConfig,
  clock: SessionClock,
  emit: EngineEmit,
  totals: RunTotals,
): Termination {
  const controller = new AbortController();
  let settled: LoopResult | undefined;

  function settle(
    cause: TerminalCause,
    stopReason: string,
    alsoEmitError: boolean,
    alsoEmitKpi: boolean,
  ): LoopResult {
    if (settled) return settled;
    clock.stop();
    const verdict = terminalFor(cause);
    if (alsoEmitError) emit({ type: "error", message: stopReason });
    if (alsoEmitKpi) emitKpi(emit, totals);
    emit({
      type: "status",
      status: verdict.status,
      outcome: verdict.outcome,
      stopReason,
      stopReasonCode: verdict.stopReasonCode,
    });
    cfg.recordDurations?.({
      activeDurationMs: clock.activeDurationMs,
      totalDurationMs: clock.totalDurationMs,
    });
    const result: LoopResult = {
      status: verdict.status,
      outcome: verdict.outcome,
      stopReason,
      turns: Math.max(totals.turns, 1),
      toolCalls: totals.toolCalls,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
    };
    settled = result;
    // Kill AFTER the verdict is on the wire (D-US2) — never before.
    controller.abort();
    return result;
  }

  return {
    controller,
    signal: controller.signal,
    get settled() {
      return settled;
    },
    terminateWith: (cause) => settle(cause, describeCause(cause, cfg), false, true),
    terminateWithError: (cause, message) => settle(cause, message, true, true),
    terminateAfterFreshKpi: (cause) => settle(cause, describeCause(cause, cfg), false, false),
  };
}

/**
 * Build this run's {@link SessionClock} + {@link Termination}, wire the clock's fires and the user
 * abort signal to `terminateWith` (D-US2 ordering), start the clock, record the static capability
 * manifest, and emit the opening `running` status. Shared by both entry points so the wiring can't drift
 * between the automated and interactive shapes.
 */
function startSessionLifecycle(
  cfg: ClaudeSubscriptionRunConfig,
  rawEmit: EngineEmit,
  totals: RunTotals,
): { clock: SessionClock; termination: Termination; emit: EngineEmit } {
  // Definite-assignment: `onFire` is only ever INVOKED after `clock.start()` (never during construction),
  // by which point `termination` below is already assigned — the standard circular-closure pattern.
  let termination!: Termination;
  const clock = new SessionClock({
    maxDurationMs: cfg.maxRunDurationMs, // opt-in only (D-US3) — no hidden wall-clock default anymore.
    time: cfg.clockTime,
    onFire: (fire) => termination.terminateWith(fire.cause),
  });
  // `noteEvent()` rolls the stall timer on every emitted event while actively running (D-US3); a no-op
  // while waiting/fired/stopped, so wrapping unconditionally is always safe.
  const emit: EngineEmit = (event) => {
    rawEmit(event);
    clock.noteEvent();
  };
  termination = createTermination(cfg, clock, emit, totals);
  clock.start();
  // WP1.R (B2 fix) — emit the opening `running` status (+ capabilities + the phase clear) BEFORE
  // wiring/checking the abort signal. The executor awaits its concurrency permit at `acquireGate`
  // BEFORE this function runs, so `cfg.abortSignal` (`control.abort`) can already be aborted when we
  // get here (stopping a QUEUED run). Checking the signal first fired the pre-abort guard's
  // `terminateWith('user_stop')` (emits terminal `aborted`) BEFORE `running` was ever emitted; the
  // trailing `running` emit then overwrote the finalized `aborted` via the persistence sink's
  // non-terminal branch, leaving `runs.status='running'` — an orphan. With `running` emitted first, a
  // pre-aborted run's sequence is the coherent `running` → `aborted` (a proper terminal, never
  // overwritten).
  cfg.recordCapabilities?.(SUBSCRIPTION_SESSION_CAPABILITIES);
  emit({ type: "status", status: "running" });
  // Unified Sessions (WP1.7, D-US1 follow-up) — clear the transient `queued`/`starting` phase (if
  // `acquireGate` emitted one) now that the run is ordinarily running, so `runs.phase` never lingers
  // stale for the uncontended (no-queue) case this already was, and doesn't linger `starting` for the
  // queued case either. A no-op event when no phase was ever set — mirrors the engine's identical clear.
  emit({ type: "phase", phase: null });
  if (cfg.abortSignal) {
    if (cfg.abortSignal.aborted) termination.terminateWith("user_stop");
    else {
      cfg.abortSignal.addEventListener("abort", () => termination.terminateWith("user_stop"), {
        once: true,
      });
    }
  }
  return { clock, termination, emit };
}

/**
 * Resolve the subscription auth, or throw a `SubscriptionRunError("auth")` when unsigned (D-CS7) — called
 * BEFORE any workspace is created or child spawned, so an unsigned run touches nothing.
 */
function resolveAuthOrThrow(cfg: ClaudeSubscriptionRunConfig): AssistantAuthSource {
  const auth = cfg.resolveAuth();
  if (!auth) {
    throw new SubscriptionRunError("auth", "this run needs a signed-in Claude subscription");
  }
  return auth;
}

/**
 * WP 1.4 (D-CS9, skills half) — materialize this run's resolved skills, READ-ONLY, under the throwaway
 * workspace's `skills/` subtree, once the workspace dir is known (the config alone can't name a
 * concrete path — the workspace is created per-run by {@link runClaudeSubscription}/
 * {@link runClaudeSubscriptionInteractive} AFTER `resolveClaudeSubscription` already returned). Returns
 * the skills dir when ≥1 skill was materialized, else `undefined` — a scenario with no attached skills
 * (or no injected {@link ClaudeSubscriptionRunConfig.skillFileReader}) never creates the subtree, so
 * {@link startSession} wires nothing extra for it (byte-for-byte unchanged from before this WP).
 */
async function materializeSkillWorkspace(
  cfg: ClaudeSubscriptionRunConfig,
  workspace: ThrowawayWorkspace,
): Promise<string | undefined> {
  const resolvedSkills = cfg.resolvedSkills ?? [];
  if (resolvedSkills.length === 0 || !cfg.skillFileReader) return undefined;
  const skillsDir = path.join(workspace.dir, "skills");
  await materializeSkills(skillsDir, resolvedSkills, cfg.skillFileReader);
  return skillsDir;
}

/**
 * Build the minimal spawn env + start ONE live driver session for the run — shared by the automated +
 * interactive entry points. The throwaway dir scopes the child's HOME / CLAUDE_CONFIG_DIR (transcript
 * lands here) + cwd — never the real assistant home; `buildAssistantSpawnEnv` drops every other
 * secret/config from the env.
 *
 * MCP tools (WP 1.3, D-CS9): the allow-listed servers ride `mcpServers` (the SDK connects them in the
 * child) and the allow-list rides `allowedTools` (`mcp__<serverKey>__<toolName>` patterns). When any
 * tool is allow-listed a DEFAULT-DENY `canUseTool` gate is wired over the SAME patterns so a
 * non-allow-listed tool is uncallable. A tools-less run (`allowedTools` absent/empty) omits both — its
 * driver options are byte-for-byte the tools-less shape (`mcpServers: {}`, no `allowedTools`/gate).
 *
 * Skills (WP 1.4, D-CS9): when {@link materializeSkillWorkspace} materialized a `skillsDir`, the
 * read-only skill-disclosure in-process MCP server is merged into `mcpServers` under the
 * `"skills"` key and its two tool patterns (`mcp__skills__list_skill_files`/`read_skill_file`) are
 * added to the allow-list — so a scenario with skills but NO allow-listed MCP server still gets a
 * DEFAULT-DENY `canUseTool` gate (now covering exactly its skill tools), never an unrestricted run. Also
 * widens `additionalDirectories` to `skillsDir` (D-CS9's literal "materialized … into the SDK
 * workspace" — the disclosure tool itself reads server-side, not through the SDK's native file tools,
 * which stay disallowed; this is defense-in-depth scope documentation, not a new capability). A run with
 * no materialized skills wires NONE of this — identical to the pre-WP-1.4 shape.
 */
function startSession(
  cfg: ClaudeSubscriptionRunConfig,
  auth: AssistantAuthSource,
  workspace: ThrowawayWorkspace,
  controller: AbortController,
  skillsDir: string | undefined,
): DriverSession {
  const env = buildAssistantSpawnEnv({ auth, assistantDataDir: workspace.dir });
  const resolvedSkills = cfg.resolvedSkills ?? [];
  const hasSkills = skillsDir !== undefined && resolvedSkills.length > 0;
  const mcpServers: Record<string, unknown> = {
    ...(cfg.mcpServers ?? {}),
    ...(hasSkills
      ? { [SUBSCRIPTION_SKILLS_MCP_KEY]: buildSubscriptionSkillToolServer(skillsDir, resolvedSkills) }
      : {}),
  };
  const allowedTools = [...(cfg.allowedTools ?? []), ...(hasSkills ? subscriptionSkillToolPatterns() : [])];
  const toolsWired = allowedTools.length > 0;
  return cfg.driver.start({
    model: cfg.model,
    cwd: workspace.dir,
    maxTurns: cfg.maxTurns,
    systemPrompt: cfg.system,
    env,
    mcpServers,
    disallowedTools: cfg.disallowedTools ?? SUBSCRIPTION_DISALLOWED_TOOLS,
    // Only present when the scenario allow-lists ≥1 MCP tool OR ≥1 skill — keeps the tools-less/
    // skill-less shape unchanged.
    ...(toolsWired ? { allowedTools, canUseTool: makeAllowListGate(allowedTools) } : {}),
    ...(hasSkills ? { additionalDirectories: [skillsDir] } : {}),
    abortController: controller,
  });
}

/**
 * Emit the closing `llm_response` step for one settled turn (D-CS3 — the SAME shape the AI-SDK path's
 * accounting sink emits). `usageActual` carries EXACT counts; the step is flagged `meteringEstimated`
 * because its context/footprint (`cumulativeTokens`) is a turn-granular estimate (D-CS4).
 */
function emitLlmResponse(
  emit: EngineEmit,
  nextStep: ReturnType<typeof stepAllocator>,
  cfg: ClaudeSubscriptionRunConfig,
  turnIndex: number,
  turn: SettledTurn,
  startedMs: number,
): TokenUsageActual | undefined {
  const usageActual = turn.usage ? toUsageActual(turn.usage) : undefined;
  const cumulative = usageActual ? usageActual.inputTokens + usageActual.outputTokens : undefined;
  emit({
    type: "step",
    step: nextStep("llm_response", cfg.model, "ok", {
      turnIndex,
      // Exact provider counts (D-CS4) — no estimation on the numbers themselves.
      ...(usageActual ? { usageActual } : {}),
      // Turn-granular context estimate (coarser than the AI-SDK step-granular path) → mark it estimated.
      ...(cumulative !== undefined ? { cumulativeTokens: cumulative, meteringEstimated: true } : {}),
      ...(turn.assistantText ? { assistantText: turn.assistantText } : {}),
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(turn.endedMs).toISOString(),
      payload: null,
    }),
  });
  return usageActual;
}

/**
 * Emit the cumulative `kpi` from the current totals (D-CS8). `costUsd` is the SHADOW reference cost
 * accumulated in {@link RunTotals.costUsd} — the run's EXACT tokens × the Anthropic list price
 * ({@link estimateCost}), the SAME pricing an API-keyed Claude run uses (marginal subscription cost is
 * $0). `costBasis` flags it so the UI/reports label it "est. · subscription". The token COUNTS
 * (`tokensIn`/`tokensOut`) stay EXACT (from `turn_done.usage`); only their USD valuation is a reference.
 */
function emitKpi(emit: EngineEmit, totals: RunTotals): void {
  emit({
    type: "kpi",
    turns: totals.turns,
    toolCalls: totals.toolCalls,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    contextTokens: totals.peakContextTokens,
    costUsd: totals.costUsd,
    costBasis: SUBSCRIPTION_COST_BASIS,
  });
}

/**
 * Fold one settled turn's exact usage into the running totals + emit the cumulative `kpi`. The token
 * counts stay EXACT; `model` is priced via {@link estimateCost} to accumulate the SHADOW reference cost
 * (D-CS8) — summing per-turn is IDENTICAL to pricing the cumulative usage (estimateCost is linear in the
 * token counts) and mirrors how the engine accumulates cost per settled step. An unpriced model prices
 * at 0 (a floor), so `costUsd` stays 0 for it.
 */
function accumulateAndEmitKpi(
  emit: EngineEmit,
  totals: RunTotals,
  usageActual: TokenUsageActual | undefined,
  model: string,
): void {
  totals.turns += 1;
  if (usageActual) {
    totals.tokensIn += usageActual.inputTokens;
    totals.tokensOut += usageActual.outputTokens;
    totals.peakContextTokens = Math.max(
      totals.peakContextTokens,
      usageActual.inputTokens + usageActual.outputTokens,
    );
    totals.costUsd += estimateCost(model, usageActual);
  }
  emitKpi(emit, totals);
}

/**
 * D-CS8 — has the cumulative SHADOW cost REACHED the configured spend cap? SIGN CHECK (do NOT get this
 * wrong): this MIRRORS the engine's `guardrails.check` (`state.costUsd >= cfg.maxCostUsd`) — the cap
 * trips when the accumulated cost is GREATER-OR-EQUAL to the cap (cost EXCEEDS the budget → stop), NEVER
 * the reverse. A 0/undefined cap is "no limit" (`cap > 0` mirrors the engine's truthiness guard).
 */
function costCapReached(cfg: ClaudeSubscriptionRunConfig, totals: RunTotals): boolean {
  const cap = cfg.maxCostUsd;
  return cap !== undefined && cap > 0 && totals.costUsd >= cap;
}

/**
 * D-CS8 / engine Issue #10 — a spend cap is only meaningful if we can price the model. For a model with
 * NO known price, {@link estimateCost} returns 0 forever, so `maxCostUsd` could never trip and the run
 * would spend UNBOUNDED while appearing capped. So when a cost cap is set on an UNPRICED model, REJECT
 * the run up front (before acquiring the gate / spawning any child) with the SAME honest, clear message
 * the engine gives — never silently run with an un-trippable cap. Returns the terminal `error`
 * {@link LoopResult} (and emits the honest events) when it applies, else `undefined`. A cap on a priced
 * model, or no cap at all, returns `undefined` (an unpriced model with no cap is fine — a cost floor of 0).
 */
function rejectIfUnpricedCostCap(
  cfg: ClaudeSubscriptionRunConfig,
  emit: EngineEmit,
): LoopResult | undefined {
  if (!cfg.maxCostUsd || isModelPriced(cfg.model)) return undefined;
  const message =
    `Cost cap (maxCostUsd=${cfg.maxCostUsd}) is set but model "${cfg.model}" has no known pricing, so ` +
    `the spend cap cannot be enforced (estimated cost would always be 0). Refusing to run — add the ` +
    `model to the pricing table or remove maxCostUsd.`;
  emit({ type: "error", message });
  emit({ type: "status", status: "error", outcome: "error", stopReason: message });
  return { status: "error", outcome: "error", stopReason: message, turns: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0 };
}

/**
 * Walk the driver's normalized event stream for ONE user-message turn: stream `assistant_delta` as live
 * `delta` events, accumulate settled `assistant_message` prose, map `tool_call`/`tool_result` onto tool
 * steps (the WP 1.3 seam — tools-less at THIS WP, so structured but not exercised), and RETURN on the
 * turn's `turn_done`. A `limit_error`/`error`, or the stream ending without a `turn_done`, throws a
 * distinguishable {@link SubscriptionRunError} (honest degradation, D-CS7).
 */
async function consumeTurn(
  events: AsyncIterator<DriverEvent>,
  emit: EngineEmit,
  nextStep: ReturnType<typeof stepAllocator>,
  totals: RunTotals,
  turnIndex: number,
  meter: ToolResultMeter,
): Promise<SettledTurn> {
  let assistantText = "";
  // WP 1.3 seam — a `tool_result` event carries no name; correlate it back to its `tool_call`'s name by
  // `toolUseId` (mirrors the assistant session-manager's `pendingToolNames`).
  const pendingToolNames = new Map<string, string>();
  while (true) {
    const next = await events.next();
    if (next.done) {
      throw new SubscriptionRunError("driver", "the run produced no result before the session ended");
    }
    const event = next.value;
    switch (event.type) {
      case "assistant_delta":
        if (event.text) emit({ type: "delta", channel: "text", text: event.text, turnIndex });
        break;
      case "assistant_message":
        assistantText += event.text;
        break;
      case "tool_call":
        // WP 1.3 (D-CS9) — an MCP tool the SDK ran in its child. A client tool call counts toward the
        // KPI + budget; correlate its name back to the later `tool_result` by `toolUseId`.
        totals.toolCalls += 1;
        pendingToolNames.set(event.toolUseId, event.toolName);
        emit({
          type: "step",
          step: nextStep("tool_call", event.toolName, "running", {
            toolName: event.toolName,
            turnIndex,
            payload: { toolCallId: event.toolUseId, args: event.input },
          }),
        });
        break;
      case "tool_result": {
        // WP 1.3 — a tool that RAN but failed (`isError`) is a FAILED step, and the run CONTINUES (only a
        // genuine transport failure fails the whole run — surfaced as a driver `error` event below).
        const toolName = pendingToolNames.get(event.toolUseId) ?? "";
        pendingToolNames.delete(event.toolUseId);
        // ESTIMATED, MARKED per-tool metering (D-CS4/D-CS9): count the tool-result payload LOCALLY under
        // the run's profiles (`profileTokens`) + its serialized byte size (`resultBytes`), and flag
        // `meteringEstimated` — the Agent SDK never reports a tool's token cost. This NEVER touches
        // `usageActual` (which stays provider-exact, from `turn_done.usage` on the llm_response step).
        const footprint = await meter(event.result);
        emit({
          type: "step",
          step: nextStep("tool_result", toolName, event.isError ? "error" : "ok", {
            toolName,
            turnIndex,
            profileTokens: footprint.profileTokens,
            meteringEstimated: true,
            ...(footprint.resultBytes !== undefined ? { resultBytes: footprint.resultBytes } : {}),
            payload: { toolCallId: event.toolUseId, result: event.result },
          }),
        });
        break;
      }
      case "turn_done":
        return { assistantText, usage: event.usage, endedMs: Date.now() };
      case "limit_error":
        throw new SubscriptionRunError(
          event.kind === "auth" ? "auth" : "rate_limit",
          event.message,
        );
      case "error":
        throw new SubscriptionRunError("driver", event.message);
      default:
        // `session` — the SDK session id; not part of the run model. Ignore.
        break;
    }
  }
}

/**
 * Unified Sessions (WP1.4, D-US3) — the `waiting_input` wait for the next interactive user turn,
 * replacing the old ad hoc idle-timeout race. Brackets the wait with {@link SessionClock.enterWaiting}/
 * `resumeFromWaiting` (D-US3: a legitimate wait on the operator PAUSES the stall timer and arms the
 * wait-budget timer instead — distinct from "no one is looking at this run") and emits the `waiting_input`
 * phase with the clock's server-authored absolute deadline, when one is armed. Resolves `null` the moment
 * `termination.signal` aborts (a clock fire or a user stop — by construction, `terminateWith` has ALREADY
 * written the terminal verdict by the time that happens, D-US2), so the caller never has to re-derive a
 * cause here.
 *
 * Unified Sessions (WP1.7, D-US1 follow-up) — the `finally` UNCONDITIONALLY emits an additional
 * `{type:"phase",phase:null}` clearing the `waiting_input` phase back to "no distinct phase", whether
 * the wait resolved because the run is CONTINUING (a real next turn) or because it's ENDING (a clock
 * fire or a user stop aborted `termination.signal`). Unlike `engine.ts`/`qlik-answers-executor.ts`, this
 * executor has NO `stopping` phase write on ANY terminal path (`createTermination`'s `settle()` writes
 * only the terminal `status`) — so without an unconditional clear here, a run that reached ANY terminal
 * (`wait_expired`, `user_stop`, …) while `waiting_input` would leave `runs.phase` stuck at
 * `waiting_input` FOREVER, even though the run is fully done (violating the invariant this WP closes).
 * Emitting the clear after a terminal status has already gone out is safe — `RunManager.emit` is a
 * no-op once a run is cleaned up, and otherwise it just persists the (accurate) `phase: null`.
 */
async function nextTurnOrStopWaiting(
  turns: InteractiveTurns,
  termination: Termination,
  clock: SessionClock,
  emit: EngineEmit,
): Promise<string | null> {
  if (termination.signal.aborted) return null;
  clock.enterWaiting();
  emit({
    type: "phase",
    phase: "waiting_input",
    detail: { reason: "next_turn", ...(clock.deadlineAt ? { deadlineAt: clock.deadlineAt } : {}) },
  });
  try {
    return await new Promise<string | null>((resolve) => {
      const onAbort = () => resolve(null);
      termination.signal.addEventListener("abort", onAbort, { once: true });
      void turns.nextTurn().then((value) => {
        termination.signal.removeEventListener("abort", onAbort);
        resolve(value);
      });
    });
  } finally {
    clock.resumeFromWaiting();
    emit({ type: "phase", phase: null });
  }
}

/**
 * Run one AUTOMATED subscription run (single opener prompt): resolve auth → start a throwaway session →
 * drive the SDK's internal tool loop to its one `turn_done` → emit the standard RunEvent vocabulary →
 * one terminal status. The SDK owns the internal multi-turn loop (bounded by `cfg.maxTurns`); this drives
 * exactly one user message. WP 1.2 calls this for a non-interactive `claude_subscription` run.
 */
export async function runClaudeSubscription(
  runId: string,
  cfg: ClaudeSubscriptionRunConfig,
  rawEmit: EngineEmit,
): Promise<LoopResult> {
  // D-CS8 — fail fast on a cost cap over an unpriced model (before the gate/child), never a silently
  // un-trippable cap. A pre-spawn honest degradation, consistent with the auth check.
  const capRejection = rejectIfUnpricedCostCap(cfg, rawEmit);
  if (capRejection) return capRejection;

  const gate = cfg.concurrency ?? getDefaultGate();
  const createWorkspace = cfg.createWorkspace ?? createThrowawayWorkspace();
  const nextStep = stepAllocator(runId);
  const meter = createToolResultMeter(cfg.profiles ?? []);
  const totals: RunTotals = { turns: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, peakContextTokens: 0, costUsd: 0 };

  // D-US1/D-US6 — queue visibility BEFORE the concurrency permit is acquired.
  await acquireGate(gate, rawEmit);
  // D-US3/D-US4 — SessionClock + capability manifest + the `running` status, once the permit is held.
  const { clock, termination, emit } = startSessionLifecycle(cfg, rawEmit, totals);
  emit({
    type: "step",
    step: nextStep("user_message", "user", "ok", { payload: { text: cfg.prompt }, turnIndex: 0 }),
  });

  let workspace: ThrowawayWorkspace | undefined;
  let session: DriverSession | undefined;
  const turnStartMs = Date.now();
  try {
    // Resolve auth BEFORE creating a workspace / spawning a child (D-CS7 — an unsigned run touches nothing).
    const auth = resolveAuthOrThrow(cfg);
    workspace = await createWorkspace();
    // WP 1.4 — materialize any attached skills read-only into the workspace BEFORE the session starts,
    // so its files are already on disk when the driver's skill-disclosure tool (if wired) is reachable.
    const skillsDir = await materializeSkillWorkspace(cfg, workspace);
    // D-US2 — a fire/user-stop that already settled the run BEFORE the session exists must never start
    // one (the child's `abortController` would already be aborted, and a fake driver that only listens
    // for a FUTURE abort — never checking `signal.aborted` up front — would hang forever).
    if (termination.settled) return termination.settled;
    session = startSession(cfg, auth, workspace, termination.controller, skillsDir);
    session.send({ text: cfg.prompt });

    const turn = await consumeTurn(
      session.events[Symbol.asyncIterator](),
      emit,
      nextStep,
      totals,
      0,
      meter,
    );
    const usageActual = emitLlmResponse(emit, nextStep, cfg, 0, turn, turnStartMs);
    accumulateAndEmitKpi(emit, totals, usageActual, cfg.model);

    // D-CS8 — stop on the spend cap once this settled turn's cumulative shadow cost reaches it. The
    // `finally` tears the (warm) session down; the KPI was already emitted just above (no double-KPI).
    if (costCapReached(cfg, totals)) return termination.terminateAfterFreshKpi("max_cost");

    clock.stop();
    emit({ type: "status", status: "completed", outcome: "completed" });
    cfg.recordDurations?.({ activeDurationMs: clock.activeDurationMs, totalDurationMs: clock.totalDurationMs });
    return {
      status: "completed",
      outcome: "completed",
      turns: Math.max(totals.turns, 1),
      toolCalls: totals.toolCalls,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
    };
  } catch (error) {
    // D-US2 — idempotent: if a clock fire/user-stop already wrote the verdict, this just returns it (the
    // FIRST cause wins) rather than reclassifying an expected post-verdict stream-end as a fresh error.
    const message = error instanceof Error ? error.message : String(error);
    return termination.terminateWithError(classifyErrorCause(error), message);
  } finally {
    clock.stop();
    termination.controller.abort(); // tear the (warm) session down whichever way it settled.
    await workspace?.cleanup().catch(() => {});
    gate.release();
  }
}

/**
 * Run one INTERACTIVE subscription session (D-CS3): same throwaway single-session structure as
 * {@link runClaudeSubscription}, but after each turn's `turn_done` it awaits the next user turn from
 * {@link InteractiveTurns.nextTurn} and continues the SAME warm session via `send()`. Every KPI is
 * CUMULATIVE. The session stays live between turns; a terminal `status` is emitted ONCE it ends (user
 * stop / stall / wait-budget-expired / wall-cap → `aborted`/`stopped_guardrail`; a driver/limit/auth
 * failure → `error`). WP 1.2 calls this for an interactive `claude_subscription` run.
 */
export async function runClaudeSubscriptionInteractive(
  runId: string,
  cfg: ClaudeSubscriptionRunConfig,
  turns: InteractiveTurns,
  rawEmit: EngineEmit,
): Promise<LoopResult> {
  // D-CS8 — fail fast on a cost cap over an unpriced model (before the gate/child), never a silently
  // un-trippable cap. A pre-spawn honest degradation, consistent with the auth check.
  const capRejection = rejectIfUnpricedCostCap(cfg, rawEmit);
  if (capRejection) return capRejection;

  const gate = cfg.concurrency ?? getDefaultGate();
  const createWorkspace = cfg.createWorkspace ?? createThrowawayWorkspace();
  const nextStep = stepAllocator(runId);
  const meter = createToolResultMeter(cfg.profiles ?? []);
  const totals: RunTotals = { turns: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, peakContextTokens: 0, costUsd: 0 };

  // D-US1/D-US6 — queue visibility BEFORE the concurrency permit is acquired.
  await acquireGate(gate, rawEmit);
  // D-US3/D-US4 — SessionClock + capability manifest + the `running` status, once the permit is held.
  const { clock, termination, emit } = startSessionLifecycle(cfg, rawEmit, totals);

  let workspace: ThrowawayWorkspace | undefined;
  let session: DriverSession | undefined;
  try {
    // Resolve auth BEFORE creating a workspace / spawning a child (D-CS7 — an unsigned run touches nothing).
    const auth = resolveAuthOrThrow(cfg);
    workspace = await createWorkspace();
    // WP 1.4 — materialize any attached skills read-only into the workspace BEFORE the session starts.
    const skillsDir = await materializeSkillWorkspace(cfg, workspace);
    // D-US2 — see the automated entry point's identical guard.
    if (termination.settled) return termination.settled;
    session = startSession(cfg, auth, workspace, termination.controller, skillsDir);
    const events = session.events[Symbol.asyncIterator]();

    let turnIndex = 0;
    // The opener user turn.
    emit({
      type: "step",
      step: nextStep("user_message", "user", "ok", { payload: { text: cfg.prompt }, turnIndex }),
    });
    let turnStartMs = Date.now();
    session.send({ text: cfg.prompt });

    while (true) {
      const turn = await consumeTurn(events, emit, nextStep, totals, turnIndex, meter);
      const usageActual = emitLlmResponse(emit, nextStep, cfg, turnIndex, turn, turnStartMs);
      accumulateAndEmitKpi(emit, totals, usageActual, cfg.model);

      // D-CS8 — stop MID-CONVERSATION once the cumulative shadow cost reaches the cap (evaluated at each
      // settled turn — the finest granularity this stack offers). The `finally` tears the session down.
      // No double-KPI: `accumulateAndEmitKpi` just put the latest totals on the wire above.
      if (costCapReached(cfg, totals)) return termination.terminateAfterFreshKpi("max_cost");

      const next = await nextTurnOrStopWaiting(turns, termination, clock, emit);
      if (next === null) break; // user stop / clock fire / provider exhausted the queue → end the session
      turnIndex += 1;
      turnStartMs = Date.now();
      emit({
        type: "step",
        step: nextStep("user_message", "user", "ok", { payload: { text: next }, turnIndex }),
      });
      session.send({ text: next });
    }

    // A clock fire / user stop ALREADY wrote the verdict (D-US2) — return it. Otherwise the interactive
    // turn provider itself resolved `null` with nothing else pending (queue exhausted, no signal fired):
    // a clean end of the loop is a STOPPED/ABORTED terminal — the session was ended, not "completed". No
    // double-KPI: the last turn's `accumulateAndEmitKpi` already put the latest totals on the wire.
    return termination.settled ?? termination.terminateAfterFreshKpi("user_stop");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return termination.terminateWithError(classifyErrorCause(error), message);
  } finally {
    clock.stop();
    termination.controller.abort();
    await workspace?.cleanup().catch(() => {});
    gate.release();
  }
}
