import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarRange, Server } from "lucide-react";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import {
  BentoGrid,
  BentoGridItem,
  type BentoGridItemProps,
  Button,
  ScrollArea,
  Skeleton,
  StatePanel,
} from "@elabs-ai/components-ui";
import { TabEmptyState } from "../../../components/TabEmptyState";
import type { DashboardRange } from "../dashboard-range";
import type { OverviewRange, SectionEnvelope } from "./overview-contract";
import { isEmptySection } from "./overview-contract";
import { AdvisorTile } from "./tiles/AdvisorTile";
import { AttentionTile } from "./tiles/AttentionTile";
import { FootprintTableTile } from "./tiles/FootprintTableTile";
import { HeroFootprintTile } from "./tiles/HeroFootprintTile";
import { InventoryTile } from "./tiles/InventoryTile";
import { LargestToolTile } from "./tiles/LargestToolTile";
import { MoversTile } from "./tiles/MoversTile";
import { PassRateTile } from "./tiles/PassRateTile";
import { RecentScansTile } from "./tiles/RecentScansTile";
import { SpendByBasisTile } from "./tiles/SpendByBasisTile";
import { StartupCostTile } from "./tiles/StartupCostTile";
import { SurfaceMixTile } from "./tiles/SurfaceMixTile";
import { useOverviewData } from "./use-overview-data";

/**
 * OverviewTab — the Dashboard's bento (dashboard-bento WP 1.4, merged with the retired Scans tab in
 * WP 2.2). This is the tab `/dashboard` lands on, and since WP 2.2 it is the ONLY home for the
 * fleet's scan story.
 * =============================================================================================
 * This module owns exactly two things now: the GRID and the whole-tab STATES. Each tile declares its
 * own `BentoGridItem`, its own size, and self-hides when its section has nothing to say — so
 * composing them is genuinely just rendering them in the wireframe's order inside one `BentoGrid`.
 *
 * ── WHAT WP 2.2 CHANGED HERE ─────────────────────────────────────────────────────────────────────
 * 1. **The window control left.** It used to be a preset-only `ToggleGroup` in a `bg-card` band
 *    pinned inside this tab — a toolbar BELOW the tab strip, which is the inversion of the app's
 *    written order (breadcrumb → ONE toolbar row → content;
 *    `roadmap/ux-overhaul/toolbar-standard-2026-07-11.md`, and `SkillInspector.tsx:538` as the built
 *    reference). The range now lives in ONE page-level `ViewToolbar` above the tab strip
 *    (`DashboardView`), is a richer preset+calendar control, and scopes the Testing and Issues tabs
 *    too. This tab simply RECEIVES the resolved window.
 * 2. **The Scans tab merged in.** `InventoryTile` and `LargestToolTile` join the metric tiles, and
 *    `FootprintTableTile` + `RecentScansTile` sit full-width at the bottom (owner, 2026-08-20:
 *    *"the two tables can be at the bottom end of the bento with full width grid size"*).
 * 3. **The spotlight is gone.** Owner: *"the Bento shows a yellow shade around the cursor, we dont
 *    want that effect. elevation is good, the shadow not."* Upstream's `spotlight` overlay is a
 *    cursor-following `radial-gradient(… color-mix(in oklch, var(--primary) …))` — the brand lime,
 *    i.e. the yellow shade. It is opt-in per grid, so simply not passing it removes the overlay
 *    entirely (`BentoGrid`'s `spotlight` defaults to `false`). `BentoGridItem`'s ordinary hover
 *    ELEVATION is a separate, always-on behaviour of the component and is untouched.
 *
 * ── THE GRID IS THE LIBRARY'S, NOT OURS ───────────────────────────────────────────────────────────
 * `BentoGrid` (`@elabs-ai/components-ui`) is 1 column → 2 at `sm` → 4 at `lg`, `grid-auto-flow:
 * dense`, `auto-rows-[14rem]`. Dense flow is why the tile ORDER below is the whole layout spec: a
 * 1×1 that would leave a hole slots into the gap a 2×2 left behind, and every column span clamps
 * itself on a narrower grid (`span min(4, 2)`), which is what keeps the page free of horizontal
 * scroll at 375 px without a single media query here. Hand-rolling this grid is forbidden
 * (`library-first.md`) and would also throw that clamping away.
 *
 * The two full-width tables come LAST on purpose: dense flow will happily pull a later small tile
 * into an earlier hole, but it never re-orders a tile that spans the full four columns, so "at the
 * bottom" is guaranteed by their position in this list plus their `col: 4` span.
 *
 * ── THREE WHOLE-TAB STATES, AND WHY THEY ARE NOT THE TILES' STATES ────────────────────────────────
 * Each of the four contract sections settles independently, so the tab's own states are joins:
 *
 *   • FIRST PAINT (every section still `loading`) → a layout-shaped skeleton built from the SAME
 *     `BentoGrid`/`BentoGridItem` sizes the real bento uses, so the arriving tiles land where the
 *     placeholders were instead of the page snapping (`.claude/rules/loading-states.md` — never a
 *     spinner that collapses the grid). As soon as ONE section is ready the real bento takes over
 *     and each still-loading tile shows its OWN placeholder, which is the "build the content up"
 *     half of the same rule.
 *   • NOTHING MEASURED YET (every section settled empty AND no fleet at all — no servers, no scans)
 *     → one centred panel with one action, NOT a grid of empty boxes. This is a first run, so the
 *     action is "Add your first MCP server".
 *   • A QUIET WINDOW (every section settled empty but the fleet DOES exist) → the bento still
 *     renders, with a full-width "Nothing in this window" notice as its top row. This is the WP 2.2
 *     correction: the four scan tiles are window-INDEPENDENT, so removing the whole grid because
 *     nobody ran a test in the last 24 hours would hide the fleet's measured footprint behind a
 *     panel claiming there is nothing to see.
 *   • ANYTHING ELSE → the bento. A section that FAILED is not empty, so its tile renders and shows
 *     its own error; a failure can never be laundered into a reassuring empty state.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour.
 */
