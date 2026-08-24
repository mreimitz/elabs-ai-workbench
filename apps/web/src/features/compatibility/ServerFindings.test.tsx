import type { ToolFindingEntry, ToolScan } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  getServerTests: vi.fn(async () => ({ models: [], entries: [], subjectType: "server" })),
  getToolTests: vi.fn(async () => ({ models: [], entries: [], subjectType: "tool" })),
}));

import { ServerFindings } from "./CompatibilityTests";

/** `n` tool names, the shape that produced the chip wall this restructure exists to remove. */
function tools(n: number): ToolFindingEntry["tools"] {
  return Array.from({ length: n }, (_, i) => ({
    toolName: `qlik_tool_${i}`,
    severity: "low" as const,
  }));
}

function entry(over: Partial<ToolFindingEntry> = {}): ToolFindingEntry {
  return {
    testId: "pagination",
    techName: "pagination",
    userFacingName: "Pagination",
    findingName: "List-style tool has no pagination support",
    category: "schema",
    failureMode: "context overflow",
    recommendation: "Add limit/offset parameters to any tool that can return a list.",
    worstSeverity: "low",
    tools: tools(69),
    ...over,
  };
}

function renderFindings(entries: ToolFindingEntry[]) {
  // `onOpenTool` is passed exactly as the server Overview passes it, so a tool chip is the real
  // clickable `Button` here rather than the static `Badge` fallback.
  return render(
    <ServerFindings
      onOpenTool={() => {}}
      scanId="scan-1"
      toolFindings={entries}
      toolsByName={new Map<string, ToolScan>()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServerFindings", () => {
  test("a finding is COLLAPSED by default — its fix and its tool names are not in the DOM yet", async () => {
    renderFindings([entry()]);
    await screen.findByText("List-style tool has no pagination support");

    // The card's height used to be a function of how many tool names the worst finding carried:
    // 12 chips + "+57 more" per finding, four findings deep, measured at 2,428px tall.
    expect(screen.queryByText(/Add limit\/offset/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "qlik_tool_0" })).not.toBeInTheDocument();
  });

  test("the severity, the title and the affected count stay visible while collapsed", async () => {
    renderFindings([entry()]);
    await screen.findByText("List-style tool has no pagination support");
    expect(screen.getByText("69 tools affected")).toBeInTheDocument();
    // "Advice" is `COMPATIBILITY_SEVERITY_LABEL.low` — never a hand-written severity word.
    expect(screen.getAllByText("Advice").length).toBeGreaterThan(0);
  });

  test("expanding shows the fix, and the tool names stay behind their own disclosure", async () => {
    renderFindings([entry()]);
    fireEvent.click(
      await screen.findByRole("button", { name: /List-style tool has no pagination support/ }),
    );

    await waitFor(() => expect(screen.getByText(/Add limit\/offset/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Show 69 tools" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "qlik_tool_0" })).not.toBeInTheDocument();
  });

  test("the disclosure reveals EVERY name — the old row silently truncated at 12", async () => {
    renderFindings([entry()]);
    fireEvent.click(
      await screen.findByRole("button", { name: /List-style tool has no pagination support/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show 69 tools" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "qlik_tool_68" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Hide 69 tools" })).toBeInTheDocument();
  });

  test("a short list is rendered inline — a disclosure over three names is friction, not structure", async () => {
    renderFindings([entry({ tools: tools(3) })]);
    fireEvent.click(
      await screen.findByRole("button", { name: /List-style tool has no pagination support/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "qlik_tool_0" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^Show \d+ tools?$/ })).not.toBeInTheDocument();
  });

  test("the footer states the count, so a scrolled list never hides how much is below", async () => {
    renderFindings([entry(), entry({ testId: "verbose", findingName: "Tool has no output control" })]);
    expect(
      await screen.findByText(/2 findings · expand one for the fix and the tools it applies to/),
    ).toBeInTheDocument();
  });
});
