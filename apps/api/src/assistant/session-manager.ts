// Assistant (WP 1.1) — the session engine: thread → live-session lifecycle, the replayable event
// channel (per-thread emitter + bounded buffer + monotonic seq), the settled-events-only persistence
// sink, and the park/resume/stop/cap/detach lifecycle. Mirrors the shapes of `testing/run-manager.ts`
// (bounded buffer + detach) and `testing/run-service.ts` (per-run control + abort), adapted to a
// LONG-LIVED thread that outlives individual SDK sessions.
//
// The SDK is reached ONLY through the injected {@link AgentSessionDriver} seam (session-driver.ts), so
// this module imports NO `@anthropic-ai/claude-agent-sdk` runtime code — tests inject a scripted fake
// driver and never spawn a child / call `query()` / reach Anthropic. The in-process tool factory
// (`buildTools`) and the envelope renderer are injected too, so WP 1.2's real factory / renderer wire
// in with a one-line change in `index.ts` (execution-plan wave W3).
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type {
  AssistantContextEnvelope,
  AssistantEvent,
  AssistantEventInput,
  AssistantPermissionDecisionInput,
  AssistantScope,
  AssistantStreamFrame,
  AssistantThread,
  AssistantThreadCreateInput,
  AssistantThreadDetail,
  AssistantThreadUpdateInput,
  AssistantToolContext,
  AssistantWorkspaceFrame,
  BuildAssistantTools,
} from "@mcp-token-footprint/shared";
// R1.1 (D-AS19) — the page-scope write lock. Pure + SDK-free; the per-message `canUseTool` guard below
// is the AUTHORITATIVE enforcement point (build-time tool filtering alone is not enough).
import {
  deriveAssistantScope,
  describeScopeDenial,
  isScopeExemptActionTool,
  isWriteToolInScope,
} from "@mcp-token-footprint/shared";
// R2.2 (D-AS26) — the default-title constant used to gate auto-titling (never overwrite a rename).
import { ASSISTANT_DEFAULT_THREAD_TITLE } from "@mcp-token-footprint/shared";
// R2.2 (D-AS26) — the pure title helpers (deterministic slug + the one-shot's prompt strings).
import {
  ASSISTANT_TITLE_SYSTEM_PROMPT,
  buildTitlePrompt,
  deterministicTitle,
} from "./auto-title.js";
import type { ProviderRepository } from "../providers/repository.js";
import { httpError, toErrorMessage } from "../utils/errors.js";
import {
  ASSISTANT_NATIVE_WRITE_TOOL_NAMES,
  autoAcceptEligible,
  bareToolName,
  classifyTool,
} from "./permission-classifier.js";
// Observability WP5.4 — the apps/api-local scope-exemption twin for the issue-loop ACTION tools (SHARED-FREE:
// shared's SCOPE_EXEMPT_ACTION_TOOLS is set-equal to the OTHER action tools by a test, so the issue-loop
// actions get their exemption from this local predicate instead). Still `write`-classified + gated below.
import { isIssueLoopActionTool } from "./tools/issue-loop-tools.js";
import type { AssistantAuthSource } from "./spawn-env.js";
import { buildAssistantSpawnEnv } from "./spawn-env.js";
import type { AssistantRepository } from "./repository.js";
import { ASSISTANT_SYSTEM_PROMPT } from "./system-prompt.js";
import type {
  AgentSessionDriver,
  DriverPermissionRequest,
  DriverPermissionResult,
  DriverSession,
} from "./session-driver.js";
// R1.2 (D-AS20) — read-only, for the skill-structure-awareness context block below (renderSkillContext).
// NOT the same handle the in-process skills_* tools use (buildTools closes over its own SkillRepository
// in index.ts) — this is a second, dedicated wiring so the session manager can render skill context
// without threading a DB read through the frozen, SDK-free AssistantToolContext contract.
import type { SkillRepository } from "../skills/repository.js";
import { boundText, truncate } from "./tools/util.js";
// WP 2.2 (D-AS13) — the skill-workspace filesystem plumbing (SDK-free, see workspace.ts's banner).
import { ensureWorkspaceRoot, removeWorkspaceRoot } from "./workspace.js";

/**
 * Built-in Claude Code tools the Assistant must NEVER get: exec (`Bash`/`BashOutput`/`KillShell`),
 * network (`WebSearch`/`WebFetch`), notebook mutation (`NotebookEdit` — a skill workspace never
 * contains notebooks), subagents (`Task`/`TaskStop`/`Agent`), and the side-effecting
 * scheduling/remote/artifact built-ins. Verified against the installed SDK's `sdk-tools.d.ts` tool
 * roster (0.3.206). The Assistant works over app data ONLY through the in-process MCP tool server
 * (WP 1.2), and `settingSources: []` (set by the driver) keeps the child from loading filesystem
 * permission config that could re-enable a denied built-in. Defined here (a plain array, SDK-free) so
 * this module never statically imports the SDK.
 *
 * WP 2.2 (D-AS13): `Read`/`Glob`/`Grep` (read) and `Edit`/`Write`/`MultiEdit` (write) are DELIBERATELY
 * NOT in this list — they are the agent's skill-workspace edit mechanism, confined by the SDK itself to
 * `cwd` (the empty per-thread scratch dir) UNION `additionalDirectories` (the thread's workspace root,
 * set in `startSession` below) — never app source, the DB, or secrets. `permission-classifier.ts`'s
 * native-tool sets then gate them the SAME way any other read/write is gated (reads auto-allow; writes
 * are an ordinary create/update `write`, gated by default, auto-accept-eligible).
 */
export const ASSISTANT_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "BashOutput",
  "KillShell",
  "WebSearch",
  "WebFetch",
  "NotebookEdit",
  "Task",
  "TaskStop",
  "Agent",
  "Monitor",
  "RemoteTrigger",
  "PushNotification",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "EnterWorktree",
  "ExitWorktree",
  "Artifact",
  "REPL",
  "Workflow",
  "Projects",
];

/**
 * Bound the per-thread replay buffer so a long-lived thread can't grow it without limit — mirrors
 * `testing/run-manager.ts` `MAX_BUFFERED_EVENTS`. The durable replay source is the persisted
 * `assistant_events` log (`AssistantRepository.listEvents`); this in-memory buffer only backfills the
 * tiny window between a subscriber's DB snapshot and its live attach (see the SSE route).
 */
export const MAX_BUFFERED_EVENTS = 2000;

// R1.2 (D-AS20) — size discipline for the `<skill-context>` block (renderSkillContext): a skill with
// hundreds of files or a bloated SKILL.md must never blow up a message's context. Mirrors the
// tools/index.ts pagination-cap convention (DEFAULT_LIST_LIMIT / MAX_FILE_TEXT_CHARS), reusing the
// SAME `truncate`/`boundText` helpers (tools/util.ts) so a cut is always self-describing.
const SKILL_CONTEXT_MAX_FILES = 200;
const SKILL_CONTEXT_MAX_SKILL_MD_CHARS = 20_000;

const THREAD_EVENT = "assistant-frame";
const THREAD_CLOSED = "assistant-closed";

/**
 * The repo-handle portion of {@link AssistantToolContext} the orchestrator injects — everything WP 1.2's
 * tools need EXCEPT the per-message `threadId`/`envelope`, which the manager supplies per session/message.
 */
export type AssistantToolContextBase = Omit<AssistantToolContext, "threadId" | "envelope">;

/** Every field is opaque (`unknown`) in the frozen contract, so `undefined` satisfies the default. */
const EMPTY_TOOL_CONTEXT_BASE: AssistantToolContextBase = {
  runs: undefined,
  suiteRuns: undefined,
  skills: undefined,
  scans: undefined,
  servers: undefined,
  compare: undefined,
  compatibility: undefined,
  tests: undefined,
  environments: undefined,
  collections: undefined,
  reports: undefined,
};

/** Renders a message's context envelope into a structured block appended to the user prompt (D-AS7). */
export type EnvelopeRenderer = (envelope: AssistantContextEnvelope | undefined) => string;

export interface AssistantSessionConfig {
  /**
   * Turn cap for the WHOLE warm session → the SDK's `maxTurns` (ASSISTANT_DEFAULT_MAX_TURNS). See the
   * shared constant's doc: one `query()` (started in `startSession` below) serves every message until
   * the session is parked/aborted, so this budget is NOT reset per `sendMessage()` call — a fresh one
   * only starts on the next park/resume.
   */
  maxTurns: number;
  /** Idle ms before a warm session's child is parked (killed; resumable via `sdkSessionId`). */
  idleTimeoutMs: number;
  /** Max concurrently-alive session children across all threads (ASSISTANT_DEFAULT_MAX_ACTIVE_SESSIONS). */
  maxActiveSessions: number;
  /** Base dir for per-thread scratch cwds (defaults to `<DATA_DIR>/assistant`). */
  assistantDataDir: string;
  /** How long a gated write's `permission_request` waits before it auto-denies (WP 2.1, D-AS4). */
  permissionTimeoutMs: number;
  /**
   * R2.2 (D-AS25) — grace (ms) between a turn completing and the thread's live session being RELEASED
   * (parked; cap slot freed, `sdkSessionId` kept for resume). `0` releases the moment the turn ends
   * (the default — so the cap 409 disappears); `> 0` keeps the child warm for that long for instant
   * follow-ups, with the (longer) idle timeout as a backstop.
   */
  releaseGraceMs: number;
  /**
   * R2.2 (D-AS26) — feature flag for the best-effort LLM-refined title after the first turn. When off,
   * only the deterministic (message-derived) title is used. The refine is NEVER registered in the live
   * map and NEVER counts toward {@link maxActiveSessions}; it silently falls back to the deterministic
   * title on any error/timeout.
   */
  autoTitle: boolean;
  /** R2.2 (D-AS26) — the cheap model id the title one-shot runs on. */
  titleModel: string;
  /** R2.2 (D-AS26) — hard timeout (ms) for the title one-shot; on timeout the deterministic title stays. */
  titleTimeoutMs: number;
  /**
   * R1.2 (D-AS20/D-AS21) — the bundled, READ-ONLY skill-authoring reference directory (a distilled
   * skill-creator fallback + best-practices checklist; see
   * `apps/api/resources/skill-authoring/skill-creator/SKILL.md`). Added to `additionalDirectories`
   * ONLY on a skill-scoped session start (see `startSession`). Optional so tests that don't exercise
   * R1.2 (most of WP 1.1/2.x's suite) don't need to know about it — omitted, no such directory is
   * ever added, matching the pre-R1.2 behavior exactly.
   */
  assistantSkillAuthoringDir?: string;
}

