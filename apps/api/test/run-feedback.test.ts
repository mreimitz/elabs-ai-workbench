// Observability WP1.5 — human feedback (`run_feedback`): a score/note on a run or one of its steps,
// STRICTLY SEPARATE from grading (AR6/D-OB15).
//
// Proves (acceptance):
//   1. CRUD + UPSERT semantics (a re-thumb on the same (step, key) REPLACES the prior row, same id);
//      step-level rows accepted ONLY for a step that belongs to THAT run; cascade on run delete.
//   2. Filterable via RunFilter (`feedback.key`/`hasScore`) — the full field-family cross-check lives
//      in runs-filter.test.ts (real fixture + SQL-vs-predicate agreement); here we prove the thinner
//      end-to-end slice: a POSTed row is immediately findable through `queryRuns`.
//   3. SEPARATION regression — suite AGGREGATES (`computeSuiteAggregates`) and ANALYTICS
//      (`buildSuiteAnalytics`) are BYTE-IDENTICAL whether or not the same runs carry feedback rows,
//      even though `RunSummary.feedback` itself DOES reflect the write (proving the assertion isn't
//      vacuous).
//   4. Migration v36 (both the fresh-DB `schema.ts` baseline path and the pre-v36 upgrade path) lands
//      `run_feedback` — see migrations.test.ts (the version-lock + both-paths tests).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { RunFeedback } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { registerObservabilityRoutes } from "../src/observability/routes.js";
import { RunFeedbackRepository } from "../src/observability/feedback.js";
import { collectAnalyticsChildren, computeSuiteAnalytics } from "../src/suites/analytics.js";
import { collectChildData, computeSuiteAggregates } from "../src/suites/orchestrator.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-07-16T00:00:00.000Z";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function track(db: AppDatabase): AppDatabase {
  databases.push(db);
  return db;
}

function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

async function setup(): Promise<{ db: AppDatabase; app: FastifyInstance; runs: RunRepository }> {
  const db = openFresh();
  const runs = new RunRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });

  await registerObservabilityRoutes(app, db);
  await app.ready();
  apps.push(app);
  return { db, app, runs };
}

let seq = 0;
/** Seed one provider/scenario/test + a run, returning the run id. Each call gets fresh ids. */
function seedRun(db: AppDatabase, opts: { runId?: string; costUsd?: number; tokens?: number } = {}): string {
  const n = seq++;
  const providerId = `prov-${n}`;
  const scenarioId = `scn-${n}`;
  const testId = `test-${n}`;
  const runId = opts.runId ?? `run-${n}`;
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(providerId, "anthropic", "Claude", NOW, NOW);
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run(scenarioId, `Scenario ${n}`, providerId, "claude-sonnet-4", NOW, NOW);
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(testId, `Test ${n}`, "go", NOW, NOW);
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd, tokens_in, tokens_out)
     VALUES (?,?,?,'automated','completed',?,?,?,?)`,
  ).run(runId, testId, scenarioId, NOW, opts.costUsd ?? 0, opts.tokens ?? 0, 0);
  return runId;
}

/** Insert a minimal `run_steps` row, returning its id. */
function seedStep(db: AppDatabase, runId: string, stepId: string): void {
  db.prepare(
    "INSERT INTO run_steps (id, run_id, idx, type, label, status) VALUES (?,?,?,?,?,?)",
  ).run(stepId, runId, 0, "tool_call", "call a tool", "completed");
}

// ── (1) CRUD + upsert semantics ─────────────────────────────────────────────────────────────────

test("POST creates run-level feedback; GET lists it; DELETE removes it", async () => {
  const { app, db } = await setup();
  const runId = seedRun(db);

  const created = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "verdict", score: 1 },
  });
  assert.equal(created.statusCode, 201);
  const row = created.json() as RunFeedback;
  assert.equal(row.runId, runId);
  assert.equal(row.key, "verdict");
  assert.equal(row.score, 1);
  assert.equal(row.stepId, undefined, "run-level feedback carries no stepId");
  assert.equal(row.source, "human");
  assert.ok(row.id);
  assert.ok(row.createdAt);

  const listed = await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` });
  assert.equal(listed.statusCode, 200);
  const list = listed.json() as RunFeedback[];
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], row);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/runs/${runId}/feedback/${row.id}`,
  });
  assert.equal(deleted.statusCode, 204);

  const relisted = await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` });
  assert.deepEqual(relisted.json(), []);

  const redelete = await app.inject({
    method: "DELETE",
    url: `/api/runs/${runId}/feedback/${row.id}`,
  });
  assert.equal(redelete.statusCode, 404, "deleting an already-deleted row 404s (not a silent no-op)");
});

