import { describe, expect, it } from "vitest";
import {
  type TopRowVM,
  filterRows,
  groupRows,
  hasActiveFilters,
  runsColumnCount,
  shouldShowGradeColumn,
  sortRows,
  summarizeRows,
} from "./runs-table-model";

/** Minimal VM builder — only the fields a given test asserts on; the rest get inert defaults. */
function vm(over: Partial<TopRowVM> & { id: string }): TopRowVM {
  return {
    kind: "run",
    name: "A test",
    testId: "t-default",
    typeKey: "single",
    statusFacet: "complete",
    statusLabel: "completed",
    environments: ["Prod"],
    environmentLabel: "Prod",
    startedMs: Date.parse("2026-07-04T00:00:00.000Z"),
    startedIso: "2026-07-04T00:00:00.000Z",
    turns: 0,
    tools: 0,
    tokens: 0,
    cost: 0,
    gradeSort: -1,
    hasBaseVerdict: false,
    durationMs: null,
    ...over,
  };
}

describe("filterRows", () => {
  it("matches the global search over name / status / environment", () => {
    const rows = [
      vm({ id: "a", name: "Weather lookup" }),
      vm({
        id: "b",
        name: "Invoice parse",
        environments: ["Staging"],
        environmentLabel: "Staging",
      }),
      vm({ id: "c", name: "Refund flow", statusLabel: "error", statusFacet: "failed" }),
    ];
    expect(filterRows(rows, base({ search: "weather" })).map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, base({ search: "staging" })).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, base({ search: "error" })).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters by type, status and environment facets", () => {
    const rows = [
      vm({ id: "single", typeKey: "single", statusFacet: "complete", environments: ["Prod"] }),
      vm({
        id: "suite",
        typeKey: "suite",
        statusFacet: "running",
        environments: ["Prod", "Staging"],
      }),
    ];
    expect(filterRows(rows, base({ types: ["suite"] })).map((r) => r.id)).toEqual(["suite"]);
    expect(filterRows(rows, base({ statuses: ["complete"] })).map((r) => r.id)).toEqual(["single"]);
    // A suite touching Staging matches the Staging env facet (any-of its environments).
    expect(filterRows(rows, base({ environments: ["Staging"] })).map((r) => r.id)).toEqual([
      "suite",
    ]);
  });

  it("bounds by the started-date range, inclusive of both endpoint days", () => {
    const rows = [
      vm({ id: "jul02", startedMs: Date.parse("2026-07-02T12:00:00.000Z") }),
      vm({ id: "jul04", startedMs: Date.parse("2026-07-04T09:00:00.000Z") }),
      vm({ id: "jul09", startedMs: Date.parse("2026-07-09T23:00:00.000Z") }),
    ];
    const out = filterRows(
      rows,
      base({ dateRange: { from: new Date("2026-07-03"), to: new Date("2026-07-08") } }),
    );
    expect(out.map((r) => r.id)).toEqual(["jul04"]);
  });
});

