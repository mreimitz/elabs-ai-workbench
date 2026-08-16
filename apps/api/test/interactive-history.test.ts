import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { McpSession } from "../src/mcp/client.js";
import { runAgentLoop, type EngineConfig, type InteractiveTurns } from "../src/testing/engine.js";
import { buildTools, type AllowedTool, type StepSink } from "../src/testing/tool-bridge.js";

// Regression lock for the interactive multi-turn MEMORY bug: an interactive run must carry the
// assistant message + its tool calls + the tool-result messages from each turn into the NEXT turn's
// provider request. Before the fix the engine only pushed the new USER turn onto `messages` and never
// appended `result.response.messages`, so turn 2 was sent `[opener, follow-up]` with NO memory of
// turn 1 — the model re-started (e.g. re-searching an app it had already analyzed) and the context
// window sawtoothed (grew within a pass, collapsed at each turn boundary). We drive the REAL engine
// with a mock model that records every `doStream` request prompt and assert turn 2 sees turn 1.

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const streamOf = (chunks: Part[]) => ({ stream: simulateReadableStream({ chunks }) });

const USAGE = {
  inputTokens: { total: 30, noCache: 30, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 8, reasoning: 0 },
} as const;

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

const ALPHA: NormalizedToolDefinition = {
  name: "alpha",
  description: "Alpha tool",
  inputSchema: { type: "object" },
  raw: {},
};

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Analyze the data, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    modelId: "claude-sonnet-4",
    providerKind: "anthropic",
    ...over,
  };
}

test("interactive runs carry the assistant + tool history into the next turn's request", async () => {
  // Record the provider request prompt (the messages array) on every `doStream` call.
  const prompts: Array<Array<{ role: string }>> = [];
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt as Array<{ role: string }>);
      call += 1;
      if (call === 1) {
        // Turn 1, step 1: call a tool.
        return streamOf([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "c1", toolName: "alpha", input: "{}" },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      if (call === 2) {
        // Turn 1, step 2: final answer + STOP → the engine awaits the next interactive user turn.
        return streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "answer one" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ]);
      }
      // Turn 2, step 1: a plain answer + STOP.
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t2" },
        { type: "text-delta", id: "t2", delta: "answer two" },
        { type: "text-end", id: "t2" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const sink: StepSink = { toolCall: () => undefined }; // no-op: this test only inspects the model request
  const allowed: AllowedTool[] = [{ serverId: "srv", def: ALPHA }];
  const tools = buildTools(allowed, sessions, sink);

  // One follow-up user turn, then end the conversation.
  let given = 0;
  const interactive: InteractiveTurns = {
    nextTurn: async () => {
      given += 1;
      return given === 1 ? "second question" : null;
    },
  };

  await runAgentLoop("run-hist", baseConfig({ model, tools, interactive }), () => undefined);

  assert.equal(
    call,
    3,
    "three provider round-trips: turn-1 tool step + answer step, turn-2 answer step",
  );

  const turn1FirstPrompt = prompts[0];
  const turn2Prompt = prompts[2];
  assert.ok(turn1FirstPrompt && turn2Prompt, "captured the turn-1 and turn-2 request prompts");

  // THE FIX: turn 2's request carries turn 1's assistant message AND its tool-result message.
  assert.ok(
    turn2Prompt.some((m) => m.role === "assistant"),
    "turn-2 request includes the prior assistant message (lost before the fix)",
  );
  assert.ok(
    turn2Prompt.some((m) => m.role === "tool"),
    "turn-2 request includes the prior tool-result message (lost before the fix)",
  );

  const serialized = JSON.stringify(turn2Prompt);
  assert.ok(serialized.includes("answer one"), "turn-2 request carries the prior assistant text");
  assert.ok(serialized.includes("alpha"), "turn-2 request carries the prior tool call/result");
  assert.ok(serialized.includes("second question"), "turn-2 request includes the new user turn");

  // History GROWS across turns (it must not reset to just the user messages at the turn boundary).
  assert.ok(
    turn2Prompt.length > turn1FirstPrompt.length,
    `turn-2 prompt (${turn2Prompt.length} msgs) must be longer than turn-1's first prompt (${turn1FirstPrompt.length})`,
  );
});
