import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { parseRunFilter } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { defaultControls, drillDownHref } from "./dashboard-url-state";
import { LeaderboardsPanel } from "./LeaderboardsPanel";
import type { ExpensiveRunRow, FailingLeaderboardRow } from "./metrics-derive";

function renderPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const CONTROLS = { ...defaultControls(new Date("2026-07-17T00:00:00.000Z")), from: "2026-07-01", to: "2026-07-10" };

const FAILING_TESTS: FailingLeaderboardRow[] = [
  { group: "test-a", label: "Regression suite", count: 10, errorCount: 3, errorRate: 0.3 },
];
const FAILING_SERVERS: FailingLeaderboardRow[] = [
  { group: "srv-1", label: "Alpha", count: 20, errorCount: 5, errorRate: 0.25 },
];
const EXPENSIVE_RUNS: ExpensiveRunRow[] = [
  {
    runId: "run-1",
    label: "Regression suite",
    scenarioName: "Prod",
    costUsd: 4.2,
    startedAt: "2026-07-02T00:00:00.000Z",
    testId: "test-a",
    scenarioId: "scn-1",
  },
];

describe("LeaderboardsPanel", () => {
  test("renders all three leaderboard columns", () => {
    renderPanel(
      <LeaderboardsPanel
        failingTests={FAILING_TESTS}
        failingServers={FAILING_SERVERS}
        expensiveRuns={EXPENSIVE_RUNS}
        controls={CONTROLS}
        onDrill={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );
    expect(screen.getByText("Top failing tests")).toBeInTheDocument();
    expect(screen.getByText("Top failing servers")).toBeInTheDocument();
    expect(screen.getByText("Most expensive runs")).toBeInTheDocument();
    expect(screen.getAllByText(/Regression suite/).length).toBeGreaterThan(0);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  test("all empty → the panel's own 'nothing to rank' empty state", () => {
    renderPanel(
      <LeaderboardsPanel
        failingTests={[]}
        failingServers={[]}
        expensiveRuns={[]}
        controls={CONTROLS}
        onDrill={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );
    expect(screen.getByText("Nothing to rank")).toBeInTheDocument();
  });

  // WP 2.2 acceptance #3 — drill-down round trip for "a leaderboard row": a failing-TEST row scopes
  // to that exact testId, and a failing-SERVER row scopes to that exact serverId — never each
  // other's dimension, never the whole set.
  test("a failing-test row opens the runs feed scoped to EXACTLY that testId (round trip)", () => {
    const onDrill = vi.fn();
    renderPanel(
      <LeaderboardsPanel
        failingTests={FAILING_TESTS}
        failingServers={FAILING_SERVERS}
        expensiveRuns={[]}
        controls={CONTROLS}
        onDrill={onDrill}
        onOpenRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open runs for regression suite/i }));
    const filter = onDrill.mock.calls[0]![0];
    expect(filter.testId).toEqual(["test-a"]);
    expect(filter.serverId).toBeUndefined();

    const encoded = decodeURIComponent(drillDownHref(filter).slice("/testing/runs?filter=".length));
    expect(parseRunFilter(encoded).testId).toEqual(["test-a"]);
  });

  test("a failing-server row opens the runs feed scoped to EXACTLY that serverId", () => {
    const onDrill = vi.fn();
    renderPanel(
      <LeaderboardsPanel
        failingTests={[]}
        failingServers={FAILING_SERVERS}
        expensiveRuns={[]}
        controls={CONTROLS}
        onDrill={onDrill}
        onOpenRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open runs for alpha/i }));
    expect(onDrill.mock.calls[0]![0].serverId).toEqual(["srv-1"]);
  });

  test("a most-expensive-run row opens the RUN directly (not a RunFilter — no single-run dimension exists)", () => {
    const onOpenRun = vi.fn();
    renderPanel(
      <LeaderboardsPanel
        failingTests={[]}
        failingServers={[]}
        expensiveRuns={EXPENSIVE_RUNS}
        controls={CONTROLS}
        onDrill={vi.fn()}
        onOpenRun={onOpenRun}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open runs for regression suite/i }));
    expect(onOpenRun).toHaveBeenCalledWith("run-1");
  });
});
