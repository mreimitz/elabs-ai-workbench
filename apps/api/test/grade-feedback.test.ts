// Benchmarks Phase 6 WP 6.1 — human verdicts ON grades (`grade_feedback`) + the derived calibration
// set, STRICTLY SEPARATE from grading (AR6/B15).
//
// Proves (the WP's five Acceptance items):
//   1. Feedback ROUND-TRIPS — POST → GET, per grade and per run, with the note preserved; a changed
//      mind APPENDS (the history is kept, newest wins) rather than replacing; unknown grade → 404;
//      a malformed body → 400; and there is deliberately NO update/delete route at all.
//   2. GRADE ROWS ARE UNTOUCHED BY FEEDBACK — a full-row snapshot of `run_grades` taken before and
//      after every kind of feedback write is byte-identical, `GET /api/runs/:id/grades` returns the
//      same document, and suite AGGREGATES + ANALYTICS are byte-identical too (the same shape of
//      proof `run-feedback.test.ts` uses for D-OB15). Each assertion is paired with a check that the
//      feedback really was persisted, so none of them can pass vacuously.
//   3. The EXPORT CONTAINS NO SECRETS — an encrypted provider key, an MCP env secret, an auth
//      header, a tool payload and the judge's own `reasoning` are all seeded around a member run,
//      and none of them appears in the JSON or the Markdown export.
//   4. Calibration-set membership is DERIVED (a run appears exactly when one of its grades carries
//      feedback), totals/latest-verdict/grading-version reporting are correct, and deleting a run
//      cascades its feedback away.
//   5. (Both themes / the gate are outside a node test — see the WP report.)

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { CalibrationSet, GradeFeedback } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { buildCalibrationSet } from "../src/grading/calibration.js";
import { createCalibrationMarkdown } from "../src/grading/calibration-markdown.js";
import { registerCalibrationRoutes } from "../src/grading/calibration-routes.js";
import { GradeFeedbackRepository } from "../src/grading/grade-feedback-repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { collectAnalyticsChildren, computeSuiteAnalytics } from "../src/suites/analytics.js";
import { collectChildData, computeSuiteAggregates } from "../src/suites/orchestrator.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-08-21T00:00:00.000Z";

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

async function setup(): Promise<{
  db: AppDatabase;
  app: FastifyInstance;
  feedback: GradeFeedbackRepository;
}> {
  const db = openFresh();
  const feedback = new GradeFeedbackRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerCalibrationRoutes(app, db, feedback);
  await app.ready();
  apps.push(app);
  return { db, app, feedback };
}

let seq = 0;

/** Seed one provider/environment/test + a run. Each call gets fresh ids. */
function seedRun(
  db: AppDatabase,
  opts: { costUsd?: number; tokens?: number; startedAt?: string } = {},
): { runId: string; testId: string; scenarioId: string } {
  const n = seq++;
  const providerId = `prov-${n}`;
  const scenarioId = `scn-${n}`;
  const testId = `test-${n}`;
  const runId = `run-${n}`;
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(providerId, "anthropic", "Claude", NOW, NOW);
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run(scenarioId, `Environment ${n}`, providerId, "claude-sonnet-4", NOW, NOW);
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(testId, `Test ${n}`, "go", NOW, NOW);
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd, tokens_in, tokens_out)
     VALUES (?,?,?,'automated','completed',?,?,?,?)`,
  ).run(runId, testId, scenarioId, opts.startedAt ?? NOW, opts.costUsd ?? 0, opts.tokens ?? 0, 0);
  return { runId, testId, scenarioId };
}

/** Insert one grade row directly (the append-only ledger this WP must leave alone). */
function seedGrade(
  db: AppDatabase,
  runId: string,
  over: {
    id?: string;
    graderId?: string;
    kind?: string;
    status?: string;
    score?: number | null;
    method?: string;
    reasoning?: string | null;
    judgeModel?: string | null;
    judgeProviderId?: string | null;
    gradingVersion?: number;
  } = {},
): string {
  const id = over.id ?? `grade-${seq++}`;
  db.prepare(
    `INSERT INTO run_grades
       (id, run_id, grader_id, kind, status, score, raw_score, method, reasoning, evidence_json,
        judge_provider_id, judge_model, judge_tokens_in, judge_tokens_out, judge_cost_usd,
        grading_version, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    runId,
    over.graderId ?? "outcome_judge",
    over.kind ?? "llm",
    over.status ?? "graded",
    over.score === undefined ? 0.7 : over.score,
    null,
    over.method ?? "single_sample",
    over.reasoning ?? null,
    null,
    over.judgeProviderId ?? null,
    over.judgeModel ?? null,
    0,
    0,
    0,
    over.gradingVersion ?? 1,
    NOW,
  );
  return id;
}

