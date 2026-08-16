import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { RunDetail, RunStatus, Test, TestExpectations } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import type { Grader } from "../src/grading/grader.js";
import { rouge1Grader } from "../src/grading/rouge1.js";
import { valueMatchGrader } from "../src/grading/value-match.js";
import type { McpSession } from "../src/mcp/client.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

const NOW = "2026-07-04T00:00:00.000Z";
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

// ── Unit-level grader context (graders read only test.expectations + finalAssistantText) ─────────

function makeTest(expectations: TestExpectations | undefined): Test {
  return {
    id: "test-x",
    name: "T",
    userPrompt: "Go.",
    addedProfiles: [],
    attachments: [],
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...(expectations ? { expectations } : {}),
  };
}

function ctx(expectations: TestExpectations | undefined, answer: string) {
  // `run` is unused by the two deterministic graders (they read expectations + finalAssistantText only).
  return { run: {} as RunDetail, test: makeTest(expectations), finalAssistantText: answer };
}

// ── (1) rouge1 — hand-computed F1, unevaluable when no ground truth ───────────────────────────────

test("rouge1: identical text scores 1.0", () => {
  const r = rouge1Grader.grade(
    ctx({ expectedInsight: "the quick brown fox" }, "the quick brown fox"),
  );
  assert.equal(r.status, "graded");
  assert.equal(r.score, 1);
  assert.equal(r.method, "rouge1_unigram_f1");
});

test("rouge1: disjoint text scores 0.0", () => {
  const r = rouge1Grader.grade(ctx({ expectedInsight: "alpha beta gamma" }, "delta epsilon zeta"));
  assert.equal(r.status, "graded");
  assert.equal(r.score, 0);
});

test("rouge1: partial overlap equals the hand-computed F1 (2/3)", () => {
  // reference "the cat sat" vs candidate "the cat ran": overlap 2, p=r=2/3, F1 = 2/3.
  const r = rouge1Grader.grade(ctx({ expectedInsight: "the cat sat" }, "the cat ran"));
  assert.equal(r.status, "graded");
  assert.ok(typeof r.score === "number");
  assert.ok(Math.abs((r.score as number) - 2 / 3) < 1e-9, `F1 ${r.score} ≈ 0.6666666667`);
});

test("rouge1: no expectedInsight/expectedValue → unevaluable (score null, never 0)", () => {
  const r = rouge1Grader.grade(ctx({}, "some answer text"));
  assert.equal(r.status, "unevaluable");
  assert.equal(r.score, null);
});

test("rouge1: expectedValue alone (no insight) is still evaluable", () => {
  // reference = stableStringify({revenue:100}) = '{"revenue":100}' → tokens [revenue, 100].
  const r = rouge1Grader.grade(ctx({ expectedValue: { revenue: 100 } }, "revenue is 100"));
  assert.equal(r.status, "graded");
  assert.ok((r.score as number) > 0, "candidate shares the reference unigrams");
});

// ── (2) value_match — JSON extraction, partial credit, honest unevaluable ─────────────────────────

test("value_match: matching fenced JSON block scores 1.0", () => {
  const answer = 'Here is the result:\n```json\n{"revenue": 100, "region": "EU"}\n```';
  const r = valueMatchGrader.grade(ctx({ expectedValue: { revenue: 100, region: "EU" } }, answer));
  assert.equal(r.status, "graded");
  assert.equal(r.score, 1);
  assert.equal(r.method, "value_match_json");
});

test("value_match: object with one wrong key → partial score with the mismatch in the reasoning", () => {
  const answer = '```json\n{"revenue": 100, "region": "US"}\n```';
  const r = valueMatchGrader.grade(ctx({ expectedValue: { revenue: 100, region: "EU" } }, answer));
  assert.equal(r.status, "graded");
  assert.equal(r.score, 0.5, "1 of 2 leaf keys matched");
  assert.match(r.reasoning ?? "", /region/);
});

test("value_match: no JSON block in the answer → unevaluable (score is null, NOT 0)", () => {
  const r = valueMatchGrader.grade(
    ctx({ expectedValue: { x: 1 } }, "there is no json here at all"),
  );
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.notStrictEqual(r.score, 0);
});

