import type { RatingIssue } from "@mcp-token-footprint/shared";
import { fillSeriesGaps } from "../../lib/chart-series";

/**
 * How many issues stood open on each day — derived from the issue list the page already holds.
 *
 * ## This is a projection of the CURRENT state, not a history (say so wherever it renders)
 *
 * There is no issue status-history table, and `resolved_at` is *cleared* when an issue is reopened
 * or regresses (`apps/api/src/grading/issue-repository.ts` — `setStatus` and `setLifecycle` both
 * null it out). So an issue closed in May and regressed in July carries no trace of the closure and
 * is reconstructed here as open continuously since `firstSeenAt`. The line is therefore a lower
 * bound on churn and an accurate read of *today*: every currently-open issue is counted from the
 * day it was first seen, and every currently-resolved one is dropped on the day it was resolved.
 *
 * Making that faithful would need a new `rating_issue_status_events` table written on every
 * transition — a schema change, deliberately not made here. The card's description states the
 * limitation instead of implying a history the database cannot produce.
 */

/** One day of the projection. `x` is a real `Date` — the time-scale charts require it. */
export type OpenIssueDay = { day: string; x: Date; open: number };

/** UTC day key (`YYYY-MM-DD`) — issue timestamps are ISO-8601 UTC. */
function dayOf(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/** Every UTC day from `first` to `last` inclusive, so a quiet week is a flat line, not a jump. */
function daySpan(first: string, last: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${last}T00:00:00.000Z`);
  for (
    let cursor = Date.parse(`${first}T00:00:00.000Z`);
    cursor <= end;
    cursor += 24 * 60 * 60 * 1000
  ) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Build the open-count series: `+1` on each issue's `firstSeenAt`, `−1` on its `resolvedAt`,
 * accumulated over every day in between.
 *
 * Returns `[]` when nothing is plottable, so the caller renders an empty state rather than an axis
 * drawn over no measurement. `today` is injectable so the series can be carried to the present day
 * in a test without depending on the clock.
 */
export function buildOpenIssueTrend(
  issues: readonly RatingIssue[],
  today: Date = new Date(),
): OpenIssueDay[] {
  const opened = new Map<string, number>();
  const closed = new Map<string, number>();
  let earliest: string | null = null;

  for (const issue of issues) {
    const from = dayOf(issue.firstSeenAt);
    if (from === null) continue;
    opened.set(from, (opened.get(from) ?? 0) + 1);
    if (earliest === null || from < earliest) earliest = from;

    // `resolvedAt` is only ever set on a currently-resolved issue (it is cleared on reopen), so an
    // issue that carries one is closed today and is dropped from the count on that day.
    const to = issue.resolvedAt === undefined ? null : dayOf(issue.resolvedAt);
    if (to !== null) closed.set(to, (closed.get(to) ?? 0) + 1);
  }

  if (earliest === null) return [];

  // Carry the line to today even when the last event is old — "still 6 open, three weeks on" is the
  // fact an operator needs, and a series that stops at the last event hides it.
  const latest = today.toISOString().slice(0, 10);
  const days = daySpan(earliest, latest > earliest ? latest : earliest);

  let running = 0;
  return days.map((day) => {
    running += (opened.get(day) ?? 0) - (closed.get(day) ?? 0);
    return { day, x: new Date(`${day}T00:00:00.000Z`), open: Math.max(0, running) };
  });
}

/**
 * The same series, hole-free, ready for a `Line`/`Area`.
 *
 * `buildOpenIssueTrend` already emits every day, so this is a guard rather than a repair — but it
 * is the guard that matters: a row missing its series key is plotted by the chart library at y=0,
 * which is the TOP of the plot (see `lib/chart-series.ts`), so an open count of "unknown" would
 * render as the highest the axis goes. `"hold"` is the correct fill for a level like this one.
 */
export function openIssueTrendRows(
  issues: readonly RatingIssue[],
  today?: Date,
): Record<string, unknown>[] {
  const rows = buildOpenIssueTrend(issues, today) as unknown as Record<string, unknown>[];
  return fillSeriesGaps(rows, [{ key: "open", fill: "hold" }]);
}
