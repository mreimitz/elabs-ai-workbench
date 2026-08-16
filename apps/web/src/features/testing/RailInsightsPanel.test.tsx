import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AnswersSnapshot } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// RailInsightsPanel imports `InsightRow` from SourcesPanel, whose SourcesList now pulls `@brand/ai`
// (Sources/SourcesTrigger/SourcesContent) at module load — and the @brand/ai barrel imports xyflow
// CSS jsdom can't load. Stub just those three (unused by the rows under test).
vi.mock("@brand/ai", () => ({
  Sources: () => null,
  SourcesTrigger: () => null,
  SourcesContent: () => null,
}));

import { RailInsightsPanel } from "./RailInsightsPanel";

/**
 * WP 7.1 — the rail "Insights" roll-up (the DE-DUPed snapshot evidence, moved here from the chat's
 * SourcesPanel). Renders a FLAT, ordered list of the shared `InsightRow` across every turn, inside a
 * bounded + collapsible Card. `@brand/ui` renders in jsdom (no @brand/ai here), so nothing is mocked;
 * `AnswersSnapshotData`'s tables/MetricCards render for real (see AnswersSnapshotData.test).
 */

function snap(over: Partial<AnswersSnapshot> = {}): AnswersSnapshot {
  return { title: "AA Market Share %", reason: "Understanding market share.", ...over };
}

function renderPanel(
  turns: { turnIndex: number; snapshots: AnswersSnapshot[] }[],
  onCiteInsight = vi.fn(),
) {
  const utils = render(
    <TooltipProvider>
      <RailInsightsPanel turns={turns} onCiteInsight={onCiteInsight} />
    </TooltipProvider>,
  );
  return { ...utils, onCiteInsight };
}

