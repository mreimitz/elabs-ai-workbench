import { describe, expect, it } from "vitest";
import type { ContextSegment } from "@mcp-token-footprint/shared";
import { CONTEXT_SEGMENTS } from "@mcp-token-footprint/shared";
import {
  buildContextCurveRows,
  curveLimit,
  deltaPercent,
  deltaTone,
  deriveDeltaBars,
  deriveVerdict,
  isZeroInformation,
  shouldShowCurves,
  type SummaryFormatters,
  type SummaryRun,
} from "./summary-derive";

// A pure, formatter-free fixture builder so the math is tested without the app's Intl helpers.
function segs(over: Partial<Record<ContextSegment, number>> = {}): Record<ContextSegment, number> {
  return CONTEXT_SEGMENTS.reduce(
    (acc, seg) => ({ ...acc, [seg]: over[seg] ?? 0 }),
    {} as Record<ContextSegment, number>,
  );
}

function run(over: Partial<SummaryRun>): SummaryRun {
  return {
    id: "r",
    index: 0,
    letter: "A",
    color: "var(--chart-1)",
    isBaseline: false,
    scenarioName: "Env",
    model: "m",
    statusLabel: "Completed",
    status: "completed",
    outcome: "completed",
    abnormal: false,
    turns: 4,
    toolCalls: 3,
    toolErrors: 0,
    tokensIn: 1000,
    tokensOut: 200,
    totalTokens: 1200,
    // RM-33 — the default fixture is a run that cannot report its cache split (the majority of an
    // existing database). Tests that care set them explicitly.
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheHitRate: null,
    costUsd: 0.01,
    durationMs: 4000,
    peakContextTokens: 5000,
    contextLimit: 100_000,
    peakContextPercent: 5,
    peakSegments: segs(),
    contextTotals: [1000, 2000, 3000, 4000],
    qualityScore: null,
    ...over,
  };
}

// Signed-aware formatters that make assertions readable (mirrors the component's real formatters).
const fmt: SummaryFormatters = {
  number: (v) => String(Math.round(v)),
  cost: (v) => `$${v.toFixed(2)}`,
  duration: (v) => `${Math.round(v)}ms`,
  percent: (v) => `${v.toFixed(0)}%`,
  signedPercent: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`,
  signedNumber: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}`,
};

describe("deltaPercent", () => {
  it("computes a signed percentage against the baseline magnitude", () => {
    expect(deltaPercent(50, 100)).toBe(-50);
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(100, 100)).toBe(0);
  });
  it("returns null when a percentage from a zero baseline is undefined", () => {
    expect(deltaPercent(5, 0)).toBeNull();
    // …but a 0-vs-0 tie is expressible (0%), never null.
    expect(deltaPercent(0, 0)).toBe(0);
  });
});

describe("deltaTone (D-UX9: green better / red worse / neutral ties — NO ✓ on ties)", () => {
  it("lower-better: a reduction is better, an increase is worse", () => {
    expect(deltaTone(-10, "lower-better")).toBe("better");
    expect(deltaTone(10, "lower-better")).toBe("worse");
  });
  it("higher-better inverts", () => {
    expect(deltaTone(10, "higher-better")).toBe("better");
    expect(deltaTone(-10, "higher-better")).toBe("worse");
  });
  it("a tie (0) or a null delta is always neutral", () => {
    expect(deltaTone(0, "lower-better")).toBe("neutral");
    expect(deltaTone(null, "lower-better")).toBe("neutral");
    expect(deltaTone(-10, "neutral")).toBe("neutral");
  });
});

describe("isZeroInformation (collapse degenerate metrics to text — T9e)", () => {
  it("flags all-equal / all-zero metrics", () => {
    expect(isZeroInformation([0, 0])).toBe(true);
    expect(isZeroInformation([5, 5, 5])).toBe(true);
    expect(isZeroInformation([null, null])).toBe(true);
  });
  it("does not flag a metric that actually differs", () => {
    expect(isZeroInformation([1, 2])).toBe(false);
  });
});

