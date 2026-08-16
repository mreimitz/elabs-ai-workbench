import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  RunSummary,
  SessionTrace,
  SkillGraph,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import {
  getSkillGraph,
  getSkillSuggestions,
  getSkillTrace,
  getSkillVersion,
  getSkillVersionRuns,
} from "../skills-inspector-api";
import { SkillTraceView } from "./SkillTraceView";

// ── WP 7.6 (SI6) — the Trace tab is a LENS on the shared canvas ─────────────────────────────────
// These tests lock the rebuilt layout: (a) ONE compact toolbar block (run picker + value-aware
// chips + plain-language verdict) with nothing tall in it, (b) the legend docked INSIDE the
// Evidence panel, (c) a flex-row lens layout (growing canvas region beside a fixed Evidence
// panel — never underneath it), (d) the K4 all-unmatched verdict sentence byte-for-byte.

// The API layer is mocked (this is a layout test, not a fetch test).
vi.mock("../skills-inspector-api", () => ({
  getSkillGraph: vi.fn(),
  getSkillSuggestions: vi.fn(),
  getSkillTrace: vi.fn(),
  getSkillVersion: vi.fn(),
  getSkillVersionRuns: vi.fn(),
  getToolDiagnostics: vi.fn(),
}));

// The canvas is a heavy React Flow surface — stub it (its own geometry is covered by the design
// tests). The stub deliberately does NOT render children: the `TraceFocusNode` child needs a real
// React Flow context (its pure math is covered in trace-link.test.ts).
vi.mock("../design/SkillGraphCanvas", async () => {
  const react = await import("react");
  return {
    SkillGraphCanvas: () => react.createElement("div", { "data-testid": "skill-graph-canvas" }),
    buildFlow: () => ({ nodes: [], edges: [], droppedEdges: 0 }),
    NODE_KIND_LEGEND_ITEMS: [{ label: "Step", color: "var(--chart-2)" }],
  };
});

// Never rendered in these tests, but keep the module graph light in jsdom.
vi.mock("../design/SaveVersionDialog", () => ({ SaveVersionDialog: () => null }));
vi.mock("../../testing/run-launcher/RunLauncher", () => ({ RunLauncher: () => null }));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getSkillUsage: vi.fn(async () => ({ skillId: "skill-1", environments: [], runs: [] })),
  };
});

// jsdom omits matchMedia (same stub as TabPanel.test.tsx) and ResizeObserver.
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
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
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

const run: RunSummary = {
  id: "run-1",
  testId: "t1",
  scenarioId: "env1",
  mode: "automated",
  status: "completed",
  outcome: "completed",
  startedAt: "2026-07-01T10:00:00.000Z",
  durationMs: 1200,
  turns: 2,
  toolCalls: 1,
  peakContextTokens: 100,
  tokensIn: 50,
  tokensOut: 20,
  costUsd: 0.01,
};

/** The K4 acceptance case: a run that never activated the skill — every event unmatched. */
const allUnmatchedTrace: SessionTrace = {
  source: "run",
  ref: "run-1",
  skillVersionId: "v1",
  events: [
    { type: "user_message", idx: 0, payload: { text: "hello" } },
    { type: "tool_call", idx: 1, payload: { tool: "files_read" } },
    { type: "turn", idx: 2, payload: { text: "done" } },
  ],
  alignment: {
    nodeVisits: {},
    edgeTraversals: {},
    verdicts: [
      { nodeId: "s1", status: "unvisited", reason: "never visited", evidence: [] },
      { nodeId: "s2", status: "unvisited", reason: "never visited", evidence: [] },
    ],
    unmatchedEvents: [0, 1, 2],
    projectorVersion: 1,
    alignerVersion: 1,
  },
};

const version = {
  id: "v1",
  skillId: "skill-1",
  seq: 1,
  versionLabel: "v1",
  treeSha: "tree-sha",
} as unknown as SkillVersion;

function renderView() {
  return render(
    <MemoryRouter>
      <SkillTraceView skillId="skill-1" versionId="v1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getSkillVersionRuns).mockResolvedValue([run]);
  vi.mocked(getSkillGraph).mockResolvedValue({ graph, projectorVersion: 1 });
  vi.mocked(getSkillVersion).mockResolvedValue(version);
  vi.mocked(getSkillTrace).mockResolvedValue(allUnmatchedTrace);
  vi.mocked(getSkillSuggestions).mockResolvedValue({
    suggestions: [],
    projectorVersion: 1,
    alignerVersion: 1,
  });
});

describe("SkillTraceView — trace as a lens (WP 7.6)", () => {
  test("(a) the toolbar block renders run picker + value-aware chips + the verdict sentence", async () => {
    renderView();
    const toolbar = await screen.findByTestId("trace-toolbar");
    expect(within(toolbar).getByTestId("trace-run-picker")).toBeInTheDocument();

    const chips = await within(toolbar).findByTestId("trace-summary");
    // Value-aware: the zero ok/fracture counts render, but as neutral chips (asserted by text here;
    // the tone mapping itself lives in trace-verdict-meta).
    expect(chips).toHaveTextContent("0 ok");
    expect(chips).toHaveTextContent("0 fractures");
    expect(chips).toHaveTextContent("2 unvisited");
    expect(chips).toHaveTextContent("3 unmatched");

    // The verdict sentence sits inside the same compact toolbar block, directly beneath the row.
    expect(within(toolbar).getByTestId("trace-verdict")).toBeInTheDocument();
  });

  test("(d) the all-unmatched verdict sentence is preserved byte-for-byte", async () => {
    renderView();
    const verdict = await screen.findByTestId("trace-verdict");
    expect(verdict).toHaveTextContent(
      "This run never activated the skill — all 3 events went unmatched.",
    );
  });

  test("(c) the lens layout is a flex row: growing canvas region beside the Evidence panel", async () => {
    renderView();
    const layout = await screen.findByTestId("trace-lens-layout");
    expect(layout.className).toContain("flex");
    expect(layout.className).toContain("flex-1");
    expect(layout.className).toContain("min-h-0");

    const canvasRegion = within(layout).getByTestId("trace-canvas-region");
    expect(canvasRegion.className).toContain("flex-1");
    expect(canvasRegion.className).toContain("min-w-0");
    expect(within(canvasRegion).getByTestId("skill-graph-canvas")).toBeInTheDocument();

    // The Evidence panel is a flex SIBLING inside the same row — never nested under (or overlaid
    // on) the canvas region.
    const pane = await within(layout).findByTestId("trace-evidence-pane");
    expect(canvasRegion.contains(pane)).toBe(false);
    const heading = within(layout).getByRole("heading", { name: "Evidence" });
    expect(canvasRegion.contains(heading)).toBe(false);
  });

  test("(b) the legend is docked inside the Evidence panel — not in the toolbar, not over the canvas", async () => {
    renderView();
    const pane = await screen.findByTestId("trace-evidence-pane");
    expect(within(pane).getByTestId("trace-legend")).toBeInTheDocument();

    // The old SI6 defects: a legend floating in the toolbar row (inflating it into a 242px void)
    // or sitting over the canvas.
    expect(
      within(screen.getByTestId("trace-toolbar")).queryByTestId("trace-legend"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("trace-canvas-region")).queryByTestId("trace-legend"),
    ).not.toBeInTheDocument();
  });
});
