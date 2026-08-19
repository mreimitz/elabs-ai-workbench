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

import { ScoreTrendPanel } from "./ScoreTrendPanel";

function renderPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = { ...defaultControls(new Date("2026-07-17T00:00:00.000Z")), from: "2026-07-01", to: "2026-07-10" };

describe("ScoreTrendPanel", () => {
  test("renders the score trend and no dead grader control (the metrics contract has none)", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "meanScore", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.82, n: 4 }] }),
    ];
    renderPanel(<ScoreTrendPanel series={input} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    expect(screen.getByText("Score trend")).toBeInTheDocument();
    // No Select/combobox for grader — a picker with no backing measure would be a dead control.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("no graded runs → honest empty state", () => {
    renderPanel(<ScoreTrendPanel series={[]} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    expect(screen.getByText("No graded runs")).toBeInTheDocument();
  });

  // WP 0.2 — the per-bucket `DrillList` under this chart is GONE (it mirrored one row per plotted
  // point and existed only because of a stale "charts has no per-point onClick" claim). The chart is
  // the click surface now; that behaviour is locked in `datapoint-clicks.test.tsx`, which stubs
  // `@elabs-ai/components-charts` faithfully — the inert mock below cannot observe chart props.
  test("no per-bucket drill row remains — the chart carries the drill-down now", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "meanScore", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.5, n: 2 }] }),
    ];
    renderPanel(<ScoreTrendPanel series={input} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /open runs for/i })).not.toBeInTheDocument();
  });
});
