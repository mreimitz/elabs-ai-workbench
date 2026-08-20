import { useMemo } from "react";
import { Wrench } from "lucide-react";
import { BentoGridItem, MetricCard, Progress } from "@elabs-ai/components-ui";
import type { ScanSummary } from "@mcp-token-footprint/shared";
import { formatNumber, formatPercent } from "../../../../lib/format";
import { rankedServerScans } from "./scan-tile-data";

/**
 * LargestToolTile — the single most expensive tool definition in the fleet (dashboard-bento WP 2.1).
 * =============================================================================================
 * Carried across from `ScansTab.tsx`'s "Largest single tool" `MetricCard`, which WP 2.2 retires.
 * The figure is the biggest `largestToolTokens` across the latest SUCCESSFUL scan of every server —
 * the same population `InventoryTile` and `FootprintTableTile` total (`scan-tile-data.ts`), so the
 * three tiles cannot disagree about which fleet they are describing.
 *
 * ── WHY THIS TILE HAS NO SPARKLINE, AND WHY THAT IS THE ENHANCEMENT ──────────────────────────────
 * `ScansTab` deliberately gave this figure no Δ and no series: **"largest single tool" can be a
 * DIFFERENT tool at every point in the history**, so a trend line would silently compare unlike
 * things — `search_repositories` last week against `create_pull_request` today, drawn as if one
 * number had moved. That reasoning is not weakened by moving the tile onto the bento, so it stands.
 * A sparkline here would be exactly the fabricated figure the WP forbids.
 *
 * What the tile gains instead is the CONTEXT the old card never gave: which server the tool belongs
 * to, and what share of that server's tool footprint one definition accounts for. Both come off the
 * SAME scan row as the headline (`largestToolTokens` / `totalTokens`, both tools-only — the T10
 * discipline: two figures on one tile must denote the same quantity), so nothing is inferred and no
 * unit is converted. The share is stated only when the scan reports a non-zero tool total; a divide
 * by zero renders no bar and no percentage rather than a "0%" nobody could act on.
 *
 * The tile nests a `MetricCard` **flush** inside its `BentoGridItem` — the bento item already
 * composes the `Card` surface, so the inner card drops its own border/fill/shadow, the same house
 * pattern `StartupCostTile` uses. Nesting two opaque card surfaces would paint the double edge the
 * bento component's own docs flag.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour;
 * reads in both themes.
 */
export type LargestToolTileProps = {
  /** The app's scan list — already in memory in `App.tsx`. */
  scans: ScanSummary[];
};

export function LargestToolTile({ scans }: LargestToolTileProps) {
  const top = useMemo(() => {
    return rankedServerScans(scans)
      .filter((scan) => scan.largestToolName)
      .sort((a, b) => b.largestToolTokens - a.largestToolTokens)[0];
  }, [scans]);

  // No successful scan has named a largest tool — the bento must never render an empty box.
  if (!top) return null;

  // Both figures come off ONE scan row and are both tools-only, so the share is a real ratio of the
  // same quantity. A zero tool total yields no share at all rather than a meaningless 0%.
  const share = top.totalTokens > 0 ? (top.largestToolTokens / top.totalTokens) * 100 : null;

  return (
    <BentoGridItem size="sm">
      <MetricCard
        className="h-full border-0 bg-transparent shadow-none"
        icon={<Wrench aria-hidden />}
        label="Largest single tool"
        value={formatNumber(top.largestToolTokens)}
        description={top.largestToolName}
        {...(share !== null
          ? {
              visual: (
                <Progress
                  value={share}
                  aria-label={`${top.largestToolName} is ${formatPercent(share)} of ${top.serverName}’s tool tokens`}
                />
              ),
            }
          : {})}
        evidence={
          <span className="block break-words">
            {share !== null
              ? `${formatPercent(share)} of ${top.serverName}’s tool tokens`
              : `On ${top.serverName}`}
          </span>
        }
      />
    </BentoGridItem>
  );
}
