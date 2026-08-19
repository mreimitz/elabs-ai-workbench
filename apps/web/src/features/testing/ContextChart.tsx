import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ContextSnapshot,
  ContextSegment,
  RunOutcome,
  RunStep,
} from "@mcp-token-footprint/shared";
import { CONTEXT_SEGMENTS } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { BarChart, BarXAxis, Bar, Grid, ChartTooltip, type TooltipRow } from "@elabs-ai/components-charts";
import { AlertTriangle, LineChart } from "lucide-react";
import { chartSeriesColor } from "../../lib/chart-colors";
import { formatNumber } from "../../lib/format";

/**
 * Context-window chart (UI §4 Zone B / inspector doc 12 §3.3 Timeline track) — the feature's
 * centerpiece. A per-step **stacked column** timeline: X = run progress (step/turn index), Y = tokens,
 * each column split by composition (`system / tool_defs / history / tool_results / output`). A
 * horizontal **limit line** at the model's context max + a **utilisation % badge**; the **overflow
 * point** is marked with the destructive token when `outcome === "context_overflow"`. Hovering a
 * column reveals its composition breakdown. The chart **starts from the turn-0 baseline** (system +
 * tool defs) so the static footprint shows before the model speaks.
 *
 * ## Built on `@elabs-ai/components-charts` (WP 0.1; doc 12 §3.3 — "no fallback needed")
 * `@elabs-ai/components-charts` v1.5.0 is **vendored**, so this is the real thing, not a hand-rolled renderer:
 * - **Stacked columns** = `<BarChart stacked xDataKey="step">` (the categorical/step-indexed chart,
 *   per `BarChartProps.xDataKey` "the categorical axis") with one `<Bar dataKey=… fill="var(--chart-N)">`
 *   per composition segment, in `CONTEXT_SEGMENTS` order (`Bar` stacks in child order at each x).
 * - **Series → `--chart-1..5`:** each `Bar` sets `fill="var(--chart-N)"` explicitly (charts do NOT
 *   auto-assign by child order — the library examples set the token per series), so the five segments
 *   read in both light and dark.
 * - **Limit line** = `<Grid highlightRowValues={[contextLimit]} …>` (a horizontal rule at a y value;
 *   `GridProps.highlightRowValues` + `highlightRowStroke*`). Because `BarChart` derives its y-domain
 *   purely from the max stacked total (`[0, max·1.1]`, no domain override prop), we add a token-styled
 *   **headroom** spacer series (`var(--chart-segment-background)`) that fills each column up to the
 *   limit — that pins the y-domain to the limit so the rule lands at the column tops, and doubles as
 *   the unused-budget headroom. Headroom is excluded from the legend, the tooltip, and the segment
 *   colour ramp. The headroom + rule only appear once usage reaches a visible fraction of the limit
 *   (`LIMIT_VISIBLE_RATIO`) or the run overflows; otherwise — and when the limit is unknown (0) — we
 *   drop both and let the chart auto-scale to the usage peak so the composition stays readable even
 *   against a huge (e.g. 1M-token) window.
 * - **Hover composition** = `<ChartTooltip rows={…}>` returning `{ color, label, value }` `TooltipRow`s
 *   (the per-segment breakdown + the total / limit), one per real segment.
 */

const SEGMENT_LABELS: Record<ContextSegment, string> = {
  system: "System",
  tool_defs: "Tool defs",
  history: "History",
  tool_results: "Tool results",
  output: "Output",
};

/**
 * Series → chart-token map, in the `CONTEXT_SEGMENTS` wire order (its index is the ramp colour
 * index). `Bar.fill` takes a CSS token reference and the library honours `var(--chart-N)`
 * verbatim (theme-aware in both themes); we set it per series because charts does not colour bars by
 * child order automatically.
 */
const SEGMENT_FILL: Record<ContextSegment, string> = CONTEXT_SEGMENTS.reduce(
  (acc, seg, index) => ({ ...acc, [seg]: chartSeriesColor(index) }),
  {} as Record<ContextSegment, string>,
);

