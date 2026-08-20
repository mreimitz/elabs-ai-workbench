import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type {
  AdvisorReport,
  RatingIssue,
  RunMetricsResponse,
  ScanMetricsResponse,
  ScanSummary,
  ServerConfig,
} from "@mcp-token-footprint/shared";

/**
 * dashboard-bento WP 1.4 + WP 2.2 — `OverviewTab`, the bento shell.
 *
 * The shell owns two things, and each is locked here: the GRID (the library's `BentoGrid`, with the
 * wireframe's tile order, the four merged scan tiles from WP 2.1, and — since WP 2.2 — NO spotlight
 * overlay) and the whole-tab STATES (first-paint skeleton · first-run CTA · quiet-window notice ·
 * the bento). The tiles themselves are covered by their own suites — what is asserted about them
 * here is only that they are composed, in order, into the one grid.
 *
 * The WINDOW control is deliberately NOT tested here any more: WP 2.2 hoisted it to the page-level
 * toolbar (`DashboardView` → `DashboardRangeControl`), where `DashboardView.test.tsx` covers it, and
 * this tab simply receives a resolved range as a prop.
 *
 * `@elabs-ai/components-charts` is stubbed as pass-throughs: importing that barrel under jsdom
 * resolves a broken deep `@visx/gradient` subpath (see `ScansTab.test.tsx`'s longer note). This WP
 * touches no chart prop — the tiles that do carry their own FAITHFUL stubs (conventions.md) — so a
 * thin pass-through is the right instrument here, and it is deliberately faithful enough to render
 * each tile's identifying text.
 */
vi.mock("@elabs-ai/components-charts", () => ({
  LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Grid: () => null,
  XAxis: () => null,
  ChartTooltip: () => null,
  Sparkline: () => null,
  RingChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Ring: () => null,
  ChartCard: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}));

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

const { OverviewTab } = await import("./OverviewTab");
const { resolveDashboardRange } = await import("../dashboard-range");

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────
// Bucket starts are pinned RELATIVE to the clock, because the tab resolves its own window from
// `new Date()` — a hard-coded date would drift out of the trailing 7-day window and quietly change
// what these tests assert.
const DAY = 86_400_000;
const bucketsAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// Two servers, one of them never scanned — so the attention queue has something to say. That tile
// is the one tile that self-hides on a CLEAN fleet, so a spotless fixture would render seven tiles
// and quietly weaken the ordering assertion.
const SERVERS: ServerConfig[] = [
  { id: "s1", name: "Files" } as ServerConfig,
  { id: "s2", name: "Unscanned" } as ServerConfig,
];
// Complete enough for the four WP 2.1 scan tiles, which read `scans` directly rather than a
// windowed contract section: without a `largestToolName` the largest-tool tile self-hides and the
// ordering assertion below would silently cover eleven tiles instead of twelve.
const SCANS: ScanSummary[] = [
  {
    id: "scan-1",
    serverId: "s1",
    serverName: "Files",
    status: "success",
    scannedAt: bucketsAgo(1),
    totalTools: 11,
    totalTokens: 1250,
    totalResources: 1,
    totalResourceTemplates: 0,
    totalPrompts: 1,
    totalResourceTokens: 180,
    totalPromptTokens: 70,
    largestToolName: "search",
    largestToolTokens: 400,
  } as ScanSummary,
];
/** A fleet with nothing wrong with it: every server has a successful latest scan, no issues. */
const CLEAN_SERVERS: ServerConfig[] = [SERVERS[0] as ServerConfig];

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
          bucketStart: bucketsAgo(3),
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
        {
          bucketStart: bucketsAgo(1),
          scanCount: 1,
          failureRate: 0,
          countingVersion: 2,
          totalTokens: 1500,
          toolTokens: 1250,
          resourceTokens: 180,
          promptTokens: 70,
          totalTools: 11,
          totalResources: 1,
          totalResourceTemplates: 0,
          totalPrompts: 1,
          deltaTotalTokens: 300,
          deltaComparable: true,
        },
      ],
    },
  ],
};

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
      points: [{ bucketStart: bucketsAgo(1), value: 5, n: 5 }],
    },
    {
      measure: "errorRate",
      group: null,
      capabilityClass: null,
      points: [{ bucketStart: bucketsAgo(1), value: 0.2, n: 5 }],
    },
    {
      measure: "costUsd",
      group: null,
      capabilityClass: "api_exact",
      points: [{ bucketStart: bucketsAgo(1), value: 1.25, n: 5 }],
    },
  ],
};

