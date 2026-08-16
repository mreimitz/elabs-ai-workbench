import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DashboardChartConfig, RunMetricsResponse, ScanMetricsResponse } from "@mcp-token-footprint/shared";

const getRunMetrics = vi.fn();
const getScanMetrics = vi.fn();
vi.mock("../../../lib/api", () => ({
  getRunMetrics: (...args: unknown[]) => getRunMetrics(...args),
  getScanMetrics: (...args: unknown[]) => getScanMetrics(...args),
}));

// Import AFTER the mock so the hook resolves the mocked `lib/api` export.
const { useCustomChartData } = await import("./use-custom-chart-data");
const { defaultControls } = await import("./dashboard-url-state");

const CONTROLS = defaultControls(new Date("2026-07-17T00:00:00.000Z"));

beforeEach(() => {
  getRunMetrics.mockReset();
  getScanMetrics.mockReset();
});

const RUNS_CONFIG: DashboardChartConfig = {
  source: "runs",
  measures: ["errorRate"],
  filter: {},
  bucket: "day",
  chartType: "line",
};

const SCANS_CONFIG: DashboardChartConfig = {
  source: "scans",
  measures: ["totalTokens"],
  bucket: "day",
  chartType: "bar",
};

const EMPTY_RUN_RESPONSE: RunMetricsResponse = {
  bucket: "day",
  timezone: "UTC",
  from: null,
  to: null,
  groupBy: null,
  measures: ["errorRate"],
  unavailableMeasures: [],
  series: [
    {
      measure: "errorRate",
      group: null,
      capabilityClass: null,
      points: [{ bucketStart: "2026-07-11T00:00:00.000Z", value: 0.2, n: 5 }],
    },
  ],
};

const EMPTY_SCAN_RESPONSE: ScanMetricsResponse = {
  bucket: "day",
  timezone: "UTC",
  from: null,
  to: null,
  servers: [
    {
      serverId: "srv-1",
      serverName: "Alpha",
      tokenProfile: "generic_o200k",
      points: [
        {
          bucketStart: "2026-07-11T00:00:00.000Z",
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
  ],
};

describe("useCustomChartData — runs source", () => {
  test("fetches GET /api/metrics/runs with the global window folded in, and pivots the response", async () => {
    getRunMetrics.mockResolvedValueOnce(EMPTY_RUN_RESPONSE);
    const { result } = renderHook(() => useCustomChartData(RUNS_CONFIG, CONTROLS));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getRunMetrics).toHaveBeenCalledTimes(1);
    const query = getRunMetrics.mock.calls[0]?.[0];
    expect(query.measures).toEqual(["errorRate"]);
    expect(query.filter.dateFrom).toBe(`${CONTROLS.from}T00:00:00.000Z`);
    expect(query.filter.dateTo).toBe(`${CONTROLS.to}T23:59:59.999Z`);

    expect(result.current.hasData).toBe(true);
    expect(result.current.unit).toBe("rate");
    expect(result.current.error).toBeNull();
    expect(getScanMetrics).not.toHaveBeenCalled();
  });

  test("a rejected fetch sets a terminal error and clears loading", async () => {
    getRunMetrics.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useCustomChartData(RUNS_CONFIG, CONTROLS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.hasData).toBe(false);
  });

  test("an empty measures array (an in-progress composer draft) never calls the API", async () => {
    const draft: DashboardChartConfig = { ...RUNS_CONFIG, measures: [] };
    const { result } = renderHook(() => useCustomChartData(draft, CONTROLS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getRunMetrics).not.toHaveBeenCalled();
    expect(result.current.hasData).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test("reload() re-fires the same query", async () => {
    getRunMetrics.mockResolvedValue(EMPTY_RUN_RESPONSE);
    const { result } = renderHook(() => useCustomChartData(RUNS_CONFIG, CONTROLS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getRunMetrics).toHaveBeenCalledTimes(1);

    act(() => result.current.reload());
    await waitFor(() => expect(getRunMetrics).toHaveBeenCalledTimes(2));
  });
});

describe("useCustomChartData — scans source", () => {
  test("fetches GET /api/metrics/scans and pivots the per-server response; never calls the runs endpoint", async () => {
    getScanMetrics.mockResolvedValueOnce(EMPTY_SCAN_RESPONSE);
    const { result } = renderHook(() => useCustomChartData(SCANS_CONFIG, CONTROLS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getScanMetrics).toHaveBeenCalledTimes(1);
    expect(getRunMetrics).not.toHaveBeenCalled();
    expect(result.current.unit).toBe("tokens");
    expect(result.current.hasData).toBe(true);
    expect(result.current.series).toEqual([{ key: "srv-1··totalTokens", label: "Alpha" }]);
  });

  test("the chart's own serverId wins over the global bar's selection", async () => {
    getScanMetrics.mockResolvedValueOnce(EMPTY_SCAN_RESPONSE);
    const scoped: DashboardChartConfig = { ...SCANS_CONFIG, serverId: "srv-only-this-one" };
    renderHook(() => useCustomChartData(scoped, { ...CONTROLS, serverId: ["srv-other"] }));

    await waitFor(() => expect(getScanMetrics).toHaveBeenCalledTimes(1));
    expect(getScanMetrics.mock.calls[0]?.[0]?.serverId).toBe("srv-only-this-one");
  });
});
