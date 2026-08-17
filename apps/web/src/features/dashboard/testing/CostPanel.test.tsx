import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { defaultControls } from "./dashboard-url-state";

vi.mock("@elabs-ai/components-charts", () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { CostPanel } from "./CostPanel";

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = defaultControls(new Date("2026-07-17T00:00:00.000Z"));

describe("CostPanel — D-OB14 no-blend", () => {
  test("renders both cost-basis classes as SEPARATE $ totals", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "costUsd", capabilityClass: "api_exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1.5, n: 3 }] }),
      series({
        measure: "costUsd",
        capabilityClass: "subscription_reference",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.75, n: 2 }],
      }),
    ];
    render(<CostPanel series={input} controls={CONTROLS} onDrill={vi.fn()} />);

    expect(screen.getByText("$ Exact (API-metered)")).toBeInTheDocument();
    expect(screen.getByText("$ Est. (subscription reference)")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("$0.75")).toBeInTheDocument();
    // The KEY assertion: no BLENDED $ figure (1.5 + 0.75 = 2.25) is rendered anywhere — each class
    // keeps its own total, and there is no "combined $" label mixing the two cost bases.
    expect(screen.queryByText("$2.25")).not.toBeInTheDocument();
    expect(screen.queryByText(/combined|blended/i)).not.toBeInTheDocument();
  });

  test("no cost data → the panel's own empty state", () => {
    render(<CostPanel series={[]} controls={CONTROLS} onDrill={vi.fn()} />);
    expect(screen.getByText("No cost data")).toBeInTheDocument();
  });

});
