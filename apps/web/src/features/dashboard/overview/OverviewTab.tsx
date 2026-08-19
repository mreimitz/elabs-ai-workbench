import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarRange, Server } from "lucide-react";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import {
  BentoGrid,
  BentoGridItem,
  type BentoGridItemProps,
  Button,
  ScrollArea,
  Skeleton,
  Text,
  ToggleGroup,
  ToggleGroupItem,
} from "@elabs-ai/components-ui";
import { TabEmptyState } from "../../../components/TabEmptyState";
import { ViewToolbar } from "../../../components/ViewToolbar";
import type { SectionEnvelope } from "./overview-contract";
import { isEmptySection } from "./overview-contract";
import {
  isOverviewPreset,
  OVERVIEW_PRESET_DESCRIPTIONS,
  OVERVIEW_PRESET_LABELS,
  OVERVIEW_PRESETS,
  type OverviewPreset,
  parseOverviewPreset,
  resolveOverviewRange,
  writeOverviewPreset,
} from "./overview-url-state";
import { AdvisorTile } from "./tiles/AdvisorTile";
import { AttentionTile } from "./tiles/AttentionTile";
import { HeroFootprintTile } from "./tiles/HeroFootprintTile";
import { MoversTile } from "./tiles/MoversTile";
import { PassRateTile } from "./tiles/PassRateTile";
import { SpendByBasisTile } from "./tiles/SpendByBasisTile";
import { StartupCostTile } from "./tiles/StartupCostTile";
import { SurfaceMixTile } from "./tiles/SurfaceMixTile";
import { useOverviewData } from "./use-overview-data";

/**
 * OverviewTab — the Dashboard's bento shell (dashboard-bento WP 1.4), and the tab `/dashboard` now
 * lands on.
 * =============================================================================================
 * This module owns exactly three things: the GRID, the WINDOW CONTROL, and the whole-tab STATES.
 * The eight tiles (WP 1.2/1.3) each declare their own `BentoGridItem` and their own size, and each
 * one self-hides when its section has nothing to say — so composing them is genuinely just
 * rendering them in the wireframe's order inside one `BentoGrid`.
 *
 * ── THE GRID IS THE LIBRARY'S, NOT OURS ───────────────────────────────────────────────────────────
 * `BentoGrid` (`@elabs-ai/components-ui`) is 1 column → 2 at `sm` → 4 at `lg`, `grid-auto-flow:
 * dense`, `auto-rows-[14rem]`. Dense flow is why the tile ORDER below is the whole layout spec: a
 * 1×1 that would leave a hole slots into the gap a 2×2 left behind, and every column span clamps
 * itself on a narrower grid (`span min(4, 2)`), which is what keeps the page free of horizontal
 * scroll at 375 px without a single media query here. Hand-rolling this grid is forbidden
 * (`library-first.md`) and would also throw that clamping away.
 *
 * `spotlight` is ON. It is the hover affordance the owner asked for, it ships with the component
 * (a cursor-following radial gradient painted by a `pointer-events-none aria-hidden` overlay), and
 * upstream suppresses it entirely under `prefers-reduced-motion` — cursor-following IS motion — so
 * enabling it here does not put motion in front of a reduced-motion reader.
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
 *   • NOTHING TO SHOW (every section settled and empty) → one centred panel with one action, NOT a
 *     grid of empty boxes. Which panel depends on a fact the tab actually has, never a guess: with
 *     no servers configured this is a first run and the action is "Add your first MCP server"; with
 *     servers configured it means nothing landed in THIS window, and the honest action is to widen
 *     it (the window control stays mounted above, so widening is one click away).
 *   • ANYTHING ELSE → the bento. A section that FAILED is not empty, so its tile renders and shows
 *     its own error; a failure can never be laundered into a reassuring empty state.
 *
 * ── WINDOW ───────────────────────────────────────────────────────────────────────────────────────
 * 24h / 7d / 30d, URL-persisted via `useSearchParams` + `{ replace: true }` (so clicking between
 * windows doesn't spam browser history), with the default kept OUT of the URL. The math and the key
 * live in `overview-url-state.ts`. The resolved window is memoised on the preset alone: it is
 * derived from `new Date()`, so recomputing it per render would hand the data hook a new `from`/`to`
 * on every pass and re-fire its fetches forever.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour.
 */
export type OverviewTabProps = {
  /** The app's server catalog, already in memory in `App.tsx` — passed so the hook doesn't refetch. */
  servers: ServerConfig[];
  /** The app's scan list, same reason. */
  scans: ScanSummary[];
  /** Drill into a server (the hero's datapoints, wired from the Dashboard host). */
  onOpenServer: (serverId: string) => void;
  /** Run a scan inline from the attention queue. Omit and the queue renders without its scan CTA. */
  onRunScan?: (serverId: string) => void;
};

/**
 * The skeleton's tile geometry — the SAME size/span sequence the real tiles declare (hero 2×2,
 * attention 1×2, two 1×1s, a 2×1, a 1×1, a 2×1, then the full-width advisor row), so the first paint
 * is the shape of the thing that is loading rather than a generic block of boxes.
 */