/** Every `run_grades` row, ordered, as one comparable string. The "untouched" proof rests on this. */
function gradeSnapshot(db: AppDatabase): string {
  return JSON.stringify(db.prepare("SELECT * FROM run_grades ORDER BY id ASC").all());
}

// ── (1) Round-trip + append-only + validation ───────────────────────────────────────────────────

test("Acceptance #1 — a verdict round-trips: POST 201 → GET returns it, note preserved", async () => {
  const { db, app } = await setup();
  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId);

  const created = await app.inject({
    method: "POST",
    url: `/api/grades/${gradeId}/feedback`,
    payload: { verdict: "disagree", note: "The judge rewarded a wrong answer." },
  });
  assert.equal(created.statusCode, 201);
  const row = created.json() as GradeFeedback;
  assert.equal(row.gradeId, gradeId);
  assert.equal(row.runId, runId, "the row carries its grade's run id, resolved by join");
  assert.equal(row.verdict, "disagree");
  assert.equal(row.note, "The judge rewarded a wrong answer.");
  assert.ok(row.createdAt, "created_at is stamped server-side");

  const listed = await app.inject({ method: "GET", url: `/api/runs/${runId}/grade-feedback` });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), [row], "GET by run returns exactly the row that was POSTed");
});

test("APPEND-ONLY — a changed mind appends; the older verdict is KEPT and the newest wins", async () => {
  const { db, app } = await setup();
  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId);

  await app.inject({
    method: "POST",
    url: `/api/grades/${gradeId}/feedback`,
    payload: { verdict: "agree" },
  });
  await app.inject({
    method: "POST",
    url: `/api/grades/${gradeId}/feedback`,
    payload: { verdict: "disagree", note: "Changed my mind after reading the trace." },
  });

  const rows = (
    await app.inject({ method: "GET", url: `/api/runs/${runId}/grade-feedback` })
  ).json() as GradeFeedback[];
  assert.equal(
    rows.length,
    2,
    "the first verdict is HISTORY, not overwritten (contrast run_feedback)",
  );
  assert.equal(rows[0]?.verdict, "agree", "oldest first");
  assert.equal(rows[1]?.verdict, "disagree");
  assert.notEqual(rows[0]?.id, rows[1]?.id, "two distinct rows, not one updated row");

  const set = buildCalibrationSet(db);
  assert.equal(
    set.runs[0]?.grades[0]?.latestVerdict,
    "disagree",
    "newest verdict wins for display",
  );
  assert.equal(
    set.runs[0]?.grades[0]?.feedback.length,
    2,
    "the full history travels with the grade",
  );
});

test("there is NO update and NO delete route — feedback cannot be edited away", async () => {
  const { db, app } = await setup();
  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId);
  const created = (
    await app.inject({
      method: "POST",
      url: `/api/grades/${gradeId}/feedback`,
      payload: { verdict: "agree" },
    })
  ).json() as GradeFeedback;

  for (const method of ["PUT", "PATCH", "DELETE"] as const) {
    const response = await app.inject({
      method,
      url: `/api/grades/${gradeId}/feedback/${created.id}`,
      payload: { verdict: "disagree" },
    });
    assert.equal(
      response.statusCode,
      404,
      `${method} on a feedback row is not a route that exists`,
    );
  }
  // And the repository itself exposes no such operation.
  const repo = new GradeFeedbackRepository(db) as unknown as Record<string, unknown>;
  for (const forbidden of ["update", "delete", "upsert", "remove"]) {
    assert.equal(
      typeof repo[forbidden],
      "undefined",
      `GradeFeedbackRepository must not expose ${forbidden}() — feedback is append-only`,
    );
  }
});

test("an unknown grade is a 404 — never an orphan feedback row", async () => {
  const { app, db } = await setup();
  const response = await app.inject({
    method: "POST",
    url: "/api/grades/does-not-exist/feedback",
    payload: { verdict: "agree" },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM grade_feedback").get() as { n: number }).n,
    0,
    "nothing was written",
  );
});

test("validation — bad verdict, missing verdict, and an unknown key are each a 400", async () => {
  const { db, app } = await setup();
  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId);

  for (const payload of [
    { verdict: "maybe" },
    { note: "no verdict" },
    // The important one: a caller must not be able to smuggle a NUMBER into this table under a name
    // that could later be mistaken for a score (AR6). `.strict()` makes it a 400, not a dropped field.
    { verdict: "agree", score: 0.9 },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: `/api/grades/${gradeId}/feedback`,
      payload,
    });
    assert.equal(response.statusCode, 400, `${JSON.stringify(payload)} is rejected`);
  }
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM grade_feedback").get() as { n: number }).n,
    0,
    "no partial row survived a rejected body",
  );
});

