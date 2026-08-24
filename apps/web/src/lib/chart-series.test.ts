import { describe, expect, test } from "vitest";
import { fillSeriesGaps, gapFillForUnit, seriesGaps } from "./chart-series";

describe("fillSeriesGaps", () => {
  test("zero-fills an extensive series and leaves real values alone", () => {
    const rows = [{ a: 1 }, {}, { a: 3 }];
    expect(fillSeriesGaps(rows, [{ key: "a", fill: "zero" }])).toEqual([{ a: 1 }, { a: 0 }, { a: 3 }]);
  });

  test("holds an intensive series forward over an interior gap", () => {
    const rows = [{ a: 10 }, {}, {}, { a: 40 }];
    expect(fillSeriesGaps(rows, [{ key: "a", fill: "hold" }]).map((r) => r.a)).toEqual([10, 10, 10, 40]);
  });

  test("holds the FIRST observation backwards over a leading gap — a chart cannot start a line late", () => {
    const rows = [{}, {}, { a: 7 }, {}];
    expect(fillSeriesGaps(rows, [{ key: "a", fill: "hold" }]).map((r) => r.a)).toEqual([7, 7, 7, 7]);
  });

  test("a series with no observation at all falls back to 0 rather than staying on the ceiling", () => {
    const rows: Record<string, number>[] = [{ other: 1 }, { other: 2 }];
    expect(fillSeriesGaps(rows, [{ key: "a", fill: "hold" }]).map((r) => r.a)).toEqual([0, 0]);
  });

  test("does not mutate the caller's rows", () => {
    const rows = [{ a: 1 }, {} as Record<string, number>];
    fillSeriesGaps(rows, [{ key: "a", fill: "zero" }]);
    expect(rows[1]).toEqual({});
  });

  test("fills each key by its OWN rule in one pass", () => {
    const rows = [{ count: 2, rate: 50 }, { count: 3 }, { rate: 10 }];
    const out = fillSeriesGaps(rows, [
      { key: "count", fill: "zero" },
      { key: "rate", fill: "hold" },
    ]);
    expect(out.map((r) => r.count)).toEqual([2, 3, 0]);
    expect(out.map((r) => r.rate)).toEqual([50, 50, 10]);
  });
});

describe("gapFillForUnit", () => {
  test("state-like units hold; accumulating units zero", () => {
    expect(gapFillForUnit("rate")).toBe("hold");
    expect(gapFillForUnit("score")).toBe("hold");
    expect(gapFillForUnit("ms")).toBe("hold");
    expect(gapFillForUnit("count")).toBe("zero");
    expect(gapFillForUnit("tokens")).toBe("zero");
    expect(gapFillForUnit("usd")).toBe("zero");
  });
});

describe("seriesGaps", () => {
  test("reports every hole a continuous series would be plotted at the ceiling for", () => {
    expect(seriesGaps([{ a: 1, b: 2 }, { a: 3 }], ["a", "b"])).toEqual([{ key: "b", index: 1 }]);
  });

  test("a filled row set reports nothing", () => {
    expect(seriesGaps(fillSeriesGaps([{ a: 1 }, {}], [{ key: "a", fill: "zero" }]), ["a"])).toEqual([]);
  });

  test("a non-numeric value counts as a hole — the library's fallback keys on `typeof value === \"number\"`", () => {
    expect(seriesGaps([{ a: null }, { a: "12" }], ["a"])).toHaveLength(2);
  });
});
