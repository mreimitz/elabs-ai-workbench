// Unified Sessions (roadmap/unified-sessions/, WP1.3) — engine-level SessionClock lifecycle tests.
//
// Drives the REAL `runAgentLoop` (mock model + stub MCP session, per the WP1.3 stub pattern — no API
// key, no child process, no real tenant) through every new terminal cause the engine now resolves via
// `terminalFor`: the SessionClock firing (stalled / wait_expired / max_duration), the budget-meter →
// StopReasonCode mapping (incl. the documented `maxToolCalls` gap), the turn cap, a clean completion,
// a user stop, and the `ask_user` wait sharing the SAME clock a `nextTurn` wait uses.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition, RunEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { McpSession } from "../src/mcp/client.js";
import { runAgentLoop, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";
import { createDefaultStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";
import {
  ASK_USER_TOOL,
  buildAskUserAiTool,
  type AskUserBridge,
} from "../src/testing/ask-user-tool.js";
import { SessionClock } from "../src/testing/session-clock.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

function streamOf(chunks: LanguageModelV3StreamPart[], chunkDelayInMs: number | null = null) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs }) };
}

const USAGE = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

/**
 * A model whose SECOND chunk arrives after any short stall/cap window under test, so the SessionClock
 * (not the model) is what LATCHES the fired cause. `MockLanguageModelV3`/`simulateReadableStream`
 * do NOT actually respect an aborted signal mid-delay (a test-double limitation — a real provider's
 * live HTTP call genuinely IS cut off by `streamText`'s `abortSignal` in production; this mirrors
 * `run-state-machine.test.ts`'s existing user-abort test, which has the same characteristic: the
 * mock runs to completion regardless, and the ALREADY-fired/aborted flag is what the final check
 * reports). So `afterMs` only needs to clear the clock window comfortably — it is NOT proof of an
 * early cutoff, just of the correct terminal classification once the loop does exit.
 */
function mockGoesQuiet(afterMs = 120) {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf(
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "..." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ],
        afterMs,
      ),
  });
}

/** A model that stops immediately (finishReason "stop", no tool calls) — the opener-then-wait shape. */
function mockStopsImmediately() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
      ]),
  });
}

/** A model that calls `alpha` on every step and never finishes on its own (drives budget/turn caps). */
function mockAlwaysCallsTool() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      return streamOf([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: `c${call}`,
          toolName: "alpha",
          input: JSON.stringify({ n: call }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
      ]);
    },
  });
}

const TOOL_DEFS: NormalizedToolDefinition[] = [
  { name: "alpha", description: "Alpha tool", inputSchema: { type: "object" }, raw: {} },
];

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

function collect(): { manager: RunManager; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const manager = new RunManager();
  return { manager, events };
}

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Go.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    modelId: "claude-sonnet-4",
    providerKind: "anthropic",
    ...over,
  };
}

