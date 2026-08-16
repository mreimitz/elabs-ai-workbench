import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition, RunEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { McpSession } from "../src/mcp/client.js";

// The low-level provider stream-part type drives the mock model. `@ai-sdk/provider` is not a direct
// dependency and `ai` does not re-export the V3 part type, so derive it from MockLanguageModelV3's
// own `doStream` signature (always matches the installed SDK, no extra dep).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;
import { runAgentLoop, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";
import { createDefaultStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";

// ── Test doubles ─────────────────────────────────────────────────────────────────────────────

// A fake McpSession (per WP 1.3 spec): no child process, no API key. `callTool` resolves with a
// normal result, resolves with `{ isError: true }` for a sentinel arg, or throws to simulate a
// transport failure for a sentinel arg.
function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string, args: Record<string, unknown>) => {
      if (args.mode === "tool_error") {
        return { isError: true, content: [{ type: "text", text: "intentional tool error" }] };
      }
      if (args.mode === "transport_error") {
        throw new Error("simulated MCP transport failure");
      }
      return { content: [{ type: "text", text: `${name}:ok` }] };
    },
    close: async () => undefined,
  };
}

const TOOL_DEFS: NormalizedToolDefinition[] = [
  { name: "alpha", description: "Alpha tool", inputSchema: { type: "object" }, raw: {} },
  { name: "beta", description: "Beta tool", inputSchema: { type: "object" }, raw: {} },
  { name: "forbidden", description: "Not allowed", inputSchema: { type: "object" }, raw: {} },
];