const ADVISOR = {
  advisorVersion: 1,
  generatedAt: bucketsAgo(0),
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

const EMPTY_SCAN_METRICS: ScanMetricsResponse = { ...SCAN_METRICS, servers: [] };
const EMPTY_RUN_METRICS: RunMetricsResponse = { ...RUN_METRICS, series: [] };
const EMPTY_ADVISOR = { ...ADVISOR, recommendations: [] } as AdvisorReport;
const NO_ISSUES: RatingIssue[] = [];

function resolveAllHappily() {
  getScanMetrics.mockResolvedValue(SCAN_METRICS);
  getRunMetrics.mockResolvedValue(RUN_METRICS);
  getAdvisorReport.mockResolvedValue(ADVISOR);
  listIssues.mockResolvedValue(NO_ISSUES);
  listServers.mockResolvedValue(SERVERS);
  listScans.mockResolvedValue(SCANS);
}

/** Every source settles with nothing in it — the "nothing to show" join. */
function resolveAllEmpty() {
  getScanMetrics.mockResolvedValue(EMPTY_SCAN_METRICS);
  getRunMetrics.mockResolvedValue(EMPTY_RUN_METRICS);
  getAdvisorReport.mockResolvedValue(EMPTY_ADVISOR);
  listIssues.mockResolvedValue(NO_ISSUES);
  listServers.mockResolvedValue([]);
  listScans.mockResolvedValue([]);
}

/** A promise that never settles — every section stays `loading` (the first-paint join). */
function neverResolve() {
  const pending = new Promise(() => {});
  getScanMetrics.mockReturnValue(pending);
  getRunMetrics.mockReturnValue(pending);
  getAdvisorReport.mockReturnValue(pending);
  listIssues.mockReturnValue(pending);
  listServers.mockReturnValue(pending);
  listScans.mockReturnValue(pending);
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

/** The page range the Dashboard host supplies (WP 2.2). Pinned so nothing here drifts with the
 *  clock; the fixtures' bucket starts are relative to `Date.now()`, which this window covers. */
const RANGE = resolveDashboardRange({ kind: "preset", preset: "7d" });

function renderTab({
  servers = SERVERS,
  scans = SCANS,
  range = RANGE,
  initialEntries = ["/dashboard"],
}: {
  servers?: ServerConfig[];
  scans?: ScanSummary[];
  range?: typeof RANGE;
  initialEntries?: string[];
} = {}) {
  const onOpenServer = vi.fn();
  const onOpenScan = vi.fn();
  const onRunScan = vi.fn();
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <OverviewTab
                  range={range}
                  servers={servers}
                  scans={scans}
                  onOpenServer={onOpenServer}
                  onOpenScan={onOpenScan}
                  onRunScan={onRunScan}
                />
              </>
            }
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onOpenServer, onOpenScan, onRunScan };
}

const grid = () => document.querySelector('[data-slot="bento-grid"]');
const tiles = () => [...document.querySelectorAll('[data-slot="bento-grid-item"]')];

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

// ── The grid ─────────────────────────────────────────────────────────────────────────────────────

describe("OverviewTab — the bento", () => {
  test("composes the twelve tiles into ONE library BentoGrid, in the wireframe's order", async () => {
    resolveAllHappily();
    renderTab();

    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    // One grid, and it is the library's — not a hand-rolled one (`library-first.md`).
    expect(document.querySelectorAll('[data-slot="bento-grid"]')).toHaveLength(1);

    // Order is the layout: `grid-auto-flow: dense` + each tile's own size resolves the wireframe
    // from this sequence alone, so the sequence is the thing worth locking. The last four names are
    // WP 2.1's merged Scans tiles (WP 2.2, Defect 3).
    const expected = [
      "Fleet footprint",
      "Needs you",
      "Startup tokens",
      "Pass rate",
      "Spend",
      "Surface mix",
      "Largest single tool",
      "Fleet inventory",
      "Biggest movers",
      "Top recommendation",
      "Latest server footprint",
      "Recent scan activity",
    ];
    const rendered = tiles();
    expect(rendered).toHaveLength(expected.length);
    expected.forEach((label, index) => {
      expect(within(rendered[index] as HTMLElement).getByText(label)).toBeInTheDocument();
    });
  });

  test("the two tables are LAST and span the full four columns (owner: 'at the bottom end … full width')", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    const rendered = tiles();
    const footprintTable = rendered[rendered.length - 2] as HTMLElement;
    const recentScans = rendered[rendered.length - 1] as HTMLElement;
    expect(within(footprintTable).getByText("Latest server footprint")).toBeInTheDocument();
    expect(within(recentScans).getByText("Recent scan activity")).toBeInTheDocument();
    // `BentoGridItem` writes the span as an inline `gridColumn`; CSS grid itself clamps a span
    // wider than the track count, which is what keeps this readable at 375 px with no media query.
    for (const tile of [footprintTable, recentScans]) {
      expect(tile.getAttribute("style")).toContain("grid-column: span 4 / span 4");
    }
  });

  test("NO cursor spotlight renders — the owner's 'yellow shade' is gone", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    // The overlay only exists when `spotlight` is enabled (per tile, or inherited from the grid), so
    // its ABSENCE is the assertion that the grid turned it off. Its gradient is
    // `color-mix(in oklch, var(--primary) 12%, transparent)` — the brand lime, i.e. the shade.
    expect(screen.queryAllByTestId("bento-spotlight")).toHaveLength(0);
  });

  test("hover ELEVATION is retained — only the coloured overlay went (owner: 'elevation is good')", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    // `hover:shadow-xl` is upstream's own elevation gesture on every tile; it is independent of
    // `spotlight`, and removing the spotlight must not have removed it.
    for (const tile of tiles()) {
      expect(tile.className).toContain("hover:shadow-xl");
    }
  });

  test("a tile whose section FAILED still renders — a failure is never laundered into empty", async () => {
    resolveAllHappily();
    getAdvisorReport.mockRejectedValue(new Error("advisor exploded"));
    renderTab();

    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());
    expect(screen.getByText("Couldn’t load advisor recommendations")).toBeInTheDocument();
  });
});

