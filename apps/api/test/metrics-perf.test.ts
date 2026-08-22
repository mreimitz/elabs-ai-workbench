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
import { measure, percentile } from "./support/perf-clock.js";
import { computeRunMetrics } from "../src/observability/metrics.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

// Both cases below used to measure WALL CLOCK, and both flaked, because `pnpm test` runs several
// packages at once: wall clock counts the time this process spends waiting to be scheduled, which is
// a property of the machine, not of the query. (Observed: the absolute case at 486 ms against a
// 500 ms ceiling; the ratio case at 3.42x against 3x.) The ceilings were NOT widened — the clock was
// changed to one the rest of the machine cannot move. The reasoning, and what this clock does NOT
// buy, is in `test/support/perf-clock.ts`; it lives there because search-perf needs it too and two
// copies of a measurement helper is how the two `buildRunFilterWhere` bodies started.

type StatementLike = { all: (...args: unknown[]) => unknown };

/**
 * `EXPLAIN QUERY PLAN` for every statement `fn` actually RUNS, with the parameters it ran them with.
 *
 * The metrics service builds its SQL privately, so the plan cannot be asked for from outside without
 * observing what it prepares: `db.prepare` is wrapped for the duration of the call (and restored in a
 * `finally`, even on a throw), each returned statement's `.all` records `(sql, params)`, and the plan
 * is taken afterwards by re-preparing `EXPLAIN QUERY PLAN <sql>` with the same bindings. Nothing in
 * `src/` changes and no query is rewritten — this reads what shipped.
 */
function queryPlansFor(
  db: AppDatabase,
  fn: () => void,
): Array<{ sql: string; detail: string[] }> {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const original = db.prepare;
  (db as unknown as { prepare: unknown }).prepare = function patched(this: AppDatabase, sql: string) {
    const statement = original.call(this, sql) as unknown as StatementLike;
    const originalAll = statement.all;
    statement.all = function all(...args: unknown[]) {
      seen.push({ sql, params: args });
      return originalAll.apply(statement, args);
    };
    return statement;
  };
  try {
    fn();
  } finally {
    (db as unknown as { prepare: unknown }).prepare = original;
  }
  return seen.map(({ sql, params }) => ({
    sql,
    detail: (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map(
      (row) => row.detail,
    ),
  }));
}

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

test(`p95 CPU < 500 ms — 30-day day-bucket grouped query over ${RUN_COUNT} runs`, () => {
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
  const cpu: number[] = [];
  const wall: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const sample = measure(call);
    cpu.push(sample.cpu);
    wall.push(sample.wall);
  }
  const cpuP95 = percentile(cpu, 0.95);
  const cpuP50 = percentile(cpu, 0.5);
  const wallP95 = percentile(wall, 0.95);
  const wallP50 = percentile(wall, 0.5);

  // Also time a SQL window-function percentile over the same window (for the recorded comparison).
  const sqlWindow = measure(() => {
    db.prepare(
      `SELECT model, day, dur, PERCENT_RANK() OVER (PARTITION BY model, day ORDER BY dur) AS pr
         FROM (SELECT s.model AS model, substr(r.started_at, 1, 10) AS day,
                      COALESCE(r.active_duration_ms, r.total_duration_ms) AS dur
                 FROM runs r JOIN scenarios s ON s.id = r.scenario_id
                WHERE r.started_at >= @from AND r.started_at <= @to
                  AND COALESCE(r.active_duration_ms, r.total_duration_ms) IS NOT NULL)`,
    ).all({ from, to });
  });

  // Determinism spot-check: two calls identical (no cache).
  assert.deepEqual(call(), call());

  console.log(
    `[metrics-perf] ${RUN_COUNT} runs · 30-day day-bucket groupBy=model — in-process CPU p50=${cpuP50.toFixed(1)}ms p95=${cpuP95.toFixed(1)}ms (wall p50=${wallP50.toFixed(1)}ms p95=${wallP95.toFixed(1)}ms); single SQL-window percentile pass CPU=${sqlWindow.cpu.toFixed(1)}ms`,
  );
  // D-OB13's 500 ms budget, measured in CPU rather than wall clock. It is the same number and the
  // same query; what changed is that a parallel web suite can no longer spend it. Wall clock is
  // logged, not asserted — on an idle machine the two are within noise of each other, and on a busy
  // one only the CPU figure is about the code. What this therefore CANNOT catch: a regression that
  // makes the query WAIT rather than compute (a lock, a disk read) — there is none to wait on here,
  // the DB is `:memory:` and better-sqlite3 is synchronous.
  assert.ok(cpuP95 < 500, `CPU p95 ${cpuP95.toFixed(1)}ms must be < 500ms`);
});


