/**
 * Gap handling for continuous chart series (`Line` / `Area`).
 *
 * ## The defect this exists to prevent
 *
 * `@elabs-ai/components-charts` resolves a series' y position with
 *
 * ```ts
 * const value = d[dataKey];
 * return typeof value === "number" ? (yScale(value) ?? 0) : 0;
 * ```
 *
 * (`line.tsx`, `area.tsx`, `profit-loss-line.tsx`). The fallback is `0` in **pixel** space, and in a
 * chart's inner coordinate system `y = 0` is the **TOP of the plot area** — the y-axis maximum. So a
 * row that simply does not carry a series' key is not skipped and does not leave a gap: the series is
 * drawn at the chart's ceiling.
 *
 * Measured against the running app (fleet-footprint tile, 1600×1000, inner plot 366×169px): a server
 * holding a constant 243 tokens — the smallest surface in the fleet — was plotted as a full-height
 * zigzag between y=169 (its real value) and y=0 (the fleet maximum, 152,933 tokens) because it had no
 * scan in 12 of 41 buckets. The default `curveNatural` then overshoots those spikes another 13–18px
 * ABOVE y=0, and the shell's `chart-grow-clip` rect starts at exactly y=0 — so the apex is clipped
 * away and the line visibly vanishes off the top edge. That clipping is the symptom; this is the
 * cause.
 *
 * There is no way to express a real gap: `Line`/`Area` expose no `defined`/`connectNulls` prop, they
 * read their data from chart context rather than their own props, and `NaN` would emit an invalid
 * path that browsers truncate silently. So the only honest move is to hand the chart no holes.
 *
 * ## The two fills, and why the choice is per series
 *
 * - **`"zero"`** — an EXTENSIVE measure that accumulates over a bucket (a count, tokens, a cost). A
 *   bucket with no events really did contribute nothing, so `0` is the measurement.
 * - **`"hold"`** — an INTENSIVE measure that describes a state rather than an accumulation (a rate, a
 *   score, a duration percentile, a scanned surface's size). Zero-filling one of these states
 *   something false and alarming: `constants.ts` already says it outright for ratios — *"'0% of runs
 *   errored' and 'nothing ran' are different facts and one of them is a crisis."* The series is
 *   instead held flat at its nearest real observation, which is the step reading the app's own
 *   "standing measurement" language already uses ("each held at its last successful scan").
 *
 * A `"hold"` series with a LEADING gap is held backwards at its first observation, because the chart
 * cannot start a line late. That is the one place this module extends a measurement beyond where it
 * was taken; it is still strictly narrower than today's behaviour, which asserts the fleet maximum.
 */

/** How a series' missing buckets are filled. See the module note for when each is correct. */
export type SeriesGapFill = "zero" | "hold";

/**
 * Map a metrics measure's UNIT (`RUN_METRICS_MEASURE_UNITS` / `DASHBOARD_CHART_SCAN_MEASURE_UNITS`)
 * onto its fill. `count`/`tokens`/`usd` accumulate; `rate`/`score`/`ms` describe a state.
 */
export function gapFillForUnit(unit: string): SeriesGapFill {
  return unit === "rate" || unit === "score" || unit === "ms" ? "hold" : "zero";
}

/**
 * Fill every listed key in every row, in place of the chart library's "missing ⇒ plot at the
 * ceiling" fallback. Rows are returned in the order given; a row is copied only when it is actually
 * missing something, so a hole-free input is returned structurally unchanged.
 */
export function fillSeriesGaps<T extends Record<string, unknown>>(
  rows: readonly T[],
  fills: readonly { key: string; fill: SeriesGapFill }[],
): T[] {
  if (rows.length === 0 || fills.length === 0) return [...rows];

  const filled: Record<string, unknown>[] = rows.map((row) => ({ ...row }));

  for (const { key, fill } of fills) {
    if (fill === "zero") {
      for (const row of filled) {
        if (typeof row[key] !== "number") row[key] = 0;
      }
      continue;
    }

    // "hold": carry the last observation forward, then hold the first observation backwards over the
    // leading gap. A series with no observation at all falls back to 0 — it has nothing to hold, and
    // leaving the key absent would put it right back on the ceiling.
    let last: number | undefined;
    const leading: Record<string, unknown>[] = [];
    for (const row of filled) {
      const value = row[key];
      if (typeof value === "number") {
        last = value;
        continue;
      }
      if (last === undefined) {
        leading.push(row);
        continue;
      }
      row[key] = last;
    }
    const first = filled.find((row) => typeof row[key] === "number")?.[key];
    const backfill = typeof first === "number" ? first : 0;
    for (const row of leading) row[key] = backfill;
  }

  return filled as T[];
}

/**
 * Every (key, row-index) a continuous series would have been plotted at the chart ceiling for.
 * Empty means the rows are safe to hand a `Line`/`Area`. This is the assertion the panel tests use —
 * the defect is invisible in jsdom (the charts are mocked), so it has to be checked on the DATA.
 */
export function seriesGaps(
  rows: readonly Record<string, unknown>[],
  keys: readonly string[],
): { key: string; index: number }[] {
  const gaps: { key: string; index: number }[] = [];
  rows.forEach((row, index) => {
    for (const key of keys) {
      if (typeof row[key] !== "number") gaps.push({ key, index });
    }
  });
  return gaps;
}
