import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { JudgeSettings, RunDetail, Test, TestExpectations } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { ZodError } from "zod";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import type { GradeContext, Grader } from "../src/grading/grader.js";
import {
  createOutcomeJudge,
  type JudgeGenerate,
  type JudgeGenerateResult,
  normalizeRating,
  parseRating,
  weightedExpectedRating,
} from "../src/grading/judge.js";
import { registerGradingRoutes } from "../src/grading/routes.js";
import { RunReportService } from "../src/grading/run-report.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { estimateCost } from "../src/providers/pricing.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-07-04T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4"; // in the pricing table → estimateCost > 0, isModelPriced true
const UNPRICED_MODEL = "totally-made-up-model-zzz"; // not priced anywhere → isModelPriced false

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

// ── Unit-level judge context + stubs (the judge reads test.expectations/userPrompt + finalAssistantText) ──

function makeTest(expectations: TestExpectations | undefined): Test {
  return {
    id: "test-x",
    name: "T",
    userPrompt: "What was Q1 revenue?",
    addedProfiles: [],
    attachments: [],
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...(expectations ? { expectations } : {}),
  };
}

function judgeCtx(expectations: TestExpectations | undefined, answer: string): GradeContext {
  return { run: {} as RunDetail, test: makeTest(expectations), finalAssistantText: answer };
}

const CONFIGURED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: PRICED_MODEL,
});

/** A stub `generate` returning a fixed result (or computed via a thunk). No network, no provider. */
function stubGenerate(
  result: JudgeGenerateResult | (() => Promise<JudgeGenerateResult>),
): JudgeGenerate {
  return async () => (typeof result === "function" ? result() : result);
}

const USAGE = { inputTokens: 1000, outputTokens: 50 };

// ── (1) Rating parse ──────────────────────────────────────────────────────────────────────────────

test("parseRating: <rating>7</rating> → 7; bare 'Rating: 8' first-number fallback → 8; unparseable → null", () => {
  assert.deepEqual(parseRating("<rating>7</rating>"), { rating: 7, ratingStr: "7" });
  assert.deepEqual(parseRating("<rating>7</rating> looks close"), { rating: 7, ratingStr: "7" });
  assert.equal(parseRating("Rating: 8")?.rating, 8);
  assert.equal(parseRating("I really cannot decide here"), null);
  assert.equal(parseRating(""), null);
});

test("outcome_judge: an unparseable judge response → status error (never a silent 0)", async () => {
  const judge = createOutcomeJudge({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({ text: "I really cannot decide here", usage: USAGE }),
  });
  const r = await judge.grade(judgeCtx({ expectedInsight: "revenue grew" }, "revenue grew a lot"));
  assert.equal(r.status, "error");
  assert.strictEqual(r.score, null, "an error carries a null score, never 0");
  assert.match(r.reasoning ?? "", /no parseable rating/);
});

// ── (2) Logprob weighting math (hand-computed) ────────────────────────────────────────────────────

test("weightedExpectedRating: renormalizes over numeric candidates and equals the hand computation", () => {
  // Digit candidates 7,8,6 with p = 0.5, 0.25, 0.05 (a non-digit ' good' at 0.2 is dropped).
  // Renormalize over the digits (Σ = 0.8): 0.625, 0.3125, 0.0625.
  // Expected rating = 7·0.625 + 8·0.3125 + 6·0.0625 = 4.375 + 2.5 + 0.375 = 7.25.
  const candidates = [
    { token: "7", logprob: Math.log(0.5) },
    { token: "8", logprob: Math.log(0.25) },
    { token: "6", logprob: Math.log(0.05) },
    { token: " good", logprob: Math.log(0.2) },
  ];
  const weighted = weightedExpectedRating(candidates, "7");
  assert.ok(weighted !== null);
  assert.ok(Math.abs((weighted as number) - 7.25) < 1e-9, `weighted ${weighted} ≈ 7.25`);
});

test("weightedExpectedRating: multi-digit leading-digit maps to the full value (10, not 1)", () => {
  // Target "10": candidate "1" (its leading digit) → 10; candidate "9" → 9. p = 0.6, 0.4 (Σ = 1).
  // Expected = 10·0.6 + 9·0.4 = 6 + 3.6 = 9.6.
  const candidates = [
    { token: "1", logprob: Math.log(0.6) },
    { token: "9", logprob: Math.log(0.4) },
  ];
  const weighted = weightedExpectedRating(candidates, "10");
  assert.ok(weighted !== null);
  assert.ok(Math.abs((weighted as number) - 9.6) < 1e-9, `weighted ${weighted} ≈ 9.6`);
});

