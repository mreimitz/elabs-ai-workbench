// RM-33 WP 3.2 — the run export's `statistics` / `stepKpis` wire contract.
//
// These shapes have crossed the wire since the C4 run export shipped, but they lived as API-local
// object literals with a HAND-WRITTEN mirror in `apps/web/.../analytics-derive.ts` — a wire shape
// with no type and no schema, which `.claude/rules/architecture.md` forbids. The tests below pin the
// two properties that make the contract worth having:
//
//   1. the schemas accept exactly what the API builds (a pre-RM-33 document included — every added
//      field is optional, so an old document still validates), and
//   2. `.strict()` bites, so a key nobody declared is a failure rather than silent drift.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runReportStatisticsSchema, runReportStepKpiSchema } from "./schemas.js";
import type { RunReportStatistics, RunReportStepKpi } from "./types.js";

/** The `statistics` block a run recorded BEFORE RM-33 produces: no split, no breakdown. */
const legacyStatistics: RunReportStatistics = {
  turns: 3,
  toolCalls: 2,
  tokensIn: 1000,
  tokensOut: 200,
  cachedTokens: 0,
  peakContextTokens: 900,
  contextLimit: 200_000,
  estimatedCostUsd: 0.01,
  peakContextSegments: null,
};

test("a pre-RM-33 statistics block still validates — every added field is optional", () => {
  const parsed = runReportStatisticsSchema.parse(legacyStatistics);
  assert.equal(parsed.cacheReadTokens, undefined, "absent ⇒ UNKNOWN, not a zero (D-CT6)");
  assert.equal(parsed.cacheWriteTokens, undefined);
  assert.equal(parsed.costBreakdown, undefined);
});

test("a cache-aware statistics block validates with the split and the breakdown", () => {
  const stats: RunReportStatistics = {
    ...legacyStatistics,
    cachedTokens: 900,
    cacheReadTokens: 800,
    cacheWriteTokens: 100,
    endStateContextTokens: 850,
    costBasis: "api_exact",
    costBreakdown: {
      uncachedUsd: 0.0003,
      cacheReadUsd: 0.00024,
      cacheWriteUsd: 0.000375,
      outputUsd: 0.003,
      totalUsd: 0.003915,
      savedVsUncachedUsd: 0.000_2,
      priced: true,
      split: "exact",
    },
    peakContextSegments: {
      system: 10,
      tool_defs: 20,
      history: 30,
      tool_results: 5,
      output: 2,
    },
  };
  const parsed = runReportStatisticsSchema.parse(stats);
  assert.equal(parsed.cacheReadTokens, 800);
  assert.equal(parsed.costBreakdown?.split, "exact");
});

test("statistics is .strict() — an undeclared key is a failure, not silent drift", () => {
  const rogue = { ...legacyStatistics, cachedInputTokens: 900 };
  assert.throws(() => runReportStatisticsSchema.parse(rogue), /unrecognized|Unrecognized/i);
});

test("a savedVsUncachedUsd may be NEGATIVE — a cache write is a 1.25x premium, not a saving", () => {
  const stats: RunReportStatistics = {
    ...legacyStatistics,
    costBreakdown: {
      uncachedUsd: 0,
      cacheReadUsd: 0,
      cacheWriteUsd: 1.25,
      outputUsd: 0,
      totalUsd: 1.25,
      savedVsUncachedUsd: -0.25,
      priced: true,
      split: "exact",
    },
  };
  assert.equal(runReportStatisticsSchema.parse(stats).costBreakdown?.savedVsUncachedUsd, -0.25);
});

test("a step KPI snapshot validates with and without the cache trio", () => {
  const legacy: RunReportStepKpi = {
    turns: 1,
    toolCalls: 0,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 120,
    costUsd: 0.001,
  };
  assert.equal(runReportStepKpiSchema.parse(legacy).cacheReadTokens, undefined);
  const cacheAware: RunReportStepKpi = {
    ...legacy,
    cachedTokens: 90,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
  };
  assert.equal(runReportStepKpiSchema.parse(cacheAware).cacheWriteTokens, 10);
  assert.throws(
    () => runReportStepKpiSchema.parse({ ...legacy, cacheRead: 80 }),
    /unrecognized|Unrecognized/i,
    "a near-miss key name is caught, not absorbed",
  );
});
