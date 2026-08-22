// Observability Phase 6 (AM-OB2) — `POST /api/runs/:id/promote-to-test`, and the corrected-answer
// overlay it applies.
//
// Two things are under test, and they are separate claims:
//
//   A. THE ROUTE EXISTS. WP4.4 shipped the console's "Promote to test…" button web-only, against a
//      mocked fetch; no API route was ever registered, so the button 404'd in production (the
//      ledger's own recorded follow-up, and `apps/web/src/lib/api.ts` said so in a STUBBED doc
//      block). These tests drive the real Fastify route.
//   B. THE OVERLAY IS EXACT. A run carrying a human `corrected_output` produces a draft whose
//      `expectations.expectedInsight` IS that text; a run without one produces a draft whose
//      expectations are BYTE-IDENTICAL to the pre-AM-OB2 behaviour — including staying absent when
//      the source test had none. Both paths run here, so "the overlay works" can never be claimed
//      from the happy case alone.
//
// AR6 / D-OB15 is NOT weakened by any of this: the correction changes what a NEWLY CREATED test
// expects. It never re-scores the source run. That invariant's own regression test lives in
// `run-feedback.test.ts` (the SEPARATION section).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { PromoteRunToTestResult, Test } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { RunFeedbackRepository } from "../src/observability/feedback.js";
import { registerTestingRoutes } from "../src/testing/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { RunService } from "../src/testing/run-service.js";
import { RunManager } from "../src/testing/run-manager.js";
import type { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-08-22T00:00:00.000Z";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = {
  app: FastifyInstance;
  db: AppDatabase;
  tests: TestService;
  feedback: RunFeedbackRepository;
};

async function setup(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  const runs = new RunRepository(db);
  const testRepo = new TestRepository(db);
  const tests = new TestService(testRepo);
  const feedback = new RunFeedbackRepository(db);
  const runManager = new RunManager(runs);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  // Only the promote route is exercised; the scenario/run services are referenced solely inside
  // handlers we never call, so stubs are safe (registration never dereferences them) — the same
  // shape `runs-filter.test.ts` uses.
  await registerTestingRoutes(
    app,
    {} as unknown as ScenarioService,
    tests,
    {} as unknown as RunService,
    runs,
    runManager,
    { runs, tests, testRepo, feedback },
  );
  await app.ready();
  apps.push(app);
  return { app, db, tests, feedback };
}