test("value_match: expectedValue undefined → unevaluable", () => {
  const r = valueMatchGrader.grade(ctx({ expectedInsight: "foo" }, '```json\n{"a":1}\n```'));
  assert.equal(r.status, "unevaluable");
  assert.equal(r.score, null);
});

test("value_match: uses the LAST JSON block and honors relative numeric tolerance", () => {
  const answer = [
    "First a draft:",
    "```json",
    '{"revenue": 1, "region": "XX"}',
    "```",
    "Final answer:",
    "```json",
    '{"revenue": 100.0000001, "region": "EU"}',
    "```",
  ].join("\n");
  const r = valueMatchGrader.grade(ctx({ expectedValue: { revenue: 100, region: "EU" } }, answer));
  assert.equal(r.status, "graded");
  assert.equal(r.score, 1, "last block wins and 100 ≈ 100.0000001 within relative tolerance");
});

test("value_match: falls back to the last balanced top-level object when unfenced", () => {
  const answer = 'The computed result is {"revenue": 100, "region": "EU"} — done.';
  const r = valueMatchGrader.grade(ctx({ expectedValue: { revenue: 100, region: "EU" } }, answer));
  assert.equal(r.status, "graded");
  assert.equal(r.score, 1);
});

test("value_match: scalar/array expected value is all-or-nothing deep equality", () => {
  const arr = valueMatchGrader.grade(ctx({ expectedValue: [1, 2, 3] }, "```json\n[1,2,3]\n```"));
  assert.equal(arr.score, 1);
  const wrong = valueMatchGrader.grade(ctx({ expectedValue: [1, 2, 3] }, "```json\n[1,2,4]\n```"));
  assert.equal(wrong.score, 0);
});

// ── DB fixture helpers for the service-level tests ────────────────────────────────────────────────

function seedParents(db: AppDatabase, scenarioId: string): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
}

/** Insert a completed run + one llm_response step carrying `answer` as its assistant prose. */
function seedCompletedRun(
  db: AppDatabase,
  opts: { runId: string; testId: string; scenarioId: string; answer: string; costUsd?: number },
): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd)
     VALUES (@runId, @testId, @scenarioId, 'automated', 'completed', 'completed', @now, @cost)`,
  ).run({
    runId: opts.runId,
    testId: opts.testId,
    scenarioId: opts.scenarioId,
    now: NOW,
    cost: opts.costUsd ?? 0,
  });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, assistant_text)
     VALUES (@id, @runId, 0, 'llm_response', 'answer', 'ok', @answer)`,
  ).run({ id: `${opts.runId}-s0`, runId: opts.runId, answer: opts.answer });
}

/** Insert a run at an ARBITRARY terminal status (+ one llm_response step). Used by the AR5 matrix. */
function seedRun(
  db: AppDatabase,
  opts: { runId: string; testId: string; scenarioId: string; status: RunStatus; answer?: string },
): void {
  const outcome =
    opts.status === "completed"
      ? "completed"
      : opts.status === "stopped"
        ? "stopped_guardrail"
        : opts.status;
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd)
     VALUES (@runId, @testId, @scenarioId, 'automated', @status, @outcome, @now, 0)`,
  ).run({
    runId: opts.runId,
    testId: opts.testId,
    scenarioId: opts.scenarioId,
    status: opts.status,
    outcome,
    now: NOW,
  });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, assistant_text)
     VALUES (@id, @runId, 0, 'llm_response', 'answer', 'ok', @answer)`,
  ).run({ id: `${opts.runId}-s0`, runId: opts.runId, answer: opts.answer ?? "" });
}

/** AR5 fixtures — a MANDATORY (always-on) base-rating fake grader and a plain EXPECTATION fake grader.
 *  Both use valid `GraderId`s and a fixed `graded` verdict so a matrix cell asserts only WHETHER they ran. */
function fakeMandatory(): Grader {
  return {
    id: "error_forensics",
    kind: "deterministic",
    mandatory: true,
    grade: () => ({ status: "graded", score: 1, method: "fake_mandatory" }),
  };
}
function fakeExpectation(): Grader {
  return {
    id: "tool_hygiene",
    kind: "deterministic",
    grade: () => ({ status: "graded", score: 1, method: "fake_expectation" }),
  };
}

