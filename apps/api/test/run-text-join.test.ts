import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { runAgentLoop, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";
import { joinTextBlocks } from "../src/testing/run-service.js";

// The low-level provider stream-part type drives the mock model (same derivation as agent-loop.test.ts:
// `ai` doesn't re-export the V3 part type, so read it off MockLanguageModelV3.doStream).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

function baseConfig(over: Partial<EngineConfig>): EngineConfig {
  return {
    model: over.model!,
    system: "You are a test harness.",
    userPrompt: "Say something in two blocks.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    ...over,
  };
}

// ── Persisted path: joinTextBlocks (the source of `assistantText` on a settled llm_response) ──────

test("joinTextBlocks separates distinct text content blocks with a blank line", () => {
  const content = [
    { type: "text", text: "Let me begin!" },
    { type: "tool-call", toolCallId: "c1", toolName: "search", input: {} },
    { type: "text", text: "Now let me search" },
  ];
  // The two text blocks are rejoined with a paragraph break; the tool-call part is ignored.
  assert.equal(joinTextBlocks(content), "Let me begin!\n\nNow let me search");
});

test("joinTextBlocks returns a single block verbatim (no spurious separators)", () => {
  const content = [{ type: "text", text: "One coherent paragraph, no gluing." }];
  assert.equal(joinTextBlocks(content), "One coherent paragraph, no gluing.");
});

test("joinTextBlocks drops empty/whitespace-only text parts", () => {
  const content = [
    { type: "text", text: "First." },
    { type: "text", text: "   " },
    { type: "text", text: "Second." },
  ];
  assert.equal(joinTextBlocks(content), "First.\n\nSecond.");
});

test("joinTextBlocks returns undefined for a tool-only step and malformed input", () => {
  assert.equal(joinTextBlocks([{ type: "tool-call", toolCallId: "c1" }]), undefined);
  assert.equal(joinTextBlocks([]), undefined);
  assert.equal(joinTextBlocks(undefined), undefined);
  assert.equal(joinTextBlocks("not an array"), undefined);
});

// ── Live path: the engine inserts a paragraph break at a text-block boundary in the delta stream ──

/** A one-step mock model that streams TWO text blocks (distinct ids), then stops. */
function mockModelTwoTextBlocks() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "a" },
        { type: "text-delta", id: "a", delta: "Let me " },
        { type: "text-delta", id: "a", delta: "begin!" },
        { type: "text-end", id: "a" },
        { type: "text-start", id: "b" },
        { type: "text-delta", id: "b", delta: "Now let me " },
        { type: "text-delta", id: "b", delta: "search" },
        { type: "text-end", id: "b" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]),
  });
}

test("live stream inserts a paragraph break only at the text-block boundary, not between deltas", async () => {
  const runId = "run-text-join";
  const events: RunEvent[] = [];
  const manager = new RunManager();
  manager.create(runId);
  const unsub = manager.subscribe(runId, (e) => events.push(e));

  const model = mockModelTwoTextBlocks();
  const result = await runAgentLoop(runId, baseConfig({ model }), (e) => manager.emit(runId, e));
  unsub();

  assert.equal(result.status, "completed");

  const textDeltas = events.filter(
    (e): e is Extract<RunEvent, { type: "delta" }> => e.type === "delta" && e.channel === "text",
  );
  // Accumulated exactly as the web does (raw concatenation of delta text).
  const accumulated = textDeltas.map((e) => e.text).join("");
  assert.equal(
    accumulated,
    "Let me begin!\n\nNow let me search",
    "the two blocks are separated by a blank line; deltas within a block concatenate raw",
  );
  // Exactly ONE paragraph break — no double-joining of intra-block deltas.
  assert.equal(accumulated.split("\n\n").length, 2, "exactly one block boundary was inserted");
});
