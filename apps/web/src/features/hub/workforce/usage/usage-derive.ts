import type { HubUsageBucket, HubUsageRow } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub UX WP2.6 (D-HUX10) — pure row/chart-shaping helpers for the workforce Usage tab.
 * React-free and unit-testable in isolation (mirrors `dashboard/testing/metrics-derive.ts`'s style).
 */

export type UsageTotals = {
  sessions: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
};

/** Sums every rollup row (INCLUDING the unattributed bucket) — the WP1.6 reconciliation invariant
 *  ("sum(rows) === totals") holds by construction on the API side; this is the UI's own read of that
 *  same sum, used for the KPI cards so the displayed total can never silently drop unattributed
 *  spend (D-HUX10's "never a silently short total", now enforced on the render path too). */
export function sumUsageRows(rows: readonly HubUsageRow[]): UsageTotals {
  return rows.reduce<UsageTotals>(
    (acc, row) => ({
      sessions: acc.sessions + row.sessions,
      costUsd: acc.costUsd + row.costUsd,
      tokensIn: acc.tokensIn + row.tokensIn,
      tokensOut: acc.tokensOut + row.tokensOut,
    }),
    { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
  );
}

/** Every row ranked by spend, highest first — including the unattributed bucket wherever it ranks
 *  (it is never pinned/hidden). Powers the ranked DataTable and the top-N bar chart. */
export function rankByCost(rows: readonly HubUsageRow[]): HubUsageRow[] {
  return [...rows].sort((a, b) => b.costUsd - a.costUsd);
}

/** The top `max` ATTRIBUTED rows by spend (unattributed excluded) — `/api/hub/usage/summary` needs a
 *  real entity `id`, and the unattributed bucket's `key` is `null` (D-HUX10: no ID for "no agent"),
 *  so it can never back a per-entity daily strip. Used to pick which rows to fetch a strip for, for
 *  the stacked-over-time chart; the ranked DataTable and KPI totals are unaffected — they keep the
 *  unattributed row via {@link rankByCost}/{@link sumUsageRows}. */
export function topAttributedRows(rows: readonly HubUsageRow[], max: number): HubUsageRow[] {
  return rankByCost(rows.filter((row) => !row.unattributed && row.key !== null)).slice(0, max);
}

/** A stable, chart-safe series key for a row (object-key-safe; the app's ids are nanoid-shaped, so a
 *  raw `key` is already safe, but this stays defensive for a `model` id that could contain odd
 *  characters). */
export function seriesKeyFor(row: Pick<HubUsageRow, "key">): string {
  return row.key ?? "unattributed";
}

/** One day-bucketed `x: Date` row per date in `strips[0]` (every strip shares the SAME `days` window
 *  from the SAME `summaryDaysFor` call, so they are index-aligned by construction — see
 *  `usage-url-state.ts`'s `summaryDaysFor` doc for the "ends today" caveat) with one numeric field
 *  per `entries[].row`, keyed by {@link seriesKeyFor}. Feeds `ComposedChart`'s `stacked` `SeriesBar`s
 *  — `xDataKey="x"` over a REAL `Date` (never a string; see the repo chart-gotcha doc). */
export function buildStackedTimeRows(
  entries: readonly { row: HubUsageRow; strip: readonly HubUsageBucket[] }[],
): Record<string, unknown>[] {
  const dates = entries[0]?.strip.map((bucket) => bucket.key) ?? [];
  return dates.map((date, index) => {
    const point: Record<string, unknown> = { x: new Date(`${date}T00:00:00.000Z`) };
    for (const entry of entries) {
      const bucket = entry.strip[index];
      point[seriesKeyFor(entry.row)] = bucket ? bucket.costUsd : 0;
    }
    return point;
  });
}

/** Percent (0-100, one decimal) `part` is of `total` — 0 when `total` is 0 (never `NaN`/`Infinity`). */
export function sharePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}
