// Unified Sessions — WP1.R adversarial review (roadmap/unified-sessions/, execution-plan §2 WP1.R).
//
// Authored by the ADVERSARIAL REVIEWER to REFUTE the wave's invariants, not summarize them.
//
//   • Part A — THE cause × executor MATRIX (Invariant 1 — HOLDS): for every TerminalCause reachable by
//     each of the two executors (AI-SDK engine · claude-subscription child),
//     drive it to that cause and assert the emitted TERMINAL triple (status, outcome, stopReasonCode) is
//     EXACTLY `terminalFor(cause)` — byte-identical across executors for the same cause.
//   • Part B — FIXED DEFECTS (Invariant 2 — coherence). Originally THREE tests here were
//     INTENTIONALLY FAILING (prefixed `CONFIRMED-DEFECT`) against the pre-fix implementation; WP1.fix
//     root-caused and fixed all three, so they are now prefixed `FIXED` and assert the corrected
//     behavior, standing as permanent regression guards. They encode:
//       B1  engine SessionClock-fire terminal used to leave `runs.phase='stopping'` STUCK — fixed by
//           `RunRepository.finalize()` clearing `phase = NULL` on every terminal write.
//       B2  subscription pre-aborted signal used to emit `aborted` BEFORE `running` and persist status
//           `running` (an orphan) — fixed by `startSessionLifecycle` emitting `running` (+
//           recordCapabilities + phase:null) BEFORE wiring/checking the abort signal.
//       B3  `POST /api/runs/:id/end` on a `waiting_input` run used to leave `runs.phase='waiting_input'`
//           STUCK — fixed by the same `finalize()` phase clear as B1 (one fix, all terminal paths).
//   • Part C — backward-compat: a pre-contract run + old event log still loads + replays. (Invariant 3.)
//   • Part D — `ended` is terminal everywhere + the new guardrail causes stay gradeable + grading
//     byte-identity (`assistantText`) untouched + error-forensics on an `ended` run (flagged NON-ISSUE).
//   • Part E — capabilities + durations persist for both kinds, incl. WP1.7's subscription COALESCE fix.
//   • Part F — user_stop distinguishability (finish-toast suppression backbone).
//
// Every executor is driven through DI seams / stubs — NO real provider, child, or filesystem.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type {
  NormalizedToolDefinition,
  RunDetail,
  RunEvent,
  RunStatus,
  SessionCapabilities,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { schemaSql } from "../src/db/schema.js";
import type { AppDatabase } from "../src/db/database.js";
import type { McpSession } from "../src/mcp/client.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { runAgentLoop, type EngineConfig, type InteractiveTurns } from "../src/testing/engine.js";
import { isTerminalStatus, RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import {
  createDefaultStepSink,
  RunService,
  type ModelFactory,
  type SessionOpener,
} from "../src/testing/run-service.js";
import { registerTestingRoutes } from "../src/testing/routes.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";
import {
  ENGINE_SESSION_CAPABILITIES,
} from "../src/testing/session-capabilities.js";
import {
  runClaudeSubscription,
  runClaudeSubscriptionInteractive,
  AsyncSemaphore,
  type ClaudeSubscriptionRunConfig,
} from "../src/testing/claude-subscription-executor.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import {
  DEFAULT_STALL_MS,
  DEFAULT_WAIT_BUDGET_MS,
  type SessionClockTime,
} from "../src/testing/session-clock.js";
import { extractErrorInventory } from "../src/grading/error-forensics.js";
import {
  TERMINAL_CAUSES,
  type TerminalCause,
  type TerminalVerdict,
  terminalFor,
} from "../src/testing/session-terminal.js";
import { toErrorMessage } from "../src/utils/errors.js";

// ── shared helpers ────────────────────────────────────────────────────────────────────────────────

type StatusEvent = Extract<RunEvent, { type: "status" }>;
const TERMINAL = new Set<RunStatus>(["completed", "stopped", "error", "aborted", "ended"]);
/** The emitted TERMINAL status event (the last status whose status is terminal). */
function terminalTripleOf(events: RunEvent[]): TerminalVerdict {
  const s = [...events]
    .reverse()
    .find((e): e is StatusEvent => e.type === "status" && TERMINAL.has(e.status));
  assert.ok(s, "a TERMINAL status event was emitted");
  return {
    status: s.status,
    outcome: s.outcome as TerminalVerdict["outcome"],
    stopReasonCode: s.stopReasonCode as TerminalVerdict["stopReasonCode"],
  };
}
const keepAlive = (ms = 400): void => void setTimeout(() => undefined, ms);
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
async function waitFor(pred: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await tick();
  }
}

