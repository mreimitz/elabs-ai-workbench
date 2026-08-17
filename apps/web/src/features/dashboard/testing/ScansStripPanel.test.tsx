import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ScanMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

vi.mock("@elabs-ai/components-charts", () => ({
  LineChart: ({ children }: { children: ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

import { ScansStripPanel } from "./ScansStripPanel";

function renderPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const SERIES: ScanMetricsSeries[] = [
  {
    serverId: "srv-1",
    serverName: "Alpha",
    tokenProfile: "generic_o200k",
    points: [
      {
        bucketStart: "2026-07-01T00:00:00.000Z",
        scanCount: 1,
        failureRate: 0,
        countingVersion: 2,
        totalTokens: 1200,
        toolTokens: 1000,
        resourceTokens: 100,
        promptTokens: 100,
        totalTools: 5,
        totalResources: 1,
        totalResourceTemplates: 0,
        totalPrompts: 1,
        deltaTotalTokens: null,
        deltaComparable: false,
      },
    ],
  },
];

describe("ScansStripPanel", () => {
  test("renders per-server footprint trend + a drill row per server", () => {
    renderPanel(<ScansStripPanel series={SERIES} onOpenServer={vi.fn()} />);
    expect(screen.getByText("Scans strip")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  test("no scans → honest empty state", () => {
    renderPanel(<ScansStripPanel series={[]} onOpenServer={vi.fn()} />);
    expect(screen.getByText("No scans in this window")).toBeInTheDocument();
  });

  test("clicking a server's row opens the SERVER DETAIL page, not a RunFilter (this is footprint, not run, data)", () => {
    const onOpenServer = vi.fn();
    renderPanel(<ScansStripPanel series={SERIES} onOpenServer={onOpenServer} />);
    fireEvent.click(screen.getByRole("button", { name: /open runs for alpha/i }));
    expect(onOpenServer).toHaveBeenCalledWith("srv-1");
  });
});