test("weightedExpectedRating: no numeric candidate → null (caller falls back to the single sample)", () => {
  assert.equal(weightedExpectedRating([{ token: " the", logprob: Math.log(0.9) }], "7"), null);
});

test("outcome_judge: logprob path → method 'logprob_weighted', rawScore 7.25, score 0.725", async () => {
  const judge = createOutcomeJudge({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: "<rating>7</rating> The answer is close but omits the region breakdown.",
      usage: USAGE,
      ratingLogprobs: [
        { token: "7", logprob: Math.log(0.5) },
        { token: "8", logprob: Math.log(0.25) },
        { token: "6", logprob: Math.log(0.05) },
        { token: " good", logprob: Math.log(0.2) },
      ],
    }),
  });
  const r = await judge.grade(
    judgeCtx({ expectedInsight: "revenue grew 15%" }, "revenue grew about 15%"),
  );
  assert.equal(r.status, "graded");
  assert.equal(r.method, "logprob_weighted");
  assert.ok(Math.abs((r.rawScore as number) - 7.25) < 1e-9, `rawScore ${r.rawScore} ≈ 7.25`);
  assert.ok(Math.abs((r.score as number) - 0.725) < 1e-9, `score ${r.score} ≈ 0.725`);
  assert.match(
    r.reasoning ?? "",
    /region breakdown/,
    "the model's written justification is the reasoning",
  );
});

// ── (3) Single-sample path (no logprobs) ──────────────────────────────────────────────────────────

test("outcome_judge: no logprobs → method 'single_sample', the parsed integer rating", async () => {
  const judge = createOutcomeJudge({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({ text: "<rating>6</rating> partially correct", usage: USAGE }),
  });
  const r = await judge.grade(judgeCtx({ expectedInsight: "revenue grew" }, "revenue grew"));
  assert.equal(r.status, "graded");
  assert.equal(r.method, "single_sample");
  assert.equal(r.rawScore, 6);
  assert.equal(normalizeRating(6), 0.6);
  assert.equal(r.score, 0.6);
});

// ── (4) Unevaluable — unconfigured judge / no ground truth (never error, never 0) ─────────────────

test("outcome_judge: unconfigured judge → unevaluable (score null), and generate is never called", async () => {
  const judge = createOutcomeJudge({
    resolveJudge: () => null,
    generate: stubGenerate(async () => {
      throw new Error("generate must not be called when the judge is unconfigured");
    }),
  });
  const r = await judge.grade(judgeCtx({ expectedInsight: "revenue grew" }, "revenue grew"));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
});

test("outcome_judge: a test with no expectedInsight/expectedValue → unevaluable (generate never called)", async () => {
  const judge = createOutcomeJudge({
    resolveJudge: CONFIGURED,
    generate: stubGenerate(async () => {
      throw new Error("generate must not be called with no ground truth");
    }),
  });
  const r = await judge.grade(judgeCtx({}, "some answer"));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
});

// ── DB fixtures for the service-level tests ───────────────────────────────────────────────────────

function seedParents(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES ('scn-1', 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ now: NOW });
}

function seedCompletedRun(
  db: AppDatabase,
  opts: { runId: string; testId: string; answer: string; costUsd: number },
): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd)
     VALUES (@runId, @testId, 'scn-1', 'automated', 'completed', 'completed', @now, @cost)`,
  ).run({ runId: opts.runId, testId: opts.testId, now: NOW, cost: opts.costUsd });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, assistant_text)
     VALUES (@id, @runId, 0, 'llm_response', 'answer', 'ok', @answer)`,
  ).run({ id: `${opts.runId}-s0`, runId: opts.runId, answer: opts.answer });
}

function makeJudge(
  generate: JudgeGenerate,
  resolveJudge: () => JudgeSettings | null = CONFIGURED,
): Grader {
  return createOutcomeJudge({ resolveJudge, generate });
}

function makeService(db: AppDatabase, graders: readonly Grader[]) {
  const tests = new TestService(new TestRepository(db));
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const service = new GradeService(grades, tests, runs, graders);
  return { tests, runs, grades, service };
}

// ── (5) Judge error via gradeRun: a persisted `error` row; the run is untouched ───────────────────

