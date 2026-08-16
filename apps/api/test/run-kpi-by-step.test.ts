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