let seq = 0;
/** Seed a collection + provider/environment + source test + one terminal run. Returns their ids. */
function seedRun(
  db: AppDatabase,
  tests: TestService,
  opts: { expectations?: Test["expectations"] } = {},
): { runId: string; sourceTestId: string; collectionId: string } {
  const n = seq++;
  const providerId = `prov-${n}`;
  const scenarioId = `scn-${n}`;
  const runId = `run-${n}`;
  const collectionId = `col-${n}`;
  db.prepare(
    "INSERT INTO collections (id, name, is_default, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(collectionId, `Collection ${n}`, 0, NOW, NOW);
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(providerId, "anthropic", "Claude", NOW, NOW);
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run(scenarioId, `Scenario ${n}`, providerId, "claude-sonnet-4", NOW, NOW);

  const source = tests.create({
    name: `Source ${n}`,
    userPrompt: "What is the answer?",
    addedProfiles: [],
    tags: ["regression"],
    ...(opts.expectations !== undefined ? { expectations: opts.expectations } : {}),
  });

  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd, tokens_in, tokens_out)
     VALUES (?,?,?,'automated','completed','completed',?,0,0,0)`,
  ).run(runId, source.id, scenarioId, NOW);
  return { runId, sourceTestId: source.id, collectionId };
}

// ── A. The route exists ─────────────────────────────────────────────────────────────────────────

test("POST /api/runs/:id/promote-to-test is registered and returns the created draft test id", async () => {
  const { app, db, tests } = await setup();
  const { runId, collectionId } = seedRun(db, tests);

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });

  assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as PromoteRunToTestResult;
  assert.ok(body.testId, "the response names the created test");
  const draft = tests.get(body.testId);
  assert.equal(draft.draft, true, "the promoted test is a DRAFT and never auto-runs");
  assert.equal(draft.collectionId, collectionId);
  assert.ok(draft.name.startsWith("[Draft] "), "the draft is clearly marked");
});

test("an unknown run 404s and a malformed body 400s (no silent no-op promote)", async () => {
  const { app, db, tests } = await setup();
  const { collectionId, runId } = seedRun(db, tests);

  const missing = await app.inject({
    method: "POST",
    url: "/api/runs/does-not-exist/promote-to-test",
    payload: { collectionId },
  });
  assert.equal(missing.statusCode, 404);

  const malformed = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: {},
  });
  assert.equal(malformed.statusCode, 400);
});

// ── B. The overlay, BOTH paths ──────────────────────────────────────────────────────────────────

test("a run WITH a corrected_output promotes to a draft expecting exactly that text", async () => {
  const { app, db, tests, feedback } = await setup();
  const { runId, collectionId } = seedRun(db, tests, {
    expectations: { expectedInsight: "the old expectation", answerable: true },
  });
  feedback.upsert(runId, { key: "corrected_output", comment: "It should have said 42." });

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as PromoteRunToTestResult;
  assert.equal(body.usedCorrectedOutput, true, "the response says the correction was used");

  const draft = tests.get(body.testId);
  assert.equal(draft.expectations?.expectedInsight, "It should have said 42.");
  // OVERLAY, not wipe — the rest of the source expectation block survives.
  assert.equal(draft.expectations?.answerable, true);
});

test("a run WITHOUT a corrected_output promotes byte-identically to the pre-AM-OB2 behaviour", async () => {
  const { app, db, tests } = await setup();
  const expectations = { expectedInsight: "the old expectation", answerable: true } as const;
  const { runId, collectionId } = seedRun(db, tests, { expectations });

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as PromoteRunToTestResult;
  assert.equal(
    body.usedCorrectedOutput,
    false,
    "false means NO correction was captured — never 'the source expectation was fine'",
  );

  const draft = tests.get(body.testId);
  // Deep-equal, not a JSON string: `expectations` round-trips through a persisted JSON column, so
  // key ORDER is the storage layer's business. The claim is that no value was added, changed or
  // dropped relative to the source test.
  assert.deepEqual(
    draft.expectations,
    expectations,
    "the source expectations are carried through unchanged",
  );
});

test("a source test with NO expectations still promotes with none — an empty block is never invented", async () => {
  const { app, db, tests } = await setup();
  const { runId, collectionId } = seedRun(db, tests);

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });
  const body = res.json() as PromoteRunToTestResult;
  const draft = tests.get(body.testId);
  assert.equal(draft.expectations, undefined);
  assert.equal(body.usedCorrectedOutput, false);
});

test("a source test with NO expectations gains one when a correction exists", async () => {
  const { app, db, tests, feedback } = await setup();
  const { runId, collectionId } = seedRun(db, tests);
  feedback.upsert(runId, { key: "corrected_output", comment: "42." });

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });
  const body = res.json() as PromoteRunToTestResult;
  assert.equal(body.usedCorrectedOutput, true);
  assert.deepEqual(tests.get(body.testId).expectations, { expectedInsight: "42." });
});

test("a STEP-scoped corrected_output never becomes the draft's expectation (run-level only)", async () => {
  const { app, db, tests, feedback } = await setup();
  const { runId, collectionId } = seedRun(db, tests, {
    expectations: { expectedInsight: "the old expectation" },
  });
  db.prepare(
    "INSERT INTO run_steps (id, run_id, idx, type, label, status) VALUES (?,?,?,?,?,?)",
  ).run(`${runId}:step:0`, runId, 0, "tool_call", "call a tool", "completed");
  feedback.upsert(runId, {
    key: "corrected_output",
    stepId: `${runId}:step:0`,
    comment: "this ONE turn was wrong",
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });
  const body = res.json() as PromoteRunToTestResult;
  assert.equal(body.usedCorrectedOutput, false);
  assert.equal(tests.get(body.testId).expectations?.expectedInsight, "the old expectation");
});

test("re-writing the correction UPDATES rather than duplicating, and the LATEST text wins", async () => {
  const { app, db, tests, feedback } = await setup();
  const { runId, collectionId } = seedRun(db, tests);

  feedback.upsert(runId, { key: "corrected_output", comment: "first attempt" });
  feedback.upsert(runId, { key: "corrected_output", comment: "second attempt" });
  const rows = feedback.list(runId).filter((row) => row.key === "corrected_output");
  assert.equal(rows.length, 1, "the (run, step, key, source) upsert identity holds for the new key");

  const res = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/promote-to-test`,
    payload: { collectionId },
  });
  const body = res.json() as PromoteRunToTestResult;
  assert.equal(tests.get(body.testId).expectations?.expectedInsight, "second attempt");
});
