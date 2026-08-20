import { nanoid } from "nanoid";
import type { LanguageModel, ModelMessage } from "ai";
import {
  SKILLFLOW_PROJECTOR_VERSION,
  supportsMidRunFork,
  type RatingState,
  type RunEvent,
  type RunMode,
  type RunRerunRequest,
  type SessionCapabilities,
  type TestAssertions,
  type TokenProfileRef,
  type ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import type { GradeService } from "../grading/grade-service.js";
import type { RatingIssueService } from "../grading/issue-service.js";
import { alignTrace } from "../skillflow/aligner.js";
import { evaluateAssertions, type SkillAlignment } from "../skillflow/assertions.js";
import { projectSkillGraph } from "../skillflow/projector.js";
import { traceFromRun } from "../skillflow/run-trace.js";
import type { McpSession } from "../mcp/client.js";
import { openSession } from "../mcp/client.js";
import type { DiscoveryOptions } from "../mcp/client.js";
import { isAuthRequiredError, isOAuthHttpServer } from "../mcp/auth-error.js";
import type { OAuthService } from "../oauth/service.js";
import type { ProviderRepository } from "../providers/repository.js";
import type { SupportedModelIdSource } from "../providers/subscription-models.js";
import {
  deferredToolSearchTool,
  isHaikuModel,
  modelFor,
  providerOptions,
  supportsToolSearch,
  TOOL_SEARCH_TOOL_KEY,
  type DecryptedCredential,
} from "../providers/registry.js";
import type { InternalServerConfig, ServerRepository } from "../servers/repository.js";
import type { SkillRepository } from "../skills/repository.js";
import type { WatchEngine } from "../watch/engine.js";
import { httpError, toErrorMessage } from "../utils/errors.js";
import { AccountingSink } from "./accounting.js";
import {
  runAgentLoop,
  type AccountingHooks,
  type EngineConfig,
  type InteractiveTurns,
  type LoopResult,
} from "./engine.js";
import { ENGINE_SESSION_CAPABILITIES, capabilitiesForProviderKind } from "./session-capabilities.js";
import { reconstructForkPrefix } from "./fork.js";
import { SessionClock } from "./session-clock.js";
import {
  runClaudeSubscription,
  runClaudeSubscriptionInteractive,
  type ClaudeSubscriptionRunConfig,
} from "./claude-subscription-executor.js";
import type { SubscriptionConcurrencyPool } from "./subscription-concurrency.js";
import { buildSubscriptionToolWiring, type SubscriptionServerInput } from "./subscription-tools.js";
import type { SkillFileBytesReader } from "./subscription-skill-tools.js";
import {
  ASK_USER_MCP_KEY,
  type AskUserBridge,
  askUserToolPattern,
  buildAskUserAiTool,
  buildAskUserSdkServer,
} from "./ask-user-tool.js";
import type { AgentSessionDriver } from "../assistant/session-driver.js";
import type { AssistantAuthSource } from "../assistant/spawn-env.js";
import { RunManager, isTerminalStatus, type RunEmitMeta } from "./run-manager.js";
import type { RunRepository } from "./run-repository.js";
import { resolveProfiles, resolveSystemPrompt } from "./resolution.js";
import { assertSkillOverridesResolvable, type SkillOverrides } from "./scenario-service.js";
import type { ScenarioService } from "./scenario-service.js";
import type { TestService } from "./test-service.js";
import {
  buildTools,
  toolIoDetail,
  type AllowedTool,
  type StepSink,
  type ToolCallOutcome,
} from "./tool-bridge.js";
import {
  buildAvailableSkillsBlock,
  buildSkillDisclosureTools,
  type ResolvedSkill,
  type SkillFileReader,
} from "./skill-context.js";

/** A model factory, injectable so tests can supply a mock model without a real provider key. */
export type ModelFactory = (cred: DecryptedCredential, model: string) => LanguageModel;

/**
 * The subscription auth-resolver seam (planning/Roadmap/RM-09-claude-subscription/, WP 1.2, D-CS7). Resolves the
 * DECRYPTED signed-in Claude subscription as a spawn-env {@link AssistantAuthSource}, or `null` when
 * no subscription is signed in. Production wires `AssistantAuthService.resolveJudgeAuth`, which is
 * subscription-only and NEVER consults the API-key fallback — so a subscription RUN can only ever run
 * on the signed-in subscription (never a silent key fallback). A `null` result routes to the
 * executor's honest `auth` degradation (never a fabricated result). Distinct from the provider-repo
 * {@link import("../providers/subscription-auth.js").SubscriptionAuthResolver} (which throws) — this
 * one returns `null` to match the executor's `resolveAuth` contract.
 */
export type ClaudeSubscriptionAuthResolver = () => AssistantAuthSource | null;

/**
 * An MCP session opener, injectable so tests can supply a stub session without a child process or a
 * network call. Production defaults to {@link openSession} (WP 1.2). Mirrors that signature.
 */
export type SessionOpener = (
  config: InternalServerConfig,
  options?: DiscoveryOptions,
) => Promise<McpSession>;

/** The default measurement sink: forwards each MCP tool call as a `step` RunEvent (WP 1.4 wraps). */
export function createDefaultStepSink(runManager: RunManager, runId: string): StepSink {
  let index = 0;
  return {
    toolCall(outcome: ToolCallOutcome): void {
      // The engine already emits the model-visible tool-call/result steps from the stream. This sink
      // adds the MCP-side timing/error view (the seam WP 1.4 replaces with real token accounting).
      // No accounting here, so no result-token size is known (0 under the default profile) and no
      // byte size is measured.
      runManager.emit(runId, mcpStepEvent(runId, index++, outcome, "generic_o200k", 0, undefined));
    },
  };
}

/**
 * WP 1.4 real tool-side sink: feeds each settled MCP `tools/call` to the {@link AccountingSink} (so the
 * injected tool-result tokens land in the next context snapshot + the run toolCall KPI) and still emits
 * the MCP-side timing/error `step` RunEvent. This is the seam WP 1.3 stubbed with `createDefaultStepSink`.
 */
export function createAccountingStepSink(
  runManager: RunManager,
  runId: string,
  accounting: AccountingSink,
): StepSink {
  let index = 0;
  const primaryProfile = accounting.primaryProfile;
  return {
    async toolCall(outcome: ToolCallOutcome): Promise<void> {
      // Tool output is untrusted opaque data — counted for the context window, never echoed as a secret.
      // WP 5.6: capture the result size (primary lens) + latency so the session-compatibility tests can
      // read them off the persisted `tool_call` step.
      const resultPayload = outcome.result ?? { isError: outcome.isError };
      const resultTokens = await accounting.recordToolResult(resultPayload, {
        toolName: outcome.toolName,
        durationMs: outcome.durationMs,
      });
      const stepIndex = index++;
      runManager.emit(
        runId,
        mcpStepEvent(
          runId,
          stepIndex,
          outcome,
          primaryProfile,
          resultTokens,
          resultBytesOf(resultPayload),
        ),
      );
      // Observability (WP3.1, D-OB17) — emit an ADDITIVE `tool_io` CHILD step carrying the MCP roundtrip
      // detail (request/response byte sizes + timing) UNDER the tool-call step just emitted. This is a
      // localized additive emission at the choke point: the child is emitted right after its parent, so
      // it takes the NEXT monotonic idx (no reordering), and its `parentStepId` is the parent's EMITTED id
      // (`${runId}:mcp:${stepIndex}`) — the persistence layer resolves it to the parent's persisted row id
      // through the same emitted→persisted map the live path uses. ENGINE PATH ONLY by construction: this
      // sink is only wired by the engine executor (the subscription child owns its MCP internally; it has
      // no tools). Skill-DISCLOSURE reads flow the SAME sink but are NOT MCP roundtrips (D-OB17 scope) —
      // excluded by their `skill://` serverId so a skill read never grows a spurious `tool_io` child.
      if (!outcome.serverId.startsWith("skill://")) {
        runManager.emit(runId, mcpToolIoStepEvent(runId, stepIndex, outcome));
      }
    },
  };
}

/** UTF-8 byte size of a tool result payload (drives the byte-cap SESSION_TOOL_RESULT_SIZE). */
function resultBytesOf(result: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(result) ?? "", "utf8");
  } catch {
    return undefined; // non-serializable result → no byte measure (window-share budget still applies)
  }
}

function mcpStepEvent(
  runId: string,
  index: number,
  outcome: ToolCallOutcome,
  primaryProfile: TokenProfileRef,
  resultTokens: number,
  resultBytes: number | undefined,
): RunEvent {
  return {
    type: "step",
    step: {
      id: `${runId}:mcp:${index}`,
      runId,
      index,
      type: "tool_call",
      label: outcome.toolName,
      status: outcome.transportError ? "error" : outcome.isError ? "error" : "ok",
      durationMs: outcome.durationMs,
      // Track E — real wall-clock around the MCP `tools/call` (from the tool bridge); drives the Gantt.
      startedAt: outcome.startedAt,
      endedAt: outcome.endedAt,
      serverId: outcome.serverId,
      toolName: outcome.toolName,
      // WP 5.6 — the tool result's token size under the primary lens (drives SESSION_TOOL_RESULT_SIZE).
      profileTokens: { [primaryProfile]: resultTokens },
      // Byte size of the same result — drives the byte-denominated cap (e.g. OpenAI's 512KB).
      ...(resultBytes !== undefined ? { resultBytes } : {}),
      // Args/result are stored as opaque data only; never echoed as a secret, never executed.
      // F5 — carry the AI SDK `toolCallId` (when the SDK provided it) so the UI can correlate this
      // MCP-side step with the engine's stream tool_call/tool_result steps and de-dup the duplicate
      // tool_call into one logical call. serverId/durationMs/result-token-size are preserved exactly
      // (WP 5.6 session-compatibility tests read them off the persisted step).
      payload: {
        ...(outcome.transportError
          ? { transportError: outcome.transportError }
          : { isError: outcome.isError }),
        ...(outcome.toolCallId ? { toolCallId: outcome.toolCallId } : {}),
      },
    },
  };
}

/**
 * Observability (WP3.1, D-OB17) — the additive `tool_io` CHILD `step` RunEvent nested under the MCP
 * tool-call step at `${runId}:mcp:${stepIndex}`. Carries the MCP roundtrip detail (request/response byte
 * sizes + timing) derived by {@link toolIoDetail}. `parentStepId` is the parent's EMITTED id, resolved to
 * its persisted row id by the persistence layer's emitted→persisted map (see `RunRepository.appendStep`);
 * `type` stays an existing union member (`context_event`) — only `spanKind` is new. Emitted right after
 * its parent, so it takes the next monotonic `idx` — a tree link, never a reordering.
 */
