import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";

// jsdom omits matchMedia — the page toolbar's `DateRangePicker` opens a Radix Popover, which reads
// it (mirrors `FilterControls.test.tsx`/`IssuesFleetTab.test.tsx`'s identical polyfill).
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

// Importing ANY named export from the `@elabs-ai/components-charts` barrel under Vitest/jsdom
// resolves a broken deep `@visx/gradient` subpath used by its (unrelated, unused here) Gantt chart —
// a pre-existing environment-only issue confirmed for every export, not just `MetricGrid`
// (`RunConsole.test.tsx`/`TestingTab.test.tsx` mock around the same class of issue). A thin
// pass-through per export mounts every real tab body.
vi.mock("@elabs-ai/components-charts", () => ({
  MetricGrid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MetricCard: ({ label, value }: { label: string; value: string }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  SeriesBar: () => null,
  Line: () => null,
  Grid: () => null,
  BarXAxis: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ChartTooltip: () => null,
  Sparkline: () => null,
  // dashboard-bento WP 1.4 — the Overview tab (the DEFAULT tab) mounts on every render of this
  // suite, so its tiles' chart imports have to resolve here too.
  RingChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Ring: () => null,
  ChartCard: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}));

// The Testing tab (WP 2.2) fetches its catalog + metrics on mount, and the Issues tab (WP 5.3) fetches
// the fleet-issues list at the DashboardView level UNCONDITIONALLY (so the tab strip can badge the
// count before the tab is ever opened) — mock `lib/api` so every call resolves deterministically
// instead of hitting `fetch` against nothing in jsdom. This test suite is about the TAB SHELL
// mechanics (default tab, deep link, URL sync, keyboard nav), not any one tab's own data/rendering
// (covered by `TestingTab.test.tsx` / `IssuesFleetTab.test.tsx`), so every call resolves to an
// empty-but-valid payload — each tab settles into its own honest empty state, which is enough to
// prove real content (not a placeholder shell) mounted.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  const emptyRunMetrics = {
    bucket: "day" as const,
    timezone: "UTC" as const,
    from: null,
    to: null,
    groupBy: null,
    measures: [],
    unavailableMeasures: [],
    series: [],
  };
  return {
    ...actual,
    getRunMetrics: () => Promise.resolve(emptyRunMetrics),
    getScanMetrics: () =>
      Promise.resolve({ bucket: "day" as const, timezone: "UTC" as const, from: null, to: null, servers: [] }),
    getMostExpensiveRuns: () => Promise.resolve([]),
    listServers: () => Promise.resolve([]),
    listScenarios: () => Promise.resolve([]),
    listSuites: () => Promise.resolve([]),
    listTests: () => Promise.resolve([]),
    listSkills: () => Promise.resolve([]),
    listIssues: () => Promise.resolve([]),
    // dashboard-bento WP 1.4 — the default Overview tab's advisor teaser. An empty report settles
    // that section into its own honest `empty`, like every other source mocked here.
    getAdvisorReport: () =>
      Promise.resolve({
        advisorVersion: 1,
        generatedAt: "2026-01-02T00:00:00Z",
        scope: { kind: "fleet" as const },
        insufficientData: [],
        recommendations: [],
      }),
  };
});

import { DashboardView } from "./DashboardView";

// The Dashboard is the tab HOST (Overview | Testing | Issues) and — since dashboard-bento WP 2.2 —
// the owner of the page's ONE toolbar row. These lock both contracts: the tab shell (default tab,
// `?tab=` deep links, the retired `?tab=scans` redirect, URL updates on switch, Radix's keyboard
// roving focus) and the shared range (one toolbar ABOVE the tab strip, one `?range=` param, presets
// stay relative, custom ranges stay pinned, legacy `?oRange=`/`?tFrom=`+`?tTo=` links still resolve).

