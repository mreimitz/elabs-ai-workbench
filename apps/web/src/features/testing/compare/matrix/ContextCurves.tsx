import { useMemo } from "react";
import { Text } from "@brand/ui";
import { ChartTooltip, Grid, Line, LineChart, XAxis, YAxis, type TooltipRow } from "@brand/charts";
import { RunLetterBadge } from "../RunLetterBadge";
import { formatNumber } from "../../../../lib/format";
import { relativeTime } from "../compare-runs";
import { buildContextCurveRows, curveLimit, type SummaryRun } from "../summary-derive";

/**
 * The context-window curves (audit §G13.4) — the second honest visual, kept ONLY when a run has more
 * than two turns (the parent gates on {@link shouldShowCurves}; a 1–2 point line is noise). One line
 * per run in its series colour, x = turn progress, y = context tokens, with the **model context limit**
 * drawn as a reference line so "how close did each run get to the wall" is legible.
 *
 * MEMORY / crash-guard: the `@brand/charts` `LineChart` x-axis is a TIME scale — it coerces x to a
 * `Date`, and a string x (`"Turn 3"`) throws `RangeError: Invalid time value`. {@link buildContextCurveRows}
 * emits SYNTHETIC `Date` x-values (only the shape/order matters — there is no real calendar date here);
 * the tooltip always names the real turn ({@link tooltipRows}).
 *
 * S4 axis fix: `@brand/charts`' `XAxis` has no prop to print custom tick text (verified against the
 * vendored `.d.ts` / bundle) — it always formats a tick via a **month+day** `Intl.DateTimeFormat` and
 * silently DROPS any tick whose formatted label duplicates an earlier one. `buildContextCurveRows`
 * spaces its synthetic x-values only a MINUTE apart, so every tick formats to the identical label and
 * the axis collapses to one dead tick — the "no x-axis ticks" bug. `chartRows` below re-spaces the
 * x-values a full DAY apart for chart rendering only: the day-of-month then equals the (1-based) turn
 * number, so the ticks read as a legible, monotonic turn sequence within the one constraint the
 * library exposes. The y-axis already has real data (`formatLargeNumbers`) and needed no such fix.
 */
/** Data key for the synthetic limit series (a flat line at the model window) — never a run id. */
const LIMIT_KEY = "__limit";

/** One full day in ms — see the S4 axis-fix note above. */
const AXIS_TICK_SPACING_MS = 86_400_000;

export function ContextCurves({ runs }: { runs: SummaryRun[] }) {
  const baseRows = useMemo(() => buildContextCurveRows(runs), [runs]);
  const limit = useMemo(() => curveLimit(runs), [runs]);

  // The limit line is only a useful reference when a curve gets within a visible fraction of it;
  // for a 1M window used at a few thousand tokens it would crush every curve to the floor.
  const peak = useMemo(() => Math.max(0, ...runs.flatMap((r) => r.contextTotals)), [runs]);
  const showLimit = limit > 0 && peak >= limit * 0.2;

  // Inject the limit as a flat constant series so it (a) pins the chart's auto y-domain UP to the
  // window and (b) draws the reference line on-scale. Without this the axis tops out at the data peak
  // and a limit far above it lands off-chart (the legend would promise a line the plot never shows).
  const rows = useMemo(
    () => (showLimit ? baseRows.map((row) => ({ ...row, [LIMIT_KEY]: limit })) : baseRows),
    [baseRows, showLimit, limit],
  );

  // Chart-rendering only (see the S4 axis-fix note above) — `rows` (and `tooltipRows`, which reads
  // `point[run.id]` and never `point.x`) stay the turn-order source of truth.
  const chartRows = useMemo(
    () => rows.map((row, index) => ({ ...row, x: new Date(index * AXIS_TICK_SPACING_MS) })),
    [rows],
  );

  const maxTurns = rows.length;

  return (
    <div className="flex flex-col gap-3">
      <Text variant="meta" tone="muted" className="text-pretty">
        Context tokens as each run progresses
        {showLimit ? ", against the model's context limit" : ""}. Hover a point for the turn
        breakdown.
      </Text>
      <div className="h-56 w-full">
        <LineChart
          data={chartRows}
          xDataKey="x"
          aspectRatio="auto"
          className="h-full w-full"
          accessibleLabel="Context-window growth per turn, one line per run"
          accessibleDescription={`${runs.length} runs over up to ${maxTurns} turns${
            showLimit ? `, against a ${formatNumber(limit)}-token context limit` : ""
          }.`}
        >
          <Grid horizontal />
          <YAxis formatLargeNumbers />
          <XAxis numTicks={Math.min(maxTurns, 6)} />
          {showLimit ? (
            <Line
              dataKey={LIMIT_KEY}
              stroke="var(--chart-foreground-muted)"
              strokeWidth={1.5}
              dashArray="4,4"
              dashFromIndex={0}
              fadeEdges={false}
              showHighlight={false}
              animate={false}
            />
          ) : null}
          {runs.map((run) => (
            <Line key={run.id} dataKey={run.id} stroke={run.color} showMarkers />
          ))}
          <ChartTooltip rows={(point) => tooltipRows(point, runs)} />
        </LineChart>
      </div>
      <CurveLegend runs={runs} showLimit={showLimit} limit={limit} />
    </div>
  );
}

/** Per-run tooltip rows (letter + context total at the hovered turn); skips runs with no point there. */
function tooltipRows(point: Record<string, unknown>, runs: SummaryRun[]): TooltipRow[] {
  return runs
    .filter((run) => typeof point[run.id] === "number")
    .map((run) => ({
      color: run.color,
      label: run.letter,
      value: formatNumber(point[run.id] as number),
    }));
}

/**
 * The curve legend — the run letter badges (identity system) + the model-limit reference note. S4:
 * when two or more compared runs share the same environment name, the chip colour alone can't tell
 * them apart (e.g. two "BARC-Benchmark-Sonnet" runs) — {@link legendLabel} appends the model + a
 * relative time to every colliding entry so the legend disambiguates without relying on colour.
 */
function CurveLegend({
  runs,
  showLimit,
  limit,
}: {
  runs: SummaryRun[];
  showLimit: boolean;
  limit: number;
}) {
  const collidingNames = collidingScenarioNames(runs);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2.5">
      {runs.map((run) => (
        <span key={run.id} className="flex items-center gap-1.5">
          <RunLetterBadge letter={run.letter} color={run.color} baseline={run.isBaseline} />
          <Text variant="meta" tone="muted" className="truncate">
            {legendLabel(run, collidingNames)}
          </Text>
        </span>
      ))}
      {showLimit ? (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0 w-4 border-t-2 border-dashed"
            style={{ borderColor: "var(--chart-foreground-muted)" }}
          />
          <Text variant="meta" tone="muted" className="tabular-nums">
            Context limit ({formatNumber(limit)})
          </Text>
        </span>
      ) : null}
    </div>
  );
}

/** Environment names shared by more than one run in the compared set (S4 legend collision). */
function collidingScenarioNames(runs: SummaryRun[]): Set<string> {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.scenarioName, (counts.get(run.scenarioName) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

/** One run's legend text: its environment name alone, or — when that name collides with another run
 *  in the set — `Environment · model · relative time` so the chip colour isn't the only disambiguator. */
function legendLabel(run: SummaryRun, colliding: Set<string>): string {
  if (!colliding.has(run.scenarioName)) return run.scenarioName;
  const parts = [run.scenarioName];
  if (run.model && run.model !== "—") parts.push(run.model);
  if (run.startedAt) parts.push(relativeTime(run.startedAt));
  return parts.join(" · ");
}