export interface AssistantSessionManagerDeps {
  repository: AssistantRepository;
  providers: ProviderRepository;
  /** The SDK boundary (index.ts → SdkAgentSessionDriver; tests → a scripted fake). */
  driver: AgentSessionDriver;
  /**
   * The in-process MCP tool factory (frozen contract). index.ts defaults it to the empty SDK MCP server;
   * WP 1.2's real `buildAssistantTools` swaps in with a one-line change. Required so this module never
   * statically imports the SDK.
   */
  buildTools: BuildAssistantTools;
  /** The repo handles WP 1.2's tools need (omitted with the default empty factory, which ignores them). */
  toolContextBase?: AssistantToolContextBase;
  /** Envelope → context block. Defaults to a minimal inline route/entity/tab renderer. */
  renderEnvelope?: EnvelopeRenderer;
  /**
   * The custom system prompt fed to every session (D-AS9 identity + §3.6 injection defense). Defaults to
   * {@link ASSISTANT_SYSTEM_PROMPT}, so the guard can never be silently dropped even if index.ts omits it.
   */
  systemPrompt?: string;
  config: AssistantSessionConfig;
  logger?: { warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
  /**
   * R1.2 (D-AS20) — the skill repository, used ONLY to render the skill-structure-awareness
   * `<skill-context>` block on skill scope (see `renderSkillContext`/`renderMessage` below). A
   * SEPARATE wiring from `buildTools`'s own closure over a `SkillRepository` (index.ts) — the frozen,
   * SDK-free `AssistantToolContext`/`AssistantToolContextBase` contract types every capability
   * `unknown` and is missing `compare`/`compatibility`/`reports` on the concrete deps bag
   * (`AssistantToolDeps` omits them — they're pure functions, not repositories), so it can't satisfy
   * `AssistantToolContextBase`'s required shape; a small dedicated field here is simpler than forcing
   * that contract to fit. Optional: when omitted (e.g. WP 1.1/2.x-era tests that don't exercise
   * R1.2), skill scope simply injects no context block instead of throwing.
   */
  skills?: SkillRepository;
}

/** A per-thread fan-out channel — persists across sessions while a subscriber OR a live session exists. */
interface ThreadChannel {
  emitter: EventEmitter;
  /** Settled events only (deltas are transient); bounded to {@link MAX_BUFFERED_EVENTS}. */
  buffered: AssistantEvent[];
  subscribers: number;
}

/**
 * One in-flight gated-write approval (WP 2.1). Keyed by `requestId` in {@link pendingPermissions}; the
 * SDK's `canUseTool` promise is parked on `resolve` until {@link settlePermission} is called by an owner
 * decision, the timeout, or a teardown (stop/park/detach). Settling is idempotent — the FIRST settler
 * wins, clearing the timer + abort listener, so a race (owner allows just as the timeout fires) never
 * double-resolves.
 */
interface PendingPermission {
  requestId: string;
  threadId: string;
  resolve: (result: DriverPermissionResult) => void;
  timer?: NodeJS.Timeout;
  /** The session's shared abort signal — teardown (park/detach/sign-out) fires it → auto-deny. */
  signal: AbortSignal;
  /** The abort listener, retained so settling can detach it (no leaked listener on the controller). */
  onAbort: () => void;
  settled: boolean;
}

/** A live SDK session for one thread. `events` runs the whole session (many turns) until parked/aborted. */
interface LiveSession {
  threadId: string;
  session: DriverSession;
  abort: AbortController;
  pump: Promise<void>;
  idleTimer?: NodeJS.Timeout;
  /**
   * R2.2 (D-AS25) — the release-grace timer (armed only when `releaseGraceMs > 0`): parks the session
   * `releaseGraceMs` after a turn ends. Cleared whenever a new turn starts (a follow-up within grace
   * reuses the warm session) or on any teardown. Distinct from {@link idleTimer} (the longer backstop).
   */
  releaseTimer?: NodeJS.Timeout;
  /** True while a turn is streaming (guards park-mid-turn + the running/idle status transitions). */
  turnInFlight: boolean;
  /** True once this turn produced an error/limit event (so `turn_done` keeps `error`, not `idle`). */
  turnErrored: boolean;
  /** True once detached (delete/sign-out race): the pump drops all further events + persistence. */
  detached: boolean;
  /** The thread's auth source at session start — the `source` on any `limit_error` event (D-AS14). */
  authSource: AssistantThread["authSource"];
  /** The mutable tool context; `envelope` is refreshed per message so WP 1.2's tools read the latest. */
  toolCtx: AssistantToolContext;
  /** Correlates a `tool_result`'s tool_use_id back to the `tool_call`'s tool name. */
  pendingToolNames: Map<string, string>;
  /** WP R1.3 (D-AS13) — this thread's skill-workspace root (`workspace.ts`'s `workspaceRootFor`,
   *  already `mkdir -p`'d in {@link startSession}). Cached here so the pump doesn't recompute it. */
  workspaceRoot: string;
  /**
   * WP R1.3 (D-AS22) — correlates a NATIVE file-write tool call (Edit/Write/MultiEdit) back to its
   * target `file_path` (+ whether that path existed on disk BEFORE the call), so a SUCCESSFUL
   * `tool_result` can fan a `workspace_file_changed` frame. Mirrors {@link pendingToolNames}'s
   * toolUseId-keyed correlation pattern, scoped to just the native write tools.
   */
  pendingNativeWrites: Map<string, { filePath: string; existedBefore: boolean }>;
}

/**
 * The Assistant session engine. Owns: thread CRUD orchestration (delegating persistence to the
 * repository), the auth-configured gate (409 when nothing is configured), per-thread live sessions and
 * their lifecycle, and the replayable SSE channel. Process-local by design (single Docker container).
 */
export class AssistantSessionManager {
  private readonly repository: AssistantRepository;
  private readonly providers: ProviderRepository;
  private readonly driver: AgentSessionDriver;
  private readonly buildTools: BuildAssistantTools;
  private readonly toolContextBase: AssistantToolContextBase;
  private readonly renderEnvelope: EnvelopeRenderer;
  private readonly systemPrompt: string;
  private readonly config: AssistantSessionConfig;
  private readonly logger?: AssistantSessionManagerDeps["logger"];
  /** R1.2 (D-AS20) — see the field's doc on {@link AssistantSessionManagerDeps}. */
  private readonly skills?: SkillRepository;

  private readonly live = new Map<string, LiveSession>();
  private readonly channels = new Map<string, ThreadChannel>();
  /** In-flight gated-write approvals (WP 2.1), keyed by `requestId` (a globally-unique nanoid). */
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(deps: AssistantSessionManagerDeps) {
    this.repository = deps.repository;
    this.providers = deps.providers;
    this.driver = deps.driver;
    this.buildTools = deps.buildTools;
    this.toolContextBase = deps.toolContextBase ?? EMPTY_TOOL_CONTEXT_BASE;
    this.renderEnvelope = deps.renderEnvelope ?? defaultRenderEnvelope;
    this.systemPrompt = deps.systemPrompt ?? ASSISTANT_SYSTEM_PROMPT;
    this.config = deps.config;
    this.logger = deps.logger;
    this.skills = deps.skills;
  }

  // ── Auth gate (D-AS14) ─────────────────────────────────────────────────────────────────────────

  /** True when EITHER a subscription credential OR an API-key fallback is configured. */
  isAuthConfigured(): boolean {
    const hasSubscription = this.repository
      .listCredentials()
      .some((credential) => credential.kind === "claude_oauth");
    const hasFallback = this.repository.getFallbackProviderCredentialId() !== null;
    return hasSubscription || hasFallback;
  }

  /** 409 unless some auth source is configured — the gate on every WP 1.1 route (except the auth routes). */
  assertConfigured(): void {
    if (!this.isAuthConfigured()) {
      throw httpError(
        409,
        "The Assistant is not configured. Sign in or set an API-key fallback in Settings.",
      );
    }
  }

  // ── Thread CRUD ──────────────────────────────────────────────────────────────────────────────────

  createThread(input: AssistantThreadCreateInput): AssistantThread {
    return this.repository.createThread(input);
  }

  listThreads(filter: { entityKind?: string; entityId?: string } = {}): AssistantThread[] {
    return this.repository.listThreads(filter);
  }

  /** The thread row (404 if unknown) — the SSE route's cheap existence check before it hijacks the socket. */
  getThread(id: string): AssistantThread {
    return this.repository.getThread(id);
  }

