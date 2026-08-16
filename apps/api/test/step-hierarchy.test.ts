import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { RunEvent, RunStep, SpanKind } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import type { Grader, GraderResult } from "../src/grading/grader.js";
import type { AccountingSink } from "../src/testing/accounting.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { createAccountingStepSink } from "../src/testing/run-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toolIoDetail, type ToolCallOutcome } from "../src/testing/tool-bridge.js";

// Observability WP3.1 (D-OB17) — the step-hierarchy metadata (parentStepId + spanKind) + its emitters.
// The persistence-layer choke points are exercised directly (RunRepository.onEvent is the public sink;
// appendDerivedStep is the post-terminal emit primitive) so each documented tree shape + the parent-link
// validation + the old-run FLAT replay + seq monotonicity are proven without a live provider.

const NOW = "2026-07-16T00:00:00.000Z";
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

function seedParents(db: AppDatabase, testId = "test-1"): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES ('scn-1', 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'List files', 'Use the tools, then answer.', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });
}

/** Build a minimal `{type:"step"}` RunEvent — the persistence sink only needs these core fields. */
function stepEvent(step: Partial<RunStep> & { id: string }): Extract<RunEvent, { type: "step" }> {
  return {
    type: "step",
    step: {
      runId: "run-1",
      index: 0,
      type: "context_event",
      label: step.id,
      status: "ok",
      profileTokens: {},
      payload: {},
      ...step,
    },
  };
}

function startRun(db: AppDatabase, runId = "run-1"): RunRepository {
  const repo = new RunRepository(db);
  repo.createRun(runId, { testId: "test-1", scenarioId: "scn-1", mode: "automated" });
  return repo;
}

// ── (1) Live path — an emitted parentStepId resolves to the persisted parent row id; spanKind persists ─

test("onEvent: a child step's emitted parentStepId resolves to the PERSISTED parent id; spanKind round-trips", () => {
  const db = createDatabase();
  seedParents(db);
  const repo = startRun(db);

  // Parent emitted first, then a child referencing the parent's EMITTED id.
  repo.onEvent("run-1", stepEvent({ id: "emit-parent", index: 0, spanKind: "tool_call" }));
  repo.onEvent(
    "run-1",
    stepEvent({ id: "emit-child", index: 1, spanKind: "tool_io", parentStepId: "emit-parent" }),
  );

  const steps = repo.getRun("run-1").steps;
  assert.equal(steps.length, 2, "both steps persisted flat, in emission order");
  const [parent, child] = steps;
  assert.equal(parent?.spanKind, "tool_call", "parent span kind round-trips");
  assert.equal(child?.spanKind, "tool_io", "child span kind round-trips");
  // The persisted ids are fresh (not the emitted ids), but the link points at the persisted PARENT row.
  assert.notEqual(
    child?.parentStepId,
    "emit-parent",
    "the raw emitted id is NOT persisted verbatim",
  );
  assert.equal(
    child?.parentStepId,
    parent?.id,
    "child.parentStepId === the persisted parent row id",
  );
  assert.equal(parent?.parentStepId, undefined, "the parent itself has no parent (flat root)");
  // Monotonic idx — the tree is a rendering of the link, never a reordering.
  assert.deepEqual(
    steps.map((s) => s.index),
    [0, 1],
    "idx stays strictly monotonic in emission order",
  );
});

// ── (2) Parent-link validation — a dangling OR forward reference is dropped to undefined (flat) ────

test("onEvent: a dangling parentStepId and a FORWARD reference both resolve to undefined (flat)", () => {
  const db = createDatabase();
  seedParents(db);
  const repo = startRun(db);

  // (a) dangling — references an id that was never emitted.
  repo.onEvent("run-1", stepEvent({ id: "s0", index: 0, parentStepId: "does-not-exist" }));
  // (b) forward — this child (idx 1) references a parent emitted AFTER it (idx 2), so at persist time
  //     the parent isn't in the map yet ⇒ must NOT link (never a forward/future reference).
  repo.onEvent("run-1", stepEvent({ id: "child-forward", index: 1, parentStepId: "later-parent" }));
  repo.onEvent("run-1", stepEvent({ id: "later-parent", index: 2 }));

  const steps = repo.getRun("run-1").steps;
  assert.equal(steps[0]?.parentStepId, undefined, "dangling reference → flat (undefined)");
  assert.equal(steps[1]?.parentStepId, undefined, "forward reference → flat (undefined)");
});

