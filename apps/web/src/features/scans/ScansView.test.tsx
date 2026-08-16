import type { ScanDetail, ScanSummary } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// WP 4.2 (D-1) — ScansView is a LIST-FIRST surface: `/scans` shows the history FULL-WIDTH, and only
// `/scans/:scanId` transitions to master-detail. These tests lock that mode split, the deep-link /
// stale guard (loading pane, not a flashed wrong scan), and the mode-aware Δ column visibility.

// ScansView transitively imports @brand/editor (Monaco, via ToolDetailPanel / ResourcePromptRun) —
// far too heavy for jsdom and irrelevant to the layout under test. Stub it (mirrors the convention
// in ResourcePromptRun.test.tsx / LiveSkillWorkspaceView.test.tsx).
vi.mock("@brand/editor", () => ({
  CodeEditor: (props: { value?: string; ariaLabel?: string }) => (
    <div data-testid="code-editor" aria-label={props.ariaLabel}>
      {props.value}
    </div>
  ),
}));

// The resource/prompt run dialogs (rendered closed here) consume the MCP-auth context.
vi.mock("../servers/McpAuthProvider", () => ({
  useMcpAuth: () => ({ requestReauth: vi.fn() }),
}));

// jsdom omits matchMedia — `AdaptivePanelGroup`'s `useIsMobile` (detail mode) reads it (mirrors
// RunsView.test / EnvironmentEditor.test).
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

import { ScansView } from "./ScansView";

function scan(overrides: Partial<ScanSummary> & { id: string; serverId: string }): ScanSummary {
  return {
    serverName: `Server ${overrides.serverId}`,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-01-02T00:00:00Z",
    status: "success",
    totalTools: 3,
    totalTokens: 1000,
    totalRawBytes: 4000,
    averageTokensPerTool: 333,
    largestToolName: "search",
    largestToolTokens: 500,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    ...overrides,
  };
}

function detail(overrides: Partial<ScanSummary> & { id: string; serverId: string }): ScanDetail {
  return { ...scan(overrides), tools: [], resources: [], prompts: [], events: [] };
}

// scan-0 and scan-1 are the SAME server (srv-a) so scan-1 has a previous successful scan to diff
// against — that is what puts the "Diff vs previous" button in the detail header (used by test 2).
const SCANS: ScanSummary[] = [
  scan({ id: "scan-0", serverId: "srv-a", scannedAt: "2026-01-01T00:00:00Z", totalTokens: 800 }),
  scan({ id: "scan-1", serverId: "srv-a", scannedAt: "2026-01-02T00:00:00Z", totalTokens: 1000 }),
  scan({ id: "scan-2", serverId: "srv-b", scannedAt: "2026-01-02T00:00:00Z" }),
];

