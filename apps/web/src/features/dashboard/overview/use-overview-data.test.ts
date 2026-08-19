import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  AdvisorReport,
  RatingIssue,
  RunMetricsResponse,
  ScanMetricsResponse,
  ScanSummary,
  ServerConfig,
} from "@mcp-token-footprint/shared";
import type { OverviewRange } from "./overview-contract";

const getScanMetrics = vi.fn();
const getRunMetrics = vi.fn();
const getAdvisorReport = vi.fn();
const listIssues = vi.fn();
const listServers = vi.fn();
const listScans = vi.fn();

vi.mock("../../../lib/api", () => ({
  getScanMetrics: (...args: unknown[]) => getScanMetrics(...args),
  getRunMetrics: (...args: unknown[]) => getRunMetrics(...args),
  getAdvisorReport: (...args: unknown[]) => getAdvisorReport(...args),
  listIssues: (...args: unknown[]) => listIssues(...args),
  listServers: (...args: unknown[]) => listServers(...args),
  listScans: (...args: unknown[]) => listScans(...args),
}));

// Imported AFTER the mock so the hook resolves the mocked `lib/api` exports.
const { useOverviewData } = await import("./use-overview-data");

const RANGE_7D: OverviewRange = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-08T00:00:00.000Z",
  preset: "7d",
};
const RANGE_24H: OverviewRange = {
  from: "2026-08-07T00:00:00.000Z",
  to: "2026-08-08T00:00:00.000Z",
  preset: "24h",
};
const NOW = new Date("2026-08-08T00:00:00.000Z");

