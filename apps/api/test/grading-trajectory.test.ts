import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { JudgeSettings, RunStep } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import type { Grader } from "../src/grading/grader.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../src/grading/judge.js";
import {
  buildTrajectoryDigest,
  createTrajectoryJudge,
  parseTrajectoryResponse,
  TRAJECTORY_JUDGE_ID,
} from "../src/grading/trajectory-judge.js";
import { estimateCost } from "../src/providers/pricing.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

const NOW = "2026-07-04T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4"; // in the pricing table → estimateCost > 0

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

const CONFIGURED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: PRICED_MODEL,
});
const USAGE = { inputTokens: 1200, outputTokens: 80 };

/** A stub `generate` returning a fixed result; increments `calls` so "generate never called" is checkable. */
function trackedGenerate(result: JudgeGenerateResult): {
  generate: JudgeGenerate;
  calls: () => number;
} {
  let n = 0;
  return {
    generate: async () => {
      n += 1;
      return result;
    },
    calls: () => n,
  };
}

// ── Step fixture builders (pure; no DB) ──────────────────────────────────────────────────────────────

function toolCall(opts: {
  toolName: string;
  args: unknown;
  toolCallId?: string;
  index: number;
}): RunStep {
  return {
    id: `s${opts.index}`,
    runId: "run-x",
    index: opts.index,
    type: "tool_call",
    label: opts.toolName,
    status: "running",
    toolName: opts.toolName,
    profileTokens: {},
    payload: { ...(opts.toolCallId ? { toolCallId: opts.toolCallId } : {}), args: opts.args },
  };
}

function toolResult(opts: {
  toolName: string;
  result: unknown;
  toolCallId?: string;
  index: number;
  error?: boolean;
}): RunStep {
  return {
    id: `s${opts.index}`,
    runId: "run-x",
    index: opts.index,
    type: "tool_result",
    label: opts.toolName,
    status: opts.error ? "error" : "ok",
    toolName: opts.toolName,
    profileTokens: {},
    payload: { ...(opts.toolCallId ? { toolCallId: opts.toolCallId } : {}), result: opts.result },
  };
}

function llmResponse(text: string, index: number): RunStep {
  return {
    id: `s${index}`,
    runId: "run-x",
    index,
    type: "llm_response",
    label: "answer",
    status: "ok",
    assistantText: text,
    profileTokens: {},
    payload: null,
  };
}

// ── (1) Digest correctness + truncation ───────────────────────────────────────────────────────────

