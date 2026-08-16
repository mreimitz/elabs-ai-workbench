import { describe, expect, test } from "vitest";
import { formatCostUsd, formatDuration, formatRelativeTime } from "./format";
import { formatNumber } from "./format";

// Golden-value locks for the shared figure formatters re-exported through `lib/format`. These are the
// figures the run console / analytics / reports render, so a silent format drift would desync the
// web and API renderings — pin the exact strings.

describe("formatDuration — the <10s/<60s/m/h bands", () => {
  test("sub-second rounds to whole milliseconds", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(1)).toBe("1 ms");
    expect(formatDuration(499.4)).toBe("499 ms");
    expect(formatDuration(999)).toBe("999 ms");
  });

  test("under 10 seconds → 2dp seconds (sub-second precision on short tool calls)", () => {
    expect(formatDuration(1000)).toBe("1.00 s");
    expect(formatDuration(1500)).toBe("1.50 s");
    expect(formatDuration(9500)).toBe("9.50 s");
  });

  test("10s..<60s → 1dp seconds", () => {
    expect(formatDuration(10000)).toBe("10.0 s");
    expect(formatDuration(59000)).toBe("59.0 s");
  });

  test('minutes band → "<m>m <s>s"', () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  test('hours band → "<h>h <m>m"', () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(3660000)).toBe("1h 1m");
    expect(formatDuration(7320000)).toBe("2h 2m");
  });

  test('negative / non-finite fall back to "0 ms"', () => {
    expect(formatDuration(-5)).toBe("0 ms");
    expect(formatDuration(Number.NaN)).toBe("0 ms");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0 ms");
  });
});

describe("formatCostUsd — 2dp default, 4dp opt-in", () => {
  test("defaults to 2 decimal places, $-prefixed, grouped thousands", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
    expect(formatCostUsd(1.5)).toBe("$1.50");
    expect(formatCostUsd(1234.5)).toBe("$1,234.50");
  });

  test("precision:4 keeps sub-cent per-turn/per-node costs", () => {
    expect(formatCostUsd(0.0001, { precision: 4 })).toBe("$0.0001");
    expect(formatCostUsd(0.1234, { precision: 4 })).toBe("$0.1234");
  });

  test("non-finite is treated as 0", () => {
    expect(formatCostUsd(Number.NaN)).toBe("$0.00");
    expect(formatCostUsd(Number.POSITIVE_INFINITY, { precision: 4 })).toBe("$0.0000");
  });
});

describe("formatNumber — rounded, grouped", () => {
  test("rounds and groups", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(1234.6)).toBe("1,235");
    expect(formatNumber(1000000)).toBe("1,000,000");
  });
});

describe("formatRelativeTime — coarse relative bands (Assistant R2.1, D-AS24/D-AS26)", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");

  test("under 45s -> 'just now' (incl. clock-skew futures)", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 1000).toISOString(), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now.getTime() - 44_000).toISOString(), now)).toBe(
      "just now",
    );
    expect(formatRelativeTime(new Date(now.getTime() + 5_000).toISOString(), now)).toBe("just now");
  });

  test("under an hour -> '<n>m ago'", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 60_000).toISOString(), now)).toBe("1m ago");
    expect(formatRelativeTime(new Date(now.getTime() - 59 * 60_000).toISOString(), now)).toBe(
      "59m ago",
    );
  });

  test("under a day -> '<n>h ago'", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 3_600_000).toISOString(), now)).toBe(
      "1h ago",
    );
    expect(formatRelativeTime(new Date(now.getTime() - 23 * 3_600_000).toISOString(), now)).toBe(
      "23h ago",
    );
  });

  test("one day band -> 'yesterday'", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 24 * 3_600_000).toISOString(), now)).toBe(
      "yesterday",
    );
    expect(formatRelativeTime(new Date(now.getTime() - 47 * 3_600_000).toISOString(), now)).toBe(
      "yesterday",
    );
  });

  test("2-6 days -> '<n>d ago'", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000).toISOString(), now)).toBe(
      "2d ago",
    );
    expect(formatRelativeTime(new Date(now.getTime() - 6 * 86_400_000).toISOString(), now)).toBe(
      "6d ago",
    );
  });

  test("7+ days -> a short absolute date; year shown only when it differs from `now`", () => {
    // Expected strings are computed via the SAME Intl call (not hardcoded) so this test isn't hostage
    // to the runner's local timezone — it locks the band/year-inclusion LOGIC, not a locale string.
    const sameYearDate = new Date(now.getTime() - 7 * 86_400_000);
    expect(formatRelativeTime(sameYearDate.toISOString(), now)).toBe(
      new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(sameYearDate),
    );

    const priorYearDate = new Date("2025-01-15T00:00:00.000Z");
    expect(formatRelativeTime(priorYearDate.toISOString(), now)).toBe(
      new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        priorYearDate,
      ),
    );
  });

  test("an unparsable iso string returns ''", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
