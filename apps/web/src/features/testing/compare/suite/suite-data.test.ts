import type { RunSummary, Scenario, SuiteRun, Test } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import type { CompareData } from "../compare-runs";
import {
  buildSuiteCompareMarkdown,
  buildSuiteGrid,
  deriveSuiteVerdict,
  isErroredMember,
  subjectKey,
  toneForDelta,
  type SuiteCompareData,
  type SuiteCompareSide,
} from "./suite-data";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

function run(
  over: Partial<RunSummary> & Pick<RunSummary, "id" | "testId" | "scenarioId" | "suiteRunId">,
): RunSummary {
  return {
    mode: "automated",
    status: "completed",
    startedAt: "2026-07-05T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 100,
    tokensOut: 100,
    costUsd: 0.1,
    repetition: 1,
    ...over,
  } as RunSummary;
}

function suiteRun(id: string, aggregates: SuiteRun["aggregates"]): SuiteRun {
  return {
    id,
    status: "completed",
    configSnapshot: { repetitions: 1, maxConcurrency: 1 },
    startedAt: "2026-07-05T00:00:00.000Z",
    aggregates,
  };
}

function catalog(tests: Test[], scenarios: Scenario[], runs: RunSummary[]): CompareData {
  return {
    runs,
    runsById: new Map(runs.map((r) => [r.id, r])),
    testsById: new Map(tests.map((t) => [t.id, t])),
    scenariosById: new Map(scenarios.map((s) => [s.id, s])),
    providers: [],
    scans: [], // WP 4.5 added `scans` to CompareData; suite compare doesn't consume it here
  };
}

const tests: Test[] = [
  { id: "t1", name: "Alpha test" } as Test,
  { id: "t2", name: "Beta test" } as Test,
];
const scenarios: Scenario[] = [
  { id: "s1", name: "gpt env", model: "gpt" } as Scenario,
  { id: "s2", name: "gemma env", model: "gemma" } as Scenario,
];

function side(
  id: string,
  index: number,
  memberRuns: RunSummary[],
  grades: Record<string, number>,
): SuiteCompareSide {
  return {
    id,
    index,
    letter: index === 0 ? "A" : "B",
    color: `var(--chart-${index + 1})`,
    isBaseline: index === 0,
    suiteRun: suiteRun(id, undefined),
    aggregates: null,
    memberRuns,
    gradeBySubject: new Map(Object.entries(grades)),
  };
}

// ── toneForDelta ─────────────────────────────────────────────────────────────────────────────────

describe("toneForDelta", () => {
  test("higher-better: up is better, down is worse, tie is neutral (no verdict)", () => {
    expect(toneForDelta(0.1, "higher-better")).toBe("better");
    expect(toneForDelta(-0.1, "higher-better")).toBe("worse");
    expect(toneForDelta(0, "higher-better")).toBe("neutral");
    expect(toneForDelta(null, "higher-better")).toBe("neutral");
  });
  test("lower-better: down is better, up is worse", () => {
    expect(toneForDelta(-0.05, "lower-better")).toBe("better");
    expect(toneForDelta(0.05, "lower-better")).toBe("worse");
  });
});

describe("isErroredMember", () => {
  test("error/aborted/stopped statuses and non-completed outcomes are errored", () => {
    expect(isErroredMember("error", undefined)).toBe(true);
    expect(isErroredMember("aborted", undefined)).toBe(true);
    expect(isErroredMember("stopped", undefined)).toBe(true);
    expect(isErroredMember("completed", "context_overflow")).toBe(true);
    expect(isErroredMember("completed", "completed")).toBe(false);
    expect(isErroredMember("completed", "assertions_failed")).toBe(false);
  });
});

// ── verdict strip ────────────────────────────────────────────────────────────────────────────────

describe("deriveSuiteVerdict", () => {
  test("A → B deltas per metric, cost/tokens lower-better, grade/pass higher-better", () => {
    const compare: SuiteCompareData = {
      baseline: {
        ...side("A", 0, [], {}),
        aggregates: {
          cellsTotal: 4,
          cellsCompleted: 4,
          meanGrade: 0.7,
          gradeStdDev: 0,
          passRateAt05: 0.78,
          totalTokens: 4000,
          execCostUsd: 1.0,
          judgeCostUsd: 0,
        },
      },
      comparison: {
        ...side("B", 1, [], {}),
        aggregates: {
          cellsTotal: 4,
          cellsCompleted: 4,
          meanGrade: 0.82,
          gradeStdDev: 0,
          passRateAt05: 0.91,
          totalTokens: 3600,
          execCostUsd: 1.4,
          judgeCostUsd: 0,
        },
      },
      data: catalog(tests, scenarios, []),
    };
    const metrics = deriveSuiteVerdict(compare);
    const byKey = (key: string) => metrics.find((m) => m.key === key)!;
    expect(byKey("passRate").tone).toBe("better"); // 0.78 → 0.91
    expect(byKey("passRate").deltaText).toBe("+13%");
    expect(byKey("meanGrade").tone).toBe("better"); // +0.12
    expect(byKey("meanGrade").deltaText).toBe("+0.12");
    expect(byKey("execCost").tone).toBe("worse"); // cost up is worse
    expect(byKey("totalTokens").tone).toBe("better"); // tokens down is better
  });

  test("a missing aggregate on either side yields no Δ (honest gap, neutral tone)", () => {
    const compare: SuiteCompareData = {
      baseline: side("A", 0, [], {}),
      comparison: side("B", 1, [], {}),
      data: catalog(tests, scenarios, []),
    };
    for (const m of deriveSuiteVerdict(compare)) {
      expect(m.deltaText).toBeNull();
      expect(m.tone).toBe("neutral");
    }
  });
});

