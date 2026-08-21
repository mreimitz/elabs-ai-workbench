import type { ReactNode } from "react";
import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type {
  RunMetricsResponse,
  RunMetricsSeries,
  RunSummary,
  ScanMetricsResponse,
  Scenario,
  ServerConfig,
  Suite,
  Test,
} from "@mcp-token-footprint/shared";
import { parseRunFilter } from "@mcp-token-footprint/shared";
import { resolveDashboardRange } from "./dashboard-range";

// Same class of jsdom/Vitest issue `ScansTab.test.tsx`/`RunConsole.test.tsx` already document: the
// `@elabs-ai/components-charts` barrel pulls in a broken deep `@visx/gradient` subpath (via its Gantt chart) that
// fails to resolve under Vitest — confirmed empirically for EVERY named export, not just `MetricGrid`
// (see the WP report). None of this test's assertions touch chart internals (they read the
// legend/DrillList/KPI markup, which is plain `@elabs-ai/components-ui`), so a thin pass-through is sufficient.
vi.mock("@elabs-ai/components-charts", () => ({
  MetricGrid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MetricCard: ({ label, value, description }: { label: string; value: string; description?: string }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
      {description ? <span>{description}</span> : null}
    </div>
  ),
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div data-testid="line-chart">{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div data-testid="composed-chart">{children}</div>,
  Bar: () => null,
  SeriesBar: () => null,
  Line: () => null,
  Grid: () => null,
  BarXAxis: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ChartTooltip: () => null,
}));

const getRunMetricsMock = vi.fn();
const getScanMetricsMock = vi.fn();
const getMostExpensiveRunsMock = vi.fn();
const listServersMock = vi.fn();
const listScenariosMock = vi.fn();
const listSuitesMock = vi.fn();
const listTestsMock = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRunMetrics: (...args: unknown[]) => getRunMetricsMock(...args),
    getScanMetrics: (...args: unknown[]) => getScanMetricsMock(...args),
    getMostExpensiveRuns: (...args: unknown[]) => getMostExpensiveRunsMock(...args),
    listServers: (...args: unknown[]) => listServersMock(...args),
    listScenarios: (...args: unknown[]) => listScenariosMock(...args),
    listSuites: (...args: unknown[]) => listSuitesMock(...args),
    listTests: (...args: unknown[]) => listTestsMock(...args),
    // WP 2.7 — the custom chart composer section mounted under the prebuilt panels fetches its OWN
    // list on mount; none of THIS file's assertions exercise it, so it's stubbed to a stable empty
    // list (never touching real `fetch`, never surfacing its own error/retry alongside the prebuilt
    // panels' — see `CustomChartsSection.test.tsx` for its dedicated coverage).
    listDashboardCharts: vi.fn().mockResolvedValue([]),
  };
});

import { TestingTab } from "./TestingTab";

function metricsSeries(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

function runMetricsResponse(
  series: RunMetricsSeries[],
  unavailableMeasures: RunMetricsResponse["unavailableMeasures"] = [],
): RunMetricsResponse {
  return {
    bucket: "day",
    timezone: "UTC",
    from: null,
    to: null,
    groupBy: null,
    measures: [],
    unavailableMeasures,
    series,
  };
}

function scanMetricsResponse(servers: ScanMetricsResponse["servers"] = []): ScanMetricsResponse {
  return { bucket: "day", timezone: "UTC", from: null, to: null, servers };
}

const SERVER: ServerConfig = {
  id: "srv-1",
  name: "Alpha",
  transport: "streamable_http",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hasEnvSecrets: false,
  hasHeaderSecrets: false,
  authType: "none",
};

const SCENARIO: Scenario = {
  id: "scn-1",
  name: "Prod environment",
  providerId: "prov-1",
  model: "claude-sonnet-4",
  params: {},
  systemPrompt: "",
  allowedServers: [],
  allowedSkills: [],
  defaultProfiles: [],
  guardrails: {},
  toolLoadingMode: "eager",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const SUITE: Suite = {
  id: "suite-1",
  name: "Regression",
  config: { repetitions: 1, maxConcurrency: 1 },
  testIds: [],
  scenarioIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const TEST_ROW: Test = {
  id: "test-1",
  name: "Failing test",
  userPrompt: "…",
  addedProfiles: [],
  attachments: [],
  tags: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const EXPENSIVE_RUN: RunSummary = {
  id: "run-1",
  testId: "test-1",
  scenarioId: "scn-1",
  mode: "automated",
  status: "completed",
  startedAt: "2026-07-05T00:00:00.000Z",
  turns: 3,
  toolCalls: 1,
  peakContextTokens: 1000,
  tokensIn: 500,
  tokensOut: 200,
  costUsd: 9.5,
};

/** RM-33 WP 3.3 — swapped by `installUnmeasuredCache()` so one test can exercise the panel's
 *  "the API could not measure this" branch through the whole tab. */
const DEFAULT_CACHE_FIXTURE = (): RunMetricsResponse =>
  runMetricsResponse([
    metricsSeries({
      measure: "cacheReadTokens",
      capabilityClass: "exact",
      points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 800, n: 8 }],
    }),
    metricsSeries({
      measure: "cacheWriteTokens",
      capabilityClass: "exact",
      points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 100, n: 8 }],
    }),
    metricsSeries({
      measure: "cacheHitRate",
      points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 0.8, n: 8 }],
    }),
  ]);

