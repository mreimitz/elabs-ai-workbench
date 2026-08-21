import type { RunStep } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  deriveCachedTokenRows,
  derivePerStepEconomics,
  rollupSubtreeEconomics,
  type StepCumulativeKpi,
} from "./analytics-derive";

function step(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

function kpi(over: Partial<StepCumulativeKpi>): StepCumulativeKpi {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, ...over };
}

describe("derivePerStepEconomics", () => {
  test("diffs consecutive cumulative snapshots into a per-step delta, first step diffs against zero", () => {
    const s0 = step({ id: "s0", index: 0, type: "llm_response", durationMs: 100 });
    const s1 = step({ id: "s1", index: 1, type: "tool_call", durationMs: 50 });
    const cumulative = new Map<string, StepCumulativeKpi>([
      ["s0", kpi({ tokensIn: 100, tokensOut: 20, costUsd: 0.01 })],
      ["s1", kpi({ tokensIn: 130, tokensOut: 20, costUsd: 0.015 })],
    ]);

    const out = derivePerStepEconomics([s0, s1], cumulative);

    expect(out.get("s0")).toEqual({
      tokensInDelta: 100,
      tokensOutDelta: 20,
      costUsdDelta: 0.01,
      durationMs: 100,
    });
    expect(out.get("s1")).toEqual({
      tokensInDelta: 30,
      tokensOutDelta: 0,
      costUsdDelta: expect.closeTo(0.005, 10),
      durationMs: 50,
    });
  });

  test("a step with no snapshot entry contributes a zero delta, never a guess", () => {
    const s0 = step({ id: "s0", index: 0, type: "context_event", durationMs: 5 });
    const out = derivePerStepEconomics([s0], new Map());
    expect(out.get("s0")).toEqual({
      tokensInDelta: 0,
      tokensOutDelta: 0,
      costUsdDelta: 0,
      durationMs: 5,
    });
  });

  test("a null cumulative map (no snapshots loaded, e.g. still live) zeroes every delta but keeps durationMs", () => {
    const s0 = step({ id: "s0", index: 0, type: "tool_call", durationMs: 12 });
    const out = derivePerStepEconomics([s0], null);
    expect(out.get("s0")).toEqual({
      tokensInDelta: 0,
      tokensOutDelta: 0,
      costUsdDelta: 0,
      durationMs: 12,
    });
  });

  test("a judge_call step reads its OWN judge-ledger payload fields, not the generic run-cost diff", () => {
    const rating = step({ id: "r1", index: 0, type: "context_event", spanKind: "rating" });
    const judge = step({
      id: "j1",
      index: 1,
      type: "context_event",
      spanKind: "judge_call",
      parentStepId: "r1",
      payload: { judgeTokensIn: 400, judgeTokensOut: 120, judgeCostUsd: 0.03 },
    });
    // The run's main cumulative ledger doesn't move for a rating/judge_call step (grading is a
    // SEPARATE ledger) — snapshot entries stay flat at the run's final totals either way.
    const cumulative = new Map<string, StepCumulativeKpi>([
      ["r1", kpi({ tokensIn: 500, tokensOut: 200, costUsd: 0.2 })],
      ["j1", kpi({ tokensIn: 500, tokensOut: 200, costUsd: 0.2 })],
    ]);

    const out = derivePerStepEconomics([rating, judge], cumulative);
    // The judge_call's economics come from its OWN payload, ignoring the flat run-ledger diff (0).
    expect(out.get("j1")).toEqual({
      tokensInDelta: 400,
      tokensOutDelta: 120,
      costUsdDelta: 0.03,
      durationMs: null,
    });
  });
});