/**
 * Show the limit line + unused-budget headroom only once the peak usage reaches this fraction of the
 * context window. Below it, the limit (which can be 100×+ the usage for a 1M-token model) would crush
 * every real column to a sliver, so we auto-scale to the usage peak instead and let the utilisation
 * badge carry the "% used" story. The line returns the moment the run is genuinely near the budget.
 */
const LIMIT_VISIBLE_RATIO = 0.2;

/** Data key for the synthetic headroom (unused-budget) series — never a real composition segment. */
const HEADROOM_KEY = "_headroom";
/** The library's neutral chart fill token — used for the headroom so it reads as "empty budget". */
const HEADROOM_FILL = "var(--chart-segment-background)";

/**
 * The Tailwind `bg-chart-N` swatch class per segment — backed by the same `--chart-N` token the
 * `Bar.fill` uses, so legend swatches and columns are pixel-identical in both themes.
 */
const SEGMENT_SWATCH: Record<ContextSegment, string> = {
  system: "bg-chart-1",
  tool_defs: "bg-chart-2",
  history: "bg-chart-3",
  tool_results: "bg-chart-4",
  output: "bg-chart-5",
};

const LEGEND_ITEMS = CONTEXT_SEGMENTS.map((seg) => ({
  key: seg,
  label: SEGMENT_LABELS[seg],
  swatch: SEGMENT_SWATCH[seg],
}));

/** One plotted column: a context snapshot tagged with its step ordinal + the step that produced it. */
type Column = {
  /** Step `index` (per-run monotonic ordinal), or `-1` for the synthetic turn-0 baseline. */
  index: number;
  label: string;
  snapshot: ContextSnapshot;
  /**
   * WP 3.2 — the 0-based assistant-turn ordinal this column plots, or `null` for the pre-run baseline
   * and the terminal overflow column (neither is a turn). Drives the clickable "jump to turn" strip.
   */
  turnIndex: number | null;
  isBaseline: boolean;
  /**
   * The terminal overflow column (a `context_event` step). It carries a `context` snapshot like a real
   * turn, but it is NOT a turn — it has no `turnIndex` and must not be counted as one (it would read as
   * a phantom "Turn N+1" and disagree with `kpis.turns`). Marked here so it is labelled "Overflow"
   * (distinct from the turn ordinals) and excluded from the turn count.
   */
  isOverflow: boolean;
};

/** One row in the `BarChart` data array: the step label + a numeric value per segment (+ headroom). */
type ChartRow = Record<string, number | string> & { step: string };

export type ContextChartProps = {
  /** Ordered run steps from the stream; only steps carrying a `context` snapshot are plotted. */
  steps: RunStep[];
  /** Model context window (tokens), 0 when unknown — drives the limit line + the headroom spacer. */
  contextLimit: number;
  /** Turn-0 baseline snapshot (system + tool defs) shown before the first live snapshot. */
  baseline?: ContextSnapshot | null;
  /** Terminal outcome — `context_overflow` marks the wall + flips the badge to destructive. */
  outcome?: RunOutcome;
  /**
   * The single canonical current-context-tokens value (the latest `ContextSnapshot.total`, resolved
   * by `RunConsole` and shared with `KpiRail`). Drives the utilisation badge so it matches the KPI
   * headline Context %. Falls back to the latest plotted column total when not supplied.
   */
  currentContextTokens?: number;
  /**
   * WP 3.2 — reveal the chat and scroll it to a turn (0-based). Rendered as a clickable "jump to turn"
   * strip beneath the columns: `@elabs-ai/components-charts` `BarChart` exposes no per-bar click handler, so this
   * aligned, keyboard-reachable strip is the columns' click affordance. Omitted → no strip.
   */
  onSelectTurn?: (turnIndex: number) => void;
};