test("gradeRun with a throwing judge → a persisted error row; the run completes unchanged", async () => {
  const db = createDatabase();
  seedParents(db);
  const throwingJudge = makeJudge(
    stubGenerate(async () => {
      throw new Error("provider exploded");
    }),
  );
  const { tests, runs, grades, service } = makeService(db, [throwingJudge]);
  const created = tests.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew" },
  });
  seedCompletedRun(db, {
    runId: "run-err",
    testId: created.id,
    answer: "revenue grew",
    costUsd: 1.2345,
  });
  const before = db
    .prepare("SELECT status, outcome, cost_usd FROM runs WHERE id = 'run-err'")
    .get();

  const rows = await service.gradeRun("run-err");
  const judgeRow = rows.find((r) => r.graderId === "outcome_judge");
  assert.equal(judgeRow?.status, "error", "a stuck/failed judge → an error row, never a throw");
  assert.strictEqual(judgeRow?.score, null, "error score is null, never 0");
  assert.match(judgeRow?.reasoning ?? "", /provider exploded/);
  // The run is byte-identical and stays completed.
  const after = db.prepare("SELECT status, outcome, cost_usd FROM runs WHERE id = 'run-err'").get();
  assert.deepEqual(after, before, "grading never mutated the run");
  assert.equal(runs.getSummary("run-err").status, "completed");
  assert.equal(grades.listByRun("run-err").length, 1);
});

// ── (6) Cost isolation: judge_* ledger populated; runs.cost_usd byte-identical ────────────────────

test("gradeRun: judge cost lands ONLY in the judge_* ledger; runs.cost_usd is byte-identical", async () => {
  const db = createDatabase();
  seedParents(db);
  const judge = makeJudge(stubGenerate({ text: "<rating>8</rating> strong answer", usage: USAGE }));
  const { tests, runs, grades, service } = makeService(db, [judge]);
  const created = tests.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew 15%" },
  });
  seedCompletedRun(db, {
    runId: "run-cost",
    testId: created.id,
    answer: "revenue grew 15%",
    costUsd: 2.53179,
  });

  const runBefore = db.prepare("SELECT cost_usd FROM runs WHERE id = 'run-cost'").get() as {
    cost_usd: number;
  };
  await service.gradeRun("run-cost");
  const runAfter = db.prepare("SELECT cost_usd FROM runs WHERE id = 'run-cost'").get() as {
    cost_usd: number;
  };

  // Cost isolation invariant: the run's own cost is untouched by grading.
  assert.strictEqual(
    runAfter.cost_usd,
    runBefore.cost_usd,
    "runs.cost_usd is byte-identical before/after",
  );
  assert.strictEqual(runAfter.cost_usd, 2.53179);

  const judgeRow = grades.latestByGrader("run-cost").find((g) => g.graderId === "outcome_judge");
  assert.equal(judgeRow?.status, "graded");
  assert.equal(judgeRow?.judgeTokensIn, 1000);
  assert.equal(judgeRow?.judgeTokensOut, 50);
  const expectedCost = estimateCost(PRICED_MODEL, { inputTokens: 1000, outputTokens: 50 });
  assert.ok(expectedCost > 0, "the priced judge model has a real cost");
  assert.ok((judgeRow?.judgeCostUsd ?? 0) > 0, "the judge cost ledger is populated (> 0)");
  assert.ok(
    Math.abs((judgeRow?.judgeCostUsd ?? 0) - expectedCost) < 1e-12,
    "judge cost == estimateCost(model,usage)",
  );
  assert.equal(judgeRow?.judgeProviderId, "prov-1");
  assert.equal(judgeRow?.judgeModel, PRICED_MODEL);
  assert.equal(judgeRow?.kind, "llm");
});

// ── (7) Re-grade appends (append-only); latest-per-grader is the newest pass ───────────────────────