  /** Thread + full persisted replay log (the durable event history across all its sessions). */
  getThreadDetail(id: string): AssistantThreadDetail {
    const thread = this.repository.getThread(id); // 404 if unknown
    return { ...thread, events: this.repository.listEvents(id) };
  }

  updateThread(id: string, update: AssistantThreadUpdateInput): AssistantThread {
    return this.repository.updateThread(id, update);
  }

  /** Delete a thread: detach any live session first (delete-while-streaming race), then remove the row. */
  deleteThread(id: string): void {
    this.detachThread(id);
    this.repository.deleteThread(id); // 404 if unknown; cascades assistant_events
    // WP 2.2 (D-AS13) — free the thread's skill-workspace directory (every skill it ever opened,
    // committed or not). `removeWorkspaceRoot` is a no-op if the thread never opened one.
    removeWorkspaceRoot(this.config.assistantDataDir, id);
    // WP 3.3 — free the thread's scratch cwd too (found while building the prune-assistant endpoint:
    // this was never cleaned up on delete before this WP, only the workspace root above was).
    fs.rmSync(threadScratchDir(this.config.assistantDataDir, id), { recursive: true, force: true });
    // Tell any open SSE subscribers the thread is gone so they close cleanly.
    this.channels.get(id)?.emitter.emit(THREAD_CLOSED);
  }

  // ── Messaging + lifecycle ─────────────────────────────────────────────────────────────────────────

  /**
   * Send a user message on a thread. Ensures a warm session (resuming a parked one via `sdkSessionId`,
   * or starting a new child — bounded by the active-session cap), persists + fans the `user_message`
   * event, marks the thread `running`, and hands the envelope-rendered prompt to the driver. The turn's
   * streamed events flow back through the session pump.
   */
  async sendMessage(
    threadId: string,
    text: string,
    envelope?: AssistantContextEnvelope,
  ): Promise<void> {
    const thread = this.repository.getThread(threadId); // 404 if unknown
    const auth = this.resolveAuthSource(thread.authSource); // 409 if the thread's source isn't available

    // Defense-in-depth (WP 1.3 review): reject a send while a turn is still in flight. The dock's
    // composer already blocks sending during streaming; this guards direct API callers and races so a
    // second `user_message` can't interleave into — and be mis-attributed against — the running turn.
    const inFlight = this.live.get(threadId);
    if (inFlight?.turnInFlight) {
      throw httpError(
        409,
        "The Assistant is still responding to the previous message. Wait for it to finish or press Stop.",
      );
    }

    let live = this.live.get(threadId);
    if (!live) {
      if (this.live.size >= this.config.maxActiveSessions) {
        throw httpError(
          409,
          `The Assistant is already running ${this.config.maxActiveSessions} sessions. Stop one or let it idle out before starting another.`,
        );
      }
      // R1.2 (D-AS20/D-AS21) — pass THIS message's envelope so a fresh (or resuming) session start
      // can decide, once, whether to add the skill-authoring reference dir (see startSession below).
      live = this.startSession(thread, auth, envelope);
      this.live.set(threadId, live);
    }
    // Refresh the tool context's envelope for THIS message (WP 1.2's tools read it at call time).
    live.toolCtx.envelope = envelope;

    // R2.2 (D-AS26) — set the deterministic title from the FIRST user message (free + instant, before
    // the message is even fanned so it never delays the reply). Guarded so a rename is never clobbered.
    this.maybeSetDeterministicTitle(thread, text);

    // Persist + fan the settled user message (with its envelope). This is the first event of the turn.
    this.appendAndFan(threadId, { type: "user_message", text, ...(envelope ? { envelope } : {}) });

    live.turnInFlight = true;
    live.turnErrored = false;
    // Cancel any pending release/idle park (a follow-up within the grace window reuses the warm session).
    this.clearParkTimers(live);
    this.safeSetStatus(threadId, "running");

    // Hand the driver the envelope-augmented prompt (the persisted event kept the raw text + envelope).
    live.session.send({ text: this.renderMessage(text, envelope) });
  }

  /** Stop the in-flight turn on a thread (SDK `interrupt()`); the session stays warm. Idempotent no-op. */
  stop(threadId: string): void {
    const live = this.live.get(threadId);
    if (!live) return;
    // Auto-deny any write awaiting approval BEFORE interrupting: `interrupt()` doesn't abort the shared
    // controller (the session stays warm), so the pending `canUseTool` promise would otherwise hang and
    // wedge the turn. Denying it settles the promise + records the decision; interrupt then closes the turn.
    this.settleThreadPermissions(
      threadId,
      "The write was left unapproved when the turn was stopped.",
    );
    void live.session.interrupt().catch(() => undefined);
  }

  /**
   * Decide a pending gated write (WP 2.1) — the `POST /api/assistant/threads/:id/permission` handler.
   * Resolves the SDK's parked `canUseTool` promise with allow (optionally owner-edited input) or deny,
   * and persists the `permission_decision` for audit + replay. 404 when no such ask is pending on the
   * thread (already decided / timed out / stopped, or an unknown id) — never resolve someone else's ask.
   */
  decidePermission(threadId: string, decision: AssistantPermissionDecisionInput): void {
    const pending = this.pendingPermissions.get(decision.requestId);
    if (!pending || pending.threadId !== threadId || pending.settled) {
      throw httpError(404, "No pending approval request with that id on this thread.");
    }
    const result: DriverPermissionResult =
      decision.behavior === "allow"
        ? {
            behavior: "allow",
            ...(decision.updatedInput !== undefined
              ? { updatedInput: decision.updatedInput as Record<string, unknown> }
              : {}),
          }
        : { behavior: "deny", message: "The owner denied this write." };
    this.settlePermission(decision.requestId, result);
  }

  /** True while the thread has a live (warm or running) session child. */
  isLive(threadId: string): boolean {
    return this.live.has(threadId);
  }

  /**
   * WP 3.3 (D-AS14) — the ONLY way a thread's `authSource` ever changes: an explicit owner action,
   * never a silent fallback. `POST /api/assistant/threads/:id/retry-source` calls this after a
   * `limit_error`. Validates the TARGET source is actually configured (409 otherwise) BEFORE tearing
   * down anything; 400s if it's already the thread's current source. Records a settled `source_switch`
   * event (the audit trail), flips the persisted `authSource`, tears down any live session for this
   * thread (a fresh one starts on the next message, on the NEW source), and — when the thread has a
   * prior user message — immediately re-sends it so the failed turn retries.
   *
   * Resume-across-sources finding (ground rule 9): `startSession` below passes `resume:
   * thread.sdkSessionId` whenever one is persisted, UNCONDITIONALLY on `authSource` — the SDK's
   * `Options.resume` (verified against the installed `@anthropic-ai/claude-agent-sdk@0.3.206` `sdk.d.ts`)
   * is documented only as "Loads the conversation history from the specified session id", with no
   * mention of an auth/credential binding, so this app makes NO special case here: a retry attempts the
   * SAME resume path every other session start does. Whether the SDK/API actually honors a resume
   * whose ORIGINAL turns were authenticated under a different credential (subscription org vs. an
   * API-key account) is NOT verified — there is no live account in this environment to test it against
   * (owner-acceptance item). If it turns out not to work, the failure is loud, not silent: the new
   * session would itself emit an `error`/`limit_error` on the resumed turn, never a fabricated result.
   */
  async retrySource(
    threadId: string,
    source: AssistantThread["authSource"],
  ): Promise<AssistantThread> {
    const thread = this.repository.getThread(threadId); // 404 if unknown
    if (thread.authSource === source) {
      throw httpError(400, `The thread is already using ${describeAuthSource(source)}.`);
    }
    this.resolveAuthSource(source); // 409 if the TARGET source isn't configured — validate before teardown

    const lastUserMessage = [...this.repository.listEvents(threadId)]
      .reverse()
      .find(
        (event): event is Extract<AssistantEvent, { type: "user_message" }> =>
          event.type === "user_message",
      );

    // Tear down any live session BEFORE flipping the DB field (mirrors delete-while-streaming: never
    // let a settle from the OLD session land after the switch is recorded).
    this.detachThread(threadId);
    this.appendAndFan(threadId, { type: "source_switch", from: thread.authSource, to: source });
    const updated = this.repository.setAuthSource(threadId, source);

    if (lastUserMessage) {
      await this.sendMessage(threadId, lastUserMessage.text, lastUserMessage.envelope);
      return this.repository.getThread(threadId);
    }
    return updated;
  }

  // ── SSE fan-out ────────────────────────────────────────────────────────────────────────────────

  /**
   * The durable replay log for a thread (all persisted settled events across every session). The SSE
   * route writes these first, then attaches a live listener that dedups by `seq`.
   */
  replayEvents(threadId: string): AssistantEvent[] {
    return this.repository.listEvents(threadId);
  }

  /**
   * Subscribe to a thread's live frames. Replays the current in-memory buffer synchronously first
   * (mirrors `run-manager.ts` — backfills the DB-snapshot→attach window; the SSE route's `seq` dedup
   * drops the overlap with the persisted replay), then forwards live frames. `onClosed` fires when the
   * thread is deleted. Returns an unsubscribe that also GCs the channel when the last subscriber leaves.
   */
  subscribe(
    threadId: string,
    onFrame: (frame: AssistantStreamFrame) => void,
    onClosed?: () => void,
  ): () => void {
    const channel = this.ensureChannel(threadId);
    channel.subscribers += 1;
    for (const event of channel.buffered) onFrame(event);
    channel.emitter.on(THREAD_EVENT, onFrame);
    const closedHandler = () => onClosed?.();
    if (onClosed) channel.emitter.on(THREAD_CLOSED, closedHandler);
    return () => {
      channel.emitter.off(THREAD_EVENT, onFrame);
      if (onClosed) channel.emitter.off(THREAD_CLOSED, closedHandler);
      channel.subscribers = Math.max(0, channel.subscribers - 1);
      this.maybeGcChannel(threadId);
    };
  }

