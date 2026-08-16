import type { RunStep } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { dedupeToolSteps } from "./dedupe-tool-steps";

// Every logical MCP tool call emits TWO `tool_call` rows — the engine row (`:step:`, carries args) and
// the MCP-sink row (`:mcp:`, carries duration/serverId/result-token-size). `dedupeToolSteps` collapses
// them into ONE row (engine args + MCP-sink timing/size/status), dropping the `:mcp:` duplicate.

function step(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

describe("dedupeToolSteps", () => {
  test("merges the :mcp: sink onto the engine row by toolCallId and drops the duplicate", () => {
    const engine = step({
      id: "run:step:0",
      index: 0,
      type: "tool_call",
      toolName: "search",
      status: "running",
      payload: { toolCallId: "c1", args: { q: "x" } },
    });
    const mcp = step({
      id: "run:mcp:0",
      index: 1,
      type: "tool_call",
      toolName: "search",
      status: "ok",
      durationMs: 120,
      serverId: "srv-1",
      profileTokens: { generic_o200k: 42 },
      payload: { toolCallId: "c1", isError: false },
    });
    const result = step({
      id: "run:step:1",
      index: 2,
      type: "tool_result",
      toolName: "search",
      payload: { toolCallId: "c1" },
    });

    const out = dedupeToolSteps([engine, mcp, result]);

    expect(out).toHaveLength(2);
    expect(out.some((s) => s.id.includes(":mcp:"))).toBe(false);

    const merged = out[0]!;
    expect(merged.id).toBe("run:step:0");
    expect(merged.durationMs).toBe(120);
    expect(merged.serverId).toBe("srv-1");
    expect(merged.status).toBe("ok"); // adopts the sink's settled status (engine was "running")
    expect(merged.profileTokens.generic_o200k).toBe(42);
    expect(merged.payload).toEqual({ toolCallId: "c1", args: { q: "x" } }); // engine args preserved

    expect(out[1]!.id).toBe("run:step:1"); // tool_result untouched, position preserved
  });

  test("falls back to same-tool order when the :mcp: sink carries no toolCallId", () => {
    const engine = step({
      id: "run:step:0",
      index: 0,
      type: "tool_call",
      toolName: "fetch",
      status: "running",
      payload: { toolCallId: "c9", args: {} },
    });
    const mcp = step({
      id: "run:mcp:0",
      index: 1,
      type: "tool_call",
      toolName: "fetch",
      status: "error",
      durationMs: 5,
      payload: { isError: true }, // no toolCallId → matched by tool-name order
    });

    const out = dedupeToolSteps([engine, mcp]);

    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("run:step:0");
    expect(out[0]!.durationMs).toBe(5);
    expect(out[0]!.status).toBe("error");
  });

  test("non tool_call steps pass through unchanged, order preserved", () => {
    const user = step({
      id: "run:step:0",
      index: 0,
      type: "user_message",
      payload: { text: "hi" },
    });
    const llm = step({ id: "run:step:1", index: 1, type: "llm_response", assistantText: "yo" });
    const out = dedupeToolSteps([user, llm]);
    expect(out).toEqual([user, llm]);
  });
});