const SERVER: ServerConfig = {
  id: "srv-a",
  name: "Alpha",
  transport: "streamable_http",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hasEnvSecrets: false,
  hasHeaderSecrets: false,
  authType: "none",
};

const SCAN: ScanSummary = {
  id: "scan-1",
  serverId: "srv-a",
  serverName: "Alpha",
  tokenProfile: "generic_o200k",
  scannedAt: "2026-01-02T00:00:00Z",
  status: "success",
  totalTools: 3,
  totalTokens: 1000,
  totalRawBytes: 4000,
  averageTokensPerTool: 333,
  largestToolTokens: 500,
  totalResources: 0,
  totalResourceTemplates: 0,
  totalPrompts: 0,
  totalResourceTokens: 0,
  totalPromptTokens: 0,
  largestResourceTokens: 0,
  largestPromptTokens: 0,
  countingVersion: 2,
};

/** Reflects the current URL so tab-driven navigation is observable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderDashboard(
  overrides: Partial<Parameters<typeof DashboardView>[0]> = {},
  { initialEntries = ["/dashboard"] }: { initialEntries?: string[] } = {},
) {
  const onOpenScan = vi.fn();
  const onOpenServer = vi.fn();
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <DashboardView
                  servers={[SERVER]}
                  scans={[SCAN]}
                  onOpenScan={onOpenScan}
                  onOpenServer={onOpenServer}
                  {...overrides}
                />
              </>
            }
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onOpenScan, onOpenServer };
}

// Radix tabs activate on mouseDown (primary button), not a synthetic `click` — mirrors TabPanel.test.tsx.
function activateTab(name: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

/** The page toolbar's range control (WP 2.2) — named by the group it renders into. */
function rangeControl() {
  return screen.getByRole("group", { name: "Dashboard date range" });
}

/** Open the range picker's popover and click one of its preset rows. */
function pickPreset(label: string) {
  fireEvent.click(within(rangeControl()).getByRole("button"));
  fireEvent.click(screen.getByRole("button", { name: label }));
}

const location = () => screen.getByTestId("location");

beforeEach(() => {
  window.localStorage.clear();
});

describe("DashboardView — loading gate", () => {
  test("initialLoading renders a loading panel, no tab strip", async () => {
    renderDashboard({ initialLoading: true });
    expect(screen.getByText("Loading dashboard…")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    // The page-level fleet-issues fetch fires regardless of the gate (it badges the strip); let it
    // settle inside `act()` so its state update doesn't escape the test.
    await waitFor(() => expect(screen.getByText("Loading dashboard…")).toBeInTheDocument());
  });
});

// ── Defect 1: ONE toolbar, ABOVE the tab strip ───────────────────────────────────────────────────

describe("DashboardView — the page toolbar (WP 2.2, Defect 1)", () => {
  test("renders exactly ONE range control, and it sits ABOVE the tab strip", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());

    expect(screen.getAllByRole("group", { name: "Dashboard date range" })).toHaveLength(1);

    // The written layout order is breadcrumb → ONE toolbar row → content
    // (`roadmap/ux-overhaul/toolbar-standard-2026-07-11.md`); the Dashboard used to invert it.
    const strip = screen.getByRole("tablist");
    const order = rangeControl().compareDocumentPosition(strip);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("the toolbar is OUTSIDE the tab panel — it survives every tab switch, unchanged", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    const control = rangeControl();

    activateTab("Testing");
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
    expect(rangeControl()).toBe(control);

    activateTab("Issues");
    await waitFor(() => expect(screen.getByText("No fleet issues recorded")).toBeInTheDocument());
    expect(rangeControl()).toBe(control);
  });

  test("the toolbar states what the window currently means, in words", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/Showing the last 7 days/)).toBeInTheDocument());
  });
});

// ── Defect 3: three tabs, and `?tab=scans` does not dead-end ─────────────────────────────────────