  // ── Sign-out kill-hook (WP 0.2 seam) ───────────────────────────────────────────────────────────

  /** Kill every live session (used as the auth-service sign-out hook so a sign-out ends all children). */
  killAllSessions(): void {
    for (const threadId of [...this.live.keys()]) this.detachThread(threadId);
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the SINGLE decrypted credential a given source resolves to (D-AS14 — NO silent fallback):
   * `subscription` → the stored `claude_oauth` token; `api_key` → the referenced anthropic
   * `provider_credentials` key. Throws 409 when the requested source isn't configured. Takes the raw
   * wire source (not a whole thread) so `retrySource` can validate a TARGET source that may not yet be
   * the thread's current one.
   */
  private resolveAuthSource(source: AssistantThread["authSource"]): AssistantAuthSource {
    if (source === "api_key") {
      const ref = this.repository.getFallbackProviderCredentialId();
      if (!ref) throw httpError(409, "No API-key fallback is configured for the Assistant.");
      const credential = this.providers.getDecrypted(ref);
      if (credential.kind !== "anthropic" || !credential.apiKey) {
        throw httpError(
          409,
          "The Assistant's API-key fallback is not a usable Anthropic credential.",
        );
      }
      return { kind: "api_key", apiKey: credential.apiKey };
    }
    const claude = this.repository
      .listCredentials()
      .find((credential) => credential.kind === "claude_oauth");
    if (!claude) throw httpError(409, "The Assistant is not signed in. Sign in in Settings first.");
    const decrypted = this.repository.getDecrypted(claude.id);
    // Best-effort last-used bookkeeping (never blocks the message).
    try {
      this.repository.touchCredentialLastUsed(claude.id);
    } catch {
      /* credential deleted concurrently — the resolve above already succeeded */
    }
    return { kind: "claude_oauth", token: decrypted.token };
  }

  private startSession(
    thread: AssistantThread,
    auth: AssistantAuthSource,
    envelope: AssistantContextEnvelope | undefined,
  ): LiveSession {
    const abort = new AbortController();
    const cwd = this.scratchDirFor(thread.id);
    // WP 2.2 (D-AS13) — the thread's skill-workspace root, created (idempotent) on EVERY session start
    // (fresh or resumed) so it exists before the SDK child spawns with it in `additionalDirectories`.
    // It's a sibling of `cwd`, not nested inside it (see `workspace.ts`'s banner) — the agent's native
    // file tools can reach it ONLY because it's listed explicitly here, never implicitly via cwd.
    const workspaceRoot = ensureWorkspaceRoot(this.config.assistantDataDir, thread.id);
    // R1.2 (D-AS20/D-AS21) — on a skill-scoped session start, ALSO widen additionalDirectories to the
    // bundled read-only skill-authoring reference dir (see AssistantSessionConfig's doc). Gated to
    // skill scope even though the content is harmless in any scope (per the plan). This is evaluated
    // ONCE, from the envelope of the message that started (or resumed) THIS session —
    // `additionalDirectories` is a session-start-only driver option (see DriverStartOptions' doc), so
    // a LATER message that changes scope mid-session does not retroactively add or remove it; the
    // write-permission choke point (handlePermission, below) re-derives scope every message and stays
    // the actual per-message security boundary regardless of what's on additionalDirectories.
    const startScope = deriveAssistantScope(envelope);
    const additionalDirectories =
      startScope?.entityKind === "skill" && this.config.assistantSkillAuthoringDir
        ? [workspaceRoot, this.config.assistantSkillAuthoringDir]
        : [workspaceRoot];
    const env = buildAssistantSpawnEnv({ auth, assistantDataDir: this.config.assistantDataDir });
    const toolCtx: AssistantToolContext = {
      ...this.toolContextBase,
      threadId: thread.id,
      envelope: undefined,
    };
    const toolServer = this.buildTools(toolCtx);

    const session = this.driver.start({
      model: thread.model,
      cwd,
      additionalDirectories,
      maxTurns: this.config.maxTurns,
      systemPrompt: this.systemPrompt,
      env,
      mcpServers: { "assistant-app": toolServer as unknown },
      disallowedTools: ASSISTANT_DISALLOWED_TOOLS,
      abortController: abort,
      // WP 2.1 — the write-permission choke point. Every tool the agent tries to use flows through
      // here for classification (read/ui → auto-allow; write/delete → gate). Bound to the thread id
      // (not the not-yet-created `live`), so it reads the LATEST auto-accept + pending state at call time.
      canUseTool: (request) => this.handlePermission(thread.id, request),
      // Resume a parked/idle thread's prior conversation (D-AS6) when we have its SDK session id.
      ...(thread.sdkSessionId ? { resume: thread.sdkSessionId } : {}),
    });

    // Make sure the fan-out channel exists so events buffer for a subscriber that connects mid-session.
    this.ensureChannel(thread.id);

    const live: LiveSession = {
      threadId: thread.id,
      session,
      abort,
      pump: Promise.resolve(),
      turnInFlight: false,
      turnErrored: false,
      detached: false,
      authSource: thread.authSource,
      toolCtx,
      pendingToolNames: new Map(),
      workspaceRoot,
      pendingNativeWrites: new Map(),
    };
    live.pump = this.pump(live);
    return live;
  }

  /** Consume the driver's normalized events → persisted `AssistantEvent`s + live frames, until the session ends. */
  private async pump(live: LiveSession): Promise<void> {
    try {
      for await (const event of live.session.events) {
        if (live.detached) continue; // delete/sign-out race — drop everything after detach
        switch (event.type) {
          case "session":
            if (event.sessionId)
              this.safeSetSession(live.threadId, { sdkSessionId: event.sessionId });
            break;
          case "assistant_delta":
            this.fanDelta(live.threadId, event.text);
            break;
          case "assistant_message":
            this.appendAndFan(live.threadId, { type: "assistant_message", text: event.text });
            break;
          case "tool_call":
            live.pendingToolNames.set(event.toolUseId, event.toolName);
            // WP R1.3 (D-AS22) — a native file-WRITE tool call (Edit/Write/MultiEdit): stash its
            // target `file_path` + whether that path already existed, so a SUCCESSFUL tool_result
            // below can fan a `workspace_file_changed` frame with the right changeKind. `file_path`
            // is the SDK's field for both (verified against the installed SDK's `sdk-tools.d.ts`
            // @0.3.206 `FileEditInput`/`FileWriteInput`; `MultiEdit` has no typed schema in this SDK
            // version but is confirmed to use the same field name — see permission-classifier.ts's
            // `ASSISTANT_NATIVE_WRITE_TOOL_NAMES` banner). A malformed/missing `file_path` just skips
            // the stash (no crash) — the tool_result handler then has nothing to correlate and emits
            // nothing, the same fail-safe behavior as a write outside the workspace root.
            if (ASSISTANT_NATIVE_WRITE_TOOL_NAMES.has(bareToolName(event.toolName))) {
              const filePath = (event.input as { file_path?: unknown } | undefined)?.file_path;
              if (typeof filePath === "string" && filePath.length > 0) {
                live.pendingNativeWrites.set(event.toolUseId, {
                  filePath,
                  existedBefore: fs.existsSync(filePath),
                });
              }
            }
            this.appendAndFan(live.threadId, {
              type: "tool_call",
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              input: event.input,
            });
            break;
          case "tool_result": {
            const toolName = live.pendingToolNames.get(event.toolUseId) ?? "";
            live.pendingToolNames.delete(event.toolUseId);
            const pendingWrite = live.pendingNativeWrites.get(event.toolUseId);
            live.pendingNativeWrites.delete(event.toolUseId);
            this.appendAndFan(live.threadId, {
              type: "tool_result",
              toolUseId: event.toolUseId,
              toolName,
              result: event.result,
              ...(event.isError !== undefined ? { isError: event.isError } : {}),
            });
            if (!event.isError) {
              const bare = bareToolName(toolName);
              // WP 3.1 (D-AS8/D-AS16) — a SUCCESSFUL ui_* tool result additionally settles a
              // `ui_action` event: the tool already resolved + validated its target against the
              // shared addressable-view registry (packages/shared/src/assistant-ui-registry.ts) and
              // embedded `{ action, params }` in its JSON payload (see ui-tools.ts's `uiResult`);
              // relay exactly that onto the log. A tool that errored (bad route/params — registry
              // validation failed) never reaches this: `isError` short-circuits, so the browser is
              // never told to navigate anywhere the registry didn't approve.
              const uiAction = extractUiAction(bare, event.result);
              if (uiAction) {
                this.appendAndFan(live.threadId, {
                  type: "ui_action",
                  action: uiAction.action,
                  params: uiAction.params,
                });
              }

              // WP R1.3 (D-AS22) — the three TRANSIENT skill-workspace progress frames (never
              // persisted, no seq — see fanWorkspaceFrame). At most one of these three fires per
              // successful tool_result (a tool_use_id is either a stashed native write, or matches
              // one of the two workspace-tool bare names, never both).
              if (pendingWrite) {
                const changed = this.workspaceFileChangedFrame(live, pendingWrite);
                if (changed) this.fanWorkspaceFrame(live.threadId, changed);
              } else if (bare === "skills_open_workspace") {
                const opened = extractWorkspaceOpenedFrame(event.result);
                if (opened) this.fanWorkspaceFrame(live.threadId, opened);
              } else if (bare === "skills_commit_workspace") {
                const committed = extractWorkspaceCommittedFrame(event.result);
                if (committed) this.fanWorkspaceFrame(live.threadId, committed);
              }
            }
            break;
          }
          case "turn_done":
            this.appendAndFan(live.threadId, {
              type: "turn_done",
              ...(event.turnIndex !== undefined ? { turnIndex: event.turnIndex } : {}),
            });
            this.onTurnComplete(live);
            break;
          case "limit_error":
            this.appendAndFan(live.threadId, {
              type: "limit_error",
              message: event.message,
              source: live.authSource,
              // WP 3.3 — thread the driver's auth-vs-rate_limit classification through so the dock's
              // banner can offer the right action (a re-sign-in hint only makes sense for `auth`).
              kind: event.kind,
            });
            live.turnErrored = true;
            this.safeSetStatus(live.threadId, "error");
            // R2.2 (D-AS25) — CLOSE THE WEDGE: an error/limit may NOT be followed by a `turn_done` (the
            // driver can stop emitting), which would otherwise leave `turnInFlight` true forever and the
            // session `running` holding a cap slot. Converge to the same release the normal turn end does
            // (reset the in-flight flag first so `park`'s mid-turn guard doesn't veto it). Idempotent: a
            // trailing `turn_done` re-runs `scheduleRelease`, whose `park` no-ops once already released.
            live.turnInFlight = false;
            this.scheduleRelease(live);
            break;
          case "error":
            this.appendAndFan(live.threadId, { type: "error", message: event.message });
            live.turnErrored = true;
            this.safeSetStatus(live.threadId, "error");
            // R2.2 (D-AS25) — same wedge close as `limit_error` above.
            live.turnInFlight = false;
            this.scheduleRelease(live);
            break;
        }
      }
    } catch (error) {
      // A stream failure that ISN'T an expected teardown (abort/detach) is a real error for the thread.
      if (!live.detached && !live.abort.signal.aborted) {
        this.appendAndFan(live.threadId, { type: "error", message: toErrorMessage(error) });
        this.safeSetStatus(live.threadId, "error");
      }
    } finally {
      this.teardownLive(live);
    }
  }

  /**
   * A turn settled (D-AS25): drop `running`, then RELEASE the session so its cap slot is freed
   * immediately (grace 0) or after the grace window — the next message resumes via `sdkSessionId`.
   * Keeps `error` status if the turn errored. After a SUCCESSFUL first turn, fires the best-effort
   * title refine (fire-and-forget; see {@link maybeRefineTitle}).
   */
  private onTurnComplete(live: LiveSession): void {
    live.turnInFlight = false;
    const errored = live.turnErrored;
    if (!errored) this.safeSetStatus(live.threadId, "idle");
    live.turnErrored = false;
    this.scheduleRelease(live);
    // R2.2 (D-AS26) — after the FIRST successful turn ONLY, refine the deterministic title. Fired AFTER
    // release is scheduled and never awaited, so it can never block/delay the reply or the release.
    if (!errored && this.config.autoTitle && this.isFirstCompletedTurn(live.threadId)) {
      this.maybeRefineTitle(live.threadId);
    }
  }

  /**
   * R2.2 (D-AS25) — release the thread's live session so it stops holding a cap slot. Grace `0` parks
   * SYNCHRONOUSLY (the caller runs inside the pump's `for await`; `park`→`abort` ends the stream, and
   * the pump's `finally`→`teardownLive` is a no-op thanks to its identity guard once `park` has already
   * removed the session from `live`). Grace `> 0` arms a short release timer, with the (longer) idle
   * timer kept as a backstop for the grace window. Idempotent — a second call after release is a no-op.
   */
  private scheduleRelease(live: LiveSession): void {
    if (this.config.releaseGraceMs <= 0) {
      this.park(live.threadId);
      return;
    }
    this.armReleaseTimer(live);
    this.armIdleTimer(live);
  }

  /** True iff the just-appended `turn_done` is the thread's FIRST completed turn (offline-testable). */
  private isFirstCompletedTurn(threadId: string): boolean {
    return (
      this.repository.listEvents(threadId).filter((event) => event.type === "turn_done").length ===
      1
    );
  }

  /**
   * R2.2 (D-AS26) — set the deterministic title from the first user message. HARD guards: (1) the title
   * must still be the universal default (never clobber a user rename), and (2) there must be no prior
   * `user_message` in the log — the "first message" signal is log-derived, so it stays correct even
   * across renames/resumes. A no-op otherwise. Synchronous single DB write; never delays the send.
   */
  private maybeSetDeterministicTitle(thread: AssistantThread, text: string): void {
    if (thread.title !== ASSISTANT_DEFAULT_THREAD_TITLE) return;
    const hasPriorUserMessage = this.repository
      .listEvents(thread.id)
      .some((event) => event.type === "user_message");
    if (hasPriorUserMessage) return;
    const title = deterministicTitle(text);
    if (title.length > 0) {
      try {
        this.repository.updateThread(thread.id, { title });
      } catch {
        /* thread deleted concurrently — nothing to title */
      }
    }
  }

  /**
   * R2.2 (D-AS26) — best-effort LLM refine of the deterministic title, fire-and-forget. NEVER throws
   * into the pump (the caller does not await it), NEVER registers the one-shot in {@link live}, and
   * NEVER counts it against {@link AssistantSessionConfig.maxActiveSessions}. On ANY error/timeout it
   * silently keeps the deterministic title.
   */
  private maybeRefineTitle(threadId: string): void {
    void this.runTitleOneShot(threadId).catch(() => undefined);
  }

  /**
   * The title one-shot proper: reads the first user message + assistant reply from the PERSISTED log
   * (not the torn-down live session), runs a SEPARATE short-lived `driver.start` session — never added
   * to `live`, never cap-counted — with no tools, `maxTurns: 1`, its own abort controller + scratch cwd,
   * and the thread's resolved auth-source spawn env, reads one assistant reply (bounded by a hard
   * timeout), and PATCHes the title only if it is still the deterministic one (no concurrent rename).
   */
  private async runTitleOneShot(threadId: string): Promise<void> {
    if (!this.config.autoTitle) return;

    const thread = this.repository.getThread(threadId); // 404 → caught by the fire-and-forget wrapper
    const events = this.repository.listEvents(threadId);
    const firstUser = events.find(
      (event): event is Extract<AssistantEvent, { type: "user_message" }> =>
        event.type === "user_message",
    );
    const firstAssistant = events.find(
      (event): event is Extract<AssistantEvent, { type: "assistant_message" }> =>
        event.type === "assistant_message",
    );
    if (!firstUser || !firstAssistant) return; // nothing to summarize

    const titleBefore = thread.title; // only overwrite if this is still the title at PATCH time
    const auth = this.resolveAuthSource(thread.authSource); // may 409 → caught upstream

    const abort = new AbortController();
    const cwd = this.titleScratchDirFor(threadId);
    const env = buildAssistantSpawnEnv({ auth, assistantDataDir: this.config.assistantDataDir });

    const session = this.driver.start({
      model: this.config.titleModel,
      cwd,
      maxTurns: 1,
      systemPrompt: ASSISTANT_TITLE_SYSTEM_PROMPT,
      env,
      mcpServers: {},
      disallowedTools: ASSISTANT_DISALLOWED_TOOLS,
      // R2 review (D-AS17 defense-in-depth) — the one-shot needs NO tools (no mcpServers, an empty
      // nested scratch cwd, no additionalDirectories, maxTurns 1). Give it a deny-all choke point so
      // "no tool ever runs in the title one-shot" is airtight, not merely reliant on the SDK default
      // for the native file tools that are deliberately allowed in the main skill-workspace session.
      canUseTool: (): Promise<DriverPermissionResult> =>
        Promise.resolve({ behavior: "deny", message: "The title assistant does not use tools." }),
      abortController: abort,
    });

    const timer = setTimeout(() => abort.abort(), this.config.titleTimeoutMs);
    timer.unref?.();
    try {
      session.send({ text: buildTitlePrompt(firstUser.text, firstAssistant.text) });
      const raw = await this.readTitleFromSession(session);
      const refined = deterministicTitle(raw);
      if (refined.length > 0) {
        const current = this.repository.getThread(threadId); // re-read: skip if renamed meanwhile
        if (current.title === titleBefore) {
          this.repository.updateThread(threadId, { title: refined });
        }
      }
    } finally {
      clearTimeout(timer);
      abort.abort(); // tear the one-shot child down (no-op if already aborted by the timeout)
    }
  }

  /** Consume the one-shot's events until its first assistant reply (or it settles/errors/aborts). */
  private async readTitleFromSession(session: DriverSession): Promise<string> {
    for await (const event of session.events) {
      if (event.type === "assistant_message" && event.text.trim().length > 0) return event.text;
      if (event.type === "turn_done" || event.type === "error" || event.type === "limit_error")
        break;
    }
    return "";
  }

  /**
   * Append a SETTLED event to the durable log (synchronous — the DB is current before any fan-out, so a
   * subscriber's DB snapshot + `seq` dedup is race-free), buffer it (bounded), and fan it to live
   * subscribers. Detach/delete short-circuits so a late event never persists against a removed row.
   */
  private appendAndFan(threadId: string, event: AssistantEventInput): void {
    if (this.live.get(threadId)?.detached) return;
    let settled: AssistantEvent;
    try {
      settled = this.repository.appendEvent(threadId, event);
    } catch {
      // The thread was deleted mid-turn (appendEvent 404s) — drop silently (detach race).
      this.logger?.warn?.(
        `assistant: dropped a "${event.type}" event for a missing thread ${threadId}`,
      );
      return;
    }
    const channel = this.channels.get(threadId);
    if (!channel) return;
    channel.buffered.push(settled);
    if (channel.buffered.length > MAX_BUFFERED_EVENTS) {
      channel.buffered.splice(0, channel.buffered.length - MAX_BUFFERED_EVENTS);
    }
    channel.emitter.emit(THREAD_EVENT, settled);
  }

  /** Fan a TRANSIENT streaming delta to live subscribers only — never persisted, never buffered (§3.1). */
  private fanDelta(threadId: string, text: string): void {
    if (this.live.get(threadId)?.detached) return;
    this.channels.get(threadId)?.emitter.emit(THREAD_EVENT, { type: "assistant_delta", text });
  }

  /**
   * WP R1.3 (D-AS22) — fan a TRANSIENT skill-workspace progress frame to live subscribers only.
   * Mirrors {@link fanDelta} exactly: never persisted (no `appendEvent` call), never buffered, no
   * `seq`, onto the SAME per-thread emitter/event name the settled + delta frames use — the SSE route
   * forwards it like any other live frame (see `routes.ts`'s `streamThread`).
   */
  private fanWorkspaceFrame(threadId: string, frame: AssistantWorkspaceFrame): void {
    if (this.live.get(threadId)?.detached) return;
    this.channels.get(threadId)?.emitter.emit(THREAD_EVENT, frame);
  }

  /**
   * WP R1.3 — resolve a successful native write's `file_path` into a `workspace_file_changed` frame
   * IF it lands under THIS thread's workspace root; `null` (emit nothing) for any path outside it
   * (e.g. the session's scratch cwd, or anywhere else a native tool could theoretically reach) — a
   * write there is not a skill-workspace edit. The first path segment under the root is always the
   * skillId (`workspace.ts`'s `skillWorkspaceDir` — `<root>/<skillId>/…`); everything after it,
   * rejoined with `/`, is the posix-relative path the frame carries.
   */
  private workspaceFileChangedFrame(
    live: LiveSession,
    pending: { filePath: string; existedBefore: boolean },
  ): AssistantWorkspaceFrame | null {
    const root = live.workspaceRoot;
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    const normalized = path.resolve(pending.filePath);
    if (!normalized.startsWith(prefix)) return null;
    const segments = normalized.slice(prefix.length).split(path.sep);
    const skillId = segments[0];
    const relativePath = segments.slice(1).join("/");
    if (!skillId || !relativePath) return null;
    return {
      type: "workspace_file_changed",
      skillId,
      path: relativePath,
      changeKind: pending.existedBefore ? "modified" : "created",
    };
  }

  private ensureChannel(threadId: string): ThreadChannel {
    let channel = this.channels.get(threadId);
    if (!channel) {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0); // many SSE subscribers may attach
      channel = { emitter, buffered: [], subscribers: 0 };
      this.channels.set(threadId, channel);
    }
    return channel;
  }