let cacheFixture: () => RunMetricsResponse = DEFAULT_CACHE_FIXTURE;

/** Every run in the window predates migration v59: the API answers with NO cache series and lists
 *  the three measures as unavailable. */
function installUnmeasuredCache() {
  cacheFixture = () =>
    runMetricsResponse([], ["cacheReadTokens", "cacheWriteTokens", "cacheHitRate"]);
}

/** Dispatch `getRunMetrics` fixtures by (bucket, groupBy, measures) — the unique fingerprint of
 *  each of `useTestingMetrics`'s 8 parallel calls (see `use-testing-dashboard-data.ts`). */
function installNonEmptyMetrics() {
  getRunMetricsMock.mockImplementation(async (query: { bucket: string; groupBy?: string; measures: string[] }) => {
    const m = query.measures.slice().sort().join(",");
    if (query.bucket === "week" && query.groupBy === "test") {
      return runMetricsResponse([
        metricsSeries({ measure: "count", group: "test-1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 10, n: 10 }] }),
        metricsSeries({ measure: "errorRate", group: "test-1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.3, n: 10 }] }),
      ]);
    }
    if (query.bucket === "week" && query.groupBy === "server") {
      return runMetricsResponse([
        metricsSeries({ measure: "count", group: "srv-1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 20, n: 20 }] }),
        metricsSeries({ measure: "errorRate", group: "srv-1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.25, n: 20 }] }),
      ]);
    }
    if (query.groupBy === "stopReasonCode") {
      return runMetricsResponse([
        metricsSeries({
          measure: "count",
          group: "max_turns",
          points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 3, n: 3 }],
        }),
      ]);
    }
    if (m === "count,errorRate") {
      return runMetricsResponse([
        metricsSeries({
          measure: "count",
          group: query.groupBy === "server" ? "srv-1" : query.groupBy === "providerKind" ? "anthropic" : "claude-sonnet-4",
          points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 8, n: 8 }],
        }),
        metricsSeries({
          measure: "errorRate",
          group: query.groupBy === "server" ? "srv-1" : query.groupBy === "providerKind" ? "anthropic" : "claude-sonnet-4",
          points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 0.25, n: 8 }],
        }),
      ]);
    }
    if (m === "p50DurationMs,p95DurationMs") {
      return runMetricsResponse([
        metricsSeries({ measure: "p50DurationMs", points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 1000, n: 8 }] }),
        metricsSeries({ measure: "p95DurationMs", points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 4000, n: 8 }] }),
      ]);
    }
    if (m === "tokensIn,tokensOut") {
      return runMetricsResponse([
        metricsSeries({
          measure: "tokensIn",
          capabilityClass: "exact",
          points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 1000, n: 8 }],
        }),
        metricsSeries({
          measure: "tokensOut",
          capabilityClass: "exact",
          points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 500, n: 8 }],
        }),
      ]);
    }
    // RM-33 WP 3.3 — the cache panel's own request (a separate call: `cacheHitRate` is a rate, the
    // other two are tokens).
    if (m === "cacheHitRate,cacheReadTokens,cacheWriteTokens") {
      return cacheFixture();
    }
    if (m === "costUsd") {
      return runMetricsResponse([
        metricsSeries({
          measure: "costUsd",
          capabilityClass: "api_exact",
          points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 2.5, n: 8 }],
        }),
      ]);
    }
    if (m === "meanScore") {
      return runMetricsResponse([
        metricsSeries({ measure: "meanScore", points: [{ bucketStart: "2026-07-05T00:00:00.000Z", value: 0.8, n: 4 }] }),
      ]);
    }
    throw new Error(`unexpected getRunMetrics query in test fixture: ${JSON.stringify(query)}`);
  });
  getScanMetricsMock.mockResolvedValue(
    scanMetricsResponse([
      {
        serverId: "srv-1",
        serverName: "Alpha",
        tokenProfile: "generic_o200k",
        points: [
          {
            bucketStart: "2026-07-05T00:00:00.000Z",
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
    ]),
  );
  getMostExpensiveRunsMock.mockResolvedValue([EXPENSIVE_RUN]);
}

function installEmptyMetrics() {
  getRunMetricsMock.mockResolvedValue(runMetricsResponse([]));
  getScanMetricsMock.mockResolvedValue(scanMetricsResponse([]));
  getMostExpensiveRunsMock.mockResolvedValue([]);
}

function installCatalog() {
  listServersMock.mockResolvedValue([SERVER]);
  listScenariosMock.mockResolvedValue([SCENARIO]);
  listSuitesMock.mockResolvedValue([SUITE]);
  listTestsMock.mockResolvedValue([TEST_ROW]);
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

/** The page range the Dashboard host now supplies (dashboard-bento WP 2.2) — pinned so the fetch
 *  window these tests assert against never drifts with the clock. */
const RANGE = resolveDashboardRange(
  { kind: "custom", from: "2026-07-11", to: "2026-07-17" },
  new Date("2026-07-17T12:00:00.000Z"),
);

function renderTab(initialEntries: string[] = ["/dashboard?tab=testing"], range = RANGE) {
  // The panels' drill-down rows render `IconButton`s (D-TB5), which wrap every control in a Radix
  // `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one; this
  // file's render doesn't get it automatically).
  return rtlRender(
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <TestingTab range={range} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  cacheFixture = DEFAULT_CACHE_FIXTURE;
});

describe("TestingTab — loading / error / empty states", () => {
  test("shows a layout-shaped skeleton before the first fetch settles (no spinner collapse)", async () => {
    installCatalog();
    let resolveMetrics: (() => void) | undefined;
    getRunMetricsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetrics = () => resolve(runMetricsResponse([]));
        }),
    );
    getScanMetricsMock.mockImplementation(() => new Promise(() => {}));
    getMostExpensiveRunsMock.mockImplementation(() => new Promise(() => {}));

    const { container } = renderTab();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
    expect(screen.queryByText("Runs & error rate over time")).not.toBeInTheDocument();

    await act(async () => {
      resolveMetrics?.();
      await Promise.resolve();
    });
  });

  test("a terminal fetch failure (never loaded) shows InlineError with retry", async () => {
    installCatalog();
    getRunMetricsMock.mockRejectedValue(new Error("network down"));
    getScanMetricsMock.mockResolvedValue(scanMetricsResponse([]));
    getMostExpensiveRunsMock.mockResolvedValue([]);

    renderTab();
    await waitFor(() => expect(screen.getByText("Couldn’t load testing metrics")).toBeInTheDocument());
    expect(screen.getByText(/network down/)).toBeInTheDocument();

    const callsBefore = getRunMetricsMock.mock.calls.length;
    installNonEmptyMetrics();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(getRunMetricsMock.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.getByText("Runs & error rate over time")).toBeInTheDocument());
  });

  test("a genuinely empty window (no runs, no scans) shows the honest 'no data' empty state — never zero-filled panels", async () => {
    installCatalog();
    installEmptyMetrics();
    renderTab();
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
    expect(screen.queryByText("Guardrail stops by reason")).not.toBeInTheDocument();
  });
});

