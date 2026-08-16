import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelMessage } from "ai";
import type { RunStep } from "@mcp-token-footprint/shared";
import { ForkStepNotFoundError, reconstructForkPrefix } from "../src/testing/fork.js";

// Observability WP3.3 (D-OB18) — the PURE fork-prefix reconstruction is the risky heart of the WP, so
// it is exhaustively unit-tested here: BYTE-IDENTITY against a fixture, the engine's step shapes
// (tool_call `{toolCallId,args}` → tool_result `{toolCallId,result}`), MCP-side duplicate de-dup,
// mid-call dangling-drop (validity invariant), and the not-found error. No DB, no I/O.

/** Build a minimal persisted-shaped RunStep (only the fields fork.ts reads matter). */
function step(index: number, type: RunStep["type"], extra: Partial<RunStep> = {}): RunStep {
  return {
    id: `run:step:${index}`,
    runId: "run",
    index,
    type,
    label: extra.label ?? type,
    status: extra.status ?? "ok",
    profileTokens: {},
    payload: null,
    ...extra,
  };
}

/** A realistic parent transcript: user → (stream tool_call · MCP-dup tool_call · tool_result · tool_io) → llm_response. */
function parentSteps(): RunStep[] {
  return [
    step(0, "user_message", { label: "user", payload: { text: "Original question" } }),
    // The engine's STREAM tool_call step (carries args + toolCallId) — the authoritative one.
    step(1, "tool_call", {
      toolName: "alpha",
      status: "running",
      payload: { toolCallId: "c1", args: { x: 1 } },
    }),
    // The engine's MCP-side DUPLICATE tool_call step (same toolCallId, no args) — must be de-duped.
    step(2, "tool_call", { toolName: "alpha", payload: { toolCallId: "c1", isError: false } }),
    step(3, "tool_result", {
      toolName: "alpha",
      payload: { toolCallId: "c1", result: { content: [{ type: "text", text: "alpha:ok" }] } },
    }),
    // The additive tool_io CHILD (context_event) — NOT part of the transcript, must be skipped.
    step(4, "context_event", { label: "alpha · MCP I/O", payload: { requestBytes: 12 } }),
    step(5, "llm_response", { label: "assistant", assistantText: "The answer is 42." }),
  ];
}

test("reconstructForkPrefix — BYTE-IDENTICAL prefix at the final llm_response step (acceptance #1)", () => {
  const { messages, forkStepIndex } = reconstructForkPrefix(parentSteps(), "run:step:5");
  const expected: ModelMessage[] = [
    { role: "user", content: "Original question" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "alpha", input: { x: 1 } }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "alpha",
          output: {
            type: "text",
            value: JSON.stringify({ content: [{ type: "text", text: "alpha:ok" }] }),
          },
        },
      ],
    },
    { role: "assistant", content: "The answer is 42." },
  ];
  assert.deepEqual(messages, expected, "structural equality");
  // Byte-identity: the serialized reconstruction equals the serialized fixture exactly.
  assert.equal(
    JSON.stringify(messages),
    JSON.stringify(expected),
    "byte-identical serialized prefix",
  );
  assert.equal(forkStepIndex, 5, "fork step index is the located step's persisted idx");
});

test("reconstructForkPrefix — the MCP-side duplicate tool_call is de-duped (one call, not two)", () => {
  const { messages } = reconstructForkPrefix(parentSteps(), "run:step:5");
  const toolCallParts = messages.flatMap((m) =>
    Array.isArray(m.content)
      ? m.content.filter((p) => (p as { type?: string }).type === "tool-call")
      : [],
  );
  assert.equal(toolCallParts.length, 1, "exactly one reconstructed tool-call despite the dup step");
});

test("reconstructForkPrefix — a fork cutting mid-call (at the tool_call) DROPS the dangling call", () => {
  const { messages, forkStepIndex } = reconstructForkPrefix(parentSteps(), "run:step:1");
  // Only the opener user message survives — the unpaired tool call is dropped so the sequence stays valid.
  assert.deepEqual(messages, [{ role: "user", content: "Original question" }]);
  assert.equal(forkStepIndex, 1);
});

test("reconstructForkPrefix — forking at the tool_result includes the paired call → result, no trailing text", () => {
  const { messages } = reconstructForkPrefix(parentSteps(), "run:step:3");
  assert.equal(messages.length, 3, "user + assistant[tool-call] + tool[tool-result]");
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[1]?.role, "assistant");
  assert.equal(messages[2]?.role, "tool");
});

test("reconstructForkPrefix — a tool-error step reconstructs a valid tool-result output", () => {
  const steps: RunStep[] = [
    step(0, "user_message", { payload: { text: "hi" } }),
    step(1, "tool_call", { toolName: "beta", payload: { toolCallId: "e1", args: {} } }),
    step(2, "tool_result", {
      toolName: "beta",
      status: "error",
      payload: { toolCallId: "e1", error: "boom" },
    }),
  ];
  const { messages } = reconstructForkPrefix(steps, "run:step:2");
  const toolMsg = messages[2];
  assert.equal(toolMsg?.role, "tool");
  const part = Array.isArray(toolMsg?.content) ? toolMsg.content[0] : undefined;
  assert.deepEqual(part, {
    type: "tool-result",
    toolCallId: "e1",
    toolName: "beta",
    output: { type: "text", value: JSON.stringify({ error: "boom" }) },
  });
});

test("reconstructForkPrefix — an empty/tool-only llm_response contributes no standalone assistant message", () => {
  const steps: RunStep[] = [
    step(0, "user_message", { payload: { text: "hi" } }),
    step(1, "llm_response", { assistantText: "" }),
  ];
  const { messages } = reconstructForkPrefix(steps, "run:step:1");
  assert.deepEqual(messages, [{ role: "user", content: "hi" }]);
});

test("reconstructForkPrefix — unordered input is sorted by index before the cut", () => {
  const steps = [
    step(2, "llm_response", { assistantText: "answer" }),
    step(0, "user_message", { payload: { text: "q" } }),
    step(1, "llm_response", { assistantText: "mid" }),
  ];
  const { messages } = reconstructForkPrefix(steps, "run:step:1");
  assert.deepEqual(messages, [
    { role: "user", content: "q" },
    { role: "assistant", content: "mid" },
  ]);
});

test("reconstructForkPrefix — an unknown fork step id throws ForkStepNotFoundError (422)", () => {
  assert.throws(
    () => reconstructForkPrefix(parentSteps(), "run:step:999"),
    (err: unknown) => {
      assert.ok(err instanceof ForkStepNotFoundError);
      assert.equal((err as ForkStepNotFoundError).statusCode, 422);
      return true;
    },
  );
});
