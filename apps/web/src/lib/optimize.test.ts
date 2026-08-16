import type { ToolScan } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import type { ToolParam } from "./schema-params";
import { optimizeTool, recoverableTokens, toolTestSavings } from "./optimize";

// Pure, rule-based optimization heuristics. Golden-lock the suggestion ids/savings so a rule tweak is
// a deliberate, visible change (these numbers drive the Overview "recoverable tokens" figures).

function tool(over: Partial<ToolScan> = {}): ToolScan {
  return {
    id: "t1",
    scanId: "s1",
    toolName: "do_thing",
    description: "A concise description.",
    inputSchema: { type: "object" },
    annotations: undefined,
    rawTool: {},
    contributionPercent: 0,
    totalTokens: 100,
    nameTokens: 2,
    descriptionTokens: 10,
    schemaTokens: 50,
    annotationsTokens: 0,
    rawBytes: 100,
    ...over,
  };
}

function param(over: Partial<ToolParam> & Pick<ToolParam, "name">): ToolParam {
  return { typeLabel: "string", required: false, tokens: 10, flags: [], ...over };
}

describe("optimizeTool", () => {
  test("flags a missing description (warn, 0 savings)", () => {
    const out = optimizeTool(tool({ description: undefined }), []);
    expect(out).toEqual([
      { id: "no-desc", label: expect.any(String), savings: 0, severity: "warn" },
    ]);
  });

  test("suggests trimming an over-budget description with the recoverable delta", () => {
    const out = optimizeTool(tool({ descriptionTokens: 100 }), []);
    const longDesc = out.find((s) => s.id === "long-desc");
    expect(longDesc).toMatchObject({ severity: "warn", savings: 40 }); // 100 - 60
  });

  test("computes large-enum + verbose param savings", () => {
    const params: ToolParam[] = [
      param({
        name: "mode",
        tokens: 30,
        flags: ["large-enum"],
        enumValues: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      }),
      param({ name: "note", tokens: 20, flags: ["verbose"] }),
    ];
    const out = optimizeTool(tool(), params);
    expect(out.find((s) => s.id === "enum-mode")?.savings).toBe(12); // round(30 * (10-6)/10)
    expect(out.find((s) => s.id === "verbose-note")?.savings).toBe(8); // round(20 * 0.4)
  });

  test("flags a missing schema (info) and an oversized tool (info)", () => {
    const out = optimizeTool(tool({ inputSchema: undefined, totalTokens: 1500 }), []);
    expect(out.map((s) => s.id)).toEqual(expect.arrayContaining(["no-schema", "huge"]));
    expect(out.find((s) => s.id === "no-schema")?.severity).toBe("info");
  });

  test("suggestions are sorted by savings descending", () => {
    const params = [
      param({
        name: "mode",
        tokens: 30,
        flags: ["large-enum"],
        enumValues: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      }),
    ];
    const out = optimizeTool(tool({ descriptionTokens: 100 }), params);
    const savings = out.map((s) => s.savings);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
    expect(out[0]!.id).toBe("long-desc"); // 40 beats the enum's 12
  });
});

describe("recoverableTokens / toolTestSavings", () => {
  test("a lean, well-described tool has nothing recoverable", () => {
    expect(recoverableTokens(tool())).toBe(0);
  });

  test("toolTestSavings maps a description test to the long-desc savings; unknown tests → 0", () => {
    const t = tool({ descriptionTokens: 100 });
    expect(toolTestSavings("TOOL_DESCRIPTION_LENGTH", t)).toBe(40);
    expect(toolTestSavings("TOOL_DEFINITION_TOKENS", t)).toBe(40); // whole recoverable budget
    expect(toolTestSavings("SOMETHING_ELSE", t)).toBe(0);
  });
});
