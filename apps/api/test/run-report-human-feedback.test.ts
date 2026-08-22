// Observability Phase 6 (AM-OB2) — the run export's `humanFeedback` block.
//
// WP 2.5 rendered human feedback in the console only and DEFERRED carrying it in the exported
// document (`grep -rn feedback apps/api/src/reports/` returned zero before this WP), so a report
// handed to someone else silently dropped the operator's verdict, their note and — once AM-OB2
// existed — their corrected answer. This file covers both halves:
//
//   1. THE BUILDERS (pure): the three honest states. No `humanFeedback` argument ⇒ no key and no
//      Markdown section at all (UNKNOWN — an intentionally cheap caller); `{ entries: [] }` ⇒ the
//      section renders and says there is none; a captured correction ⇒ its own labelled sub-block,
//      distinct from the verdict and from any note.
//   2. THE ASSEMBLY (over a real DB): `buildRunJsonReport`/`buildRunMarkdownReport` — the two lines
//      `GET /api/reports/run/:id/{json,markdown}` are — read the feedback ledger themselves, so the
//      block is present on the real endpoint rather than only when a test remembers to pass it.
//
// AR6 / D-OB15: the block is a SIBLING of `rating`, never a member. `RunReportService.compose` is
// never given the feedback repository; the assembly does two separate reads. The byte-identity
// regression that proves grading is unaffected lives in `run-feedback.test.ts`.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  buildRunReportHumanFeedback,
  type RunDetail,
  type RunFeedback,
  type Scenario,
  type Test,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RunReportService } from "../src/grading/run-report.js";
import { RunFeedbackRepository } from "../src/observability/feedback.js";
import { createRunJsonReport, createRunMarkdownReport } from "../src/reports/reports.js";
import {
  buildRunJsonReport,
  buildRunMarkdownReport,
  type RunReportSources,
} from "../src/reports/run-report-assembly.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

const NOW = "2026-08-22T00:00:00.000Z";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

// ── Fixtures for the pure builders ──────────────────────────────────────────────────────────────

