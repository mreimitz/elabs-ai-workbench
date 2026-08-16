import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SessionTrace, SkillGraph } from "@mcp-token-footprint/shared";
import { TraceEvidencePane, type TraceEvidencePaneProps } from "./TraceEvidencePane";
import { TRACE_VERDICT_LEGEND_ITEMS } from "./trace-verdict-meta";

// jsdom omits matchMedia (same stub as TabPanel.test.tsx) and scrollIntoView (the pane scrolls the
// first evidence row into view on selection).
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

const graph: SkillGraph = {
  nodes: [
    {
      id: "s1",
      kind: "subroutine",
      label: "Collect input",
      anchor: { headingPath: ["Collect input"], startLine: 1, endLine: 8 },
      source: "inferred",
    },
    {
      id: "s2",
      kind: "subroutine",
      label: "Write report",
      anchor: { headingPath: ["Write report"], startLine: 9, endLine: 20 },
      source: "inferred",
    },
  ],
  edges: [{ id: "e1", from: "s1", to: "s2" }],
  warnings: [],
};

const trace: SessionTrace = {
  source: "run",
  ref: "run-1",
  skillVersionId: "v1",
  events: [
    { type: "user_message", idx: 0, payload: { text: "hello" } },
    { type: "tool_call", idx: 1, payload: { tool: "files_read" } },
  ],
  alignment: {
    nodeVisits: { s1: 1 },
    edgeTraversals: {},
    verdicts: [
      { nodeId: "s1", status: "ok", reason: "executed as designed", evidence: [1] },
      { nodeId: "s2", status: "unvisited", reason: "never visited", evidence: [] },
    ],
    unmatchedEvents: [0],
    projectorVersion: 1,
    alignerVersion: 1,
  },
};

function renderPane(overrides?: Partial<TraceEvidencePaneProps>) {
  return render(
    <MemoryRouter>
      <TraceEvidencePane
        runId="run-1"
        trace={trace}
        graph={graph}
        selectedNodeId={undefined}
        legendItems={TRACE_VERDICT_LEGEND_ITEMS}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("TraceEvidencePane — docked legend (WP 7.6)", () => {
  test("the legend is a collapsible section INSIDE the pane, collapsed by default", () => {
    renderPane();
    const pane = screen.getByTestId("trace-evidence-pane");
    // Docked inside the panel body — not a floating sibling.
    const legend = within(pane).getByTestId("trace-legend");
    expect(legend).toBeInTheDocument();
    // Collapsed: the verdict rows are not rendered until expanded.
    expect(screen.queryByText("Executed as designed")).not.toBeInTheDocument();

    fireEvent.click(within(legend).getByTestId("trace-legend-toggle"));
    expect(within(legend).getByText("Executed as designed")).toBeInTheDocument();
    expect(within(legend).getByText("Not visited")).toBeInTheDocument();
  });

  test("no legend section when the caller passes no items", () => {
    renderPane({ legendItems: undefined });
    expect(screen.queryByTestId("trace-legend")).not.toBeInTheDocument();
  });
});

describe("TraceEvidencePane — evidence→canvas focus (WP 7.6)", () => {
  test("an event cited by a node's verdict is a focus button; an unmatched event is not", () => {
    const onFocusNode = vi.fn();
    renderPane({ onFocusNode });

    // Event #1 is cited by s1's verdict → clickable, centers s1.
    fireEvent.click(screen.getByTestId("trace-event-focus-1"));
    expect(onFocusNode).toHaveBeenCalledTimes(1);
    expect(onFocusNode).toHaveBeenCalledWith("s1");

    // Event #0 matched no design element → a plain row, no focus affordance.
    expect(screen.queryByTestId("trace-event-focus-0")).not.toBeInTheDocument();
  });

  test("rows stay non-interactive when onFocusNode is not wired", () => {
    renderPane();
    expect(screen.queryByTestId("trace-event-focus-1")).not.toBeInTheDocument();
    // The row itself still renders its event text.
    expect(screen.getByText("files_read")).toBeInTheDocument();
  });
});