function lastStatus(events: RunEvent[]) {
  return [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
}

function phaseEvents(events: RunEvent[]) {
  return events.filter((e): e is Extract<RunEvent, { type: "phase" }> => e.type === "phase");
}

/**
 * SessionClock's REAL timers are deliberately `unref()`'d (session-clock.ts — a pending SessionClock
 * timer must never by itself keep the Node process alive past an otherwise-finished run). A test whose
 * ONLY pending work is that unref'd timer can race the Node test-runner's own stall detection (see
 * `session-clock`'s own `REAL_SESSION_CLOCK_TIME` doc + the old engine.ts idle-timeout's explicit
 * "not unref'd" comment this replaces). A short REF'd keep-alive, well past the window under test,
 * gives the unref'd clock timer a chance to actually fire without holding the suite up noticeably.
 */
function keepEventLoopAlive(ms = 300): void {
  setTimeout(() => undefined, ms);
}

// ── SessionClock fire → terminalFor: stalled ──────────────────────────────────────────────────────

test("stall fire: no events for the stall window while running → stopped/stopped_guardrail/stalled", async () => {
  keepEventLoopAlive();
  const { manager, events } = collect();
  const runId = "run-stalled";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const result = await runAgentLoop(
    runId,
    baseConfig({ model: mockGoesQuiet(), tools: {}, sessionClockOptions: { stallMs: 20 } }),
    (e, meta) => manager.emit(runId, e, meta),
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /stall/i, "the stall cause names itself");

  const status = lastStatus(events);
  assert.equal(status?.stopReasonCode, "stalled");
});

// ── SessionClock fire → terminalFor: max_duration (opt-in wall cap) ──────────────────────────────

test("wall-cap fire (guardrails.maxRunDurationMs) → stopped/stopped_guardrail/max_duration", async () => {
  keepEventLoopAlive();
  const { manager, events } = collect();
  const runId = "run-max-duration";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const result = await runAgentLoop(
    runId,
    baseConfig({
      model: mockGoesQuiet(),
      tools: {},
      guardrails: { maxRunDurationMs: 20 },
    }),
    (e, meta) => manager.emit(runId, e, meta),
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /max duration/i);

  const status = lastStatus(events);
  assert.equal(status?.stopReasonCode, "max_duration");
});

test("no guardrails.maxRunDurationMs configured → no wall cap fires (D-US3: off by default)", async () => {
  // A model that answers well within any reasonable test timeout, with NO maxRunDurationMs set: if the
  // engine still defaulted to a 30-min cap internally this would be indistinguishable from today, so
  // this only really proves the config plumbs through; the `max_duration` fire itself is proven above.
  const { manager } = collect();
  const runId = "run-no-cap";
  manager.create(runId);

  const result = await runAgentLoop(runId, baseConfig({ model: mockStopsImmediately(), tools: {} }), (e) =>
    manager.emit(runId, e),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
});

// ── Budget meters → terminalFor's StopReasonCode mapping (incl. maxToolCalls, WP1.7) ─────────────

test("guardrail meters map to their StopReasonCode via terminalFor (maxTokens/maxContextTokens/maxCostUsd/maxToolCalls)", async () => {
  async function runUnderGuardrail(runId: string, guardrails: EngineConfig["guardrails"]) {
    const { manager, events } = collect();
    manager.create(runId);
    manager.subscribe(runId, (e) => events.push(e));
    const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
    const allowed: AllowedTool[] = [{ serverId: "srv", def: TOOL_DEFS[0]! }];
    const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));
    const result = await runAgentLoop(
      runId,
      baseConfig({ model: mockAlwaysCallsTool(), tools, guardrails }),
      (e, meta) => manager.emit(runId, e, meta),
    );
    return { result, status: lastStatus(events) };
  }

  const tokens = await runUnderGuardrail("run-map-tokens", { maxTokens: 1 });
  assert.equal(tokens.status?.stopReasonCode, "max_tokens");
  assert.equal(tokens.result.status, "stopped");
  assert.equal(tokens.result.outcome, "stopped_guardrail");

  const context = await runUnderGuardrail("run-map-context", { maxContextTokens: 1 });
  assert.equal(context.status?.stopReasonCode, "max_context_tokens");

  const cost = await runUnderGuardrail("run-map-cost", { maxCostUsd: 0.0000001 });
  assert.equal(cost.status?.stopReasonCode, "max_cost");

  // WP1.7 closed the WP1.1 contract gap: `maxToolCalls` now maps to its own dedicated `max_tool_calls`
  // StopReasonCode, the same guardrail-stop shape every other budget meter gets.
  const toolCalls = await runUnderGuardrail("run-map-toolcalls", { maxToolCalls: 1 });
  assert.equal(toolCalls.result.status, "stopped");
  assert.equal(toolCalls.result.outcome, "stopped_guardrail");
  assert.equal(toolCalls.status?.stopReasonCode, "max_tool_calls");
});

test("the turn cap (stepCountIs default) maps to stopReasonCode max_turns", async () => {
  const { manager, events } = collect();
  const runId = "run-max-turns";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));
  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: TOOL_DEFS[0]! }];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));

  const result = await runAgentLoop(
    runId,
    baseConfig({ model: mockAlwaysCallsTool(), tools, maxTurns: 3, guardrails: {} }),
    (e, meta) => manager.emit(runId, e, meta),
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(lastStatus(events)?.stopReasonCode, "max_turns");
});

// ── User stop → terminalFor: user_stop ────────────────────────────────────────────────────────────

test("an aborted (user-stopped) run maps to stopReasonCode user_stop", async () => {
  const { manager, events } = collect();
  const runId = "run-user-stop";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const controller = new AbortController();
  controller.abort(); // pre-aborted — deterministic, no timing race needed

  const result = await runAgentLoop(
    runId,
    baseConfig({ model: mockStopsImmediately(), tools: {}, abortSignal: controller.signal }),
    (e, meta) => manager.emit(runId, e, meta),
  );

  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(lastStatus(events)?.stopReasonCode, "user_stop");
});

// ── waiting_input phase + duration meta on a clean completion ────────────────────────────────────

test("a completed run carries no stopReasonCode and its terminal status emits duration meta", async () => {
  const { manager, events } = collect();
  const metas: Array<{ activeDurationMs?: number; totalDurationMs?: number } | undefined> = [];
  const runId = "run-completed-meta";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const result = await runAgentLoop(runId, baseConfig({ model: mockStopsImmediately(), tools: {} }), (e, meta) => {
    if (e.type === "status") metas.push(meta);
    manager.emit(runId, e, meta);
  });

  assert.equal(result.status, "completed");
  assert.equal(lastStatus(events)?.stopReasonCode, undefined);
  const terminalMeta = metas.at(-1);
  assert.ok(terminalMeta, "the terminal status emit carried a meta object");
  assert.equal(typeof terminalMeta?.activeDurationMs, "number");
  assert.equal(typeof terminalMeta?.totalDurationMs, "number");

  // The very first event is the "starting" phase, immediately followed by "running", immediately
  // followed by a WP1.7 `phase:null` clear so `starting` never lingers once the run is ordinarily
  // running (the invariant: `runs.phase` is null while running normally).
  assert.equal(events[0]?.type, "phase");
  assert.equal((events[0] as Extract<RunEvent, { type: "phase" }>).phase, "starting");
  assert.equal(events[1]?.type, "status");
  assert.equal(events[2]?.type, "phase");
  assert.equal((events[2] as Extract<RunEvent, { type: "phase" }>).phase, null);
});

