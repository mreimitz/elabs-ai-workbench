import { AlertOctagon, DollarSign, Server, TestTube2 } from "lucide-react";
import { Text } from "@brand/ui";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { formatCostUsd, formatDateTime, formatPercent } from "../../../lib/format";
import { drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { DrillList } from "./DrillList";
import type { ExpensiveRunRow, FailingLeaderboardRow } from "./metrics-derive";
import { ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 7 — Leaderboards: top-failing tests, top-failing servers (both `RunFilter`-scoped
 * click-through into the runs feed — a genuine "leaderboard row" round trip per WP 2.2 acceptance
 * #3), and the most-expensive runs (opens the RUN directly — a `RunFilter` has no single-run
 * dimension, and jumping straight to the run is more useful than a filtered feed of one).
 */
export function LeaderboardsPanel({
  failingTests,
  failingServers,
  expensiveRuns,
  controls,
  onDrill,
  onOpenRun,
}: {
  failingTests: FailingLeaderboardRow[];
  failingServers: FailingLeaderboardRow[];
  expensiveRuns: ExpensiveRunRow[];
  controls: TestingDashboardControls;
  onDrill: (filter: RunFilter) => void;
  onOpenRun: (runId: string) => void;
}) {
  const hasData = failingTests.length > 0 || failingServers.length > 0 || expensiveRuns.length > 0;

  return (
    <ChartPanel title="Leaderboards" subtitle="Top failing tests/servers · most expensive runs" icon={<AlertOctagon aria-hidden className="size-4" />}>
      {hasData ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <LeaderboardColumn icon={<TestTube2 aria-hidden className="size-4" />} title="Top failing tests">
            <DrillList
              rows={failingTests.map((row) => ({
                key: row.group,
                label: row.label,
                value: `${row.errorCount} err · ${formatPercent(row.errorRate * 100)}`,
                onOpen: () => onDrill(drillDownFilter(controls, { testId: [row.group] })),
              }))}
              emptyLabel="No failing tests in this window."
            />
          </LeaderboardColumn>

          <LeaderboardColumn icon={<Server aria-hidden className="size-4" />} title="Top failing servers">
            <DrillList
              rows={failingServers.map((row) => ({
                key: row.group,
                label: row.label,
                value: `${row.errorCount} err · ${formatPercent(row.errorRate * 100)}`,
                onOpen: () => onDrill(drillDownFilter(controls, { serverId: [row.group] })),
              }))}
              emptyLabel="No failing servers in this window."
            />
          </LeaderboardColumn>

          <LeaderboardColumn icon={<DollarSign aria-hidden className="size-4" />} title="Most expensive runs">
            <DrillList
              rows={expensiveRuns.map((row) => ({
                key: row.runId,
                label: `${row.label} · ${formatDateTime(row.startedAt)}`,
                value: formatCostUsd(row.costUsd),
                onOpen: () => onOpenRun(row.runId),
              }))}
              emptyLabel="No priced runs in this window."
            />
          </LeaderboardColumn>
        </div>
      ) : (
        <PanelEmptyState
          title="Nothing to rank"
          description="No failures or priced runs in this window — leaderboards fill in as activity accrues."
        />
      )}
    </ChartPanel>
  );
}

function LeaderboardColumn({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Text variant="meta" tone="muted" className="flex items-center gap-1.5">
        {icon}
        {title}
      </Text>
      {children}
    </div>
  );
}
