import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition, RunEvent } from "@mcp-token-footprint/shared";
import { RUN_OUTCOMES, RUN_STATUSES } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { McpSession } from "../src/mcp/client.js";
import { runAgentLoop, type AccountingHooks, type EngineConfig } from "../src/testing/engine.js";
import { AccountingSink } from "../src/testing/accounting.js";
import { RunManager } from "../src/testing/run-manager.js";
import { createDefaultStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as agent-loop.test.ts / accounting.test.ts — no extra dependency, always matches the SDK).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

// ── Test doubles (no API key, no child process — the WP 1.3 stub pattern) ───────────────────────
//
// This file is the SINGLE consolidated lock for the run state machine: it exercises ALL terminal
// transitions in one place — pending→running→completed, stop→aborted, overflow→context_overflow, and
// the (transport/stream) error path — driving the REAL engine with the mock model + stub MCP session.
// The individual behaviors are also asserted in their feature suites (agent-loop / accounting /
// run-stream-routes); this file proves the transitions are coherent as ONE machine and pins the
// engine-level abort path that the route-level `/stop` test (run-stream-routes) exercises end-to-end.

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string, args: Record<string, unknown>) => {
      if (args.mode === "transport_error") throw new Error("simulated MCP transport failure");
      return { content: [{ type: "text", text: `${name}:ok` }] };
    },
    close: async () => undefined,
  };
}

const TOOL_DEFS: NormalizedToolDefinition[] = [
  { name: "alpha", description: "Alpha tool", inputSchema: { type: "object" }, raw: {} },
];

