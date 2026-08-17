import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { defaultControls } from "./dashboard-url-state";

vi.mock("@elabs-ai/components-charts", () => ({
  LineChart: ({ children }: { children: ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { DurationPanel } from "./DurationPanel";

function renderPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = defaultControls(new Date("2026-07-17T00:00:00.000Z"));

describe("DurationPanel", () => {
  test("renders p50/p95 and marks a duration fallback bucket (D-US3 — never hidden)", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "p50DurationMs",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 5 }],
      }),
      series({
        measure: "p95DurationMs",
        durationFallback: true,
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 4000, n: 5 }],
      }),
    ];
    renderPanel(<DurationPanel series={input} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    expect(screen.getByText("Duration (p50 / p95)")).toBeInTheDocument();
    expect(screen.getByText("Some buckets use wall-clock duration")).toBeInTheDocument();
  });

  test("no fallback used → no fallback notice rendered", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "p50DurationMs",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 5 }],
      }),
    ];
    renderPanel(<DurationPanel series={input} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    expect(screen.queryByText("Some buckets use wall-clock duration")).not.toBeInTheDocument();
  });

  test("no duration data → the panel's own empty state", () => {
    renderPanel(<DurationPanel series={[]} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    expect(screen.getByText("No duration data")).toBeInTheDocument();
  });
});
