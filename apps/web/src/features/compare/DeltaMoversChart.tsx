import { useMemo } from "react";
import { ChartCard, DumbbellChart } from "@elabs-ai/components-charts";
import { formatNumber } from "../../lib/format";

/**
 * The compare workspace's **movers** chart — the before/after token change per entity, drawn so the
 * CHANGE is the mark rather than a second bar (RM-39 WP 4.2b).
 *
 * WHY THIS EXISTS. The diff tabs have always rendered their per-entity token deltas as table rows
 * with a badge and nothing else: exact, sortable, and completely silent about shape. "Which tool
 * moved, and by how much relative to the others" was a question a reader had to answer by reading
 * a column of numbers. brand-ui 4.1.0 shipped `DumbbellChart`, whose stated purpose is exactly this
 * comparison — a track per category with two markers and the delta between them — and its
 * `sortBy="delta"` (descending by MAGNITUDE, sign ignored) is the order `sortByImpact` in
 * `CompareView` already puts the rows in. No wire change, no new data.
 *
 * WHAT IT DELIBERATELY IS NOT. It is not the diff. The table below it stays the record: every row,
 * exact figures, filters, search, and the accessible content. This draws the **top few movers only**
 * — `DumbbellChart`'s own anti-patterns warn that `showDelta` "sits fixed beside the end marker with
 * no collision avoidance", so a chart of forty rows would overlap its own labels into noise. The
 * cap is stated in the description rather than left for the reader to infer, because a chart that
 * silently truncates is a chart that lies.
 *
 * READING THE MARKS. Hollow marker = the BEFORE scan, filled = the AFTER scan — `DumbbellChart`'s
 * default `{ start: "hollow", end: "filled" }`, which is the pairing its own docs call "the F12
 * before/after read". An added entity therefore starts at zero and a removed one ends there; both
 * are honest tracks, not special cases.
 */

/** The subset of a `DiffRow` this chart reads — kept structural so `CompareView` owns the full type. */
export type DeltaMoverRow = {
  label: string;
  beforeTokens: number;
  afterTokens: number;
  deltaTokens: number;
  /** `"unchanged"` rows are excluded before drawing — a flat track is not a mover. */
  change: string;
};

/**
 * How many tracks the chart draws.
 *
 * Six, not "all", and not the eight this started at. `DumbbellChart` places its signed delta label
 * beside the end marker with no collision avoidance of its own, so row count is bounded by
 * legibility rather than by data. Six was chosen by MEASURING the rendered chart, not by taste: at
 * a 1600px viewport the card is ~1200px wide, `aspectRatio` "3 / 1" makes the plot ~400px tall, and
 * six tracks land ~66px apart — comfortably clear of their own delta labels. Eight in the same box
 * crowds to ~50px, and eight at the DEFAULT "2 / 1" ratio drew a 625px-tall SVG that the card's
 * body clipped outright (only four tracks survived on screen).
 */
export const MOVERS_LIMIT = 6;

/** Rows worth drawing: a real change, biggest absolute mover first, capped at {@link MOVERS_LIMIT}. */
export function selectMovers(rows: readonly DeltaMoverRow[]): DeltaMoverRow[] {
  return rows
    .filter((row) => row.change !== "unchanged" && row.deltaTokens !== 0)
    .sort((left, right) => Math.abs(right.deltaTokens) - Math.abs(left.deltaTokens))
    .slice(0, MOVERS_LIMIT);
}

/** `+1,240` / `-980` — the sign is carried in the text, never by colour alone. */
function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

/**
 * The card's title, written as the CONCLUSION rather than the chart type (`ChartCard`'s own
 * contract: "Revenue is up 8% QoQ", not "Revenue chart"). The biggest mover and its signed delta
 * ARE the conclusion here, so the title states them.
 */
export function moversTitle(movers: readonly DeltaMoverRow[], entityLabel: string): string {
  const top = movers[0];
  if (!top) return `No ${entityLabel} changed size`;
  return `${top.label} moved most — ${signed(top.deltaTokens)} tokens`;
}

/**
 * The prose that IS the legend (`ChartCard`'s contract again — what a reader needs to read the chart
 * correctly, as a sentence). It states the marker pairing AND the truncation, because the cap is a
 * property of the picture, not of the data.
 */
export function moversDescription(
  movers: readonly DeltaMoverRow[],
  changedCount: number,
  entityLabel: string,
): string {
  const shown = movers.length;
  const scope =
    changedCount > shown
      ? `The ${shown} biggest movers of ${formatNumber(changedCount)} changed ${entityLabel}s`
      : `All ${formatNumber(shown)} changed ${entityLabel}${shown === 1 ? "" : "s"}`;
  // "By size of change, up or down" is not padding. The chart orders by MAGNITUDE while the table
  // beneath it defaults to the SIGNED delta, so the two lists legitimately disagree about what comes
  // fourth. Saying which order this one uses is cheaper than making them agree and losing the
  // "biggest mover" reading the chart exists for.
  return `${scope}, ordered by size of change, up or down. Each track runs from the earlier scan (hollow) to the later one (filled); the label is the signed token change.`;
}

export type DeltaMoversChartProps = {
  /** The tab's rows, pre-filter — this component does its own selection so the cap is one decision. */
  rows: readonly DeltaMoverRow[];
  /** "tool" / "resource" / "prompt" — the noun used in the title, description and accessible name. */
  entityLabel: string;
};

/**
 * Renders nothing when no entity changed size. That is deliberate: an empty chart card reads as a
 * broken chart, and the table below already carries a real empty state for a zero-diff comparison.
 */
export function DeltaMoversChart({ rows, entityLabel }: DeltaMoversChartProps) {
  const movers = useMemo(() => selectMovers(rows), [rows]);
  const changedCount = useMemo(
    () => rows.filter((row) => row.change !== "unchanged" && row.deltaTokens !== 0).length,
    [rows],
  );

  if (movers.length === 0) return null;

  const description = moversDescription(movers, changedCount, entityLabel);

  return (
    <ChartCard
      title={moversTitle(movers, entityLabel)}
      description={description}
      // Tracks the plot's own height (see `aspectRatio` below) plus room for the axis feet, so the
      // card reserves what the chart actually draws instead of clipping it.
      height={420}
      className="shrink-0"
    >
      <DumbbellChart
        data={movers as unknown as Record<string, unknown>[]}
        category="label"
        startKey="beforeTokens"
        endKey="afterTokens"
        // Height comes from the chart's OWN aspect ratio, not from the card — a `ChartCard height`
        // does not shrink an SVG that has already sized itself, which is how the first cut ended up
        // 625px tall inside a 355px slot with half its tracks cut off. "3 / 1" keeps the plot near
        // 400px at a normal window width.
        aspectRatio="3 / 1"
        // MCP tool names are long (`compatibility_findings`, `workbench_export_bundle`). The default
        // left margin put the first label 25px OUTSIDE the SVG box, clipping the START of the name —
        // worse than clipping the end, because the beginning is what distinguishes them.
        margin={{ left: 190 }}
        // The rows arrive already ordered by magnitude; saying so keeps the chart's order the
        // table's order even if a caller ever hands them in a different one.
        sortBy="delta"
        showDelta
        accessibleLabel={`Token change per ${entityLabel}, biggest movers first`}
        // The SVG is aria-hidden, so the counts and the reading instructions have to travel here —
        // this is the same sentence the sighted reader gets from the card description.
        accessibleDescription={description}
      />
    </ChartCard>
  );
}
