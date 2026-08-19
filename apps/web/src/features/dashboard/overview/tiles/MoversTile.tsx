import { Link } from "react-router-dom";
import { BentoGridItem, Button, Skeleton, Text } from "@elabs-ai/components-ui";
import { ChevronRight, GitCompareArrows } from "lucide-react";
import type { FootprintData, OverviewPoint, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";
import { InlineError } from "../../../../components/InlineError";
import { SectionCardTitle } from "../../../../components/SectionCardTitle";
import { ScanDeltaCell } from "../../../scans/scanDelta";
import { formatNumber } from "../../../../lib/format";

/**
 * MoversTile — the Overview bento's "biggest footprint movers" list (dashboard-bento WP 1.3).
 * =============================================================================================
 * A 2×1 tile (`size="md"`) ranking the servers whose measured footprint moved most inside the
 * Overview's window, each with its signed token Δ and a one-click diff.
 *
 * SOURCE. The contract has no movers section — movement is DERIVED from
 * `OverviewData.footprint.perServer`, the same series the hero chart plots, so the two tiles can
 * never disagree about what moved. A server's Δ is its LAST measured point minus the one
 * immediately before it (see {@link deriveMovers}).
 *
 * DELTA TONE IS NOT DECIDED HERE. Every Δ renders through {@link ScanDeltaCell}, which reads the
 * app's ONE magnitude-delta authority (`lib/delta.ts` — amber for worse, green for better, red
 * reserved for structural removal, D-IC3). This tile maps no sign to a colour of its own; that is
 * exactly the divergence D-IC3 was locked to end.
 *
 * PRESENTATION mirrors `features/dashboard/ScansTab.tsx`'s "Biggest movers" card — a divided list,
 * a truncating server name over its "N tokens" figure, the shared Δ cell, then Diff / Open — so the
 * operator meets one movers list, not two.
 *
 * ── WHAT COUNTS AS A MOVER (and what deliberately does not) ───────────────────────────────────────
 * Only a server with a real, non-zero, COMPARABLE Δ. A server measured for the first time in the
 * window has no magnitude to rank — it is not a mover, and inventing a Δ against a non-existent
 * baseline is precisely the WP 0.3 defect this plan exists to avoid. Those servers are not silently
 * dropped either: the tile states how many there are, so the list's silence stays honest. If nothing
 * has a comparable Δ, the tile removes itself.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour.
 */
export type MoversTileProps = {
  /** The contract's footprint section — the movers are derived from its per-server series. */
  section: SectionEnvelope<FootprintData>;
  /** Retry the section's fetch. Renders the `InlineError` retry affordance when given. */
  onRetry?: () => void;
};

/** How many movers the 2×1 tile ranks. The list scrolls inside the tile; this is a reading budget. */
const MAX_ROWS = 5;

/** One ranked mover: the server, its latest measured footprint, and the signed Δ that ranked it. */
export type Mover = {
  serverId: string;
  serverName: string;
  /** The latest measured value in the window. */
  currentTokens: number;
  /** Signed change vs the previous measured point. Always a real, non-zero number here. */
  deltaTokens: number;
};

/**
 * A point that represents an actual measurement.
 *
 * The hook densifies each series so a sparkline cannot lie about cadence, and a densified bucket has
 * to carry SOME number. A successful scan never measures a zero-token surface, so a `0` (or a
 * negative, or a non-finite) point is a filled gap, not a measurement — subtracting one would
 * manufacture a huge fake Δ. Ignoring them keeps this tile correct whether the hook zero-fills or
 * omits, without either tile having to know which.
 */
function isMeasured(point: OverviewPoint): boolean {
  return Number.isFinite(point.value) && point.value > 0;
}

/**
 * Rank servers by |Δ| between their last two MEASURED points. Pure, so it is unit-tested without
 * rendering. A server with fewer than two measured points yields no mover (no comparable baseline);
 * a Δ of exactly 0 yields no mover either (nothing moved).
 */
export function deriveMovers(perServer: FootprintData["perServer"]): Mover[] {
  const movers: Mover[] = [];
  for (const series of perServer) {
    const measured = series.points
      .filter(isMeasured)
      .slice()
      .sort((a, b) => Date.parse(a.bucketStart) - Date.parse(b.bucketStart));
    const current = measured[measured.length - 1];
    const previous = measured[measured.length - 2];
    if (!current || !previous) continue;
    const deltaTokens = current.value - previous.value;
    if (deltaTokens === 0) continue;
    movers.push({
      serverId: series.serverId,
      serverName: series.serverName,
      currentTokens: current.value,
      deltaTokens,
    });
  }
  return movers.sort((a, b) => Math.abs(b.deltaTokens) - Math.abs(a.deltaTokens));
}

/** Servers present in the window with no comparable baseline — counted, never ranked. */
export function countFirstMeasured(perServer: FootprintData["perServer"]): number {
  return perServer.filter((series) => series.points.filter(isMeasured).length === 1).length;
}

/**
 * "Diff this server against its previous scan".
 *
 * `features/scans/scanDelta.tsx`'s `diffVsPreviousHref` pins both scan ids — but `FootprintData`
 * carries no scan ids, and fabricating them is not an option. The compare workspace's own
 * documented default for `?serverA=` alone is exactly this diff:
 * `serverB` falls back to `serverA`, scan A to the server's second-newest successful scan and scan B
 * to its newest (`features/compare/CompareView.tsx`). So the link states the server and lets the
 * workspace resolve the pair it already resolves for a same-server deep link.
 */
export function moverDiffHref(serverId: string): string {
  const params = new URLSearchParams({ serverA: serverId, serverB: serverId });
  return `/compare/scans?${params.toString()}`;
}

export function MoversTile({ section, onRetry }: MoversTileProps) {
  // Nothing measured at all → the tile removes itself (the bento never shows an empty box).
  if (isEmptySection(section)) return null;

  // A window with no scan in it has nothing that MOVED in it. Unlike the fleet's footprint — a
  // standing measurement that survives a quiet week — movement is genuinely an event: it happened at
  // a time, or it did not. So this tile (and only this tile) still steps aside, and the figures a
  // quiet window must not hide stay on the hero and the startup-cost KPI.
  if (section.state === "ready" && section.data?.noActivityInWindow === true) return null;

  const movers =
    section.state === "ready" && section.data ? deriveMovers(section.data.perServer) : [];
  // A settled section whose servers all held steady (or were all first-measured) has no movers to
  // rank. "Nothing moved" is not news the way "nothing needs you" is — self-hide.
  if (section.state === "ready" && movers.length === 0) return null;

  return (
    // `min-h-0` for the same reason `AttentionTile` carries it: the ranked list below owns its own
    // scroll, and without it the flex column's automatic minimum size lets the rows push past the
    // tile's grid row, where the item's `overflow-hidden` clips them with nothing to scroll.
    <BentoGridItem size="md" className="min-h-0 gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionCardTitle className="min-w-0 truncate">Biggest movers</SectionCardTitle>
        <Text variant="meta" tone="muted" className="whitespace-nowrap">
          Largest token change in this window
        </Text>
      </header>
      <MoversBody section={section} movers={movers} onRetry={onRetry} />
    </BentoGridItem>
  );
}

function MoversBody({ section, movers, onRetry }: MoversTileProps & { movers: Mover[] }) {
  if (section.state === "loading") {
    // Layout-shaped placeholder sized like the rows it replaces — never a spinner that collapses
    // the tile (.claude/rules/loading-states.md).
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (section.state === "error") {
    return (
      <InlineError
        level={3}
        title="Couldn’t load footprint movers"
        detail={section.error ?? undefined}
        onRetry={onRetry}
      />
    );
  }

  const data = section.data;
  if (!data) return null;

  const shown = movers.slice(0, MAX_ROWS);
  const firstMeasured = countFirstMeasured(data.perServer);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ul
        aria-label="Servers whose footprint moved most"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {shown.map((mover) => (
          <li
            key={mover.serverId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-b py-2 first:pt-0 last:border-b-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Real router link — keyboard reachable, and the name itself is the drill-in. */}
              <Button
                asChild
                variant="link"
                size="sm"
                className="h-auto min-w-0 justify-start p-0 font-medium"
              >
                <Link to={`/servers/${mover.serverId}`}>
                  <span className="min-w-0 truncate">{mover.serverName}</span>
                </Link>
              </Button>
              <Text variant="meta" tone="muted" className="tabular-nums">
                {`${formatNumber(mover.currentTokens)} tokens now`}
              </Text>
            </div>
            {/* The app's ONE magnitude-delta rendering — tone decided by `lib/delta.ts`, not here. */}
            <ScanDeltaCell delta={mover.deltaTokens} />
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={moverDiffHref(mover.serverId)}
                  aria-label={`Diff ${mover.serverName} against its previous scan`}
                >
                  <GitCompareArrows aria-hidden />
                  <span>Diff</span>
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to={`/servers/${mover.serverId}`} aria-label={`Open ${mover.serverName}`}>
                  <span>Open</span>
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {firstMeasured > 0 ? (
        // The servers the ranking could not include, stated rather than silently dropped.
        <Text variant="meta" tone="muted" className="shrink-0 text-pretty tabular-nums">
          {`${formatNumber(firstMeasured)} ${
            firstMeasured === 1 ? "server was" : "servers were"
          } measured once in this window — no movement to compare yet.`}
        </Text>
      ) : null}
    </div>
  );
}