// ── (2) Acceptance #2 — GRADE ROWS UNTOUCHED BY FEEDBACK ────────────────────────────────────────

test("Acceptance #2 — every grade row is BYTE-IDENTICAL before and after feedback is written", async () => {
  const { db, app } = await setup();
  const { runId } = seedRun(db);
  const graded = seedGrade(db, runId, { id: "g-judge", score: 0.42, reasoning: "weak answer" });
  const unevaluable = seedGrade(db, runId, {
    id: "g-rouge",
    graderId: "rouge1",
    kind: "deterministic",
    status: "unevaluable",
    score: null,
    method: "unigram_f1",
  });

  const before = gradeSnapshot(db);

  // Every write path this WP adds, over both a scored and an unscored grade, agree and disagree,
  // with and without a note, twice on the same grade (the append path).
  for (const [id, payload] of [
    [graded, { verdict: "disagree", note: "60% would have been fair." }],
    [graded, { verdict: "agree" }],
    [unevaluable, { verdict: "agree", note: "Correctly not evaluable." }],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: `/api/grades/${id}/feedback`,
      payload,
    });
    assert.equal(response.statusCode, 201);
  }
  // …and the read paths, which must also be pure.
  await app.inject({ method: "GET", url: `/api/runs/${runId}/grade-feedback` });
  await app.inject({ method: "GET", url: "/api/calibration/json" });
  await app.inject({ method: "GET", url: "/api/calibration/markdown" });

  assert.equal(
    gradeSnapshot(db),
    before,
    "run_grades is byte-identical: no score, status, method, reasoning or version moved",
  );

  // The assertion is NOT vacuous — three verdicts really did land.
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM grade_feedback").get() as { n: number }).n,
    3,
    "three verdicts were actually persisted",
  );
  // And nothing added a column to run_grades that could carry a verdict back into a grade.
  const ddl = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='run_grades'")
    .get() as { sql: string };
  assert.ok(
    !/feedback|verdict/i.test(ddl.sql),
    "run_grades has no feedback/verdict column — the two dimensions cannot be conflated in storage",
  );
});

test("Acceptance #2 — GET /api/runs/:id/grades returns the SAME document after feedback", async () => {
  const { db, app } = await setup();
  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId, { score: 0.9 });
  const grades = new GradeRepository(db);

  const before = JSON.stringify(grades.listByRun(runId));
  const latestBefore = JSON.stringify(grades.latestByGrader(runId));

  await app.inject({
    method: "POST",
    url: `/api/grades/${gradeId}/feedback`,
    payload: { verdict: "disagree", note: "Too generous." },
  });

  assert.equal(JSON.stringify(grades.listByRun(runId)), before, "the grade history is unchanged");
  assert.equal(
    JSON.stringify(grades.latestByGrader(runId)),
    latestBefore,
    "latest-per-grader — what the UI displays — is unchanged",
  );
  assert.equal(
    new GradeFeedbackRepository(db).listByGrade(gradeId).length,
    1,
    "…and the verdict really was stored (the assertion above is not vacuous)",
  );
});

test("AR6 SEPARATION — suite aggregates + analytics are BYTE-IDENTICAL with vs without feedback", async () => {
  const { db, feedback } = await setup();
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const tests = new TestService(new TestRepository(db));

  const a = seedRun(db, { costUsd: 1.0, tokens: 150 });
  const b = seedRun(db, { costUsd: 2.0, tokens: 300 });
  const runIds = [a.runId, b.runId];
  const gradeA = seedGrade(db, a.runId, { id: "agg-a", score: 0.7 });
  const gradeB = seedGrade(db, b.runId, { id: "agg-b", score: 0.5 });

  const aggregatesBefore = computeSuiteAggregates(
    collectChildData(runs, grades, runIds),
    runIds.length,
  );
  const analyticsBefore = computeSuiteAnalytics(
    collectAnalyticsChildren(runs, grades, tests, runIds),
  );

  // A human disagrees with BOTH grades — the strongest case for an aggregate to "helpfully" move.
  feedback.append(gradeA, { verdict: "disagree", note: "Wrong." });
  feedback.append(gradeB, { verdict: "disagree" });

  assert.equal(
    JSON.stringify(computeSuiteAggregates(collectChildData(runs, grades, runIds), runIds.length)),
    JSON.stringify(aggregatesBefore),
    "suite AGGREGATES (meanGrade, passRateAt05, costs) never read grade feedback",
  );
  assert.equal(
    JSON.stringify(computeSuiteAnalytics(collectAnalyticsChildren(runs, grades, tests, runIds))),
    JSON.stringify(analyticsBefore),
    "suite ANALYTICS (scatter/breakdowns) never read grade feedback",
  );

  // Not vacuous: the numbers are the real grade-only ones, and the feedback is readable elsewhere.
  assert.equal(aggregatesBefore.meanGrade, 0.6);
  assert.equal(analyticsBefore.scatter.length, 2);
  assert.equal(feedback.listByRun(a.runId).length, 1);
  assert.equal(feedback.listByRun(b.runId).length, 1);
});

