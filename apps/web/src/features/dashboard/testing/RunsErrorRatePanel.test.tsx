import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { parseRunFilter, type RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { bucketRangeIso, defaultControls, drillDownFilter, drillDownHref } from "./dashboard-url-state";

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

  // WP 0.2 — the per-bucket `DrillList` under this chart is GONE. It existed only because a comment
  // (written against charts v1.6.0; the app is on v4) claimed the chart had no per-point click, and
  // it mirrored one row per datapoint. The chart itself is now the click surface. Its behaviour is
  // locked in `datapoint-clicks.test.tsx`, which stubs `@elabs-ai/components-charts` FAITHFULLY — the
  // inert no-op mock below cannot see chart props, so the assertion has to live there.
  test("no per-bucket drill row remains — the chart carries the drill-down now", () => {
    renderPanel(
      <RunsErrorRatePanel
        series={SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /open runs for/i })).not.toBeInTheDocument();
  });

  // The drill-down filter this panel composes still has to survive the runs-feed wire, so keep the
  // serialize/parse round trip — just built from the shared helpers instead of a removed button.
  test("a bucket's drill filter round-trips through the runs-feed href unchanged", () => {
    const { from, to } = bucketRangeIso("2026-07-01T00:00:00.000Z", "day");
    const filter = drillDownFilter(CONTROLS, { dateFrom: from, dateTo: to });
    const href = drillDownHref(filter);
    const restored = parseRunFilter(decodeURIComponent(href.slice("/testing/runs?filter=".length)));
    expect(restored.dateFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(restored.dateTo).toBe("2026-07-01T23:59:59.999Z");
  });
});