const SCAN_METRICS: ScanMetricsResponse = {
  bucket: "day",
  timezone: "UTC",
  from: null,
  to: null,
  servers: [
    {
      serverId: "s1",
      serverName: "Files",
      tokenProfile: "generic_o200k",
      points: [
        {
          bucketStart: "2026-08-02T00:00:00.000Z",
          scanCount: 1,
          failureRate: 0,
          countingVersion: 2,
          totalTokens: 1200,
          toolTokens: 1000,
          resourceTokens: 150,
          promptTokens: 50,
          totalTools: 9,
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

const EMPTY_SCAN_METRICS: ScanMetricsResponse = { ...SCAN_METRICS, servers: [] };

const RUN_METRICS: RunMetricsResponse = {
  bucket: "day",
  timezone: "UTC",
  from: null,
  to: null,
  groupBy: null,
  measures: ["count", "errorRate", "costUsd"],
  unavailableMeasures: [],
  series: [
    {
      measure: "count",
      group: null,
      capabilityClass: null,
      points: [{ bucketStart: "2026-08-02T00:00:00.000Z", value: 5, n: 5 }],
    },
    {
      measure: "errorRate",
      group: null,
      capabilityClass: null,
      points: [{ bucketStart: "2026-08-02T00:00:00.000Z", value: 0.2, n: 5 }],
    },
    {
      measure: "costUsd",
      group: null,
      capabilityClass: "api_exact",
      points: [{ bucketStart: "2026-08-02T00:00:00.000Z", value: 1.25, n: 5 }],
    },
    {
      measure: "costUsd",
      group: null,
      capabilityClass: "subscription_reference",
      points: [{ bucketStart: "2026-08-02T00:00:00.000Z", value: 4, n: 5 }],
    },
  ],
};

const EMPTY_RUN_METRICS: RunMetricsResponse = { ...RUN_METRICS, series: [] };

const ADVISOR: AdvisorReport = {
  advisorVersion: 1,
  generatedAt: "2026-08-08T00:00:00.000Z",
  scope: { kind: "fleet" },
  insufficientData: [],
  recommendations: [
    {
      id: "rec-1",
      ruleId: "unused-tools",
      title: "Trim 12 never-called tools",
      detail: "They cost tokens on every turn.",
      severity: "high",
      evidence: [{ kind: "scan", id: "scan-1", label: "Files" }],
      assumptions: [],
    },
  ],
} as AdvisorReport;

const SERVERS: ServerConfig[] = [
  { id: "s1", name: "Files" } as ServerConfig,
  { id: "s2", name: "Unscanned" } as ServerConfig,
];
const SCANS: ScanSummary[] = [
  {
    id: "scan-1",
    serverId: "s1",
    status: "success",
    scannedAt: "2026-08-02T00:00:00.000Z",
  } as ScanSummary,
];
const ISSUES: RatingIssue[] = [];

function resolveAllHappily() {
  getScanMetrics.mockResolvedValue(SCAN_METRICS);
  getRunMetrics.mockResolvedValue(RUN_METRICS);
  getAdvisorReport.mockResolvedValue(ADVISOR);
  listIssues.mockResolvedValue(ISSUES);
  listServers.mockResolvedValue(SERVERS);
  listScans.mockResolvedValue(SCANS);
}

beforeEach(() => {
  for (const mock of [
    getScanMetrics,
    getRunMetrics,
    getAdvisorReport,
    listIssues,
    listServers,
    listScans,
  ]) {
    mock.mockReset();
  }
});

describe("useOverviewData", () => {
  test("fills every section of the contract from existing endpoints", async () => {
    resolveAllHappily();
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );

    // Every section starts as `loading` — never as a fabricated empty.
    expect(result.current.footprint.state).toBe("loading");
    expect(result.current.runHealth.state).toBe("loading");
    expect(result.current.attention.state).toBe("loading");
    expect(result.current.advisor.state).toBe("loading");

    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
    await waitFor(() => expect(result.current.runHealth.state).toBe("ready"));
    await waitFor(() => expect(result.current.attention.state).toBe("ready"));
    await waitFor(() => expect(result.current.advisor.state).toBe("ready"));

    expect(result.current.footprint.data?.totalTokens).toBe(1200);
    expect(result.current.footprint.data?.perServer[0]?.serverName).toBe("Files");
    expect(result.current.runHealth.data?.runCount).toBe(5);
    expect(result.current.runHealth.data?.passRatePercent).toBeCloseTo(80, 6);
    // Two cost bases, side by side — never one blended figure (D-OB14).
    expect(result.current.runHealth.data?.costByBasis.map((figure) => figure.basis)).toEqual([
      "api_exact",
      "subscription_reference",
    ]);
    expect(result.current.attention.data?.items.map((item) => item.kind)).toEqual([
      "server_unscanned",
    ]);
    expect(result.current.advisor.data?.title).toBe("Trim 12 never-called tools");
  });

  test("never requests `feedbackRate` (it has no backing computation)", async () => {
    resolveAllHappily();
    renderHook(() => useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }));
    await waitFor(() => expect(getRunMetrics).toHaveBeenCalled());
    for (const call of getRunMetrics.mock.calls) {
      expect((call[0] as { measures: string[] }).measures).not.toContain("feedbackRate");
    }
  });

  test("asks the scans endpoint twice for the whole fleet — one windowed, one standing — and never per-server", async () => {
    resolveAllHappily();
    renderHook(() => useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }));
    // TWO calls by design (the fix for the window-scoped-footprint defect): the windowed one draws
    // the trend, the UNSCOPED one carries the standing figures so a quiet window cannot delete the
    // fleet's startup cost. Neither is per-server — one response already covers the whole fleet.
    await waitFor(() => expect(getScanMetrics).toHaveBeenCalledTimes(2));
    const scanQueries = getScanMetrics.mock.calls.map(
      (call) => call[0] as { serverId?: string; from?: string; to?: string; bucket: string },
    );
    for (const query of scanQueries) expect(query.serverId).toBeUndefined();
    expect(scanQueries[0]).toMatchObject({ from: RANGE_7D.from, to: RANGE_7D.to });
    // The standing request carries NO window at all — that is the whole point of it.
    expect(scanQueries[1]?.from).toBeUndefined();
    expect(scanQueries[1]?.to).toBeUndefined();
    // Run metrics is exactly two calls: the current window and its equal-length baseline.
    await waitFor(() => expect(getRunMetrics).toHaveBeenCalledTimes(2));
    expect(getRunMetrics.mock.calls[1]?.[0]).toMatchObject({
      from: "2026-07-25T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    });
  });

  test("the standing footprint keeps the fleet's figures on screen in a window with NO scan in it", async () => {
    resolveAllHappily();
    // The owner's real shape: 103 scans on record, none inside the selected window.
    getScanMetrics.mockImplementation((query: { from?: string }) =>
      Promise.resolve(query.from === undefined ? SCAN_METRICS : EMPTY_SCAN_METRICS),
    );
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
    // The section is READY, not `empty` — the tiles stay on the bento.
    expect(result.current.footprint.data?.totalTokens).toBe(1200);
    expect(result.current.footprint.data?.mix).toEqual({
      toolTokens: 1000,
      resourceTokens: 150,
      promptTokens: 50,
    });
    // …and it says, in the contract, that the trend is the thing that is missing.
    expect(result.current.footprint.data?.noActivityInWindow).toBe(true);
    expect(result.current.footprint.data?.perServer).toEqual([]);
    expect(result.current.footprint.data?.latestMeasuredAt).toBe("2026-08-02T00:00:00.000Z");
  });

  test("the footprint is `empty` only when the fleet has NO successful scan at all", async () => {
    resolveAllHappily();
    getScanMetrics.mockResolvedValue(EMPTY_SCAN_METRICS);
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );
    await waitFor(() => expect(result.current.footprint.state).toBe("empty"));
  });

  test("a failed STANDING request surfaces as an error, never as an empty footprint", async () => {
    resolveAllHappily();
    getScanMetrics.mockImplementation((query: { from?: string }) =>
      query.from === undefined
        ? Promise.reject(new Error("Scan metrics unavailable"))
        : Promise.resolve(SCAN_METRICS),
    );
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );
    await waitFor(() => expect(result.current.footprint.state).toBe("error"));
    expect(result.current.footprint.error).toBe("Scan metrics unavailable");
  });

  test("an error in one section never blanks the others", async () => {
    resolveAllHappily();
    getAdvisorReport.mockRejectedValue(new Error("Advisor unavailable"));
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );

    await waitFor(() => expect(result.current.advisor.state).toBe("error"));
    expect(result.current.advisor.error).toBe("Advisor unavailable");
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
    expect(result.current.runHealth.state).toBe("ready");
    expect(result.current.attention.state).toBe("ready");
  });

  test("a settled-but-empty source becomes `empty`, so its tile can remove itself", async () => {
    getScanMetrics.mockResolvedValue(EMPTY_SCAN_METRICS);
    getRunMetrics.mockResolvedValue(EMPTY_RUN_METRICS);
    getAdvisorReport.mockResolvedValue({ ...ADVISOR, recommendations: [] });
    listIssues.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: [], scans: [], now: NOW }),
    );
    await waitFor(() => expect(result.current.footprint.state).toBe("empty"));
    await waitFor(() => expect(result.current.runHealth.state).toBe("empty"));
    await waitFor(() => expect(result.current.attention.state).toBe("empty"));
    await waitFor(() => expect(result.current.advisor.state).toBe("empty"));
    expect(result.current.footprint.data).toBeNull();
  });

  test("aborts the in-flight range-scoped requests when the range changes", async () => {
    resolveAllHappily();
    const { rerender } = renderHook(
      (range: OverviewRange) =>
        useOverviewData(range, { servers: SERVERS, scans: SCANS, now: NOW }),
      {
        initialProps: RANGE_7D,
      },
    );
    await waitFor(() => expect(getScanMetrics).toHaveBeenCalledTimes(2));
    // Call 0 is the WINDOWED footprint request, call 1 the standing one (declaration order).
    const firstScanSignal = getScanMetrics.mock.calls[0]?.[1] as AbortSignal;
    const standingSignal = getScanMetrics.mock.calls[1]?.[1] as AbortSignal;
    const firstRunSignal = getRunMetrics.mock.calls[0]?.[1] as AbortSignal;
    expect(firstScanSignal.aborted).toBe(false);

    rerender(RANGE_24H);

    expect(firstScanSignal.aborted).toBe(true);
    expect(firstRunSignal.aborted).toBe(true);
    // The standing request is NOT range-scoped, so a window switch neither aborts nor refires it.
    expect(standingSignal.aborted).toBe(false);
    await waitFor(() => expect(getScanMetrics).toHaveBeenCalledTimes(3));
    // The new window is what the refired windowed call asks for, at the 24h preset's hourly bucket.
    expect(getScanMetrics.mock.calls[2]?.[0]).toMatchObject({
      from: RANGE_24H.from,
      bucket: "hour",
    });
  });

  test("a stale response that lands after an abort can never overwrite the new window", async () => {
    let resolveStale: ((value: ScanMetricsResponse) => void) | undefined;
    getScanMetrics
      .mockImplementationOnce(
        () =>
          new Promise<ScanMetricsResponse>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValue(EMPTY_SCAN_METRICS);
    getRunMetrics.mockResolvedValue(RUN_METRICS);
    getAdvisorReport.mockResolvedValue(ADVISOR);
    listIssues.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      (range: OverviewRange) => useOverviewData(range, { servers: [], scans: [], now: NOW }),
      { initialProps: RANGE_7D },
    );
    // Two calls on mount: the windowed one is the pending mock, the standing one resolves empty.
    await waitFor(() => expect(getScanMetrics).toHaveBeenCalledTimes(2));
    rerender(RANGE_24H);
    await waitFor(() => expect(result.current.footprint.state).toBe("empty"));

    resolveStale?.(SCAN_METRICS);
    await Promise.resolve();
    expect(result.current.footprint.state).toBe("empty");
    expect(result.current.footprint.data).toBeNull();
  });

  test("a range change returns the range-scoped sections to `loading`, never stale figures", async () => {
    resolveAllHappily();
    const { result, rerender } = renderHook(
      (range: OverviewRange) =>
        useOverviewData(range, { servers: SERVERS, scans: SCANS, now: NOW }),
      { initialProps: RANGE_7D },
    );
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
    rerender(RANGE_24H);
    expect(result.current.footprint.state).toBe("loading");
    expect(result.current.footprint.data).toBeNull();
    // The advisor is not range-scoped, so it is neither refetched nor reset.
    expect(result.current.advisor.state).toBe("ready");
    expect(getAdvisorReport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
  });

  test("fetches its own servers/scans only when the host did not supply them", async () => {
    resolveAllHappily();
    const supplied = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );
    await waitFor(() => expect(supplied.result.current.attention.state).toBe("ready"));
    expect(listServers).not.toHaveBeenCalled();
    expect(listScans).not.toHaveBeenCalled();

    const standalone = renderHook(() => useOverviewData(RANGE_7D));
    await waitFor(() => expect(standalone.result.current.attention.state).toBe("ready"));
    expect(listServers).toHaveBeenCalledTimes(1);
    expect(listScans).toHaveBeenCalledTimes(1);
    expect(standalone.result.current.attention.data?.items.map((item) => item.kind)).toEqual([
      "server_unscanned",
    ]);
  });

  test("attention surfaces a failure from any of its three sources", async () => {
    resolveAllHappily();
    listIssues.mockRejectedValue(new Error("Issues unavailable"));
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );
    await waitFor(() => expect(result.current.attention.state).toBe("error"));
    expect(result.current.attention.error).toBe("Issues unavailable");
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
  });

  test("`reload` re-fires every section", async () => {
    resolveAllHappily();
    const { result } = renderHook(() =>
      useOverviewData(RANGE_7D, { servers: SERVERS, scans: SCANS, now: NOW }),
    );
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
    act(() => result.current.reload());
    // Both footprint requests re-fire (windowed + standing), so 2 on mount becomes 4.
    await waitFor(() => expect(getScanMetrics).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.footprint.state).toBe("ready"));
    expect(getAdvisorReport).toHaveBeenCalledTimes(2);
    expect(listIssues).toHaveBeenCalledTimes(2);
  });
});
