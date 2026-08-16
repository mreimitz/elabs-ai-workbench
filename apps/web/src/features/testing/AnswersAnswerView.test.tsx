import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AnswersAnswerBlock, AnswersSnapshot } from "@mcp-token-footprint/shared";

// ChatMarkdown pulls `@brand/ai` (Streamdown) which jsdom can't load — stub it to a sentinel that
// echoes the block's markdown so we assert ORDER + content without the markdown engine.
vi.mock("./ChatMarkdown", () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

import { AnswersAnswerView } from "./AnswersAnswerView";
import { consoleAnchor, insightAnchorValue } from "./console-anchors";

beforeAll(() => {
  // jsdom implements neither of these; the citation-chip anchor-scroll calls both.
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
});

function textBlock(markdown: string, citations?: number[]): AnswersAnswerBlock {
  return citations ? { kind: "text", markdown, citations } : { kind: "text", markdown };
}
function snapshotBlock(index: number): AnswersAnswerBlock {
  return { kind: "snapshot", index };
}

const FIVE_SNAPSHOTS: AnswersSnapshot[] = [
  { title: "AA Market Share %", data: { columns: ["Share"], rows: [[42]] } },
  { title: "Flight Count" },
  { title: "Avg Carrier Delay" },
  { title: "Flight Volume" },
  { title: "Total Flights by Carrier" },
];

describe("AnswersAnswerView", () => {
  test("renders blocks as an ORDERED sequence — text, snapshot inset, text — in place", () => {
    const { container } = render(
      <AnswersAnswerView
        blocks={[
          textBlock("Intro narrative."),
          snapshotBlock(0), // 1×1 → MetricCard labelled "Share", value 42
          textBlock("Closing narrative."),
        ]}
        snapshots={FIVE_SNAPSHOTS}
        turnIndex={0}
      />,
    );
    const body = container.textContent ?? "";
    const intro = body.indexOf("Intro narrative.");
    const share = body.indexOf("Share");
    const closing = body.indexOf("Closing narrative.");
    expect(intro).toBeGreaterThanOrEqual(0);
    expect(share).toBeGreaterThan(intro);
    expect(closing).toBeGreaterThan(share);
    // The snapshot block rendered its data inset (the 1×1 value).
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  test("a text block with citations renders one chip per cited snapshot (1-based label) + carries the reverse anchor", () => {
    render(
      <AnswersAnswerView
        blocks={[textBlock("With evidence.", [0, 2])]}
        snapshots={FIVE_SNAPSHOTS}
        turnIndex={3}
      />,
    );
    // Interactive chips are labelled with the 1-based snapshot number.
    const chip1 = screen.getByRole("button", { name: "Jump to insight 1" });
    const chip3 = screen.getByRole("button", { name: "Jump to insight 3" });
    expect(chip1).toBeInTheDocument();
    expect(chip3).toBeInTheDocument();
    // WP 7.1 — each in-range chip carries the turn-qualified REVERSE target so a rail row's "Show in
    // answer" scrolls back to it (`citation:<turn>:<snap>`).
    expect(chip1.getAttribute("data-console-anchor")).toBe("citation:3:0");
    expect(chip3.getAttribute("data-console-anchor")).toBe("citation:3:2");
  });

  test("clicking a citation chip anchor-scrolls (FORWARD, cross-pane) to the rail insight row for its turn", () => {
    // WP 7.1 — the target now lives in the OTHER pane; the search is document-wide and the anchor is
    // turn-qualified. Render the chip on turn 1 alongside a BODY-level `insight:1:2` rail target.
    render(
      <>
        <AnswersAnswerView
          blocks={[textBlock("See insight.", [2])]}
          snapshots={FIVE_SNAPSHOTS}
          turnIndex={1}
        />
        {/* the RAIL InsightRow's `<li>` anchor — the forward scroll TARGET (a body-level sibling). */}
        <div data-testid="insight-target" {...consoleAnchor(insightAnchorValue(1, 2))}>
          insight 3
        </div>
        {/* the SAME snapshot index on a DIFFERENT turn must NEVER be the target (no collision). */}
        <div data-testid="other-turn-target" {...consoleAnchor(insightAnchorValue(0, 2))}>
          other turn insight 3
        </div>
      </>,
    );

    const target = screen.getByTestId("insight-target");
    const otherTurn = screen.getByTestId("other-turn-target");
    expect(target.style.outline).toBe(""); // not yet flashed

    fireEvent.click(screen.getByRole("button", { name: "Jump to insight 3" }));

    // The right (turn-qualified) target was scrolled to + flashed; the other turn's was not.
    expect(target.style.outline).toContain("var(--ring)");
    expect(otherTurn.style.outline).toBe("");
  });

  test("a DANGLING citation (index ≥ snapshot count) is INERT — no button, no anchor, no throw", () => {
    // 6 citations against only 5 snapshots (the real run's exact shape): index 5 has no target.
    render(
      <AnswersAnswerView
        blocks={[textBlock("Six references.", [0, 1, 2, 3, 4, 5])]}
        snapshots={FIVE_SNAPSHOTS}
        turnIndex={0}
      />,
    );
    // In-range indices 0..4 → interactive chips (labels 1..5).
    expect(screen.getByRole("button", { name: "Jump to insight 5" })).toBeInTheDocument();
    // The dangling index 5 (label 6) is NOT a button — it renders as an inert marker.
    expect(screen.queryByRole("button", { name: "Jump to insight 6" })).not.toBeInTheDocument();
    const dangling = screen.getByText("[6]");
    expect(dangling).toBeInTheDocument();
    // A dangling citation carries NO reverse anchor (no scroll target — it's not a link either way).
    expect(dangling.hasAttribute("data-console-anchor")).toBe(false);
    // And clicking near it never throws (the inert marker has no handler at all).
  });

  test("a snapshot block whose index is out of range renders nothing (bounds-checked, no crash)", () => {
    const { container } = render(
      <AnswersAnswerView
        blocks={[textBlock("Before."), snapshotBlock(9), textBlock("After.")]}
        snapshots={FIVE_SNAPSHOTS}
        turnIndex={0}
      />,
    );
    // Both text blocks still render; the dangling snapshot ref simply contributes nothing.
    expect(screen.getByText("Before.")).toBeInTheDocument();
    expect(screen.getByText("After.")).toBeInTheDocument();
    expect(container.querySelector("table")).toBeNull();
  });

  test("a snapshot block with no hypercube data falls back to the snapshot title (minimal)", () => {
    render(
      <AnswersAnswerView blocks={[snapshotBlock(1)]} snapshots={FIVE_SNAPSHOTS} turnIndex={0} />,
    );
    expect(screen.getByText("Flight Count")).toBeInTheDocument();
  });
});
