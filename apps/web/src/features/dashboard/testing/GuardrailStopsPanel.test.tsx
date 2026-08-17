import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { parseRunFilter, type RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { defaultControls, drillDownHref } from "./dashboard-url-state";

vi.mock("@elabs-ai/components-charts", () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { GuardrailStopsPanel } from "./GuardrailStopsPanel";

function renderPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = { ...defaultControls(new Date("2026-07-17T00:00:00.000Z")), from: "2026-07-01", to: "2026-07-10" };

const SERIES: RunMetricsSeries[] = [
  series({ measure: "count", group: "max_turns", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 3, n: 3 }] }),
  series({ measure: "count", group: "stalled", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1, n: 1 }] }),
];

describe("GuardrailStopsPanel", () => {
  test("renders one stacked bar chart + a humanized breakdown row per stopReasonCode", () => {
    renderPanel(<GuardrailStopsPanel series={SERIES} controls={CONTROLS} onDrill={vi.fn()} />);
    expect(screen.getByText("Guardrail stops by reason")).toBeInTheDocument();
    expect(screen.getByText("Max turns")).toBeInTheDocument();
    expect(screen.getByText("Stalled")).toBeInTheDocument();
  });

  test("no guardrail stops → honest empty state", () => {
    renderPanel(<GuardrailStopsPanel series={[]} controls={CONTROLS} onDrill={vi.fn()} />);
    expect(screen.getByText("No guardrail stops")).toBeInTheDocument();
  });

  // WP 2.2 acceptance #3 — drill-down round trip for "a stopReasonCode slice": clicking a reason's
  // row must produce a RunFilter whose `stopReasonCode` round-trips to EXACTLY that one code.
  test("clicking a reason's row opens the runs feed scoped to EXACTLY that stopReasonCode (round trip)", () => {
    const onDrill = vi.fn();
    renderPanel(<GuardrailStopsPanel series={SERIES} controls={CONTROLS} onDrill={onDrill} />);
    fireEvent.click(screen.getByRole("button", { name: /open runs for max turns/i }));

    expect(onDrill).toHaveBeenCalledTimes(1);
    const filter = onDrill.mock.calls[0]![0];
    expect(filter.stopReasonCode).toEqual(["max_turns"]);

    const href = drillDownHref(filter);
    const encoded = decodeURIComponent(href.slice("/testing/runs?filter=".length));
    expect(parseRunFilter(encoded).stopReasonCode).toEqual(["max_turns"]);
  });

  test("clicking a DIFFERENT reason's row scopes to THAT code, not the first one", () => {
    const onDrill = vi.fn();
    renderPanel(<GuardrailStopsPanel series={SERIES} controls={CONTROLS} onDrill={onDrill} />);
    fireEvent.click(screen.getByRole("button", { name: /open runs for stalled/i }));
    expect(onDrill.mock.calls[0]![0].stopReasonCode).toEqual(["stalled"]);
  });
});
