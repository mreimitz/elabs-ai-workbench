import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { DashboardChart, RunMetricsResponse } from "@mcp-token-footprint/shared";

// jsdom can't resolve @elabs-ai/components-charts' @visx deep imports (the established DurationPanel.test.tsx
// precedent) — the Preview section renders a real Line/BarChart, so it's stubbed. Production is
// untouched; the real build proves the real chart.
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

// ══ AM-OB4 — the ratio ("Custom share") editor ════════════════════════════════════════════════════
//
// The measure is generic, so the editor has to make it concrete: two `RunFilterBar`s worded as the
// question the operator is asking, and a config that only reaches the wire when it is actually
// plotted. These tests drive the real controls; the chart itself is a no-op stub in this suite (see
// the `@elabs-ai/components-charts` mock at the top), so nothing here claims anything about how the
// preview LOOKS — only about what it requests.

/** A saved chart plotting "what share of runs failed", with the base left as the chart's own filter. */
const RATIO_CHART: DashboardChart = {
  ...EXISTING_CHART,
  name: "Failure share",
  config: {
    source: "runs",
    measures: ["ratio"],
    filter: {},
    bucket: "day",
    chartType: "line",
    ratio: { numerator: { hasError: true } },
  },
};

describe("ChartComposerDialog — the ratio measure's numerator editor", () => {
  test("the numerator editor appears only while `ratio` is selected, and keeps its draft across a deselect", () => {
    renderDialog();
    // Not offered until the measure is picked — a filter bar for a measure you are not plotting is
    // just a confusing extra filter.
    expect(screen.queryByText("Count the runs that match…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Custom share" }));
    expect(screen.getByText("Count the runs that match…")).toBeInTheDocument();
    // The empty-numerator warning is present up front, because an empty one reads 100% forever.
    expect(screen.getByText(/an empty numerator matches every run/i)).toBeInTheDocument();

    // Deselecting hides the editor…
    fireEvent.click(screen.getByRole("button", { name: "Custom share" }));
    expect(screen.queryByText("Count the runs that match…")).not.toBeInTheDocument();
    // …and reselecting brings it back.
    fireEvent.click(screen.getByRole("button", { name: "Custom share" }));
    expect(screen.getByText("Count the runs that match…")).toBeInTheDocument();
  });

  test("`ratio` is a rate: it may share a chart with the other rates, not with a token count", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Custom share" }));
    expect(screen.getByRole("button", { name: "Error rate" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Tokens in" })).toBeDisabled();
  });

  test("saving with an EMPTY numerator is refused in the editor, before the request", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Empty share" } });
    fireEvent.click(screen.getByRole("button", { name: "Custom share" }));
    fireEvent.click(screen.getByRole("button", { name: "Create chart" }));

    // An unconstrained RunFilter is schema-VALID, so the API would accept this and store a chart that
    // reads 100% in every bucket forever. The editor is the only place that can catch it.
    expect(
      await screen.findByText(/Add at least one condition to the share's numerator/i),
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("a saved ratio pre-fills the editor, and re-saves with the denominator still OMITTED", async () => {
    mockUpdate.mockResolvedValueOnce(RATIO_CHART);
    renderDialog({ mode: "edit", chart: RATIO_CHART });

    expect(screen.getByRole("button", { name: "Custom share" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Count the runs that match…")).toBeInTheDocument();
    // Off by default — the base is the chart's own filter, which is the common case.
    expect(screen.getByRole("switch", { name: "…out of a narrower base" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText(/the base is this chart's own filter/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed share" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const config = mockUpdate.mock.calls[0]?.[1]?.config as
      | { ratio?: { numerator: unknown; denominator?: unknown } }
      | undefined;
    expect(config?.ratio?.numerator).toEqual({ hasError: true });
    // OMITTED, not `{}` — an empty denominator object and "no denominator" would both mean "the
    // chart's own filter", and carrying one implies a narrowing that is not there.
    expect(config?.ratio && "denominator" in config.ratio).toBe(false);
  });

  test("turning the base switch ON puts a denominator on the wire", async () => {
    mockUpdate.mockResolvedValueOnce(RATIO_CHART);
    renderDialog({ mode: "edit", chart: RATIO_CHART });

    fireEvent.click(screen.getByRole("switch", { name: "…out of a narrower base" }));
    expect(screen.queryByText(/the base is this chart's own filter/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const config = mockUpdate.mock.calls[0]?.[1]?.config as
      | { ratio?: { denominator?: unknown } }
      | undefined;
    expect(config?.ratio && "denominator" in config.ratio).toBe(true);
  });

  test("a chart that stops plotting `ratio` does not carry its stale config to the wire", async () => {
    mockUpdate.mockResolvedValueOnce(RATIO_CHART);
    renderDialog({ mode: "edit", chart: RATIO_CHART });

    // Swap the measure. The editor keeps the numerator draft (so an accidental toggle does not
    // discard work) but the SAVED config must not carry a numerator the chart no longer divides by —
    // the wire refuses that pair, and a reader would take it for the chart's meaning.
    fireEvent.click(screen.getByRole("button", { name: "Custom share" }));
    fireEvent.click(screen.getByRole("button", { name: "Error rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const config = mockUpdate.mock.calls[0]?.[1]?.config as
      | { measures: string[]; ratio?: unknown }
      | undefined;
    expect(config?.measures).toEqual(["errorRate"]);
    expect(config && "ratio" in config).toBe(false);
  });

  test("the preview carries the ratio to GET /api/metrics/runs rather than silently dropping it", async () => {
    mockGetRunMetrics.mockResolvedValue(EMPTY_RUN_METRICS);
    renderDialog({ mode: "edit", chart: RATIO_CHART });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
    const query = mockGetRunMetrics.mock.calls.at(-1)?.[0];
    expect(query?.measures).toEqual(["ratio"]);
    // The ratio's own filters are chart-local: they are NOT composed with the dashboard's global bar
    // (the composed `filter` already selected the population they narrow).
    expect(query?.ratio).toEqual({ numerator: { hasError: true } });
    expect(query?.filter.dateFrom).toBe(`${CONTROLS.from}T00:00:00.000Z`);
  });
});
