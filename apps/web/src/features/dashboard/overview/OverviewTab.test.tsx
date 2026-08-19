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
 * dashboard-bento WP 1.4 — `OverviewTab`, the bento shell.
 *
 * The shell owns three things, and each is locked here: the GRID (it is the library's `BentoGrid`
 * with the wireframe's tile order and the spotlight on), the WINDOW control (URL-persisted, default
 * absent from the URL), and the whole-tab STATES (first-paint skeleton · nothing-to-show CTA ·
 * the bento). The tiles themselves are covered by their own suites — what is asserted about them
 * here is only that they are composed, in order, into the one grid.
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
const SCANS: ScanSummary[] = [
  { id: "scan-1", serverId: "s1", status: "success", scannedAt: bucketsAgo(1) } as ScanSummary,
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

function renderTab({
  servers = SERVERS,
  scans = SCANS,
  initialEntries = ["/dashboard"],
}: { servers?: ServerConfig[]; scans?: ScanSummary[]; initialEntries?: string[] } = {}) {
  const onOpenServer = vi.fn();
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
                  servers={servers}
                  scans={scans}
                  onOpenServer={onOpenServer}
                  onRunScan={onRunScan}
                />
              </>
            }
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onOpenServer, onRunScan };
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
  test("composes the eight tiles into ONE library BentoGrid, in the wireframe's order", async () => {
    resolveAllHappily();
    renderTab();

    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    // One grid, and it is the library's — not a hand-rolled one (`library-first.md`).
    expect(document.querySelectorAll('[data-slot="bento-grid"]')).toHaveLength(1);

    // Order is the layout: `grid-auto-flow: dense` + each tile's own size resolves the wireframe
    // from this sequence alone, so the sequence is the thing worth locking.
    const expected = [
      "Fleet footprint",
      "Needs you",
      "Startup tokens",
      "Pass rate",
      "Spend",
      "Surface mix",
      "Biggest movers",
      "Top recommendation",
    ];
    const rendered = tiles();
    expect(rendered).toHaveLength(expected.length);
    expected.forEach((label, index) => {
      expect(within(rendered[index] as HTMLElement).getByText(label)).toBeInTheDocument();
    });
  });

  test("the spotlight is ON and carries upstream's reduced-motion suppression", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    // The overlay only exists when `spotlight` is enabled (per-tile, or inherited from the grid as
    // it is here), so its presence on every tile IS the assertion that the grid turned it on.
    const overlays = screen.getAllByTestId("bento-spotlight");
    expect(overlays).toHaveLength(tiles().length);
    // Upstream — not this app — gates the motion; assert the gate is the one that shipped.
    for (const overlay of overlays) {
      expect(overlay).toHaveClass("motion-reduce:hidden");
      expect(overlay).toHaveAttribute("aria-hidden", "true");
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

// ── First run / nothing to show ──────────────────────────────────────────────────────────────────

describe("OverviewTab — nothing to show", () => {
  test("first run (no servers) renders ONE CTA, not a grid of empty boxes", async () => {
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

  test("servers exist but the window is empty → the honest 'widen it' state, not the first-run CTA", async () => {
    resolveAllEmpty();
    renderTab({ servers: CLEAN_SERVERS, scans: SCANS });

    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    expect(screen.queryByText("Nothing measured yet")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add your first MCP server" }),
    ).not.toBeInTheDocument();
    expect(grid()).toBeNull();
  });

  test("the window control stays mounted while there is nothing to show", async () => {
    resolveAllEmpty();
    renderTab({ servers: [], scans: [] });
    await waitFor(() => expect(screen.getByText("Nothing measured yet")).toBeInTheDocument());
    expect(screen.getByRole("radiogroup", { name: "Overview window" })).toBeInTheDocument();
  });
});

// ── Loading ──────────────────────────────────────────────────────────────────────────────────────

describe("OverviewTab — first paint", () => {
  test("renders a layout-shaped skeleton with the real bento geometry, not a spinner", () => {
    neverResolve();
    renderTab();

    // Same grid component, same eight cells: the arriving tiles land where the placeholders were.
    expect(grid()).not.toBeNull();
    expect(tiles()).toHaveLength(8);
    expect(screen.getAllByTestId("overview-skeleton-cell")).toHaveLength(8);
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

// ── The window control ───────────────────────────────────────────────────────────────────────────

describe("OverviewTab — the window control", () => {
  test("defaults to 7d and keeps the default OUT of the URL", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    expect(screen.getByRole("radio", { name: "7d" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
    expect(screen.getByTestId("location")).not.toHaveTextContent("oRange");
  });

  test("picking a window writes ?oRange=, and returning to the default clears it", async () => {
    resolveAllHappily();
    renderTab();
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "30d" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/dashboard?oRange=30d"),
    );
    expect(screen.getByRole("radio", { name: "30d" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "7d" }));
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("oRange"));
  });

  test("`?oRange=24h` deep-links into that window and re-queries the metrics for it", async () => {
    resolveAllHappily();
    renderTab({ initialEntries: ["/dashboard?oRange=24h"] });
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());

    expect(screen.getByRole("radio", { name: "24h" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Showing the last 24 hours")).toBeInTheDocument();
    // A 24-hour window buckets hourly — proof the control reaches the data layer, not just the UI.
    const [firstCall] = getScanMetrics.mock.calls;
    expect((firstCall?.[0] as { bucket: string }).bucket).toBe("hour");
  });

  test("an unrecognised ?oRange= falls back to the default rather than breaking the tab", async () => {
    resolveAllHappily();
    renderTab({ initialEntries: ["/dashboard?oRange=90d"] });
    await waitFor(() => expect(screen.getByText("Fleet footprint")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "7d" })).toHaveAttribute("aria-checked", "true");
  });
});
