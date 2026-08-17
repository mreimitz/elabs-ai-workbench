import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { parseRunFilter, type RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { defaultControls, drillDownHref } from "./dashboard-url-state";

vi.mock("@elabs-ai/components-charts", () => ({
  ComposedChart: ({ children }: { children: ReactNode }) => <div data-testid="composed-chart">{children}</div>,
  SeriesBar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { RunsErrorRatePanel } from "./RunsErrorRatePanel";

function renderPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = { ...defaultControls(new Date("2026-07-17T00:00:00.000Z")), from: "2026-07-01", to: "2026-07-10" };

const SERIES: RunMetricsSeries[] = [
  series({
    measure: "count",
    group: "claude-sonnet-4",
    points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 8, n: 8 }],
  }),
  series({
    measure: "errorRate",
    group: "claude-sonnet-4",
    points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.25, n: 8 }],
  }),
];

describe("RunsErrorRatePanel", () => {
  test("renders the panel title and the composed chart", () => {
    renderPanel(
      <RunsErrorRatePanel
        series={SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={vi.fn()}
      />,
    );
    expect(screen.getByText("Runs & error rate over time")).toBeInTheDocument();
    expect(screen.getByTestId("composed-chart")).toBeInTheDocument();
  });

  test("an empty window renders the panel's own empty state", () => {
    renderPanel(<RunsErrorRatePanel series={[]} controls={CONTROLS} bucket="day" groupLabel={(g) => g} onDrill={vi.fn()} />);
    expect(screen.getByText("No runs in this window")).toBeInTheDocument();
  });

  // WP 2.2 acceptance #3 — drill-down round trip for "an error-rate point": clicking the bucket's
  // DrillList row must produce a RunFilter that round-trips through serialize/parse to the EXACT
  // bucket window (folded via dateFrom/dateTo), scoped by the control bar's own base filter.
  test("clicking a bucket's drill row opens the runs feed scoped to EXACTLY that bucket's window (round trip)", () => {
    const onDrill = vi.fn();
    renderPanel(
      <RunsErrorRatePanel
        series={SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={onDrill}
      />,
    );
    const openButton = screen.getByRole("button", { name: /open runs for/i });
    fireEvent.click(openButton);

    expect(onDrill).toHaveBeenCalledTimes(1);
    const filter = onDrill.mock.calls[0]![0];
    expect(filter.dateFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(filter.dateTo).toBe("2026-07-01T23:59:59.999Z");

    // The SAME filter, run through the actual href builder + parsed back, matches byte-for-byte.
    const href = drillDownHref(filter);
    const encoded = decodeURIComponent(href.slice("/testing/runs?filter=".length));
    const restored = parseRunFilter(encoded);
    expect(restored.dateFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(restored.dateTo).toBe("2026-07-01T23:59:59.999Z");
  });
});
