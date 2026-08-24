import { describe, expect, test } from "vitest";
import { ACTIVITY_BUCKETS, activityBars } from "./activity-bars";

/** One event on `2026-07-<day>`. */
const day = (n: number, count = 1) => ({ at: new Date(Date.UTC(2026, 6, n)).toISOString(), count });

describe("activityBars — the KPI row's runs/scans sparklines", () => {
  test("spreads the span over a FIXED bucket count, whatever the span is", () => {
    // One bar per DAY was the first shape and it did not survive being looked at: 23 scans over
    // seven weeks became thirty 2px hairlines in an 80px sparkline — an empty box beside "23".
    expect(activityBars([...Array(12)].map((_, i) => day(i + 1))).values).toEqual(
      new Array(ACTIVITY_BUCKETS).fill(1),
    );
    expect(activityBars([day(1), day(90)]).values).toHaveLength(ACTIVITY_BUCKETS);
  });

  test("the last event lands in the last bucket, not a phantom one past the end", () => {
    const { values } = activityBars([day(1), day(30)]);
    expect(values).toHaveLength(ACTIVITY_BUCKETS);
    expect(values.at(-1)).toBe(1);
  });

  test("a single instant collapses to one bar rather than eleven empty ones", () => {
    expect(activityBars([day(1), day(1)])).toEqual({ values: [2], total: 2 });
  });

  test("the total counts EVERY event, never just the drawn window", () => {
    expect(activityBars([...Array(50)].map((_, i) => day(i + 1))).total).toBe(50);
  });

  test("counts accumulate within a bucket", () => {
    // The run-metrics series arrives pre-bucketed with a count per day, not one row per run.
    expect(activityBars([day(1, 26), day(1, 18)])).toEqual({ values: [44], total: 44 });
  });

  test("nothing to draw returns nothing — the caller renders a real empty state", () => {
    expect(activityBars([])).toEqual({ values: [], total: 0 });
    expect(activityBars([{ at: "not-a-date", count: 3 }])).toEqual({ values: [], total: 0 });
    expect(activityBars([{ at: day(1).at, count: 0 }])).toEqual({ values: [], total: 0 });
  });
});
