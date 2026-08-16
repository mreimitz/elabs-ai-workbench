import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  AUTO_RATING_VERSION,
  type AnswerValidationEvidence,
  type ErrorFinding,
  type InsightSurplusEvidence,
  runReportSchema,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import type { GradeService } from "../src/grading/grade-service.js";
import { registerGradingRoutes } from "../src/grading/routes.js";
import { RunReportService } from "../src/grading/run-report.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Auto-Rating WP 1.5 (AR1) — the composed `RunReport`: `RunReportService.compose` (pure read over
// persisted state) and its thin `GET /api/runs/:id/report` route. Covers the three documented facet
// states (full/graded, unevaluable-but-typed, entirely absent), the AR6 base/expectation separation,
// KPI/provenance correctness, and the endpoint's schema-validity + 404.

const NOW = "2026-07-11T00:00:00.000Z";
const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** Minimal parents a `runs` row FKs to (mirrors grading-engine.test.ts's seedParents). */
function seedParents(db: AppDatabase, testId: string, scenarioId: string): void {
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, tags_json, created_at, updated_at)
     VALUES (@id, 'T', 'Go.', '[]', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
}

/** A full run row with KPIs + (optional) persisted assertion results — bypasses RunRepository writes
 *  (mirrors grading-engine.test.ts's raw-SQL seeders) since only `getSummary`'s READ side is under test. */
function seedRun(
  db: AppDatabase,
  opts: {
    runId: string;
    testId: string;
    scenarioId: string;
    status?: string;
    assertionResultsJson?: string;
  },
): void {
  db.prepare(
    `INSERT INTO runs (
       id, test_id, scenario_id, mode, status, outcome, started_at, duration_ms,
       turns, tool_calls, peak_context_tokens, tokens_in, tokens_out, cost_usd, assertion_results_json
     ) VALUES (
       @id, @testId, @scenarioId, 'automated', @status, 'completed', @now, 4200,
       3, 2, 20000, 137, 23, 0.0123, @assertionResultsJson
     )`,
  ).run({
    id: opts.runId,
    testId: opts.testId,
    scenarioId: opts.scenarioId,
    status: opts.status ?? "completed",
    now: NOW,
    assertionResultsJson: opts.assertionResultsJson ?? null,
  });
}

function seedGrade(
  grades: GradeRepository,
  runId: string,
  graderId: string,
  input: {
    status: "graded" | "unevaluable" | "error";
    score: number | null;
    evidence?: unknown;
    judgeProviderId?: string;
    judgeModel?: string;
  },
) {
  grades.insert({
    runId,
    graderId: graderId as never,
    kind: "llm",
    status: input.status,
    score: input.score,
    method: `${graderId}_v1`,
    evidence: input.evidence,
    judgeProviderId: input.judgeProviderId ?? null,
    judgeModel: input.judgeModel ?? null,
  });
}

test("compose: all three base grades present (graded) → verdicts/evidence surface, expectationGrades excludes base ids, kpis/provenance correct", () => {
  const db = createDatabase();
  seedParents(db, "test-1", "scn-1");
  seedRun(db, { runId: "run-full", testId: "test-1", scenarioId: "scn-1" });
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);

  const answerEvidence: AnswerValidationEvidence = {
    verdict: "answered",
    score: 0.9,
    quotes: ["yes"],
    citedSteps: [3],
  };
  const insightEvidence: InsightSurplusEvidence = {
    verdict: "valuable",
    score: 0.8,
    quotes: ["extra"],
    citedSteps: [3],
  };
  const findings: ErrorFinding[] = [
    {
      id: "f1",
      description: "a tool failed",
      category: "failed_tool_call",
      bucket: "mcp_server",
      fixTarget: "mcp_server",
      draftFix: "fix the server",
      evidenceSteps: [1],
      evidenceEventIds: [],
    },
  ];
  seedGrade(grades, "run-full", "answer_validation", {
    status: "graded",
    score: 0.9,
    evidence: answerEvidence,
    judgeProviderId: "claude_cli",
    judgeModel: "claude-sonnet-4-5",
  });
  seedGrade(grades, "run-full", "insight_surplus", {
    status: "graded",
    score: 0.8,
    evidence: insightEvidence,
  });
  seedGrade(grades, "run-full", "error_forensics", {
    status: "graded",
    score: 0.5,
    evidence: findings,
  });
  // An expectation grader also ran — must NOT be folded into baseRating / must appear in expectationGrades.
  seedGrade(grades, "run-full", "rouge1", { status: "graded", score: 0.7 });

  const service = new RunReportService(grades, runs);
  const report = service.compose("run-full");

  assert.equal(report.runId, "run-full");
  assert.equal(report.status, "completed");
  assert.equal(report.outcome, "completed");

  assert.deepEqual(report.baseRating.answerValidation, answerEvidence);
  assert.deepEqual(report.baseRating.insightSurplus, insightEvidence);
  assert.deepEqual(report.baseRating.errorForensics, findings);

  // AR6 — expectationGrades excludes the base ids entirely.
  const expectationIds = report.expectationGrades.map((g) => g.graderId);
  assert.deepEqual(expectationIds, ["rouge1"]);
  assert.ok(!expectationIds.includes("answer_validation"));
  assert.ok(!expectationIds.includes("insight_surplus"));
  assert.ok(!expectationIds.includes("error_forensics"));

  assert.deepEqual(report.kpis, {
    turns: 3,
    toolCalls: 2,
    peakContextTokens: 20000,
    tokensIn: 137,
    tokensOut: 23,
    costUsd: 0.0123,
    durationMs: 4200,
  });

  // judgeProvenance picked from the answer_validation row (the first base grader in roster order to
  // have stamped a real judgeProviderId).
  assert.deepEqual(report.judgeProvenance, {
    judgeProviderId: "claude_cli",
    judgeModel: "claude-sonnet-4-5",
  });
  assert.equal(report.ratingVersion, AUTO_RATING_VERSION);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)), "generatedAt is a real ISO timestamp");

  // Schema-valid end to end.
  assert.doesNotThrow(() => runReportSchema.parse(report));
});

