import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";

// The Scans tab renders `MetricGrid` (`@brand/charts`), and the Testing tab (WP 2.2) renders the
// rest of the package's chart surface — importing ANY named export from that package's barrel under
// Vitest/jsdom resolves a broken deep `@visx/gradient` subpath used by its (unrelated, unused here)
// Gantt chart, a pre-existing environment-only issue confirmed for every export, not just
// `MetricGrid` (see `ScansTab.test.tsx`'s longer note; `RunConsole.test.tsx`/`TestingTab.test.tsx`
// mock around the same class of issue). A thin pass-through per export mounts both real tab bodies.
vi.mock("@brand/charts", () => ({
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
  };
});

import { DashboardView } from "./DashboardView";

// WP 2.1 — Dashboard becomes the tab HOST (Scans | Testing). These lock the tab-shell contract:
// default tab, deep-link via `?tab=`, restore-on-reload, URL updates on switch, and Radix's
// keyboard tab-strip behavior (arrow-key roving focus + automatic activation).

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

beforeEach(() => {
  window.localStorage.clear();
});

describe("DashboardView — loading gate", () => {
  test("initialLoading renders a loading panel, no tab strip", () => {
    renderDashboard({ initialLoading: true });
    expect(screen.getByText("Loading dashboard…")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Scans" })).not.toBeInTheDocument();
  });
});

describe("DashboardView — default tab + deep link", () => {
  test("defaults to the Scans tab with a clean URL (no ?tab= for the default)", () => {
    renderDashboard();
    const scansTab = screen.getByRole("tab", { name: "Scans" });
    expect(scansTab).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Since your last visit")).toBeInTheDocument(); // ScansTab content
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
  });

  test("`?tab=testing` deep-links directly into the Testing tab on mount", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=testing"] });
    expect(screen.getByRole("tab", { name: "Testing" })).toHaveAttribute("data-state", "active");
    // The Testing tab's real content (WP 2.2) — an empty-but-valid metrics fetch settles into its
    // own honest empty state, proving this is the real tab, not the retired "coming soon" shell.
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
    expect(screen.queryByText("Since your last visit")).not.toBeInTheDocument();
  });

  test("an unrecognized ?tab= value falls back to the default (Scans)", () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=bogus"] });
    expect(screen.getByRole("tab", { name: "Scans" })).toHaveAttribute("data-state", "active");
  });
});

describe("DashboardView — tab switch updates the URL (restore-on-reload)", () => {
  test("switching to Testing writes ?tab=testing; switching back removes it", async () => {
    renderDashboard();
    activateTab("Testing");
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard?tab=testing");

    activateTab("Scans");
    expect(screen.getByText("Since your last visit")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
    expect(screen.getByTestId("location")).not.toHaveTextContent("?tab=");
  });

  test("the Testing tab body unmounts the Scans tab body and vice versa (Radix single active panel)", async () => {
    renderDashboard();
    expect(screen.getByText("Since your last visit")).toBeInTheDocument();
    activateTab("Testing");
    expect(screen.queryByText("Since your last visit")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });
});

describe("DashboardView — keyboard tab-strip behavior", () => {
  test("ArrowRight moves roving focus to the next tab and activates it (Radix automatic mode)", async () => {
    renderDashboard();
    const scansTab = screen.getByRole("tab", { name: "Scans" });
    const testingTab = screen.getByRole("tab", { name: "Testing" });
    scansTab.focus();
    expect(document.activeElement).toBe(scansTab);
    fireEvent.keyDown(scansTab, { key: "ArrowRight" });
    // Radix's roving-focus-group moves focus, then activates the panel on a LATER tick (focus and
    // selection land in separate updates past the synchronous keydown handler) — wait for both
    // rather than asserting immediately.
    await waitFor(() => expect(document.activeElement).toBe(testingTab));
    await waitFor(() => expect(testingTab).toHaveAttribute("data-state", "active"));
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });
});

describe("DashboardView — Issues tab (WP 5.3 mount)", () => {
  test("`?tab=issues` deep-links into the Issues tab and renders its real (empty) content", async () => {
    renderDashboard({}, { initialEntries: ["/dashboard?tab=issues"] });
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("data-state", "active");
    // `listIssues` resolves `[]` — the tab settles into its own honest empty state, proving the real
    // `IssuesFleetTab` (not a placeholder) mounted at the WP 2.1 commented mount point.
    await waitFor(() => expect(screen.getByText("No fleet issues recorded")).toBeInTheDocument());
    expect(screen.queryByText("Since your last visit")).not.toBeInTheDocument();
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
    const heading = screen.getByRole("heading", { level: 1, name: "Dashboard" });
    expect(heading).toBeInTheDocument();
    activateTab("Testing");
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBe(heading);
    // Let the Testing tab's (mocked) fetch settle inside `act()` so its resulting state update
    // doesn't escape it (would otherwise print a "not wrapped in act" warning).
    await waitFor(() => expect(screen.getByText("No runs in this window")).toBeInTheDocument());
  });
});
