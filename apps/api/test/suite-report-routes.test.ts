import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import { suiteReportSchema } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import type { FailureBucketService } from "../src/grading/failure-buckets.js";
import { registerSuiteRoutes } from "../src/suites/routes.js";
import type { SuiteOrchestrator } from "../src/suites/orchestrator.js";
import type { SuiteService } from "../src/suites/service.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import { SuiteReportService } from "../src/suites/suite-report-service.js";
import type { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Auto-Rating WP 4.3 (AR7/AR11) — the suite-run cross-run REPORT routes: `GET /api/suite-runs/:id/report`
// (a pure read of the LATEST persisted `SuiteReport`, honest 404 when none exists yet) and `POST
// /api/suite-runs/:id/report` (append-only regenerate — a fresh row every call, never mutates a prior
// one; an honest `report: null` + `reason` when the AR7 ≥2-member gate isn't met). Only the report routes
// are under test here, so every OTHER `registerSuiteRoutes` dependency (orchestrator, suite CRUD service,
// suite-run manager, test service, failure-bucket service) is a harmless stub — mirrors
// `run-report-compose.test.ts`'s `{} as unknown as GradeService` pattern for an unrelated dep.

const NOW = "2026-07-11T00:00:00.000Z";
const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function seedParents(db: AppDatabase, scenarioId: string, testIds: string[]): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, 'Scenario', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  );
  for (const id of testIds) insertTest.run({ id, name: `Test ${id}`, now: NOW });
}

function seedSuiteRun(db: AppDatabase): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, ended_at, source)
     VALUES (@id, NULL, 'completed', '{}', @now, @now, 'adhoc')`,
  ).run({ id, now: NOW });
  return id;
}

function seedRun(db: AppDatabase, testId: string, scenarioId: string, suiteRunId: string): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, turns, tool_calls, cost_usd, suite_run_id, repetition)
     VALUES (@id, @testId, @scenarioId, 'automated', 'completed', 'completed', @now, 1, 0, 0.01, @suiteRunId, 1)`,
  ).run({ id, testId, scenarioId, suiteRunId, now: NOW });
  return id;
}

function seedOutcomeGrade(grades: GradeRepository, runId: string, score: number): void {
  grades.insert({
    runId,
    graderId: "outcome_judge",
    kind: "llm",
    status: "graded",
    score,
    method: "single_sample",
  });
}

async function makeApp(
  db: AppDatabase,
  suiteReportService: SuiteReportService,
  suiteReports: SuiteReportRepository,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply
      .code(typeof typed.statusCode === "number" ? typed.statusCode : 500)
      .send({ error: toErrorMessage(error) });
  });
  await registerSuiteRoutes(
    app,
    {} as unknown as SuiteService,
    {} as unknown as SuiteOrchestrator,
    new SuiteRunRepository(db),
    {} as unknown as SuiteRunManager,
    new RunRepository(db),
    new GradeRepository(db),
    {} as unknown as TestService,
    {} as unknown as FailureBucketService,
    suiteReportService,
    suiteReports,
  );
  apps.push(app);
  return app;
}

// ── GET /api/suite-runs/:id/report ──────────────────────────────────────────────────────────────

