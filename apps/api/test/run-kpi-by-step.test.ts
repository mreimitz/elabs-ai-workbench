import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunDetail, RunStep } from "@mcp-token-footprint/shared";
import {
  buildRunKpiByStep,
  finiteNumber,
  kpiSnapshotsByStepId,
  withSummaryTotals,
} from "../src/reports/run-kpi-by-step.js";

// C4 — the per-step cumulative-KPI helper ported from the web replay path (RunConsole.tsx ~671–733).
// These pin the behavior the C4 report relies on: each step gets the cumulative KPIs in effect at it,
// the COST (which steps don't carry) comes from the trailing `kpi` event, and the final step is patched
// with the never-redacted summary totals so a redacted event log still reports the true end state.

function step(id: string, index: number): RunStep {
  return {
    id,
    runId: "run-1",
    index,
    type: "tool_call",
    label: id,
    status: "ok",
    profileTokens: {},
    payload: null,
  };
}

test("finiteNumber collapses non-finite/redacted values to 0", () => {
  assert.equal(finiteNumber(42), 42);
  assert.equal(finiteNumber("[redacted]"), 0, "the redaction sentinel ⇒ 0, not NaN");
  assert.equal(finiteNumber(Number.NaN), 0);
  assert.equal(finiteNumber(undefined), 0);
});

test("kpiSnapshotsByStepId stamps each step with the kpi the engine emits right after it", () => {
  const s1 = step("s1", 0);
  const s2 = step("s2", 1);
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    {
      type: "kpi",
      turns: 1,
      toolCalls: 1,
      tokensIn: 10,
      tokensOut: 5,
      contextTokens: 100,
      costUsd: 0.01,
    },
    { type: "step", step: s2 },
    {
      type: "kpi",
      turns: 2,
      toolCalls: 1,
      tokensIn: 20,
      tokensOut: 9,
      contextTokens: 200,
      costUsd: 0.02,
    },
  ]);

  assert.equal(map.get("s1")?.costUsd, 0.01, "s1 gets the kpi that follows it");
  assert.equal(map.get("s2")?.costUsd, 0.02, "s2 gets the kpi that follows it");
  assert.equal(map.get("s2")?.turns, 2, "cumulative turns advance");
});

test("withSummaryTotals patches the final step with the never-redacted summary totals", () => {
  const s1 = step("s1", 0);
  const s2 = step("s2", 1);
  // Simulate a redacted event log: tokens reconstruct to 0, cost survives only on the last kpi.
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    { type: "step", step: s2 },
    {
      type: "kpi",
      turns: 0,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      contextTokens: 0,
      costUsd: 0.05,
    },
  ]);
  const detail = {
    steps: [s1, s2],
    turns: 3,
    toolCalls: 2,
    tokensIn: 137,
    tokensOut: 23,
    peakContextTokens: 9000,
    costUsd: 0.05,
  } as unknown as RunDetail;

  const patched = withSummaryTotals(map, detail);
  const last = patched.get("s2");
  assert.equal(last?.tokensIn, 137, "final step recovers true tokensIn from the summary");
  assert.equal(last?.turns, 3, "final step recovers true turns from the summary");
  assert.equal(last?.costUsd, 0.05, "cost carried through");
});

test("buildRunKpiByStep is the one-call combination (events walk + summary patch)", () => {
  const s1 = step("s1", 0);
  const detail = {
    steps: [s1],
    events: [
      { type: "step", step: s1 },
      {
        type: "kpi",
        turns: 1,
        toolCalls: 1,
        tokensIn: 5,
        tokensOut: 2,
        contextTokens: 50,
        costUsd: 0.001,
      },
    ],
    turns: 1,
    toolCalls: 1,
    tokensIn: 5,
    tokensOut: 2,
    peakContextTokens: 50,
    costUsd: 0.001,
  } as unknown as RunDetail;

  const map = buildRunKpiByStep(detail);
  assert.equal(
    map.get("s1")?.costUsd,
    0.001,
    "single step stamped with its cumulative KPI incl. cost",
  );
});

// ── RM-33 WP 3.2 — the cache composition on each per-step snapshot ─────────────────────────────────
//
// The economics chips in `StepLog` are DIFFERENCES between consecutive snapshots, so without the
// cache trio on the snapshots themselves the chips stay cache-blind no matter what the component
// does. Two sources feed them, in this order: the `kpi` event's own fields, and — for the runs
// recorded before RM-33, which is most of an existing database — the per-step `usageActual` the steps
// have always carried. A field neither source knows is ABSENT, never zero (D-CT6).

function llmStep(id: string, index: number, usage?: RunStep["usageActual"]): RunStep {
  return {
    id,
    runId: "run-1",
    index,
    type: "llm_response",
    label: id,
    status: "ok",
    profileTokens: {},
    payload: null,
    ...(usage ? { usageActual: usage } : {}),
  };
}