describe("DashboardView — default tab + deep link", () => {
  test("the strip is Overview · Testing · Issues — the Scans tab is retired", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Testing",
      "Issues",
    ]);
  });

  test("defaults to the Overview tab with a clean URL (no ?tab= for the default)", async () => {
    renderDashboard();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("data-state", "active");
    // The real Overview tab: every mocked source settles empty, so the bento renders its honest
    // quiet-window notice — proof the real tab mounted, not a placeholder.
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    expect(location()).toHaveTextContent("/dashboard");
    expect(location()).not.toHaveTextContent("?tab=");
  });

  test("`?tab=scans` redirects to Overview and drops the retired param — never a dead end", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=scans"] });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    await waitFor(() => expect(location()).not.toHaveTextContent("tab=scans"));
    expect(screen.queryByRole("tab", { name: "Scans" })).not.toBeInTheDocument();
  });

  test("`?tab=scans` keeps every unrelated param while it redirects", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=scans&range=30d"] });
    await waitFor(() => expect(location()).not.toHaveTextContent("tab=scans"));
    expect(location()).toHaveTextContent("range=30d");
  });

  test("`?tab=testing` deep-links directly into the Testing tab on mount", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=testing"] });
    expect(screen.getByRole("tab", { name: "Testing" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });

  test("an unrecognized ?tab= value falls back to the default (Overview)", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=bogus"] });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
  });

  test("a prototype key as ?tab= is 'unrecognized', not a function off Object.prototype", async () => {
    // The retired-tab lookup is a `Map`, not an object literal — `{scans:"overview"}["toString"]`
    // resolves off the prototype chain and would hand `TabPanel` a function as its active value.
    renderDashboard({}, { initialEntries: ["/dashboard?tab=toString"] });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    // It is not a RETIRED tab either, so the (unknown) param is left alone rather than rewritten.
    expect(location()).toHaveTextContent("tab=toString");
  });
});

describe("DashboardView — tab switch updates the URL (restore-on-reload)", () => {
  test("every non-default tab writes its ?tab=; returning to Overview removes it", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());

    activateTab("Testing");
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
    expect(location()).toHaveTextContent("/dashboard?tab=testing");

    activateTab("Issues");
    await waitFor(() => expect(screen.getByText("No fleet issues recorded")).toBeInTheDocument());
    expect(location()).toHaveTextContent("/dashboard?tab=issues");

    activateTab("Overview");
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    expect(location()).toHaveTextContent("/dashboard");
    expect(location()).not.toHaveTextContent("?tab=");
  });

  test("the Testing tab body unmounts the Overview tab body and vice versa (Radix single active panel)", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    activateTab("Testing");
    expect(screen.queryByText("Latest server footprint")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });
});

describe("DashboardView — keyboard tab-strip behavior", () => {
  test("ArrowRight moves roving focus to the next tab and activates it (Radix automatic mode)", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const testingTab = screen.getByRole("tab", { name: "Testing" });
    overviewTab.focus();
    expect(document.activeElement).toBe(overviewTab);
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });
    // Radix's roving-focus-group moves focus, then activates the panel on a LATER tick (focus and
    // selection land in separate updates past the synchronous keydown handler) — wait for both.
    await waitFor(() => expect(document.activeElement).toBe(testingTab));
    await waitFor(() => expect(testingTab).toHaveAttribute("data-state", "active"));
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });
});

// ── Defect 2: one shared range, one URL param ────────────────────────────────────────────────────

