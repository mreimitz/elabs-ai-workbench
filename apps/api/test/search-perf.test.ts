// Observability WP1.3 (D-OB16, acceptance #5) — full-text search p95 < 1 s on a 50k-run corpus,
// measured in CPU time rather than wall clock (see `test/support/perf-clock.ts`): `pnpm test` runs
// several packages at once, and wall clock would measure the machine's load rather than the query.
// REUSES the WP1.2 perf harness's seeding shape (apps/api/test/metrics-perf.test.ts: the deterministic
// LCG + 50k `runs` across 60 days), then bulk-loads the FTS index with per-run content and measures the
// `GET /api/runs?q=` read path (`RunRepository.queryRuns` with a `q`) — the FTS IN-filter + the normal
// sort/limit + the per-page snippet fetch.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { measure, percentile } from "./support/perf-clock.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const RUN_COUNT = 50_000;
const NOW = "2026-06-01T00:00:00.000Z";
const DAY_MS = 86_400_000;
const MODELS = ["m-a", "m-b", "m-c", "m-d", "m-e"] as const;
const STATUSES = ["completed", "completed", "completed", "error", "stopped"] as const;

/** Deterministic LCG (identical to metrics-perf.test.ts) so the corpus is reproducible run-to-run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Seed 50k runs (metrics-perf shape) + two FTS documents per run (an `assistant` + a `meta` doc). One
 *  run carries a UNIQUE needle so a selective search returns exactly one row. */
function seedFiftyK(db: AppDatabase): { needle: string; commonTerm: string } {
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-1','anthropic','prov-1',@now,@now)",
  ).run({ now: NOW });
  const scenario = db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (@id,@id,'prov-1',@model,@now,@now)",
  );
  for (const m of MODELS) scenario.run({ id: `scn-${m}`, model: m, now: NOW });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t-1','T','go',@now,@now)",
  ).run({ now: NOW });

  const end = Date.parse("2026-07-31T00:00:00.000Z");
  const rand = lcg(42);
  const insertRun = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, tokens_in, tokens_out, cost_usd)
     VALUES (@id,'t-1',@scenarioId,'automated',@status,@outcome,@startedAt,@tokensIn,@tokensOut,@costUsd)`,
  );
  const insertDoc = db.prepare(
    "INSERT INTO run_search (run_id, step_id, kind, content) VALUES (@runId,@stepId,@kind,@content)",
  );
  const commonTerm = "revenue";
  const needle = "zzunicornneedle";

  const seedAll = db.transaction(() => {
    for (let i = 0; i < RUN_COUNT; i++) {
      const model = MODELS[i % MODELS.length] as string;
      const status = STATUSES[Math.floor(rand() * STATUSES.length)] as string;
      const startedAt = new Date(
        end - Math.floor(rand() * 60) * DAY_MS - Math.floor(rand() * DAY_MS),
      ).toISOString();
      const id = `run-${i}`;
      insertRun.run({
        id,
        scenarioId: `scn-${model}`,
        status,
        outcome: status === "error" ? "error" : status === "stopped" ? "stopped_guardrail" : "completed",
        startedAt,
        tokensIn: Math.floor(rand() * 5000),
        tokensOut: Math.floor(rand() * 5000),
        costUsd: rand() * 2,
      });
      // assistant doc: the COMMON term (matches every run) + a per-run word.
      insertDoc.run({
        runId: id,
        stepId: "3",
        kind: "assistant",
        content: `the quarterly ${commonTerm} analysis for run ${i} covers segment ${i % 97} performance`,
      });
      // meta doc: environment + model.
      insertDoc.run({ runId: id, stepId: "__meta__", kind: "meta", content: `report ${model} baseline environment` });
    }
    // Plant the unique needle in one run.
    insertDoc.run({ runId: "run-12345", stepId: "9", kind: "tool_result", content: `found the ${needle} record` });
  });
  seedAll();
  return { needle, commonTerm };
}

test(`full-text search p95 < 1000 ms over ${RUN_COUNT} runs`, () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // schema.ts baseline carries run_search + the covering indexes (fresh DBs skip migrations)
  databases.push(db);
  const { needle, commonTerm } = seedFiftyK(db);

  const runs = new RunRepository(db);

  // Correctness sanity: the selective needle returns exactly one run; the common term matches broadly.
  const needleHits = runs.queryRuns({ q: needle });
  assert.equal(needleHits.length, 1, "the unique needle returns exactly one run");
  assert.equal(needleHits[0]?.id, "run-12345");
  assert.ok(needleHits[0]?.searchSnippet?.includes(`[${needle}]`), "the hit carries a snippet");
  assert.ok(
    runs.queryRuns({ q: commonTerm }, { limit: 50 }).length === 50,
    "a broad term fills the requested page",
  );

  // The representative feed query: a broad full-text term, newest-first, paginated (the runs feed always
  // paginates). Exercises the FTS IN-filter over 50k matches + the sort/limit + the per-page snippet.
  const call = () =>
    runs.queryRuns({ q: commonTerm, status: ["completed", "error", "stopped"] }, { limit: 50, offset: 0 });

  call(); // warm up statement prep + query planner
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

  // Also time a selective (needle) search for the record.
  const selective = measure(() => {
    runs.queryRuns({ q: needle }, { limit: 50 });
  });

  console.log(
    `[search-perf] ${RUN_COUNT} runs · q='${commonTerm}' paginated — CPU p50=${cpuP50.toFixed(1)}ms p95=${cpuP95.toFixed(1)}ms (wall p50=${wallP50.toFixed(1)}ms p95=${wallP95.toFixed(1)}ms); selective q='${needle}' CPU=${selective.cpu.toFixed(1)}ms`,
  );
  // D-OB16's 1000 ms budget, measured in CPU rather than wall clock. Same number, a clock the rest of
  // the machine cannot move — see `test/support/perf-clock.ts` for why, and for what it does not buy.
  // The FTS query is synchronous and served from an in-memory DB, so its CPU time is its work.
  assert.ok(cpuP95 < 1000, `search CPU p95 ${cpuP95.toFixed(1)}ms must be < 1000ms`);
});