describe("deriveDeltaBars", () => {
  const baseline = run({
    id: "a",
    letter: "A",
    isBaseline: true,
    totalTokens: 2600,
    tokensIn: 2000,
    costUsd: 0,
  });
  const b = run({ id: "b", letter: "B", tokensIn: 1000, totalTokens: 1200, costUsd: 0 });

  it("emits one bar per non-baseline run with the correct Δ% and tone", () => {
    const bars = deriveDeltaBars([baseline, b], baseline, false, fmt);
    const tokensIn = bars.find((m) => m.key === "tokensIn")!;
    expect(tokensIn.bars).toHaveLength(1);
    expect(tokensIn.bars[0]!.deltaPercent).toBe(-50); // 1000 vs 2000
    expect(tokensIn.bars[0]!.tone).toBe("better");
  });

  it("collapses an all-$0.00 cost metric to a text line (unpriced model)", () => {
    const bars = deriveDeltaBars([baseline, b], baseline, false, fmt);
    const cost = bars.find((m) => m.key === "cost")!;
    expect(cost.collapsed).toBe(true);
    expect(cost.collapsedText).toContain("unpriced model");
  });

  it("per-turn mode divides accumulating metrics by turns", () => {
    const bars = deriveDeltaBars([baseline, b], baseline, true, fmt);
    const tokensIn = bars.find((m) => m.key === "tokensIn")!;
    // baseline 2000/4 = 500, b 1000/4 = 250 → still −50%
    expect(tokensIn.label).toContain("/ turn");
    expect(tokensIn.bars[0]!.deltaPercent).toBe(-50);
  });
});

describe("deriveVerdict (H3)", () => {
  it("two ABORTED runs get NO recommendation (caveats lead instead — acceptance T9h)", () => {
    const a = run({
      id: "a",
      letter: "A",
      isBaseline: true,
      status: "aborted",
      outcome: "aborted",
      abnormal: true,
      turns: 16,
    });
    const b = run({
      id: "b",
      letter: "B",
      status: "error",
      outcome: "error",
      abnormal: true,
      turns: 1,
    });
    expect(deriveVerdict([a, b], fmt)).toBeNull();
  });

  it("two COMPLETED runs of one test yield a recommendation sentence with a token-slice reason", () => {
    const a = run({
      id: "a",
      letter: "A",
      isBaseline: true,
      totalTokens: 60_000,
      tokensIn: 58_000,
      durationMs: 8000,
      peakSegments: segs({ tool_defs: 40_000, tool_results: 5000 }),
    });
    const b = run({
      id: "b",
      letter: "B",
      totalTokens: 20_000,
      tokensIn: 18_000,
      durationMs: 5000,
      peakSegments: segs({ tool_defs: 2000, tool_results: 3000 }),
    });
    const verdict = deriveVerdict([a, b], fmt);
    expect(verdict).not.toBeNull();
    expect(verdict!.tone).toBe("recommend");
    expect(verdict!.headline).toContain("B");
    expect(verdict!.headline).toContain("recommended");
    // The H3 flagship: the token delta decomposed by context slice (tool definitions dominate).
    const slice = verdict!.reasons.map((r) => r.text).join(" ");
    expect(slice).toContain("tool definitions");
  });

  it("returns null for a single run", () => {
    expect(deriveVerdict([run({ isBaseline: true })], fmt)).toBeNull();
  });
});

describe("context curves", () => {
  it("shows curves only when a run has more than two turns", () => {
    expect(shouldShowCurves([run({ contextTotals: [1, 2] })])).toBe(false);
    expect(shouldShowCurves([run({ contextTotals: [1, 2, 3] })])).toBe(true);
  });

  it("emits valid Date x-values keyed by run id (LineChart Invalid-time guard)", () => {
    const a = run({ id: "a", contextTotals: [10, 20, 30] });
    const b = run({ id: "b", contextTotals: [5, 15] });
    const rows = buildContextCurveRows([a, b]);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.x).toBeInstanceOf(Date);
      expect(Number.isNaN(row.x.getTime())).toBe(false);
    }
    expect(rows[0]).toMatchObject({ a: 10, b: 5 });
    // b ended after two turns. Leaving its third-turn key ABSENT does not break its line — the chart
    // library plots a missing key at y=0, the TOP of the plot, so the SHORTEST run would read as the
    // one whose context exploded. b is held flat at the 15 tokens it actually reached.
    expect(rows[2]!.b).toBe(15);
    expect(rows[2]!.a).toBe(30);
  });

  it("curveLimit is the greatest known window across the set", () => {
    expect(curveLimit([run({ contextLimit: 8000 }), run({ contextLimit: 128_000 })])).toBe(128_000);
    expect(curveLimit([run({ contextLimit: 0 })])).toBe(0);
  });
});