// RM-17 Phase 6 (AM-OB12) — the verdict/finding filters read a JSON member out of `run_grades`, which
// is the most expensive shape in the grammar and the one the WP spec flagged for measurement at
// pickup: had it failed the recorded 500 ms budget, the answer would have been an INDEX, and an index
// is a migration. Measured at the same 50k scale with a 150k-row `run_grades` beside it; the
// correlated EXISTS rides `idx_run_grades_run (run_id, created_at)`, which has existed since the
// table did, so no new index — and therefore no migration — was taken. Isolated numbers for the
// record: unfiltered p95 65ms; answerVerdict 74ms; errorBucket 83ms; the composed filter 101ms —
// all far inside the 500 ms budget.
//
// TWO CHECKS, and the load-independent one is the real guard (owner decision 2026-08-22 — this case
// flaked at 3.42× against a 3× ceiling, and the answer was to measure differently, not to widen it):
//
//   (a) THE QUERY PLAN. The named regression — dropping the `g.run_id = runs.id` correlation, or the
//       latest-row restriction — turns the EXISTS into a table scan of `run_grades` PER RUN. That is
//       visible in `EXPLAIN QUERY PLAN` as a SCAN where there should be a SEARCH on
//       `idx_run_grades_run`, with no clock in it at all: it cannot flake, it cannot be blamed on a
//       busy machine, and it names the defect instead of a symptom of it.
//   (b) A CPU-TIME RATIO against an unfiltered baseline, INTERLEAVED with it. Interleaving is the
//       point: baseline and cases are sampled round-robin, so drift in machine conditions across the
//       run hits all four equally, where "measure the baseline once, then measure each case" let a
//       burst of load land on exactly one of them. With CPU time (see `measure` above) on top, the
//       ratio still reads asymptotic blow-up under a loaded gate.
//
// What (b) can and cannot catch, plainly. CAN: the filtered path becoming asymptotically worse than
// the unfiltered one — a lost index correlation sends the ratio far past 3×, not to 3.4×. CANNOT: a
// slowdown that hits the baseline equally (the ratio stays ~1 — that is what (a) and the first
// test's absolute budget are for); a filtered-path regression smaller than 3×; and anything about
// real-world WALL-CLOCK latency on a loaded machine, which is a property of the machine, not the
// query. Absolute CPU figures are logged for the record, not asserted, so the budget question is
// answered by the first test's one assertion rather than by three more coin flips here.
test(`rating-verdict filters use the grades index and stay within a small multiple of the unfiltered query at ${RUN_COUNT} runs`, () => {
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

  const call = (filter: RunFilter) =>
    computeRunMetrics(db, {
      filter,
      from,
      to,
      bucket: "day",
      groupBy: "model",
      measures: ["count", "errorRate", "p95DurationMs", "tokensIn", "costUsd"],
    });

  // The two evidence shapes — a single-object verdict extraction, and the `json_each` walk over the
  // forensics inventory (the more expensive of the two) — plus the two composed. Index 0 is the
  // unfiltered baseline every ratio below is taken against.
  const variants: Array<{ label: string; filter: RunFilter }> = [
    { label: "unfiltered", filter: {} },
    { label: "answerVerdict", filter: { answerVerdict: ["unanswered"] } },
    { label: "errorBucket", filter: { errorBucket: ["skill"] } },
    {
      label: "errorFixTarget+answerVerdict",
      filter: { errorFixTarget: ["skill"], answerVerdict: ["unanswered", "partial"] },
    },
  ];

  // ── (a) The plan, with no clock in it ───────────────────────────────────────────────────────────
  for (const { label, filter } of variants.slice(1)) {
    const plans = queryPlansFor(db, () => {
      call(filter);
    });
    const gradePlans = plans.filter((plan) => plan.sql.includes("run_grades"));
    assert.ok(
      gradePlans.length > 0,
      `${label}: the harness saw no statement touching run_grades — it is watching the wrong thing`,
    );
    for (const { sql, detail } of gradePlans) {
      const scans = detail.filter((line) => /^SCAN (run_grades|g|g2)\b/.test(line));
      assert.deepEqual(
        scans,
        [],
        `${label}: the grades EXISTS must never SCAN — a per-run table scan is the regression this guards\nplan:\n${detail.join("\n")}\nsql:\n${sql}`,
      );
      assert.ok(
        detail.some((line) => line.includes("idx_run_grades_run")),
        `${label}: the grades EXISTS must SEARCH via idx_run_grades_run\nplan:\n${detail.join("\n")}`,
      );
    }
  }

  // ── (b) CPU time, interleaved ───────────────────────────────────────────────────────────────────
  const ITER = 9;
  const matched = new Map<string, number>();
  const cpu = new Map<string, number[]>();
  const wall = new Map<string, number[]>();
  for (const { label, filter } of variants) {
    const first = call(filter); // warm up the planner + statement prep
    matched.set(
      label,
      first.series
        .filter((s) => s.measure === "count")
        .flatMap((s) => s.points)
        .reduce((sum, p) => sum + p.value, 0),
    );
    cpu.set(label, []);
    wall.set(label, []);
  }
  for (let i = 0; i < ITER; i++) {
    for (const { label, filter } of variants) {
      const sample = measure(() => {
        call(filter);
      });
      (cpu.get(label) as number[]).push(sample.cpu);
      (wall.get(label) as number[]).push(sample.wall);
    }
  }

  const baselineCpu = percentile(cpu.get("unfiltered") as number[], 0.5);
  assert.ok(baselineCpu > 0, "the baseline must be measurable, or every ratio below is meaningless");

  for (const { label } of variants.slice(1)) {
    const cpuP50 = percentile(cpu.get(label) as number[], 0.5);
    const wallP50 = percentile(wall.get(label) as number[], 0.5);
    const rows = matched.get(label) as number;
    assert.ok(rows > 0, `${label} must select some rows, or the timing means nothing`);
    const ratio = cpuP50 / baselineCpu;
    console.log(
      `[metrics-perf] ${RUN_COUNT} runs · ${gradeCount} grades · filter=${label} (${rows} matched) — CPU p50=${cpuP50.toFixed(1)}ms vs unfiltered ${baselineCpu.toFixed(1)}ms (${ratio.toFixed(2)}x CPU); wall p50=${wallP50.toFixed(1)}ms`,
    );
    // 3x leaves room for a filtered query that reads FEWER rows but pays the JSON walk, while still
    // failing loudly on asymptotic blow-up. (a) above is what actually names the regression.
    assert.ok(
      ratio < 3,
      `${label}: ${ratio.toFixed(2)}x the unfiltered query's CPU (p50 ${cpuP50.toFixed(1)}ms) — the JSON extraction should not dominate`,
    );
  }
});
