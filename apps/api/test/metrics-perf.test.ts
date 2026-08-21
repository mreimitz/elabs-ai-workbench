// Observability WP1.2 — perf harness (D-OB13): metrics computed ON DEMAND must stay under the p95
// < 500 ms budget for a 30-day / day-bucket / grouped query at 50k runs, backed only by the covering
// indexes (NO rollup cache). Seeds 50k synthetic runs in a temp in-memory DB (test-only), then measures.
//
// It ALSO times a SQL window-function percentile over the same window, so the WP report can justify the
// IN-PROCESS nearest-rank choice with a measured comparison (SQLite has PERCENT_RANK but no
// PERCENTILE_CONT/DISC; the window path re-materializes every row's rank).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { RunFilter } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { computeRunMetrics } from "../src/observability/metrics.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-06-01T00:00:00.000Z";
const RUN_COUNT = 50_000;
const DAY_MS = 86_400_000;
const MODELS = ["m-a", "m-b", "m-c", "m-d", "m-e"] as const;
const STATUSES = ["completed", "completed", "completed", "error", "stopped"] as const;

/** Deterministic LCG so the seed (and thus the measured shape) is reproducible run-to-run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function seedFiftyK(db: AppDatabase): { from: string; to: string } {
  const provider = db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (@id, 'anthropic', @id, @now, @now)",
  );
  const scenario = db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (@id, @id, @providerId, @model, @now, @now)",
  );
  provider.run({ id: "prov-1", now: NOW });
  for (const m of MODELS) scenario.run({ id: `scn-${m}`, providerId: "prov-1", model: m, now: NOW });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t-1', 'T', 'go', @now, @now)",
  ).run({ now: NOW });

  // 50k runs spread across 60 days ending at a fixed instant (so a 30-day window covers ~25k rows).
  const end = Date.parse("2026-07-31T00:00:00.000Z");
  const rand = lcg(42);
  const insert = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, tokens_in, tokens_out,
        cost_usd, turns, active_duration_ms, total_duration_ms, capabilities_json)
     VALUES (@id, 't-1', @scenarioId, 'automated', @status, @outcome, @startedAt, @tokensIn, @tokensOut,
        @costUsd, 0, @activeDurationMs, NULL, NULL)`,
  );
  const insertMany = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      const model = MODELS[i % MODELS.length] as string;
      const status = STATUSES[Math.floor(rand() * STATUSES.length)] as string;
      const startedAt = new Date(end - Math.floor(rand() * 60) * DAY_MS - Math.floor(rand() * DAY_MS)).toISOString();
      insert.run({
        id: `run-${i}`,
        scenarioId: `scn-${model}`,
        status,
        outcome: status === "error" ? "error" : status === "stopped" ? "stopped_guardrail" : "completed",
        startedAt,
        tokensIn: Math.floor(rand() * 5000),
        tokensOut: Math.floor(rand() * 5000),
        costUsd: rand() * 2,
        activeDurationMs: Math.floor(rand() * 60_000),
      });
    }
  });
  insertMany(RUN_COUNT);

  return {
    from: new Date(end - 30 * DAY_MS).toISOString(),
    to: new Date(end).toISOString(),
  };
}

/**
 * RM-17 Phase 6 (AM-OB12) — give every run a base rating, so the verdict filters are measured
 * against a `run_grades` table the same order of magnitude as `runs` (3 rows per run: the two
 * verdict graders plus the forensics inventory). Deterministic: verdict is chosen by index, not by
 * the RNG, so the measured selectivity is stable run to run.
 */