// ── (3) FORWARD-ONLY — a pre-WP3.1 step (no parent/span) replays FLAT and unchanged ───────────────

test("a step persisted with NULL parent_step_id/span_kind (a pre-WP3.1 row) replays flat", () => {
  const db = createDatabase();
  seedParents(db);
  const repo = startRun(db);

  // Simulate a legacy step: emitted with no hierarchy metadata at all.
  repo.onEvent("run-1", stepEvent({ id: "legacy", index: 0, type: "llm_response" }));

  // And a raw pre-v37-shaped INSERT (columns present but NULL, exactly what an upgraded row reads back).
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status)
     VALUES ('raw-legacy', 'run-1', 1, 'tool_call', 't', 'ok')`,
  ).run();

  const steps = repo.getRun("run-1").steps;
  for (const s of steps) {
    assert.equal(s.parentStepId, undefined, `${s.label}: no parent → flat`);
    assert.equal(s.spanKind, undefined, `${s.label}: no span kind → flat`);
  }
});

// ── (4) Derived-step trees — rating→judge_call, tool_call→tool_io, probe parent→children ──────────

test("appendDerivedStep: builds the documented trees; children reference an EARLIER same-run step", () => {
  const db = createDatabase();
  seedParents(db);
  const repo = startRun(db);
  // Two ordinary execution steps first (idx 0,1) so the derived spans land AFTER them (MAX+1).
  repo.onEvent("run-1", stepEvent({ id: "x0", index: 0, type: "llm_response" }));
  repo.onEvent(
    "run-1",
    stepEvent({ id: "x1", index: 1, type: "tool_call", spanKind: "tool_call" }),
  );

  // rating → judge_call
  const ratingId = repo.appendDerivedStep("run-1", { spanKind: "rating", label: "Run review" });
  const judgeId = repo.appendDerivedStep("run-1", {
    spanKind: "judge_call",
    label: "claude-sonnet-4",
    parentStepId: ratingId,
  });
  // probe parent → probe children
  const probeId = repo.appendDerivedStep("run-1", {
    spanKind: "probe",
    label: "Compatibility probe",
  });
  const probeChildId = repo.appendDerivedStep("run-1", {
    spanKind: "probe",
    label: "SESSION_TOOL_RESULT_SIZE",
    parentStepId: probeId,
  });
  // tool_call → tool_io (the child's payload is derived by the tool-bridge helper)
  const io = toolIoDetail(sampleOutcome());
  const toolIoId = repo.appendDerivedStep("run-1", {
    spanKind: "tool_io",
    type: "context_event",
    label: `${io.toolName} io`,
    parentStepId: probeChildId, // any earlier same-run step is a valid parent
    payload: io,
  });

  const steps = repo.getRun("run-1").steps;
  const byId = new Map(steps.map((s) => [s.id, s]));

  // Every derived parent link references an EARLIER step of the SAME run (validated at persist).
  const rating = byId.get(ratingId);
  const judge = byId.get(judgeId);
  const probe = byId.get(probeId);
  const probeChild = byId.get(probeChildId);
  const toolIo = byId.get(toolIoId);
  assert.equal(rating?.spanKind, "rating");
  assert.equal(rating?.parentStepId, undefined, "the rating span is a root");
  assert.equal(judge?.spanKind, "judge_call");
  assert.equal(judge?.parentStepId, ratingId, "judge_call nests under the rating span");
  assert.equal(probeChild?.parentStepId, probeId, "probe child nests under the probe parent");
  assert.equal(toolIo?.spanKind, "tool_io");
  assert.equal(toolIo?.parentStepId, probeChildId, "tool_io links to its (earlier) parent");
  // The link always points BACKWARD (earlier idx).
  for (const [child, parent] of [
    [judge, rating],
    [probeChild, probe],
    [toolIo, probeChild],
  ] as const) {
    assert.ok(
      (child?.index ?? 0) > (parent?.index ?? 0),
      `${child?.label} (idx ${child?.index}) links to an EARLIER parent (idx ${parent?.index})`,
    );
  }
});

test("appendDerivedStep: a cross-run or unknown parent link is dropped to NULL (flat)", () => {
  const db = createDatabase();
  seedParents(db, "test-1");
  const repoA = startRun(db, "run-A");
  const repoB = startRun(db, "run-B");
  // A step in run-A, then a run-B derived step that (wrongly) references it → must NOT link.
  const foreignId = repoA.appendDerivedStep("run-A", { spanKind: "rating", label: "A review" });
  const bChildId = repoB.appendDerivedStep("run-B", {
    spanKind: "judge_call",
    label: "cross-run",
    parentStepId: foreignId,
  });
  const bStep = repoB.getRun("run-B").steps.find((s) => s.id === bChildId);
  assert.equal(bStep?.parentStepId, undefined, "a cross-run parent reference is rejected → flat");
});

// ── (5) Seq monotonicity — derived steps continue idx after the execution steps (no reordering) ───

test("appendDerivedStep continues run_steps.idx from MAX+1 — strictly monotonic, never a reorder", () => {
  const db = createDatabase();
  seedParents(db);
  const repo = startRun(db);
  repo.onEvent("run-1", stepEvent({ id: "e0", index: 0 }));
  repo.onEvent("run-1", stepEvent({ id: "e1", index: 1 }));

  const p = repo.appendDerivedStep("run-1", { spanKind: "rating", label: "review" });
  repo.appendDerivedStep("run-1", { spanKind: "judge_call", label: "j", parentStepId: p });

  const idxs = repo.getRun("run-1").steps.map((s) => s.index);
  assert.deepEqual(
    idxs,
    [0, 1, 2, 3],
    "idx is gapless + strictly increasing across execution+derived",
  );
  for (let i = 1; i < idxs.length; i++) {
    assert.ok((idxs[i] ?? 0) > (idxs[i - 1] ?? 0), "monotonic");
  }
});

// ── (6) Emitter — grade-service persists a rating span with judge_call children (gated) ───────────

function llmJudge(): Grader {
  return {
    id: "outcome_judge",
    kind: "llm",
    mandatory: true,
    grade: (): GraderResult => ({
      status: "graded",
      score: 0.9,
      rawScore: 9,
      method: "single_sample",
      judgeProviderId: "prov-1",
      judgeModel: "claude-opus-4",
      judgeTokensIn: 120,
      judgeTokensOut: 30,
      judgeCostUsd: 0.004,
    }),
  };
}

function deterministicGrader(): Grader {
  return {
    id: "answer_validation",
    kind: "deterministic",
    mandatory: true,
    grade: (): GraderResult => ({ status: "graded", score: 1, method: "det" }),
  };
}

function seedCompletedRun(db: AppDatabase, runId: string): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd)
     VALUES (@runId, 'test-1', 'scn-1', 'automated', 'completed', 'completed', @now, 0)`,
  ).run({ runId, now: NOW });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, assistant_text)
     VALUES (@id, @runId, 0, 'llm_response', 'answer', 'ok', 'the answer')`,
  ).run({ id: `${runId}-s0`, runId });
}

function makeGradeService(
  db: AppDatabase,
  graders: Grader[],
  emitReviewSpans: boolean,
): GradeService {
  return new GradeService(
    new GradeRepository(db),
    new TestService(new TestRepository(db)),
    new RunRepository(db),
    graders,
    { emitReviewSpans },
  );
}

test("GradeService (emitReviewSpans:true): a review persists a `rating` span + one `judge_call` per LLM grade", async () => {
  const db = createDatabase();
  seedParents(db);
  seedCompletedRun(db, "run-1");
  const service = makeGradeService(db, [llmJudge(), deterministicGrader()], true);

  const grades = await service.gradeRun("run-1");
  assert.equal(grades.length, 2, "both graders produced a grade row (contract unchanged)");

  const steps = new RunRepository(db).getRun("run-1").steps;
  const spans = steps.filter(
    (s): s is RunStep & { spanKind: SpanKind } => s.spanKind !== undefined,
  );
  const rating = spans.filter((s) => s.spanKind === "rating");
  const judges = spans.filter((s) => s.spanKind === "judge_call");
  assert.equal(rating.length, 1, "exactly one rating span for the review");
  assert.equal(
    judges.length,
    1,
    "one judge_call child — only the LLM grade, not the deterministic one",
  );
  assert.equal(
    judges[0]?.parentStepId,
    rating[0]?.id,
    "the judge_call nests under the rating span",
  );
  assert.equal(
    judges[0]?.label,
    "claude-opus-4",
    "the judge_call is labelled with the judge model",
  );
  const payload = judges[0]?.payload as { judgeTokensIn?: number; judgeModel?: string };
  assert.equal(payload.judgeTokensIn, 120, "the judge token detail rides on the child payload");
});

test("GradeService (default, emitReviewSpans off): a review adds NO hierarchy steps — grade rows only", async () => {
  const db = createDatabase();
  seedParents(db);
  seedCompletedRun(db, "run-1");
  const service = makeGradeService(db, [llmJudge(), deterministicGrader()], false);

  const grades = await service.gradeRun("run-1");
  assert.equal(grades.length, 2, "grade rows persisted exactly as before");
  const steps = new RunRepository(db).getRun("run-1").steps;
  assert.equal(
    steps.length,
    1,
    "no rating/judge steps appended (only the pre-existing llm_response)",
  );
  assert.ok(
    steps.every((s) => s.spanKind === undefined),
    "no step carries a span kind when the gate is off",
  );
});

// ── (7) tool-bridge — toolIoDetail derives the tool_io child payload (request/response sizes + timing) ─

function sampleOutcome(): ToolCallOutcome {
  return {
    serverId: "srv-1",
    toolName: "alpha",
    args: { key: "value" },
    durationMs: 12,
    startedAt: "2026-07-16T00:00:00.000Z",
    endedAt: "2026-07-16T00:00:00.012Z",
    result: { content: [{ type: "text", text: "ok" }], isError: false },
    isError: false,
    toolCallId: "c1",
  };
}

// ── (8) Production sink — createAccountingStepSink emits the tool_io child (MCP only, skill:// excluded) ─

test("createAccountingStepSink: an MCP tool call persists a tool_io child under its tool-call step; a skill:// disclosure read does NOT", async () => {
  const db = createDatabase();
  seedParents(db);
  const repo = new RunRepository(db);
  const manager = new RunManager(repo);
  manager.create("run-1");
  repo.createRun("run-1", { testId: "test-1", scenarioId: "scn-1", mode: "automated" });
  // The sink only reads `primaryProfile` + `recordToolResult` off the accounting sink — stub those.
  const accounting = {
    primaryProfile: "generic_o200k",
    recordToolResult: async () => 7,
  } as unknown as AccountingSink;
  const sink = createAccountingStepSink(manager, "run-1", accounting);

  // A real MCP tool call (an MCP-server serverId) → tool_call parent + a tool_io child.
  await sink.toolCall(sampleOutcome());
  // A skill-DISCLOSURE read (skill:// serverId) flows the SAME sink → a tool_call parent, but NO child.
  await sink.toolCall({
    ...sampleOutcome(),
    serverId: "skill://abc123",
    toolName: "read_skill_file",
  });
  // The manager persists on a microtask — drain it.
  await new Promise((resolve) => setImmediate(resolve));

  const steps = repo.getRun("run-1").steps;
  const toolCalls = steps.filter((s) => s.type === "tool_call");
  const toolIos = steps.filter((s) => s.spanKind === "tool_io");
  assert.equal(toolCalls.length, 2, "both calls persist a tool_call parent step");
  assert.equal(
    toolIos.length,
    1,
    "only the MCP call gets a tool_io child (the skill read is excluded)",
  );
  const child = toolIos[0]!;
  const parent = steps.find((s) => s.id === child.parentStepId);
  assert.equal(parent?.type, "tool_call", "the tool_io child nests under a tool_call step");
  assert.equal(parent?.serverId, "srv-1", "…specifically the MCP-bridge tool_call (its serverId)");
  assert.equal(
    parent?.spanKind,
    undefined,
    "the parent tool_call step itself is unchanged (no spanKind)",
  );
  assert.ok(
    parent && parent.index < child.index,
    "the child takes the next idx after its parent (monotonic)",
  );
});

test("toolIoDetail derives request/response byte sizes + timing from a settled outcome (engine-path only)", () => {
  const io = toolIoDetail(sampleOutcome());
  assert.equal(io.toolName, "alpha");
  assert.equal(io.serverId, "srv-1");
  assert.equal(io.requestBytes, Buffer.byteLength(JSON.stringify({ key: "value" }), "utf8"));
  assert.equal(
    io.responseBytes,
    Buffer.byteLength(
      JSON.stringify({ content: [{ type: "text", text: "ok" }], isError: false }),
      "utf8",
    ),
  );
  assert.equal(io.durationMs, 12);
  assert.equal(io.isError, false);

  // A transport failure carries no result → responseBytes is undefined (never fabricated).
  const failed = toolIoDetail({ ...sampleOutcome(), result: undefined, isError: true });
  assert.equal(failed.responseBytes, undefined, "no response payload → no response byte measure");
  assert.equal(failed.isError, true);
});