// ── First run / a quiet window ───────────────────────────────────────────────────────────────────

describe("OverviewTab — nothing to show", () => {
  test("first run (no servers, no scans) renders ONE CTA, not a grid of empty boxes", async () => {
    resolveAllEmpty();
    renderTab({ servers: [], scans: [] });

    await waitFor(() => expect(screen.getByText("Nothing measured yet")).toBeInTheDocument());

    // The hard requirement: no bento, no tiles — one panel with one action.
    expect(grid()).toBeNull();
    expect(tiles()).toHaveLength(0);
    expect(screen.queryByText("Fleet footprint")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs you")).not.toBeInTheDocument();

    const cta = screen.getByRole("link", { name: "Add your first MCP server" });
    expect(cta).toHaveAttribute("href", "/servers");
  });

  test("a fleet with a QUIET window keeps its bento and says so — it does not hide the scan tiles", async () => {
    // Every windowed metrics source is empty, but the fleet has been scanned before. WP 2.2: the
    // four scan tiles are window-INDEPENDENT, so removing the whole grid (what WP 1.4 did here)
    // would hide the fleet's measured footprint behind a panel claiming there is nothing to see.
    resolveAllEmpty();
    renderTab({ servers: CLEAN_SERVERS, scans: SCANS });

    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    expect(screen.queryByText("Nothing measured yet")).not.toBeInTheDocument();
    expect(grid()).not.toBeNull();
    expect(screen.getByText("Latest server footprint")).toBeInTheDocument();
    expect(screen.getByText("Recent scan activity")).toBeInTheDocument();
  });

  test("the quiet-window notice names the window the page toolbar is showing", async () => {
    resolveAllEmpty();
    renderTab({
      servers: CLEAN_SERVERS,
      scans: SCANS,
      range: resolveDashboardRange({ kind: "preset", preset: "24h" }),
    });
    await waitFor(() =>
      expect(screen.getByText(/No scans, runs or open issues landed in the last 24 hours/)).toBeInTheDocument(),
    );
  });
});

// ── Loading ──────────────────────────────────────────────────────────────────────────────────────

describe("OverviewTab — first paint", () => {
  test("renders a layout-shaped skeleton with the real bento geometry, not a spinner", () => {
    neverResolve();
    renderTab();

    // Same grid component, same twelve cells: the arriving tiles land where the placeholders were.
    expect(grid()).not.toBeNull();
    expect(tiles()).toHaveLength(12);
    expect(screen.getAllByTestId("overview-skeleton-cell")).toHaveLength(12);
    // The placeholder is decorative; the one live line is what a screen reader hears.
    expect(grid()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Loading the fleet overview…")).toBeInTheDocument();
    // No tile content yet, and no spinner standing in for the grid.
    expect(screen.queryByText("Fleet footprint")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument();
  });

  test("the real bento takes over as soon as the sections settle", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());
    expect(screen.queryByText("Loading the fleet overview…")).not.toBeInTheDocument();
  });
});

// ── The shared page range ────────────────────────────────────────────────────────────────────────

describe("OverviewTab — the shared page range reaches the data layer", () => {
  test("the tab renders NO window control of its own any more (it lives in the page toolbar)", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());
    expect(screen.queryByRole("radiogroup", { name: "Overview window" })).toBeNull();
  });

  test("a 24h range buckets hourly — proof the prop reaches the fetch, not just the UI", async () => {
    resolveAllHappily();
    renderTab({ range: resolveDashboardRange({ kind: "preset", preset: "24h" }) });
    await waitFor(() => expect(getScanMetrics.mock.calls.length).toBeGreaterThan(0));
    const [firstCall] = getScanMetrics.mock.calls;
    expect((firstCall?.[0] as { bucket: string }).bucket).toBe("hour");
  });

  test("a 30d range buckets daily and queries exactly that window", async () => {
    resolveAllHappily();
    const range = resolveDashboardRange({ kind: "preset", preset: "30d" });
    renderTab({ range });
    await waitFor(() => expect(getScanMetrics.mock.calls.length).toBeGreaterThan(0));
    const [firstCall] = getScanMetrics.mock.calls;
    const query = firstCall?.[0] as { bucket: string; from?: string; to?: string };
    expect(query.bucket).toBe("day");
    expect(query.from).toBe(range.from);
    expect(query.to).toBe(range.to);
  });
});