const SKELETON_TILES: Pick<BentoGridItemProps, "size" | "span">[] = [
  { size: "hero" },
  { size: "sm", span: { row: 2 } },
  { size: "sm" },
  { size: "sm" },
  { size: "md" },
  { size: "sm" },
  { size: "md" },
  { span: { col: 4 } },
];

export function OverviewTab({ servers, scans, onOpenServer, onRunScan }: OverviewTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const preset = parseOverviewPreset(searchParams);

  // Memoised on the PRESET, not on every render: `resolveOverviewRange` reads the clock, and a fresh
  // `from`/`to` per render would invalidate the data hook's effects on every pass.
  const range = useMemo(() => resolveOverviewRange(preset), [preset]);

  const setPreset = (next: string) => {
    if (!isOverviewPreset(next) || next === preset) return;
    setSearchParams((prev) => writeOverviewPreset(prev, next), { replace: true });
  };

  const { footprint, runHealth, attention, advisor, reload } = useOverviewData(range, {
    servers,
    scans,
  });

  const sections: SectionEnvelope<unknown>[] = [footprint, runHealth, attention, advisor];
  const firstPaint = sections.every((section) => section.state === "loading");
  const nothingToShow = sections.every((section) => isEmptySection(section));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* The window control's band. Mirrors `TestingTab`'s toolbar band exactly — the Dashboard's
          tabs have no per-tab `PageShell headerVariant="toolbar"` slot (the host owns it), so the
          band reproduces that treatment: `bg-card` + `border-b`, bled back out to the page gutter by
          negating and re-applying the SAME padding `PageShell` uses. Pinned (`shrink-0`), so the
          window stays one click away however far the bento is scrolled. */}
      <div className="-mx-4 shrink-0 border-b border-border bg-card px-4 py-2 min-[1200px]:-mx-8 min-[1200px]:px-8">
        <ViewToolbar
          info="Fleet footprint, run health, what needs you, and the top recommendation — all scoped to the window you pick here."
          left={<OverviewWindowControl preset={preset} onChange={setPreset} />}
          results={<span>Showing {OVERVIEW_PRESET_DESCRIPTIONS[preset]}</span>}
        />
      </div>

      {nothingToShow ? (
        <div className="min-h-0 flex-1">
          {servers.length === 0 ? (
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
          ) : (
            <TabEmptyState
              icon={<CalendarRange aria-hidden />}
              title="Nothing in this window"
              description={`No scans, runs or open issues landed in ${OVERVIEW_PRESET_DESCRIPTIONS[preset]}. Widen the window above, or scan a server to measure it now.`}
              actions={
                <Button asChild variant="outline">
                  <Link to="/servers">Go to servers</Link>
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {/* `pr-3` keeps the last column clear of the scrollbar; `pb-4` gives the final row the same
              breathing room the page gutter gives the first. */}
          <div className="pr-3 pb-4">
            {firstPaint ? (
              <OverviewBentoSkeleton />
            ) : (
              <BentoGrid spotlight>
                {/* Wireframe order. Dense flow + each tile's own size IS the layout — see the doc. */}
                <HeroFootprintTile section={footprint} onOpenServer={onOpenServer} />
                <AttentionTile section={attention} onRunScan={onRunScan} onRetry={reload} />
                <StartupCostTile section={footprint} />
                <PassRateTile section={runHealth} />
                <SpendByBasisTile section={runHealth} />
                <SurfaceMixTile section={footprint} />
                <MoversTile section={footprint} onRetry={reload} />
                <AdvisorTile section={advisor} onRetry={reload} />
              </BentoGrid>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/**
 * The 24h / 7d / 30d control. A bare segmented `ToggleGroup` with the group's name carried by
 * `aria-label` and an `aria-hidden` muted prefix for sighted readers — the same shape
 * `FilterControls`' "Suite:" / "Group by:" controls settled on after audit finding C-1, where
 * label-ABOVE stacks dropped into an `items-center` toolbar row floated their controls off the
 * row's baseline. The visible segment text IS the accessible name (no `aria-label` override), so
 * "label in name" holds.
 */
function OverviewWindowControl({
  preset,
  onChange,
}: {
  preset: OverviewPreset;
  onChange: (next: string) => void;
}) {
  return (
    <>
      <Text as="span" variant="meta" tone="muted" aria-hidden>
        Window:
      </Text>
      <ToggleGroup
        type="single"
        variant="segmented"
        size="sm"
        value={preset}
        aria-label="Overview window"
        className="shrink-0"
        onValueChange={(next) => {
          // Radix emits "" when the already-active segment is re-clicked — keep the choice sticky.
          if (next) onChange(next);
        }}
      >
        {OVERVIEW_PRESETS.map((option) => (
          <ToggleGroupItem key={option} value={option}>
            {OVERVIEW_PRESET_LABELS[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </>
  );
}

/**
 * First-paint placeholder: the real `BentoGrid` with the real tile geometry, each cell filled by a
 * `Skeleton`. Marked `aria-hidden` because it carries no information — the single `sr-only` live
 * line above it is what a screen-reader user should hear, not eight empty boxes.
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