// ── grid ─────────────────────────────────────────────────────────────────────────────────────────

describe("buildSuiteGrid", () => {
  test("grade delta drives the cell tone; both sides resolve → drillable", () => {
    const baseRuns = [
      run({ id: "a-t1-s1", testId: "t1", scenarioId: "s1", suiteRunId: "A", costUsd: 0.2 }),
    ];
    const compRuns = [
      run({ id: "b-t1-s1", testId: "t1", scenarioId: "s1", suiteRunId: "B", costUsd: 0.1 }),
    ];
    const compare: SuiteCompareData = {
      baseline: side("A", 0, baseRuns, { [subjectKey("t1", "s1")]: 0.6 }),
      comparison: side("B", 1, compRuns, { [subjectKey("t1", "s1")]: 0.8 }),
      data: catalog(tests, scenarios, [...baseRuns, ...compRuns]),
    };
    const grid = buildSuiteGrid(compare);
    const cell = grid.cells.get(subjectKey("t1", "s1"));
    expect(cell).toBeTruthy();
    expect(cell?.gradeDelta).toBeCloseTo(0.2);
    expect(cell?.costDelta).toBeCloseTo(-0.1);
    expect(cell?.tone).toBe("better");
    expect(cell?.drillable).toBe(true);
    expect(cell?.base?.representativeRunId).toBe("a-t1-s1");
    expect(cell?.comparison?.representativeRunId).toBe("b-t1-s1");
  });

  test("an errored member forces a red (error) cell and drills into the errored run", () => {
    const baseRuns = [run({ id: "a-t2-s2", testId: "t2", scenarioId: "s2", suiteRunId: "A" })];
    const compRuns = [
      run({ id: "b-t2-s2-ok", testId: "t2", scenarioId: "s2", suiteRunId: "B", repetition: 1 }),
      run({
        id: "b-t2-s2-err",
        testId: "t2",
        scenarioId: "s2",
        suiteRunId: "B",
        repetition: 2,
        status: "error",
        outcome: "error",
      }),
    ];
    const compare: SuiteCompareData = {
      baseline: side("A", 0, baseRuns, { [subjectKey("t2", "s2")]: 0.9 }),
      comparison: side("B", 1, compRuns, {}),
      data: catalog(tests, scenarios, [...baseRuns, ...compRuns]),
    };
    const grid = buildSuiteGrid(compare);
    const cell = grid.cells.get(subjectKey("t2", "s2"));
    expect(cell?.tone).toBe("error");
    expect(cell?.comparison?.errored).toBe(true);
    // Drill prefers the errored member so the comparison lands on the failure.
    expect(cell?.comparison?.representativeRunId).toBe("b-t2-s2-err");
    expect(cell?.drillable).toBe(true);
  });

  test("a subject present on only one side is a non-drillable cell", () => {
    const baseRuns = [run({ id: "a-only", testId: "t1", scenarioId: "s1", suiteRunId: "A" })];
    const compare: SuiteCompareData = {
      baseline: side("A", 0, baseRuns, {}),
      comparison: side("B", 1, [], {}),
      data: catalog(tests, scenarios, baseRuns),
    };
    const grid = buildSuiteGrid(compare);
    const cell = grid.cells.get(subjectKey("t1", "s1"));
    expect(cell?.drillable).toBe(false);
    expect(cell?.gradeDelta).toBeNull();
  });
});

describe("buildSuiteCompareMarkdown", () => {
  test("emits the verdict table and a test × environment matrix with an error marker", () => {
    const baseRuns = [run({ id: "a-t1-s1", testId: "t1", scenarioId: "s1", suiteRunId: "A" })];
    const compRuns = [
      run({
        id: "b-t1-s1",
        testId: "t1",
        scenarioId: "s1",
        suiteRunId: "B",
        status: "error",
        outcome: "error",
      }),
    ];
    const compare: SuiteCompareData = {
      baseline: side("A", 0, baseRuns, {}),
      comparison: side("B", 1, compRuns, {}),
      data: catalog(tests, scenarios, [...baseRuns, ...compRuns]),
    };
    const md = buildSuiteCompareMarkdown(compare);
    expect(md).toContain("# Suite comparison");
    expect(md).toContain("## Verdict");
    expect(md).toContain("## Test × environment");
    expect(md).toContain("⚠ error");
  });
});
