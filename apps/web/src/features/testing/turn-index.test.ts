import type { RunStep } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { deriveTurnRows } from "./turn-index";

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

describe("deriveTurnRows", () => {
  test("one row per llm_response turn with tokens, context, tool-call count and error flag", () => {
    const steps: RunStep[] = [
      step({
        id: "run:step:0",
        index: 0,
        type: "tool_call",
        turnIndex: 0,
        toolName: "search",
        payload: { toolCallId: "c1", args: {} },
      }),
      step({ id: "run:mcp:0", index: 1, type: "tool_call", turnIndex: 0, toolName: "search" }),
      step({
        id: "run:step:1",
        index: 2,
        type: "llm_response",
        turnIndex: 0,
        usageActual: { inputTokens: 100, outputTokens: 20 } as RunStep["usageActual"],
        context: { total: 1200 } as RunStep["context"],
      }),
      step({
        id: "run:step:2",
        index: 3,
        type: "tool_call",
        turnIndex: 1,
        toolName: "create",
        status: "error",
        payload: { toolCallId: "c2", args: {} },
      }),
      step({
        id: "run:step:3",
        index: 4,
        type: "llm_response",
        turnIndex: 1,
        usageActual: { inputTokens: 300, outputTokens: 40 } as RunStep["usageActual"],
        context: { total: 2000 } as RunStep["context"],
      }),
    ];

    const rows = deriveTurnRows(steps);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      turnIndex: 0,
      turnNo: 1,
      tokensIn: 100,
      tokensOut: 20,
      contextTotal: 1200,
      toolCalls: 1, // the :mcp: duplicate is not double-counted
      hasError: false,
    });

    expect(rows[1]).toMatchObject({
      turnIndex: 1,
      turnNo: 2,
      tokensIn: 300,
      tokensOut: 40,
      contextTotal: 2000,
      toolCalls: 1,
      hasError: true, // an errored tool step in the turn flags it
    });
  });

  test("no llm_response steps → no rows; missing usage/context degrade to 0/null", () => {
    expect(deriveTurnRows([])).toEqual([]);
    const rows = deriveTurnRows([step({ id: "a", index: 0, type: "llm_response", turnIndex: 0 })]);
    expect(rows).toEqual([
      {
        turnIndex: 0,
        turnNo: 1,
        tokensIn: 0,
        tokensOut: 0,
        contextTotal: null,
        toolCalls: 0,
        hasError: false,
      },
    ]);
  });
});
