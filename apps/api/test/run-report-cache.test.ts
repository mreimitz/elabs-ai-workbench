import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runReportStatisticsSchema,
  runReportStepKpiSchema,
  type RunDetail,
  type Scenario,
  type Test,
} from "@mcp-token-footprint/shared";
import {
  aggregateRunUsage,
  createRunJsonReport,
  createRunMarkdownReport,
} from "../src/reports/reports.js";
import { buildRunReportEnrichment } from "../src/reports/run-report-assembly.js";
import { computeCostBreakdown, estimateCost } from "../src/providers/pricing.js";

// RM-33 WP 3.2 — the run export's cache split + cost breakdown.
//
// The run report was already the most cache-honest surface in the app: it is the only place that
// printed "Cached tokens" at all. What it could not say is the one thing that matters — whether that
// slice was a cache READ (billed ~0.1x input, a discount) or a cache WRITE (billed 1.25x, a PREMIUM).
// These tests pin that distinction, and pin the D-CT6 rule that an unanswerable field is ABSENT
// rather than a fabricated zero.

function fixtureTest(): Test {
  return {
    id: "test-1",
    name: "Cache test",
    userPrompt: "Answer.",
    addedProfiles: [],
    attachments: [],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function fixtureScenario(): Scenario {
  return {
    id: "scn-1",
    name: "Baseline",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [],
    defaultProfiles: [],
    guardrails: {},
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

type CacheShape = "exact" | "merged" | "none";

/**
 * One-turn run whose single `llm_response` step reports the given cache fidelity. `run.tokensIn`
 * stays GROSS in every case (D-CT1) so the three variants are directly comparable.
 */
function fixtureRun(shape: CacheShape, opts: { summaryColumns?: boolean } = {}): RunDetail {
  const usage =
    shape === "exact"
      ? { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900, cacheReadTokens: 800, cacheWriteTokens: 100 }
      : shape === "merged"
        ? { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900 }
        : { inputTokens: 1000, outputTokens: 100 };
  const step: RunDetail["steps"][number] = {
    id: "step-llm",
    runId: "run-1",
    index: 0,
    type: "llm_response",
    label: "claude-sonnet-4",
    status: "ok",
    turnIndex: 0,
    profileTokens: {},
    usageActual: usage,
    context: {
      total: 1100,
      limit: 200_000,
      segments: { system: 10, tool_defs: 20, history: 30, tool_results: 40, output: 50 },
    },
    payload: null,
  };
  const summaryColumns = opts.summaryColumns ?? true;
  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-08-21T00:00:00.000Z",
    durationMs: 1000,
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 1100,
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: 0.0018,
    ...(summaryColumns && shape !== "none" ? { cachedTokens: 900 } : {}),
    ...(summaryColumns && shape === "exact"
      ? { cacheReadTokens: 800, cacheWriteTokens: 100 }
      : {}),
    steps: [step],
    events: [
      { type: "step", step },
      {
        type: "kpi",
        turns: 1,
        toolCalls: 0,
        tokensIn: 1000,
        tokensOut: 100,
        contextTokens: 1100,
        costUsd: 0.0018,
      },
      { type: "status", status: "completed", outcome: "completed", stopReason: "model_stop" },
    ],
    skills: [],
  };
}

function enrich(run: RunDetail) {
  return buildRunReportEnrichment(run, fixtureTest(), fixtureScenario());
}

// ── The shared contract (acceptance 1) ────────────────────────────────────────────────────────────

test("the exported statistics block validates against the SHARED zod schema", () => {
  for (const shape of ["exact", "merged", "none"] as const) {
    const run = fixtureRun(shape);
    const report = createRunJsonReport(run, enrich(run));
    // `.strict()` — a key the contract does not name fails here, which is the whole point of giving
    // this block a schema instead of leaving it an untyped API-local literal.
    runReportStatisticsSchema.parse(report.statistics);
    for (const kpi of Object.values(report.stepKpis)) runReportStepKpiSchema.parse(kpi);
  }
});

// ── The split (acceptance 2) ──────────────────────────────────────────────────────────────────────

test("an EXACT run carries the split in JSON and names both rates in Markdown §3", () => {
  const run = fixtureRun("exact");
  const report = createRunJsonReport(run, enrich(run));
  assert.equal(report.statistics.cachedTokens, 900, "the merged figure is unchanged");
  assert.equal(report.statistics.cacheReadTokens, 800);
  assert.equal(report.statistics.cacheWriteTokens, 100);
  assert.equal(report.statistics.tokensIn, 1000, "D-CT1 — tokensIn stays GROSS, never netted");

  const md = createRunMarkdownReport(run, enrich(run));
  assert.match(md, /- Cached tokens: 900/);
  assert.match(md, /- Cache read: 800 \(billed ~0\.1x input — a discount\)/);
  assert.match(md, /- Cache write: 100 \(billed 1\.25x input — a premium, not a saving\)/);
  assert.doesNotMatch(md, /split: unavailable|split unavailable/i);
});

test("a MERGED run says the split is unavailable rather than implying a discount", () => {
  const run = fixtureRun("merged");
  const report = createRunJsonReport(run, enrich(run));
  assert.equal(report.statistics.cachedTokens, 900, "the merged figure still crosses");
  assert.equal(report.statistics.cacheReadTokens, undefined, "absent ⇒ UNKNOWN, never zero (D-CT6)");
  assert.equal(report.statistics.cacheWriteTokens, undefined);

  const md = createRunMarkdownReport(run, enrich(run));
  assert.match(md, /- Cache read\/write split: unavailable for this run/);
  assert.doesNotMatch(md, /- Cache read: /, "no fabricated read line for a run that cannot answer");
  // The breakdown right below prices the whole slice as a read (the only safe reading of a merged
  // figure), so it must say the number is a FLOOR rather than let it read as a measurement.
  assert.match(md, /- Cost breakdown caveat: this run reported only a merged cached figure/);
  assert.match(md, /the real bill was at least this much and possibly higher/);
});

test("a run with NO cache adds nothing — the §3 lines stay byte-identical to before RM-33", () => {
  const run = fixtureRun("none");
  const md = createRunMarkdownReport(run, enrich(run));
  assert.match(md, /- Cached tokens: 0/);
  assert.doesNotMatch(md, /Cache read/, "a reported zero is an answer; it earns no caveat");
  assert.doesNotMatch(md, /Cache write/);
  assert.doesNotMatch(md, /split: unavailable/);
});

test("the per-step stats line names the halves for an exact turn, and leaves a merged turn alone", () => {
  const exact = fixtureRun("exact");
  assert.match(
    createRunMarkdownReport(exact, enrich(exact)),
    /- Stats: tok↑ 1000, tok↓ 100, cached 900, cache read 800, cache write 100/,
  );
  const merged = fixtureRun("merged");
  const mergedMd = createRunMarkdownReport(merged, enrich(merged));
  assert.match(mergedMd, /- Stats: tok↑ 1000, tok↓ 100, cached 900\n/);
  assert.doesNotMatch(
    mergedMd,
    /- Stats: [^\n]*cache read/,
    "one number cannot honestly be decomposed (D-CT2)",
  );
});

// ── The cost breakdown (D-CT5 — one formula) ──────────────────────────────────────────────────────

test("the cost breakdown decomposes the run's own usage through the ONE cost formula", () => {
  const run = fixtureRun("exact");
  const breakdown = createRunJsonReport(run, enrich(run)).statistics.costBreakdown;
  assert.ok(breakdown, "an enriched report carries the breakdown");
  assert.equal(breakdown.split, "exact");
  // 100 uncached x $3/M + 800 read x $0.30/M + 100 write x $3.75/M + 100 out x $15/M. Compared to
  // 1e-12 because these are IEEE doubles, not decimals — the point is the rate each slice was billed.
  const near = (actual: number, expected: number, what: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-12, `${what}: ${actual} vs ${expected}`);
  near(breakdown.uncachedUsd, (100 * 3) / 1e6, "uncached input at the full rate");
  near(breakdown.cacheReadUsd, (800 * 0.3) / 1e6, "cache read at the ~0.1x rate");
  near(breakdown.cacheWriteUsd, (100 * 3 * 1.25) / 1e6, "cache write at the 1.25x premium");
  near(breakdown.outputUsd, (100 * 15) / 1e6, "output");
  // D-CT5: the report may never carry a second cost formula's answer.
  assert.equal(
    breakdown.totalUsd,
    estimateCost("claude-sonnet-4", aggregateRunUsage(run)),
    "the breakdown IS estimateCost's decomposition, not a re-derivation",
  );
});

test("a write-heavy run reports the cache effect as a PREMIUM, with the sign honoured", () => {
  const run = fixtureRun("exact");
  // Every input token is a cache WRITE: 1.25x input, so caching cost MORE than not caching.
  run.cacheReadTokens = 0;
  run.cacheWriteTokens = 1000;
  run.steps[0]!.usageActual = {
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 1000,
  };
  const md = createRunMarkdownReport(run, enrich(run));
  // 1000 tokens as a write cost 1000 x $3.75/M = $0.00375 where the same tokens uncached cost
  // 1000 x $3/M = $0.003 — $0.00075 MORE, which `toFixed(4)` renders as $0.0007.
  assert.match(
    md,
    /- Cache effect: cost \$0\.0007 MORE than billing every input token at the full rate \(cache writes are a 1\.25x premium\)/,
  );
  assert.doesNotMatch(md, /Cache effect: saved/, "a 1.25x premium must never render as a saving");
});

test("an unpriced model says the cost could not be priced, rather than printing four zeros", () => {
  const run = fixtureRun("exact");
  const scenario: Scenario = { ...fixtureScenario(), model: "not-a-real-model-id" };
  const md = createRunMarkdownReport(run, buildRunReportEnrichment(run, fixtureTest(), scenario));
  assert.match(md, /- Cost breakdown: n\/a \(no price on file for this model/);
});

// ── Additivity (acceptance 6) ─────────────────────────────────────────────────────────────────────

test("a pre-migration run still renders — every added field is simply absent", () => {
  // No `runs.cached_tokens` / `cache_read_tokens` columns at all (a run persisted before migration
  // 59) AND steps that only ever reported a merged figure: the hardest legacy shape.
  const run = fixtureRun("merged", { summaryColumns: false });
  const report = createRunJsonReport(run, { test: fixtureTest(), scenario: fixtureScenario() });
  runReportStatisticsSchema.parse(report.statistics);
  assert.equal(report.statistics.cacheReadTokens, undefined);
  assert.equal(report.statistics.cacheWriteTokens, undefined);
  assert.equal(report.statistics.costBreakdown, undefined, "an un-enriched caller gets no breakdown");
  // Every key the pre-RM-33 export carried is still present with its old meaning.
  for (const key of [
    "turns",
    "toolCalls",
    "tokensIn",
    "tokensOut",
    "cachedTokens",
    "peakContextTokens",
    "contextLimit",
    "estimatedCostUsd",
    "peakContextSegments",
  ]) {
    assert.ok(key in report.statistics, `${key} is still exported`);
  }
  assert.equal(report.statistics.cachedTokens, 900, "the legacy merged figure is unchanged");
  assert.doesNotThrow(() =>
    createRunMarkdownReport(run, { test: fixtureTest(), scenario: fixtureScenario() }),
  );
});

// ── aggregateRunUsage — the one derivation behind both ────────────────────────────────────────────

test("aggregateRunUsage prefers the migration-59 columns and falls back to the steps", () => {
  const withColumns = fixtureRun("exact");
  assert.deepEqual(aggregateRunUsage(withColumns), {
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 900,
    cacheReadTokens: 800,
    cacheWriteTokens: 100,
  });
  // Same run, columns never written (pre-migration): the steps still carry the split verbatim.
  const withoutColumns = fixtureRun("exact", { summaryColumns: false });
  assert.deepEqual(aggregateRunUsage(withoutColumns), {
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 900,
    cacheReadTokens: 800,
    cacheWriteTokens: 100,
  });
  // A merged-only run: the halves stay UNKNOWN. Summing the merged figure as a "read" would price a
  // possible 1.25x premium as a 0.1x discount.
  const merged = aggregateRunUsage(fixtureRun("merged", { summaryColumns: false }));
  assert.equal(merged.cachedInputTokens, 900);
  assert.equal(merged.cacheReadTokens, undefined);
  assert.equal(merged.cacheWriteTokens, undefined);
  assert.equal(computeCostBreakdown("claude-sonnet-4", merged).split, "merged");
});