describe("sortRows", () => {
  it("sorts numeric columns and breaks ties newest-first", () => {
    const rows = [
      vm({ id: "a", cost: 5, startedMs: 100 }),
      vm({ id: "b", cost: 1, startedMs: 300 }),
      vm({ id: "c", cost: 5, startedMs: 400 }),
    ];
    // Ties (a & c both cost 5) break newest-first — independent of the sort direction.
    expect(sortRows(rows, "cost", "desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortRows(rows, "cost", "asc").map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts name case-insensitively", () => {
    const rows = [vm({ id: "a", name: "beta" }), vm({ id: "b", name: "Alpha" })];
    expect(sortRows(rows, "name", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts ungraded rows (gradeSort -1) last on a descending grade sort", () => {
    const rows = [vm({ id: "none", gradeSort: -1 }), vm({ id: "high", gradeSort: 0.9 })];
    expect(sortRows(rows, "grade", "desc").map((r) => r.id)).toEqual(["high", "none"]);
  });
});

describe("groupRows", () => {
  it("returns a single unlabeled group when ungrouped", () => {
    const rows = [vm({ id: "a" }), vm({ id: "b" })];
    const groups = groupRows(rows, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeNull();
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it("partitions by type, preserving sorted first-appearance order", () => {
    const rows = [
      vm({ id: "s1", typeKey: "suite" }),
      vm({ id: "r1", typeKey: "single" }),
      vm({ id: "r2", typeKey: "single" }),
    ];
    const groups = groupRows(rows, "type");
    expect(groups.map((g) => g.key)).toEqual(["suite", "single"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("groups single runs by test and gathers suite rows into one Suite runs bucket", () => {
    const rows = [
      vm({ id: "a", testId: "t1", name: "Banking" }),
      vm({ id: "s1", kind: "suite", typeKey: "suite", testId: null, name: "Nightly" }),
      vm({ id: "b", testId: "t1", name: "Banking" }),
      vm({ id: "c", testId: "t2", name: "Weather" }),
    ];
    const groups = groupRows(rows, "test");
    expect(groups.map((g) => g.label)).toEqual(["Banking", "Suite runs", "Weather"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("groups single runs by environment; multi-environment suites fall in the Suite runs bucket", () => {
    const rows = [
      vm({ id: "a", environments: ["Prod"] }),
      vm({
        id: "s1",
        kind: "suite",
        typeKey: "suite",
        testId: null,
        environments: ["Prod", "Staging"],
      }),
      vm({ id: "b", environments: ["Staging"] }),
    ];
    const groups = groupRows(rows, "environment");
    expect(groups.map((g) => g.label)).toEqual(["Prod", "Suite runs", "Staging"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("partitions by local day", () => {
    const rows = [
      vm({ id: "d1", startedMs: Date.parse("2026-07-04T10:00:00.000Z") }),
      vm({ id: "d2", startedMs: Date.parse("2026-07-04T20:00:00.000Z") }),
      vm({ id: "d3", startedMs: Date.parse("2026-07-05T01:00:00.000Z") }),
    ];
    const groups = groupRows(rows, "day");
    // Two calendar days present (exact bucketing is local-time; two of the three share a day).
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(3);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty filter and true once anything narrows", () => {
    expect(hasActiveFilters(base({}))).toBe(false);
    expect(hasActiveFilters(base({ search: "x" }))).toBe(true);
    expect(hasActiveFilters(base({ statuses: ["failed"] }))).toBe(true);
    expect(hasActiveFilters(base({ dateRange: { from: new Date("2026-07-01") } }))).toBe(true);
  });
});

describe("summarizeRows", () => {
  it("totals tokens + cost and computes the failure rate over the current rows", () => {
    const rows = [
      vm({ id: "a", tokens: 100, cost: 0.5, statusFacet: "complete" }),
      vm({ id: "b", tokens: 300, cost: 1.5, statusFacet: "failed" }),
      vm({ id: "c", tokens: 600, cost: 3, statusFacet: "running" }),
    ];
    const totals = summarizeRows(rows);
    expect(totals.rows).toBe(3);
    expect(totals.tokens).toBe(1000);
    expect(totals.cost).toBeCloseTo(5);
    expect(totals.failed).toBe(1);
    expect(totals.failureRate).toBeCloseTo(1 / 3);
  });

  it("reports a null failure rate for an empty set (no meaningful rate)", () => {
    expect(summarizeRows([]).failureRate).toBeNull();
  });
});

describe("runsColumnCount", () => {
  it("drops one column when the Grade column is hidden (S9)", () => {
    expect(runsColumnCount(true)).toBe(12);
    expect(runsColumnCount(false)).toBe(11);
  });
});

describe("shouldShowGradeColumn", () => {
  it("is false when nothing in view carries an expectation grade OR a base verdict", () => {
    const rows = [
      vm({ id: "a", gradeSort: -1, hasBaseVerdict: false }),
      vm({ id: "b", gradeSort: -1, hasBaseVerdict: false }),
    ];
    expect(shouldShowGradeColumn(rows)).toBe(false);
  });

  it("is true when a row has an expectation grade, even with no base verdict anywhere", () => {
    const rows = [vm({ id: "a", gradeSort: 0.8, hasBaseVerdict: false })];
    expect(shouldShowGradeColumn(rows)).toBe(true);
  });

  it("is true when a row has ONLY a base-rating verdict (AR6) — the common case for a test with no declared expectations", () => {
    const rows = [vm({ id: "a", gradeSort: -1, hasBaseVerdict: true })];
    expect(shouldShowGradeColumn(rows)).toBe(true);
  });
});

/** An empty filter set with overrides. */
function base(over: Partial<Parameters<typeof filterRows>[1]>): Parameters<typeof filterRows>[1] {
  return { search: "", types: [], statuses: [], environments: [], ...over };
}