describe("RailInsightsPanel", () => {
  test("renders one row per snapshot (title + reason) inside a BOUNDED, non-collapsible Insights card", () => {
    const { container } = renderPanel([
      {
        turnIndex: 0,
        snapshots: [
          snap({ title: "Flights by Carrier", reason: "Understanding market share." }),
          snap({ title: "Delay minutes", reason: "Delay comparison." }),
        ],
      },
    ]);

    // The Insights header is a plain title (label + total-count badge) — NOT a section-collapse
    // trigger, so the row `<li>` FORWARD anchors stay mounted for a citation-chip jump.
    const title = container.querySelector(".text-title") as HTMLElement | null;
    expect(title).not.toBeNull();
    expect(title).toHaveTextContent("Insights");
    // Scope the count to the header so the row ordinal badges (which also show "2") don't collide.
    expect(within(title as HTMLElement).getByText("2")).toBeInTheDocument();
    // There is deliberately NO section-level collapse control.
    expect(screen.queryByRole("button", { name: /Insights/ })).not.toBeInTheDocument();

    // One row per snapshot — title + reason both shown.
    expect(screen.getByText("Flights by Carrier")).toBeInTheDocument();
    expect(screen.getByText("Understanding market share.")).toBeInTheDocument();
    expect(screen.getByText("Delay minutes")).toBeInTheDocument();
    expect(screen.getByText("Delay comparison.")).toBeInTheDocument();

    // The bounded-height ScrollArea is present (MUST-FIX G1 — a long run never pushes the rail).
    expect(container.querySelector(".max-h-96")).toBeInTheDocument();
  });

  test("each row's <li> carries the turn-qualified insight anchor (the citation-chip FORWARD target)", () => {
    const { container } = renderPanel([
      { turnIndex: 0, snapshots: [snap({ title: "A" }), snap({ title: "B" })] },
    ]);
    expect(container.querySelector('[data-console-anchor="insight:0:0"]')?.textContent).toContain(
      "A",
    );
    expect(container.querySelector('[data-console-anchor="insight:0:1"]')?.textContent).toContain(
      "B",
    );
  });

  test("a 1×1 hypercube snapshot renders through the shared AnswersSnapshotData as a MetricCard", () => {
    renderPanel([
      {
        turnIndex: 0,
        snapshots: [
          snap({ title: "Flight volume", data: { columns: ["Total flights"], rows: [[1234]] } }),
        ],
      },
    ]);
    // default-open row → the MetricCard (column label + grouped value) is visible.
    expect(screen.getByText("Total flights")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  test("the per-row data disclosure toggles (default-open → collapsed)", () => {
    renderPanel([
      {
        turnIndex: 0,
        snapshots: [
          snap({ title: "Flight volume", data: { columns: ["Total flights"], rows: [[1234]] } }),
        ],
      },
    ]);
    // The row's own trigger (its accessible name includes the ordinal + title).
    const rowTrigger = screen.getByRole("button", { name: /Flight volume/ });
    expect(rowTrigger.getAttribute("aria-expanded")).toBe("true"); // default-open
    fireEvent.click(rowTrigger);
    expect(rowTrigger.getAttribute("aria-expanded")).toBe("false"); // collapsed
  });

  test("a snapshot with NO data and NO expressions renders a PLAIN row (no disclosure trigger / dangling aria) but keeps its anchor", () => {
    const { container } = renderPanel([
      { turnIndex: 0, snapshots: [snap({ title: "Bare insight", reason: "Just a note." })] },
    ]);
    // The FORWARD anchor is present in BOTH branches (always mounted).
    expect(container.querySelector('[data-console-anchor="insight:0:0"]')).toBeInTheDocument();
    expect(screen.getByText("Bare insight")).toBeInTheDocument();
    expect(screen.getByText("Just a note.")).toBeInTheDocument();
    // No per-row disclosure control (title is a plain Text, not a CollapsibleTrigger).
    expect(screen.queryByRole("button", { name: /Bare insight/ })).not.toBeInTheDocument();
    // The only interactive is "Show in answer" — no disabled trigger emitting a dangling aria-controls.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("aria-label", "Show in answer");
  });

  test("a multi-turn run flattens rows with DISTINCT turn-qualified anchors + a per-row turn chip", () => {
    const { container } = renderPanel([
      { turnIndex: 0, snapshots: [snap({ title: "Turn-0 insight" })] },
      { turnIndex: 1, snapshots: [snap({ title: "Turn-1 insight" })] },
    ]);
    expect(container.querySelector('[data-console-anchor="insight:0:0"]')).toBeInTheDocument();
    expect(container.querySelector('[data-console-anchor="insight:1:0"]')).toBeInTheDocument();
    // The turn chip keeps provenance once the list is flattened across turns.
    expect(screen.getByText("Turn 1")).toBeInTheDocument();
    expect(screen.getByText("Turn 2")).toBeInTheDocument();
  });

  test("a single-turn run shows NO turn chip (repetition suppressed)", () => {
    renderPanel([{ turnIndex: 0, snapshots: [snap({ title: "Only insight" })] }]);
    expect(screen.queryByText("Turn 1")).not.toBeInTheDocument();
  });

  test("'Show in answer' fires onCiteInsight with the row's (turnIndex, snapshotIndex) — the REVERSE leg", () => {
    const { onCiteInsight } = renderPanel([
      { turnIndex: 2, snapshots: [snap({ title: "First" }), snap({ title: "Second" })] },
    ]);
    const buttons = screen.getAllByRole("button", { name: "Show in answer" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1] as HTMLElement); // the second row → snapshot index 1
    expect(onCiteInsight).toHaveBeenCalledWith(2, 1);
  });

  test("renders nothing when no turn carries a snapshot (never an empty card)", () => {
    const empty = render(<RailInsightsPanel turns={[]} onCiteInsight={vi.fn()} />);
    expect(empty.container).toBeEmptyDOMElement();

    const noSnaps = render(
      <RailInsightsPanel turns={[{ turnIndex: 0, snapshots: [] }]} onCiteInsight={vi.fn()} />,
    );
    expect(noSnaps.container).toBeEmptyDOMElement();
  });
});