test("gradeRun twice appends fresh rows; older rows kept; latest-per-grader is the second pass", async () => {
  const db = createDatabase();
  seedParents(db);
  let rating = 7;
  // A generate that produces a different rating per call so the newest row is distinguishable.
  const judge = makeJudge(
    stubGenerate(async () => ({ text: `<rating>${rating++}</rating> ok`, usage: USAGE })),
  );
  const { tests, grades, service } = makeService(db, [judge]);
  const created = tests.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew" },
  });
  seedCompletedRun(db, {
    runId: "run-rg",
    testId: created.id,
    answer: "revenue grew",
    costUsd: 0.5,
  });

  const first = await service.gradeRun("run-rg");
  const second = await service.gradeRun("run-rg");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  const all = grades.listByRun("run-rg");
  assert.equal(all.length, 2, "row count doubled (nothing updated/deleted)");
  assert.ok(
    all.some((row) => row.id === first[0]?.id),
    "the first (older) grade row is retained",
  );
  for (const row of all)
    assert.ok(!Number.isNaN(Date.parse(row.createdAt)), "each row has a valid timestamp");
  const latest = grades.latestByGrader("run-rg");
  assert.equal(latest.length, 1);
  assert.equal(latest[0]?.id, second[0]?.id, "latest is the second pass");
  assert.equal(latest[0]?.rawScore, 8, "the second pass produced the newer rating (8)");
});

// ── (8) Routes: judge-settings validation (unpriced → 400) + re-grade pricing guard ───────────────

function createApp(db: AppDatabase) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply
      .code(typeof typed.statusCode === "number" ? typed.statusCode : 500)
      .send({ error: toErrorMessage(error) });
  });
  const appSettings = new AppSettingsRepository(db);
  const judge = makeJudge(stubGenerate({ text: "<rating>7</rating> ok", usage: USAGE }), () => {
    const parsed = appSettings.get("judge");
    return (parsed as JudgeSettings | undefined) ?? null;
  });
  const gradeRepo = new GradeRepository(db);
  const runRepo = new RunRepository(db);
  const service = new GradeService(gradeRepo, new TestService(new TestRepository(db)), runRepo, [
    judge,
  ]);
  // WP 2.3 — the routes now take a `cliAvailable` probe; these route tests exercise the provider path
  // (no CLI signed in). The resolved-source + CLI-model surface has its own suite.
  // WP 1.5 — the composed-report service reuses the SAME repos this suite already builds.
  void registerGradingRoutes(
    app,
    service,
    appSettings,
    { cliAvailable: () => false },
    new RunReportService(gradeRepo, runRepo),
  );
  return { app, appSettings };
}

test("PUT /api/grading/judge-settings: an unpriced model → 400; a priced model → 200 and GET reflects it", async () => {
  const db = createDatabase();
  const { app } = createApp(db);

  const rejected = await app.inject({
    method: "PUT",
    url: "/api/grading/judge-settings",
    payload: { providerCredentialId: "prov-1", model: UNPRICED_MODEL },
  });
  assert.equal(
    rejected.statusCode,
    400,
    "an unpriced judge model is refused exactly like a cost-capped run",
  );
  assert.match(rejected.json().error, /no known pricing/);

  const accepted = await app.inject({
    method: "PUT",
    url: "/api/grading/judge-settings",
    payload: { providerCredentialId: "prov-1", model: PRICED_MODEL },
  });
  assert.equal(accepted.statusCode, 200);

  const get = await app.inject({ method: "GET", url: "/api/grading/judge-settings" });
  assert.equal(get.statusCode, 200);
  // WP 2.3 — the response now wraps the provider settings with the resolved source.
  assert.deepEqual(get.json().settings, { providerCredentialId: "prov-1", model: PRICED_MODEL });
  assert.equal(get.json().resolvedSource, "provider");

  await app.close();
});

test("GET /api/grading/judge-settings: unconfigured → explicit {null,null} + resolvedSource none", async () => {
  const db = createDatabase();
  const { app } = createApp(db);
  const get = await app.inject({ method: "GET", url: "/api/grading/judge-settings" });
  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.json().settings, { providerCredentialId: null, model: null });
  assert.equal(get.json().resolvedSource, "none");
  await app.close();
});

test("POST /api/runs/:id/grade: naming the outcome judge with an unpriced configured judge → 400", async () => {
  const db = createDatabase();
  seedParents(db);
  const { app, appSettings } = createApp(db);
  // Seed an UNPRICED judge directly in the KV (bypassing the PUT guard) to exercise the re-grade guard.
  appSettings.put("judge", { providerCredentialId: "prov-1", model: UNPRICED_MODEL });
  const created = new TestService(new TestRepository(db)).create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew" },
  });
  seedCompletedRun(db, {
    runId: "run-guard",
    testId: created.id,
    answer: "revenue grew",
    costUsd: 0,
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/runs/run-guard/grade",
    payload: { graderIds: ["outcome_judge"] },
  });
  assert.equal(res.statusCode, 400, "re-grade with an unpriced configured judge is refused");
  assert.match(res.json().error, /no known pricing/);
  await app.close();
});