test("`key` defaults to 'verdict' when omitted; at least one of score/comment is required", async () => {
  const { app, db } = await setup();
  const runId = seedRun(db);

  const defaulted = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { score: -1 },
  });
  assert.equal(defaulted.statusCode, 201);
  assert.equal((defaulted.json() as RunFeedback).key, "verdict");

  const neither = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "notes" },
  });
  assert.equal(neither.statusCode, 400, "score AND comment both absent is rejected");

  const commentOnly = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "notes", comment: "great trajectory" },
  });
  assert.equal(commentOnly.statusCode, 201, "comment alone (no score) is valid");
});

test("POST is an UPSERT — a re-thumb on the SAME (step, key) REPLACES the prior row (same id)", async () => {
  const { app, db } = await setup();
  const runId = seedRun(db);

  const first = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "verdict", score: 1 },
  });
  const firstRow = first.json() as RunFeedback;

  const rethumb = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "verdict", score: -1, comment: "changed my mind" },
  });
  assert.equal(rethumb.statusCode, 201);
  const rethumbRow = rethumb.json() as RunFeedback;
  assert.equal(rethumbRow.id, firstRow.id, "the SAME row is replaced, not a new one appended");
  assert.equal(rethumbRow.score, -1);
  assert.equal(rethumbRow.comment, "changed my mind");

  const list = (await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` })).json() as RunFeedback[];
  assert.equal(list.length, 1, "exactly one row for the 'verdict' key — the re-thumb did not append");

  // A DIFFERENT key is a genuinely separate row.
  const otherKey = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "notes", comment: "separate signal" },
  });
  assert.equal(otherKey.statusCode, 201);
  const list2 = (await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` })).json() as RunFeedback[];
  assert.equal(list2.length, 2, "a different key is a distinct row");
});

test("step-level rows are accepted ONLY for a step that belongs to THIS run", async () => {
  const { app, db } = await setup();
  const runA = seedRun(db);
  const runB = seedRun(db);
  seedStep(db, runA, "step-a");
  seedStep(db, runB, "step-b");

  const onOwnStep = await app.inject({
    method: "POST",
    url: `/api/runs/${runA}/feedback`,
    payload: { stepId: "step-a", key: "verdict", score: 1 },
  });
  assert.equal(onOwnStep.statusCode, 201);
  assert.equal((onOwnStep.json() as RunFeedback).stepId, "step-a");

  const onOtherRunsStep = await app.inject({
    method: "POST",
    url: `/api/runs/${runA}/feedback`,
    payload: { stepId: "step-b", key: "verdict", score: 1 },
  });
  assert.equal(onOtherRunsStep.statusCode, 400, "step-b belongs to runB, not runA");

  const onMissingStep = await app.inject({
    method: "POST",
    url: `/api/runs/${runA}/feedback`,
    payload: { stepId: "does-not-exist", key: "verdict", score: 1 },
  });
  assert.equal(onMissingStep.statusCode, 400);

  // Run-level ('verdict', no stepId) and step-level ('verdict', stepId=step-a) upsert-identities are
  // DISTINCT (step_id participates in the upsert key) — both coexist.
  const runLevel = await app.inject({
    method: "POST",
    url: `/api/runs/${runA}/feedback`,
    payload: { key: "verdict", score: -1 },
  });
  assert.equal(runLevel.statusCode, 201);
  const list = (await app.inject({ method: "GET", url: `/api/runs/${runA}/feedback` })).json() as RunFeedback[];
  assert.equal(list.length, 2, "run-level and step-level 'verdict' are separate rows");
});

test("POST/GET/DELETE 404 for a run that does not exist; DELETE 404 across runs", async () => {
  const { app, db } = await setup();
  const runA = seedRun(db);
  const runB = seedRun(db);

  const postMissing = await app.inject({
    method: "POST",
    url: "/api/runs/does-not-exist/feedback",
    payload: { key: "verdict", score: 1 },
  });
  assert.equal(postMissing.statusCode, 404);

  const getMissing = await app.inject({ method: "GET", url: "/api/runs/does-not-exist/feedback" });
  assert.equal(getMissing.statusCode, 404);

  const created = await app.inject({
    method: "POST",
    url: `/api/runs/${runA}/feedback`,
    payload: { key: "verdict", score: 1 },
  });
  const row = created.json() as RunFeedback;

  // A feedbackId that exists but belongs to a DIFFERENT run 404s (scoped delete).
  const wrongRun = await app.inject({
    method: "DELETE",
    url: `/api/runs/${runB}/feedback/${row.id}`,
  });
  assert.equal(wrongRun.statusCode, 404);
});

