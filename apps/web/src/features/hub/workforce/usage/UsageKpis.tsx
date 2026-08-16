import { MetricCard, MetricGrid } from "@brand/charts";
import type { HubPlanAcceptanceMetric } from "@mcp-token-footprint/shared";
import { formatCostUsd, formatNumber, formatPercent } from "../../../../lib/format";
import type { UsageTotals } from "./usage-derive";

/**
 * Assistant Hub UX WP2.6 (D-HUX10, §7.3) — the Usage tab's `MetricGrid` KPI row: Spend · Sessions ·
 * Tokens in/out · Plan acceptance, "for the current filter" per the concept wireframe.
 *
 * `totals` is `sumUsageRows(rollupRows)` — the SAME rows the ranked DataTable renders, so the KPI
 * total and the table's own row sum are the same computation by construction (WP1.6's reconciliation
 * invariant, carried through to the render path — see `usage-derive.ts`'s doc). It deliberately does
 * NOT read `HubUsageSummary.totals` (the per-entity `/api/hub/usage/summary` response): that field is
 * a ROLLING sum over a trailing `days` window ending today, not the tab's selected `from`/`to` range
 * — using it here would silently mislabel a lifetime/range figure as a rolling one. `/summary` is
 * used ONLY for the stacked-over-time chart's daily strip (`UsageCharts.tsx`), never for KPI copy.
 *
 * `planAcceptance` has no rollup/group-by equivalent (it's a mission-level R-UX6 signal, not a
 * spend/token rollup dimension) — sourced separately from `GET /api/hub/usage` (the existing
 * `getHubUsage` aggregate, which DOES honor the same `from`/`to`/`projectId` filter), `undefined`
 * while that fetch is in flight.
 */
export function UsageKpis({
  totals,
  planAcceptance,
}: {
  totals: UsageTotals;
  planAcceptance: HubPlanAcceptanceMetric | undefined;
}) {
  return (
    <MetricGrid columns={4}>
      <MetricCard label="Spend" value={formatCostUsd(totals.costUsd)} />
      <MetricCard label="Sessions" value={formatNumber(totals.sessions)} />
      <MetricCard
        label="Tokens (in / out)"
        value={`${formatNumber(totals.tokensIn)} / ${formatNumber(totals.tokensOut)}`}
      />
      <MetricCard
        label="Plan acceptance (unedited)"
        value={planAcceptance ? formatPercent(planAcceptance.uneditedPercent) : "—"}
        description={
          planAcceptance
            ? `${planAcceptance.uneditedApprovals} of ${planAcceptance.approvedMissions} approved plans`
            : undefined
        }
      />
    </MetricGrid>
  );
}