// ── waiting_input enter/resume around a nextTurn wait, resumed (not expired) ──────────────────────

test("waiting_input enters (reason: next_turn) and resumes (phase cleared, WP1.7) when the next turn arrives in time", async () => {
  const { manager, events } = collect();
  const runId = "run-resume";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  // One real follow-up turn, then `null` to end the conversation — the model stops immediately on
  // EVERY pass, so without an eventual `null` this would loop forever (interactive nextTurn ∘ model
  // stop is otherwise an infinite cycle).
  let turnCount = 0;
  const interactive = {
    nextTurn: () => {
      turnCount += 1;
      return Promise.resolve<string | null>(turnCount === 1 ? "thanks, done" : null);
    },
  };
  const model = new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
      ]),
  });

  const result = await runAgentLoop(
    runId,
    baseConfig({ model, tools: {}, interactive }),
    (e, meta) => manager.emit(runId, e, meta),
  );

  assert.equal(result.status, "completed", "the conversation ends normally once nextTurn resolves null");
  const waiting = phaseEvents(events).filter((e) => e.phase === "waiting_input");
  // One wait per nextTurn call: the first resumes with a real turn, the second resumes into the
  // null-ending check (still a normal "resume", not a clock fire — see the resumeFromWaiting guard).
  assert.equal(waiting.length, 2, "one waiting_input phase per nextTurn call");
  assert.ok(
    waiting.every((e) => e.detail?.reason === "next_turn"),
    "both waits are the next_turn reason",
  );
  // WP1.7 — a resumed (non-fired) wait now emits a real `{type:"phase",phase:null}` clear through the
  // normal choke point (replacing the old `cfg.clearPhase` direct-DB-write escape hatch): one clear
  // after `starting`→`running`, plus one per resumed wait (neither wait was a clock fire).
  const clears = phaseEvents(events).filter((e) => e.phase === null);
  assert.equal(clears.length, 3, "starting→running clear + one clear per resumed wait");
});

// ── ask_user wait shares the SAME clock as a nextTurn wait: wait_expired ends the run ─────────────

test("ask_user's wait shares the engine's SessionClock: an expired wait budget ends the run as wait_expired", async () => {
  keepEventLoopAlive();
  const { manager, events } = collect();
  const runId = "run-ask-user-wait-expired";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  let clock: SessionClock | undefined;
  let clockAbortSignal: AbortSignal | undefined;
  const bridge: AskUserBridge = {
    emit: (event) => manager.emit(runId, event),
    newQuestionId: () => "q1",
    // Never resolves on its own — only a clock fire (or a stop) should unblock it.
    waitForAnswer: (questionId) =>
      new Promise<string | null>((resolve) => {
        void questionId;
        clockAbortSignal?.addEventListener("abort", () => resolve(null), { once: true });
        if (clockAbortSignal?.aborted) resolve(null);
      }),
    enterWaiting: () => {
      clock?.enterWaiting();
      return clock?.deadlineAt;
    },
    resumeFromWaiting: () => {
      if (!clock?.fired) clock?.resumeFromWaiting();
    },
  };

  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: ASK_USER_TOOL,
            input: JSON.stringify({ question: "Which one?" }),
          },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
        ]);
      }
      // Never actually reached — the wait budget expires before the model is asked again.
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
      ]);
    },
  });

  const tools = buildAskUserAiTool(bridge);
  const result = await runAgentLoop(
    runId,
    baseConfig({
      model,
      tools,
      sessionClockOptions: { waitBudgetMs: 20 },
      onSessionClockReady: (c, signal) => {
        clock = c;
        clockAbortSignal = signal;
      },
    }),
    (e, meta) => manager.emit(runId, e, meta),
  );

  assert.equal(result.status, "stopped", "the ask_user wait was cut short by the SAME clock's wait budget");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(lastStatus(events)?.stopReasonCode, "wait_expired");

  const waiting = phaseEvents(events).find((e) => e.phase === "waiting_input" && e.detail?.reason === "question");
  assert.ok(waiting, "a waiting_input(question) phase fired for the ask_user wait");
  assert.equal(call, 1, "the model was never asked a second time — the wait never resolved with an answer");
});
