import type { RunStep } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ToolCallCard } from "./ToolCallCard";
import type { TimelineToolCall } from "./use-run-stream";

// The real modal mounts Monaco (`@elabs-ai/components-editor`), which jsdom can't load. Stub it into a probe
// that surfaces the props the card hands it — the contract under test is *what* gets expanded.
vi.mock("./PayloadDialog", () => ({
  PayloadDialog: ({
    heading,
    value,
    language,
    isError,
    step,
  }: {
    heading: string;
    value: string;
    language?: string;
    isError?: boolean;
    step: RunStep | null;
  }) => (
    <div
      data-testid="payload-dialog"
      data-heading={heading}
      data-language={language}
      data-error={String(isError)}
      data-step={step?.id ?? ""}
    >
      {value}
    </div>
  ),
}));

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

function toolCall(over: Partial<TimelineToolCall> = {}): TimelineToolCall {
  return {
    id: "tc-1",
    toolName: "qlik_create_data_object",
    call: step({ id: "call-1", type: "tool_call", payload: { args: { appId: "a1" } } }),
    result: step({
      id: "result-1",
      type: "tool_result",
      payload: { result: { content: [{ type: "text", text: '{"count":10}' }] } },
    }),
    ...over,
  };
}

/** Render the card and open its disclosure — the technical view lives behind the collapsed row. */
function renderCard(call: TimelineToolCall = toolCall()) {
  const rendered = render(
    <TooltipProvider>
      <ToolCallCard call={call} selected={false} onInspect={() => {}} />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: `Tool call ${call.toolName}` }));
  return rendered;
}

describe("ToolCallCard — expanding a clamped technical block", () => {
  test("both blocks carry an Expand affordance", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Expand parameters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand result" })).toBeTruthy();
  });

  test("no modal is mounted until a block is expanded", () => {
    renderCard();
    expect(screen.queryByTestId("payload-dialog")).toBeNull();
  });

  test("expanding parameters opens the tool_call args, indented, against the call step", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Expand parameters" }));
    const dialog = screen.getByTestId("payload-dialog");
    expect(dialog.getAttribute("data-heading")).toBe("Parameters");
    expect(dialog.getAttribute("data-language")).toBe("json");
    expect(dialog.getAttribute("data-step")).toBe("call-1");
    expect(dialog.textContent).toBe(JSON.stringify({ appId: "a1" }, null, 2));
  });

  test("expanding the result opens the UNWRAPPED payload against the result step", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Expand result" }));
    const dialog = screen.getByTestId("payload-dialog");
    expect(dialog.getAttribute("data-heading")).toBe("Result");
    expect(dialog.getAttribute("data-step")).toBe("result-1");
    expect(dialog.getAttribute("data-error")).toBe("false");
    // Unwrapped out of the MCP envelope and re-indented — not the escaped wire frame.
    expect(dialog.textContent).toBe(JSON.stringify({ count: 10 }, null, 2));
  });

  test("an error result expands as its message, flagged", () => {
    renderCard(
      toolCall({
        result: step({
          id: "result-1",
          type: "tool_result",
          status: "error",
          payload: { error: "connection refused" },
        }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand result" }));
    const dialog = screen.getByTestId("payload-dialog");
    expect(dialog.getAttribute("data-error")).toBe("true");
    expect(dialog.textContent).toContain("connection refused");
  });

  test("a redacted call shows no parameters block and no Expand for it", () => {
    renderCard(toolCall({ call: step({ id: "call-1", type: "tool_call", payload: {} }) }));
    expect(screen.queryByRole("button", { name: "Expand parameters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand result" })).toBeTruthy();
  });
});
