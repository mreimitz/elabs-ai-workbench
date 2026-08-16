import type { HubUsageRow } from "@mcp-token-footprint/shared";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UsageTable } from "./UsageTable";

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderTable(rows: HubUsageRow[], onNarrowToProject = vi.fn()) {
  const totals = rows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      costUsd: acc.costUsd + r.costUsd,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
    }),
    { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
  );
  render(
    <MemoryRouter initialEntries={["/assistant/agents?tab=usage"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LocationProbe />
              <UsageTable rows={rows} totals={totals} onNarrowToProject={onNarrowToProject} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onNarrowToProject };
}

describe("UsageTable (WP2.6, D-HUX10) — the ranked DataTable + its per-row drill", () => {
  test("the unattributed 'no agent' bucket is ALWAYS rendered, never filtered out", () => {
    renderTable([
      row({ key: "a", label: "Alpha", costUsd: 5 }),
      row({ key: null, label: "No agent", unattributed: true, costUsd: 2 }),
    ]);
    expect(screen.getByText("No agent")).toBeInTheDocument();
    expect(screen.getByText("unattributed")).toBeInTheDocument();
  });

  test("rows render even when the ENTIRE rollup is unattributed spend", () => {
    renderTable([
      row({ key: null, label: "No agent", unattributed: true, costUsd: 5, sessions: 2 }),
    ]);
    expect(screen.getByText("No agent")).toBeInTheDocument();
  });

  test("clicking a PROJECT row narrows in-tab (onNarrowToProject), no navigation", () => {
    const { onNarrowToProject } = renderTable([
      row({ groupBy: "project", key: "proj_1", label: "Falcon", costUsd: 5 }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Narrow to project Falcon/i }));
    expect(onNarrowToProject).toHaveBeenCalledWith("proj_1");
    expect(screen.getByTestId("location").textContent).toBe("/assistant/agents?tab=usage");
  });

  test("clicking an AGENT row navigates to that agent's profile Usage sub-page", () => {
    renderTable([row({ groupBy: "agent", key: "role_1", label: "Researcher", costUsd: 5 })]);
    fireEvent.click(screen.getByRole("button", { name: /Researcher.*usage profile/i }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/assistant/agents/agent/role_1?tab=usage&settings=usage",
    );
  });

  test("clicking a MODEL row navigates to Sessions filtered by model", () => {
    renderTable([
      row({ groupBy: "model", key: "claude-sonnet-5", label: "claude-sonnet-5", costUsd: 5 }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /View sessions for claude-sonnet-5/i }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/assistant/sessions?model=claude-sonnet-5",
    );
  });

  test("clicking the unattributed row opens Sessions unfiltered", () => {
    renderTable([
      row({ groupBy: "crew", key: null, unattributed: true, label: "No crew", costUsd: 5 }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    expect(screen.getByTestId("location").textContent).toBe("/assistant/sessions");
  });

  test("shows a real empty state (not a blank table) when there are no rows", () => {
    renderTable([]);
    expect(screen.getByText("No spend in this window")).toBeInTheDocument();
  });
});
