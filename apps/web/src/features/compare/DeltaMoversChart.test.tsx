import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// The chart itself is stubbed so these tests assert the DECISIONS this module makes — which rows are
// drawn, in what order, and what the card claims in words — rather than re-testing a library chart.
// The props the stub records are the contract with `DumbbellChart`, so a wrong key or a lost `sortBy`
// still fails here. (Note the repo-wide caveat: ~40 suites stub this package, so a chart PROP bug
// cannot be caught by rendering — which is exactly why the props are asserted explicitly.)
const dumbbellProps = vi.fn();
vi.mock("@elabs-ai/components-charts", () => ({
  ChartCard: ({
    title,
    description,
    children,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  ),
  DumbbellChart: (props: Record<string, unknown>) => {
    dumbbellProps(props);
    return <div data-testid="dumbbell" />;
  },
}));

import {
  DeltaMoversChart,
  MOVERS_LIMIT,
  moversDescription,
  moversTitle,
  selectMovers,
  type DeltaMoverRow,
} from "./DeltaMoversChart";

function row(label: string, before: number, after: number, change = "increased"): DeltaMoverRow {
  return { label, beforeTokens: before, afterTokens: after, deltaTokens: after - before, change };
}

describe("selectMovers — what the chart is allowed to draw", () => {
  test("drops unchanged rows and rows whose delta is zero", () => {
    const rows = [
      row("grew", 100, 400),
      row("flat", 200, 200, "unchanged"),
      // A row classified as changed but whose token delta is nevertheless 0 (a definition-only
      // change: the description moved, the token count did not). A flat track is not a mover.
      row("definition-only", 300, 300, "increased"),
    ];
    expect(selectMovers(rows).map((r) => r.label)).toEqual(["grew"]);
  });

  test("orders by MAGNITUDE, so the biggest shrink can outrank a smaller growth", () => {
    const rows = [row("small-growth", 100, 150), row("big-shrink", 900, 100, "decreased")];
    expect(selectMovers(rows).map((r) => r.label)).toEqual(["big-shrink", "small-growth"]);
  });

  test(`caps at ${MOVERS_LIMIT} — the label-overlap bound, not a data bound`, () => {
    const rows = Array.from({ length: MOVERS_LIMIT + 5 }, (_, i) => row(`t${i}`, 0, 1000 - i));
    const picked = selectMovers(rows);
    expect(picked).toHaveLength(MOVERS_LIMIT);
    // …and it keeps the BIGGEST, not the first N in input order.
    expect(picked[0]?.label).toBe("t0");
    expect(picked.at(-1)?.label).toBe(`t${MOVERS_LIMIT - 1}`);
  });

  test("does not mutate the caller's array", () => {
    const rows = [row("b", 0, 10), row("a", 0, 900)];
    const before = rows.map((r) => r.label);
    selectMovers(rows);
    expect(rows.map((r) => r.label)).toEqual(before);
  });
});

describe("the card says what it is showing", () => {
  test("the title is the CONCLUSION — the biggest mover and its signed delta", () => {
    const movers = selectMovers([row("search_files", 1240, 1890), row("read_file", 890, 640)]);
    expect(moversTitle(movers, "tool")).toBe("search_files moved most — +650 tokens");
  });

  test("a shrink keeps its sign in the title text, never colour alone", () => {
    const movers = selectMovers([row("read_file", 890, 140, "decreased")]);
    expect(moversTitle(movers, "tool")).toContain("-750");
  });

  test("the description DISCLOSES truncation rather than silently dropping rows", () => {
    const movers = selectMovers(Array.from({ length: 20 }, (_, i) => row(`t${i}`, 0, 100 + i)));
    const text = moversDescription(movers, 20, "tool");
    expect(text).toContain(`The ${MOVERS_LIMIT} biggest movers of 20 changed tools`);
  });

  test("when nothing is truncated it says so, and gets the singular right", () => {
    const movers = selectMovers([row("only", 0, 10)]);
    expect(moversDescription(movers, 1, "tool")).toContain("All 1 changed tool,");
  });

  test("the description explains the marks, because the SVG is aria-hidden", () => {
    const movers = selectMovers([row("a", 0, 10)]);
    const text = moversDescription(movers, 1, "tool");
    expect(text).toContain("hollow");
    expect(text).toContain("filled");
  });

  test("it names its own ordering, because the table below sorts differently", () => {
    // The chart ranks by MAGNITUDE; the diff table defaults to the SIGNED delta. Both are correct
    // and they disagree about what comes fourth, so the chart states which order it is using.
    const movers = selectMovers([row("up", 0, 180), row("down", 300, 0, "decreased")]);
    expect(movers.map((m) => m.label)).toEqual(["down", "up"]);
    expect(moversDescription(movers, 2, "tool")).toContain("ordered by size of change, up or down");
  });
});

describe("DeltaMoversChart — rendering", () => {
  test("renders nothing at all when no entity changed size", () => {
    const { container } = render(
      <DeltaMoversChart rows={[row("flat", 5, 5, "unchanged")]} entityLabel="tool" />,
    );
    // A blank chart card reads as broken; the table below owns the zero-diff empty state.
    expect(container).toBeEmptyDOMElement();
  });

  test("hands the chart the right keys, the magnitude sort, and only the capped rows", () => {
    dumbbellProps.mockClear();
    render(
      <DeltaMoversChart
        rows={Array.from({ length: 12 }, (_, i) => row(`t${i}`, 0, 500 - i))}
        entityLabel="tool"
      />,
    );
    const props = dumbbellProps.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(props.category).toBe("label");
    expect(props.startKey).toBe("beforeTokens");
    expect(props.endKey).toBe("afterTokens");
    expect(props.sortBy).toBe("delta");
    expect(props.showDelta).toBe(true);
    expect(props.data).toHaveLength(MOVERS_LIMIT);
  });

  test("the accessible description carries the same sentence the sighted reader gets", () => {
    dumbbellProps.mockClear();
    render(<DeltaMoversChart rows={[row("a", 0, 10)]} entityLabel="tool" />);
    const props = dumbbellProps.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(screen.getByText(String(props.accessibleDescription))).toBeInTheDocument();
  });

  test("an ADDED entity draws from zero rather than being treated as a special case", () => {
    dumbbellProps.mockClear();
    render(<DeltaMoversChart rows={[row("brand_new", 0, 1500, "added")]} entityLabel="tool" />);
    const data = dumbbellProps.mock.calls[0]?.[0].data as DeltaMoverRow[];
    expect(data[0]).toMatchObject({ label: "brand_new", beforeTokens: 0, afterTokens: 1500 });
  });

  test("a REMOVED entity ends at zero, for the same reason", () => {
    dumbbellProps.mockClear();
    render(<DeltaMoversChart rows={[row("gone", 1500, 0, "removed")]} entityLabel="tool" />);
    const data = dumbbellProps.mock.calls[0]?.[0].data as DeltaMoverRow[];
    expect(data[0]).toMatchObject({ label: "gone", beforeTokens: 1500, afterTokens: 0 });
  });
});