describe("TestingTab — all 8 panels render from fixtures", () => {
  test("every panel title renders once real data loads", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();

    await waitFor(() => expect(screen.getByText("Runs & error rate over time")).toBeInTheDocument());
    expect(screen.getByText("Guardrail stops by reason")).toBeInTheDocument();
    expect(screen.getByText("Duration (p50 / p95)")).toBeInTheDocument();
    expect(screen.getByText("Tokens by capability class")).toBeInTheDocument();
    expect(screen.getByText("Prompt cache")).toBeInTheDocument();
    expect(screen.getByText("Cost by basis")).toBeInTheDocument();
    expect(screen.getByText("Score trend")).toBeInTheDocument();
    expect(screen.getByText("Leaderboards")).toBeInTheDocument();
    expect(screen.getByText("Scans strip")).toBeInTheDocument();
  });

  test("no summed/blended capability-class series anywhere on the mounted page (D-OB14)", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();
    await waitFor(() => expect(screen.getByText("Tokens by capability class")).toBeInTheDocument());
    // Fixture uses a single "exact" class per direction — assert the label renders and no
    // "total"/"blended" wording is ever introduced by the panel.
    expect(screen.queryByText(/\bblended\b/i)).not.toBeInTheDocument();
  });
});

describe("TestingTab — the prompt-cache panel (RM-33 WP 3.3)", () => {
  test("the three cache measures are genuinely REQUESTED, and in their own call (not folded into the tokens one)", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();

    await waitFor(() => expect(screen.getByText("Prompt cache")).toBeInTheDocument());
    const measureSets = getRunMetricsMock.mock.calls.map((call) => (call[0].measures as string[]).slice().sort().join(","));
    expect(measureSets).toContain("cacheHitRate,cacheReadTokens,cacheWriteTokens");
    // A `rate` measure must never share a series bag with `tokens` measures (the same-unit rule).
    expect(measureSets).toContain("tokensIn,tokensOut");
    expect(measureSets.some((m) => m.includes("cacheHitRate") && m.includes("tokensIn"))).toBe(false);
  });

  test("a window whose runs all predate cache measurement shows 'not measured' — never a 0% line", async () => {
    installCatalog();
    installNonEmptyMetrics();
    installUnmeasuredCache();
    renderTab();

    // The rest of the tab still has data — this is the exact case where an empty chart would read
    // as "no runs" and a 0% line would read as "caching broke".
    await waitFor(() => expect(screen.getByText("Prompt cache")).toBeInTheDocument());
    expect(screen.getByText("Cache split not measured")).toBeInTheDocument();
    expect(screen.getByText("Tokens by capability class")).toBeInTheDocument();
    expect(screen.queryByText("No runs in this window")).not.toBeInTheDocument();
  });
});