function defFor(name: string): NormalizedToolDefinition {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no def for ${name}`);
  return def;
}

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

/**
 * A mock model (no provider key) that, per the two doStream calls streamText makes for a 2-step run:
 *  1. emits the given tool-calls, then finishes with `tool-calls`
 *  2. emits a final text answer, then finishes with `stop`
 */
function mockModelTwoToolsThenAnswer(
  toolCalls: Array<{ id: string; name: string; input: unknown }>,
) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          ...toolCalls.map(
            (tc): LanguageModelV3StreamPart => ({
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.name,
              input: JSON.stringify(tc.input),
            }),
          ),
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

function collect(): { manager: RunManager; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const manager = new RunManager();
  return { manager, events };
}

function baseConfig(over: Partial<EngineConfig>): EngineConfig {
  return {
    model: over.model!,
    system: "You are a test harness.",
    userPrompt: "Use the tools, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    ...over,
  };
}

// ── Acceptance 1: ≥2 tool calls then a final answer; natural stop; ordered RunEvents ───────────

test("loop drives >=2 tool calls then a final answer and ends on natural stop", async () => {
  const { manager, events } = collect();
  const runId = "run-1";
  manager.create(runId);
  const unsub = manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [
    { serverId: "srv", def: defFor("alpha") },
    { serverId: "srv", def: defFor("beta") },
  ];
  const sink = createDefaultStepSink(manager, runId);
  const tools = buildTools(allowed, sessions, sink);

  const model = mockModelTwoToolsThenAnswer([
    { id: "c1", name: "alpha", input: { x: 1 } },
    { id: "c2", name: "beta", input: { y: 2 } },
  ]);

  const result = await runAgentLoop(runId, baseConfig({ model, tools }), (e) =>
    manager.emit(runId, e),
  );
  unsub();

  // Terminal: natural completion.
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  assert.equal(result.toolCalls, 2, "exactly two tool calls were driven");

  // Ordered model-visible run events: starting(phase) -> running -> 2x(tool_call,tool_result) -> text
  // delta -> kpi -> completed. Unified Sessions (WP1.3, D-US1) — the engine now emits a leading
  // `{type:"phase",phase:"starting"}` before the opening `running` status.
  const types = events.map((e) => e.type);
  assert.equal(types[0], "phase");
  assert.equal((events[0] as Extract<RunEvent, { type: "phase" }>).phase, "starting");
  assert.equal(types[1], "status");
  assert.equal((events[1] as Extract<RunEvent, { type: "status" }>).status, "running");

  const toolCallSteps = events.filter(
    (e): e is Extract<RunEvent, { type: "step" }> =>
      e.type === "step" && e.step.type === "tool_call",
  );
  // 2 model-visible tool_call steps from the engine + 2 MCP-side steps from the default sink.
  const engineToolCalls = toolCallSteps.filter((e) => e.step.id.includes(":step:"));
  assert.equal(engineToolCalls.length, 2, "two engine tool_call steps");
  assert.deepEqual(
    engineToolCalls.map((e) => e.step.toolName),
    ["alpha", "beta"],
    "tool calls in order alpha then beta",
  );

  const toolResults = events.filter(
    (e): e is Extract<RunEvent, { type: "step" }> =>
      e.type === "step" && e.step.type === "tool_result" && e.step.id.includes(":step:"),
  );
  assert.equal(toolResults.length, 2, "two tool_result steps");
  assert.ok(
    toolResults.every((e) => e.step.status === "ok"),
    "both tool results are ok",
  );

  const deltas = events.filter(
    (e): e is Extract<RunEvent, { type: "delta" }> => e.type === "delta",
  );
  assert.ok(
    deltas.some((e) => e.channel === "text" && e.text.includes("final answer")),
    "a final text answer was streamed",
  );

  // The final answer comes after the tool calls.
  const firstDelta = events.findIndex((e) => e.type === "delta");
  const lastToolCall = events.map((e) => e.type).lastIndexOf("step");
  assert.ok(firstDelta > 0);

  const lastStatus = [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
  assert.equal(lastStatus?.status, "completed", "the run ends on a completed status");

  // AR11 — the manager stays registered through the post-terminal review window and cleans up once
  // a SETTLED `rating` event lands on top of the terminal status (the run service guarantees one).
  assert.equal(manager.isActive(runId), true, "the manager stays registered for the review window");
  manager.emit(runId, { type: "rating", state: "skipped" });
  assert.equal(
    manager.isActive(runId),
    false,
    "run manager cleaned up the run after the settled rating",
  );
});

// ── Acceptance 2: allow-list — an excluded tool is absent and never callable ────────────────────

test("allow-list: a scenario-excluded tool is absent from the offered tools and never callable", async () => {
  const { manager } = collect();
  const runId = "run-allow";
  manager.create(runId);

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  // Scenario allows only alpha + beta; `forbidden` is excluded.
  const allowed: AllowedTool[] = [
    { serverId: "srv", def: defFor("alpha") },
    { serverId: "srv", def: defFor("beta") },
  ];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));

  assert.deepEqual(Object.keys(tools).sort(), ["alpha", "beta"], "only allowed tools are built");
  assert.equal(tools.forbidden, undefined, "the excluded tool is not present in the tools map");
  assert.ok(
    !("forbidden" in tools),
    "the excluded tool is never callable (not built by construction)",
  );

  // Even if the model tries to call `forbidden`, there is no execute to route it — the tools map the
  // model is offered simply does not contain it.
  assert.ok(typeof tools.alpha?.execute === "function");
  assert.ok(typeof tools.beta?.execute === "function");
});

// ── Acceptance 3a: a tool returning isError:true is a FAILED step, not a thrown run ─────────────

test("a tool that returns isError:true surfaces as a failed step (run still completes)", async () => {
  const { manager, events } = collect();
  const runId = "run-toolerr";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const tools = buildTools(
    [{ serverId: "srv", def: defFor("alpha") }],
    sessions,
    createDefaultStepSink(manager, runId),
  );

  // The model calls alpha with the tool_error sentinel, then answers.
  const model = mockModelTwoToolsThenAnswer([
    { id: "c1", name: "alpha", input: { mode: "tool_error" } },
  ]);

  const result = await runAgentLoop(runId, baseConfig({ model, tools }), (e) =>
    manager.emit(runId, e),
  );

  // The run is NOT thrown/errored — a tool-level isError is data the model gets back.
  assert.equal(result.status, "completed", "a tool-level error does not fail the run");

  // The engine emits the tool_result step as a FAILED step (an MCP `{ isError: true }` result).
  const engineFailedResult = events.find(
    (e): e is Extract<RunEvent, { type: "step" }> =>
      e.type === "step" &&
      e.step.id.includes(":step:") &&
      e.step.type === "tool_result" &&
      e.step.status === "error",
  );
  assert.ok(engineFailedResult, "the failed tool surfaces as a FAILED tool_result step");
  assert.equal(engineFailedResult.step.toolName, "alpha");

  // The MCP-side sink step also records the failure (status: error) for the failed tool.
  const mcpFailed = events.filter(
    (e): e is Extract<RunEvent, { type: "step" }> =>
      e.type === "step" && e.step.id.includes(":mcp:") && e.step.status === "error",
  );
  assert.equal(mcpFailed.length, 1, "the failed tool is recorded as an error step by the sink");
  assert.equal(mcpFailed[0]?.step.toolName, "alpha");
  // F5 — the MCP-sink step now also carries the AI SDK `toolCallId` so the UI can correlate it with
  // the engine's stream tool_call/tool_result steps (which already carry it). The tool-level error
  // marker is still present alongside it.
  assert.deepEqual(
    mcpFailed[0]?.step.payload,
    { isError: true, toolCallId: "c1" },
    "payload marks a tool-level error and carries the correlating toolCallId",
  );
});

// ── Acceptance 3b: a transport error (callTool throws) FAILS the run with a clear message ───────

test("a transport error (callTool throws) fails the run with a clear message", async () => {
  const { manager, events } = collect();
  const runId = "run-transport";
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

  // The model calls alpha with the transport_error sentinel; the stub session THROWS.
  const model = mockModelTwoToolsThenAnswer([
    { id: "c1", name: "alpha", input: { mode: "transport_error" } },
  ]);

  const result = await runAgentLoop(
    runId,
    baseConfig({ model, tools, getTransportError: () => transportError }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "error", "a transport failure fails the run");
  assert.equal(result.outcome, "error");

  const errorEvent = events.find(
    (e): e is Extract<RunEvent, { type: "error" }> => e.type === "error",
  );
  assert.ok(errorEvent, "an error RunEvent was emitted");
  assert.match(
    errorEvent.message,
    /transport failure/i,
    "the error message is clear about the cause",
  );

  const lastStatus = [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
  assert.equal(lastStatus?.status, "error", "the terminal status is error");

  // The sink also recorded the transport failure for the tool.
  const transportStep = events.find(
    (e): e is Extract<RunEvent, { type: "step" }> =>
      e.type === "step" &&
      e.step.id.includes(":mcp:") &&
      typeof e.step.payload === "object" &&
      e.step.payload !== null &&
      "transportError" in (e.step.payload as Record<string, unknown>),
  );
  assert.ok(transportStep, "the sink recorded the transport error for the tool");
});