  private maybeGcChannel(threadId: string): void {
    const channel = this.channels.get(threadId);
    if (channel && channel.subscribers <= 0 && !this.live.has(threadId)) {
      channel.emitter.removeAllListeners();
      this.channels.delete(threadId);
    }
  }

  /**
   * Idle-park a warm session: kill the child (ending the driver stream → the pump `finally` tears down),
   * keep the thread `idle` + its persisted `sdkSessionId` so the next message resumes. No-op mid-turn.
   */
  private park(threadId: string): void {
    const live = this.live.get(threadId);
    if (!live || live.turnInFlight) return;
    this.clearParkTimers(live);
    // Drop it from the live map SYNCHRONOUSLY (mirror detachThread). abort() ends the input at once but
    // the SDK output stream — and thus the pump's finally → teardownLive — settles several macrotasks
    // later; without this delete a sendMessage arriving in that window would find the already-ended
    // session and `send()` would no-op (message dropped, thread wedged at running). teardownLive's
    // identity guard tolerates the early removal (and a resumed replacement session).
    this.live.delete(threadId);
    live.abort.abort();
  }

  /**
   * Detach a thread's live session WITHOUT a graceful turn end: mark detached (the pump drops further
   * events), abort the child, and drop it from the live map immediately so a following DB delete can't be
   * raced by a late event. Idempotent. Mirrors `RunManager.detach`.
   */
  private detachThread(threadId: string): void {
    const live = this.live.get(threadId);
    if (!live) return;
    live.detached = true;
    this.clearParkTimers(live);
    this.live.delete(threadId);
    // Settle any write awaiting approval so its `canUseTool` promise never leaks (the child is about to
    // be aborted anyway; this resolves it cleanly with a deny). The `permission_decision` DOES persist
    // (the row is already removed from `live` above, so appendAndFan's detached-drop is a no-op here) —
    // which is correct: on sign-out the resolved deny replays inert, and a thread delete cascades its
    // events away. The abort listener below is a backstop; `settle()` is idempotent, so the two never
    // double-fire.
    this.settleThreadPermissions(threadId, "The write was cancelled — the session ended.");
    live.abort.abort();
  }