function renderAt(
  path: string,
  props: {
    scans: ScanSummary[];
    selectedScan: ScanDetail | null;
    scanLoadError?: string | null;
  },
) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/scans" element={<ScansView {...props} onLoadScan={vi.fn()} />} />
          <Route path="/scans/:scanId" element={<ScansView {...props} onLoadScan={vi.fn()} />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("ScansView — list-first IA (WP 4.2 / D-1)", () => {
  it("renders the history FULL-WIDTH with no selection: no detail pane, no resize handle, Δ column shown", () => {
    renderAt("/scans", { scans: SCANS, selectedScan: null });

    // The full-width list — its filter row is present…
    expect(screen.getByLabelText("Search scans")).toBeTruthy();
    // …but there is NO master-detail chrome: no resize handle, no back control, no loading pane.
    expect(screen.queryByLabelText(/resize scan history/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /all scans/i })).toBeNull();
    expect(screen.queryByText(/loading scan/i)).toBeNull();
    // The old "800px of nothing" empty state is gone entirely.
    expect(screen.queryByText(/no scan selected/i)).toBeNull();
    // The audit's key column reads at full width: the Δ-vs-previous column header IS shown.
    expect(screen.getByText("Δ vs previous")).toBeTruthy();
  });

  it("transitions to master-detail when a scan is selected: rail + resize handle + back control + detail", () => {
    renderAt("/scans/scan-1", {
      scans: SCANS,
      selectedScan: detail({ id: "scan-1", serverId: "srv-a" }),
    });

    // Master-detail chrome present.
    expect(screen.getByLabelText(/resize scan history/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /all scans/i })).toBeTruthy();
    // Detail content present.
    expect(screen.getByText("Total footprint")).toBeTruthy();
    // In the narrow switcher rail the Δ column folds out (its story is the detail header's explicit
    // "Diff vs previous" button), so the rail never wraps/collapses.
    expect(screen.queryByText("Δ vs previous")).toBeNull();
    expect(screen.getByRole("button", { name: /diff vs previous/i })).toBeTruthy();
  });

  it("deep-link to /scans/:id before the detail loads shows a LOADING pane inside master-detail (no list flash)", () => {
    renderAt("/scans/scan-1", { scans: SCANS, selectedScan: null });

    // We are in master-detail (the rail + handle render), NOT the full-width list.
    expect(screen.getByLabelText(/resize scan history/i)).toBeTruthy();
    // The detail pane is the transient loading state, not the old empty state and not a stale scan.
    expect(screen.getByText(/loading scan/i)).toBeTruthy();
    expect(screen.queryByText(/no scan selected/i)).toBeNull();
    expect(screen.queryByText("Total footprint")).toBeNull();
  });

  it("shows the loading pane (not a stale scan) while the URL scan differs from the loaded detail", () => {
    // URL asks for scan-2 but the loaded detail is still scan-1 (a mid-flight rail switch).
    renderAt("/scans/scan-2", {
      scans: SCANS,
      selectedScan: detail({ id: "scan-1", serverId: "srv-a" }),
    });

    expect(screen.getByText(/loading scan/i)).toBeTruthy();
    // scan-1's detail must NOT render for a /scans/scan-2 URL (the id-match guard).
    expect(screen.queryByRole("button", { name: /diff vs previous/i })).toBeNull();
  });

  // interface-craft WP 4.3 FIX 1 (P0) — a SETTLED load failure must NOT dead-end on an infinite
  // loading pane. When App.tsx passes `scanLoadError`, the detail fallback is a TERMINAL error
  // StatePanel (data-kind="error" → role="alert") + a "Back to scans" escape, not "Loading scan…".
  // T7 — a FAILED scan must not render four zero KPIs + a tab strip over a one-word diagnostic with
  // no button. The KPI grid and tabs are suppressed; the real error is hoisted with a way forward.
  it("failed scan: suppresses the zero KPIs + tab strip and hoists the alert with real actions", () => {
    const failed = { id: "scan-x", serverId: "srv-a", status: "failed" as const, errorMessage: "Unauthorized" };
    renderAt("/scans/scan-x", {
      scans: [scan(failed)],
      selectedScan: detail(failed),
    });

    // No fabricated zeros: the KPI grid + tab strip are gone.
    expect(screen.queryByText("Total footprint")).toBeNull();
    expect(screen.queryByText("Avg tokens/tool")).toBeNull();
    expect(screen.queryByRole("tab", { name: /tools/i })).toBeNull();

    // The real diagnostic is hoisted, with a real "Scan again" action + a link to connection settings.
    expect(screen.getByText("Unauthorized")).toBeTruthy();
    expect(screen.getByRole("button", { name: /scan again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit connection settings/i })).toBeTruthy();
  });

  it("failed scan that needs re-auth leads with a sign-in action and names the expired session", () => {
    const failed = {
      id: "scan-y",
      serverId: "srv-a",
      status: "failed" as const,
      authRequired: true,
      errorMessage: "Token expired",
    };
    renderAt("/scans/scan-y", { scans: [scan(failed)], selectedScan: detail(failed) });

    expect(screen.getByRole("button", { name: /sign in and rescan/i })).toBeTruthy();
    expect(screen.getByText(/session expired/i)).toBeTruthy();
  });

  it("renders a TERMINAL error StatePanel (not the loading pane) when the scan fails to load", () => {
    const { container } = renderAt("/scans/scan-404", {
      scans: SCANS,
      selectedScan: null,
      scanLoadError: "Scan not found",
    });

    // Still in master-detail (the deep-linked URL), but the pane is the settled error, not loading.
    expect(screen.getByLabelText(/resize scan history/i)).toBeTruthy();
    expect(screen.getByText("Couldn’t open the scan.")).toBeTruthy();
    expect(screen.getByText("Scan not found")).toBeTruthy();
    // The infinite loading pane is gone…
    expect(screen.queryByText(/loading scan/i)).toBeNull();
    // …and this is the error kind (role="alert" is StatePanel's error-only role) with a way out.
    expect(container.querySelector('[data-kind="error"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /back to scans/i })).toBeTruthy();
  });
});