function makeService(
  db: AppDatabase,
  graders?: readonly Grader[],
  opts?: { autoRatingEnabled?: boolean },
) {
  const tests = new TestService(new TestRepository(db));
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const service = new GradeService(grades, tests, runs, graders, opts);
  return { tests, runs, grades, service };
}

// ── (3) Auto-grade wiring: expectations → grades; no expectations → zero rows ─────────────────────

test("gradeRun: a completed run whose test HAS expectations inserts rouge1 + value_match", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  const { tests, grades, service } = makeService(db);
  const created = tests.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew", expectedValue: { revenue: 100 } },
  });
  seedCompletedRun(db, {
    runId: "run-a",
    testId: created.id,
    scenarioId: "scn-1",
    answer: 'revenue grew this quarter.\n```json\n{"revenue": 100}\n```',
  });

  const rows = await service.gradeRun("run-a");
  const byId = new Map(rows.map((r) => [r.graderId, r]));
  assert.ok(byId.has("rouge1"), "rouge1 row inserted");
  assert.ok(byId.has("value_match"), "value_match row inserted");
  assert.equal(byId.get("value_match")?.status, "graded");
  assert.equal(byId.get("value_match")?.score, 1, "value_match parsed the JSON block and matched");
  assert.equal(byId.get("rouge1")?.status, "graded");
  // Persisted (append-only) and stamped as deterministic (judge ledger 0/null).
  assert.equal(grades.listByRun("run-a").length, 2);
  for (const g of grades.listByRun("run-a")) {
    assert.equal(g.kind, "deterministic");
    assert.equal(g.judgeCostUsd, 0);
    assert.equal(g.judgeProviderId, null);
    assert.equal(g.gradingVersion, 1);
  }
});

test("gradeRun: a completed run whose test has NO expectations inserts ZERO rows", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  const { tests, grades, service } = makeService(db);
  const created = tests.create({ name: "Ungraded", userPrompt: "Go.", addedProfiles: [] });
  seedCompletedRun(db, {
    runId: "run-b",
    testId: created.id,
    scenarioId: "scn-1",
    answer: "anything",
  });

  const rows = await service.gradeRun("run-b");
  assert.equal(rows.length, 0, "no expectations → no grade rows");
  assert.equal(grades.listByRun("run-b").length, 0, "nothing persisted");
});

// ── (4) INVARIANT — grading never mutates a run; a grader that throws is contained ────────────────

test("INVARIANT never-mutate: a grader that throws yields an error row, others still run, run unchanged", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  // A grader that always throws, registered under a valid grader id.
  const throwing: Grader = {
    id: "tool_hygiene",
    kind: "deterministic",
    grade() {
      throw new Error("boom in grader");
    },
  };
  const { tests, runs, service } = makeService(db, [rouge1Grader, valueMatchGrader, throwing]);
  const created = tests.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "hello world", expectedValue: { a: 1 } },
  });
  seedCompletedRun(db, {
    runId: "run-c",
    testId: created.id,
    scenarioId: "scn-1",
    answer: 'hello world\n```json\n{"a":1}\n```',
    costUsd: 1.2345,
  });

  const before = db.prepare("SELECT status, outcome, cost_usd FROM runs WHERE id = 'run-c'").get();

  const rows = await service.gradeRun("run-c");
  const byId = new Map(rows.map((r) => [r.graderId, r]));
  // (a) an error-status row is persisted for the throwing grader.
  const errRow = byId.get("tool_hygiene");
  assert.equal(errRow?.status, "error", "throwing grader → error row");
  assert.equal(errRow?.score, null, "error row carries a null score, never 0");
  assert.match(errRow?.reasoning ?? "", /boom in grader/);
  // (c) the other graders still ran.
  assert.equal(byId.get("rouge1")?.status, "graded", "rouge1 still ran");
  assert.equal(byId.get("value_match")?.status, "graded", "value_match still ran");
  // (b) the run row is byte-identical before and after grading.
  const after = db.prepare("SELECT status, outcome, cost_usd FROM runs WHERE id = 'run-c'").get();
  assert.deepEqual(after, before, "grading never mutated any run field");
  // And the run's own read model is unchanged.
  const summary = runs.getSummary("run-c");
  assert.equal(summary.status, "completed");
  assert.equal(summary.outcome, "completed");
  assert.equal(summary.costUsd, 1.2345);
});