  private teardownLive(live: LiveSession): void {
    this.clearParkTimers(live);
    // Only drop it if it's still the registered session (detachThread may have replaced/removed it).
    if (this.live.get(live.threadId) === live) this.live.delete(live.threadId);
    this.maybeGcChannel(live.threadId);
  }

  // ── Write-permission protocol (WP 2.1, D-AS4) ────────────────────────────────────────────────────

  /**
   * The `canUseTool` choke point (bound per session to a thread id in {@link startSession}). Classifies
   * the tool and either AUTO-ALLOWS it (a WP 1.2 read tool, a `ui_*`/`ui.*` navigation tool, or — under
   * per-thread auto-accept — a create/update write) or opens an approval round-trip that BLOCKS the tool
   * until the owner decides, the request times out, or the turn is torn down. Every gated write records a
   * `permission_request` (and, on settle, a `permission_decision`) for the audit trail + replay; read/ui
   * auto-allows are transparent (no event, no prompt). Fails CLOSED (deny) on any teardown race.
   *
   * R1.1 (D-AS19): a gated write is FIRST checked against the page-scope lock ({@link isWriteToolInScope}
   * over the current envelope's scope). An out-of-scope write — or ANY write while no entity is pinned —
   * is HARD-denied here, BEFORE auto-accept / the owner round-trip, so it can never be overridden. Reads
   * and navigation are never scope-gated.
   */
  private handlePermission(
    threadId: string,
    request: DriverPermissionRequest,
  ): Promise<DriverPermissionResult> {
    // A teardown (detach/delete/sign-out) can race a late `canUseTool` — deny rather than open an ask
    // that nothing will ever settle.
    if (this.live.get(threadId)?.detached) {
      return Promise.resolve({
        behavior: "deny",
        message: "The session ended before this write was approved.",
      });
    }

    const cls = classifyTool(request.toolName);
    // Read + navigation tools are never gated — allow transparently.
    if (cls === "read" || cls === "ui") return Promise.resolve({ behavior: "allow" });

    // A gated write (write | delete). Record the ask up front: the BARE tool name + the agent's raw
    // args (no secrets by construction in this app). A future write tool that can preview its change
    // rides `diffPreview` — none exist yet (WP 2.2/2.3), so it's omitted here.
    const requestId = nanoid();
    const bare = bareToolName(request.toolName);
    this.appendAndFan(threadId, {
      type: "permission_request",
      requestId,
      toolName: bare,
      input: request.input,
    });

    // H-3 hardening — the bundled, READ-ONLY skill-authoring reference dir
    // (`this.config.assistantSkillAuthoringDir`) is added to `additionalDirectories` on a skill-scoped
    // session start purely so the SDK's native file-READ tools (Read/Glob/Grep) can read the bundled
    // guides (see AssistantSessionConfig's doc + `startSession`). But `additionalDirectories` ALSO
    // grants the native file-WRITE tools (Edit/Write/MultiEdit) access there, and those native writes
    // ride the EXEMPTION below (skipping the scope gate) whose premise — "blast radius confined to the
    // scope-gated skill workspace" — does NOT hold for this second, always-read-only directory. A
    // native write whose resolved `file_path` lands under it is therefore hard-denied HERE, fail
    // CLOSED, before the exemption and before auto-accept, so a prompt-injected turn (or an ordinary
    // bug) can never overwrite a bundled guide file that would then persist into every future skill
    // session (nothing else in this module clears/regenerates it). Reads of this dir are untouched —
    // Read/Glob/Grep classify as `read` above and never reach this point. Mirrors
    // {@link workspaceFileChangedFrame}'s path.resolve + path.sep-bounded prefix containment check,
    // this module's established path-safety idiom (see {@link isPathWithinDir}).
    const authoringDir = this.config.assistantSkillAuthoringDir;
    const nativeWriteFilePath = request.input.file_path;
    if (
      authoringDir &&
      ASSISTANT_NATIVE_WRITE_TOOL_NAMES.has(bare) &&
      typeof nativeWriteFilePath === "string" &&
      isPathWithinDir(authoringDir, nativeWriteFilePath)
    ) {
      this.appendAndFan(threadId, { type: "permission_decision", requestId, behavior: "deny" });
      return Promise.resolve({
        behavior: "deny",
        message:
          "This path is inside the read-only skill-authoring reference directory and cannot be written to.",
      });
    }

    // R1.1 (D-AS19) — the PAGE-SCOPE write lock, enforced PER MESSAGE against the CURRENT envelope's
    // scope, BEFORE auto-accept / the owner round-trip. This is a HARD deny: an out-of-scope write (or
    // ANY write while unscoped) can NEVER be rescued by auto-accept or an owner "allow". The reason is
    // model-visible (the deny `message`) so the agent self-corrects; a matching `permission_decision`
    // is recorded for the audit trail + replay (the event schema has no reason field — the security
    // guarantee is the returned deny; the transcript still shows the tool was tried and blocked).
    //
    // EXEMPTION: the SDK's native file-write tools (Edit/Write/MultiEdit) are the skill-workspace edit
    // mechanism — filesystem-confined by the SDK to the thread's workspace root, which is only ever
    // POPULATED by a scope-gated `skills_open_workspace` (id-matched to the scoped skill) and only
    // PERSISTED by a scope-gated `skills_commit_workspace`. So their blast radius is already the scoped
    // skill's workspace (the authoring-reference dir carve-out above already denied the other directory
    // a native write could otherwise reach); they are NOT app-data writes and flow through the normal
    // approval path. Every OTHER write/delete is scope-gated — an unknown write tool (not native, not
    // in SCOPE_WRITE_TOOLS) fails CLOSED here (denied), which is the intended fail-safe.
    //
    // SECOND EXEMPTION: the cross-entity ACTION tools (`mcp_tool_call`, `rating_issue_file`, and the
    // Hub create/update tools `hub_agent_create`/`hub_agent_update`/`hub_crew_create`/`hub_crew_update`
    // — the full set is `SCOPE_EXEMPT_ACTION_TOOLS` in shared, the single owner-locked allowlist) are
    // reachable from ANY page (or with no entity pinned). They are external / append-only ACTIONS or
    // Hub-library writes, not edits to the open entity's config, and are useless if confined to one
    // page (analyze a run → call the server it used / file an issue against the skill it loaded; or
    // create agents & crews from the deliberately-unpinned /assistant/agents page — D-AO7). They still
    // fall through to the normal approval / auto-accept round-trip below — only the scope hard-deny is
    // skipped. (`isScopeExemptActionTool` is the authority; do not restate the names elsewhere.)
    //
    // THIRD EXEMPTION (Observability WP5.4): the issue-loop ACTION tools (`issues_update`,
    // `tests_create_draft`, `runs_rerun` — `isIssueLoopActionTool`, the apps/api-local twin, since
    // SHARED-FREE keeps them out of shared's set) are the owner-initiated triage loop. Reachable from the
    // (unpinned) issue detail — an issue is not one of the 9 scoped entity kinds — they are cross-entity
    // ACTIONS (a lifecycle write, a draft-test creation, a fork re-run), not edits to the open entity's
    // config, so they skip the scope hard-deny yet STILL fall through to the same approval / auto-accept
    // round-trip below (never weakening the D-AS4 protocol).
    const scope = deriveAssistantScope(this.live.get(threadId)?.toolCtx.envelope);
    if (
      !ASSISTANT_NATIVE_WRITE_TOOL_NAMES.has(bare) &&
      !isScopeExemptActionTool(bare) &&
      !isIssueLoopActionTool(bare) &&
      !isWriteToolInScope(bare, scope, request.input)
    ) {
      this.appendAndFan(threadId, { type: "permission_decision", requestId, behavior: "deny" });
      return Promise.resolve({ behavior: "deny", message: describeScopeDenial(bare, scope) });
    }

    // Auto-accept (per-thread, read FRESH so a mid-turn toggle is honored): auto-allow create/update
    // writes ONLY — a delete ALWAYS asks (`autoAcceptEligible` is false for the delete class). Record the
    // auto-allow decision so the audit trail carries the request→decision pair even when nobody was asked.
    if (autoAcceptEligible(cls) && this.isAutoAcceptOn(threadId)) {
      this.appendAndFan(threadId, { type: "permission_decision", requestId, behavior: "allow" });
      return Promise.resolve({ behavior: "allow" });
    }

    // Otherwise park the SDK's tool on an owner decision (or the timeout / a teardown auto-deny).
    return this.awaitDecision(threadId, requestId, request.signal);
  }

