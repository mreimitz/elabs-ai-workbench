import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { defaultControls } from "./dashboard-url-state";

// `@elabs-ai/components-charts`'s barrel breaks under Vitest/jsdom regardless of which named export is used (a
// deep `@visx/gradient` subpath its Gantt chart pulls in fails to resolve — confirmed empirically;
// see `ScansTab.test.tsx`'s longer note for the same class of issue). Chart internals aren't what
// this test asserts on (the legend/DrillList rows live OUTSIDE the chart, as plain `@elabs-ai/components-ui`
// markup) — a thin pass-through keeps those real while no-op'ing the chart primitives.
vi.mock("@elabs-ai/components-charts", () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { TokensPanel } from "./TokensPanel";

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = defaultControls(new Date("2026-07-17T00:00:00.000Z"));

describe("TokensPanel — D-OB14 no-blend (the review focus)", () => {
  test("renders BOTH capability classes as SEPARATE labelled totals — no summed/blended figure anywhere", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "tokensIn", capabilityClass: "exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 4 }] }),
      series({
        measure: "tokensIn",
        capabilityClass: "estimated",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 300, n: 2 }],
      }),
      series({ measure: "tokensOut", capabilityClass: "exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 500, n: 4 }] }),
    ];
    render(<TokensPanel series={input} controls={CONTROLS} onDrill={vi.fn()} />);

    // Both class labels render (once for Input, once for Output — "exact" appears in both
    // directions here), each with its OWN total.
    expect(screen.getAllByText("Exact (provider-metered)").length).toBeGreaterThan(0);
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument(); // exact total, in
    expect(screen.getByText("300")).toBeInTheDocument(); // estimated total, in
    expect(screen.getByText("500")).toBeInTheDocument(); // exact total, out

    // The KEY assertion: no blended/summed figure (1000+300=1300) is rendered anywhere, and no
    // "Total"/"Blended"/"All" label exists — every rendered number is a class's OWN total.
    expect(screen.queryByText("1,300")).not.toBeInTheDocument();
    expect(screen.queryByText(/\btotal\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/blended/i)).not.toBeInTheDocument();
  });

  test("a direction with no data shows its own honest empty state, not a fabricated 0", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "tokensIn", capabilityClass: "exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 100, n: 1 }] }),
    ];
    render(<TokensPanel series={input} controls={CONTROLS} onDrill={vi.fn()} />);
    expect(screen.getByText("No output tokens")).toBeInTheDocument();
  });

  test("no token data at all → the panel's own empty state", () => {
    render(<TokensPanel series={[]} controls={CONTROLS} onDrill={vi.fn()} />);
    expect(screen.getByText("No token data")).toBeInTheDocument();
  });

  test("the header 'Open runs' action fires onDrill with the base filter (no per-class dimension — see the component doc)", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "tokensIn", capabilityClass: "exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 100, n: 1 }] }),
    ];
    const onDrill = vi.fn();
    render(<TokensPanel series={input} controls={CONTROLS} onDrill={onDrill} />);
    screen.getByRole("button", { name: /open these runs/i }).click();
    expect(onDrill).toHaveBeenCalledTimes(1);
    const filter = onDrill.mock.calls[0]![0];
    expect(filter.dateFrom).toBeDefined();
    expect(filter.dateTo).toBeDefined();
  });
});