test("digest: ordered operations pair each tool_call with its tool_result (stepIdx, toolName, args, result)", () => {
  const steps: RunStep[] = [
    toolCall({
      toolName: "sql_query",
      args: { sql: "SELECT sum(sales) FROM t" },
      toolCallId: "c1",
      index: 0,
    }),
    toolResult({ toolName: "sql_query", result: "sum=42", toolCallId: "c1", index: 1 }),
    toolCall({ toolName: "chart", args: { kind: "bar" }, toolCallId: "c2", index: 2 }),
    toolResult({ toolName: "chart", result: { url: "chart://1" }, toolCallId: "c2", index: 3 }),
    llmResponse("here is the answer", 4),
  ];
  const digest = buildTrajectoryDigest(steps);

  assert.deepEqual(digest.operations, [
    {
      stepIdx: 0,
      toolName: "sql_query",
      args: { sql: "SELECT sum(sales) FROM t" },
      resultSummary: "sum=42",
      resultTruncated: false,
    },
    {
      stepIdx: 2,
      toolName: "chart",
      args: { kind: "bar" },
      resultSummary: '{"url":"chart://1"}',
      resultTruncated: false,
    },
  ]);
  assert.equal(digest.truncated, false);
  assert.equal(digest.droppedOps, 0);
  // The prompt-ready text carries each operation with its source step index.
  assert.match(digest.text, /### Operation 1 \(step 0\)/);
  assert.match(digest.text, /### Operation 2 \(step 2\)/);
  assert.match(digest.text, /Tool: sql_query/);
});

test("digest: the MCP-sink tool_call (no args) is skipped; a missing result reads '(no result recorded)'", () => {
  const sink: RunStep = {
    id: "s1",
    runId: "run-x",
    index: 1,
    type: "tool_call",
    label: "sql_query",
    status: "ok",
    serverId: "srv-a",
    toolName: "sql_query",
    profileTokens: {},
    payload: { toolCallId: "c1", isError: false }, // no `args` → the sink duplicate
  };
  const steps: RunStep[] = [
    toolCall({ toolName: "sql_query", args: { sql: "x" }, toolCallId: "c1", index: 0 }),
    sink,
    // no tool_result at all
  ];
  const digest = buildTrajectoryDigest(steps);
  assert.equal(digest.operations.length, 1, "only the args-bearing call is an operation");
  assert.equal(digest.operations[0]?.stepIdx, 0);
  assert.equal(digest.operations[0]?.resultSummary, "(no result recorded)");
});

test("digest: a per-op result past the char cap is truncated AND disclosed", () => {
  const big = "x".repeat(500);
  const steps: RunStep[] = [
    toolCall({ toolName: "dump", args: {}, toolCallId: "c1", index: 0 }),
    toolResult({ toolName: "dump", result: big, toolCallId: "c1", index: 1 }),
  ];
  const digest = buildTrajectoryDigest(steps, { opResultCharCap: 100 });
  const op = digest.operations[0];
  assert.ok(op?.resultTruncated, "the oversized result is flagged truncated");
  assert.ok(
    (op?.resultSummary.length ?? 0) < big.length,
    "the summary is shorter than the raw result",
  );
  assert.match(op?.resultSummary ?? "", /\+400 chars/);
  assert.equal(digest.truncated, true);
  assert.match(digest.text, /digest truncated to fit the judge context/);
  assert.match(digest.text, /1 result\(s\) shortened/);
});

test("digest: past the total cap, trailing operations are dropped AND disclosed", () => {
  const steps: RunStep[] = [
    toolCall({ toolName: "a", args: { i: 1 }, toolCallId: "c1", index: 0 }),
    toolResult({ toolName: "a", result: "ra", toolCallId: "c1", index: 1 }),
    toolCall({ toolName: "b", args: { i: 2 }, toolCallId: "c2", index: 2 }),
    toolResult({ toolName: "b", result: "rb", toolCallId: "c2", index: 3 }),
    toolCall({ toolName: "c", args: { i: 3 }, toolCallId: "c3", index: 4 }),
    toolResult({ toolName: "c", result: "rc", toolCallId: "c3", index: 5 }),
  ];
  // A tiny total budget: only the first operation block fits; the other two are dropped.
  const digest = buildTrajectoryDigest(steps, { totalCharCap: 40 });
  assert.equal(digest.operations.length, 1, "at least one op is always kept, the rest dropped");
  assert.equal(digest.droppedOps, 2);
  assert.equal(digest.truncated, true);
  assert.match(digest.text, /2 operation\(s\) omitted/);
});

// ── (2) Parse fallback paths ────────────────────────────────────────────────────────────────────────

test("parse: well-formed JSON → score + joined comparison text", () => {
  const parsed = parseTrajectoryResponse(
    JSON.stringify({
      calculation_comparison: "The agent's Operation at step 0 sums sales like the reference.",
      trajectory_score: 7,
      score_reason: "Operation at step 2 adds an unnecessary chart (redundancy).",
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed?.rawScore, 7);
  assert.match(parsed?.comparison ?? "", /sums sales like the reference/);
  assert.match(parsed?.comparison ?? "", /unnecessary chart/);
});

test("parse: a fenced JSON block is tolerated (fences stripped)", () => {
  const parsed = parseTrajectoryResponse(
    '```json\n{"calculation_comparison": "matches", "trajectory_score": 9, "score_reason": "ok"}\n```',
  );
  assert.equal(parsed?.rawScore, 9);
  assert.match(parsed?.comparison ?? "", /matches/);
});

test("parse: a truncated JSON (never closed) still yields the score + partial comparison via field regex", () => {
  const parsed = parseTrajectoryResponse(
    '{"calculation_comparison": "the agent did X and Y", "trajectory_score": 8, "score_reason": "cut off he',
  );
  assert.equal(parsed?.rawScore, 8);
  assert.match(parsed?.comparison ?? "", /the agent did X and Y/);
});

test("parse: a garbled (non-JSON) response → first-number fallback", () => {
  const parsed = parseTrajectoryResponse(
    "Overall this trajectory scores about 6 out of 10 — decent but incomplete.",
  );
  assert.equal(parsed?.rawScore, 6);
});

test("parse: an out-of-range score is clamped to [0,10]", () => {
  assert.equal(parseTrajectoryResponse('{"trajectory_score": 15}')?.rawScore, 10);
});

test("parse: an unparseable response (no number anywhere) → null (drives an error grade, never a 0)", () => {
  assert.equal(parseTrajectoryResponse("I cannot assess this trajectory."), null);
  assert.equal(parseTrajectoryResponse(""), null);
});

// ── unit-level applies/grade (no DB) ──────────────────────────────────────────────────────────────

test("trajectory_judge: appliesTo is true only when the test has non-empty referenceLogic", () => {
  const { generate } = trackedGenerate({ text: '{"trajectory_score": 5}', usage: USAGE });
  const judge = createTrajectoryJudge({ resolveJudge: CONFIGURED, generate });
  const ctx = (referenceLogic: unknown) =>
    ({
      run: { steps: [] },
      test: { expectations: referenceLogic ? { referenceLogic } : {} },
      finalAssistantText: "",
    }) as never;
  assert.equal(
    judge.appliesTo?.(ctx({ kind: "code", language: "python", body: "df.sum()" })),
    true,
  );
  assert.equal(judge.appliesTo?.(ctx(null)), false, "no referenceLogic → does not apply");
  assert.equal(
    judge.appliesTo?.(ctx({ kind: "text", body: "   " })),
    false,
    "blank referenceLogic body → does not apply",
  );
});

test("trajectory_judge: unconfigured judge → unevaluable (score null), generate never called", async () => {
  const { generate, calls } = trackedGenerate({ text: '{"trajectory_score": 5}', usage: USAGE });
  const judge = createTrajectoryJudge({ resolveJudge: () => null, generate });
  const ctx = {
    run: { steps: [] },
    test: {
      userPrompt: "Q",
      expectations: { referenceLogic: { kind: "text", body: "reference" } },
    },
    finalAssistantText: "",
  } as never;
  const r = await judge.grade(ctx);
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.equal(calls(), 0, "an unconfigured judge makes no provider call");
});

test("trajectory_judge: an unparseable judge response → error (never a silent 0)", async () => {
  const judge = createTrajectoryJudge({
    resolveJudge: CONFIGURED,
    generate: async () => ({ text: "I really cannot decide", usage: USAGE }),
  });
  const ctx = {
    run: { steps: [] },
    test: {
      userPrompt: "Q",
      expectations: { referenceLogic: { kind: "text", body: "reference" } },
    },
    finalAssistantText: "",
  } as never;
  const r = await judge.grade(ctx);
  assert.equal(r.status, "error");
  assert.strictEqual(r.score, null);
  assert.match(r.reasoning ?? "", /no parseable score/);
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

/** Seed a completed run with a sql_query→result + chart→result tool chain (idxs 0..4). */
function seedRunWithTools(
  db: AppDatabase,
  opts: { runId: string; testId: string; costUsd: number },
): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd)
     VALUES (@runId, @testId, 'scn-1', 'automated', 'completed', 'completed', @now, @cost)`,
  ).run({ runId: opts.runId, testId: opts.testId, now: NOW, cost: opts.costUsd });

  const insertStep = db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, payload_json)
     VALUES (@id, @runId, @idx, @type, @label, @status, @toolName, @payload)`,
  );
  const steps = [
    {
      idx: 0,
      type: "tool_call",
      label: "sql_query",
      status: "running",
      toolName: "sql_query",
      payload: { toolCallId: "c1", args: { sql: "SELECT sum(sales)" } },
    },
    {
      idx: 1,
      type: "tool_result",
      label: "sql_query",
      status: "ok",
      toolName: "sql_query",
      payload: { toolCallId: "c1", result: "sum=42" },
    },
    {
      idx: 2,
      type: "tool_call",
      label: "chart",
      status: "running",
      toolName: "chart",
      payload: { toolCallId: "c2", args: { kind: "bar" } },
    },
    {
      idx: 3,
      type: "tool_result",
      label: "chart",
      status: "ok",
      toolName: "chart",
      payload: { toolCallId: "c2", result: "chart-ok" },
    },
    {
      idx: 4,
      type: "llm_response",
      label: "answer",
      status: "ok",
      toolName: null,
      payload: { text: "done" },
    },
  ];
  for (const s of steps) {
    insertStep.run({
      id: `${opts.runId}-s${s.idx}`,
      runId: opts.runId,
      idx: s.idx,
      type: s.type,
      label: s.label,
      status: s.status,
      toolName: s.toolName,
      payload: JSON.stringify(s.payload),
    });
  }
}

function makeService(db: AppDatabase, graders: readonly Grader[]) {
  const tests = new TestService(new TestRepository(db));
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const service = new GradeService(grades, tests, runs, graders);
  return { tests, runs, grades, service };
}

// ── (3) Absent referenceLogic → the grader is SKIPPED (no row) and generate is NOT called ──────────

test("gradeRun: a test WITHOUT referenceLogic → NO trajectory_judge row and generate is never called", async () => {
  const db = createDatabase();
  seedParents(db);
  const { generate, calls } = trackedGenerate({
    text: '{"trajectory_score": 8, "calculation_comparison": "x"}',
    usage: USAGE,
  });
  const judge = createTrajectoryJudge({ resolveJudge: CONFIGURED, generate });
  const { tests, service, grades } = makeService(db, [judge]);

  // The test HAS expectations (so gradeRun proceeds) but NO referenceLogic → the trajectory judge opts out.
  const created = tests.create({
    name: "No-ref",
    userPrompt: "Compute Q1 revenue.",
    addedProfiles: [],
    expectations: { expectedInsight: "revenue grew" },
  });
  seedRunWithTools(db, { runId: "run-noref", testId: created.id, costUsd: 0.5 });

  const rows = await service.gradeRun("run-noref");
  assert.equal(
    rows.find((r) => r.graderId === TRAJECTORY_JUDGE_ID),
    undefined,
    "no trajectory_judge row was produced",
  );
  assert.equal(
    grades.listByRun("run-noref").filter((g) => g.graderId === TRAJECTORY_JUDGE_ID).length,
    0,
  );
  assert.equal(
    calls(),
    0,
    "the judge made NO provider call (no wasted cost) when referenceLogic is absent",
  );
});

test("gradeRun: the SAME test WITH referenceLogic → a graded trajectory_judge row IS produced", async () => {
  const db = createDatabase();
  seedParents(db);
  const { generate, calls } = trackedGenerate({
    text: '{"calculation_comparison": "the sql sums sales as the reference does", "trajectory_score": 8, "score_reason": "chart at step 2 is redundant"}',
    usage: USAGE,
  });
  const judge = createTrajectoryJudge({ resolveJudge: CONFIGURED, generate });
  const { tests, service } = makeService(db, [judge]);

  const created = tests.create({
    name: "With-ref",
    userPrompt: "Compute total sales.",
    addedProfiles: [],
    expectations: {
      referenceLogic: { kind: "code", language: "python", body: "df['sales'].sum()" },
    },
  });
  seedRunWithTools(db, { runId: "run-ref", testId: created.id, costUsd: 0.5 });

  const rows = await service.gradeRun("run-ref");
  const row = rows.find((r) => r.graderId === TRAJECTORY_JUDGE_ID);
  assert.equal(row?.status, "graded");
  assert.equal(row?.kind, "llm");
  assert.equal(row?.rawScore, 8, "the 0–10 rubric value is the rawScore");
  assert.equal(row?.score, 0.8, "score = rawScore / 10");
  assert.match(row?.reasoning ?? "", /sums sales/);
  assert.equal(calls(), 1, "exactly one provider call");
});

// ── (4) Evidence idxs resolve to real steps ───────────────────────────────────────────────────────

test("gradeRun: trajectory evidence idxs are the examined operations' step idxs and resolve to real steps", async () => {
  const db = createDatabase();
  seedParents(db);
  const { generate } = trackedGenerate({
    text: '{"trajectory_score": 7, "calculation_comparison": "ok"}',
    usage: USAGE,
  });
  const judge = createTrajectoryJudge({ resolveJudge: CONFIGURED, generate });
  const { tests, runs, service } = makeService(db, [judge]);

  const created = tests.create({
    name: "Ev",
    userPrompt: "Q",
    addedProfiles: [],
    expectations: { referenceLogic: { kind: "text", body: "sum sales, then chart" } },
  });
  seedRunWithTools(db, { runId: "run-ev", testId: created.id, costUsd: 0 });

  const rows = await service.gradeRun("run-ev");
  const row = rows.find((r) => r.graderId === TRAJECTORY_JUDGE_ID);
  const evidence = row?.evidence as number[];
  assert.deepEqual(evidence, [0, 2], "evidence = the tool_call step idxs the digest paired");

  // Every cited idx resolves to a real step in the persisted run.
  const stepIdxs = new Set(runs.getRun("run-ev").steps.map((s) => s.index));
  for (const idx of evidence)
    assert.ok(stepIdxs.has(idx), `evidence step ${idx} resolves to a real run step`);
});

// ── (5) Judge cost lands on the judge_* ledger, NOT on runs.cost_usd ───────────────────────────────

test("gradeRun: trajectory judge cost lands ONLY in the judge_* ledger; runs.cost_usd is byte-identical", async () => {
  const db = createDatabase();
  seedParents(db);
  const { generate } = trackedGenerate({
    text: '{"trajectory_score": 9, "calculation_comparison": "strong match"}',
    usage: USAGE,
  });
  const judge = createTrajectoryJudge({ resolveJudge: CONFIGURED, generate });
  const { tests, grades, service } = makeService(db, [judge]);

  const created = tests.create({
    name: "Cost",
    userPrompt: "Q",
    addedProfiles: [],
    expectations: { referenceLogic: { kind: "code", language: "sql", body: "SELECT sum(sales)" } },
  });
  seedRunWithTools(db, { runId: "run-cost", testId: created.id, costUsd: 2.53179 });

  const runBefore = db.prepare("SELECT cost_usd FROM runs WHERE id = 'run-cost'").get() as {
    cost_usd: number;
  };
  await service.gradeRun("run-cost");
  const runAfter = db.prepare("SELECT cost_usd FROM runs WHERE id = 'run-cost'").get() as {
    cost_usd: number;
  };

  assert.strictEqual(
    runAfter.cost_usd,
    runBefore.cost_usd,
    "runs.cost_usd is byte-identical before/after grading",
  );
  assert.strictEqual(runAfter.cost_usd, 2.53179);

  const row = grades.latestByGrader("run-cost").find((g) => g.graderId === TRAJECTORY_JUDGE_ID);
  assert.equal(row?.status, "graded");
  assert.equal(row?.judgeTokensIn, 1200);
  assert.equal(row?.judgeTokensOut, 80);
  const expectedCost = estimateCost(PRICED_MODEL, { inputTokens: 1200, outputTokens: 80 });
  assert.ok(expectedCost > 0, "the priced judge model has a real cost");
  assert.ok(
    Math.abs((row?.judgeCostUsd ?? 0) - expectedCost) < 1e-12,
    "judge cost == estimateCost(model, usage)",
  );
  assert.equal(row?.judgeProviderId, "prov-1");
  assert.equal(row?.judgeModel, PRICED_MODEL);
});