test("GET /api/suite-runs/:id/report: 404s honestly when no report has been generated yet (suite run exists)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suiteRunId = seedSuiteRun(db);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  const app = await makeApp(db, service, reports);
  const res = await app.inject({ method: "GET", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(res.statusCode, 404);
});

test("GET /api/suite-runs/:id/report: 404s for an unknown suite run id", async () => {
  const db = openFresh();
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  const app = await makeApp(db, service, reports);
  const res = await app.inject({ method: "GET", url: "/api/suite-runs/does-not-exist/report" });
  assert.equal(res.statusCode, 404);
});

test("GET /api/suite-runs/:id/report: returns the LATEST schema-valid SuiteReport once one has been generated", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suiteRunId = seedSuiteRun(db);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const r1 = seedRun(db, "t1", "scn-1", suiteRunId);
  const r2 = seedRun(db, "t1", "scn-1", suiteRunId);
  seedOutcomeGrade(grades, r1, 0.8);
  seedOutcomeGrade(grades, r2, 0.6);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const generated = await service.generate(suiteRunId);
  assert.ok(generated, "a report was generated directly via the service (seeds the GET below)");

  const app = await makeApp(db, service, reports);
  const res = await app.inject({ method: "GET", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.doesNotThrow(
    () => suiteReportSchema.parse(body),
    "response validates against suiteReportSchema",
  );
  assert.equal(body.suiteRunId, suiteRunId);
  // Suite-report enrichment (additive) — the persisted row's status is echoed onto the report.
  assert.equal(body.status, "ready", "the persisted row's status is surfaced on the GET response");
});

test("GET /api/suite-runs/:id/report: echoes the ROW's status even when the stored report JSON predates the in-report stamp", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suiteRunId = seedSuiteRun(db);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  // Persist a PRE-STAMP report row directly (its JSON carries no `status` field), status `partial`.
  reports.insert({
    suiteRunId,
    status: "partial",
    report: {
      suiteRunId,
      testGroups: [],
      errorClustering: [],
      rootCauseRollup: [],
      narrative: "",
      judgeProvenance: { judgeProviderId: null, judgeModel: null },
      ratingVersion: 1,
      generatedAt: NOW,
      skippedMembers: [],
    },
    ratingVersion: 1,
  });

  const app = await makeApp(db, service, reports);
  const res = await app.inject({ method: "GET", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, "partial", "the row's status is echoed at READ time (never rewritten)");
  assert.doesNotThrow(() => suiteReportSchema.parse(body));
});

// ── POST /api/suite-runs/:id/report (regenerate) ────────────────────────────────────────────────

test("POST /api/suite-runs/:id/report: <2 members → an honest {report:null, reason:'insufficient_members'} (AR7), 200", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suiteRunId = seedSuiteRun(db);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  seedRun(db, "t1", "scn-1", suiteRunId); // only ONE member
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  const app = await makeApp(db, service, reports);
  const res = await app.inject({ method: "POST", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body, { report: null, reason: "insufficient_members" });
  assert.equal(reports.latest(suiteRunId), null, "nothing persisted for a <2-member suite run");
});

test("POST /api/suite-runs/:id/report: ≥2 members → generates + persists, APPEND-ONLY (latest wins), 201", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suiteRunId = seedSuiteRun(db);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const r1 = seedRun(db, "t1", "scn-1", suiteRunId);
  const r2 = seedRun(db, "t1", "scn-1", suiteRunId);
  seedOutcomeGrade(grades, r1, 0.9);
  seedOutcomeGrade(grades, r2, 0.7);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  const app = await makeApp(db, service, reports);
  const first = await app.inject({ method: "POST", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(first.statusCode, 201);
  const firstBody = first.json();
  assert.doesNotThrow(
    () => suiteReportSchema.parse(firstBody.report),
    "regenerated report validates",
  );

  // Regenerating again APPENDS a second row rather than mutating the first (latest wins).
  await new Promise((resolve) => setTimeout(resolve, 2)); // distinct created_at ordering
  const second = await app.inject({ method: "POST", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(second.statusCode, 201);

  const history = reports.listBySuiteRun(suiteRunId);
  assert.equal(history.length, 2, "two appended rows — the first was never mutated");
  const latestId = reports.latest(suiteRunId)?.id;
  assert.equal(latestId, history[1]?.id, "latest() resolves the newest row");

  // GET now serves that same latest row.
  const getRes = await app.inject({ method: "GET", url: `/api/suite-runs/${suiteRunId}/report` });
  assert.equal(getRes.statusCode, 200);
  assert.doesNotThrow(() => suiteReportSchema.parse(getRes.json()));
});

test("POST /api/suite-runs/:id/report: 404s for an unknown suite run id", async () => {
  const db = openFresh();
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  const app = await makeApp(db, service, reports);
  const res = await app.inject({ method: "POST", url: "/api/suite-runs/does-not-exist/report" });
  assert.equal(res.statusCode, 404);
});
