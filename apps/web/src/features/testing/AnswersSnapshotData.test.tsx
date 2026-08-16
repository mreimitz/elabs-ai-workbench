import { render as rtlRender, screen } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { describe, expect, test } from "vitest";
import type { AnswersSnapshot } from "@mcp-token-footprint/shared";
import { AnswersSnapshotData } from "./AnswersSnapshotData";

// Test harness (toolbar-reach Phase 3): the snapshot table now mounts a Radix Tooltip via `IconButton`
// (ExpandableTable toolbar); the app root supplies `TooltipProvider`, so inject it for every render.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);

/**
 * WP 5.3 (D-QA10) — the canonical snapshot-data renderer shared with WP 5.4's InsightRow: a 1×1
 * hypercube → a single-value MetricCard; anything larger → a compact table with an honest
 * "showing N of M" footer when the 50-row cap trimmed it; no `data` → nothing.
 */
function renderSnap(snapshot: AnswersSnapshot, variant?: "inset" | "panel") {
  return render(<AnswersSnapshotData snapshot={snapshot} variant={variant} />);
}

describe("AnswersSnapshotData", () => {
  test("a 1×1 hypercube renders a single-value MetricCard (column label + value)", () => {
    renderSnap({ title: "Total flights", data: { columns: ["Total flights"], rows: [[1234]] } });
    expect(screen.getByText("Total flights")).toBeInTheDocument();
    // Numbers keep grouping and are not rounded away.
    expect(screen.getByText("1,234")).toBeInTheDocument();
    // A single value is NOT rendered as a table.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("an N×M hypercube renders a compact table with the right headers + cells", () => {
    renderSnap({
      data: {
        columns: ["Carrier", "Flights"],
        rows: [
          ["AA", 100],
          ["UA", 250],
        ],
      },
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Carrier" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Flights" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "AA" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "UA" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "100" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "250" })).toBeInTheDocument();
  });

  test("a numeric column right-aligns with tabular-nums; a text column does not", () => {
    renderSnap({
      data: {
        columns: ["Carrier", "Flights"],
        rows: [["AA", 100]],
      },
    });
    expect(screen.getByRole("cell", { name: "100" }).className).toContain("tabular-nums");
    expect(screen.getByRole("cell", { name: "100" }).className).toContain("text-right");
    expect(screen.getByRole("cell", { name: "AA" }).className).not.toContain("text-right");
  });

  test("totalRows > rows.length shows the honest 'Showing N of M rows' footer", () => {
    renderSnap({
      data: {
        columns: ["Carrier", "Flights"],
        rows: [
          ["AA", 100],
          ["UA", 250],
        ],
        totalRows: 12,
      },
    });
    expect(screen.getByText("Showing 2 of 12 rows")).toBeInTheDocument();
  });

  test("no cap (totalRows absent or equal) → no 'Showing …' footer", () => {
    renderSnap({
      data: {
        columns: ["Carrier", "Flights"],
        rows: [
          ["AA", 100],
          ["UA", 250],
        ],
      },
    });
    expect(screen.queryByText(/Showing \d+ of \d+ rows/)).not.toBeInTheDocument();
  });

  test("an N×M table gains the download + expand toolbar (WP 6.1)", () => {
    renderSnap({
      title: "Carrier flights",
      data: {
        columns: ["Carrier", "Flights"],
        rows: [
          ["AA", 100],
          ["UA", 250],
        ],
      },
    });
    expect(screen.getByRole("button", { name: "Download table as CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  test("a 1×1 MetricCard has NO download/expand affordances (WP 6.1)", () => {
    renderSnap({ title: "Total flights", data: { columns: ["Total flights"], rows: [[1234]] } });
    expect(screen.queryByRole("button", { name: "Download table as CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand table" })).not.toBeInTheDocument();
  });

  test("a snapshot with no hypercube data renders nothing (5.4 owns the title/reason face)", () => {
    const { container } = renderSnap({ title: "Delay minutes", reason: "Comparison." });
    expect(container).toBeEmptyDOMElement();
  });

  test("an empty matrix (no columns/rows) renders nothing — never indexes past its arrays", () => {
    const { container } = renderSnap({ data: { columns: [], rows: [] } });
    expect(container).toBeEmptyDOMElement();
  });
});