test("compose: a base facet that ran `unevaluable` with NO typed evidence (unconfigured judge) → honest default facet, score null (never 0)", () => {
  const db = createDatabase();
  seedParents(db, "test-2", "scn-2");
  seedRun(db, { runId: "run-unevaluable", testId: "test-2", scenarioId: "scn-2" });
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);

  // Mirrors answer-validation.ts's `unevaluableResult(METHOD_UNCONFIGURED, ...)` — no `evidence` at all.
  seedGrade(grades, "run-unevaluable", "answer_validation", { status: "unevaluable", score: null });
  // Mirrors the `METHOD_NO_ANSWER` path — evidence IS present and typed, still unevaluable/score null.
  const noAnswerEvidence: InsightSurplusEvidence = {
    verdict: "none",
    score: null,
    quotes: [],
    citedSteps: [],
  };
  seedGrade(grades, "run-unevaluable", "insight_surplus", {
    status: "unevaluable",
    score: null,
    evidence: noAnswerEvidence,
  });
  // error_forensics never ran at all (absent row) here — covered by the next test too, but also fine mixed in.

  const service = new RunReportService(grades, runs);
  const report = service.compose("run-unevaluable");

  // No typed evidence at all → the documented default (never invents a verdict, score stays null).
  assert.deepEqual(report.baseRating.answerValidation, {
    verdict: "unanswered",
    score: null,
    quotes: [],
    citedSteps: [],
  });
  assert.strictEqual(report.baseRating.answerValidation.score, null);
  // Typed evidence present (even though unevaluable) → surfaced verbatim, not overridden by a default.
  assert.deepEqual(report.baseRating.insightSurplus, noAnswerEvidence);
  assert.strictEqual(report.baseRating.insightSurplus.score, null);
  // error_forensics row absent entirely → the array default.
  assert.deepEqual(report.baseRating.errorForensics, []);
});

test("compose: a run with NO base grades at all (never rated) → honest default facets for all three, never a fake score/0", () => {
  const db = createDatabase();
  seedParents(db, "test-3", "scn-3");
  seedRun(db, { runId: "run-nograde", testId: "test-3", scenarioId: "scn-3" });
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);

  const service = new RunReportService(grades, runs);
  const report = service.compose("run-nograde");

  assert.deepEqual(report.baseRating.answerValidation, {
    verdict: "unanswered",
    score: null,
    quotes: [],
    citedSteps: [],
  });
  assert.deepEqual(report.baseRating.insightSurplus, {
    verdict: "none",
    score: null,
    quotes: [],
    citedSteps: [],
  });
  assert.deepEqual(report.baseRating.errorForensics, []);
  assert.deepEqual(report.expectationGrades, []);
  assert.deepEqual(report.assertionResults, [], "no assertion_results_json → normalized to []");
  assert.deepEqual(report.judgeProvenance, { judgeProviderId: null, judgeModel: null });
  assert.equal(report.ratingVersion, AUTO_RATING_VERSION);
  assert.doesNotThrow(() => runReportSchema.parse(report));
});

test("compose: assertionResults normalizes the persisted assertion_results_json", () => {
  const db = createDatabase();
  seedParents(db, "test-4", "scn-4");
  const assertionResultsJson = JSON.stringify([
    { assertion: { kind: "noFractures" }, status: "pass", reason: "no fractures observed" },
  ]);
  seedRun(db, { runId: "run-assert", testId: "test-4", scenarioId: "scn-4", assertionResultsJson });
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);

  const service = new RunReportService(grades, runs);
  const report = service.compose("run-assert");
  assert.equal(report.assertionResults.length, 1);
  assert.equal(report.assertionResults[0]?.status, "pass");
});

test("compose: throws a 404 for an unknown run id", () => {
  const db = createDatabase();
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const service = new RunReportService(grades, runs);
  assert.throws(
    () => service.compose("does-not-exist"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

// ── Endpoint: GET /api/runs/:id/report ────────────────────────────────────────────────────────────

async function makeApp(db: AppDatabase): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply
      .code(typeof typed.statusCode === "number" ? typed.statusCode : 500)
      .send({ error: toErrorMessage(error) });
  });
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const runReports = new RunReportService(grades, runs);
  const appSettings = new AppSettingsRepository(db);
  await registerGradingRoutes(
    app,
    {} as unknown as GradeService,
    appSettings,
    { cliAvailable: () => false },
    runReports,
  );
  apps.push(app);
  return app;
}

test("GET /api/runs/:id/report: returns a schema-valid RunReport for a known run", async () => {
  const db = createDatabase();
  seedParents(db, "test-5", "scn-5");
  seedRun(db, { runId: "run-http", testId: "test-5", scenarioId: "scn-5" });
  const grades = new GradeRepository(db);
  seedGrade(grades, "run-http", "error_forensics", { status: "graded", score: 1, evidence: [] });

  const app = await makeApp(db);
  const res = await app.inject({ method: "GET", url: "/api/runs/run-http/report" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.doesNotThrow(
    () => runReportSchema.parse(body),
    "response validates against runReportSchema",
  );
  assert.equal(body.runId, "run-http");
});

test("GET /api/runs/:id/report: 404s on an unknown run", async () => {
  const db = createDatabase();
  const app = await makeApp(db);
  const res = await app.inject({ method: "GET", url: "/api/runs/nope/report" });
  assert.equal(res.statusCode, 404);
});
