import { describe, expect, test } from "vitest";
import type { RunMetricsSeries } from "@mcp-token-footprint/shared";
import {
  activeOrWallDuration,
  buildSessionDurationStats,
  lastActivityAt,
  waitingTimeMs,
} from "./session-columns";

describe("activeOrWallDuration (D-US3 — duration DEFAULTS to active)", () => {
  test("prefers activeDurationMs when present", () => {
    expect(activeOrWallDuration({ activeDurationMs: 1000, durationMs: 5000 })).toEqual({
      ms: 1000,
      wallOnly: false,
    });
  });

  test("a legacy run with no active figure degrades HONESTLY to wall-clock, flagged wallOnly", () => {
    expect(activeOrWallDuration({ activeDurationMs: undefined, durationMs: 4200 })).toEqual({
      ms: 4200,
      wallOnly: true,
    });
  });

  test("neither figure known ⇒ null (never fabricates a number)", () => {
    expect(activeOrWallDuration({ activeDurationMs: undefined, durationMs: undefined })).toEqual({
      ms: null,
      wallOnly: false,
    });
  });

  test("activeDurationMs of 0 is a real value, not treated as absent", () => {
    expect(activeOrWallDuration({ activeDurationMs: 0, durationMs: 5000 })).toEqual({
      ms: 0,
      wallOnly: false,
    });
  });
});

describe("waitingTimeMs (D-US3 — waiting = total − active)", () => {
  test("computes the remainder when both figures are known", () => {
    expect(waitingTimeMs({ activeDurationMs: 3000, totalDurationMs: 10000 })).toBe(7000);
  });

  test("floors at 0 (never negative, even given inconsistent inputs)", () => {
    expect(waitingTimeMs({ activeDurationMs: 9000, totalDurationMs: 5000 })).toBe(0);
  });

  test("null unless BOTH figures are known — active only", () => {
    expect(waitingTimeMs({ activeDurationMs: 3000, totalDurationMs: undefined })).toBeNull();
  });

  test("null unless BOTH figures are known — total only", () => {
    expect(waitingTimeMs({ activeDurationMs: undefined, totalDurationMs: 10000 })).toBeNull();
  });

  test("null for a legacy run with neither figure (never a fabricated 0)", () => {
    expect(waitingTimeMs({ activeDurationMs: undefined, totalDurationMs: undefined })).toBeNull();
  });
});

describe("lastActivityAt", () => {
  test("prefers endedAt (WP1.6 stamps it for every terminal disposition)", () => {
    expect(
      lastActivityAt({ endedAt: "2026-07-16T12:00:00.000Z", startedAt: "2026-07-16T10:00:00.000Z" }),
    ).toEqual({ at: "2026-07-16T12:00:00.000Z", approx: false });
  });

  test("a still-open/legacy run with no endedAt falls back to startedAt, flagged approx", () => {
    expect(lastActivityAt({ endedAt: undefined, startedAt: "2026-07-16T10:00:00.000Z" })).toEqual({
      at: "2026-07-16T10:00:00.000Z",
      approx: true,
    });
  });
});

describe("buildSessionDurationStats", () => {
  function series(overrides: Partial<RunMetricsSeries>): RunMetricsSeries {
    return {
      measure: "p50DurationMs",
      group: "scn-1",
      capabilityClass: null,
      points: [],
      ...overrides,
    };
  }

  test("pairs p50/p95 series of the SAME group into one row, taking the LATEST bucket per measure", () => {
    const result = buildSessionDurationStats([
      series({
        measure: "p50DurationMs",
        group: "scn-1",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 2 },
          { bucketStart: "2026-07-08T00:00:00.000Z", value: 1500, n: 3 },
        ],
      }),
      series({
        measure: "p95DurationMs",
        group: "scn-1",
        points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 4000, n: 3 }],
      }),
    ]);
    expect(result).toEqual([{ scenarioId: "scn-1", p50Ms: 1500, p95Ms: 4000, fallback: false }]);
  });

  test("separate groups become separate rows, sorted by p95 descending", () => {
    const result = buildSessionDurationStats([
      series({ measure: "p95DurationMs", group: "scn-slow", points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 9000, n: 1 }] }),
      series({ measure: "p95DurationMs", group: "scn-fast", points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 1000, n: 1 }] }),
    ]);
    expect(result.map((r) => r.scenarioId)).toEqual(["scn-slow", "scn-fast"]);
  });

  test("propagates durationFallback (D-US3 wall-clock fallback marker)", () => {
    const result = buildSessionDurationStats([
      series({
        measure: "p50DurationMs",
        group: "scn-1",
        durationFallback: true,
        points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 1000, n: 1 }],
      }),
    ]);
    expect(result[0]?.fallback).toBe(true);
  });

  test("ignores non-duration measures (e.g. count) mixed into the same response", () => {
    const result = buildSessionDurationStats([
      series({ measure: "count", group: "scn-1", points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 5, n: 5 }] }),
    ]);
    expect(result).toEqual([]);
  });

  test("empty series ⇒ empty result (honest — no fabricated rows)", () => {
    expect(buildSessionDurationStats([])).toEqual([]);
  });
});