describe("DashboardView — the shared range (WP 2.2, Defect 2)", () => {
  test("the default window is kept OUT of the URL", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    expect(location()).not.toHaveTextContent("range=");
  });

  test("picking a preset writes ONE param carrying the preset TOKEN — never two frozen instants", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());

    pickPreset("Last 30 days");
    await waitFor(() => expect(location()).toHaveTextContent("range=30d"));
    // The whole point of storing the token: a shared link keeps meaning "the last 30 days".
    expect(location()).not.toHaveTextContent("T00%3A00");
    expect(location()).not.toHaveTextContent("oRange");
    expect(location()).not.toHaveTextContent("tFrom");
    await waitFor(() => expect(screen.getByText(/Showing the last 30 days/)).toBeInTheDocument());
  });

  test("returning to the default preset clears the param again", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?range=24h"] });
    await waitFor(() => expect(screen.getByText(/Showing the last 24 hours/)).toBeInTheDocument());
    pickPreset("Last 7 days");
    await waitFor(() => expect(location()).not.toHaveTextContent("range="));
  });

  test("the range param survives a tab switch, and the tab param survives a range change", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?range=30d"] });
    await waitFor(() => expect(screen.getByText(/Showing the last 30 days/)).toBeInTheDocument());

    activateTab("Testing");
    await waitFor(() => expect(location()).toHaveTextContent("tab=testing"));
    expect(location()).toHaveTextContent("range=30d");

    pickPreset("Last 24 hours");
    await waitFor(() => expect(location()).toHaveTextContent("range=24h"));
    expect(location()).toHaveTextContent("tab=testing");
  });

  test("a PINNED custom range deep-links and describes itself by its two dates", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?range=2026-07-01..2026-07-10"] });
    await waitFor(() =>
      expect(screen.getByText(/Showing Jul 1, 2026 . Jul 10, 2026/)).toBeInTheDocument(),
    );
  });
});

describe("DashboardView — legacy range deep links still resolve (WP 2.2)", () => {
  test("the Overview's old `?oRange=` preset resolves as that preset", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?oRange=24h"] });
    await waitFor(() => expect(screen.getByText(/Showing the last 24 hours/)).toBeInTheDocument());
  });

  test("the Testing tab's old `?tFrom=`/`?tTo=` pair resolves as a pinned custom range", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=testing&tFrom=2026-07-01&tTo=2026-07-10"] });
    expect(screen.getByRole("tab", { name: "Testing" })).toHaveAttribute("data-state", "active");
    await waitFor(() =>
      expect(screen.getByText(/Showing Jul 1, 2026 . Jul 10, 2026/)).toBeInTheDocument(),
    );
  });

  test("touching the control converges the URL on the single `?range=` key", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=testing&tFrom=2026-07-01&tTo=2026-07-10"] });
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
    pickPreset("Last 30 days");
    await waitFor(() => expect(location()).toHaveTextContent("range=30d"));
    expect(location()).not.toHaveTextContent("tFrom");
    expect(location()).not.toHaveTextContent("tTo");
    expect(location()).toHaveTextContent("tab=testing");
  });
});

describe("DashboardView — Issues tab (WP 5.3 mount)", () => {
  test("`?tab=issues` deep-links into the Issues tab and renders its real (empty) content", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=issues"] });
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("data-state", "active");
    // `listIssues` resolves `[]` — the tab settles into its own honest empty state, proving the real
    // `IssuesFleetTab` (not a placeholder) mounted.
    await waitFor(() => expect(screen.getByText("No fleet issues recorded")).toBeInTheDocument());
  });

  test("the Issues tab strip carries no count badge when there are no open/regressed issues", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Issues" })).toBeInTheDocument());
    // No numeral appended to the label (mirrors ServersView: a clean fleet carries no badge number).
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveTextContent(/^Issues$/);
  });
});

describe("DashboardView — sr-only heading is shared across tabs", () => {
  test("the Dashboard H1 renders once and stays mounted across a tab switch", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nothing in this window")).toBeInTheDocument());
    const heading = screen.getByRole("heading", { level: 1, name: "Dashboard" });
    expect(heading).toBeInTheDocument();
    activateTab("Testing");
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBe(heading);
    // Let the Testing tab's (mocked) fetch settle inside `act()` so its resulting state update
    // doesn't escape it (would otherwise print a "not wrapped in act" warning).
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });
});
