import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuiteRun } from "@mcp-token-footprint/shared";
import {
  createSuiteRunJsonReport,
  createSuiteRunMarkdownReport,
  type SuiteRunReportCell,
  type SuiteRunReportData,
} from "../src/reports/suite-run-report.js";

// Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 3.2, D-CS4/D-CS8) — the suite-run report
// mirrors the run report's `costBasis` marker + accuracy footnote for any member whose cost is a
// subscription shadow-price estimate (WP 2.2 already read `costBasis` off member runs for the
// cross-run rating report's `subscriptionRunIds`; this covers the SAME marker on the suite-run
// export's `cells`). Exercises the two PURE builders directly (no DB) with a minimal hand-built
// `SuiteRun` + `SuiteRunReportData` — the same pattern `run-report.test.ts` uses for the run report,
// and reuses that file's exact wording constant so the two documents never drift apart.

function fixtureSuiteRun(): SuiteRun {
  return {
    id: "suite-run-1",
    status: "completed",
    configSnapshot: { repetitions: 1, maxConcurrency: 1 },
    startedAt: "2026-06-20T00:00:00.000Z",
    endedAt: "2026-06-20T00:01:00.000Z",
  };
}

function fixtureCell(overrides: Partial<SuiteRunReportCell> = {}): SuiteRunReportCell {
  return {
    runId: "run-1",
    testId: "test-1",
    testName: "List files test",
    scenarioId: "scn-1",
    scenarioName: "Baseline scenario",
    repetition: 1,
    status: "completed",
    score: 0.8,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
    turns: 1,
    toolCalls: 1,
    ...overrides,
  };
}

function fixtureData(cells: SuiteRunReportCell[]): SuiteRunReportData {
  return {
    suiteName: "My suite",
    cells,
    analytics: { scatter: [], breakdowns: [] },
    embed: "summary",
    suiteReport: null,
  };
}

test("createSuiteRunJsonReport: a subscription member's cell carries costBasis 'subscription_reference'", () => {
  const cell = fixtureCell({ costBasis: "subscription_reference" });
  const report = createSuiteRunJsonReport(fixtureSuiteRun(), fixtureData([cell]));
  assert.equal(
    report.cells[0]?.costBasis,
    "subscription_reference",
    "the cell's costBasis flags the shadow-price cost",
  );
});

test("createSuiteRunJsonReport: an ordinary member's cell carries no costBasis key (unchanged)", () => {
  const report = createSuiteRunJsonReport(fixtureSuiteRun(), fixtureData([fixtureCell()]));
  assert.ok(
    !("costBasis" in (report.cells[0] as object)),
    "no costBasis key for an api_exact/absent member — cell stays byte-identical",
  );
});

test("createSuiteRunMarkdownReport: a subscription member's Cost is starred and the shared footnote renders", () => {
  const cell = fixtureCell({ costBasis: "subscription_reference" });
  const md = createSuiteRunMarkdownReport(fixtureSuiteRun(), fixtureData([cell]));
  assert.match(md, /\$0\.0100 \*/, "the subscription member's Cost cell is starred");
  assert.match(
    md,
    /> \*\*\\\* Cost note — subscription reference\.\*\* This run executed on the Claude subscription/,
    "the shared accuracy footnote renders under the Cells table",
  );
  assert.match(md, /a REFERENCE ESTIMATE/, "footnote states the cost is a reference estimate");
  assert.match(md, /Token counts are provider-exact/, "footnote states token counts are exact");
  assert.match(
    md,
    /Logprob-weighted outcome judging is unavailable/,
    "shares the exact run-report wording (single source of truth)",
  );
});

test("createSuiteRunMarkdownReport: an all-api_exact suite run renders no subscription marker or footnote", () => {
  const md = createSuiteRunMarkdownReport(fixtureSuiteRun(), fixtureData([fixtureCell()]));
  assert.ok(!md.includes("subscription reference"), "no subscription marker for an api_exact member");
  assert.ok(!md.includes("Cost note"), "no accuracy footnote when no member is a subscription run");
  assert.match(md, /\$0\.0100 \|/, "the Cost cell has no star suffix");
});