test("a kpi event that carries the cache trio wins — it is the engine's own roll-up", () => {
  const s1 = llmStep("s1", 0, { inputTokens: 100, outputTokens: 10 });
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    {
      type: "kpi",
      turns: 1,
      toolCalls: 0,
      tokensIn: 100,
      tokensOut: 10,
      contextTokens: 110,
      costUsd: 0.001,
      cachedTokens: 90,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
    },
  ]);
  assert.equal(map.get("s1")?.cacheReadTokens, 80);
  assert.equal(map.get("s1")?.cacheWriteTokens, 10);
  assert.equal(map.get("s1")?.cachedTokens, 90);
});

test("a pre-RM-33 event log falls back to the steps, and the per-step DELTA is derivable", () => {
  // Neither `kpi` event carries a cache field — exactly what every run recorded before RM-33 looks
  // like on replay. The steps beside them do.
  const s1 = llmStep("s1", 0, {
    inputTokens: 100,
    outputTokens: 10,
    cachedInputTokens: 90,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
  });
  const s2 = llmStep("s2", 1, {
    inputTokens: 200,
    outputTokens: 20,
    cachedInputTokens: 195,
    cacheReadTokens: 190,
    cacheWriteTokens: 5,
  });
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    { type: "kpi", turns: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, contextTokens: 110, costUsd: 0.001 },
    { type: "step", step: s2 },
    { type: "kpi", turns: 2, toolCalls: 0, tokensIn: 300, tokensOut: 30, contextTokens: 330, costUsd: 0.003 },
  ]);
  assert.equal(map.get("s1")?.cacheReadTokens, 80, "cumulative after s1");
  assert.equal(map.get("s2")?.cacheReadTokens, 270, "cumulative after s2 (80 + 190)");
  assert.equal(map.get("s2")?.cacheWriteTokens, 15, "cumulative writes (10 + 5)");
  // The property the StepLog chips need: s2's OWN cache is the difference of the two snapshots.
  const own = (map.get("s2")?.cacheReadTokens ?? 0) - (map.get("s1")?.cacheReadTokens ?? 0);
  assert.equal(own, 190, "the per-step delta reproduces the step's own cache read");
});

test("a MERGED-only turn leaves the halves absent — never summed in as a 'read'", () => {
  const s1 = llmStep("s1", 0, { inputTokens: 100, outputTokens: 10, cachedInputTokens: 90 });
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    { type: "kpi", turns: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, contextTokens: 110, costUsd: 0.001 },
  ]);
  assert.equal(map.get("s1")?.cachedTokens, 90, "the merged figure still crosses");
  assert.equal(map.get("s1")?.cacheReadTokens, undefined, "D-CT2 — a merged figure is not a read");
  assert.equal(map.get("s1")?.cacheWriteTokens, undefined);
});

test("a run with no cache anywhere carries NO cache keys at all — absent, not zero (D-CT6)", () => {
  const s1 = llmStep("s1", 0, { inputTokens: 100, outputTokens: 10 });
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    { type: "kpi", turns: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, contextTokens: 110, costUsd: 0.001 },
  ]);
  const snapshot = map.get("s1");
  assert.ok(snapshot);
  assert.equal("cachedTokens" in snapshot, false);
  assert.equal("cacheReadTokens" in snapshot, false);
  assert.equal("cacheWriteTokens" in snapshot, false);
});

test("withSummaryTotals recovers the final step's cache trio from the migration-59 run columns", () => {
  const s1 = llmStep("s1", 0);
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    { type: "kpi", turns: 1, toolCalls: 0, tokensIn: 0, tokensOut: 0, contextTokens: 0, costUsd: 0.05 },
  ]);
  const detail = {
    steps: [s1],
    turns: 1,
    toolCalls: 0,
    tokensIn: 1000,
    tokensOut: 100,
    peakContextTokens: 1100,
    costUsd: 0.05,
    cachedTokens: 900,
    cacheReadTokens: 800,
    cacheWriteTokens: 100,
  } as unknown as RunDetail;
  const last = withSummaryTotals(map, detail).get("s1");
  assert.equal(last?.cacheReadTokens, 800);
  assert.equal(last?.cacheWriteTokens, 100);
  assert.equal(last?.cachedTokens, 900);
});

test("a run whose cache columns are NULL keeps the field ABSENT on the final snapshot", () => {
  const s1 = llmStep("s1", 0);
  const map = kpiSnapshotsByStepId([
    { type: "step", step: s1 },
    { type: "kpi", turns: 1, toolCalls: 0, tokensIn: 0, tokensOut: 0, contextTokens: 0, costUsd: 0.05 },
  ]);
  const detail = {
    steps: [s1],
    turns: 1,
    toolCalls: 0,
    tokensIn: 1000,
    tokensOut: 100,
    peakContextTokens: 1100,
    costUsd: 0.05,
  } as unknown as RunDetail;
  const last = withSummaryTotals(map, detail).get("s1");
  assert.equal("cacheReadTokens" in (last ?? {}), false, "unknowable ⇒ absent, never a fake zero");
});
