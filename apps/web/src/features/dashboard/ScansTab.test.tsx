import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";

// `MetricGrid` is a real `@brand/charts` export, but importing ANYTHING from that package's barrel
// under Vitest/jsdom resolves a broken deep `@visx/gradient` subpath used by its (unrelated, unused
// here) Gantt chart — a pre-existing, environment-only issue (confirmed: `import { MetricGrid } from
// "@brand/charts"` alone fails identically in a scratch test; `AreaChart` from the same package does
// not). `RunConsole.test.tsx` hits the same class of issue ("AnalyticsPanel — pulls `@brand/charts`
// that jsdom can't load") and mocks around it; mirrored here. A trivial pass-through keeps the real
// `MetricCard`/`@brand/ui` children (and this test's assertions on them) intact.
vi.mock("@brand/charts", () => ({
  MetricGrid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { ScansTab } from "./ScansTab";

// WP 2.1 — ScansTab is the pre-WP-2.1 `DashboardView` body moved VERBATIM into the Dashboard's
// "Scans" tab (extraction, no redesign). These are smoke tests locking that the moved content still
// renders its cards/KPIs/tables (there were no pre-existing `DashboardView` tests in this repo to
// "update" — `features/dashboard/` had no test file before this WP).

function server(overrides: Partial<ServerConfig> & { id: string; name: string }): ServerConfig {
  return {
    transport: "streamable_http",
    url: "https://example.com/mcp",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function scan(overrides: Partial<ScanSummary> & { id: string; serverId: string }): ScanSummary {
  return {
    serverName: overrides.serverId,
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
    ...overrides,
  };
}

function renderScansTab(props: Partial<Parameters<typeof ScansTab>[0]> = {}) {
  const onOpenScan = vi.fn();
  const onOpenServer = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ScansTab
          servers={[]}
          scans={[]}
          onOpenScan={onOpenScan}
          onOpenServer={onOpenServer}
          lastVisitAt={null}
          {...props}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onOpenScan, onOpenServer };
}

describe("ScansTab", () => {
  test("renders the change/attention cards, the KPI grid, and both tables", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "scan-1", serverId: "srv-a", serverName: "Alpha" })],
    });
    expect(screen.getByText("Since your last visit")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Biggest movers")).toBeInTheDocument();
    expect(screen.getByText("Servers")).toBeInTheDocument(); // MetricCard label
    expect(screen.getByText("Latest server footprint")).toBeInTheDocument();
    expect(screen.getByText("Recent scan activity")).toBeInTheDocument();
    // The one configured server's latest scan renders in the footprint table.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  test("first-visit welcome copy when no last-visit reference is stored", () => {
    renderScansTab({ lastVisitAt: null });
    expect(
      screen.getByText(/Welcome\. Footprint changes to your servers will show up here/),
    ).toBeInTheDocument();
  });

  test("'no changes' copy when a last-visit reference exists but nothing changed since", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "scan-1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2020-01-01T00:00:00Z", // long before lastVisitAt
        }),
      ],
      lastVisitAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(screen.getByText(/No changes since/)).toBeInTheDocument();
  });

  test("attention queue lists an unscanned server with a Scan CTA when onRunScan is wired", () => {
    const onRunScan = vi.fn();
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [],
      onRunScan,
    });
    expect(screen.getByText("No scan yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();
  });

  test("empty state: no servers, no scans still renders the page frame without crashing", () => {
    renderScansTab();
    expect(
      screen.getByText("All configured servers have a successful latest scan."),
    ).toBeInTheDocument();
    expect(screen.getByText("No completed scans yet.")).toBeInTheDocument();
    expect(screen.getByText("No scan activity yet.")).toBeInTheDocument();
  });

  // D-TB11 / audit D-3: the "quiet success text, chip for everything else" split still holds, now
  // expressed through StatusBadge's `quiet` prop instead of an inline <Text> exception (WP 2.6).
  test("recent scan activity renders a success status as quiet muted text (no chip), while the attention queue still shows a status chip", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" }), server({ id: "srv-b", name: "Beta" })],
      scans: [scan({ id: "scan-1", serverId: "srv-a", serverName: "Alpha", status: "success" })],
    });
    // Recent scan activity: the success row reads "Completed" as plain muted text — not a chip.
    const completedNodes = screen.getAllByText("Completed");
    expect(completedNodes.length).toBeGreaterThan(0);
    for (const node of completedNodes) {
      expect(node.closest("[data-status]")).toBeNull();
    }
    // Attention queue: Beta has no scan yet -> a real StatusBadge chip still renders (Pending, dashed).
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(document.querySelector('[data-status="pending"]')).not.toBeNull();
  });

  // T10: the KPI ("Total startup tokens … Tools + resources + prompts") and the two tables' token
  // column used to share the bare label "Tokens" while meaning two different quantities (tools-only
  // vs tools+resources+prompts) — a silent gap. The column is now labelled "Tool tokens" so the two
  // figures can never be read as the same thing, and the KPI still states its own composition.
  test("the footprint tables label the tools-only column distinctly from the tools+resources+prompts KPI", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "scan-1",
          serverId: "srv-a",
          serverName: "Alpha",
          totalTokens: 1000,
          totalResourceTokens: 200,
          totalPromptTokens: 50,
        }),
      ],
    });
    // The KPI states its own definition explicitly.
    expect(screen.getByText("Total startup tokens")).toBeInTheDocument();
    expect(screen.getByText(/Tools \+ resources \+ prompts/)).toBeInTheDocument();
    // Neither table column is labelled with the bare, ambiguous "Tokens" — both name the tools-only
    // scope so they can't be misread as the KPI's broader total.
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tool tokens").length).toBe(2); // footprint table + recent activity table
  });
});