  /** The thread's current auto-accept flag, read fresh; false if the thread vanished mid-turn. */
  private isAutoAcceptOn(threadId: string): boolean {
    try {
      return this.repository.getThread(threadId).autoAccept;
    } catch {
      return false;
    }
  }

  /**
   * Park one gated write's `canUseTool` promise until it's decided. The pending entry is registered in
   * {@link pendingPermissions} keyed by `requestId`; a timeout (fail-closed auto-deny) and the session's
   * abort signal (teardown auto-deny) are both armed so the promise can never leak. All three settle
   * paths (owner / timeout / abort) route through {@link settlePermission}, which is idempotent.
   */
  private awaitDecision(
    threadId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<DriverPermissionResult> {
    return new Promise<DriverPermissionResult>((resolve) => {
      const onAbort = (): void => {
        this.settlePermission(requestId, {
          behavior: "deny",
          message: "The write was cancelled — the turn ended.",
        });
      };
      const pending: PendingPermission = {
        requestId,
        threadId,
        resolve,
        signal,
        onAbort,
        settled: false,
      };
      this.pendingPermissions.set(requestId, pending);

      // The turn was already torn down before we could attach (abort raced the ask) — deny now.
      if (signal.aborted) {
        this.settlePermission(requestId, {
          behavior: "deny",
          message: "The write was cancelled — the turn ended.",
        });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      pending.timer = setTimeout(
        () =>
          this.settlePermission(requestId, {
            behavior: "deny",
            message: "The approval request timed out.",
          }),
        this.config.permissionTimeoutMs,
      );
      pending.timer.unref?.();
    });
  }

  /**
   * Settle a pending gated write EXACTLY once (idempotent — a second settler is a clean no-op), clearing
   * its timer + abort listener, persisting the `permission_decision` for audit + replay (dropped silently
   * if the thread is gone/detached), and resolving the SDK's parked `canUseTool` promise. Returns whether
   * this call was the settler.
   */
  private settlePermission(requestId: string, result: DriverPermissionResult): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    if (pending.timer) clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.onAbort);
    this.pendingPermissions.delete(requestId);
    this.appendAndFan(pending.threadId, {
      type: "permission_decision",
      requestId,
      behavior: result.behavior,
      ...(result.behavior === "allow" && result.updatedInput !== undefined
        ? { updatedInput: result.updatedInput }
        : {}),
    });
    pending.resolve(result);
    return true;
  }

  /** Auto-deny every gated write awaiting approval on a thread (stop/park/detach). Idempotent per ask. */
  private settleThreadPermissions(threadId: string, message: string): void {
    for (const pending of [...this.pendingPermissions.values()]) {
      if (pending.threadId === threadId && !pending.settled) {
        this.settlePermission(pending.requestId, { behavior: "deny", message });
      }
    }
  }

  private armIdleTimer(live: LiveSession): void {
    this.clearIdleTimer(live);
    live.idleTimer = setTimeout(() => this.park(live.threadId), this.config.idleTimeoutMs);
    live.idleTimer.unref?.();
  }

  private clearIdleTimer(live: LiveSession): void {
    if (live.idleTimer) {
      clearTimeout(live.idleTimer);
      live.idleTimer = undefined;
    }
  }

  /** R2.2 (D-AS25) — arm the release-grace park (only used when `releaseGraceMs > 0`). */
  private armReleaseTimer(live: LiveSession): void {
    this.clearReleaseTimer(live);
    live.releaseTimer = setTimeout(() => this.park(live.threadId), this.config.releaseGraceMs);
    live.releaseTimer.unref?.();
  }

  private clearReleaseTimer(live: LiveSession): void {
    if (live.releaseTimer) {
      clearTimeout(live.releaseTimer);
      live.releaseTimer = undefined;
    }
  }

  /** Clear BOTH park timers (idle backstop + release grace) — used on new-turn start and every teardown. */
  private clearParkTimers(live: LiveSession): void {
    this.clearIdleTimer(live);
    this.clearReleaseTimer(live);
  }

  private renderMessage(text: string, envelope?: AssistantContextEnvelope): string {
    const parts = [text];
    const block = this.renderEnvelope(envelope);
    if (block) parts.push(block);
    // R1.2 (D-AS20) — skill-structure awareness: ONLY on skill scope, append the active skill's file
    // tree + rendered SKILL.md so the agent doesn't have to open the workspace just to see what's
    // there. Empty string (nothing appended) on every other scope, and gracefully on a skill with no
    // files/SKILL.md/repository wired — see renderSkillContext.
    const skillBlock = this.renderSkillContext(deriveAssistantScope(envelope));
    if (skillBlock) parts.push(skillBlock);
    return parts.join("\n\n");
  }