export type OverviewTabProps = {
  /** The page's shared time range (`DashboardView` owns it; Testing and Issues read the same one). */
  range: DashboardRange;
  /** The app's server catalog, already in memory in `App.tsx` — passed so the hook doesn't refetch. */
  servers: ServerConfig[];
  /** The app's scan list, same reason. */
  scans: ScanSummary[];
  /** Drill into a server (the hero's datapoints, wired from the Dashboard host). */
  onOpenServer: (serverId: string) => void;
  /** Open one scan's detail (the recent-activity table). */
  onOpenScan: (scanId: string) => void;
  /** Run a scan inline from the attention queue. Omit and the queue renders without its scan CTA. */
  onRunScan?: (serverId: string) => void;
};

/**
 * The skeleton's tile geometry — the SAME size/span sequence the real tiles declare (hero 2×2,
 * attention 1×2, two 1×1s, a 2×1, two 1×1s, a 2×1, a 2×1, then the three full-width rows), so the
 * first paint is the shape of the thing that is loading rather than a generic block of boxes.
 */
const SKELETON_TILES: Pick<BentoGridItemProps, "size" | "span">[] = [
  { size: "hero" },
  { size: "sm", span: { row: 2 } },
  { size: "sm" },
  { size: "sm" },
  { size: "md" },
  { size: "sm" },
  { size: "sm" },
  { size: "md" },
  { size: "md" },
  { span: { col: 4 } },
  { span: { col: 4 } },
  { span: { col: 4 } },
];

