import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type { DashboardChart, RunMetricsResponse } from "@mcp-token-footprint/shared";

// jsdom can't resolve @brand/charts' @visx deep imports (the established DurationPanel.test.tsx
// precedent) — the Preview section renders a real Line/BarChart, so it's stubbed. Production is
// untouched; the real build proves the real chart.
vi.mock("@brand/charts", () => ({
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
    listScenarios: vi.fn().mockResolvedValue([]),
    listSuites: vi.fn().mockResolvedValue([]),
    listServers: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    createDashboardChart: vi.fn(),
    updateDashboardChart: vi.fn(),
    getRunMetrics: vi.fn(),
    getScanMetrics: vi.fn(),
  };
});

import {
  ApiError,
  createDashboardChart,
  getRunMetrics,
  getScanMetrics,
  updateDashboardChart,
} from "../../../lib/api";
import { ChartComposerDialog } from "./ChartComposerDialog";
import { defaultControls } from "./dashboard-url-state";

const mockCreate = vi.mocked(createDashboardChart);
const mockUpdate = vi.mocked(updateDashboardChart);
const mockGetRunMetrics = vi.mocked(getRunMetrics);
const mockGetScanMetrics = vi.mocked(getScanMetrics);

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockGetRunMetrics.mockReset();
  mockGetScanMetrics.mockReset();
});

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

function renderDialog(props: Partial<ComponentProps<typeof ChartComposerDialog>> = {}) {
  const onSaved = vi.fn();
  const utils = render(
    <TooltipProvider>
      <ChartComposerDialog
        open
        onOpenChange={() => {}}
        mode="create"
        chart={null}
        controls={CONTROLS}
        catalog={{}}
        onSaved={onSaved}
        {...props}
      />
    </TooltipProvider>,
  );
  return { ...utils, onSaved };
}

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

const EXISTING_CHART: DashboardChart = {
  id: "chart-1",
  name: "Error rate",
  config: { source: "runs", measures: ["errorRate"], filter: {}, bucket: "day", chartType: "line" },
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ChartComposerDialog — create round-trip", () => {
  test("Create chart stays disabled with no name and no measure", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Create chart" })).toBeDisabled();
  });

  test("naming the chart + picking one measure enables Create, and submits the expected input", async () => {
    mockCreate.mockResolvedValueOnce({ ...EXISTING_CHART, id: "new-chart" });
    const { onSaved } = renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My chart" } });
    fireEvent.click(screen.getByRole("button", { name: "Error rate" }));
    expect(screen.getByRole("button", { name: "Create chart" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create chart" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0];
    expect(input?.name).toBe("My chart");
    expect(input?.config).toMatchObject({ source: "runs", measures: ["errorRate"], bucket: "day", chartType: "line" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("ChartComposerDialog — same-unit measure constraint", () => {
  test("selecting a rate measure disables an incompatible (different-unit) measure", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Error rate" })); // unit "rate"
    expect(screen.getByRole("button", { name: "Cost usd" })).toBeDisabled(); // unit "usd"
    expect(screen.getByRole("button", { name: "Guardrail rate" })).not.toBeDisabled(); // also "rate"
  });

  test("selecting a second same-unit measure is allowed", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Error rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardrail rate" }));
    expect(screen.getByRole("button", { name: "Error rate" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Guardrail rate" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ChartComposerDialog — source toggle swaps the measure vocabulary + filter visibility", () => {
  test("switching to Scans hides the RunFilterBar's Filter section and shows a Server picker", () => {
    renderDialog();
    expect(screen.getByText(/Extra constraints for THIS chart/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Scans" }));
    expect(screen.queryByText(/Extra constraints for THIS chart/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Server (optional)")).toBeInTheDocument();
    // The scans vocabulary is now shown (a runs-only measure like "Error rate" is gone).
    expect(screen.queryByRole("button", { name: "Error rate" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Total tokens" })).toBeInTheDocument();
  });
});

describe("ChartComposerDialog — live preview calls the metrics API directly (no separate preview endpoint)", () => {
  test("selecting a runs measure and opening Preview calls GET /api/metrics/runs with the draft config", async () => {
    mockGetRunMetrics.mockResolvedValueOnce(EMPTY_RUN_METRICS);
    renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview me" } });
    fireEvent.click(screen.getByRole("button", { name: "Error rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalledTimes(1));
    const query = mockGetRunMetrics.mock.calls[0]?.[0];
    expect(query?.measures).toEqual(["errorRate"]);
    expect(query?.bucket).toBe("day");
    // The global window is folded in (D-OB22 AND composition).
    expect(query?.filter.dateFrom).toBe(`${CONTROLS.from}T00:00:00.000Z`);
    expect(query?.filter.dateTo).toBe(`${CONTROLS.to}T23:59:59.999Z`);
  });

  test("a scans chart's preview calls GET /api/metrics/scans instead", async () => {
    mockGetScanMetrics.mockResolvedValueOnce({ bucket: "day", timezone: "UTC", from: null, to: null, servers: [] });
    renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Scans preview" } });
    fireEvent.click(screen.getByRole("radio", { name: "Scans" }));
    fireEvent.click(screen.getByRole("button", { name: "Total tokens" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(mockGetScanMetrics).toHaveBeenCalledTimes(1));
    expect(mockGetRunMetrics).not.toHaveBeenCalled();
  });
});

describe("ChartComposerDialog — edit round-trip", () => {
  test("pre-fills from the source chart and PATCHes only what changed", async () => {
    mockUpdate.mockResolvedValueOnce({ ...EXISTING_CHART, name: "Renamed" });
    renderDialog({ mode: "edit", chart: EXISTING_CHART });

    expect(screen.getByLabelText("Name")).toHaveValue("Error rate");
    expect(screen.getByRole("button", { name: "Error rate" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, input] = mockUpdate.mock.calls[0] ?? [];
    expect(id).toBe("chart-1");
    expect(input?.name).toBe("Renamed");
  });
});

describe("ChartComposerDialog — invalid config surfaces zod detail inline", () => {
  test("a 400 with `issues` renders each field path + message", async () => {
    mockCreate.mockRejectedValueOnce(
      new ApiError(400, "Validation failed", [{ path: ["config", "measures"], message: "Mixed units" }]),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad chart" } });
    fireEvent.click(screen.getByRole("button", { name: "Error rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Create chart" }));

    expect(await screen.findByText("config.measures: Mixed units")).toBeInTheDocument();
  });
});
