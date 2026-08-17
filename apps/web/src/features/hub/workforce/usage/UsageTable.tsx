import { DataTable, type ColumnDef } from "@elabs-ai/components-data";
import { Button, EmptyState, Text } from "@elabs-ai/components-ui";
import type { HubUsageRow } from "@mcp-token-footprint/shared";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatCostUsd, formatNumber } from "../../../../lib/format";
import { rankByCost, sharePercent, type UsageTotals } from "./usage-derive";
import { drillDestinationFor } from "./usage-links";

/**
 * Assistant Hub UX WP2.6 (D-HUX10, §7.3) — the Usage tab's ranked `DataTable`: one row per current
 * `groupBy` entity, sorted by spend, the unattributed ("No agent"/"No crew"/"No project") bucket
 * ALWAYS rendered — never filtered out, never hidden behind a toggle (D-HUX10's hard rule, carried
 * through from `usage-derive.ts`'s `rankByCost`, which never excludes it).
 *
 * The "Group" column is the row's drill affordance (§7.3: "row click drills"). Its destination comes
 * from `usage-links.ts`'s `drillDestinationFor` — a REAL in-tab narrow+regroup for a `project` row
 * (the only dimension `/api/hub/usage/rollup` can actually filter by), or a link to that entity's own
 * home (profile Usage sub-page / Sessions) for every other dimension. See that module's doc for why
 * this isn't a uniform "narrow" gesture across all five `HubUsageGroupBy` values. The unattributed row
 * still renders as a real button (it does have somewhere honest to go — unfiltered Sessions) so the
 * table's interaction model stays uniform; a disabled-looking dead row would suggest something is
 * broken, not that the bucket is intentionally unattributed.
 */

function drillIcon(kind: "narrow" | "profile" | "sessions") {
  return kind === "narrow" ? ArrowRight : ExternalLink;
}

export function UsageTable({
  rows,
  totals,
  onNarrowToProject,
}: {
  rows: HubUsageRow[];
  totals: UsageTotals;
  /** Fires for a `project` row's click — the only dimension the rollup API can honestly narrow by
   *  (see `usage-links.ts`). `UsageTab.tsx` sets `?uProject=` and picks the next `groupBy`. */
  onNarrowToProject: (projectId: string) => void;
}) {
  const navigate = useNavigate();
  const ranked = rankByCost(rows);

  const columns: ColumnDef<HubUsageRow>[] = [
    {
      id: "group",
      accessorFn: (row) => row.label,
      enableSorting: true,
      header: () => <div className="min-w-0">Group</div>,
      cell: ({ row }) => {
        const entity = row.original;
        const destination = drillDestinationFor(entity);
        const Icon = drillIcon(destination.kind);
        const label = (
          <span className="flex min-w-0 flex-col items-start">
            <span className="min-w-0 max-w-[16rem] truncate font-medium" title={entity.label}>
              {entity.label}
            </span>
            {entity.unattributed ? (
              <Text variant="caption" tone="muted">
                unattributed
              </Text>
            ) : null}
          </span>
        );
        return (
          <div className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto w-full items-center justify-between gap-2 px-1.5 py-1 text-left"
              onClick={() => {
                if (destination.kind === "narrow") onNarrowToProject(destination.projectId);
                else if (destination.kind === "profile") navigate(destination.href);
                else navigate(destination.href);
              }}
              aria-label={
                destination.kind === "narrow"
                  ? `Narrow to project ${entity.label}`
                  : destination.kind === "profile"
                    ? `Open ${entity.label}'s usage profile`
                    : destination.kind === "sessions" && destination.filtered
                      ? `View sessions for ${entity.label}`
                      : "Open sessions"
              }
            >
              {label}
              <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </div>
        );
      },
    },
    {
      id: "sessions",
      accessorFn: (row) => row.sessions,
      enableSorting: true,
      header: () => <div className="text-right">Sessions</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatNumber(row.original.sessions)}</div>
      ),
    },
    {
      id: "cost",
      accessorFn: (row) => row.costUsd,
      enableSorting: true,
      header: () => <div className="text-right">Cost</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatCostUsd(row.original.costUsd)}</div>
      ),
    },
    {
      id: "tokensIn",
      accessorFn: (row) => row.tokensIn,
      enableSorting: true,
      header: () => <div className="text-right">Tokens in</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatNumber(row.original.tokensIn)}</div>
      ),
    },
    {
      id: "tokensOut",
      accessorFn: (row) => row.tokensOut,
      enableSorting: true,
      header: () => <div className="text-right">Tokens out</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatNumber(row.original.tokensOut)}</div>
      ),
    },
    {
      id: "share",
      accessorFn: (row) => sharePercent(row.costUsd, totals.costUsd),
      enableSorting: true,
      header: () => <div className="text-right">Share</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {sharePercent(row.original.costUsd, totals.costUsd)}%
        </div>
      ),
    },
  ];

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border">
      <DataTable
        data={ranked}
        columns={columns}
        initialView={{ sorting: [{ id: "cost", desc: true }] }}
        emptyMessage={
          <EmptyState
            title="No spend in this window"
            description="Widen the date range or clear the project filter to see usage."
          />
        }
      />
    </div>
  );
}