export function OverviewTab({
  range,
  servers,
  scans,
  onOpenServer,
  onOpenScan,
  onRunScan,
}: OverviewTabProps) {
  // The contract's own window shape, derived from the page range. Memoised on the two instants (not
  // the object identity) so a host re-render can't hand the data hook a "new" window and re-fire
  // every fetch on every pass.
  const overviewRange = useMemo<OverviewRange>(
    () => ({ from: range.from, to: range.to, preset: range.preset }),
    [range.from, range.to, range.preset],
  );

  const { footprint, runHealth, attention, advisor, reload } = useOverviewData(overviewRange, {
    servers,
    scans,
  });

  const sections: SectionEnvelope<unknown>[] = [footprint, runHealth, attention, advisor];
  const firstPaint = sections.every((section) => section.state === "loading");
  const windowIsEmpty = sections.every((section) => isEmptySection(section));
  // The four scan tiles (WP 2.1) are NOT contract sections — they read `servers`/`scans` straight
  // from the host and are deliberately window-independent (a fleet's startup footprint does not stop
  // being true because nobody scanned this week). So "there is genuinely nothing here" means the
  // metrics sections settled empty AND there is no fleet to inventory either.
  const hasFleet = servers.length > 0 || scans.length > 0;
  const nothingAtAll = windowIsEmpty && !hasFleet;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {nothingAtAll ? (
        <div className="min-h-0 flex-1">
          <TabEmptyState
            icon={<Server aria-hidden />}
            title="Nothing measured yet"
            description="Connect an MCP server and scan it — its startup footprint, run health and recommendations all appear here once there is something to measure."
            actions={
              <Button asChild>
                <Link to="/servers">Add your first MCP server</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {/* `pr-3` keeps the last column clear of the scrollbar; `pb-4` gives the final row the same
              breathing room the page gutter gives the first. */}
          <div className="pr-3 pb-4">
            {firstPaint ? (
              <OverviewBentoSkeleton />
            ) : (
              <BentoGrid>
                {/* Wireframe order. Dense flow + each tile's own size IS the layout — see the doc. */}
                {windowIsEmpty ? <QuietWindowTile description={range.description} /> : null}
                <HeroFootprintTile section={footprint} onOpenServer={onOpenServer} />
                <AttentionTile section={attention} onRunScan={onRunScan} onRetry={reload} />
                <StartupCostTile section={footprint} />
                <PassRateTile section={runHealth} />
                <SpendByBasisTile section={runHealth} />
                <SurfaceMixTile section={footprint} />
                {/* WP 2.1's scan tiles — the merged Scans tab's "Measure" figures. */}
                <LargestToolTile scans={scans} />
                <InventoryTile servers={servers} scans={scans} />
                <MoversTile section={footprint} onRetry={reload} />
                <AdvisorTile section={advisor} onRetry={reload} />
                {/* The two full-width tables, at the bottom (owner, 2026-08-20). */}
                <FootprintTableTile servers={servers} scans={scans} onOpenServer={onOpenServer} />
                <RecentScansTile scans={scans} onOpenScan={onOpenScan} />
              </BentoGrid>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/**
 * Nothing landed in the chosen window — said IN the bento rather than instead of it.
 *
 * Before WP 2.2 this was the whole tab: every contract section empty removed the grid and left one
 * centred panel. That is no longer honest, because the scan tiles beside it are window-INDEPENDENT
 * and usually do have something to show; hiding a fleet's whole measured footprint because nobody
 * ran a test in the last 24 hours would be exactly the kind of quiet lie this plan exists to remove.
 * So the notice takes the full-width top row of the grid and the rest of the bento stands.
 */
function QuietWindowTile({ description }: { description: string }) {
  return (
    <BentoGridItem span={{ col: 4 }} className="p-4">
      <StatePanel
        kind="empty"
        size="sm"
        icon={<CalendarRange aria-hidden />}
        title="Nothing in this window"
        description={`No scans, runs or open issues landed in ${description}. Widen the range in the toolbar above, or scan a server to measure it now.`}
        className="h-full justify-center"
      />
    </BentoGridItem>
  );
}

/**
 * First-paint placeholder: the real `BentoGrid` with the real tile geometry, each cell filled by a
 * `Skeleton`. Marked `aria-hidden` because it carries no information — the single `sr-only` live
 * line above it is what a screen-reader user should hear, not a dozen empty boxes.
 */
function OverviewBentoSkeleton() {
  return (
    <div aria-busy="true">
      <output className="sr-only" aria-live="polite">
        Loading the fleet overview…
      </output>
      <BentoGrid aria-hidden>
        {SKELETON_TILES.map((tile, index) => (
          <BentoGridItem key={index} {...tile} className="p-4">
            <Skeleton data-testid="overview-skeleton-cell" className="h-full w-full" />
          </BentoGridItem>
        ))}
      </BentoGrid>
    </div>
  );
}