// ── RM-33 WP 3.2 — the cache rows of the Δ panel ──────────────────────────────────────────────────
//
// Compare had no cached row at all, so two runs could differ by 900k tokens and 4x in cost with
// nothing on the page connecting the two. Read and write are separate rows on purpose (D-CT2) and
// point in OPPOSITE directions: a read is a ~0.1x discount (more is better), a write is a 1.25x
// premium (more is worse). One merged "cached" row would have to pick a direction and be wrong half
// the time.

describe("cache metrics in the Δ panel (RM-33 WP 3.2)", () => {
  const baseline = run({
    id: "a",
    letter: "A",
    isBaseline: true,
    cacheReadTokens: 400,
    cacheWriteTokens: 100,
    cacheHitRate: 0.4,
  });
  const b = run({
    id: "b",
    letter: "B",
    cacheReadTokens: 800,
    cacheWriteTokens: 50,
    cacheHitRate: 0.8,
  });

  it("cache read is HIGHER-better — reading more from cache is a discount", () => {
    const row = deriveDeltaBars([baseline, b], baseline, false, fmt).find(
      (m) => m.key === "cacheRead",
    )!;
    expect(row.direction).toBe("higher-better");
    expect(row.bars[0]!.deltaPercent).toBe(100); // 800 vs 400
    expect(row.bars[0]!.tone).toBe("better");
  });

  it("cache write is LOWER-better — writing more to cache is a 1.25x premium", () => {
    const row = deriveDeltaBars([baseline, b], baseline, false, fmt).find(
      (m) => m.key === "cacheWrite",
    )!;
    expect(row.direction).toBe("lower-better");
    expect(row.bars[0]!.deltaPercent).toBe(-50); // 50 vs 100
    expect(row.bars[0]!.tone).toBe("better");
  });

  it("the hit rate is a ratio — the per-turn toggle must NOT divide it again", () => {
    const absolute = deriveDeltaBars([baseline, b], baseline, false, fmt).find(
      (m) => m.key === "cacheHitRate",
    )!;
    const perTurnRow = deriveDeltaBars([baseline, b], baseline, true, fmt).find(
      (m) => m.key === "cacheHitRate",
    )!;
    expect(absolute.baselineText).toBe(perTurnRow.baselineText);
    expect(perTurnRow.label).not.toContain("/ turn");
  });

  it("a set where NO run can answer says 'not measured', never 'no difference to compare'", () => {
    // The default fixture leaves every cache field null — a pre-migration-59 comparison.
    const x = run({ id: "x", letter: "A", isBaseline: true });
    const y = run({ id: "y", letter: "B" });
    const row = deriveDeltaBars([x, y], x, false, fmt).find((m) => m.key === "cacheRead")!;
    expect(row.collapsed).toBe(true);
    expect(row.collapsedText).toContain("not measured for these runs");
    expect(row.collapsedText).toContain("rather than as a zero");
    expect(row.collapsedText).not.toContain("no difference to compare");
    expect(row.bars[0]!.valueText).toBe("—");
  });

  it("an all-equal MEASURED metric still reads as a tie, not as 'not measured'", () => {
    const x = run({ id: "x", letter: "A", isBaseline: true, cacheReadTokens: 500 });
    const y = run({ id: "y", letter: "B", cacheReadTokens: 500 });
    const row = deriveDeltaBars([x, y], x, false, fmt).find((m) => m.key === "cacheRead")!;
    expect(row.collapsed).toBe(true);
    expect(row.collapsedText).toContain("no difference to compare");
    expect(row.collapsedText).not.toContain("not measured");
  });
});
