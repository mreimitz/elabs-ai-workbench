import type { ReactNode } from "react";
import type {
  HubProject,
  HubUsageAggregates,
  HubUsageRow,
  HubUsageSummary,
} from "@mcp-token-footprint/shared";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The chart-prop stub lives in UsageCharts.test.tsx; here the chart internals are irrelevant to the
// KPI/table reconciliation and URL-state behavior under test, so @elabs-ai/components-charts is stubbed inert
// (the same posture every non-chart-focused suite in this app takes).
vi.mock("@elabs-ai/components-charts", () => ({
  MetricGrid: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MetricCard: ({ label, value }: { label?: ReactNode; value?: ReactNode }) => (
    <div>
      <span>{label}</span>
      <span data-testid={`metric-${label}`}>{value}</span>
    </div>
  ),
  ComposedChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SeriesBar: () => null,
  Bar: () => null,
  BarXAxis: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    listHubProjects: vi.fn(),
    getHubUsage: vi.fn(),
    getHubUsageRollup: vi.fn(),
    getHubUsageSummary: vi.fn(),
  };
});

import * as api from "../../../../lib/api";
import { UsageTab } from "./UsageTab";

function project(over: Partial<HubProject> = {}): HubProject {
  return {
    id: "proj_1",
    name: "Falcon",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function row(over: Partial<HubUsageRow> = {}): HubUsageRow {
  return {
    groupBy: "agent",
    key: "role_1",
    label: "Researcher",
    sessions: 3,
    costUsd: 9,
    tokensIn: 300,
    tokensOut: 150,
    ...over,
  };
}

function aggregates(over: Partial<HubUsageAggregates> = {}): HubUsageAggregates {
  return {
    range: {},
    totals: { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
    byModel: [],
    byProvider: [],
    byProviderCredential: [],
    byMode: [],
    byDay: [],
    missions: [],
    planAcceptance: { approvedMissions: 2, uneditedApprovals: 1, uneditedPercent: 50 },
    ...over,
  };
}

function summary(over: Partial<HubUsageSummary> = {}): HubUsageSummary {
  return {
    groupBy: "agent",
    id: "role_1",
    label: "Researcher",
    totals: { sessions: 999, costUsd: 999, tokensIn: 999, tokensOut: 999 }, // deliberately absurd —
    // proves UsageKpis never reads this (see UsageKpis.tsx's doc: summary.totals is a ROLLING window,
    // not the tab's selected range, so it must never leak into the KPI row).
    strip: [
      {
        key: "2026-06-01",
        label: "2026-06-01",
        sessions: 3,
        costUsd: 9,
        tokensIn: 300,
        tokensOut: 150,
      },
    ],
    ...over,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderTab(initialEntry = "/assistant/agents?tab=usage") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LocationProbe />
              <UsageTab />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listHubProjects).mockResolvedValue([project()]);
  vi.mocked(api.getHubUsage).mockResolvedValue(aggregates());
  vi.mocked(api.getHubUsageSummary).mockResolvedValue(summary());
});

describe("UsageTab (WP2.6, D-HUX10)", () => {
  test("KPI totals reconcile EXACTLY with the sum of the rollup rows (WP1.6's invariant, carried to render)", async () => {
    const rows: HubUsageRow[] = [
      row({ key: "a", label: "Alpha", sessions: 3, costUsd: 9, tokensIn: 300, tokensOut: 150 }),
      row({ key: "b", label: "Beta", sessions: 2, costUsd: 4, tokensIn: 40, tokensOut: 20 }),
      row({
        key: null,
        label: "No agent",
        unattributed: true,
        sessions: 1,
        costUsd: 1,
        tokensIn: 5,
        tokensOut: 2,
      }),
    ];
    vi.mocked(api.getHubUsageRollup).mockResolvedValue(rows);

    renderTab();

    await waitFor(() => expect(api.getHubUsageRollup).toHaveBeenCalled());
    // Spend = 9 + 4 + 1 = 14 (matches formatCostUsd's own rendering, not a hand-rolled string).
    await waitFor(() => expect(screen.getByTestId("metric-Spend").textContent).toContain("14"));
    expect(screen.getByTestId("metric-Sessions").textContent).toBe("6");
    // The unattributed row's spend is INCLUDED — never silently dropped.
    expect(screen.getByText("No agent")).toBeInTheDocument();
  });

  test("the no-agent bucket renders even when it is the ENTIRE result set", async () => {
    vi.mocked(api.getHubUsageRollup).mockResolvedValue([
      row({
        key: null,
        label: "No agent",
        unattributed: true,
        sessions: 4,
        costUsd: 12,
        tokensIn: 10,
        tokensOut: 5,
      }),
    ]);
    renderTab();
    await waitFor(() => expect(screen.getByText("No agent")).toBeInTheDocument());
    expect(screen.getByTestId("metric-Sessions").textContent).toBe("4");
  });

  test("changing group-by (via the URL) re-fetches the rollup with the new dimension", async () => {
    vi.mocked(api.getHubUsageRollup).mockResolvedValue([row()]);
    renderTab("/assistant/agents?tab=usage&uGroupBy=crew");
    await waitFor(() =>
      expect(api.getHubUsageRollup).toHaveBeenCalledWith("crew", expect.objectContaining({})),
    );
  });

  test("with no ?uGroupBy= on the URL, the tab defaults to grouping by agent (clean-URL default)", async () => {
    vi.mocked(api.getHubUsageRollup).mockResolvedValue([row()]);
    renderTab("/assistant/agents?tab=usage");
    await waitFor(() =>
      expect(api.getHubUsageRollup).toHaveBeenCalledWith("agent", expect.objectContaining({})),
    );
    // The default never round-trips onto the URL (mirrors AuditView/SessionsView's clean-default
    // convention) — a bare tab URL, not one padded with every default param.
    expect(screen.getByTestId("location").textContent).not.toContain("uGroupBy");
  });

  test("a project row's click sets ?uProject= on the URL (in-tab narrow, per usage-links.ts)", async () => {
    vi.mocked(api.getHubUsageRollup).mockResolvedValue([
      row({ groupBy: "project", key: "proj_1", label: "Falcon", costUsd: 5, sessions: 1 }),
    ]);
    renderTab("/assistant/agents?tab=usage&uGroupBy=project");
    await waitFor(() => expect(screen.getByText("Falcon")).toBeInTheDocument());

    const button = screen.getByRole("button", { name: /Narrow to project Falcon/i });
    fireEvent.click(button);

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent ?? "";
      expect(location).toContain("uProject=proj_1");
      // Regroups away from "project" to "agent" (the default) — omitted from the URL entirely per
      // the clean-default-URL convention (usage-url-state.ts's writeUsageControlsToSearchParams).
      expect(location).not.toContain("uGroupBy=project");
      expect(location).not.toContain("uGroupBy");
    });
  });

  test("shows an error state with a working retry on a failed rollup fetch", async () => {
    vi.mocked(api.getHubUsageRollup).mockRejectedValueOnce(new Error("boom"));
    renderTab();
    await waitFor(() => expect(screen.getByText("Couldn’t load usage")).toBeInTheDocument());

    vi.mocked(api.getHubUsageRollup).mockResolvedValue([row()]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Researcher")).toBeInTheDocument());
  });

  // model-identity WP3.3 (D-MI10) — the "Billed to" panel is fed from the SAME `getHubUsage` fetch
  // that already supplied `planAcceptance`; `/rollup` has no credential dimension to source it from.
  test("the Billed to panel renders byProviderCredential from GET /api/hub/usage", async () => {
    vi.mocked(api.getHubUsageRollup).mockResolvedValue([row()]);
    vi.mocked(api.getHubUsage).mockResolvedValue(
      aggregates({
        byProviderCredential: [
          {
            key: "credential:cred_sub",
            label: "Claude Max",
            providerKind: "claude_subscription",
            credentialId: "cred_sub",
            billing: "subscription",
            unpinned: false,
            sessions: 1,
            costUsd: 3,
            tokensIn: 10,
            tokensOut: 4,
          },
        ],
      }),
    );

    renderTab();

    await waitFor(() => expect(screen.getByText("Claude Max")).toBeInTheDocument());
    expect(screen.getByText("Anthropic CLI")).toBeInTheDocument();
    expect(screen.queryByText("Anthropic")).not.toBeInTheDocument();
  });

  test("the stacked-over-time chart never reads /summary's totals for KPI copy", async () => {
    vi.mocked(api.getHubUsageRollup).mockResolvedValue([
      row({ key: "a", label: "Alpha", costUsd: 9, sessions: 3 }),
    ]);
    renderTab();
    await waitFor(() => expect(api.getHubUsageSummary).toHaveBeenCalled());
    // The mocked summary.totals.costUsd is 999 — if it ever leaked into the KPI row this would fail.
    expect(within(screen.getByTestId("metric-Spend")).queryByText(/999/)).not.toBeInTheDocument();
  });
});