// ── (5) INVARIANT — append-only: re-grade appends; latest-per-grader wins ─────────────────────────

test("INVARIANT append-only: grading twice doubles the rows and keeps the older ones; latest per grader", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  const { tests, grades, service } = makeService(db);
  const created = tests.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "the answer", expectedValue: { a: 1 } },
  });
  seedCompletedRun(db, {
    runId: "run-d",
    testId: created.id,
    scenarioId: "scn-1",
    answer: 'the answer\n```json\n{"a":1}\n```',
  });

  const first = await service.gradeRun("run-d");
  const second = await service.gradeRun("run-d");
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  const all = grades.listByRun("run-d");
  assert.equal(all.length, 4, "row count doubled (nothing updated/deleted)");
  // The oldest rows are retained (their ids are still present).
  for (const g of first) {
    assert.ok(
      all.some((row) => row.id === g.id),
      "older grade row retained",
    );
  }
  // latestByGrader returns exactly one (the newest) per grader.
  const latest = grades.latestByGrader("run-d");
  assert.equal(latest.length, 2);
  const secondIds = new Set(second.map((r) => r.id));
  for (const g of latest) {
    assert.ok(secondIds.has(g.id), `latest ${g.graderId} row is from the second grading pass`);
  }
});

// ── (6) INVARIANT — unevaluable ≠ 0 and never fails; the run is untouched ─────────────────────────

test("INVARIANT unevaluable: an unevaluable grade has score null (never 0) and flips no run field", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  const { runs, grades, service, tests } = makeService(db);
  const created = tests.create({
    name: "ValueOnly",
    userPrompt: "Go.",
    addedProfiles: [],
    // expectedValue present but the answer will carry NO JSON block → value_match is unevaluable.
    expectations: { expectedValue: { x: 1 } },
  });
  seedCompletedRun(db, {
    runId: "run-e",
    testId: created.id,
    scenarioId: "scn-1",
    answer: "prose only, no structured output here",
  });
  const before = db
    .prepare("SELECT status, outcome, cost_usd, turns FROM runs WHERE id = 'run-e'")
    .get();

  await service.gradeRun("run-e");
  const vm = grades.latestByGrader("run-e").find((g) => g.graderId === "value_match");
  assert.equal(vm?.status, "unevaluable");
  assert.strictEqual(vm?.score, null, "unevaluable score is null, never 0");
  const after = db
    .prepare("SELECT status, outcome, cost_usd, turns FROM runs WHERE id = 'run-e'")
    .get();
  assert.deepEqual(after, before, "an unevaluable grade never flips a run field");
  assert.equal(runs.getSummary("run-e").outcome, "completed");
});

// ── (6b) Auto-Rating AR5 — mandatory roster + per-grader gate relaxation ──────────────────────────

const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "stopped", "error", "aborted"];

test("AR5 matrix: a MANDATORY grader runs on EVERY terminal status ± expectations; an EXPECTATION grader only on completed+expectations", async () => {
  for (const status of TERMINAL_STATUSES) {
    for (const hasExpectations of [true, false]) {
      const db = createDatabase();
      seedParents(db, "scn-1");
      const { tests, grades, service } = makeService(db, [fakeMandatory(), fakeExpectation()]);
      const created = tests.create({
        name: "T",
        userPrompt: "Go.",
        addedProfiles: [],
        ...(hasExpectations ? { expectations: { expectedInsight: "x" } } : {}),
      });
      const runId = `run-${status}-${hasExpectations ? "exp" : "noexp"}`;
      seedRun(db, { runId, testId: created.id, scenarioId: "scn-1", status, answer: "an answer" });

      const rows = await service.gradeRun(runId);
      const ran = new Set(rows.map((r) => r.graderId));
      const cell = `status=${status} hasExpectations=${hasExpectations}`;
      // The mandatory (base-rating) grader runs in ALL SIX/EIGHT cells.
      assert.ok(ran.has("error_forensics"), `mandatory grader ran (${cell})`);
      // The expectation grader keeps TODAY's gate EXACTLY: only completed + expectations.
      const expectationEligible = status === "completed" && hasExpectations;
      assert.equal(
        ran.has("tool_hygiene"),
        expectationEligible,
        `expectation grader ran iff completed+expectations (${cell})`,
      );
      // Persisted rows equal exactly the rows THIS call reported (append-only; ineligible → no row).
      assert.equal(grades.listByRun(runId).length, rows.length, `no phantom rows (${cell})`);
    }
  }
});

