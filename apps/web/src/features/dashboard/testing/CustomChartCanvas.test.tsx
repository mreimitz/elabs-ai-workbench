import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// jsdom can't resolve @elabs-ai/components-charts' @visx deep imports — the established DurationPanel.test.tsx /
// GuardrailStopsPanel.test.tsx precedent: stub the mark components, keep production untouched (the
// real build proves the real chart).
vi.mock("@elabs-ai/components-charts", () => ({
  LineChart: ({ children }: { children: ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { CustomChartCanvas } from "./CustomChartCanvas";

const ROWS = [
  { bucketStart: "2026-07-01T00:00:00.000Z", x: new Date("2026-07-01T00:00:00.000Z"), a: 10 },
  { bucketStart: "2026-07-02T00:00:00.000Z", x: new Date("2026-07-02T00:00:00.000Z"), a: 20 },
];
const SERIES = [{ key: "a", label: "Series A" }];

describe("CustomChartCanvas", () => {
  test("loading renders a layout-shaped placeholder, never the chart or an empty state", () => {
    render(<CustomChartCanvas chartType="line" unit="count" loading error={null} rows={[]} series={[]} hasData={false} />);
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("No data in this window")).not.toBeInTheDocument();
  });

  test("a terminal error renders InlineError with retry, not the chart", () => {
    const onRetry = vi.fn();
    render(
      <CustomChartCanvas
        chartType="line"
        unit="count"
        loading={false}
        error="network down"
        rows={[]}
        series={[]}
        hasData={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Couldn’t load this chart")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  test("no data → the honest empty state (customizable copy)", () => {
    render(
      <CustomChartCanvas
        chartType="bar"
        unit="count"
        loading={false}
        error={null}
        rows={[]}
        series={[]}
        hasData={false}
        emptyTitle="No preview yet"
        emptyDescription="Select at least one measure to see a live preview."
      />,
    );
    expect(screen.getByText("No preview yet")).toBeInTheDocument();
  });

  test("chartType line renders LineChart", () => {
    render(<CustomChartCanvas chartType="line" unit="count" loading={false} error={null} rows={ROWS} series={SERIES} hasData />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  test("chartType bar/stacked render BarChart", () => {
    const { rerender } = render(
      <CustomChartCanvas chartType="bar" unit="count" loading={false} error={null} rows={ROWS} series={SERIES} hasData />,
    );
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    rerender(
      <CustomChartCanvas chartType="stacked" unit="count" loading={false} error={null} rows={ROWS} series={SERIES} hasData />,
    );
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });
});
