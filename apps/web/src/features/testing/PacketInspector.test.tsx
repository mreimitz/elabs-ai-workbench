import type { RunStep } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PacketTabs } from "./PacketInspector";

/**
 * The inspector's Response tab. An MCP tool result is `{ content: [{ type: "text", text }] }` and
 * that text is usually a MINIFIED JSON document — serializing the envelope wholesale left the real
 * payload double-encoded (a `\"`-escaped one-liner nested inside a pretty-printed wrapper).
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

/** Render the tabs and switch to Response (Radix only mounts the active tab's content). */
function renderResponseTab(step: RunStep) {
  const rendered = render(
    <TooltipProvider>
      <PacketTabs step={step} />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole("tab", { name: "Response" });
  // Radix `TabsTrigger` activates on mousedown, not click.
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  return rendered;
}

describe("PacketTabs — the Response tab's tool result", () => {
  test("a JSON document in content[].text is unwrapped and pretty-printed", () => {
    renderResponseTab(
      toolResultStep({ result: { content: [{ type: "text", text: '{"totalRows":10}' }] } }),
    );
    const block = screen.getByLabelText("Tool result");
    // Unwrapped: the escaped-inside-a-wrapper form is gone.
    expect(block.textContent).not.toContain('\\"totalRows\\"');
    expect(block.textContent).not.toContain('"content"');
    expect(block.textContent).toContain('"totalRows": 10');
    // Unwrapped results are no longer labelled "structured" — they are the payload itself.
    expect(screen.getByText("Result")).toBeTruthy();
  });

  test("a result with no text content keeps the serialized envelope and its label", () => {
    renderResponseTab(toolResultStep({ result: { structured: { a: 1 } } }));
    expect(screen.getByLabelText("Tool result").textContent).toContain('"structured"');
    expect(screen.getByText("Result (structured)")).toBeTruthy();
  });

  test("an errored step still reads as an error result", () => {
    renderResponseTab(toolResultStep({ result: { content: [{ type: "text", text: "boom" }] } }, "error"));
    expect(screen.getByText("Error result")).toBeTruthy();
  });
});