const NOW = "2026-06-20T00:00:00.000Z";
const openDbs: AppDatabase[] = [];
afterEach(() => {
  for (const d of openDbs.splice(0)) d.close();
});
/** In-memory DB + FK parents (provider/scenario/test) a `runs` row needs. */
function seededDb(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  openDbs.push(db);
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1','anthropic','Claude',NULL,'enc:v1:x',@n,@n)`,
  ).run({ n: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES ('s-1','B','prov-1','claude-sonnet-4','{}','','[]','{}',@n,@n)`,
  ).run({ n: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES ('t-1','L','p','[]',@n,@n)`,
  ).run({ n: NOW });
  return db;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  ENGINE harness (real runAgentLoop + mock model)
// ════════════════════════════════════════════════════════════════════════════════════════════════

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
function streamOf(chunks: Part[], delay: number | null = null) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: delay }) };
}
const E_USAGE = { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } as const;
const mockStopsImmediately = () => new MockLanguageModelV3({ doStream: async () => streamOf([{ type: "stream-start", warnings: [] }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: E_USAGE }]) });
const mockGoesQuiet = (afterMs = 150) => new MockLanguageModelV3({ doStream: async () => streamOf([{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "..." }, { type: "text-end", id: "t1" }, { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: E_USAGE }], afterMs) });
function mockAlwaysCallsTool() {
  let call = 0;
  return new MockLanguageModelV3({ doStream: async () => { call += 1; return streamOf([{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: `c${call}`, toolName: "alpha", input: JSON.stringify({ n: call }) }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: E_USAGE }]); } });
}
const mockThrows = (message: string) => new MockLanguageModelV3({ doStream: async () => { throw new Error(message); } });
const mockAnswerThenText = (text = "Opening.") => new MockLanguageModelV3({ doStream: async () => streamOf([{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: text }, { type: "text-end", id: "t1" }, { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: E_USAGE }]) });

const ENGINE_TOOL_DEFS: NormalizedToolDefinition[] = [{ name: "alpha", description: "Alpha", inputSchema: { type: "object" }, raw: {} }];
function stubMcp(): McpSession {
  return { listTools: async () => ({ tools: [] }), callTool: async (n: string) => ({ content: [{ type: "text", text: `${n}:ok` }] }), close: async () => undefined };
}
function engineBase(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return { model: over.model, system: "sys", userPrompt: "Go.", tools: over.tools ?? {}, maxTurns: 20, profiles: ["generic_o200k"], modelId: "claude-sonnet-4", providerKind: "anthropic", ...over };
}
function engineWithTools(manager: RunManager, runId: string) {
  const sessions = new Map<string, McpSession>([["srv", stubMcp()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: ENGINE_TOOL_DEFS[0]! }];
  return buildTools(allowed, sessions, createDefaultStepSink(manager, runId));
}
async function driveEngine(cause: TerminalCause): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const runId = `eng-${cause}`;
  const manager = new RunManager();
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));
  const emit = (e: RunEvent, meta?: unknown) => manager.emit(runId, e, meta as never);
  switch (cause) {
    case "user_stop": { const c = new AbortController(); c.abort(); await runAgentLoop(runId, engineBase({ model: mockStopsImmediately(), abortSignal: c.signal }), emit); break; }
    case "stalled": keepAlive(); await runAgentLoop(runId, engineBase({ model: mockGoesQuiet(), sessionClockOptions: { stallMs: 25 } }), emit); break;
    case "max_duration": keepAlive(); await runAgentLoop(runId, engineBase({ model: mockGoesQuiet(), guardrails: { maxRunDurationMs: 25 } }), emit); break;
    case "wait_expired": { keepAlive(); const turns: InteractiveTurns = { nextTurn: () => new Promise<string | null>(() => {}) }; await runAgentLoop(runId, engineBase({ model: mockStopsImmediately(), interactive: turns, sessionClockOptions: { waitBudgetMs: 25 } }), emit); break; }
    case "max_turns": await runAgentLoop(runId, engineBase({ model: mockAlwaysCallsTool(), tools: engineWithTools(manager, runId), maxTurns: 3, guardrails: {} }), emit); break;
    case "max_tool_calls": await runAgentLoop(runId, engineBase({ model: mockAlwaysCallsTool(), tools: engineWithTools(manager, runId), guardrails: { maxToolCalls: 1 } }), emit); break;
    case "max_tokens": await runAgentLoop(runId, engineBase({ model: mockAlwaysCallsTool(), tools: engineWithTools(manager, runId), guardrails: { maxTokens: 1 } }), emit); break;
    case "max_context_tokens": await runAgentLoop(runId, engineBase({ model: mockAlwaysCallsTool(), tools: engineWithTools(manager, runId), guardrails: { maxContextTokens: 1 } }), emit); break;
    case "max_cost": await runAgentLoop(runId, engineBase({ model: mockAlwaysCallsTool(), tools: engineWithTools(manager, runId), guardrails: { maxCostUsd: 0.0000001 } }), emit); break;
    case "context_overflow": await runAgentLoop(runId, engineBase({ model: mockThrows("prompt is too long: 250000 tokens > 200000 maximum context length") }), emit); break;
    case "provider_error": await runAgentLoop(runId, engineBase({ model: mockThrows("boom: upstream exploded") }), emit); break;
    case "auth": await runAgentLoop(runId, engineBase({ model: mockThrows("401 Unauthorized: invalid api key") }), emit); break;
    case "rate_limit": await runAgentLoop(runId, engineBase({ model: mockThrows("429 Too Many Requests — rate limit") }), emit); break;
    default: throw new Error(`engine cannot reach ${cause}`);
  }
  return events;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  SUBSCRIPTION harness (scripted fake driver + fake clock)
