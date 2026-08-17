import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { DashboardChart, RunMetricsResponse, ScanMetricsResponse } from "@mcp-token-footprint/shared";

// jsdom can't resolve @elabs-ai/components-charts' @visx deep imports — the established DurationPanel.test.tsx
// precedent. Production is untouched; the real build proves the real chart.
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

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listDashboardCharts: vi.fn(),
    createDashboardChart: vi.fn(),
    updateDashboardChart: vi.fn(),
    deleteDashboardChart: vi.fn(),
    cloneDashboardChart: vi.fn(),
    reorderDashboardCharts: vi.fn(),
    listScenarios: vi.fn().mockResolvedValue([]),
    listSuites: vi.fn().mockResolvedValue([]),
    listServers: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getRunMetrics: vi.fn(),
    getScanMetrics: vi.fn(),
  };
});

import {
  cloneDashboardChart,
  deleteDashboardChart,
  getRunMetrics,
  getScanMetrics,
  listDashboardCharts,
  reorderDashboardCharts,
} from "../../../lib/api";
import { CustomChartsSection } from "./CustomChartsSection";
import { defaultControls } from "./dashboard-url-state";

const mockList = vi.mocked(listDashboardCharts);
const mockDelete = vi.mocked(deleteDashboardChart);
const mockClone = vi.mocked(cloneDashboardChart);
const mockReorder = vi.mocked(reorderDashboardCharts);
const mockGetRunMetrics = vi.mocked(getRunMetrics);
const mockGetScanMetrics = vi.mocked(getScanMetrics);

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const CONTROLS = defaultControls(new Date("2026-07-17T00:00:00.000Z"));

const EMPTY_RUN_METRICS: RunMetricsResponse = {
  bucket: "day",
  timezone: "UTC",
  from: null,
  to: null,
  groupBy: null,
  measures: [],
  unavailableMeasures: [],
  series: [],
};
const EMPTY_SCAN_METRICS: ScanMetricsResponse = { bucket: "day", timezone: "UTC", from: null, to: null, servers: [] };

const CHART_A: DashboardChart = {
  id: "chart-a",
  name: "Error rate",
  config: { source: "runs", measures: ["errorRate"], filter: {}, bucket: "day", chartType: "line" },
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const CHART_B: DashboardChart = {
  id: "chart-b",
  name: "Footprint tokens",
  config: { source: "scans", measures: ["totalTokens"], bucket: "day", chartType: "bar" },
  position: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderSection() {
  return render(
    <TooltipProvider>
      <CustomChartsSection controls={CONTROLS} catalog={{}} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  mockList.mockReset();
  mockDelete.mockReset();
  mockClone.mockReset();
  mockReorder.mockReset();
  mockGetRunMetrics.mockReset();
  mockGetScanMetrics.mockReset();
  mockGetRunMetrics.mockResolvedValue(EMPTY_RUN_METRICS);
  mockGetScanMetrics.mockResolvedValue(EMPTY_SCAN_METRICS);
});

describe("CustomChartsSection — list", () => {
  test("an empty chart list renders the empty state with an Add chart action", async () => {
    mockList.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("No custom charts yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add chart" }).length).toBeGreaterThan(0);
  });

  test("renders each persisted chart as its own panel", async () => {
    mockList.mockResolvedValue([CHART_A, CHART_B]);
    renderSection();
    expect(await screen.findByText("Error rate")).toBeInTheDocument();
    expect(screen.getByText("Footprint tokens")).toBeInTheDocument();
  });

  test("a load failure renders InlineError with retry", async () => {
    mockList.mockRejectedValueOnce(new Error("network down"));
    renderSection();
    expect(await screen.findByText("Couldn’t load custom charts")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();

    mockList.mockResolvedValueOnce([CHART_A]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Error rate")).toBeInTheDocument();
  });
});

describe("CustomChartsSection — Add chart opens the composer in create mode", () => {
  test("clicking Add chart opens the dialog with an empty name", async () => {
    mockList.mockResolvedValue([]);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Add chart" }));
    expect(await screen.findByText("New chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});

describe("CustomChartsSection — per-chart actions", () => {
  test("Edit (overflow menu) opens the composer prefilled with that chart's name", async () => {
    mockList.mockResolvedValue([CHART_A, CHART_B]);
    renderSection();
    await screen.findByText("Error rate");
    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click (the established
    // WatchRulesView.test.tsx precedent) — fireEvent.click alone never opens it in jsdom. Each
    // trigger's aria-label already embeds the chart name, so it's unique without extra scoping.
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Error rate" }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Edit"));

    expect(await screen.findByText("Edit Error rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Error rate");
  });

  test("Clone (overflow menu) calls cloneDashboardChart and appends the result", async () => {
    mockList.mockResolvedValue([CHART_A]);
    mockClone.mockResolvedValueOnce({ ...CHART_A, id: "chart-a-copy", name: "Error rate (copy)", position: 1 });
    renderSection();
    await screen.findByText("Error rate");
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Error rate" }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Clone"));

    await waitFor(() => expect(mockClone).toHaveBeenCalledWith("chart-a"));
    expect(await screen.findByText("Error rate (copy)")).toBeInTheDocument();
  });

  test("Delete (overflow menu) confirms, then calls deleteDashboardChart and reloads", async () => {
    mockList.mockResolvedValue([CHART_A]); // both the initial load AND the post-delete reload
    mockDelete.mockResolvedValueOnce(undefined);
    renderSection();
    await screen.findByText("Error rate");
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Error rate" }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Delete"));

    fireEvent.click(await screen.findByRole("button", { name: "Delete chart" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("chart-a"));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2)); // initial + post-delete reload
  });

  test("move up/down is disabled at the boundaries and calls reorderDashboardCharts otherwise", async () => {
    mockList.mockResolvedValue([CHART_A, CHART_B]);
    mockReorder.mockResolvedValueOnce([
      { ...CHART_B, position: 0 },
      { ...CHART_A, position: 1 },
    ]);
    renderSection();
    await screen.findByText("Error rate");

    expect(screen.getByRole("button", { name: "Move Error rate up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Footprint tokens down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Error rate down" }));

    await waitFor(() => expect(mockReorder).toHaveBeenCalledWith(["chart-b", "chart-a"]));
  });
});
