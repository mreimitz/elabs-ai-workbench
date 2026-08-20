import { useMemo, type ReactNode } from "react";
import { FileText, Library, MessageSquare, Server } from "lucide-react";
import { Sparkline } from "@elabs-ai/components-charts";
import { BentoGridItem, Text } from "@elabs-ai/components-ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { MetricDelta } from "../../../../components/MetricDelta";
import { SectionCardTitle } from "../../../../components/SectionCardTitle";
import { chartSeriesColor } from "../../../../lib/chart-colors";
import { formatNumber } from "../../../../lib/format";
import { buildScanDeltaIndex } from "../../../scans/scanDelta";
import {
  buildTileTrend,
  promptCountOf,
  rankedServerScans,
  resourceCountOf,
  type TileTrend,
  toolCountOf,
} from "./scan-tile-data";

/**
 * InventoryTile — the fleet's scan inventory as ONE 2×1 bento tile (dashboard-bento WP 2.1).
 * =============================================================================================
 * Owner feedback 2026-08-20: *"Overview and scans can be merged … Bring the Measure tiles with
 * graph over to the Overview tab, enhance them so they look better."*
 *
 * `ScansTab.tsx` spent four separate `MetricCard`s on **Servers · Tools scanned · Resources ·
 * Prompts** — four counts of one fleet, each in its own box. They are one statement, so they are one
 * tile here: a 2×2 of figures, each with its own trend line, over the same population (the latest
 * SUCCESSFUL scan of every server — see `scan-tile-data.ts`, which the footprint table shares so the
 * two can never disagree).
 *
 * ── WHAT "ENHANCE THEM" MEANT, CONCRETELY ────────────────────────────────────────────────────────
 * The old tiles rendered `Sparkline`'s **80×20 default** — a thumbnail adrift in a card several
 * times its width (the owner's actual complaint, confirmed in the browser). Two things fix it, and
 * the second is the one that is easy to miss:
 *
 *   1. `className="h-6 w-full"` — the SVG's CSS box now spans the figure's column.
 *   2. `preserveAspectRatio="none"` **with a viewBox sized to the real box** (`width={320}
 *      height={24}`). Without this the SVG box would grow while the *drawing* kept its 4:1 aspect
 *      and letterboxed itself in the middle — the same thumbnail, now centred in a wider frame.
 *      The cost is honest: a non-uniform scale slightly thickens steep segments. That is why
 *      `emphasizeLast` is OFF here — the vendored `Sparkline` draws that marker as `circle r=2`,
 *      which a non-uniform scale turns into an ellipse (and hard-codes to `var(--chart-1)`, which
 *      would clash with a line on any other ramp slot).
 *
 * Each trend line owns one ramp slot via `chartSeriesColor` (`lib/chart-colors.ts` — the one place a
 * `--chart-N` is derived; a colour that is not a `var(--chart-N)` reference is silently ignored by
 * `@elabs-ai/components-charts`), so the three series are told apart at a glance instead of being
 * three identical grey lines.
 *
 * ── THREE THINGS THIS TILE REFUSES TO INVENT ─────────────────────────────────────────────────────
 * 1. **"Servers" carries no trend, deliberately.** It counts configuration rows. Server deletions
 *    are not recorded anywhere the app persists, so an earlier count cannot be reconstructed — only
 *    invented. `ScansTab` made that call and it still holds; a fourth sparkline here would be a
 *    fabrication, which the WP forbids outright. The figure is stated; nothing is claimed about its
 *    history.
 * 2. **A missing Δ is not a zero.** `TileTrend.delta === null` means no server had an earlier
 *    successful scan to compare against, so NO delta node renders — never a "+0" that reads as
 *    "nothing moved".
 * 3. **The sparkline is normalised; the LABEL keeps the real figures.** `Sparkline` is
 *    ZERO-baselined (`max = Math.max(...values, 0)`, there is no min — verified in the package
 *    source), so handing it absolute totals draws a realistic 580 → 590 series as a flat line inside
 *    a 0..590 box. Each series is shifted to its own window minimum so the variation spends the full
 *    height, and the accessible label states the REAL first → last figures.
 *
 * ── GROWTH IS THE REGRESSION ─────────────────────────────────────────────────────────────────────
 * Tools, resources and prompts are all startup context the model pays for on every request, so a
 * RISE is unfavorable — the `positiveIsGood={false}` polarity `MetricCard` expresses. These figures
 * are not `MetricCard`s (four of them do not fit a 14 rem bento row: `p-5` + `space-y-2` alone is
 * ~68 px of chrome per card), so the polarity is derived from `lib/delta.ts` — the app's ONE
 * magnitude-delta tone authority (D-IC3: "no view maps a delta sign → colour inline") — and stamped
 * into `data-polarity` with the same `good`/`bad`/`neutral` vocabulary and the same
 * `"<direction> <delta>, <favorable|unfavorable>"` accessible label `MetricCard` emits, so the two
 * are indistinguishable to a test, an audit or a screen reader.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour;
 * reads in both themes.
 */