// ── (3) Acceptance #3 — the export contains no secrets ──────────────────────────────────────────

const SECRETS = {
  providerKey: "enc:v1:PROVIDER-KEY-MUST-NOT-LEAK",
  mcpEnv: "MCP-ENV-SECRET-MUST-NOT-LEAK",
  authHeader: "Bearer AUTH-HEADER-MUST-NOT-LEAK",
  toolPayload: "TOOL-PAYLOAD-MUST-NOT-LEAK",
  judgeReasoning: "JUDGE-REASONING-MUST-NOT-LEAK",
  judgeProviderId: "prov-credential-id-MUST-NOT-LEAK",
} as const;

/** A member run surrounded by every class of sensitive value the app persists. */
function seedSecretLadenMember(db: AppDatabase, feedback: GradeFeedbackRepository): string {
  const { runId, scenarioId } = seedRun(db);
  db.prepare(
    "UPDATE provider_credentials SET api_key_encrypted = ? WHERE id = (SELECT provider_id FROM scenarios WHERE id = ?)",
  ).run(SECRETS.providerKey, scenarioId);
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, env_json, headers_json, auth_type, created_at, updated_at)
     VALUES ('srv-secret','Secret server','stdio','node',?,?,'bearer',?,?)`,
  ).run(
    JSON.stringify({ API_TOKEN: SECRETS.mcpEnv }),
    JSON.stringify({ Authorization: SECRETS.authHeader }),
    NOW,
    NOW,
  );
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, payload_json)
     VALUES ('step-secret', ?, 0, 'tool_call', 'call', 'completed', ?)`,
  ).run(runId, JSON.stringify({ args: { token: SECRETS.toolPayload } }));
  const gradeId = seedGrade(db, runId, {
    id: "grade-secret",
    reasoning: SECRETS.judgeReasoning,
    judgeModel: "claude-sonnet-4",
    judgeProviderId: SECRETS.judgeProviderId,
  });
  feedback.append(gradeId, { verdict: "disagree", note: "Judge missed the point." });
  return runId;
}

test("Acceptance #3 — neither export carries a secret, a credential reference, or a payload", async () => {
  const { db, app, feedback } = await setup();
  seedSecretLadenMember(db, feedback);

  const json = await app.inject({ method: "GET", url: "/api/calibration/json" });
  assert.equal(json.statusCode, 200);
  const markdown = await app.inject({ method: "GET", url: "/api/calibration/markdown" });
  assert.equal(markdown.statusCode, 200);
  assert.match(markdown.headers["content-type"] as string, /text\/markdown/);

  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!json.body.includes(value), `the JSON export must not contain the ${name}`);
    assert.ok(!markdown.body.includes(value), `the Markdown export must not contain the ${name}`);
  }

  // Not vacuous: the member run IS in the export, with everything the calibration set is FOR.
  const set = json.json() as CalibrationSet;
  assert.equal(set.totals.runs, 1);
  assert.equal(set.totals.gradesWithFeedback, 1);
  assert.equal(set.runs[0]?.grades[0]?.judgeModel, "claude-sonnet-4", "a model NAME is fine");
  assert.equal(set.runs[0]?.grades[0]?.feedback[0]?.note, "Judge missed the point.");
  assert.ok(markdown.body.includes("Judge missed the point."), "the human's note is rendered");
  // The two specific fields we chose to withhold are genuinely absent from the shape, not just
  // absent from this fixture's values.
  const grade = set.runs[0]?.grades[0] as unknown as Record<string, unknown>;
  assert.equal(grade.judgeProviderId, undefined, "no provider-credential reference on the wire");
  assert.equal(grade.reasoning, undefined, "no judge reasoning on the wire");
});

