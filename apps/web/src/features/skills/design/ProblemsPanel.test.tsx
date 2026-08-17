import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SkillGraph } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
import { getToolDiagnostics } from "../skills-inspector-api";
import { formatUnknownToolWarning } from "./code-intel/tool-references";
import { ProblemsPanel } from "./ProblemsPanel";

// ── SI14/SI15 — the problems panel's deep links + its bounded internal scroll ──────────────────────
// (a) "Show node" must hand the problem's NODE id to `onGoToNode` (the flow deep link that crashed
//     with React #185 before the SkillGraphCanvas announce fix), "Line N" the line to `onGoToLine`;
// (b) all three row actions are REAL <button> elements (keyboard focusable, not divs);
// (c) the expanded body is ONE bounded scroll container (`max-h` + `min-h-0` + `overflow-y-auto`)
//     so long lists scroll inside the panel instead of pushing the Design tab past its page.

// Persisted fetches are irrelevant here: quality fails (tolerated) and diagnostics come back empty,
// so every listed problem derives from the LIVE `warnings` prop via the real, pure classifier.
vi.mock("../skills-inspector-api", () => ({
  getQualityReport: vi.fn(async () => {
    throw new Error("offline");
  }),
  getToolDiagnostics: vi.fn(async () => ({ diagnostics: [] })),
  formatToolDiagnosticMessage: (diagnostic: { name: string }) => `Unknown tool ${diagnostic.name}`,
}));

// jsdom omits matchMedia (Radix reads it).
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

const graph: SkillGraph = {
  nodes: [
    {
      id: "n-search",
      kind: "subroutine",
      label: "Search the model",
      anchor: { headingPath: ["Search the model"], startLine: 10, endLine: 20 },
      source: "inferred",
    },
  ],
  edges: [],
  warnings: [],
};

// A REAL live unknown-tool warning (the same formatter UnifiedEditor uses) — line 12 falls inside
// the subroutine's anchor span, so the classifier pins it to node "n-search" + line 12.
const warning = formatUnknownToolWarning({ name: "acme_serach", line: 12, count: 1 });

const onGoToNode = vi.fn();
const onGoToLine = vi.fn();

async function renderExpandedPanel() {
  render(
    <TooltipProvider>
      <ProblemsPanel
        skillId="skill-1"
        versionId="v1"
        graph={graph}
        warnings={[warning]}
        dirty={false}
        onGoToNode={onGoToNode}
        onGoToLine={onGoToLine}
      />
    </TooltipProvider>,
  );
  // Let the persisted-findings fetch settle (state updates inside the effect).
  await waitFor(() => expect(vi.mocked(getToolDiagnostics)).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /^Problems/ }));
  return await screen.findByTestId("problems-body");
}

beforeEach(() => {
  onGoToNode.mockClear();
  onGoToLine.mockClear();
});

describe("ProblemsPanel deep links (SI14)", () => {
  test("Show node hands the problem's node id to onGoToNode; Line N hands the line", async () => {
    await renderExpandedPanel();

    fireEvent.click(screen.getByRole("button", { name: "Show node" }));
    expect(onGoToNode).toHaveBeenCalledTimes(1);
    expect(onGoToNode).toHaveBeenCalledWith("n-search");

    fireEvent.click(screen.getByRole("button", { name: "Line 12" }));
    expect(onGoToLine).toHaveBeenCalledTimes(1);
    expect(onGoToLine).toHaveBeenCalledWith(12);
  });

  test("all three row actions are real, keyboard-focusable <button> elements", async () => {
    await renderExpandedPanel();
    for (const name of ["Show node", "Line 12", "What is this?"]) {
      const action = screen.getByRole("button", { name });
      expect(action.tagName).toBe("BUTTON");
      expect(action).not.toHaveAttribute("tabindex", "-1");
    }
  });
});

describe("ProblemsPanel bounded internal scroll (SI15)", () => {
  test("the expanded body is one bounded overflow-y-auto container holding the list", async () => {
    const body = await renderExpandedPanel();
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("min-h-0");
    expect(body.className).toContain("max-h-72");
    expect(body.className).toContain("overscroll-contain");
    // The list itself lives INSIDE the bounded container and no longer wraps its own scroller.
    const list = within(body).getByTestId("problems-list");
    expect(list.className).not.toContain("max-h");
  });
});