// ════════════════════════════════════════════════════════════════════════════════════════════════

class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void { if (this.ended) return; const w = this.waiters.shift(); if (w) w({ value: item, done: false }); else this.buffer.push(item); }
  end(): void { if (this.ended) return; this.ended = true; let w = this.waiters.shift(); while (w) { w({ value: undefined as unknown as T, done: true }); w = this.waiters.shift(); } }
  [Symbol.asyncIterator](): AsyncIterator<T> { return { next: () => { const b = this.buffer.shift(); if (b !== undefined) return Promise.resolve({ value: b, done: false }); if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true }); return new Promise<IteratorResult<T>>((res) => this.waiters.push(res)); } }; }
}
class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly options: DriverStartOptions;
  onSend?: (text: string, s: FakeSession) => void;
  constructor(options: DriverStartOptions) { this.options = options; this.out.push({ type: "session", sessionId: "sess" }); options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true }); }
  get events(): AsyncIterable<DriverEvent> { return this.out; }
  send(m: DriverUserMessage): void { this.onSend?.(m.text, this); }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined { return "sess"; }
  emit(e: DriverEvent): void { this.out.push(e); }
}
class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  onStart?: (s: FakeSession) => void;
  onSend?: (text: string, s: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession { const s = new FakeSession(options); s.onSend = this.onSend; this.sessions.push(s); this.onStart?.(s); return s; }
}
const S_AUTH: AssistantAuthSource = { kind: "claude_oauth", token: "sk-ant-oat01-fake" };
const S_MODEL = "claude-sonnet-4-5";
const S_TURN_DONE: DriverEvent = { type: "turn_done", usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
const S_BIG_TURN_DONE: DriverEvent = { type: "turn_done", usage: { inputTokens: 500000, outputTokens: 100000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
function fakeWorkspaces() { let n = 0; return async () => ({ dir: `/fake/ws-${n++}`, cleanup: async () => {} }); }
function subConfig(driver: FakeDriver, over: Partial<ClaudeSubscriptionRunConfig> = {}): ClaudeSubscriptionRunConfig {
  return { model: S_MODEL, prompt: "P", system: "sys", maxTurns: 8, driver, resolveAuth: () => S_AUTH, concurrency: new AsyncSemaphore(1), createWorkspace: fakeWorkspaces(), ...over };
}
function createFakeClock(): { time: SessionClockTime; advance: (ms: number) => void } {
  let cur = 0;
  let id = 1;
  const timers: Array<{ id: number; at: number; fn: () => void; canceled: boolean; fired: boolean }> = [];
  const time: SessionClockTime = { now: () => cur, schedule: (fn, ms) => { const e = { id: id++, at: cur + Math.max(0, ms), fn, canceled: false, fired: false }; timers.push(e); return () => { e.canceled = true; }; } };
  const advance = (ms: number) => { const target = cur + ms; for (;;) { const due = timers.filter((t) => !t.canceled && !t.fired && t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id); const next = due[0]; if (!next) break; cur = next.at; next.fired = true; next.fn(); } cur = target; };
  return { time, advance };
}
async function driveSubscription(cause: TerminalCause): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => events.push(e);
  const driver = new FakeDriver();
  const runId = `sub-${cause}`;
  switch (cause) {
    case "user_stop": { const c = new AbortController(); c.abort(); await runClaudeSubscription(runId, subConfig(driver, { abortSignal: c.signal }), emit); break; }
    case "stalled": { const { time, advance } = createFakeClock(); const p = runClaudeSubscription(runId, subConfig(driver, { clockTime: time }), emit); await waitFor(() => driver.sessions.length === 1); advance(DEFAULT_STALL_MS); await p; break; }
    case "max_duration": { const { time, advance } = createFakeClock(); const p = runClaudeSubscription(runId, subConfig(driver, { clockTime: time, maxRunDurationMs: 25 }), emit); await waitFor(() => driver.sessions.length === 1); advance(25); await p; break; }
    case "wait_expired": { const { time, advance } = createFakeClock(); driver.onSend = (_t, s) => { s.emit({ type: "assistant_message", text: "a" }); s.emit(S_TURN_DONE); }; const turns: InteractiveTurns = { nextTurn: () => new Promise<string | null>(() => {}) }; const p = runClaudeSubscriptionInteractive(runId, subConfig(driver, { clockTime: time }), turns, emit); await waitFor(() => events.some((e) => e.type === "phase" && e.phase === "waiting_input")); advance(DEFAULT_WAIT_BUDGET_MS); await p; break; }
    case "max_cost": driver.onStart = (s) => { s.emit({ type: "assistant_message", text: "a" }); s.emit(S_BIG_TURN_DONE); }; await runClaudeSubscription(runId, subConfig(driver, { maxCostUsd: 0.0000001 }), emit); break;
    case "provider_error": driver.onStart = (s) => s.emit({ type: "error", message: "the model failed" }); await runClaudeSubscription(runId, subConfig(driver), emit); break;
    case "auth": await runClaudeSubscription(runId, subConfig(driver, { resolveAuth: () => null }), emit); break;
    case "rate_limit": driver.onStart = (s) => s.emit({ type: "limit_error", kind: "rate_limit", message: "usage limit reached" }); await runClaudeSubscription(runId, subConfig(driver), emit); break;
    default: throw new Error(`subscription cannot reach ${cause}`);
  }
  return events;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PART A — THE cause × executor MATRIX (Invariant 1 — HOLDS)
// ════════════════════════════════════════════════════════════════════════════════════════════════

const REACH: Record<"engine" | "subscription", TerminalCause[]> = {
  engine: ["user_stop", "stalled", "max_duration", "wait_expired", "max_turns", "max_tool_calls", "max_tokens", "max_context_tokens", "max_cost", "context_overflow", "provider_error", "auth", "rate_limit"],
  subscription: ["user_stop", "stalled", "max_duration", "wait_expired", "max_cost", "provider_error", "auth", "rate_limit"],
};
const DRIVERS = { engine: driveEngine, subscription: driveSubscription } as const;

for (const executor of ["engine", "subscription"] as const) {
  for (const cause of REACH[executor]) {
    test(`MATRIX [${executor} × ${cause}] emits EXACTLY terminalFor(${cause})`, async () => {
      const events = await DRIVERS[executor](cause);
      assert.deepEqual(terminalTripleOf(events), terminalFor(cause), `${executor} × ${cause}`);
    });
  }
}

test("MATRIX cross-executor identity: a shared cause yields a byte-identical terminal triple on every executor that reaches it", async () => {
  const shared: TerminalCause[] = ["user_stop", "stalled", "max_duration", "wait_expired", "provider_error", "rate_limit", "max_cost"];
  for (const cause of shared) {
    const reachers = (["engine", "subscription"] as const).filter((x) => REACH[x].includes(cause));
    assert.ok(reachers.length >= 2, `${cause} reachable by ≥2 executors`);
    const triples = await Promise.all(reachers.map((x) => DRIVERS[x](cause).then(terminalTripleOf)));
    for (let i = 1; i < triples.length; i++) assert.deepEqual(triples[i], triples[0], `${cause}: ${reachers[i]} vs ${reachers[0]}`);
    for (const t of triples) assert.deepEqual(t, terminalFor(cause), `${cause} != terminalFor`);
  }
});

test("MATRIX coverage: every TerminalCause is exercised somewhere (incl. session_ended via /end)", () => {
  const covered = new Set<TerminalCause>([...REACH.engine, ...REACH.subscription, "session_ended"]);
  for (const c of TERMINAL_CAUSES) assert.ok(covered.has(c), `cause ${c} not exercised`);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PART B — FIXED DEFECTS (Invariant 2 — coherence). Originally 3 intentionally-failing
//  CONFIRMED-DEFECT probes against the pre-fix implementation; WP1.R's adversarial findings were
//  root-caused and fixed (see the inline FIX notes below), so these now assert the CORRECT behavior
//  and stand as permanent regression guards against the same defects reappearing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("FIXED B1 [Inv2 · engine · WP1.R]: a SessionClock-fired terminal clears runs.phase (was STUCK at 'stopping')", async () => {
  // The engine's clock `onFire` emits {phase:'stopping'} before the terminal status; nothing emitted a
  // clearing {phase:null} after the terminal, so a stalled/max_duration/wait_expired run used to persist
  // phase='stopping' FOREVER.
  // FIXED (apps/api/src/testing/run-repository.ts `finalize()`): the terminal UPDATE now also
  // `SET phase = NULL`, centrally clearing any lingering phase on EVERY terminal disposition regardless
  // of executor.
  keepAlive();
  const db = seededDb();
  const repo = new RunRepository(db);
  const manager = new RunManager(repo);
  const runId = "def-b1";
  repo.createRun(runId, { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create(runId);
  await runAgentLoop(runId, engineBase({ model: mockGoesQuiet(), sessionClockOptions: { stallMs: 25 } }), (e, meta) => manager.emit(runId, e, meta));
  await flush(); await flush();
  const summary = repo.getSummary(runId);
  assert.equal(summary.status, "stopped", "the run is terminal (stopped/stalled)");
  assert.equal(summary.phase, undefined, "a terminal run carries NO lingering phase (null/absent, not 'stopping')");
});

test("FIXED B2 [Inv1/Inv2 · subscription · WP1.R]: a pre-aborted signal emits 'running' THEN 'aborted' and persists status='aborted' (was an orphan 'running')", async () => {
  // `startSessionLifecycle` used to fire the pre-abort guard (terminateWith('user_stop') → emits
  // 'aborted') BEFORE emitting the opening 'running' status. The trailing 'running' event then
  // OVERWROTE the finalized 'aborted' via the persistence sink's non-terminal branch → the run was left
  // persisted as `running` (an orphan). Reachable in production by STOPPING A QUEUED subscription run
  // (the executor awaits its concurrency permit at `acquireGate` BEFORE `startSessionLifecycle`, so
  // `control.abort` can already be aborted). FIXED (claude-subscription-executor.ts
  // `startSessionLifecycle`): 'running' (+ recordCapabilities + phase:null) now emits BEFORE
  // wiring/checking the abort signal, so a pre-aborted run's sequence is the coherent
  // 'running' → 'aborted'.
  const db = seededDb();
  const repo = new RunRepository(db);
  const manager = new RunManager(repo);
  const runId = "def-b2";
  repo.createRun(runId, { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create(runId);
  const events: RunEvent[] = [];
  manager.subscribe(runId, (e) => events.push(e));
  const ctrl = new AbortController();
  ctrl.abort();
  const driver = new FakeDriver();
  await runClaudeSubscription(runId, subConfig(driver, { abortSignal: ctrl.signal }), (e) => manager.emit(runId, e));
  await flush(); await flush();

  const statusSeq = events.filter((e): e is StatusEvent => e.type === "status").map((e) => e.status);
  // Coherence: the emitted sequence is EXACTLY 'running' then the terminal 'aborted' — not the other way
  // around, and nothing overwrites the terminal afterward.
  assert.deepEqual(statusSeq, ["running", "aborted"], `expected 'running' → 'aborted' — got ${JSON.stringify(statusSeq)}`);
  assert.ok(isTerminalStatus(statusSeq.at(-1) ?? "pending"), `the last status event must be terminal — got sequence ${JSON.stringify(statusSeq)}`);
  assert.equal(repo.getSummary(runId).status, "aborted", "the persisted status is the terminal 'aborted', not overwritten back to 'running'");
});

// ── B3 needs the RunService + routes harness (the `/end` path). ─────────────────────────────────────
type EndHarness = { app: FastifyInstance; testId: string; scenarioId: string; runService: RunService };
const endApps: FastifyInstance[] = [];
afterEach(async () => { for (const a of endApps.splice(0)) await a.close(); });
async function makeEndApp(model: MockLanguageModelV3): Promise<EndHarness> {
  const db = seededDb();
  // The seeded provider row has a placeholder key; re-insert a real encrypted one for the RunService.
  const secrets = new SecretStore(crypto.randomBytes(32));
  db.prepare("UPDATE provider_credentials SET api_key_encrypted = @k WHERE id = 'prov-1'").run({ k: secrets.encryptText("dummy") });
  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const scenarioRepo = new ScenarioRepository(db);
  const scans = new ScanRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans);
  const testRepo = new TestRepository(db);
  const testService = new TestService(testRepo);
  const scenario = scenarioRepo.create({ name: "B2", providerId: "prov-1", model: "claude-sonnet-4", params: {}, systemPrompt: "sys", allowedServers: [], defaultProfiles: ["generic_o200k"], guardrails: {} });
  const testRow = testService.create({ name: "Chat", userPrompt: "Hello.", systemPromptOverride: undefined, addedProfiles: [] });
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  const modelFactory: ModelFactory = (_c: DecryptedCredential) => model;
  const sessionOpener: SessionOpener = async () => stubMcp();
  const runService = new RunService(scenarioService, testService, providers, servers, oauthService, runManager, runRepo, modelFactory, sessionOpener);
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => { if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" }); const t = error as Error & { statusCode?: number }; return reply.code(t.statusCode ?? 500).send({ error: toErrorMessage(error) }); });
  await registerTestingRoutes(app, scenarioService, testService, runService, runRepo, runManager);
  endApps.push(app);
  return { app, testId: testRow.id, scenarioId: scenario.id, runService };
}

test("FIXED B3 [Inv2 · /end · WP1.R]: End session on a waiting_input run clears runs.phase (was STUCK at 'waiting_input')", async () => {
  // The `/end` route emits the `ended` terminal status but no phase clear, then `detachActiveRun` removes
  // the run from the manager — so the engine's own subsequent {phase:null} emit became a no-op, and
  // `finalize` never touched phase. An `ended` run used to be left reporting phase='waiting_input'. Same
  // root cause as B1: FIXED — `finalize()` now clears `phase = NULL` on the terminal write, so this
  // resolves for EVERY terminal path (all executors + `/end`), not just `/end`.
  const h = await makeEndApp(mockAnswerThenText());
  const res = await h.app.inject({ method: "POST", url: "/api/runs", payload: { testId: h.testId, scenarioId: h.scenarioId, mode: "interactive" } });
  const runId = (res.json() as { runId: string }).runId;
  for (let i = 0; i < 300 && !h.runService.isAwaitingInput(runId); i++) await tick(10);
  const mid = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  assert.equal((mid.json() as { phase?: string }).phase, "waiting_input", "genuinely waiting before /end");
  const end = await h.app.inject({ method: "POST", url: `/api/runs/${runId}/end` });
  assert.equal(end.statusCode, 202);
  for (let i = 0; i < 300 && h.runService.isActive(runId); i++) await tick(10);
  const after = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  const body = after.json() as { status: string; phase?: string };
  assert.equal(body.status, "ended");
  assert.equal(body.phase, undefined, "an 'ended' run must carry NO lingering phase (expected null/absent, got 'waiting_input')");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PART C — backward-compat: a pre-contract run + old event log still loads + replays (Invariant 3)
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("INV3 backward-compat: a pre-contract run (NULL phase/stopReasonCode/capabilities/durations) reads NULL-safe and replays", () => {
  const db = seededDb();
  const repo = new RunRepository(db);
  const runId = "old-run";
  // A run row as it existed BEFORE this workstream: only the pre-existing columns are set; every new
  // column is left at its NULL default (the ensureColumn migration adds them nullable for old rows).
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, stop_reason, started_at, ended_at, duration_ms, turns, tool_calls, peak_context_tokens, tokens_in, tokens_out, cost_usd)
     VALUES (@id,'t-1','s-1','automated','stopped','stopped_guardrail','maxTurns (20) reached',@n,@n,1234,20,3,900,400,120,0)`,
  ).run({ id: runId, n: NOW });
  // Old-shape event log: a terminal status event with NO stopReasonCode, and NO phase/ping events.
  const oldEvents = [
    { type: "status", status: "running" },
    { type: "kpi", turns: 20, toolCalls: 3, tokensIn: 400, tokensOut: 120, contextTokens: 900, costUsd: 0 },
    { type: "status", status: "stopped", outcome: "stopped_guardrail", stopReason: "maxTurns (20) reached" },
  ];
  oldEvents.forEach((ev, idx) =>
    db.prepare(`INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at) VALUES (@id,@r,@i,@t,@p,@n)`).run({ id: `e${idx}`, r: runId, i: idx, t: ev.type, p: JSON.stringify(ev), n: NOW }),
  );

  const detail: RunDetail = repo.getRun(runId);
  assert.equal(detail.status, "stopped");
  assert.equal(detail.outcome, "stopped_guardrail");
  // Every NEW field reads NULL-safe (absent / false), never throws.
  assert.equal(detail.phase, undefined);
  assert.equal(detail.stopReasonCode, undefined);
  assert.equal(detail.capabilities, undefined);
  assert.equal(detail.activeDurationMs, undefined);
  assert.equal(detail.totalDurationMs, undefined);
  assert.equal(detail.seen, false);
  assert.deepEqual(detail.openQuestions, [], "no open questions on an old run");
  // Old event JSON still parses back into the RunEvent union (the widened phase `| null` + additive
  // members are backward-compatible — an old log carries none of them).
  assert.equal(detail.events.length, 3);
  const lastStatus = [...detail.events].reverse().find((e): e is StatusEvent => e.type === "status");
  assert.equal(lastStatus?.status, "stopped");
  assert.equal((lastStatus as { stopReasonCode?: string }).stopReasonCode, undefined);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PART D — `ended` terminal everywhere + new guardrail causes gradeable + byte-identity (Invariant 4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("INV4 `ended` is terminal in the RunManager terminal set", () => {
  assert.equal(isTerminalStatus("ended"), true);
  for (const s of ["completed", "stopped", "error", "aborted"] as RunStatus[]) assert.equal(isTerminalStatus(s), true);
});

test("INV4 `ended` is treated as terminal by orphan reconcile (a crashed-mid-review 'ended' run settles its rating)", () => {
  const db = seededDb();
  const repo = new RunRepository(db);
  repo.createRun("r-ended", { testId: "t-1", scenarioId: "s-1", mode: "interactive" });
  db.prepare("UPDATE runs SET status='ended', outcome='ended', rating_state='rating' WHERE id='r-ended'").run();
  repo.abortOrphanedRuns();
  assert.equal(repo.getSummary("r-ended").ratingState, "skipped", "'ended' + mid-review → rating settled to skipped");
  assert.equal(repo.getSummary("r-ended").status, "ended", "abortOrphanedRuns never touches an 'ended' status");
});

test("INV4 the NEW guardrail causes stay gradeable — every one maps to the existing stopped/stopped_guardrail terminal", () => {
  for (const cause of ["stalled", "wait_expired", "max_duration", "max_tool_calls"] as TerminalCause[]) {
    const v = terminalFor(cause);
    assert.equal(v.status, "stopped", `${cause} → stopped`);
    assert.equal(v.outcome, "stopped_guardrail", `${cause} → stopped_guardrail (the shape graders already handle)`);
  }
});

test("FLAGGED (NON-ISSUE): error-forensics on a clean `ended` run yields ZERO findings (an ended session is a clean terminal, not an error)", () => {
  // The local `TERMINAL_STATUSES` in grading/error-forensics.ts omits `ended` — but an `ended` run is a
  // CLEAN terminal (operator closed the session), so it correctly produces no run-level error finding.
  // `extractErrorInventory` returns [] and `isAbnormalTermination` (outcome/status 'error' only) is false.
  // Verdict: correct-by-design; the local set's divergence from `isTerminalStatus` is a harmless latent
  // trap, not a current defect.
  const endedRun = {
    id: "e", testId: "t", scenarioId: "s", mode: "interactive", status: "ended", outcome: "ended",
    startedAt: NOW, turns: 1, toolCalls: 0, peakContextTokens: 10, tokensIn: 5, tokensOut: 5, costUsd: 0,
    ratingState: "pending", seen: false,
    steps: [
      { id: "s0", runId: "e", index: 0, type: "user_message", label: "user", status: "ok", profileTokens: {}, payload: { text: "hi" } },
      { id: "s1", runId: "e", index: 1, type: "llm_response", label: "m", status: "ok", profileTokens: {}, assistantText: "hello", payload: null },
    ],
    events: [
      { type: "status", status: "running" },
      { type: "status", status: "ended", outcome: "ended", stopReasonCode: "session_ended" },
    ],
    skills: [], openQuestions: [],
  } as unknown as RunDetail;
  assert.deepEqual(extractErrorInventory(endedRun), [], "a clean ended run has no error inventory");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PART E — capabilities + durations persist for all 3 kinds (D-US4/D-US3, incl. WP1.7 COALESCE fix)
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("INV5 engine: capabilities (persisted like the run-service does) + terminal durations round-trip to GET-shaped summary", async () => {
  const db = seededDb();
  const repo = new RunRepository(db);
  const manager = new RunManager(repo);
  const runId = "cap-eng";
  repo.createRun(runId, { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create(runId);
  repo.setCapabilities(runId, ENGINE_SESSION_CAPABILITIES); // the run-service does exactly this for api kinds
  await runAgentLoop(runId, engineBase({ model: mockStopsImmediately() }), (e, meta) => manager.emit(runId, e, meta));
  await flush(); await flush();
  const s = repo.getSummary(runId);
  assert.deepEqual(s.capabilities, ENGINE_SESSION_CAPABILITIES);
  assert.equal(typeof s.activeDurationMs, "number", "engine durations arrive via the terminal emit's meta");
  assert.equal(typeof s.totalDurationMs, "number");
});

test("INV5 subscription (WP1.7 COALESCE): recordDurations survives the meta-less terminal finalize — NOT clobbered to NULL", async () => {
  const db = seededDb();
  const repo = new RunRepository(db);
  const manager = new RunManager(repo);
  const runId = "cap-sub";
  repo.createRun(runId, { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create(runId);
  const capsSeen: SessionCapabilities[] = [];
  const driver = new FakeDriver();
  driver.onStart = (s) => { s.emit({ type: "assistant_message", text: "done" }); s.emit(S_TURN_DONE); };
  await runClaudeSubscription(runId, subConfig(driver, {
    recordCapabilities: (c) => { capsSeen.push(c); repo.setCapabilities(runId, c); },
    recordDurations: (d) => repo.recordDurations(runId, d),
  }), (e) => manager.emit(runId, e)); // NOTE: emit forwards NO meta (subscription's own path)
  await flush(); await flush();
  const s = repo.getSummary(runId);
  assert.equal(s.capabilities?.costBasis, "subscription_reference", "the subscription manifest persisted");
  assert.equal(typeof s.activeDurationMs, "number", "recordDurations value survived the meta-less finalize (COALESCE, WP1.7)");
  assert.equal(typeof s.totalDurationMs, "number");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PART F — user_stop distinguishability (finish-toast suppression backbone, WP1.6/WP3.3)
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("FLAGGED user_stop distinguishability: markUserInitiatedStop/wasUserInitiatedStop is a manager-level flag any executor's run can carry (read before settle)", () => {
  // The finish-toast suppression (WP3.3) reads `wasUserInitiatedStop` — a RunManager flag set by the
  // `/stop` and `/end` routes BEFORE the terminal, independent of which executor produced the run. It is
  // NOT re-derived from stopReasonCode string-sniffing, so it works identically for engine and
  // subscription runs. Verify the round-trip + the read-before-settle contract.
  const db = seededDb();
  const repo = new RunRepository(db);
  const manager = new RunManager(repo);
  for (const runId of ["f-eng", "f-sub"]) {
    repo.createRun(runId, { testId: "t-1", scenarioId: "s-1", mode: "interactive" });
    manager.create(runId);
    assert.equal(manager.wasUserInitiatedStop(runId), false, "false before marking");
    manager.markUserInitiatedStop(runId);
    assert.equal(manager.wasUserInitiatedStop(runId), true, "true after marking (any executor's run)");
  }
  // Unknown/settled run: false, never throws.
  assert.equal(manager.wasUserInitiatedStop("nope"), false);
  assert.doesNotThrow(() => manager.markUserInitiatedStop("nope"));
});