test("deleting a run CASCADES its run_feedback rows", async () => {
  const { db, runs } = await setup();
  const runId = seedRun(db);
  seedStep(db, runId, "step-1");

  db.prepare(
    "INSERT INTO run_feedback (id, run_id, step_id, key, score, comment, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("f1", runId, null, "verdict", 1, null, "human", NOW);
  db.prepare(
    "INSERT INTO run_feedback (id, run_id, step_id, key, score, comment, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("f2", runId, "step-1", "verdict", -1, null, "human", NOW);

  const countBefore = (
    db.prepare("SELECT COUNT(*) AS n FROM run_feedback WHERE run_id = ?").get(runId) as { n: number }
  ).n;
  assert.equal(countBefore, 2);

  runs.delete(runId); // the repository's own delete (FK ON DELETE CASCADE does the rest)

  const countAfter = (
    db.prepare("SELECT COUNT(*) AS n FROM run_feedback WHERE run_id = ?").get(runId) as { n: number }
  ).n;
  assert.equal(countAfter, 0, "run_feedback rows are cascade-deleted with their run");
});

// ── (2) Filterable via RunFilter — end-to-end (route → repository → SQL) ───────────────────────────

test("a POSTed feedback row is immediately findable via RunFilter.feedback", async () => {
  const { app, db, runs } = await setup();
  const withFeedback = seedRun(db);
  const without = seedRun(db);

  await app.inject({
    method: "POST",
    url: `/api/runs/${withFeedback}/feedback`,
    payload: { key: "verdict", score: 1 },
  });

  assert.deepEqual(
    runs.queryRuns({ feedback: { key: "verdict" } }).map((r) => r.id),
    [withFeedback],
  );
  assert.deepEqual(
    runs.queryRuns({ feedback: { key: "verdict", hasScore: true } }).map((r) => r.id),
    [withFeedback],
  );
  assert.deepEqual(runs.queryRuns({ feedback: { key: "no-such-key" } }), []);
  assert.deepEqual(
    runs.queryRuns({ feedback: {} }).map((r) => r.id).sort(),
    [withFeedback, without].sort(),
    "an empty feedback filter imposes no constraint",
  );

  // The RunSummary aggregate chip reflects it too.
  const summary = runs.getSummary(withFeedback);
  assert.deepEqual(summary.feedback, [{ key: "verdict", score: 1 }]);
  assert.equal(runs.getSummary(without).feedback, undefined, "a run with no feedback carries none");
});

// ── (3) SEPARATION regression (AR6/D-OB15) — the review focus ──────────────────────────────────────

test("SEPARATION: suite aggregates + analytics are BYTE-IDENTICAL with vs without feedback rows", async () => {
  const { db, runs } = await setup();
  const grades = new GradeRepository(db);
  const tests = new TestService(new TestRepository(db));

  const runA = seedRun(db, { costUsd: 1.0, tokens: 150 });
  const runB = seedRun(db, { costUsd: 2.0, tokens: 300 });
  const runIds = [runA, runB];

  // Grades exist (the run_grades ledger) — feedback is a SEPARATE ledger the aggregates must never read.
  db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, grading_version, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run("g1", runA, "outcome_judge", "llm", "graded", 0.7, "test", 1, NOW);
  db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, grading_version, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run("g2", runB, "outcome_judge", "llm", "graded", 0.5, "test", 1, NOW);

  const aggregatesBefore = computeSuiteAggregates(collectChildData(runs, grades, runIds), runIds.length);
  const analyticsBefore = computeSuiteAnalytics(
    collectAnalyticsChildren(runs, grades, tests, runIds),
  );

  // Now add human feedback to BOTH runs — via the same repository the route uses.
  const feedback = new RunFeedbackRepository(db);
  feedback.upsert(runA, { key: "verdict", score: 1 });
  feedback.upsert(runB, { key: "verdict", score: -1, comment: "bad trajectory" });

  const aggregatesAfter = computeSuiteAggregates(collectChildData(runs, grades, runIds), runIds.length);
  const analyticsAfter = computeSuiteAnalytics(collectAnalyticsChildren(runs, grades, tests, runIds));

  assert.equal(
    JSON.stringify(aggregatesAfter),
    JSON.stringify(aggregatesBefore),
    "suite AGGREGATES are byte-identical whether or not feedback rows exist",
  );
  assert.equal(
    JSON.stringify(analyticsAfter),
    JSON.stringify(analyticsBefore),
    "suite ANALYTICS (scatter/breakdowns) are byte-identical whether or not feedback rows exist",
  );

  // Prove the assertion isn't vacuous: the feedback WAS actually persisted and IS readable elsewhere.
  assert.deepEqual(runs.getSummary(runA).feedback, [{ key: "verdict", score: 1 }]);
  assert.deepEqual(runs.getSummary(runB).feedback, [{ key: "verdict", score: -1 }]);

  // And the aggregates/analytics numbers are the expected REAL (grade-only) numbers — not accidentally
  // empty/zeroed in a way that would make the byte-identity trivially true.
  assert.equal(aggregatesBefore.meanGrade, 0.6);
  assert.equal(aggregatesBefore.execCostUsd, 3.0);
  assert.equal(analyticsBefore.scatter.length, 2);
});