// ── (4) The calibration set itself ──────────────────────────────────────────────────────────────

test("membership is DERIVED — only graded runs that carry feedback are in the set", async () => {
  const { db, feedback } = await setup();
  const withFeedback = seedRun(db);
  const gradedOnly = seedRun(db);
  seedRun(db); // ungraded, unfed — must not appear at all
  const gradeId = seedGrade(db, withFeedback.runId);
  seedGrade(db, gradedOnly.runId, { id: "lonely-grade" });

  assert.equal(buildCalibrationSet(db).totals.runs, 0, "an empty feedback table is an empty set");

  feedback.append(gradeId, { verdict: "agree" });
  const set = buildCalibrationSet(db);
  assert.equal(set.totals.runs, 1, "recording a verdict is what puts a run in the set");
  assert.equal(set.runs[0]?.runId, withFeedback.runId);
  assert.equal(
    set.runs.some((run) => run.runId === gradedOnly.runId),
    false,
    "a graded run with no human verdict is NOT a calibration member",
  );
});

test("totals + grading-version reporting are right, and mixed versions are called out", async () => {
  const { db, feedback } = await setup();
  const { runId } = seedRun(db);
  const v1 = seedGrade(db, runId, { id: "gv1", gradingVersion: 1 });
  const v2 = seedGrade(db, runId, { id: "gv2", graderId: "rouge1", gradingVersion: 2 });

  feedback.append(v1, { verdict: "agree" });
  feedback.append(v1, { verdict: "disagree", note: "on reflection" });
  feedback.append(v2, { verdict: "agree" });

  const set = buildCalibrationSet(db);
  assert.deepEqual(set.totals, {
    runs: 1,
    gradesWithFeedback: 2,
    verdicts: 3,
    agree: 1, // gv1's LATEST is disagree; gv2's is agree
    disagree: 1,
    notes: 1,
  });
  assert.equal(
    set.totals.agree + set.totals.disagree,
    set.totals.gradesWithFeedback,
    "the latest-verdict split partitions the member grades exactly",
  );
  assert.deepEqual(set.gradingVersions, [1, 2]);

  const markdown = createCalibrationMarkdown(set);
  assert.match(
    markdown,
    /spans 2 grading versions/,
    "a mixed-version sample says so rather than inviting a silent average",
  );
});

test("the empty set renders an honest document rather than an empty page", async () => {
  const { db } = await setup();
  const markdown = createCalibrationMarkdown(buildCalibrationSet(db));
  assert.match(markdown, /# Calibration set/);
  assert.match(markdown, /Empty\. No grade has been given a human verdict yet/);
});

test("deleting a run cascades its grades AND their feedback away", async () => {
  const { db, feedback } = await setup();
  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId);
  feedback.append(gradeId, { verdict: "agree" });
  assert.equal(buildCalibrationSet(db).totals.runs, 1);

  db.prepare("DELETE FROM runs WHERE id = ?").run(runId);

  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM grade_feedback").get() as { n: number }).n,
    0,
    "run → run_grades → grade_feedback cascades all the way down",
  );
  assert.equal(buildCalibrationSet(db).totals.runs, 0);
});

test("migration v60 — a pre-v60 (v59) DB gains grade_feedback; idempotent, immediately usable", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. grade_feedback…
  db.exec("DROP TABLE IF EXISTS grade_feedback;"); // …then rewind to a pre-v60 (v59) DB
  db.pragma("user_version = 59");
  assert.equal(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='grade_feedback'").get(),
    undefined,
    "sanity: the v59 fixture lacks grade_feedback",
  );

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), 61, "stamped to LATEST (61) after v60");
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='grade_feedback'").get(),
    "v60 created grade_feedback on the existing (v59) DB",
  );
  assert.ok(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_grade_feedback_grade'")
      .get(),
    "v60 added its covering index",
  );

  const { runId } = seedRun(db);
  const gradeId = seedGrade(db, runId);
  db.prepare(
    "INSERT INTO grade_feedback (id, grade_id, verdict, note, created_at) VALUES (?,?,?,?,?)",
  ).run("f1", gradeId, "agree", null, NOW);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO grade_feedback (id, grade_id, verdict, note, created_at) VALUES (?,?,?,?,?)",
        )
        .run("f2", gradeId, "sort-of", null, NOW),
    /CHECK/,
    "the verdict CHECK rejects anything but agree/disagree",
  );

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v60 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    61,
    "version unchanged after the re-run",
  );
});