function fixtureTest(): Test {
  return {
    id: "test-1",
    name: "List files test",
    userPrompt: "Use the tools, then answer.",
    addedProfiles: [],
    attachments: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function fixtureScenario(): Scenario {
  return {
    id: "scn-1",
    name: "Baseline scenario",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function fixtureRun(): RunDetail {
  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: NOW,
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    steps: [],
    events: [],
  } as unknown as RunDetail;
}

function feedbackRow(over: Partial<RunFeedback> = {}): RunFeedback {
  return {
    id: "fb-1",
    runId: "run-1",
    key: "verdict",
    score: -1,
    comment: "Wrong tool order.",
    source: "human",
    createdAt: NOW,
    ...over,
  };
}

const enrich = { test: fixtureTest(), scenario: fixtureScenario() };

// ── 1. The pure builders — three honest states ──────────────────────────────────────────────────

test("JSON: omitting humanFeedback leaves NO key (unknown ≠ empty) and the key order unchanged", () => {
  const report = createRunJsonReport(fixtureRun(), enrich);
  assert.equal("humanFeedback" in report, false);
  assert.deepEqual(Object.keys(report), [
    "generatedAt",
    "test",
    "scenario",
    "statistics",
    "stepKpis",
    "run",
  ]);
});

test("JSON: an EMPTY block is carried as `{ entries: [] }` — 'we looked and there is none'", () => {
  const report = createRunJsonReport(fixtureRun(), enrich, undefined, { entries: [] });
  assert.deepEqual(report.humanFeedback, { entries: [] });
  assert.equal(
    "correctedOutput" in (report.humanFeedback ?? {}),
    false,
    "no correction key is invented",
  );
});

test("JSON: a captured correction rides in `correctedOutput`, beside (never inside) `rating`", () => {
  const rows = [feedbackRow(), feedbackRow({ id: "fb-2", key: "corrected_output", score: undefined, comment: "42." })];
  const report = createRunJsonReport(
    fixtureRun(),
    enrich,
    undefined,
    buildRunReportHumanFeedback(rows),
  );
  assert.equal(report.humanFeedback?.correctedOutput, "42.");
  assert.equal(report.humanFeedback?.entries.length, 2, "every row travels, not just the correction");
  assert.equal("rating" in report, false, "the rating block is separate and was not passed");
});

test("Markdown: omitting humanFeedback renders NO section at all", () => {
  const md = createRunMarkdownReport(fixtureRun(), enrich);
  assert.equal(/^## Human feedback/m.test(md), false);
});

test("Markdown: an empty block renders the section with an honest one-liner", () => {
  const md = createRunMarkdownReport(fixtureRun(), enrich, undefined, { entries: [] });
  assert.match(md, /^## Human feedback/m);
  assert.match(md, /_No human feedback was recorded for this run\._/);
  // "No correction was CAPTURED" — never "the answer needed none".
  assert.match(md, /_No corrected answer was captured for this run\._/);
});

test("Markdown: the corrected answer is its OWN labelled sub-block, distinct from the note", () => {
  const rows = [
    feedbackRow({ comment: "Wrong tool order." }),
    feedbackRow({ id: "fb-2", key: "corrected_output", score: undefined, comment: "It should have said 42." }),
  ];
  const md = createRunMarkdownReport(fixtureRun(), enrich, undefined, buildRunReportHumanFeedback(rows));

  assert.match(md, /^## Human feedback/m);
  assert.match(md, /^### Corrected answer/m);
  assert.match(md, /It should have said 42\./);
  assert.match(md, /^### Recorded feedback/m);
  assert.match(md, /Wrong tool order\./, "the verdict's note is listed too");
  assert.equal(
    /_No corrected answer was captured/.test(md),
    false,
    "a captured correction must not also print the absence line",
  );
  // The section sits AFTER §1 and BEFORE §2 — no existing section was renumbered.
  assert.ok(md.indexOf("## 1. Rating & verdict") < md.indexOf("## Human feedback"));
  assert.ok(md.indexOf("## Human feedback") < md.indexOf("## 2. Summary"));
});

test("Markdown: a step-scoped correction is LISTED with its scope but is NOT the run's answer", () => {
  const rows = [
    feedbackRow({
      id: "fb-3",
      key: "corrected_output",
      score: undefined,
      stepId: "run-1:step:2",
      comment: "this ONE turn was wrong",
    }),
  ];
  const md = createRunMarkdownReport(fixtureRun(), enrich, undefined, buildRunReportHumanFeedback(rows));
  // It travels in the table — nothing a human wrote is dropped …
  assert.match(md, /\| step run-1:step:2 \|/);
  assert.match(md, /this ONE turn was wrong/);
  // … but a correction of one TURN is not a correction of the run's ANSWER, so the labelled
  // "Corrected answer" block must still say none was captured (it is what promote-to-test reads).
  assert.match(md, /_No corrected answer was captured for this run\._/);
});

// ── 2. The assembly — what the real endpoint returns ────────────────────────────────────────────

function seedAssembly(): { sources: RunReportSources; runId: string; feedback: RunFeedbackRepository } {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  const runs = new RunRepository(db);
  const testRepo = new TestRepository(db);
  const tests = new TestService(testRepo);
  const feedback = new RunFeedbackRepository(db);

  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run("prov-1", "anthropic", "Claude", NOW, NOW);
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run("scn-1", "Baseline scenario", "prov-1", "claude-sonnet-4", NOW, NOW);
  const created = tests.create({ name: "List files test", userPrompt: "go", addedProfiles: [] });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd, tokens_in, tokens_out)
     VALUES ('run-1',?, 'scn-1','automated','completed','completed',?,0,0,0)`,
  ).run(created.id, NOW);

  const sources: RunReportSources = {
    runs,
    tests,
    // Only `get` is reached by the assembly; a real ScenarioService needs the scan + skill
    // repositories, which this test has no use for.
    scenarios: { get: () => fixtureScenario() } as unknown as ScenarioService,
    runReports: new RunReportService(new GradeRepository(db), runs),
    feedback,
  };
  return { sources, runId: "run-1", feedback };
}

test("assembly: the exported JSON carries `humanFeedback` even when the run has none", () => {
  const { sources, runId } = seedAssembly();
  const report = buildRunJsonReport(sources, runId);
  assert.deepEqual(
    report.humanFeedback,
    { entries: [] },
    "the endpoint always reports what it looked at — never an ambiguous missing key",
  );
});

test("assembly: a corrected answer written through the WP1.5 API reaches BOTH exports", () => {
  const { sources, runId, feedback } = seedAssembly();
  feedback.upsert(runId, { key: "verdict", score: -1, comment: "Wrong tool order." });
  feedback.upsert(runId, { key: "corrected_output", comment: "It should have said 42." });

  const json = buildRunJsonReport(sources, runId);
  assert.equal(json.humanFeedback?.correctedOutput, "It should have said 42.");
  assert.equal(json.humanFeedback?.entries.length, 2);

  const md = buildRunMarkdownReport(sources, runId);
  assert.match(md, /^## Human feedback/m);
  assert.match(md, /It should have said 42\./);
  assert.match(md, /Wrong tool order\./);
});

test("assembly: the RATING document never carries the feedback (AR6 — two ledgers, two reads)", () => {
  const { sources, runId, feedback } = seedAssembly();
  // `generatedAt` is a clock stamp, pinned so the comparison is about the rating's CONTENT.
  const compose = () =>
    JSON.stringify({ ...sources.runReports.compose(runId), generatedAt: "PINNED" });
  const before = compose();
  feedback.upsert(runId, { key: "corrected_output", comment: "It should have said 42." });
  const after = compose();
  assert.equal(
    after,
    before,
    "RunReportService.compose is byte-identical with and without a corrected answer",
  );
  assert.equal(after.includes("42."), false, "no feedback text leaks into the rating document");
});