test("AR5 kill-switch: autoRatingEnabled:false skips the MANDATORY grader ONLY; the expectation grader is unaffected", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  const { tests, grades, service } = makeService(db, [fakeMandatory(), fakeExpectation()], {
    autoRatingEnabled: false,
  });
  const created = tests.create({
    name: "T",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "x" },
  });

  // (a) completed + expectations: mandatory skipped by the kill-switch, expectation grader still runs.
  seedRun(db, {
    runId: "run-ks-ok",
    testId: created.id,
    scenarioId: "scn-1",
    status: "completed",
    answer: "a",
  });
  const okRows = await service.gradeRun("run-ks-ok");
  const okRan = new Set(okRows.map((r) => r.graderId));
  assert.ok(!okRan.has("error_forensics"), "kill-switch off → mandatory grader skipped");
  assert.ok(okRan.has("tool_hygiene"), "kill-switch never touches expectation grading");

  // (b) error run: mandatory skipped (kill-switch) AND expectation skipped (not completed) → zero rows.
  seedRun(db, {
    runId: "run-ks-err",
    testId: created.id,
    scenarioId: "scn-1",
    status: "error",
    answer: "a",
  });
  const errRows = await service.gradeRun("run-ks-err");
  assert.equal(errRows.length, 0, "kill-switch off on a non-completed run → no rows at all");
  assert.equal(grades.listByRun("run-ks-err").length, 0, "nothing persisted");
});

test("AR5 re-grade: the graderIds subset honors the SAME eligibility (mandatory re-rates on an error run; expectation does not)", async () => {
  const db = createDatabase();
  seedParents(db, "scn-1");
  const { tests, service } = makeService(db, [fakeMandatory(), fakeExpectation()]);
  const created = tests.create({
    name: "T",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "x" },
  });
  seedRun(db, {
    runId: "run-rg",
    testId: created.id,
    scenarioId: "scn-1",
    status: "error",
    answer: "a",
  });

  // Re-rate JUST the mandatory grader on an ERROR run → it still runs (a base grader ignores completion).
  const mandatoryOnly = await service.gradeRun("run-rg", { graderIds: ["error_forensics"] });
  assert.equal(mandatoryOnly.length, 1, "mandatory grader re-rated on an error run");
  assert.equal(mandatoryOnly[0]?.graderId, "error_forensics");

  // Re-rate JUST the expectation grader on the same error run → NOT eligible (not completed) → no row.
  const expectationOnly = await service.gradeRun("run-rg", { graderIds: ["tool_hygiene"] });
  assert.equal(
    expectationOnly.length,
    0,
    "an expectation grader stays completed-only even when explicitly re-graded",
  );
});

// ── (7) Never-execute: the grading module reaches no MCP/session/tool-bridge surface ──────────────

test("never-execute: no grading source imports MCP client / openSession / tool-bridge", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const gradingDir = path.resolve(here, "../src/grading");
  const files = fs.readdirSync(gradingDir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 6, "grading module has its source files");
  const forbidden = [
    /from ["'].*mcp\/client/,
    /openSession/,
    /tool-bridge/,
    /callTool/,
    /child_process/,
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(gradingDir, file), "utf8");
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(source),
        `${file} must not reference ${pattern} (graders never execute anything)`,
      );
    }
  }
});

// ── (8) Run-service integration: the auto-grade hook fires and is fully guarded ───────────────────

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

function mockAnswer(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "revenue grew this quarter." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ] as LanguageModelV3StreamPart[],
      }),
    }),
  });
}

/** A model whose stream emits a (non-overflow) `error` part → the engine settles the run as `error`. */
function mockError(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "error", error: new Error("provider blew up") },
        ] as LanguageModelV3StreamPart[],
      }),
    }),
  });
}

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

