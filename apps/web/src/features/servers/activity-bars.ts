/**
 * Count events into a FIXED number of equal time slices spanning first event → last event.
 *
 * One bar per day was the obvious shape and it did not survive being looked at: 23 scans spread
 * over seven weeks became thirty 2px hairlines inside an 80px sparkline, which rendered as an empty
 * box beside the number 23. A fixed bucket count keeps every bar wide enough to compare no matter
 * how long the server has existed, and the shape of the history — bursty, steady, long-idle — is
 * what this readout is actually for.
 *
 * Counts, not levels: a slice with no runs really did have zero, so filling with 0 states a fact
 * rather than inventing one (contrast `lib/chart-series.ts`, where a state-like series is held).
 * The span ends at the LAST event, not today, so a server idle for a month still shows its history
 * instead of an empty window under a non-zero total.
 */
export function activityBars(
  events: readonly { at: string; count: number }[],
): { values: number[]; total: number } {
  const stamps: { time: number; count: number }[] = [];
  let total = 0;
  for (const event of events) {
    const time = Date.parse(event.at);
    if (Number.isNaN(time) || event.count <= 0) continue;
    stamps.push({ time, count: event.count });
    total += event.count;
  }
  if (stamps.length === 0) return { values: [], total: 0 };

  const first = Math.min(...stamps.map((s) => s.time));
  const last = Math.max(...stamps.map((s) => s.time));
  if (last === first) return { values: [total], total };

  const values = new Array<number>(ACTIVITY_BUCKETS).fill(0);
  const span = last - first;
  for (const stamp of stamps) {
    // The final event lands in the last bucket rather than a phantom (ACTIVITY_BUCKETS + 1)-th.
    const slot = Math.min(
      ACTIVITY_BUCKETS - 1,
      Math.floor(((stamp.time - first) / span) * ACTIVITY_BUCKETS),
    );
    values[slot] = (values[slot] ?? 0) + stamp.count;
  }
  return { values, total };
}

/** How many slices the KPI-row activity bars are drawn in. The total beside them is never windowed. */
export const ACTIVITY_BUCKETS = 12;