  /**
   * R1.2 (D-AS20/D-AS21) — render the `<skill-context>` block for a skill-scoped message: the active
   * skill's file tree (path + size, capped) and its rendered `SKILL.md` (capped), plus a read-before-
   * edit instruction naming the two authoring guides (the bundled skill-authoring reference dir this
   * session's `additionalDirectories` was widened to at start, and this app's own
   * `docs/skill-authoring.md`). Returns `""` (inject nothing) for any non-skill scope, when no
   * `SkillRepository` was wired (see the field's doc), or when the skill/its files can't be read (a
   * concurrent delete, a version with no files, …) — this must NEVER throw and abort a turn just
   * because a skill went missing mid-conversation.
   */
  private renderSkillContext(scope: AssistantScope): string {
    if (!this.skills || scope?.entityKind !== "skill") return "";
    try {
      const skill = this.skills.getPublic(scope.entityId);
      const lines = ["<skill-context>", `Active skill: "${skill.name}" (id ${skill.id}).`];

      const versionId = skill.currentVersionId;
      if (!versionId) {
        lines.push("This skill has no versions yet — there is no file tree or SKILL.md to read.");
        lines.push("</skill-context>");
        return lines.join("\n");
      }

      const files = this.skills.listFiles(versionId);
      const capped = truncate(files, SKILL_CONTEXT_MAX_FILES);
      lines.push(
        `File tree (current version, ${capped.total} file${capped.total === 1 ? "" : "s"}` +
          `${capped.truncated ? `, showing first ${capped.items.length}` : ""}):`,
      );
      if (capped.items.length === 0) {
        lines.push("(no files)");
      } else {
        for (const file of capped.items) lines.push(`- ${file.path} (${file.size} bytes)`);
        if (capped.truncated) {
          lines.push(
            `…+${capped.total - capped.items.length} more file(s) not shown — call skills_files for the rest.`,
          );
        }
      }

      const skillMdFile = files.find((file) => file.path === "SKILL.md");
      const skillMdContent =
        skillMdFile && !skillMdFile.isBinary
          ? this.skills.getFileContent(versionId, "SKILL.md")
          : undefined;
      if (skillMdContent && !skillMdContent.isBinary) {
        lines.push(
          "",
          "SKILL.md (rendered):",
          boundText(skillMdContent.text, SKILL_CONTEXT_MAX_SKILL_MD_CHARS),
        );
      } else {
        lines.push("", "This version has no readable SKILL.md.");
      }

      lines.push(
        "",
        "Read EVERY file in this tree — including everything under references/ — before proposing or " +
          "making any edit. An authoring guide is available and READABLE: the bundled read-only " +
          "skill-authoring reference (skill-creator/SKILL.md plus skill-creator/references/, under the " +
          "additional directory this session was given) — read it before editing. This app also enforces " +
          "a Quality rule↔anchor contract on committed skills: keep each existing rule's SKILL.md anchor " +
          "intact when you edit, and after committing, re-run the skill's Quality check to confirm no rule " +
          "regressed (the contract lives in the app's docs/skill-authoring.md, which is NOT mounted into " +
          "this session — do not try to open it).",
        "</skill-context>",
      );
      return lines.join("\n");
    } catch {
      // The skill (or its current version) is gone/unreadable — inject nothing rather than fail the turn.
      return "";
    }
  }

  private scratchDirFor(threadId: string): string {
    // A per-thread scratch cwd under the assistant data dir (the child's isolated working directory).
    const dir = threadScratchDir(this.config.assistantDataDir, threadId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * R2.2 (D-AS26) — an isolated scratch cwd for the title one-shot, NESTED under the thread's scratch
   * dir so `deleteThread`/retention's `fs.rmSync(threadScratchDir(...))` sweep removes it too (no orphan).
   */
  private titleScratchDirFor(threadId: string): string {
    const dir = path.join(threadScratchDir(this.config.assistantDataDir, threadId), "title");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private safeSetStatus(threadId: string, status: AssistantThread["status"]): void {
    try {
      this.repository.setSessionState(threadId, { status });
    } catch {
      /* thread deleted concurrently — nothing to update */
    }
  }

  private safeSetSession(threadId: string, patch: { sdkSessionId?: string | null }): void {
    try {
      this.repository.setSessionState(threadId, patch);
    } catch {
      /* thread deleted concurrently */
    }
  }
}

/**
 * H-3 hardening — true when `candidatePath` (resolved) IS `dir` or lands inside it. The path-safety
 * idiom already established in this module by {@link AssistantSessionManager}'s private
 * `workspaceFileChangedFrame`: `path.resolve` normalizes `..` traversal segments before the
 * comparison, and the trailing-`path.sep`-bounded prefix rules out a sibling directory that merely
 * shares `dir` as a string prefix (e.g. `/a/reference-2` is NOT inside `/a/reference`). Does not
 * resolve symlinks — `dir` is a fixed, bundled app resource (`assistantSkillAuthoringDir`), never
 * agent- or owner-controlled input, matching the same trust assumption `workspaceFileChangedFrame`
 * already makes about `workspaceRoot`.
 */
function isPathWithinDir(dir: string, candidatePath: string): boolean {
  const root = path.resolve(dir);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const normalized = path.resolve(candidatePath);
  return normalized === root || normalized.startsWith(prefix);
}

/**
 * Structural + defensive (never throws): pull the first text block out of an MCP tool result's
 * `CallToolResult.content` array and `JSON.parse` it. Shared by {@link extractUiAction} (WP 3.1) and
 * the WP R1.3 workspace-frame extractors below — all three tools wrap their JSON payload the same way
 * (`tools/util.ts`'s `jsonResult`). Returns `null` for anything that isn't a one-text-block array of
 * valid JSON — a malformed/foreign result never throws into the pump.
 */
function parseFirstJsonTextBlock(result: unknown): unknown {
  if (!Array.isArray(result)) return null;
  const textBlock = result.find(
    (block): block is { type: "text"; text: string } =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text) as unknown;
  } catch {
    return null; // not JSON — not a payload any of these extractors understand
  }
}

/** True for a non-null plain object — the shape every one of this file's JSON-payload extractors
 *  narrows onto before reading fields off it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * WP 3.1 — pull `{ action, params }` out of a settled `ui_*` tool result, if that's what it is.
 * Structural + defensive (never throws on a malformed/foreign payload): only `ui_`-prefixed tool
 * names are even considered (mirrors `permission-classifier.ts`'s own `ui` band check), and the
 * parsed JSON must be shaped `{ action: string, params: object }` (exactly what `ui-tools.ts`'s
 * `uiResult()` produces on success) — anything else returns `null` and no `ui_action` event is
 * emitted.
 */
function extractUiAction(
  bareName: string,
  result: unknown,
): { action: string; params: Record<string, unknown> } | null {
  if (!bareName.startsWith("ui_")) return null;
  const parsed = parseFirstJsonTextBlock(result);
  if (isRecord(parsed) && typeof parsed.action === "string" && isRecord(parsed.params)) {
    return { action: parsed.action, params: parsed.params };
  }
  return null;
}

/**
 * WP R1.3 (D-AS22) — pull `{ skillId, versionId, files }` out of a successful `skills_open_workspace`
 * tool result (the exact JSON shape `workspace-tools.ts`'s handler returns — `{skillId, versionId,
 * versionLabel, workspacePath, files, fileCount}`; only the three the frame needs are read here, and
 * `files` is narrowed down to its slim `{path,size}` shape — see `AssistantWorkspaceFrame`'s doc).
 * Structural + defensive: a malformed/foreign payload returns `null` (no frame), never throws.
 */
function extractWorkspaceOpenedFrame(result: unknown): AssistantWorkspaceFrame | null {
  const parsed = parseFirstJsonTextBlock(result);
  if (!isRecord(parsed)) return null;
  const { skillId, versionId, files } = parsed;
  if (typeof skillId !== "string" || typeof versionId !== "string" || !Array.isArray(files))
    return null;
  const slimFiles: Array<{ path: string; size: number }> = [];
  for (const entry of files) {
    if (isRecord(entry) && typeof entry.path === "string" && typeof entry.size === "number") {
      slimFiles.push({ path: entry.path, size: entry.size });
    }
  }
  return { type: "workspace_opened", skillId, versionId, files: slimFiles };
}

/**
 * WP R1.3 (D-AS22) — pull `{ skillId, versionId }` out of a successful `skills_commit_workspace` tool
 * result, UNLESS it's the `unchanged: true` dedup path (`workspace-tools.ts`: a tree byte-identical to
 * the current version mints no new version) — that case returns `null` on purpose, matching
 * `AssistantWorkspaceFrame`'s doc ("fires nothing — there is no new version to announce"). Structural
 * + defensive: a malformed/foreign payload also returns `null`, never throws.
 */
function extractWorkspaceCommittedFrame(result: unknown): AssistantWorkspaceFrame | null {
  const parsed = parseFirstJsonTextBlock(result);
  if (!isRecord(parsed) || parsed.unchanged === true) return null;
  const { skillId, versionId } = parsed;
  if (typeof skillId !== "string" || typeof versionId !== "string") return null;
  return { type: "workspace_committed", skillId, versionId };
}

/** Minimal default envelope renderer — a route/entity/tab context block (WP 1.2 swaps its canonical one). */
function defaultRenderEnvelope(envelope: AssistantContextEnvelope | undefined): string {
  if (!envelope) return "";
  const lines = [`route: ${envelope.route}`];
  if (envelope.entityKind && envelope.entityId)
    lines.push(`entity: ${envelope.entityKind} ${envelope.entityId}`);
  if (envelope.tab) lines.push(`tab: ${envelope.tab}`);
  return `<app_context>\n${lines.join("\n")}\n</app_context>`;
}

function describeAuthSource(source: AssistantThread["authSource"]): string {
  return source === "api_key" ? "the API-key fallback" : "the subscription";
}

/**
 * WP 1.1/3.3 — a thread's per-session scratch cwd: `<assistantDataDir>/threads/<threadId>/`. A pure
 * path helper (no directory creation) so BOTH `scratchDirFor` (creates it, on session start) and
 * `deleteThread`/`retention.ts`'s prune (removes it) compute the exact same path from one place —
 * exported so `retention.ts` never has to re-derive this formula.
 */
export function threadScratchDir(assistantDataDir: string, threadId: string): string {
  return path.join(path.resolve(assistantDataDir), "threads", threadId);
}