describe("rollupSubtreeEconomics", () => {
  test("sums a parent's own economics with every descendant's", () => {
    const perStep = new Map([
      ["parent", { tokensInDelta: 10, tokensOutDelta: 5, costUsdDelta: 0.01, durationMs: 200 }],
      ["child1", { tokensInDelta: 100, tokensOutDelta: 20, costUsdDelta: 0.02, durationMs: 50 }],
      ["child2", { tokensInDelta: 50, tokensOutDelta: 10, costUsdDelta: 0.01, durationMs: 30 }],
    ]);
    const childrenByParentId = new Map([["parent", ["child1", "child2"]]]);

    const rollup = rollupSubtreeEconomics("parent", childrenByParentId, perStep);

    expect(rollup.tokensInDelta).toBe(160);
    expect(rollup.tokensOutDelta).toBe(35);
    expect(rollup.costUsdDelta).toBeCloseTo(0.04, 10);
    // durationMs is the PARENT's own value — never summed with children (they sit inside its span).
    expect(rollup.durationMs).toBe(200);
  });

  test("a leaf with no children rolls up to exactly its own economics", () => {
    const perStep = new Map([
      ["leaf", { tokensInDelta: 7, tokensOutDelta: 3, costUsdDelta: 0.001, durationMs: 10 }],
    ]);
    const rollup = rollupSubtreeEconomics("leaf", new Map(), perStep);
    expect(rollup).toEqual({ tokensInDelta: 7, tokensOutDelta: 3, costUsdDelta: 0.001, durationMs: 10 });
  });

  test("a stepId missing from perStep rolls up to zero (never throws)", () => {
    const rollup = rollupSubtreeEconomics("unknown", new Map(), new Map());
    expect(rollup).toEqual({ tokensInDelta: 0, tokensOutDelta: 0, costUsdDelta: 0, durationMs: null });
  });

  test("recurses through a multi-level subtree", () => {
    const perStep = new Map([
      ["a", { tokensInDelta: 1, tokensOutDelta: 0, costUsdDelta: 0, durationMs: null }],
      ["b", { tokensInDelta: 2, tokensOutDelta: 0, costUsdDelta: 0, durationMs: null }],
      ["c", { tokensInDelta: 4, tokensOutDelta: 0, costUsdDelta: 0, durationMs: null }],
    ]);
    const childrenByParentId = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
    ]);
    expect(rollupSubtreeEconomics("a", childrenByParentId, perStep).tokensInDelta).toBe(7);
  });
});

// ── RM-33 WP 3.1 (D-CT2) — the input-composition rows behind the Analytics chart ────────────────
//
// The pre-RM-33 chart stacked `cached` against `uncached`. That merged a cache READ (~0.1x the input
// rate — a discount) with a cache WRITE (1.25x — a premium) into one block that read as savings
// whichever it happened to be. These pin the separation.

describe("deriveCachedTokenRows (RM-33)", () => {
  const llm = (id: string, usage: RunStep["usageActual"], turnIndex: number): RunStep =>
    step({ id, type: "llm_response", usageActual: usage, turnIndex });

  test("splits an exact record into uncached / cache read / cache write", () => {
    const rows = deriveCachedTokenRows([
      llm("s1", { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 100 }, 0),
    ]);
    expect(rows).toEqual([
      { turn: "Turn 1", uncached: 100, cacheRead: 800, cacheWrite: 100, mergedCache: null },
    ]);
  });

  test("a cache WRITE is never folded into the read series", () => {
    // The tooth: if these two ever share a series again, an expensive turn renders as a cheap one.
    const rows = deriveCachedTokenRows([
      llm("s1", { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 900 }, 0),
    ]);
    expect(rows[0]?.cacheRead).toBe(0);
    expect(rows[0]?.cacheWrite).toBe(900);
  });

  test("the three slices re-sum to the GROSS input (D-CT1 — a decomposition, not a subtraction)", () => {
    const rows = deriveCachedTokenRows([
      llm("s1", { inputTokens: 1234, outputTokens: 0, cacheReadTokens: 900, cacheWriteTokens: 34 }, 0),
    ]);
    const row = rows[0];
    expect((row?.uncached ?? 0) + (row?.cacheRead ?? 0) + (row?.cacheWrite ?? 0)).toBe(1234);
  });

  test("a merged-only record goes to its OWN series, never attributed to reads", () => {
    const rows = deriveCachedTokenRows([
      llm("s1", { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 900 }, 0),
    ]);
    expect(rows).toEqual([
      { turn: "Turn 1", uncached: 100, cacheRead: null, cacheWrite: null, mergedCache: 900 },
    ]);
  });

  test("a record with no cache at all puts the whole input in `uncached`", () => {
    const rows = deriveCachedTokenRows([llm("s1", { inputTokens: 500, outputTokens: 10 }, 0)]);
    expect(rows).toEqual([
      { turn: "Turn 1", uncached: 500, cacheRead: 0, cacheWrite: 0, mergedCache: null },
    ]);
  });

  test("a provider reporting more cache than input is clamped, never negative", () => {
    const rows = deriveCachedTokenRows([
      llm("s1", { inputTokens: 100, outputTokens: 0, cacheReadTokens: 500 }, 0),
    ]);
    expect(rows[0]?.uncached).toBe(0);
  });

  test("steps without provider usage are skipped entirely", () => {
    const rows = deriveCachedTokenRows([
      step({ id: "t1", type: "tool_call" }),
      llm("s1", { inputTokens: 100, outputTokens: 0, cacheReadTokens: 50 }, 0),
    ]);
    expect(rows).toHaveLength(1);
  });
});