function defFor(name: string): NormalizedToolDefinition {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no def for ${name}`);
  return def;
}

const USAGE = {
  inputTokens: { total: 30, noCache: 30, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 8, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[], chunkDelayInMs: number | null = null) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs }) };
}

/** Model: one tool call, then a final answer (the completed happy path). */
function mockToolThenAnswer() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "alpha",
            input: JSON.stringify({ x: 1 }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "The final answer." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

/** Model: one tool call (transport_error sentinel → the stub session throws), then an answer. */
function mockTransportErrorThenAnswer() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "alpha",
            input: JSON.stringify({ mode: "transport_error" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "done" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

/** Model that throws a provider context-limit error from doStream (the overflow path). */
function mockContextOverflow() {
  return new MockLanguageModelV3({
    doStream: async () => {
      throw new Error("prompt is too long: 250000 tokens > 200000 maximum context length");
    },
  });
}

/** Slow single-turn model so the run is provably LIVE while a test aborts mid-stream. */
function mockSlowAnswer() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf(
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "thinking" },
          { type: "text-delta", id: "t1", delta: " slowly" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ],
        200, // 200ms between chunks → plenty of time to abort mid-stream
      ),
  });
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
    userPrompt: "Use the tools, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    modelId: "claude-sonnet-4",
    providerKind: "anthropic",
    ...over,
  };
}

function statusEvents(events: RunEvent[]): Array<Extract<RunEvent, { type: "status" }>> {
  return events.filter((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
}

function lastStatus(events: RunEvent[]): Extract<RunEvent, { type: "status" }> | undefined {
  return [...statusEvents(events)].pop();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Contract sanity: the status/outcome vocabulary the transitions below land on ─────────────────

test("the run status + outcome vocabulary is exactly the shared contract enum", () => {
  // The transitions exercised below land on these terminal states; pin the vocabulary so a contract
  // drift (a renamed/removed status or outcome) is caught here, in the machine's home file.
  assert.deepEqual(
    [...RUN_STATUSES],
    // Unified Sessions WP1.1 (D-US2): `ended` appended — the operator-ended interactive-session
    // terminal. Appended, never reordered; the boot + four original terminal states are unmoved.
    ["pending", "running", "completed", "stopped", "error", "aborted", "ended"],
    "run statuses are the boot + four terminal states + the ended session terminal",
  );
  for (const outcome of [
    "completed",
    "aborted",
    "context_overflow",
    "error",
    "stopped_guardrail",
    // Unified Sessions WP1.1 (D-US2) — the ended-session outcome partner.
    "ended",
  ]) {
    assert.ok(
      (RUN_OUTCOMES as readonly string[]).includes(outcome),
      `outcome '${outcome}' is in the contract`,
    );
  }
});

// ── Transition 1: pending → running → completed (the happy path) ─────────────────────────────────

test("state machine — pending → running → completed (the run reaches a terminal completed status)", async () => {
  const { manager, events } = collect();
  const runId = "sm-completed";
  // create() registers the run; before any event it is 'pending' (the boot state).
  manager.create(runId);
  assert.equal(manager.status(runId), "pending", "a freshly created run boots in 'pending'");
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));

  const result = await runAgentLoop(
    runId,
    baseConfig({ model: mockToolThenAnswer(), tools }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");

  const statuses = statusEvents(events).map((e) => e.status);
  assert.equal(statuses[0], "running", "the first status emitted is 'running'");
  assert.equal(statuses.at(-1), "completed", "the run ends on 'completed'");
  assert.deepEqual(
    statuses,
    ["running", "completed"],
    "pending(boot) → running → completed, no others",
  );
  // AR11 — the manager now stays registered through the post-terminal REVIEW window and cleans up
  // once a SETTLED `rating` event lands on top of the terminal status (the run service guarantees one).
  assert.equal(manager.isActive(runId), true, "the manager stays registered for the review window");
  manager.emit(runId, { type: "rating", state: "skipped" });
  assert.equal(manager.isActive(runId), false, "the manager cleaned up after the settled rating");
});

// ── Transition 2: running → aborted (engine-level abortSignal — the /stop machinery's core) ──────

test("state machine — running → aborted when the abort signal fires mid-stream", async () => {
  const { manager, events } = collect();
  const runId = "sm-aborted";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  // Drive the engine directly with an AbortController — this is exactly what RunService.stop() trips
  // (the route-level POST /stop path is covered end-to-end in run-stream-routes.test.ts). Abort once
  // the run is provably streaming (the slow model keeps it live), so we exercise the mid-stream abort.
  const controller = new AbortController();
  manager.subscribe(runId, (e) => {
    if (e.type === "status" && e.status === "running") {
      // Abort a beat after 'running' so the stream is in-flight when the signal fires.
      void delay(20).then(() => controller.abort());
    }
  });

  const result = await runAgentLoop(
    runId,
    baseConfig({ model: mockSlowAnswer(), tools: {}, abortSignal: controller.signal }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "aborted", "an abort lands on the terminal 'aborted' status");
  assert.equal(result.outcome, "aborted", "the outcome is 'aborted'");

  const last = lastStatus(events);
  assert.equal(last?.status, "aborted", "the terminal status event is 'aborted'");
  assert.equal(last?.outcome, "aborted");
  // An abort is NOT an error: no generic `error` RunEvent is emitted.
  assert.ok(!events.some((e) => e.type === "error"), "a clean abort emits no error event");
  // AR11 — terminal alone no longer drops the run; a settled rating event completes the cleanup.
  assert.equal(manager.isActive(runId), true, "the manager stays registered for the review window");
  manager.emit(runId, { type: "rating", state: "skipped" });
  assert.equal(manager.isActive(runId), false, "the manager cleaned up after the settled rating");
});

// ── Transition 3: running → stopped/context_overflow (a provider context-limit error) ────────────

test("state machine — running → stopped with outcome context_overflow on a provider context-limit error", async () => {
  const { manager, events } = collect();
  const runId = "sm-overflow";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const accounting = new AccountingSink(
    {
      runId,
      profiles: ["generic_o200k"],
      system: "You are a test harness.",
      allowedTools: allowed.map((a) => a.def),
      model: "claude-sonnet-4",
      providerKind: "anthropic",
    },
    (e) => manager.emit(runId, e),
  );
  const hooks: AccountingHooks = {
    onLlmStep: async () => undefined,
    onOverflow: (message) => accounting.emitOverflowStep(message),
    // F3 — the engine's FINAL kpi reads the accounting sink's rolled-up totals (single KPI source).
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

  const result = await runAgentLoop(
    runId,
    baseConfig({ model: mockContextOverflow(), tools: {}, accounting: hooks }),
    (e) => manager.emit(runId, e),
  );

  // Overflow is a LEGITIMATE result (status stopped, outcome context_overflow), never an `error`.
  assert.equal(result.outcome, "context_overflow");
  assert.notEqual(result.status, "error", "context overflow is not the error terminal");

  const last = lastStatus(events);
  assert.equal(last?.status, "stopped", "overflow lands on the 'stopped' status");
  assert.equal(last?.outcome, "context_overflow", "the terminal outcome is context_overflow");
  assert.ok(!events.some((e) => e.type === "error"), "overflow emits no generic error event");
  // AR11 — terminal alone no longer drops the run; a settled rating event completes the cleanup.
  manager.emit(runId, { type: "rating", state: "skipped" });
  assert.equal(manager.isActive(runId), false, "the manager cleaned up after the settled rating");
});

// ── Transition 4: running → error (a fatal MCP transport failure during a tool call) ─────────────

test("state machine — running → error on a fatal MCP transport failure", async () => {
  const { manager, events } = collect();
  const runId = "sm-error";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  let transportError: string | undefined;
  const tools = buildTools(
    [{ serverId: "srv", def: defFor("alpha") }],
    sessions,
    createDefaultStepSink(manager, runId),
    (message) => {
      transportError ??= message;
    },
  );

  const result = await runAgentLoop(
    runId,
    baseConfig({
      model: mockTransportErrorThenAnswer(),
      tools,
      getTransportError: () => transportError,
    }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "error", "a transport failure lands on the 'error' terminal");
  assert.equal(result.outcome, "error");

  // An `error` RunEvent is emitted (the UI surfaces the cause) and the terminal status is 'error'.
  const errorEvent = events.find(
    (e): e is Extract<RunEvent, { type: "error" }> => e.type === "error",
  );
  assert.ok(errorEvent, "an error RunEvent was emitted with the cause");
  assert.match(errorEvent.message, /transport failure/i);

  const last = lastStatus(events);
  assert.equal(last?.status, "error", "the terminal status event is 'error'");
  assert.equal(last?.outcome, "error");
  // AR11 — terminal alone no longer drops the run; a settled rating event completes the cleanup.
  manager.emit(runId, { type: "rating", state: "skipped" });
  assert.equal(manager.isActive(runId), false, "the manager cleaned up after the settled rating");
});

// ── Whole machine: every transition begins at 'running' and ends at exactly ONE terminal ─────────

test("every transition emits a single leading 'running' and exactly one terminal status", async () => {
  // Re-drive two of the paths and assert the invariant that holds for ALL of them: the status rail is
  // [running, <one terminal>] with no second terminal and no out-of-order status.
  const terminals = new Set<string>();
  for (const [name, drive] of [
    [
      "completed",
      async () => {
        const { manager, events } = collect();
        const runId = "rail-completed";
        manager.create(runId);
        manager.subscribe(runId, (e) => events.push(e));
        const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
        const tools = buildTools(
          [{ serverId: "srv", def: defFor("alpha") }],
          sessions,
          createDefaultStepSink(manager, runId),
        );
        await runAgentLoop(runId, baseConfig({ model: mockToolThenAnswer(), tools }), (e) =>
          manager.emit(runId, e),
        );
        return statusEvents(events).map((e) => e.status);
      },
    ],
    [
      "error",
      async () => {
        const { manager, events } = collect();
        const runId = "rail-error";
        manager.create(runId);
        manager.subscribe(runId, (e) => events.push(e));
        const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
        let te: string | undefined;
        const tools = buildTools(
          [{ serverId: "srv", def: defFor("alpha") }],
          sessions,
          createDefaultStepSink(manager, runId),
          (m) => {
            te ??= m;
          },
        );
        await runAgentLoop(
          runId,
          baseConfig({ model: mockTransportErrorThenAnswer(), tools, getTransportError: () => te }),
          (e) => manager.emit(runId, e),
        );
        return statusEvents(events).map((e) => e.status);
      },
    ],
  ] as const) {
    const rail = await drive();
    assert.equal(rail[0], "running", `${name}: the rail starts with 'running'`);
    const terminalCount = rail.filter((s) =>
      ["completed", "stopped", "error", "aborted"].includes(s),
    ).length;
    assert.equal(terminalCount, 1, `${name}: exactly one terminal status is emitted`);
    terminals.add(rail.at(-1)!);
  }
  // The two sampled paths land on distinct terminals (a coherent machine, not a single sink state).
  assert.ok(terminals.has("completed") && terminals.has("error"), "distinct terminals reached");
});