function makeRunService(
  db: AppDatabase,
  secrets: SecretStore,
  grades: GradeService,
  model: () => MockLanguageModelV3 = mockAnswer,
) {
  const scans = new ScanRepository(db);
  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const skills = new SkillRepository(db, secrets);
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, skills);
  const testService = new TestService(new TestRepository(db));
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => model();
  const sessionOpener: SessionOpener = async () => stubSession();
  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runRepo,
    modelFactory,
    sessionOpener,
    skills,
    grades,
  );
  return { scenarioRepo, testService, runRepo, runService };
}

function seedProvider(db: AppDatabase, secrets: SecretStore): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now: NOW });
}

function scenarioInput(name: string) {
  return {
    name,
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k" as const],
    guardrails: {},
    toolLoadingMode: "eager" as const,
  };
}

test("run-service auto-grade hook: a completed run with expectations persists grades", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  // The GradeService reads/writes the SAME db, so its own repositories can be fresh instances.
  const gradeRepo = new GradeRepository(db);
  const gradeService = new GradeService(
    gradeRepo,
    new TestService(new TestRepository(db)),
    new RunRepository(db),
  );
  const { scenarioRepo, testService, runRepo, runService } = makeRunService(
    db,
    secrets,
    gradeService,
  );

  const scenario = scenarioRepo.create(scenarioInput("Sc"));
  const created = testService.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew this quarter" },
  });

  const run = runService.start(created.id, scenario.id, "automated");
  await run.done;

  assert.equal(runRepo.getSummary(run.runId).status, "completed", "run completed");
  const latest = gradeRepo.latestByGrader(run.runId);
  const rouge = latest.find((g) => g.graderId === "rouge1");
  assert.ok(rouge, "the auto-grade hook produced a rouge1 grade");
  assert.equal(rouge?.status, "graded");
  assert.ok((rouge?.score ?? 0) > 0, "the produced answer overlaps the expected insight");
});

test("run-service auto-grade hook is fully guarded: a rejecting GradeService never breaks completion", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  // A GradeService whose gradeRun always rejects — the run-service hook must swallow it.
  const rejecting = {
    gradeRun: async () => {
      throw new Error("grade service exploded");
    },
  } as unknown as GradeService;
  const { scenarioRepo, testService, runRepo, runService } = makeRunService(db, secrets, rejecting);

  const scenario = scenarioRepo.create(scenarioInput("Sc"));
  const created = testService.create({
    name: "Graded",
    userPrompt: "Go.",
    addedProfiles: [],
    expectations: { expectedInsight: "anything" },
  });

  const run = runService.start(created.id, scenario.id, "automated");
  const result = await run.done; // must NOT reject
  assert.equal(result.status, "completed", "the run still completes despite the grading crash");
  const summary = runRepo.getSummary(run.runId);
  assert.equal(summary.status, "completed");
  assert.equal(summary.outcome, "completed", "the grading crash never touched the run outcome");
});

test("run-service auto-grade hook (AR5): fires on a NON-completed terminal run so mandatory graders get their chance", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));
  seedProvider(db, secrets);
  // A spy GradeService that only records which runs it was asked to grade.
  const graded: string[] = [];
  const spy = {
    gradeRun: async (runId: string) => {
      graded.push(runId);
      return [];
    },
  } as unknown as GradeService;
  // `mockError` makes the run settle as `error` (Gate B used to short-circuit those before grading).
  const { scenarioRepo, testService, runRepo, runService } = makeRunService(
    db,
    secrets,
    spy,
    mockError,
  );

  const scenario = scenarioRepo.create(scenarioInput("Sc"));
  // No expectations — a mandatory grader must still get its chance regardless.
  const created = testService.create({ name: "Uncompleted", userPrompt: "Go.", addedProfiles: [] });

  const run = runService.start(created.id, scenario.id, "automated");
  const result = await run.done;
  assert.notEqual(result.status, "completed", "the run did NOT cleanly complete");
  assert.equal(result.status, "error");
  assert.equal(runRepo.getSummary(run.runId).status, "error");
  assert.deepEqual(
    graded,
    [run.runId],
    "the post-terminal hook called gradeRun even on a non-completed run",
  );
});