export type InventoryTileProps = {
  /** The app's server catalog — already in memory in `App.tsx`. */
  servers: ServerConfig[];
  /** The app's scan list, same reason. */
  scans: ScanSummary[];
};

/** One figure in the 2×2: a count, an optional trend, and the ramp slot its line is drawn on. */
type Figure = {
  key: string;
  label: string;
  icon: ReactNode;
  /** `null` renders "n/a" — there is no successful scan to count. */
  value: number | null;
  /** Absent for a figure whose history cannot be reconstructed (see "Servers" above). */
  trend?: TileTrend;
  /** 0-based series index → `chartSeriesColor`. Only meaningful with a `trend`. */
  seriesIndex?: number;
};

export function InventoryTile({ servers, scans }: InventoryTileProps) {
  // Every derivation is memoised on `scans` alone and runs BEFORE the self-hide return, so the hook
  // order is stable whether or not the tile paints.
  const ranked = useMemo(() => rankedServerScans(scans), [scans]);
  const deltaIndex = useMemo(() => buildScanDeltaIndex(scans), [scans]);
  const scanById = useMemo(() => new Map(scans.map((scan) => [scan.id, scan] as const)), [scans]);

  const trends = useMemo(() => {
    const inputs = { scans, latestByServer: ranked, deltaIndex, scanById };
    return {
      tools: buildTileTrend(inputs, toolCountOf),
      resources: buildTileTrend(inputs, resourceCountOf),
      prompts: buildTileTrend(inputs, promptCountOf),
    };
  }, [scans, ranked, deltaIndex, scanById]);

  const totals = useMemo(() => {
    let tools = 0;
    let resources = 0;
    let prompts = 0;
    for (const scan of ranked) {
      tools += toolCountOf(scan);
      resources += resourceCountOf(scan);
      prompts += promptCountOf(scan);
    }
    return { tools, resources, prompts };
  }, [ranked]);

  // Nothing configured AND nothing measured — the bento must never render an empty box.
  if (servers.length === 0 && ranked.length === 0) return null;

  const measured = ranked.length > 0;
  const figures: Figure[] = [
    {
      key: "servers",
      label: "Servers",
      icon: <Server aria-hidden />,
      // No trend — see "THREE THINGS THIS TILE REFUSES TO INVENT" #1.
      value: servers.length,
    },
    {
      key: "tools",
      label: "Tools scanned",
      icon: <FileText aria-hidden />,
      value: measured ? totals.tools : null,
      trend: trends.tools,
      seriesIndex: 0,
    },
    {
      key: "resources",
      label: "Resources",
      icon: <Library aria-hidden />,
      value: measured ? totals.resources : null,
      trend: trends.resources,
      seriesIndex: 1,
    },
    {
      key: "prompts",
      label: "Prompts",
      icon: <MessageSquare aria-hidden />,
      value: measured ? totals.prompts : null,
      trend: trends.prompts,
      seriesIndex: 2,
    },
  ];

  // The same population is behind all three trend figures, so the "measured for the first time"
  // disclosure is stated ONCE for the tile rather than repeated under each line.
  const firstTimeServers = trends.tools.firstTimeServers;

  return (
    <BentoGridItem size="md" className="gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionCardTitle className="min-w-0 truncate">Fleet inventory</SectionCardTitle>
        <Text variant="meta" tone="muted" className="whitespace-nowrap">
          Latest successful scans
        </Text>
      </header>

      {/*  Two columns, never four. A 4-across row would be ~90 px per figure inside a 2-column bento
           tile at `lg` — the "four cramped columns" the WP calls out. Two columns hold at every
           width the grid produces: the tile is full-page-width at `sm` and below (the bento clamps
           every col span to 1), and ~half the content width at `lg`. `min-w-0` on every cell is what
           lets the labels truncate instead of blowing the tile out. */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto">
        {figures.map((figure) => (
          <FigureCell key={figure.key} figure={figure} />
        ))}
      </div>

      {firstTimeServers > 0 ? (
        <Text variant="meta" tone="muted" className="shrink-0">
          {firstTimeServers === 1
            ? "Includes 1 server measured for the first time"
            : `Includes ${formatNumber(firstTimeServers)} servers measured for the first time`}
        </Text>
      ) : null}
    </BentoGridItem>
  );
}

function FigureCell({ figure }: { figure: Figure }) {
  const trend = figure.trend;
  const series = trend?.series ?? [];
  const hasSeries = series.length >= 2;
  // Normalise to the window's own minimum — `Sparkline` is zero-baselined, so absolute totals draw
  // a flat line. The label below keeps the REAL figures.
  const floor = hasSeries ? Math.min(...series) : 0;
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;

  return (
    // `data-figure` names WHICH figure this cell is, so an assertion (or an audit) can scope to one
    // of the four without depending on DOM order or on `closest()` walking an unrelated wrapper.
    <div data-figure={figure.key} className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
        {figure.icon}
        <Text variant="meta" tone="muted" className="min-w-0 truncate">
          {figure.label}
        </Text>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/* `text-title` is the 1.25 rem type rung and already carries `--text-title--font-weight:
            600`, so no weight override is needed. The `kpi` Text variant is the 2 rem rung — four of
            those do not fit a 14 rem bento row, which is exactly why this tile is not four nested
            `MetricCard`s. `tabular-nums` is required of any figure column (interaction-guidelines). */}
        <Text as="span" className="text-title tabular-nums">
          {figure.value === null ? "n/a" : formatNumber(figure.value)}
        </Text>
        <FigureDelta delta={trend?.delta ?? null} />
      </div>
      {hasSeries ? (
        <Sparkline
          values={series.map((value) => value - floor)}
          variant="line"
          // OFF on purpose — the marker is a `circle r=2` hard-coded to `var(--chart-1)`, which a
          // non-uniform scale turns into an ellipse and which would clash with any other ramp slot.
          emphasizeLast={false}
          // The viewBox matches the rendered box's aspect, and `none` stops the drawing letterboxing
          // itself in the middle of a full-width SVG (see the module doc).
          width={320}
          height={24}
          preserveAspectRatio="none"
          className="h-6 w-full"
          style={{ color: chartSeriesColor(figure.seriesIndex ?? 0) }}
          label={`${figure.label}: ${formatNumber(first)} → ${formatNumber(last)} across the last ${series.length} scans`}
        />
      ) : null}
    </div>
  );
}

/**
 * A signed inventory delta. Rendered by the shared {@link MetricDelta}, which is the app's ONE
 * magnitude-delta renderer (WP 2.2, Defect 5): it colours through `lib/delta.ts` — a rise in a
 * lower-is-better metric is amber "worse", never the success colour and never red — and reproduces
 * `MetricCard`'s own `data-polarity` + accessible-label contract verbatim, so this reads identically
 * to the `MetricCard`-based tiles beside it.
 *
 * `higherIsBetter: false` — more startup context is the regression. `null` renders NOTHING: a figure
 * with nothing to compare against says nothing, never "+0".
 */
function FigureDelta({ delta }: { delta: number | null }) {
  return (
    <MetricDelta
      delta={delta}
      higherIsBetter={false}
      format={(value) => `${value > 0 ? "+" : ""}${formatNumber(value)}`}
    />
  );
}