describe("TestingTab — URL → state → fetch round trip (acceptance #2)", () => {
  test("a non-default groupBy + provider filter already in the URL is applied to the actual fetch", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab(["/dashboard?tab=testing&tGroupBy=server&tProvider=anthropic"]);

    await waitFor(() => expect(getRunMetricsMock.mock.calls.length).toBeGreaterThan(0));
    const runsOverTimeCall = getRunMetricsMock.mock.calls.find(
      (call) => call[0].groupBy === "server" && call[0].bucket !== "week",
    );
    expect(runsOverTimeCall).toBeDefined();
    expect(runsOverTimeCall?.[0].filter.providerKind).toEqual(["anthropic"]);
  });
});

describe("TestingTab — the shared page range (dashboard-bento WP 2.2, Defect 2)", () => {
  test("the page range is the window the metrics are actually fetched for", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();

    await waitFor(() => expect(getRunMetricsMock.mock.calls.length).toBeGreaterThan(0));
    const [firstCall] = getRunMetricsMock.mock.calls;
    expect(firstCall?.[0].from).toBe(RANGE.from);
    expect(firstCall?.[0].to).toBe(RANGE.to);
  });

  test("a trailing-24h page range buckets HOURLY — the instants reach the bucket choice too", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab(["/dashboard?tab=testing"], resolveDashboardRange({ kind: "preset", preset: "24h" }));

    await waitFor(() => expect(getRunMetricsMock.mock.calls.length).toBeGreaterThan(0));
    // A day-granular projection of "the last 24 hours" spans two calendar days and would bucket
    // daily; the shared range hands over exact instants, so the granularity stays honest.
    expect(getRunMetricsMock.mock.calls.some((call) => call[0].bucket === "hour")).toBe(true);
  });

  test("a drill-down href carries the page range's own window, not a re-derived one", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();
    await waitFor(() => expect(screen.getByText("Guardrail stops by reason")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /open runs for max turns/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs?filter="));
    const encoded = (screen.getByTestId("location").textContent ?? "").split("filter=")[1] as string;
    const filter = parseRunFilter(decodeURIComponent(encoded));
    expect(filter.dateFrom).toBe(RANGE.from);
    expect(filter.dateTo).toBe(RANGE.to);
  });

  test("the tab renders NO date control of its own any more", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();
    await waitFor(() => expect(screen.getByText("Runs & error rate over time")).toBeInTheDocument());
    // `DateRangePicker`'s trigger is the only `aria-haspopup="dialog"` control this tab rendered.
    expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull();
  });
});

describe("TestingTab — drill-down wiring (end-to-end navigate)", () => {
  test("clicking a guardrail reason's drill row navigates to the runs feed with the exact stopReasonCode filter", async () => {
    installCatalog();
    installNonEmptyMetrics();
    renderTab();
    await waitFor(() => expect(screen.getByText("Guardrail stops by reason")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /open runs for max turns/i }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs?filter="));
    const location = screen.getByTestId("location").textContent ?? "";
    const encoded = location.split("filter=")[1] as string;
    const filter = parseRunFilter(decodeURIComponent(encoded));
    expect(filter.stopReasonCode).toEqual(["max_turns"]);
  });
});
