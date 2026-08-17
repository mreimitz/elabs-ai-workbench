import { describe, expect, test, vi } from "vitest";

// `@elabs-ai/components-charts`'s barrel import triggers a broken deep `@visx/gradient` subpath under
// Vitest/jsdom (see `IssueTriageTable.test.tsx`'s identical note) — importing
// `IssueOccurrencesPanel.tsx` for its pure `formatOccurrenceBucketLabel` export still evaluates
// that import at module-load time, so the same stub is needed even though this test renders nothing.
vi.mock("@elabs-ai/components-charts", () => ({
  Bar: () => null,
  BarChart: () => null,
  BarXAxis: () => null,
  ChartTooltip: () => null,
  Grid: () => null,
}));

import { formatOccurrenceBucketLabel } from "./IssueOccurrencesPanel";

/**
 * Pure-logic coverage for the exact bug the owner-directed redesign fixed: the occurrences chart's
 * x-axis showed OVERLAPPING DUPLICATE labels because every bucket — regardless of granularity — was
 * formatted with `toLocaleDateString()` (date only). For an "hour" bucket, many same-day bars then
 * rendered the identical label back to back. This only tests the pure formatter (not the chart
 * itself, which is stubbed out in the component tests) — see `IssueTriageTable.test.tsx`/
 * `IssueDetail.test.tsx` for the `@elabs-ai/components-charts` mocking recipe this codebase uses for the chart.
 */
// Month+day (± the local timezone shifting a UTC instant's calendar day by ±1) — deliberately NOT
// pinned to an exact day number so this test is stable under whatever TZ the runner uses.
const MONTH_DAY = /^[A-Z][a-z]{2} \d{1,2}$/;

describe("formatOccurrenceBucketLabel — distinct, honest x-axis ticks", () => {
  test("hour bucket: two different hours 5 hours apart get DIFFERENT labels (the duplicate-label bug)", () => {
    const nineAm = new Date("2026-07-14T09:00:00.000Z");
    const twoPm = new Date("2026-07-14T14:00:00.000Z");
    const a = formatOccurrenceBucketLabel(nineAm, "hour");
    const b = formatOccurrenceBucketLabel(twoPm, "hour");
    // The exact fix: the old `toLocaleDateString()` label was IDENTICAL for every hour of the same
    // day; an hour-granularity label must never collide like that.
    expect(a).not.toBe(b);
  });

  test("day bucket: a compact month+day, no time-of-day noise", () => {
    const label = formatOccurrenceBucketLabel(new Date("2026-07-14T12:00:00.000Z"), "day");
    expect(label).toMatch(MONTH_DAY);
  });

  test("week bucket: a compact month+day, prefixed so a week bucket doesn't read like a single day", () => {
    const label = formatOccurrenceBucketLabel(new Date("2026-07-14T12:00:00.000Z"), "week");
    expect(label.startsWith("Wk of ")).toBe(true);
    expect(label.replace("Wk of ", "")).toMatch(MONTH_DAY);
  });

  test("never fabricates a year — this panel is scoped to one issue's own short observed window", () => {
    const label = formatOccurrenceBucketLabel(new Date("2026-07-14T12:00:00.000Z"), "day");
    expect(label).not.toMatch(/\d{4}/);
  });
});