export function ContextChart({
  steps,
  contextLimit,
  baseline,
  outcome,
  currentContextTokens,
  onSelectTurn,
}: ContextChartProps) {
  // Throttle streaming re-renders to animation frames: the parent re-renders on every `step`/`kpi`
  // event; we coalesce those into one paint per frame so a fast run doesn't thrash layout
  // (.claude/rules/interaction-guidelines.md). We snapshot `steps` into rAF-gated local state.
  const liveColumns = useThrottledColumns(steps);

  const baselineColumn = useMemo<Column | null>(() => {
    if (!baseline) return null;
    return {
      index: -1,
      label: "Turn 0",
      snapshot: baseline,
      turnIndex: null,
      isBaseline: true,
      isOverflow: false,
    };
  }, [baseline]);

  const columns = useMemo<Column[]>(() => {
    // Drop a redundant baseline once the first real snapshot lands (it carries the same fixed
    // system/tool-def floor); keep it standalone as the pre-run footprint.
    return baselineColumn && liveColumns.length === 0 ? [baselineColumn] : liveColumns;
  }, [baselineColumn, liveColumns]);

  const isOverflow = outcome === "context_overflow";
  const lastIndex = columns.length - 1;

  // Turn columns only (exclude the terminal `context_event` overflow column, which carries a snapshot
  // but is NOT a turn). This is the count that matches the KPI rail's `kpis.turns` (= settled
  // `llm_response` steps), so the chart and the KPI tile agree by construction. The standalone turn-0
  // baseline footprint is a pre-run snapshot, not a turn either, so it doesn't inflate this count.
  const turnCount = useMemo(
    () => columns.filter((col) => !col.isOverflow && !col.isBaseline).length,
    [columns],
  );

  // Headline utilisation = the single canonical current-context value vs limit (one source shared
  // with the KPI rail — WP Acceptance "Context % matches the chart total / limit"). Fall back to the
  // latest plotted column total only if the canonical value wasn't threaded through.
  const latestTotal = columns.length > 0 ? columns[lastIndex]!.snapshot.total : 0;
  const headlineTotal = currentContextTokens ?? latestTotal;
  const utilization = contextLimit > 0 ? (headlineTotal / contextLimit) * 100 : null;

  // The peak plotted total decides whether the limit line is a useful reference. `BarChart` derives
  // its y-domain purely from the max stacked total, so the headroom spacer (below) pins it to the
  // limit. For huge windows (e.g. a 1M model used at a few thousand tokens) that pin crushes every
  // real column to a sub-pixel sliver — the chart "shows nothing". So we only pin to the limit once
  // usage is a visible fraction of it (or the run actually overflowed); below that we drop the
  // headroom and let the chart auto-scale to the usage peak, so the composition is always readable.
  const peakTotal = useMemo(
    () => columns.reduce((max, col) => Math.max(max, col.snapshot.total), 0),
    [columns],
  );
  const showLimit =
    contextLimit > 0 && (isOverflow || peakTotal >= contextLimit * LIMIT_VISIBLE_RATIO);

  const utilizationBadge = (() => {
    // No per-step context columns (the "No context yet" empty state, or a subscription run whose
    // context window is SDK-managed / turn-granular) → no "% used" badge: the headline total isn't a
    // real window occupancy, so a percentage here reads as a bogus >100%.
    if (columns.length === 0 || utilization == null) return null;
    const variant =
      isOverflow || utilization >= 100
        ? "destructive"
        : utilization >= 90
          ? "warning"
          : "secondary";
    return (
      <Badge variant={variant} className="tabular-nums">
        {Math.round(utilization)}% used
      </Badge>
    );
  })();

  // Project the columns into the `BarChart` data shape: one row per step, a numeric value per
  // segment, plus a headroom spacer that pads the stacked total up to `contextLimit` so the limit
  // line (drawn on the y-scale via `Grid.highlightRowValues`) lands on-scale at the column tops.
  const data = useMemo<ChartRow[]>(() => {
    return columns.map((col) => {
      const row: ChartRow = { step: col.label };
      for (const seg of CONTEXT_SEGMENTS) {
        row[seg] = col.snapshot.segments[seg] ?? 0;
      }
      // Headroom (the unused-budget spacer that pins the y-domain to the limit) only when the limit
      // is a meaningful reference — otherwise the chart auto-scales to the usage peak (see above).
      if (showLimit) {
        row[HEADROOM_KEY] = Math.max(0, contextLimit - col.snapshot.total);
      }
      return row;
    });
  }, [columns, contextLimit, showLimit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <LineChart aria-hidden className="size-4" />
              Context window
            </span>
            {utilizationBadge}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Text variant="meta" tone="muted">
          Token composition per turn against the model's context limit. Hover a column for its
          breakdown.
        </Text>

        {columns.length === 0 ? (
          <EmptyState
            title="No context yet"
            description="The context-window timeline fills as the run produces turns. The turn-0 baseline (system + tool definitions) appears here first."
          />
        ) : (
          <div className="relative h-44 w-full">
            <BarChart
              data={data}
              xDataKey="step"
              stacked
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel="Context-window composition per turn"
              accessibleDescription={`${turnCount} turn${turnCount === 1 ? "" : "s"}${
                isOverflow ? " plus a terminal overflow column" : ""
              }; latest total ${formatNumber(latestTotal)} tokens${
                contextLimit > 0 ? ` of a ${formatNumber(contextLimit)} limit` : ""
              }.`}
            >
              <Grid
                horizontal
                highlightRowValues={showLimit ? [contextLimit] : undefined}
                highlightRowStroke={
                  isOverflow ? "var(--destructive)" : "var(--chart-foreground-muted)"
                }
                highlightRowStrokeDasharray="4,4"
              />
              {CONTEXT_SEGMENTS.map((seg) => (
                <Bar key={seg} dataKey={seg} fill={SEGMENT_FILL[seg]} />
              ))}
              {showLimit ? <Bar dataKey={HEADROOM_KEY} fill={HEADROOM_FILL} /> : null}
              <BarXAxis maxLabels={8} />
              <ChartTooltip rows={tooltipRows} />
            </BarChart>
            {isOverflow ? (
              <span
                className="pointer-events-none absolute right-2 top-1 z-10 flex items-center gap-1"
                aria-label="Context overflow point"
              >
                <AlertTriangle aria-hidden className="size-3.5 text-destructive" />
              </span>
            ) : null}
          </div>
        )}

        {/* WP 3.2 — the columns' click affordance: a "jump to turn" strip aligned under the chart. */}
        {onSelectTurn ? <TurnJumpStrip columns={columns} onSelectTurn={onSelectTurn} /> : null}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <ChartSegmentLegend />
          {isOverflow ? (
            <span className="flex items-center gap-1.5">
              <AlertTriangle aria-hidden className="size-3.5 text-destructive" />
              <Text variant="meta" className="text-destructive">
                Context overflow
              </Text>
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The hover tooltip rows: per-segment token composition + the column total. `ChartTooltip` calls this
 * with the hovered data row and renders the returned `{ color, label, value }` rows (matching the
 * series' chart-token colours). Headroom is intentionally omitted — it's a layout spacer, not a
 * composition segment.
 */
function tooltipRows(point: Record<string, unknown>): TooltipRow[] {
  const rows: TooltipRow[] = CONTEXT_SEGMENTS.map((seg) => ({
    color: SEGMENT_FILL[seg],
    label: SEGMENT_LABELS[seg],
    value: formatNumber(toNumber(point[seg])),
  }));
  const total = CONTEXT_SEGMENTS.reduce((sum, seg) => sum + toNumber(point[seg]), 0);
  rows.push({
    color: "var(--chart-foreground)",
    label: "Total",
    value: formatNumber(total),
  });
  return rows;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * WP 3.2 — the clickable "jump to turn" strip: one button per plotted TURN column (baseline / overflow
 * columns aren't turns, so they're skipped), evenly distributed so it aligns under the columns. Since
 * `@elabs-ai/components-charts` `BarChart` has no per-bar `onClick`, this is the columns' accessible click affordance:
 * clicking "N" reveals the chat and scrolls it to turn N. Renders nothing when there are no turns.
 */
function TurnJumpStrip({
  columns,
  onSelectTurn,
}: {
  columns: Column[];
  onSelectTurn: (turnIndex: number) => void;
}) {
  const turns = columns.filter(
    (col): col is Column & { turnIndex: number } => typeof col.turnIndex === "number",
  );
  if (turns.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <Text as="span" variant="meta" tone="muted" className="shrink-0">
        Jump to turn:
      </Text>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {turns.map((col) => (
          <Button
            key={col.index}
            variant="outline"
            size="sm"
            className="h-6 min-w-8 px-2 tabular-nums"
            onClick={() => onSelectTurn(col.turnIndex)}
            title={`Jump to turn ${col.turnIndex + 1} in the chat`}
            aria-label={`Jump to turn ${col.turnIndex + 1} in the chat`}
          >
            {col.turnIndex + 1}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The segment legend — a swatch row for the five `--chart-1..5` composition series. Each swatch fills
 * with the same `var(--chart-N)` token its `Bar` uses, so the legend, columns and tooltip stay in one
 * colour system across both themes.
 */
function ChartSegmentLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {LEGEND_ITEMS.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 shrink-0 rounded-sm", item.swatch)} aria-hidden />
          <Text variant="meta" tone="muted">
            {item.label}
          </Text>
        </li>
      ))}
    </ul>
  );
}

/**
 * Coalesce per-event `steps` updates into one paint per animation frame. The columns are the subset
 * of steps that carry a `context` snapshot, in `index` order. While streaming, the parent re-renders
 * on every event; this rAF gate keeps the chart to ≤1 recompute per frame.
 */
function useThrottledColumns(steps: RunStep[]): Column[] {
  const [snapshotSteps, setSnapshotSteps] = useState<RunStep[]>(steps);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<RunStep[]>(steps);

  useEffect(() => {
    pendingRef.current = steps;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setSnapshotSteps(pendingRef.current);
    });
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [steps]);

  return useMemo<Column[]>(() => {
    // Plot only steps carrying a measured `context` snapshot — the settled `llm_response` turn steps
    // plus the terminal `context_event` overflow step (both snapshot the window). Each turn column is
    // labelled by the step's ENGINE-AUTHORED `turnIndex` (0-based) as "Turn {turnIndex+1}", so the
    // chart's turn numbers match the conversation and the KPI rail's turn count exactly — not a
    // positional rename (the run interleaves tool steps, so a raw step `index` would read "Turn 4/5"
    // for the first two turns). When `turnIndex` is absent (older runs) we fall back to a running turn
    // ordinal. The overflow `context_event` step has NO `turnIndex` and is NOT a turn (it would be a
    // phantom "Turn N+1" and disagree with `kpis.turns`); it gets a distinct "Overflow" label and is
    // marked so it is excluded from the turn count.
    let turnFallback = 0; // running 1-based turn ordinal for older runs that lack `turnIndex`
    return snapshotSteps
      .filter((step): step is RunStep & { context: ContextSnapshot } => step.context != null)
      .map((step) => {
        const isOverflow = step.type === "context_event";
        if (isOverflow) {
          return {
            index: step.index,
            label: "Overflow",
            snapshot: step.context,
            turnIndex: null,
            isBaseline: false,
            isOverflow: true,
          };
        }
        turnFallback += 1;
        const turnOrdinal = typeof step.turnIndex === "number" ? step.turnIndex + 1 : turnFallback;
        return {
          index: step.index,
          label: `Turn ${turnOrdinal}`,
          snapshot: step.context,
          turnIndex: turnOrdinal - 1,
          isBaseline: false,
          isOverflow: false,
        };
      });
  }, [snapshotSteps]);
}