function seedRatings(db: AppDatabase): void {
  const ANSWER = ["answered", "partial", "unanswered"] as const;
  const INSIGHT = ["none", "valuable", "noise"] as const;
  const BUCKETS = ["skill", "mcp_server", "model_behavior", "test_setup", "provider_infra"] as const;
  const FIX = ["skill", "mcp_server", "none"] as const;
  const rows = db.prepare("SELECT id, started_at FROM runs").all() as Array<{
    id: string;
    started_at: string;
  }>;
  const insert = db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, evidence_json, grading_version, created_at)
     VALUES (@id, @runId, @graderId, 'llm', 'graded', @score, 'perf', @evidence, 1, @createdAt)`,
  );
  const insertMany = db.transaction(() => {
    rows.forEach((row, i) => {
      const bucket = BUCKETS[i % BUCKETS.length] as string;
      // Offset so `fixTarget` is not perfectly anti-correlated with `answerVerdict` (both cycle by
      // 3): the composed case below would otherwise select zero rows and time nothing.
      const fix = FIX[(i + 1) % FIX.length] as string;
      insert.run({
        id: `g-a-${i}`,
        runId: row.id,
        graderId: "answer_validation",
        score: 0.5,
        evidence: JSON.stringify({ verdict: ANSWER[i % ANSWER.length], score: 0.5 }),
        createdAt: row.started_at,
      });
      insert.run({
        id: `g-i-${i}`,
        runId: row.id,
        graderId: "insight_surplus",
        score: 0.5,
        evidence: JSON.stringify({ verdict: INSIGHT[i % INSIGHT.length], score: 0.5 }),
        createdAt: row.started_at,
      });
      insert.run({
        id: `g-e-${i}`,
        runId: row.id,
        graderId: "error_forensics",
        score: 0.5,
        evidence: JSON.stringify([
          { id: "1", bucket, fixTarget: fix },
          { id: "2", bucket: "model_behavior", fixTarget: "none" },
        ]),
        createdAt: row.started_at,
      });
    });
  });
  insertMany();
}

test(`p95 latency < 500 ms — 30-day day-bucket grouped query over ${RUN_COUNT} runs`, () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // schema.ts baseline carries the v32 covering indexes (fresh DBs skip migrations)
  databases.push(db);
  const { from, to } = seedFiftyK(db);

  // Sanity: the covering index the hot predicate leans on exists on this fresh DB.
  const idx = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_runs_started_at'")
    .get();
  assert.ok(idx, "idx_runs_started_at must exist on the fresh DB (schema.ts baseline)");

  const call = () =>
    computeRunMetrics(db, {
      filter: {},
      from,
      to,
      bucket: "day",
      groupBy: "model",
      measures: ["count", "errorRate", "guardrailRate", "p50DurationMs", "p95DurationMs", "tokensIn", "costUsd"],
    });

  // Warm up (query planner + statement prep), then measure p95 over repeated calls.
  call();
  const ITER = 25;
  const timings: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = process.hrtime.bigint();
    call();
    timings.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.min(Math.ceil(0.95 * ITER), ITER) - 1] as number;
  const p50 = timings[Math.ceil(0.5 * ITER) - 1] as number;

  // Also time a SQL window-function percentile over the same window (for the recorded comparison).
  const t0 = process.hrtime.bigint();
  db.prepare(
    `SELECT model, day, dur, PERCENT_RANK() OVER (PARTITION BY model, day ORDER BY dur) AS pr
       FROM (SELECT s.model AS model, substr(r.started_at, 1, 10) AS day,
                    COALESCE(r.active_duration_ms, r.total_duration_ms) AS dur
               FROM runs r JOIN scenarios s ON s.id = r.scenario_id
              WHERE r.started_at >= @from AND r.started_at <= @to
                AND COALESCE(r.active_duration_ms, r.total_duration_ms) IS NOT NULL)`,
  ).all({ from, to });
  const sqlWindowMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // Determinism spot-check: two calls identical (no cache).
  assert.deepEqual(call(), call());

  console.log(
    `[metrics-perf] ${RUN_COUNT} runs · 30-day day-bucket groupBy=model — in-process p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms; single SQL-window percentile pass=${sqlWindowMs.toFixed(1)}ms`,
  );
  assert.ok(p95 < 500, `p95 ${p95.toFixed(1)}ms must be < 500ms`);
});

// RM-17 Phase 6 (AM-OB12) — the verdict/finding filters read a JSON member out of `run_grades`, which
// is the most expensive shape in the grammar and the one the WP spec flagged for measurement at
// pickup: if it could not meet the recorded 500 ms budget the answer would have been an INDEX, and an
// index is a migration. Measured here rather than assumed, at the same 50k scale, with a 150k-row
// `run_grades` beside it — the correlated EXISTS rides `idx_run_grades_run (run_id, created_at)`,
// which has existed since the table did, so no new index (and therefore no migration) was taken.
test(`p95 latency < 500 ms — rating-verdict-filtered 30-day query over ${RUN_COUNT} runs`, () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const { from, to } = seedFiftyK(db);
  seedRatings(db);

  const gradeCount = (db.prepare("SELECT COUNT(*) AS n FROM run_grades").get() as { n: number }).n;
  assert.equal(gradeCount, RUN_COUNT * 3);
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_run_grades_run'").get(),
    "idx_run_grades_run must exist on the fresh DB (schema.ts baseline) — the EXISTS leans on it",
  );

  // The two shapes: a single-object verdict extraction, and the `json_each` walk over the forensics
  // inventory (the more expensive of the two).
  const cases: Array<{ label: string; filter: RunFilter }> = [
    { label: "answerVerdict", filter: { answerVerdict: ["unanswered"] } },
    { label: "errorBucket", filter: { errorBucket: ["skill"] } },
    {
      label: "errorFixTarget+answerVerdict",
      filter: { errorFixTarget: ["skill"], answerVerdict: ["unanswered", "partial"] },
    },
  ];

  for (const { label, filter } of cases) {
    const call = () =>
      computeRunMetrics(db, {
        filter,
        from,
        to,
        bucket: "day",
        groupBy: "model",
        measures: ["count", "errorRate", "p95DurationMs", "tokensIn", "costUsd"],
      });
    const first = call(); // warm up the planner + statement prep
    const matched = first.series
      .filter((s) => s.measure === "count")
      .flatMap((s) => s.points)
      .reduce((sum, p) => sum + p.value, 0);
    assert.ok(matched > 0, `${label} must select some rows, or the timing means nothing`);

    const ITER = 15;
    const timings: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const t0 = process.hrtime.bigint();
      call();
      timings.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.min(Math.ceil(0.95 * ITER), ITER) - 1] as number;
    const p50 = timings[Math.ceil(0.5 * ITER) - 1] as number;
    console.log(
      `[metrics-perf] ${RUN_COUNT} runs · ${gradeCount} grades · filter=${label} (${matched} matched) — p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );
    assert.ok(p95 < 500, `${label}: p95 ${p95.toFixed(1)}ms must be < 500ms`);
  }
});