function mcpToolIoStepEvent(runId: string, stepIndex: number, outcome: ToolCallOutcome): RunEvent {
  const io = toolIoDetail(outcome);
  return {
    type: "step",
    step: {
      id: `${runId}:mcp:${stepIndex}:io`,
      runId,
      index: stepIndex, // re-stamped by the RunManager choke point; value here is only a placeholder
      type: "context_event",
      label: `${outcome.toolName} · MCP I/O`,
      status: outcome.transportError || outcome.isError ? "error" : "ok",
      spanKind: "tool_io",
      parentStepId: `${runId}:mcp:${stepIndex}`,
      serverId: outcome.serverId,
      toolName: outcome.toolName,
      durationMs: io.durationMs,
      // Track E — the real wall-clock of the MCP roundtrip (mirrors the parent's), so a timeline can
      // place the child precisely under its call.
      startedAt: io.startedAt,
      endedAt: io.endedAt,
      profileTokens: {},
      // Request/response byte sizes + timing + serverId/toolName — no secret-shaped content, redacted
      // like every persisted payload on the way to SQLite.
      payload: io,
    },
  };
}

/** A started run handle. `done` resolves when the loop reaches a terminal state. */
export type RunHandle = {
  runId: string;
  mode: RunMode;
  done: Promise<LoopResult>;
};

/**
 * Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — the ADDITIVE seed a FORK carries into the
 * EXISTING run-start path. It is the only new thing threaded through `start`/`execute`/the three resolve
 * methods; a NON-fork run passes `undefined` and every path is byte-identical to before. Skill-version
 * overrides ride the pre-existing {@link SkillOverrides} `start` param, NOT this object.
 *
 * `messagePrefix` is the reconstructed parent-conversation prefix (pure `fork.ts`) — present ONLY for a
 * MID-RUN fork (a `forkStepId`) on the AI-SDK engine path (the only backend whose manifest supports
 * seeding one; the rerun endpoint 422s a mid-run fork of any other kind). A WHOLE-run re-launch carries
 * no prefix. `promptOverride`/`modelOverride`/`temperatureOverride` are the edited launch params applied
 * WITHOUT mutating the parent's scenario/test rows (each absent → the parent value).
 */
export type ForkSeed = {
  derivedFromRunId: string;
  forkStepId?: string;
  messagePrefix?: ModelMessage[];
  promptOverride?: string;
  modelOverride?: string;
  temperatureOverride?: number;
};

/**
 * Per-run control state (WP 2.2). The {@link AbortController} is threaded to the engine's
 * `streamText` so {@link RunService.stop} cancels the live provider call; the interactive turn queue
 * bridges `POST /api/runs/:id/turns` into the engine's `nextTurn` await. Process-local by design.
 */
type RunControl = {
  mode: RunMode;
  abort: AbortController;
  /** A pending `nextTurn()` resolver while the run is awaiting interactive input (else undefined). */
  pendingTurn?: (text: string | null) => void;
  /** Queued turns posted before the engine asked for the next one (resume immediately). */
  queued: string[];
  /**
   * In-flight `ask_user` questions keyed by `questionId` → the resolver that unblocks the tool's
   * `execute` (an operator answer string, or `null` when the run is stopped/aborted first). The model
   * can have at most a handful open at once (one per unfinished `ask_user` call). Resolved by
   * {@link RunService.answerQuestion} or by the abort listener registered in {@link askUserBridge}.
   */
  pendingQuestions: Map<string, (answer: string | null) => void>;
  /** True once a terminal status is reached (stop/turn are then no-ops / 409). */
  finished: boolean;
};

/**
 * Orchestrates one run: resolve the effective config (scenario ∪ test), open one {@link McpSession}
 * per allow-listed server, build the allow-list-filtered tools, drive the loop, and ALWAYS close the
 * sessions in a `finally`. Sessions, the provider model, and secret decryption live entirely here —
 * inside the API runtime boundary.
 *
 * Modes: **automated** runs to completion. **interactive** (WP 2.2) runs the opener turn, then
 * awaits each follow-up turn posted via `POST /api/runs/:id/turns` (bridged through the per-run
 * {@link RunControl} turn queue) and resumes the loop, until the model stops with no more turns or
 * the run is stopped. `POST /api/runs/:id/stop` aborts the live provider call + closes the sessions.
 */
export class RunService {
  /** Per-run abort + interactive-turn control (process-local; cleaned up when the run settles). */
  private readonly controls = new Map<string, RunControl>();

  constructor(
    private readonly scenarios: ScenarioService,
    private readonly tests: TestService,
    private readonly providers: ProviderRepository,
    private readonly servers: ServerRepository,
    private readonly oauth: OAuthService,
    private readonly runManager: RunManager,
    private readonly runs: RunRepository,
    private readonly modelFactory: ModelFactory = modelFor,
    private readonly sessionOpener: SessionOpener = openSession,
    /**
     * Skill registry (WP 2.2) — backs the read-only `read_skill_file` / `list_skill_files` disclosure
     * tools with the resolved skill versions' files. Optional so existing callers/tests that don't
     * exercise skills keep working; when absent, no disclosure tools are registered.
     */
    private readonly skills?: SkillRepository,
    /**
     * Benchmarks output-quality grading (WP 1.2). Optional so existing callers/tests that don't pass it
     * keep working with NO grading (the rating axis then settles `skipped`). When present, a settled
     * run is graded post-completion via a fully-guarded hook (never blocks/mutates the run — see
     * {@link reviewRun}).
     */
    private readonly grades?: GradeService,
    /**
     * Rating Issues registry (Auto-Rating follow-on). Optional so existing callers/tests keep working
     * with zero behavior change. When present, the settled run's `error_forensics` findings are folded
     * into the persistent per-skill / per-server issue registry immediately AFTER the grade call in
     * {@link reviewRun} — fully guarded, never blocks/mutates the run or its grades (see
     * {@link processRunIssues}).
     */
    private readonly issues?: RatingIssueService,
    /**
     * Claude subscription run driver (planning/Roadmap/RM-09-claude-subscription/, WP 1.2). The raw Agent-SDK
     * {@link AgentSessionDriver} the `claude_subscription` executor drives — production wires a
     * `new SdkAgentSessionDriver()` (the SAME driver kind the Auto-Rating CLI judge uses); tests inject
     * a scripted fake so the suite spawns NO real child. Optional so every existing caller/test
     * constructs {@link RunService} unchanged; when ABSENT, a `claude_subscription` run fails HONESTLY
     * ("not configured") rather than a fake result (see {@link resolveClaudeSubscription}).
     */
    private readonly subscriptionDriver?: AgentSessionDriver,
    /**
     * Claude subscription auth resolver (WP 1.2, D-CS7). Resolves the signed-in subscription's decrypted
     * auth source, or `null` when not signed in. Production wires `AssistantAuthService.resolveJudgeAuth`
     * (subscription-only — the API-key fallback is NEVER consulted for a run). Optional; when absent it
     * defaults to `() => null`, so a subscription run degrades to the executor's honest `auth` error.
     */
    private readonly subscriptionAuth?: ClaudeSubscriptionAuthResolver,
    /**
     * Claude subscription concurrency pool (planning/Roadmap/RM-09-claude-subscription/, WP 2.1, D-CS2/D-CS10). Its
     * `.shared` gate is the SINGLE runs+judge budget threaded onto every subscription run's
     * {@link ClaudeSubscriptionRunConfig.concurrency} — the SAME instance the Auto-Rating CLI judge
     * acquires, so the TOTAL of (in-flight subscription runs + in-flight CLI judges) never exceeds the
     * bound (a suite of runs + their ratings can't put 2N ~1 GiB children in flight). Its per-provider
     * gate ({@link SubscriptionConcurrencyPool.providerGate}) additionally caps how many run children a
     * single provider's suite matrix can have admitted at once (D-CS2), acquired in {@link execute}
     * OUTSIDE the executor's shared gate (consistent ordering provider→shared → no deadlock). Production
     * wires the ONE process-wide pool from `index.ts`; optional so existing callers/tests construct
     * {@link RunService} unchanged (absent → the executor's module-default gate + no per-provider cap).
     */
    private readonly subscriptionConcurrency?: SubscriptionConcurrencyPool,
    /**
     * Claude subscription LIVE model roster (planning/Roadmap/RM-09-claude-subscription/ follow-up). The SAME cached
     * resolver the provider dropdown + assistant dock use, consumed here as a
     * {@link SupportedModelIdSource} so {@link resolveClaudeSubscription} can reject a run whose selected
     * model the signed-in subscription does NOT offer — reading the CACHE only (NO hot-path spawn). When
     * the live list is unavailable (cache cold/stale, or the last probe fell back) strict validation is
     * skipped, so a transient list failure never blocks a run. Optional; absent (existing callers/tests)
     * → no strict validation at all (the pre-existing behavior).
     */
    private readonly subscriptionModels?: SupportedModelIdSource,
    /**
     * Observability watch rules (planning/Roadmap/RM-17-observability/, WP4.1, D-OB19/D-OB21). The POST-HOC OBSERVER
     * evaluated at the SAME post-terminal choke point auto-rating uses ({@link reviewRun}), AFTER the
     * run is terminal AND its rating axis has settled. Optional so every existing caller/test constructs
     * {@link RunService} unchanged (absent → watch rules simply never fire). It can NEVER mutate run
     * lifecycle/totals/grades or fail the run — {@link WatchEngine.onRunSettled} is fully guarded (never
     * throws) and is invoked as the LAST step of {@link reviewRun}, so the run's terminal status/outcome
     * were already emitted + finalized long before it runs. There is NO executor-loop edit for this —
     * the hook is the single {@link reviewRun} call, not any of the three executors.
     */
    private readonly watch?: WatchEngine,
  ) {}

