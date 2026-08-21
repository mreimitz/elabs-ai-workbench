import { describe, expect, test } from "vitest";
import type { RunStep } from "@mcp-token-footprint/shared";
import { resultDetail } from "./trace-tree";

/**
 * The Trace "Result" leaf. An MCP `tools/call` answers with `{ content: [{ type: "text", text }] }`
 * and that text is very often a MINIFIED JSON document — before this was fixed the leaf rendered it
 * verbatim on a single line, tokenized as markdown, so the operator read one unbroken string.
 */

function toolResultStep(payload: unknown, status: RunStep["status"] = "ok"): RunStep {
  return {
    id: "step-1",
    runId: "run-1",
    index: 0,
    type: "tool_result",
    label: "tool result",
    status,
    profileTokens: {},
    payload,
  } as RunStep;
}

describe("resultDetail — the MCP content[].text unwrap", () => {
  test("a JSON document inside content[].text is PRETTY-PRINTED and typed json", () => {
    const detail = resultDetail(
      toolResultStep({
        result: { content: [{ type: "text", text: '{"totalRows":10,"offset":0}' }] },
      }),
    );
    expect(detail).not.toBeNull();
    expect(detail?.language).toBe("json");
    expect(detail?.value).toBe(JSON.stringify({ totalRows: 10, offset: 0 }, null, 2));
    // The whole point: more than one line, and no `\"`-escaping left in it.
    expect(detail?.value.split("\n").length).toBeGreaterThan(1);
    expect(detail?.value).not.toContain('\\"');
  });

  test("prose inside content[].text stays verbatim markdown", () => {
    const detail = resultDetail(
      toolResultStep({ result: { content: [{ type: "text", text: "No flights matched." }] } }),
    );
    expect(detail).toEqual({ value: "No flights matched.", isError: false, language: "markdown" });
  });

  test("isError on the MCP result marks the leaf even when the step status is ok", () => {
    const detail = resultDetail(
      toolResultStep({ result: { content: [{ type: "text", text: "boom" }], isError: true } }),
    );
    expect(detail?.isError).toBe(true);
  });

  test("a result with no text content falls back to the serialized envelope", () => {
    const detail = resultDetail(toolResultStep({ result: { structured: { a: 1 } } }));
    expect(detail?.language).toBe("json");
    expect(detail?.value).toBe(JSON.stringify({ structured: { a: 1 } }, null, 2));
  });

  test("no step → null", () => {
    expect(resultDetail(undefined)).toBeNull();
  });
});