  /**
   * Start a run. Returns immediately with a handle; the loop runs asynchronously and emits through
   * the {@link RunManager}. `done` resolves with the terminal {@link LoopResult}.
   *
   * The `runs` row is created here (status:"running") BEFORE the manager fan-out starts so the
   * persistence sink ({@link RunRepository}) has a parent row for the incremental step/event writes —
   * a crash mid-run therefore still leaves a partial, openable record (decision #8).
   *
   * WP 5.1 (skill-effect variants) — an optional {@link SkillOverrides} tweaks THIS run's resolved skill
   * attachments (a suite variant's ± skill/version), threaded to {@link resolveAllowedSkills}. It is
   * VALIDATED here, BEFORE the row/manager exist, so a variant referencing a deleted skill fails fast
   * with a typed error (never a half-created run). Standalone runs pass no overrides — unchanged.
   */
  start(
    testId: string,
    scenarioId: string,
    mode: RunMode,
    skillOverrides?: SkillOverrides,
    forkSeed?: ForkSeed,
  ): RunHandle {
    // Fail fast on a variant referencing a deleted skill/version — before any row/manager state exists.
    if (skillOverrides && this.skills) assertSkillOverridesResolvable(this.skills, skillOverrides);
    const runId = nanoid();
    // WP3.3 (D-OB18) — stamp fork lineage ATOMICALLY at INSERT (never a later UPDATE), so a derived run
    // is hidden from the feed + absent from suite aggregates from the instant it exists.
    this.runs.createRun(runId, {
      testId,
      scenarioId,
      mode,
      ...(forkSeed
        ? {
            derivedFromRunId: forkSeed.derivedFromRunId,
            ...(forkSeed.forkStepId ? { forkStepId: forkSeed.forkStepId } : {}),
          }
        : {}),
    });
    this.runManager.create(runId);
    const control: RunControl = {
      mode,
      abort: new AbortController(),
      queued: [],
      pendingQuestions: new Map(),
      finished: false,
    };
    this.controls.set(runId, control);
    // The post-terminal REVIEW phase (WP 5.1 assertions → Auto-Rating AR5 grading → issue folding),
    // chained onto the returned `done` (never inside `execute`) so it runs once the row is finalized.
    // AR11 — the whole phase is wrapped in the additive rating axis (`rating` → a GUARANTEED settled
    // `rated`/`failed`/`skipped`, persisted + emitted even when a hook throws) and can never affect
    // run completion — the engine's terminal status/outcome were already emitted before this runs.
    const done = this.execute(runId, testId, scenarioId, control, skillOverrides, forkSeed).then(
      async (result) => {
        await this.reviewRun(runId, testId, result);
        return result;
      },
    );
    return { runId, mode, done };
  }

  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — the bench-native "Open in Playground": FORK
   * a TERMINAL run into a NEW, fully-persisted, gradeable, comparable run. This is an ADDITIVE path — it
   * VALIDATES, RECONSTRUCTS the parent's conversation prefix (pure {@link reconstructForkPrefix}), then
   * SEEDS a new run through the SAME {@link start} path with that prefix + the overrides. It never touches
   * how existing runs execute and never restructures an executor loop.
   *
   * VALIDATION (all before any row exists):
   *  1. The source run must be TERMINAL (a live run can't be forked) → 409.
   *  2. The source run must NOT be a suite member (D-OB18: a matrix member is never forkable) → 409.
   *  3. A MID-RUN fork (`fromStepId` present) is CAPABILITY-gated ({@link supportsMidRunFork} over the
   *     run's session manifest — D-US4, NOT `providerKind === …`): a kind whose transcript can't seed a
   *     reconstructed chat-completions prefix (`claude_subscription`) is refused → 422.
   *     A WHOLE-run re-launch (no `fromStepId`) works for EVERY kind.
   *  4. A `skillVersionId` override is resolved to its owning skill (→ a {@link SkillOverrides} pin);
   *     an unknown version → 422. `prompt`/`model`/`temperature` are shape-validated by the route schema;
   *     the model resolves for the SAME provider kind by construction (the fork reuses the parent
   *     environment's provider).
   *
   * The derived run is stamped with `derived_from_run_id` (+ `fork_step_id`) at INSERT, runs under the
   * unified-sessions clock/terminal contract, and is rated by the SAME post-terminal review as any run.
   */
  rerun(parentRunId: string, request: RunRerunRequest): RunHandle {
    const parent = this.runs.getRun(parentRunId); // 404s if unknown
    if (!isTerminalStatus(parent.status)) {
      throw httpError(409, "Only a finished run can be forked — stop or wait for the run first");
    }
    if (parent.suiteRunId !== undefined) {
      throw httpError(409, "A suite-run member cannot be forked (it must stay in its suite's matrix)");
    }

    const overrides = request.overrides ?? {};
    // Capability gate for a mid-run fork (read the manifest, not the kind — D-US4). Prefer the run's
    // persisted `capabilities`; fall back to the kind's static manifest for a pre-contract run.
    if (request.fromStepId !== undefined) {
      const capabilities = this.capabilitiesForRun(parentRunId);
      if (!supportsMidRunFork(capabilities)) {
        throw httpError(
          422,
          "This run's backend does not support forking at a step (only a whole-run re-run). Re-run with changes instead.",
        );
      }
    }

    // A `skillVersionId` override pins the environment's attached skill to that exact version. Resolve
    // its owning skill up front (a stale version id → 422); `start` re-validates via
    // `assertSkillOverridesResolvable`.
    let skillOverrides: SkillOverrides | undefined;
    if (overrides.skillVersionId !== undefined) {
      if (!this.skills) {
        throw httpError(422, "A skill-version override needs a skill registry, which is not configured");
      }
      let versionSkillId: string;
      try {
        versionSkillId = this.skills.getVersion(overrides.skillVersionId).skillId;
      } catch {
        throw httpError(422, `Skill version "${overrides.skillVersionId}" no longer exists`);
      }
      skillOverrides = {
        attach: [{ skillId: versionSkillId, versionId: overrides.skillVersionId }],
      };
    }

    // Reconstruct the parent-conversation prefix for a MID-RUN fork (pure; byte-exact against the parent's
    // steps ≤ the fork step). A WHOLE-run re-launch carries no prefix. `reconstructForkPrefix` 422s a
    // `fromStepId` that isn't a step of this run.
    const messagePrefix =
      request.fromStepId !== undefined
        ? reconstructForkPrefix(parent.steps, request.fromStepId).messages
        : undefined;

    const forkSeed: ForkSeed = {
      derivedFromRunId: parentRunId,
      ...(request.fromStepId !== undefined ? { forkStepId: request.fromStepId } : {}),
      ...(messagePrefix !== undefined ? { messagePrefix } : {}),
      ...(overrides.prompt !== undefined ? { promptOverride: overrides.prompt } : {}),
      ...(overrides.model !== undefined ? { modelOverride: overrides.model } : {}),
      ...(overrides.temperature !== undefined
        ? { temperatureOverride: overrides.temperature }
        : {}),
    };

    // A fork always runs AUTOMATED (a re-execution with edits, driven to completion so it grades +
    // compares like any bench run), regardless of the parent's mode.
    return this.start(parent.testId, parent.scenarioId, "automated", skillOverrides, forkSeed);
  }

  /**
   * WP3.3 — the run's session capability manifest for the fork gate: its persisted `capabilities` when
   * present, else the static per-kind manifest derived from the environment's provider (D-US4 — the ONE
   * manifest source, never a `providerKind === …` branch here). `undefined` when neither resolves (a
   * fully-orphaned run) → a mid-run fork is then conservatively refused.
   */
  private capabilitiesForRun(runId: string): SessionCapabilities | undefined {
    const summary = this.runs.getSummary(runId);
    if (summary.capabilities) return summary.capabilities;
    try {
      const scenario = this.scenarios.get(summary.scenarioId);
      return capabilitiesForProviderKind(this.providers.get(scenario.providerId).kind);
    } catch {
      return undefined;
    }
  }

  /** True while the run is live (registered with the manager and not yet settled). */
  isActive(runId: string): boolean {
    return this.runManager.isActive(runId);
  }

  /**
   * Subscribe to a live run's {@link RunEvent}s (WP 2.2 SSE). The manager replays its bounded buffer
   * in order first, then forwards live events; returns an unsubscribe to detach on disconnect. Thin
   * delegate so the route never reaches into the manager directly.
   */
  subscribeEvents(runId: string, listener: (event: RunEvent) => void): () => void {
    return this.runManager.subscribe(runId, listener);
  }

  /** True when an interactive run is currently blocked awaiting the next user turn. */
  isAwaitingInput(runId: string): boolean {
    return this.controls.get(runId)?.pendingTurn !== undefined;
  }

  /**
   * Interactive turn (WP 2.2). Resumes the loop with the posted user message. Valid only on a live
   * interactive run; an automated or finished run throws 409 (a typed conflict). If the engine is
   * currently awaiting input, the turn resolves it immediately; if it's still streaming the previous
   * turn, the turn is QUEUED and consumed the moment the engine asks for the next one (so a turn
   * posted a beat early is never lost), preserving order.
   */
  submitTurn(runId: string, text: string): void {
    const control = this.controls.get(runId);
    if (!control || control.finished || control.mode !== "interactive") {
      throw httpError(409, "Run is not accepting interactive turns");
    }
    if (control.abort.signal.aborted) {
      throw httpError(409, "Run is stopping");
    }
    if (control.pendingTurn) {
      const resolve = control.pendingTurn;
      control.pendingTurn = undefined;
      resolve(text);
      return;
    }
    // The engine hasn't asked for the next turn yet (still streaming the previous one) — queue it so
    // `nextTurnProvider` consumes it as soon as the model stops, instead of dropping the turn.
    control.queued.push(text);
  }

  /**
   * Answer a live `ask_user` question (`POST /api/runs/:id/answers`) — the model-initiated counterpart
   * of {@link submitTurn}. Resolves the pending question's promise so the paused tool `execute` returns
   * the answer and the run resumes. Valid only on a live INTERACTIVE run with a matching open question;
   * an automated/finished/stopping run, or an unknown/already-answered `questionId`, throws a typed 409
   * (never silently drops the answer — a stale double-submit gets a clear conflict).
   */
  answerQuestion(runId: string, questionId: string, answer: string): void {
    const control = this.controls.get(runId);
    if (!control || control.finished || control.mode !== "interactive") {
      throw httpError(409, "Run is not accepting answers");
    }
    if (control.abort.signal.aborted) {
      throw httpError(409, "Run is stopping");
    }
    const resolve = control.pendingQuestions.get(questionId);
    if (!resolve) {
      throw httpError(409, "No pending question with that id");
    }
    control.pendingQuestions.delete(questionId);
    resolve(answer);
  }

  /**
   * Stop a run (WP 2.2). Aborts the live provider call (the engine ends with `outcome:"aborted"` and
   * the sessions close in the `execute` finally). If the run is awaiting an interactive turn, unblock
   * it with `null` so the loop falls through to the aborted terminal. Idempotent / safe after finish.
   */
  stop(runId: string): void {
    const control = this.controls.get(runId);
    if (!control || control.finished) {
      throw httpError(404, "Run is not active");
    }
    control.abort.abort();
    if (control.pendingTurn) {
      const resolve = control.pendingTurn;
      control.pendingTurn = undefined;
      resolve(null);
    }
  }

  /**
   * F3 — stop an active run AND detach it from the manager so a following DB delete can't be raced by
   * a late terminal event. Aborts the provider/MCP loop (stops spending), unblocks any interactive
   * wait, and drops the {@link RunManager} entry (further emits + persistence become no-ops). The
   * MCP/provider sessions still close in {@link execute}'s `finally`. No-op if the run isn't active.
   * Used by `DELETE /api/runs/:id` so deleting an in-flight run doesn't leave the loop spending.
   */
  detachActiveRun(runId: string): void {
    const control = this.controls.get(runId);
    if (control && !control.finished) {
      control.abort.abort();
      if (control.pendingTurn) {
        const resolve = control.pendingTurn;
        control.pendingTurn = undefined;
        resolve(null);
      }
    }
    this.runManager.detach(runId);
  }

  private async execute(
    runId: string,
    testId: string,
    scenarioId: string,
    control: RunControl,
    skillOverrides?: SkillOverrides,
    forkSeed?: ForkSeed,
  ): Promise<LoopResult> {
    const sessions = new Map<string, McpSession>();
    try {
      // WP 1.2 (claude-subscription) — the owner's signed-in Claude SUBSCRIPTION driven as a run model.
      // A `claude_subscription` credential has no AI-SDK `LanguageModel` (the Agent SDK never exposes
      // one), so it runs its OWN executor over the raw Agent-SDK driver. Resolved LIGHTWEIGHT +
      // dispatched HERE, BEFORE `resolve()`: a `getDecrypted` on this path would THROW
      // `brokenSubscriptionAuthError` for a not-signed-in subscription, which would mask the executor's
      // honest `auth` degradation, so the subscription kind must be recognized first (its resolver reads
      // the kind via the REDACTED `providers.get`, which never resolves auth / throws). This is NOT
      // structurally clean-session — MCP tools (WP 1.3) AND attached skills (WP 1.4, materialized
      // read-only into the run's throwaway workspace) both work on this path. Every non-
      // `claude_subscription` kind falls through (`resolveClaudeSubscription` returns `undefined`),
      // leaving the agent-loop path unchanged.
      const subscription = this.resolveClaudeSubscription(
        runId,
        testId,
        scenarioId,
        control,
        skillOverrides,
        forkSeed,
      );
      if (subscription) {
        const emit = (event: RunEvent) => this.runManager.emit(runId, event);
        // WP 2.1 (D-CS2) — per-provider cap: bound how many of THIS provider's ~1 GiB subscription run
        // children are admitted at once. Acquired OUTSIDE the executor's SHARED runs+judge gate
        // (consistent ordering provider→shared → no deadlock; a judge never takes a provider slot). The
        // release is idempotent + ALWAYS runs, even if the executor throws.
        const releaseProviderSlot = await this.acquireSubscriptionProviderSlot(scenarioId);
        try {
          return control.mode === "interactive"
            ? await runClaudeSubscriptionInteractive(
                runId,
                subscription,
                this.nextTurnProvider(control),
                emit,
              )
            : await runClaudeSubscription(runId, subscription, emit);
        } finally {
          releaseProviderSlot();
        }
      }
      const cfg = await this.resolve(
        runId,
        testId,
        scenarioId,
        control,
        sessions,
        skillOverrides,
        forkSeed,
      );
      // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3) — thread the engine's optional SessionClock
      // duration `meta` through to the RunManager choke point verbatim (see `RunEmitMeta`); an engine
      // event that carries none (every non-terminal emit) leaves `meta` `undefined`, unchanged from before.
      return await runAgentLoop(runId, cfg, (event, meta) =>
        this.runManager.emit(runId, event, meta),
      );
    } catch (error) {
      const message = toErrorMessage(error);
      // A failure while opening MCP sessions (or anywhere in resolve) can be an expired OAuth token —
      // flag it (+ the in-scope oauth servers) so the console can offer reauth + restart. Only set
      // `authRequired` when there's actually an oauth server that reauth could fix.
      const serverIds = isAuthRequiredError(error) ? this.oauthServerIdsFor(scenarioId) : [];
      const authFields = serverIds.length > 0 ? { authRequired: true, serverIds } : {};
      this.runManager.emit(runId, { type: "error", message, ...authFields });
      this.runManager.emit(runId, {
        type: "status",
        status: "error",
        outcome: "error",
        stopReason: message,
      });
      return {
        status: "error",
        outcome: "error",
        stopReason: message,
        turns: 0,
        toolCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
    } finally {
      control.finished = true;
      this.controls.delete(runId);
      // ALWAYS tear down MCP sessions, success or failure (no child-process / connection leak).
      await Promise.all([...sessions.values()].map((session) => session.close()));
    }
  }

  /**
   * WP 5.1 — evaluate the run's test assertions from its trace alignment, once the run has SETTLED.
   *
   * Only a `completed` run is evaluated (a stopped/error/aborted run persists NOTHING — its trace is
   * an incomplete conformance picture, so folding assertions would be misleading). A run whose test
   * declared no assertions, or that resolved no skills, is a no-op (nothing persisted — additive,
   * zero behavior change). Otherwise: for each resolved skill, project its recorded version's graph,
   * normalize the run once → align, and hand the alignments to the pure {@link evaluateAssertions}.
   *
   * D4: this READS alignments only — no execution surface. A per-skill projection/align failure (e.g.
   * the recorded version was force-deleted) is swallowed so that skill's assertions surface as
   * `unevaluable`, and the WHOLE method is wrapped so any unexpected crash can never break run
   * completion — it logs + persists a single `unevaluable` marker instead of throwing into the engine.
   *
   * Outcome folding (owner decision 2026-07-03, resolving the WP 5.1 flag): after the results are
   * persisted, a cleanly-completed run (`status = 'completed'` AND `outcome = 'completed'`) with at
   * least one `fail` assertion flips `runs.outcome` to the additive `'assertions_failed'`. An ENGINE
   * outcome (`stopped_guardrail`/`context_overflow`/`error`/`aborted`) is never masked — those never
   * reach here (the `status !== 'completed'` early return drops them) and the repository update
   * re-guards on `outcome = 'completed'`. `unevaluable`/`pass` never trigger the flip, and the flip is
   * isolated so a failure there can neither clobber the just-persisted results nor throw into the engine.
   */
  private async evaluateRunAssertions(
    runId: string,
    testId: string,
    result: LoopResult,
  ): Promise<void> {
    try {
      if (result.status !== "completed") return; // evaluate + persist ONLY on a clean completion
      const skills = this.skills;
      if (!skills) return; // no skill registry wired → cannot project graphs (no-op)

      const assertions = this.tests.get(testId).assertions;
      if (!assertions || !hasAnyAssertion(assertions)) return; // no assertions → persist nothing

      const runSkills = this.runs.getRunSkills(runId);
      if (runSkills.length === 0) return; // no resolved skills → nothing to align against

      // Normalize the run's steps to trace events ONCE (the same stream aligns against every skill).
      const events = traceFromRun({ runs: this.runs }, runId);
      const alignments = new Map<string, SkillAlignment>();
      for (const row of runSkills) {
        try {
          const versionId = row.skill_version_id;
          const graph = projectSkillGraph(
            loadSkillMd(skills, versionId),
            skills.listFiles(versionId),
          );
          const alignment = alignTrace(graph, events, {
            projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
          });
          alignments.set(row.skill_id, { versionId, graph, alignment });
        } catch {
          // Version force-deleted / unprojectable → skip; its assertions become `unevaluable` below.
        }
      }

      const results = evaluateAssertions(assertions, alignments);
      this.runs.saveAssertionResults(runId, results);

      // Owner decision 2026-07-03 (WP 5.1 follow-up): a cleanly-completed run with ≥1 FAILED
      // assertion reports outcome 'assertions_failed'. `unevaluable`/`pass` never trigger it; the
      // engine outcome is re-guarded in the repository, and the flip is isolated so an update failure
      // can neither clobber the just-persisted results nor break run completion.
      if (result.outcome === "completed" && results.some((r) => r.status === "fail")) {
        try {
          this.runs.markAssertionsFailedOutcome(runId);
        } catch {
          // Non-fatal: the run already completed and its results are persisted; leave outcome as-is.
        }
      }
    } catch (error) {
      // Crash safety (HARD rule): assertion evaluation must NEVER break run completion. Log + persist a
      // single unevaluable marker so the failure is visible, and swallow the error (never rethrow).
      const message = toErrorMessage(error);
      try {
        this.runs.saveAssertionResults(runId, [
          {
            assertion: { kind: "noFractures" },
            status: "unevaluable",
            reason: `assertion evaluation failed: ${message}`,
          },
        ]);
      } catch {
        // Even persistence failed — nothing more we can safely do; the run itself already completed.
      }
    }
  }

  /**
   * AR11 — the post-terminal REVIEW phase, wrapped in the additive rating axis. Runs strictly AFTER
   * the engine settled (the terminal status/outcome are already emitted + finalized by `execute`):
   *
   *   - No {@link GradeService} wired → auto-rating is not active, so the axis settles `skipped`
   *     (never `rating`/`rated`, which would claim a review that cannot happen). The pre-existing
   *     self-guarded hooks still run unchanged — assertions ({@link evaluateRunAssertions}) and issue
   *     folding ({@link processRunIssues}) never depended on the grade service being wired.
   *   - Otherwise → `rating` is persisted + emitted first, then the chain runs exactly as before
   *     (evaluateRunAssertions → {@link GradeService.gradeRun} → processRunIssues). The grade call is
   *     deliberately NOT re-wrapped in its old silent swallow: a grading crash now lands honestly on
   *     the `failed` rating state — still swallowed HERE (AR5/AR11 hard rule: a rating crash can never
   *     break run completion, mark the run failed, or touch status/outcome/totals), never rethrown.
   *     ({@link GradeService.gradeRun} itself persists a per-grader `error` row for a grader that
   *     throws, so `failed` only captures a catastrophic failure — e.g. the run/test failed to load.)
   *
   * The `finally` GUARANTEES a settled state (`rated`/`failed`/`skipped`) is ALWAYS persisted +
   * emitted — the SSE close semantics and the manager's terminal cleanup both wait for it. Which
   * graders actually run stays a per-grader decision inside the GradeService (mandatory base-rating
   * graders on any terminal status; expectation graders completed-only + expectations-gated), and
   * {@link evaluateRunAssertions} deliberately stays completed-only — this wrapper changes neither.
   *
   * WP 3.3 (planning/Roadmap/RM-09-claude-subscription/) confirmation — this method is called from {@link start}'s
   * `.then` chain UNCONDITIONALLY, for every provider kind (`claude_subscription` included): there is
   * no kind check anywhere in this method, in {@link GradeService.gradeRun}, or in its per-grader
   * `isEligible` gate (mandatory base-rating graders run on ANY terminal run status; expectation
   * graders on any `completed` run with authored `expectations`). So a `claude_subscription` run is
   * rated EXACTLY like an API-keyed run — same axis, same graders, same guarantees (D-CS3). Its LLM
   * grader calls route through the SAME CLI-first judge chain every other run uses (wired once in
   * `index.ts`), whose CLI leg shares the ONE {@link SubscriptionConcurrencyPool.shared} gate with the
   * subscription run executor (D-CS10, WP 2.1) — so a subscription run's OWN post-run rating can never
   * push the total of in-flight ~1 GiB children over the configured bound. The Agent SDK exposes no
   * logprobs, so that judge call always reports `method: "single_sample"` (never a fabricated
   * logprob-weighted score, never a crash) — the SAME honest degradation `judge.ts` already documents
   * for any provider that omits logprobs. See `apps/api/test/claude-subscription-rating.test.ts` for
   * the end-to-end proof (both run through the real `RunService`/`GradeService`/`createOutcomeJudge`/
   * `createClaudeCliJudgeGenerate` wiring, never a real child).
   */
  private async reviewRun(runId: string, testId: string, result: LoopResult): Promise<void> {
    const grades = this.grades;
    if (!grades) {
      await this.evaluateRunAssertions(runId, testId, result);
      await this.processRunIssues(runId);
      this.transitionRating(runId, "skipped");
    } else {
      this.transitionRating(runId, "rating");
      let settled: RatingState = "rated";
      try {
        await this.evaluateRunAssertions(runId, testId, result); // self-guarded — never throws
        await grades.gradeRun(runId);
        await this.processRunIssues(runId); // self-guarded — never throws
      } catch {
        settled = "failed"; // the review chain threw — the run's own result is untouched (AR11)
      } finally {
        this.transitionRating(runId, settled);
      }
    }
    // Observability (WP4.1) — the ONE post-terminal watch-rule hook. Runs AFTER the rating axis has
    // settled above (BOTH the graded and the skipped paths reach here), so a rule sees the fully-rated
    // run. Rules are strictly POST-HOC OBSERVERS: {@link WatchEngine.onRunSettled} is fully guarded
    // (never throws) and can never mutate run lifecycle/totals/grades or fail run completion — the
    // engine's own guarantee, re-affirmed here. NO executor loop is touched; this is the single hook.
    await this.evaluateWatchRules(runId);
  }

  /**
   * Observability (WP4.1) — fire the enabled `on_terminal` watch rules for the just-settled run. A
   * no-op when no {@link WatchEngine} is wired (existing callers/tests). Guarded defense-in-depth on
   * top of the engine's own guard: a watch-rule outcome must NEVER affect run completion (rules are
   * observers). The run is already terminal + rated, so awaiting this cannot change run state; the one
   * outbound cost (a webhook) is bounded by a timeout inside the engine.
   */
  private async evaluateWatchRules(runId: string): Promise<void> {
    try {
      if (!this.watch) return; // no watch engine wired → no-op (zero behavior change)
      await this.watch.onRunSettled(runId);
    } catch {
      // Crash safety (HARD rule): watch-rule evaluation must NEVER break run completion.
    }
  }

  /**
   * Persist + emit one rating-axis transition (AR11). The persistence write is guarded (a run deleted
   * mid-review updates 0 rows; nothing here may throw into the settled done-chain), and the emit goes
   * through the SAME {@link RunManager} channel as `status` events — so the live SSE stream, the
   * bounded replay buffer, AND the run_events persistence sink all carry the rating transitions (a
   * replayed finished-run stream converges on the same review states the live stream showed).
   */
  private transitionRating(runId: string, state: RatingState): void {
    try {
      this.runs.setRatingState(runId, state);
    } catch {
      // Never let a persistence hiccup break the settled done-chain — the emit below still fires.
    }
    this.runManager.emit(runId, { type: "rating", state });
  }

  /**
   * Rating Issues registry hook — folds the run's freshly-persisted `error_forensics` findings into
   * the per-skill / per-server issue registry (create-or-enhance via the CLI-first judge chain,
   * deterministic fallback). Chained immediately AFTER the grade call in {@link reviewRun}. No-op
   * when no {@link RatingIssueService} is wired (zero behavior change), and — like grading — the WHOLE
   * thing is guarded so an issue-processing crash can NEVER affect run completion or grading. The
   * service's own {@link RatingIssueService.processRun} is additionally self-guarded (never throws);
   * this outer catch is defense in depth for a faulty injected service.
   */
  private async processRunIssues(runId: string): Promise<void> {
    try {
      if (!this.issues) return; // no issue service wired → no-op (zero behavior change)
      await this.issues.processRun(runId);
    } catch {
      // Crash safety (HARD rule): issue processing must NEVER break run completion.
    }
  }

  /**
   * The interactive turn provider handed to the engine: resolve the next queued turn immediately, or
   * block until `submitTurn` / `stop` resolves it. A stopped run resolves `null` to end the loop.
   */
  private nextTurnProvider(control: RunControl): InteractiveTurns {
    return {
      nextTurn: () =>
        new Promise<string | null>((resolve) => {
          if (control.abort.signal.aborted) {
            resolve(null);
            return;
          }
          const queued = control.queued.shift();
          if (queued !== undefined) {
            resolve(queued);
            return;
          }
          control.pendingTurn = resolve;
        }),
    };
  }

  /**
   * The per-run seam the built-in `ask_user` tool uses to emit its `question`/`question_resolved`
   * events and BLOCK on the operator's answer. `waitForAnswer` registers the pending resolver in the
   * run's {@link RunControl.pendingQuestions} map (resolved by {@link answerQuestion}) AND races it
   * against the run's abort signal (a stop/delete resolves it `null`, so a paused tool never leaks past
   * a stopped run). The abort listener and {@link answerQuestion} both use the map as the single
   * resolve-once guard (a `delete` that returns `false` means the other side already settled it).
   *
   * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US1/D-US3) — the optional `clockCell` is a
   * mutable box the AI-SDK engine path fills in AFTER this bridge is built (via `EngineConfig.
   * onSessionClockReady` — the bridge has to exist before `tools`, which has to exist before
   * `EngineConfig`, which is where the engine's SessionClock is actually constructed). Reading
   * `clockCell.current`/`clockCell.abortSignal` at CALL TIME (not at bridge-construction time) is what
   * lets the ask_user wait share the identical stall/wait-budget clock a `nextTurn` wait uses — AND
   * what lets a clock fire (stalled / wait_expired / max_duration) while a question is PENDING
   * actually unblock it: `waitForAnswer` races `clockCell.abortSignal` alongside the existing
   * user-stop signal (`control.abort.signal`), since nothing else would ever resolve a wait the clock
   * itself just ended. Omitted by the claude-subscription dispatch (WP1.4's own SessionClock coupling,
   * not this WP's concern) — the bridge then simply doesn't implement `enterWaiting`/
   * `resumeFromWaiting` (optional on {@link AskUserBridge}) and never races `clockAbortSignal`, so
   * `runAsk` skips the bracketing, unchanged from before this WP.
   */
  private askUserBridge(
    runId: string,
    control: RunControl,
    clockCell?: { current?: SessionClock; abortSignal?: AbortSignal },
  ): AskUserBridge {
    return {
      emit: (event) => this.runManager.emit(runId, event),
      newQuestionId: () => nanoid(),
      waitForAnswer: (questionId) =>
        new Promise<string | null>((resolve) => {
          const clockAbortSignal = clockCell?.abortSignal;
          if (control.abort.signal.aborted || clockAbortSignal?.aborted) {
            resolve(null);
            return;
          }
          control.pendingQuestions.set(questionId, resolve);
          const settle = (): void => {
            if (control.pendingQuestions.delete(questionId)) resolve(null);
          };
          control.abort.signal.addEventListener("abort", settle, { once: true });
          clockAbortSignal?.addEventListener("abort", settle, { once: true });
        }),
      ...(clockCell
        ? {
            enterWaiting: () => {
              clockCell.current?.enterWaiting();
              return clockCell.current?.deadlineAt;
            },
            resumeFromWaiting: () => {
              if (!clockCell.current?.fired) {
                clockCell.current?.resumeFromWaiting();
                this.runs.setPhase(runId, null);
              }
            },
          }
        : {}),
    };
  }

  /**
   * WP 1.2 (claude-subscription) — the LIGHTWEIGHT `claude_subscription` resolution (a sibling of
   * {@link resolveAnswers}, parallel to the AI-SDK {@link resolve}).
   *
   * Returns a {@link ClaudeSubscriptionRunConfig} when this run's credential is `claude_subscription`,
   * else `undefined` (so `execute` continues to the agent-loop path, unchanged). It reads the
   * credential KIND via the REDACTED {@link ProviderRepository.get} — NOT `getDecrypted` — on purpose:
   * a `claude_subscription` `getDecrypted` THROWS `brokenSubscriptionAuthError` when not signed in,
   * which would surface as a generic terminal error BEFORE the executor's dedicated honest `auth`
   * degradation (D-CS7) could run. `get()`/redact only ATTEMPTS resolution inside a try/catch (for the
   * `authBroken` flag) and never throws out, so the kind is always readable.
   *
   * Config sources — the SAME ones the AI-SDK {@link resolve} + {@link resolveAnswers} read, so a
   * subscription run is configured identically to an API-keyed Claude run:
   *   - `model`           = `scenario.model` (the run's "model").
   *   - `prompt`          = `test.userPrompt` (the opener user turn).
   *   - `system`          = {@link withSkillsBlock}({@link resolveSystemPrompt}(scenario.systemPrompt,
   *                         test.systemPromptOverride)) — the SAME base system the AI-SDK path computes,
   *                         with the SAME L1 `<available_skills>` block (+ any eager SKILL.md bodies)
   *                         prepended (WP 1.4).
   *   - `maxTurns`        = `scenario.guardrails.maxTurns ?? 20` (the SAME step cap the agent loop uses).
   *   - `maxRunDurationMs`= `scenario.guardrails.maxRunDurationMs` (the SAME wall-clock guardrail source
   *                         the engine executor reads; omitted → the executor's default cap).
   *   - `profiles`        = {@link resolveProfiles}(scenario, test) — the run's effective profiles,
   *                         driving the ESTIMATED per-tool-AND-per-skill-disclosure-call metering.
   *   - `abortSignal`     = `control.abort.signal` (user stop).
   *   - `driver`          = the injected {@link subscriptionDriver}; `resolveAuth` = the injected
   *                         subscription-only {@link subscriptionAuth} (D-CS7 — never the API-key fallback).
   *   - `mcpServers`/`allowedTools` = WP 1.3 — the scenario's allow-listed servers translated to the
   *                         Agent SDK `mcpServers` config (stdio command/args/env OR http url/resolved
   *                         auth headers) + the `mcp__<serverKey>__<toolName>` allow patterns
   *                         ({@link buildSubscriptionToolWiring}). Unlike the AI-SDK path, NO
   *                         {@link McpSession} is opened here — the SDK connects/spawns the servers in
   *                         its child (D-CS9); the secrets are placed into the child's config only.
   *                         Tools-less scenarios resolve to `{}`/absent — unchanged from WP 1.2.
   *   - `resolvedSkills`/`skillFileReader` = WP 1.4 (D-CS9) — the run's attached skills, resolved the
   *                         SAME way {@link resolve} resolves them ({@link ScenarioService.resolveAllowedSkills},
   *                         with the resolution persisted via {@link recordResolvedSkills}), plus a
   *                         raw-bytes reader ({@link skillFileBytesReader}) so the executor can
   *                         MATERIALIZE their files read-only into the run's throwaway workspace and wire
   *                         its own read-only disclosure tool. Present only when the scenario has ≥1
   *                         attached skill AND a skill registry is wired; absent otherwise — a
   *                         skill-less scenario resolves NO extra config, unchanged from before this WP.
   *
   * D-CS7 honest degradation: when the subscription DRIVER seam is not wired (a misconfiguration —
   * production wires it in `index.ts`), a subscription run can't run, so this throws a clear typed
   * error (→ `execute`'s catch → a terminal `error`) rather than a fake result. A not-signed-in run is
   * NOT thrown here — `resolveAuth` returns `null` at run time and the executor emits the honest `auth`
   * error itself (so the "not signed in" truth flows through ONE path, consistent with the provider
   * repo's `authBroken` signal, which reads the SAME signed-in `claude_oauth` credential).
   */
  private resolveClaudeSubscription(
    runId: string,
    testId: string,
    scenarioId: string,
    control: RunControl,
    skillOverrides?: SkillOverrides,
    forkSeed?: ForkSeed,
  ): ClaudeSubscriptionRunConfig | undefined {
    const scenario = this.scenarios.get(scenarioId);
    // Redacted read — never resolves/throws on auth (unlike getDecrypted), so a not-signed-in
    // subscription still reaches the executor's honest `auth` degradation instead of throwing here.
    if (this.providers.get(scenario.providerId).kind !== "claude_subscription") return undefined;
    // The run driver must be wired to run this kind (production does so in index.ts). Absent → an honest
    // "not configured" terminal error, never a fabricated result (D-CS7).
    if (!this.subscriptionDriver) {
      throw httpError(500, "Claude subscription run support is not configured");
    }
    // WP3.3 (D-OB18) — a WHOLE-run rerun's model/prompt overrides (mid-run fork is refused for this kind
    // at the endpoint, so `messagePrefix` never reaches here). Absent → the parent scenario/test values.
    const effectiveModel = forkSeed?.modelOverride ?? scenario.model;
    // Fail HONESTLY on a model the signed-in subscription does NOT offer — but ONLY when the live list is
    // actually available (read from the resolver's CACHE; NO hot-path spawn). When it's unavailable
    // (cache cold/stale, or the last probe fell back to the static roster), skip strict validation so a
    // transient list failure never blocks a run. Without this guard the SDK would SILENTLY fall back to
    // its own default model for an unknown id (the bug where a `claude-sonnet-4-5` run actually ran on
    // something else). Thrown errors flow through `execute`'s catch → an honest terminal `error`.
    const supportedIds = this.subscriptionModels?.cachedSupportedModelIds();
    if (supportedIds && !supportedIds.has(effectiveModel)) {
      throw httpError(
        400,
        `Model "${effectiveModel}" is not offered by the signed-in Claude subscription. Pick one of the ` +
          `models the subscription currently supports (see the Model dropdown).`,
      );
    }
    const test = this.tests.get(testId);
    const maxRunDurationMs = scenario.guardrails.maxRunDurationMs;
    // WP 1.3 (D-CS9) — translate the scenario's allow-listed servers → the Agent SDK `mcpServers` config
    // + `mcp__<serverKey>__<toolName>` allow patterns. The SDK connects/spawns these servers in ITS
    // child, so NO McpSession is opened here (unlike the AI-SDK path); the decrypted stdio env / http
    // auth headers are placed into the child's config only and never returned to the web or logged.
    const wiring = this.resolveSubscriptionTools(scenarioId);
    // Interactive runs additionally expose the built-in `ask_user` tool as an in-process Agent-SDK MCP
    // server (`mcp__ask__ask_user`), merged into the run's `mcpServers` with its pattern added to the
    // allow-list — so the executor's default-deny `canUseTool` gate permits it. Automated/suite runs add
    // nothing (no operator to answer), keeping their wiring byte-for-byte unchanged. Mirrors the AI-SDK
    // path's `ask_user` injection so both run paths present the same tool surface.
    if (control.mode === "interactive") {
      wiring.mcpServers[ASK_USER_MCP_KEY] = buildAskUserSdkServer(
        this.askUserBridge(runId, control),
      );
      wiring.allowedTools.push(askUserToolPattern());
    }
    // WP 1.4 (D-CS9, skills half) — resolve + persist the run's attached skills the SAME way
    // `resolve()` does for the AI-SDK path (`recordResolvedSkills`), then prepend the SAME L1
    // `<available_skills>` block (+ any eager SKILL.md bodies) to the system prompt (`withSkillsBlock`).
    // A scenario with no attached skills resolves `[]` — `recordResolvedSkills([])` writes nothing and
    // `withSkillsBlock([], …)` returns the base system prompt unchanged.
    const resolvedSkills = this.scenarios.resolveAllowedSkills(scenarioId, skillOverrides);
    this.recordResolvedSkills(runId, resolvedSkills);
    const system = this.withSkillsBlock(
      resolvedSkills,
      resolveSystemPrompt(scenario.systemPrompt, test.systemPromptOverride),
    );
    // Materialize + wire the skill-disclosure tool only when the scenario has ≥1 resolved skill AND a
    // skill registry is wired (mirrors `resolve()`'s `this.skills && resolvedSkills.length > 0` guard
    // for the AI-SDK disclosure tools) — a skill-less/registry-less run carries neither field, so the
    // executor materializes nothing and wires no extra mcpServer (byte-for-byte pre-WP-1.4 shape).
    const skillMaterialization =
      resolvedSkills.length > 0 && this.skills
        ? { resolvedSkills, skillFileReader: this.skillFileBytesReader(this.skills) }
        : {};
    return {
      model: effectiveModel,
      prompt: forkSeed?.promptOverride ?? test.userPrompt,
      system,
      maxTurns: scenario.guardrails.maxTurns ?? 20,
      driver: this.subscriptionDriver,
      // D-CS7 — subscription-only auth: not signed in → `null` → the executor's honest `auth` error
      // (never a silent API-key fallback). Absent resolver → same honest degradation.
      resolveAuth: this.subscriptionAuth ?? (() => null),
      profiles: resolveProfiles(scenario, test),
      // WP 1.3 — MCP tools via the SDK `mcpServers` option + allow patterns (tools-less scenarios → {}).
      mcpServers: wiring.mcpServers,
      ...(wiring.allowedTools.length > 0 ? { allowedTools: wiring.allowedTools } : {}),
      ...skillMaterialization,
      abortSignal: control.abort.signal,
      ...(maxRunDurationMs !== undefined ? { maxRunDurationMs } : {}),
      // Unified Sessions (WP1.4/WP1.7, D-US6) — the DECOUPLED subscription-RUN budget
      // (`SubscriptionConcurrencyPool.runs`), NOT `.shared` (which the Auto-Rating CLI judge alone now
      // bounds against): its own semaphore, sized by `SUBSCRIPTION_RUNS_MAX_CONCURRENCY`, so a suite of
      // subscription runs can no longer contend with (or be starved by) in-flight CLI judges. This
      // completes the WP1.4 "coordination note" hand-off (`subscription-concurrency.ts`'s
      // `SubscriptionConcurrencyPool.runs` doc) — before this WP it still read `.shared`. Absent
      // (existing callers/tests wire no pool) → the executor's module-default gate.
      ...(this.subscriptionConcurrency ? { concurrency: this.subscriptionConcurrency.runs } : {}),
      // WP 1.5 (D-CS8) — the spend cap, from the SAME `scenario.guardrails.maxCostUsd` the AI-SDK
      // agent-loop path reads. The executor shadow-prices exact tokens via `estimateCost` and stops the
      // run on `>= maxCostUsd`; a cap on an unpriced model fails fast there (mirrors the engine).
      ...(scenario.guardrails.maxCostUsd !== undefined
        ? { maxCostUsd: scenario.guardrails.maxCostUsd }
        : {}),
      // Unified Sessions (WP1.7, D-US4/D-US3) — bind the WP1.4 DI seams to this run's persistence: the
      // static capability manifest at session start, and the SessionClock-derived durations on every
      // terminal (the emit closure built in `execute()` forwards NO `RunEmitMeta` for this executor —
      // see `ClaudeSubscriptionRunConfig.recordDurations`'s doc — so this callback is its own path to
      // the same persisted `capabilities_json`/`active_duration_ms`/`total_duration_ms` columns the
      // AI-SDK path reaches via `RunManager.emit`'s `meta` parameter).
      recordCapabilities: (capabilities) => this.runs.setCapabilities(runId, capabilities),
      recordDurations: (durations) => this.runs.recordDurations(runId, durations),
    };
  }

  /**
   * WP 2.1 (D-CS2) — acquire this run's per-provider subscription slot from the shared pool's
   * per-provider registry, returning an IDEMPOTENT release. It is taken OUTSIDE the executor's shared
   * runs+judge gate (the executor acquires that itself), giving a consistent lock order (provider →
   * shared) so the two can never deadlock — and a judge never takes a provider slot at all. A no-op
   * release when no pool is wired (existing callers/tests) or the scenario/provider no longer resolves
   * (the run's own lookup surfaces that honestly).
   */
  private async acquireSubscriptionProviderSlot(scenarioId: string): Promise<() => void> {
    const providerId = this.subscriptionProviderIdFor(scenarioId);
    const gate = providerId ? this.subscriptionConcurrency?.providerGate(providerId) : undefined;
    if (!gate) return () => {};
    await gate.acquire();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      gate.release();
    };
  }

  /** The provider CREDENTIAL id a scenario resolves to, or `undefined` when it no longer resolves. */
  private subscriptionProviderIdFor(scenarioId: string): string | undefined {
    try {
      return this.scenarios.get(scenarioId).providerId;
    } catch {
      return undefined;
    }
  }

  /**
   * WP 1.3 (D-CS9) — translate a scenario's allow-listed servers into the Agent SDK `mcpServers` config
   * + `mcp__<serverKey>__<toolName>` allow patterns (see {@link buildSubscriptionToolWiring}). The
   * server KEY is the stable `serverId` (used in both the config map and the tool patterns). A server
   * contributing no allow-listed tool is skipped (never wired). For a streamable-HTTP server the
   * resolved auth headers reuse the SAME resolution the scan/AI-SDK path uses (custom/bearer/api-key
   * already in `config.headers`, plus an OAuth server's current access token folded in as a Bearer
   * header — see {@link resolveSubscriptionServerHeaders}). Secrets are shaped into the child's config
   * only; they never leave the API.
   */
  private resolveSubscriptionTools(scenarioId: string): {
    mcpServers: Record<string, unknown>;
    allowedTools: string[];
  } {
    const resolved = this.scenarios.resolveAllowedTools(scenarioId);
    const inputs: SubscriptionServerInput[] = [];
    for (const entry of resolved) {
      if (entry.tools.length === 0) continue; // a server with no allow-listed tool is not wired
      const config = this.servers.getInternal(entry.serverId);
      inputs.push({
        key: entry.serverId,
        config,
        headers:
          config.transport === "streamable_http"
            ? this.resolveSubscriptionServerHeaders(config)
            : undefined,
        toolNames: entry.tools.map((tool) => tool.name),
      });
    }
    return buildSubscriptionToolWiring(inputs);
  }

  /**
   * Resolve the auth headers for a streamable-HTTP MCP server the Agent SDK will connect in its child.
   * Custom-header / bearer / api-key auth is already resolved into `config.headers` (decrypted by the
   * server repository). An OAuth server carries no static header, so its CURRENT access token is read
   * from the OAuth store and added as `Authorization: Bearer …` — the same credential the scan path's
   * `authProvider` uses (there is no interactive refresh in the child, so an expired/absent token
   * degrades honestly: the SDK's connection fails → a driver `error` → an honest terminal, D-CS7). The
   * token is placed into the child's config only — never returned to the web or logged.
   */
  private resolveSubscriptionServerHeaders(config: InternalServerConfig): Record<string, string> {
    const headers: Record<string, string> = { ...(config.headers ?? {}) };
    if (isOAuthHttpServer(config)) {
      const token = this.oauth.createProvider(config.id).tokens()?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Resolve the effective run config and open the MCP sessions. Mutates `sessions` so the caller's
   * `finally` can always close them, even if a later step throws.
   */
  private async resolve(
    runId: string,
    testId: string,
    scenarioId: string,
    control: RunControl,
    sessions: Map<string, McpSession>,
    skillOverrides?: SkillOverrides,
    forkSeed?: ForkSeed,
  ): Promise<EngineConfig> {
    const scenario = this.scenarios.get(scenarioId);
    const test = this.tests.get(testId);
    // WP3.3 (D-OB18) — a fork's edited launch params, applied WITHOUT mutating the scenario/test rows.
    // Absent → the parent environment/test value (byte-identical to a non-fork run).
    const effectiveModel = forkSeed?.modelOverride ?? scenario.model;
    const effectiveUserPrompt = forkSeed?.promptOverride ?? test.userPrompt;

    // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US4) — persist this run's static capability
    // manifest right at the start of the AI-SDK engine path (the five chat-completions provider kinds
    // all share `ENGINE_SESSION_CAPABILITIES` — see `session-capabilities.ts`), so it's queryable via
    // `GET /api/runs/:id` from the moment the run exists, before the first event even streams.
    this.runs.setCapabilities(runId, ENGINE_SESSION_CAPABILITIES);
    // Unified Sessions (WP1.3) — a mutable box the engine fills in via `onSessionClockReady` once it
    // constructs this run's SessionClock, so the ask_user bridge (built below, BEFORE the EngineConfig
    // that carries `onSessionClockReady` exists) can bracket its wait with the SAME clock a `nextTurn`
    // wait uses (D-US3 — the wait budget applies to both) AND race a pending question against the
    // clock's own abort signal (a fire must unblock a pending ask_user wait too).
    const clockCell: { current?: SessionClock; abortSignal?: AbortSignal } = {};

    const cred = this.providers.getDecrypted(scenario.providerId);
    const model = this.modelFactory(cred, effectiveModel);
    // Provider-native escape hatch (WP 2.3): e.g. Anthropic prompt caching / extended thinking.
    // The builder is loosely typed (one builder, many providers); the AI SDK passes it through
    // opaquely, so cast to the engine's SDK-derived field type at this single seam.
    const nativeOptions = providerOptions(cred, scenario) as EngineConfig["providerOptions"];

    // Allow-list, resolved server-by-server, flattened so each tool carries its server id.
    const resolved = this.scenarios.resolveAllowedTools(scenarioId);
    const allowed: AllowedTool[] = resolved.flatMap((entry) =>
      entry.tools.map((def) => ({ serverId: entry.serverId, def })),
    );

    // Open exactly one persistent session per allow-listed server that actually contributes tools.
    // `sessionOpener` defaults to the real `openSession` (WP 1.2); tests inject a stub (no child
    // process / network call) so the HTTP→SSE integration test runs with NO provider/MCP key.
    const serverIds = [...new Set(allowed.map((a) => a.serverId))];
    for (const serverId of serverIds) {
      const config = this.servers.getInternal(serverId);
      sessions.set(
        serverId,
        await this.sessionOpener(config, { authProvider: this.authProviderFor(config) }),
      );
    }

    const profiles = resolveProfiles(scenario, test);
    const baseSystem = resolveSystemPrompt(scenario.systemPrompt, test.systemPromptOverride);

    // WP 2.2 — attached skills (faithful loading). Resolve each attachment to a concrete version at run
    // time (`latest` → currentVersionId; `pinned` → the fixed id), then ALWAYS prepend the L1
    // `<available_skills>` block to the system prompt (the true always-on context cost). Because the
    // AccountingSink counts `system` verbatim, the L1 (and any eager-inlined L2) tokens land in the
    // context snapshot's `system` segment automatically — no separate segment needed. The read-only
    // disclosure tools (registered below) meter L2/L3 reads through the SAME StepSink as MCP tool calls.
    // WP 5.1 — a suite variant's ± skill/version override (if any) is applied at resolution time; the
    // scenario row is never mutated (the override rides only the suite-run config snapshot).
    // WP 1.4 (claude-subscription) — `recordResolvedSkills`/`withSkillsBlock` are shared with
    // `resolveClaudeSubscription`, so a subscription run persists + injects skill metadata identically.
    const resolvedSkills = this.scenarios.resolveAllowedSkills(scenarioId, skillOverrides);
    this.recordResolvedSkills(runId, resolvedSkills);
    // Eager is a per-attachment toggle (WP 2.3): each resolved skill carries the attachment's `eager`
    // flag, so an eager attachment additionally inlines its full SKILL.md body (L2) into the L1 block
    // up front — the deliberate worst-case comparison. Non-eager skills stay on the faithful model
    // (L1 always-on + on-demand disclosure reads).
    const system = this.withSkillsBlock(resolvedSkills, baseSystem);

    // Tool-loading mode (eager full prefix vs deferred tool search). Deferred is an Anthropic-only
    // (non-Haiku) capability; for any other provider/model the run transparently falls back to eager
    // and records WHY (the spec's "verify non-Haiku and warn, not fail"). Resolving it once here drives
    // the tool bridge (defer flag), the search tool, the accounting segments, and the run notice.
    const requestedToolMode = scenario.toolLoadingMode;
    const canDefer =
      requestedToolMode === "deferred" && supportsToolSearch(cred.kind, effectiveModel);
    const effectiveToolMode: ToolLoadingMode = canDefer ? "deferred" : "eager";
    const deferFallbackReason =
      requestedToolMode === "deferred" && !canDefer
        ? cred.kind !== "anthropic"
          ? `tool search requires an Anthropic model (provider is "${cred.kind}")`
          : isHaikuModel(effectiveModel)
            ? "tool search is not available on Haiku models"
            : "tool search is unavailable for this provider/model"
        : undefined;

    // WP 1.4: the REAL accounting sink. It owns lenses + provider-actual usage + the context snapshot +
    // KPIs, and emits `step`/`kpi` events. The `tool_defs` segment is Σ over ALL allow-listed tools in
    // eager mode; in deferred mode the resident tool_defs is 0 (the catalog is searched on demand).
    const accounting = new AccountingSink(
      {
        runId,
        profiles,
        system,
        allowedTools: allowed.map((a) => a.def),
        model: effectiveModel,
        providerKind: cred.kind,
        toolLoadingMode: effectiveToolMode,
      },
      (event) => this.runManager.emit(runId, event),
    );

    // The tool-bridge StepSink: record the injected tool result for the next context snapshot and emit
    // the MCP-side timing/error step (the seam WP 1.3 stubbed, now backed by real accounting).
    const sink = createAccountingStepSink(this.runManager, runId, accounting);
    // Capture the first MCP transport failure so the engine can fail the run (a thrown tool execute
    // is otherwise swallowed into a non-fatal tool-error part by the AI SDK).
    let transportError: string | undefined;
    const tools = buildTools(
      allowed,
      sessions,
      sink,
      (message) => {
        transportError ??= message;
      },
      { deferLoading: effectiveToolMode === "deferred" },
    );
    // Deferred mode: register the Anthropic tool-search tool so the model can discover the
    // defer-loaded MCP tools on demand (the provider handles deferral server-side).
    if (effectiveToolMode === "deferred") {
      tools[TOOL_SEARCH_TOOL_KEY] = deferredToolSearchTool();
    }

    // WP 2.2 — register the READ-ONLY skill-disclosure tools (`list_skill_files` / `read_skill_file`)
    // alongside the MCP tools, backed by the resolved skill versions' files. Each call is metered
    // through the SAME accounting `sink` as MCP `tools/call`, so its request/response tokens land in the
    // run's context accounting (the realized L2/L3 disclosure cost). These tools ONLY read file contents
    // — the app NEVER executes skill scripts (Phase-1 invariant preserved).
    if (this.skills && resolvedSkills.length > 0) {
      const reader = this.skillFileReader(this.skills);
      Object.assign(tools, buildSkillDisclosureTools(resolvedSkills, reader, sink));
    }

    // Interactive runs additionally expose the built-in `ask_user` tool, so the agent can PAUSE and ask
    // the human operator a question (answered via `POST /api/runs/:id/answers`). Automated/suite runs
    // never get it — there is no operator to answer — so their tool surface + token accounting stay
    // byte-for-byte identical. The same tool is exposed on the Claude-subscription path (see
    // `resolveClaudeSubscription`), keeping the two run paths comparable.
    if (control.mode === "interactive") {
      Object.assign(tools, buildAskUserAiTool(this.askUserBridge(runId, control, clockCell)));
    }

    const accountingHooks: AccountingHooks = {
      onLlmStep: async (step, timing) => {
        // Discard the per-step record (persistence is WP 1.6); the sink already emitted step/kpi.
        // F2 — pass the per-turn assistant prose + reasoning so they settle on the llm_response step.
        // Field names verified against the installed `ai` v6 StepResult (node_modules/.pnpm/ai@6.0.208
        // …/ai/dist/index.d.ts, type StepResult<TOOLS>): `text: string` and
        // `reasoningText: string | undefined`. (There is also a `reasoning: ReasoningPart[]` array, but
        // `reasoningText` is the SDK's pre-joined text, so we use it directly.)
        // WP 0.4 (T6e) — DON'T use the SDK's `step.text`: it joins a step's multiple text content blocks
        // with the EMPTY string (`ai` `StepResult.text` = `content.filter(text).map(text).join("")`), so
        // two adjacent blocks render glued ("Let me begin!Now let me search"). Re-join the blocks with a
        // PARAGRAPH break so the transcript renderer sees separate paragraphs. Value-fidelity only — the
        // wire stays a plain `assistantText` string. See {@link joinTextBlocks}.
        // Track E — forward the engine's real wall-clock step boundary so it lands on the llm_response step.
        await accounting.llmStep({
          requestMessages: step.response.messages,
          responseContent: step.content,
          usage: step.usage,
          providerMetadata: step.providerMetadata,
          requestBody: step.request.body,
          text: joinTextBlocks(step.content),
          reasoningText: step.reasoningText,
          ...(timing ? { startedAt: timing.startedAt, endedAt: timing.endedAt } : {}),
        });
      },
      onOverflow: (message) => accounting.emitOverflowStep(message),
      // F3 — single KPI source: the engine's FINAL kpi reads the SAME rolled-up totals the per-step
      // kpis use, so KPI "Turns" (= settled llm_response steps) can't diverge from the context columns.
      getRunKpis: () => {
        const k = accounting.runKpis;
        return {
          turns: k.turns,
          toolCalls: k.toolCalls,
          tokensIn: k.tokensIn,
          tokensOut: k.tokensOut,
          costUsd: k.costUsd,
          peakContextTokens: k.peakContextTokens,
        };
      },
    };

    return {
      model,
      system,
      userPrompt: effectiveUserPrompt,
      tools,
      maxTurns: scenario.guardrails.maxTurns ?? 20,
      // WP 1.5 — budget guardrails (tool calls / token / context / spend) + the model id + provider
      // kind the engine's spend-cap guardrail uses to price the SAME provider-actual usage the cost
      // KPI accumulates. `maxTurns` above is the step cap; the rest are enforced in the engine.
      guardrails: scenario.guardrails,
      modelId: effectiveModel,
      providerKind: cred.kind,
      profiles,
      // WP3.3 (D-OB18) — fork seed: prepend the reconstructed parent-conversation prefix (mid-run fork)
      // + apply the temperature override. Both guarded by presence, so a non-fork run is unchanged.
      ...(forkSeed?.messagePrefix ? { messagePrefix: forkSeed.messagePrefix } : {}),
      ...(forkSeed?.temperatureOverride !== undefined
        ? { temperature: forkSeed.temperatureOverride }
        : {}),
      // Surface the tool-loading decision (deferred-requested runs only) so the engine emits a
      // persisted notice on whether deferred tool search is active or fell back to eager.
      ...(requestedToolMode === "deferred"
        ? {
            toolLoading: {
              requested: requestedToolMode,
              effective: effectiveToolMode,
              ...(deferFallbackReason ? { reason: deferFallbackReason } : {}),
            },
          }
        : {}),
      ...(nativeOptions ? { providerOptions: nativeOptions } : {}),
      getTransportError: () => transportError,
      accounting: accountingHooks,
      // WP 2.2 — thread the abort signal (stop) + the interactive turn provider through to the engine.
      // Automated runs pass no `interactive`, so they run a single opener turn unchanged.
      abortSignal: control.abort.signal,
      ...(control.mode === "interactive" ? { interactive: this.nextTurnProvider(control) } : {}),
      // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.3, D-US1/D-US3) — capture the engine's own
      // SessionClock into `clockCell` (so the ask_user bridge built above can bracket its wait with the
      // SAME clock a `nextTurn` wait uses). WP1.7 — the engine now clears its own `starting`/
      // `waiting_input` phase by emitting `{type:"phase",phase:null}` through the normal event choke
      // point (`RunRepository.onEvent` persists it, like any other phase event) instead of a
      // direct-write escape hatch, so `EngineConfig` no longer needs a `clearPhase` callback here.
      onSessionClockReady: (clock, clockAbortSignal) => {
        clockCell.current = clock;
        clockCell.abortSignal = clockAbortSignal;
      },
    };
  }

  /**
   * Adapt the {@link SkillRepository} into the read-only {@link SkillFileReader} the disclosure tools
   * use. Returns file CONTENTS only (text files) or a binary marker — there is deliberately no method
   * that executes anything, preserving the "app never runs skill scripts" invariant.
   */
  private skillFileReader(skills: SkillRepository): SkillFileReader {
    return {
      listFiles: (versionId) => skills.listFiles(versionId),
      readTextFile: (versionId, path) => {
        const content = skills.getFileContent(versionId, path);
        if (content.isBinary) {
          return { path: content.path, isBinary: true, size: content.size };
        }
        return { path: content.path, text: content.text };
      },
    };
  }

  /**
   * WP 1.4 (claude-subscription, D-CS9) — adapt the {@link SkillRepository} into the RAW-bytes
   * {@link SkillFileBytesReader} `claude-subscription-executor.ts` needs to MATERIALIZE a resolved
   * skill's files onto disk (binary-safe, unlike {@link skillFileReader}'s text-only AI-SDK-path
   * adapter — materialization needs every file's actual bytes, not just what's safe to inline in a
   * model-visible tool result). Read-only: `getFileBytes` only ever reads a stored blob.
   */
  private skillFileBytesReader(skills: SkillRepository): SkillFileBytesReader {
    return { getFileBytes: (versionId, path) => skills.getFileBytes(versionId, path) };
  }

  /**
   * WP 2.1 — persist WHICH skill version a run resolved for each attachment (latest-resolved and
   * pinned both record the concrete version id), so Trace Mode can list "runs that exercised this
   * version" and `RunDetail.skills` can join back to its footprint. Shared by the AI-SDK `resolve()`
   * and (WP 1.4) `resolveClaudeSubscription()`, so a subscription run's skill resolution is persisted
   * IDENTICALLY. Read-only over run behavior — purely additive bookkeeping, and does NOT touch the
   * never-execute invariant. A resolution of `[]` writes nothing.
   */
  private recordResolvedSkills(runId: string, resolvedSkills: ResolvedSkill[]): void {
    this.runs.recordRunSkills(
      runId,
      resolvedSkills.map((skill) => ({
        skillId: skill.skillId,
        skillVersionId: skill.versionId,
        versionLabel: skill.versionLabel,
        eager: skill.eager,
      })),
    );
  }

  /**
   * Prepend the L1 `<available_skills>` block (+ any eager-inlined SKILL.md bodies) to `baseSystem` —
   * shared by `resolve()` and (WP 1.4) `resolveClaudeSubscription()` so a subscription run's system
   * prompt carries the SAME always-on skill metadata the AI-SDK path injects. A resolution of `[]`
   * returns `baseSystem` UNCHANGED (`buildAvailableSkillsBlock([])` is `""`) — byte-for-byte identical
   * to a scenario with no attached skills.
   */
  private withSkillsBlock(resolvedSkills: ResolvedSkill[], baseSystem: string): string {
    const eagerIds = new Set<string>(resolvedSkills.filter((s) => s.eager).map((s) => s.skillId));
    const skillsBlock = buildAvailableSkillsBlock(resolvedSkills, { eagerIds });
    return skillsBlock ? `${skillsBlock}\n\n${baseSystem}` : baseSystem;
  }

  // Mirror ScanService.getAuthProvider: OAuth provider only for streamable-HTTP + oauth servers.
  private authProviderFor(config: InternalServerConfig) {
    if (!isOAuthHttpServer(config)) return undefined;
    return this.oauth.createProvider(config.id);
  }

  // The allow-listed servers of a scenario that could need interactive OAuth reauth — used to tell
  // the console which servers to reauth when a run fails with an auth error. Tolerates a deleted
  // server (skips it) since the scenario allow-list can outlive a server.
  private oauthServerIdsFor(scenarioId: string): string[] {
    let scenario;
    try {
      scenario = this.scenarios.get(scenarioId);
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const allowed of scenario.allowedServers) {
      try {
        if (isOAuthHttpServer(this.servers.getInternal(allowed.serverId)))
          ids.push(allowed.serverId);
      } catch {
        // server no longer exists — skip
      }
    }
    return ids;
  }
}

/**
 * WP 0.4 (T6e) — re-join an LLM step's assistant TEXT content blocks into one prose string, with a
 * PARAGRAPH break (`\n\n`) between distinct blocks.
 *
 * WHY not `StepResult.text`: the AI SDK getter is
 * `content.filter((p) => p.type === "text").map((p) => p.text).join("")` — an EMPTY-string join. When
 * a single provider response emits more than one text content block (e.g. text · thinking · text, or a
 * pre-tool remark then a post-tool remark in the same step), those blocks arrive glued with no
 * separator, so the transcript reads "Let me begin!Now let me search". Joining with `\n\n` makes the
 * downstream markdown renderer treat them as separate paragraphs.
 *
 * Only the PART boundary gets a separator; the text WITHIN one block is used verbatim (the SDK has
 * already concatenated that block's own streamed deltas). Empty/whitespace-only blocks are dropped so
 * an empty text part can't inject a stray blank paragraph. Returns `undefined` when there is no text
 * at all (a tool-only turn), matching the previous `text?: string` contract — the wire is unchanged.
 * Defensive against malformed content (non-array / non-string `text`).
 */
export function joinTextBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const blocks: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      const text = (part as { text: string }).text;
      if (text.trim().length > 0) blocks.push(text);
    }
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/** True when a `TestAssertions` payload actually declares at least one assertion to evaluate. */
function hasAnyAssertion(assertions: TestAssertions): boolean {
  return (
    (assertions.skillGates?.length ?? 0) > 0 ||
    (assertions.skillRoutes?.length ?? 0) > 0 ||
    assertions.noFractures === true
  );
}

/**
 * Load a version's raw `SKILL.md` text for projection (WP 5.1). Mirrors the trace route's helper: a
 * missing file / binary blob degrades to `""` (the projector then yields an empty-graph-plus-warning),
 * never a throw here — projection failures are handled by the caller's per-skill guard.
 */
function loadSkillMd(skills: SkillRepository, versionId: string): string {
  const content = skills.getFileContent(versionId, "SKILL.md");
  return content.isBinary ? "" : content.text;
}

// Surfaced for callers/tests that want the typed error helper alongside the service.
export { httpError };
