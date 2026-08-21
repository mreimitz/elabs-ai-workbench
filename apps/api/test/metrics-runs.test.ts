// Observability WP1.2 — GET /api/metrics/runs (time-bucketed, group-able aggregates over runs).
//
// Proves (acceptance):
//   1. Bucketing (hour/day/week, UTC-safe), every groupBy dimension, every measure, and RunFilter
//      composition — each against seeded fixtures.
//   2. Capability split (D-OB14): a MIXED fixture (API engine + subscription + an unmetered backend)
//      yields SEPARATE labelled token/cost series; NO blended sum anywhere.
//   3. meanScore equals the suite-analytics selection (collectChildData + PRIMARY_GRADER_PRIORITY).
//   4. Determinism: repeated calls are byte-identical (no caching layer).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { RunFilter, RunMetricsResponse, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { RUN_METRICS_NAMED_RATIOS } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { computeRunMetrics } from "../src/observability/metrics.js";
import { collectChildData } from "../src/suites/orchestrator.js";
import { RunRepository } from "../src/testing/run-repository.js";
import {
  ENGINE_SESSION_CAPABILITIES,
  SUBSCRIPTION_SESSION_CAPABILITIES,
} from "../src/testing/session-capabilities.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-06-01T00:00:00.000Z";
const ENGINE_CAPS = JSON.stringify(ENGINE_SESSION_CAPABILITIES);
const SUB_CAPS = JSON.stringify(SUBSCRIPTION_SESSION_CAPABILITIES);
// A backend that measures NEITHER tokens nor cost — the second token class + third cost class the
// capability-split assertions need. Hand-written (not a static manifest) precisely because the split
// must key off the run's PERSISTED capabilities_json, never its providerKind (D-OB14/D-US4).
const UNMETERED_CAPS = JSON.stringify({
  ...ENGINE_SESSION_CAPABILITIES,
  tokens: "none",
  costBasis: "none",
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

type RunSeed = {
  id: string;
  scenarioId: string;
  testId: string;
  status: string;
  outcome?: string;
  startedAt: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  turns?: number;
  activeDurationMs?: number | null;
  totalDurationMs?: number | null;
  capabilitiesJson?: string | null;
  // RM-33 — `undefined` seeds SQL NULL (the split is unknown, e.g. a run persisted before v59).
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

function baseGraph(db: AppDatabase): void {
  const provider = db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (@id, @kind, @label, @now, @now)",
  );
  provider.run({ id: "prov-ant", kind: "anthropic", label: "Claude", now: NOW });
  provider.run({ id: "prov-oai", kind: "openai", label: "OpenAI", now: NOW });
  provider.run({ id: "prov-sub", kind: "claude_subscription", label: "Claude (sub)", now: NOW });
  provider.run({ id: "prov-loc", kind: "ollama", label: "Local", now: NOW });

  const server = db.prepare(
    "INSERT INTO mcp_servers (id, name, transport, command, created_at, updated_at) VALUES (@id, @name, 'stdio', 'x', @now, @now)",
  );
  server.run({ id: "srv-1", name: "srv-1", now: NOW });
  server.run({ id: "srv-2", name: "srv-2", now: NOW });

  const scenario = db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (@id, @name, @providerId, @model, @now, @now)",
  );
  scenario.run({ id: "scn-ant", name: "A", providerId: "prov-ant", model: "claude-sonnet-4", now: NOW });
  scenario.run({ id: "scn-oai", name: "O", providerId: "prov-oai", model: "gpt-5", now: NOW });
  scenario.run({ id: "scn-sub", name: "S", providerId: "prov-sub", model: "claude-opus", now: NOW });
  scenario.run({ id: "scn-loc", name: "L", providerId: "prov-loc", model: "llama-3", now: NOW });

  const ss = db.prepare(
    "INSERT INTO scenario_servers (scenario_id, server_id) VALUES (@scenarioId, @serverId)",
  );
  ss.run({ scenarioId: "scn-ant", serverId: "srv-1" });
  ss.run({ scenarioId: "scn-ant", serverId: "srv-2" });
  ss.run({ scenarioId: "scn-oai", serverId: "srv-2" });

  const test = db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES (@id, @name, 'go', @now, @now)",
  );
  test.run({ id: "t-1", name: "T1", now: NOW });
  test.run({ id: "t-2", name: "T2", now: NOW });
}

function insertRuns(db: AppDatabase, runs: RunSeed[]): void {
  const stmt = db.prepare(
    `INSERT INTO runs (
       id, test_id, scenario_id, mode, status, outcome, started_at, tokens_in, tokens_out,
       cost_usd, turns, active_duration_ms, total_duration_ms, capabilities_json,
       cache_read_tokens, cache_write_tokens
     ) VALUES (
       @id, @testId, @scenarioId, 'automated', @status, @outcome, @startedAt, @tokensIn, @tokensOut,
       @costUsd, @turns, @activeDurationMs, @totalDurationMs, @capabilitiesJson,
       @cacheReadTokens, @cacheWriteTokens
     )`,
  );
  for (const r of runs) {
    stmt.run({
      id: r.id,
      testId: r.testId,
      scenarioId: r.scenarioId,
      status: r.status,
      outcome: r.outcome ?? null,
      startedAt: r.startedAt,
      tokensIn: r.tokensIn ?? 0,
      tokensOut: r.tokensOut ?? 0,
      costUsd: r.costUsd ?? 0,
      turns: r.turns ?? 0,
      activeDurationMs: r.activeDurationMs === undefined ? null : r.activeDurationMs,
      totalDurationMs: r.totalDurationMs === undefined ? null : r.totalDurationMs,
      capabilitiesJson: r.capabilitiesJson === undefined ? ENGINE_CAPS : r.capabilitiesJson,
      cacheReadTokens: r.cacheReadTokens ?? null,
      cacheWriteTokens: r.cacheWriteTokens ?? null,
    });
  }
}

/** The mixed fixture that distinguishes buckets, capability classes, and every measure. */
const MIXED: RunSeed[] = [
  // Day 2026-07-01
  { id: "rA1", scenarioId: "scn-ant", testId: "t-1", status: "completed", outcome: "completed", startedAt: "2026-07-01T09:00:00.000Z", tokensIn: 100, tokensOut: 200, costUsd: 0.1, activeDurationMs: 5000 },
  { id: "rO1", scenarioId: "scn-oai", testId: "t-2", status: "error", outcome: "error", startedAt: "2026-07-01T15:30:00.000Z", tokensIn: 300, tokensOut: 100, costUsd: 0.5, activeDurationMs: 10000 },
  // Day 2026-07-02
  { id: "rA2", scenarioId: "scn-ant", testId: "t-1", status: "stopped", outcome: "stopped_guardrail", startedAt: "2026-07-02T08:00:00.000Z", tokensIn: 50, tokensOut: 50, costUsd: 0.05, activeDurationMs: 2000 },
  { id: "rS1", scenarioId: "scn-sub", testId: "t-2", status: "completed", outcome: "completed", startedAt: "2026-07-02T12:00:00.000Z", tokensIn: 400, tokensOut: 600, costUsd: 1.23, activeDurationMs: 8000, capabilitiesJson: SUB_CAPS },
  { id: "rQ1", scenarioId: "scn-loc", testId: "t-1", status: "completed", outcome: "completed", startedAt: "2026-07-02T18:00:00.000Z", tokensIn: 20, tokensOut: 30, costUsd: 0, turns: 2, activeDurationMs: 3000, capabilitiesJson: UNMETERED_CAPS },
  // Day 2026-07-03 — a LEGACY run (NULL capabilities_json → static-manifest fallback for its kind, i.e.
  // the engine manifest ⇒ exact/api_exact) + a run with no active duration (total-duration fallback,
  // MARKED).
  { id: "rLegacy", scenarioId: "scn-loc", testId: "t-1", status: "completed", outcome: "completed", startedAt: "2026-07-03T10:00:00.000Z", tokensIn: 10, tokensOut: 5, costUsd: 0, turns: 1, activeDurationMs: 4000, capabilitiesJson: null },
  { id: "rNoDur", scenarioId: "scn-ant", testId: "t-1", status: "completed", outcome: "completed", startedAt: "2026-07-03T20:00:00.000Z", tokensIn: 5, tokensOut: 5, costUsd: 0, activeDurationMs: null, totalDurationMs: 7000 },
];

function seedMixed(db: AppDatabase): void {
  baseGraph(db);
  insertRuns(db, MIXED);
}

/** Find the single series for (measure, group, capabilityClass) — asserts exactly one matches. */
function series(
  res: RunMetricsResponse,
  measure: string,
  group: string | null,
  capabilityClass: string | null,
): RunMetricsSeries {
  const matches = res.series.filter(
    (s) => s.measure === measure && s.group === group && s.capabilityClass === capabilityClass,
  );
  assert.equal(matches.length, 1, `expected one ${measure}/${group}/${capabilityClass} series`);
  return matches[0] as RunMetricsSeries;
}

function pointMap(s: RunMetricsSeries): Record<string, number> {
  return Object.fromEntries(s.points.map((p) => [p.bucketStart, p.value]));
}

// ── Acceptance #1 — bucketing + count/errorRate/guardrailRate ─────────────────────────────────────

test("day buckets (UTC): count / errorRate / guardrailRate", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["count", "errorRate", "guardrailRate"],
  });
  assert.equal(res.timezone, "UTC");
  assert.deepEqual(pointMap(series(res, "count", null, null)), {
    "2026-07-01T00:00:00.000Z": 2,
    "2026-07-02T00:00:00.000Z": 3,
    "2026-07-03T00:00:00.000Z": 2,
  });
  assert.deepEqual(pointMap(series(res, "errorRate", null, null)), {
    "2026-07-01T00:00:00.000Z": 0.5, // rO1 of {rA1, rO1}
    "2026-07-02T00:00:00.000Z": 0,
    "2026-07-03T00:00:00.000Z": 0,
  });
  assert.deepEqual(pointMap(series(res, "guardrailRate", null, null)), {
    "2026-07-01T00:00:00.000Z": 0,
    "2026-07-02T00:00:00.000Z": 1 / 3, // rA2 stopped_guardrail of 3
    "2026-07-03T00:00:00.000Z": 0,
  });
});

test("hour buckets vs day buckets floor in UTC (a 15:30Z run stays on its UTC day/hour)", () => {
  const db = createDatabase();
  seedMixed(db);
  const hour = computeRunMetrics(db, { filter: {}, bucket: "hour", measures: ["count"] });
  const hourPoints = pointMap(series(hour, "count", null, null));
  // rO1 at 15:30Z → the 15:00Z hour bucket (never a local-time shift).
  assert.equal(hourPoints["2026-07-01T15:00:00.000Z"], 1);
  assert.equal(hourPoints["2026-07-01T09:00:00.000Z"], 1);
});

test("week buckets start Monday 00:00 UTC", () => {
  const db = createDatabase();
  baseGraph(db);
  // 2026-07-01 is a Wednesday; 2026-07-06 is the next Monday. Two runs across that boundary.
  insertRuns(db, [
    { id: "w1", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T00:00:00.000Z" },
    { id: "w2", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-06T00:00:00.000Z" },
    { id: "w3", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-07T00:00:00.000Z" },
  ]);
  const res = computeRunMetrics(db, { filter: {}, bucket: "week", measures: ["count"] });
  assert.deepEqual(pointMap(series(res, "count", null, null)), {
    "2026-06-29T00:00:00.000Z": 1, // Mon of w1's week (Wed 07-01)
    "2026-07-06T00:00:00.000Z": 2, // Mon 07-06 holds w2 + w3
  });
});

// ── Acceptance #1 — durations (percentile + fallback marking) ─────────────────────────────────────

test("p50 / p95 duration (nearest-rank) and totalDurationMs fallback marking", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["p50DurationMs", "p95DurationMs"],
  });
  // 07-01 durations [5000, 10000]; 07-02 [2000, 8000, 3000]; 07-03 [4000(active), 7000(total fallback)].
  assert.deepEqual(pointMap(series(res, "p50DurationMs", null, null)), {
    "2026-07-01T00:00:00.000Z": 5000,
    "2026-07-02T00:00:00.000Z": 3000,
    "2026-07-03T00:00:00.000Z": 4000,
  });
  assert.deepEqual(pointMap(series(res, "p95DurationMs", null, null)), {
    "2026-07-01T00:00:00.000Z": 10000,
    "2026-07-02T00:00:00.000Z": 8000,
    "2026-07-03T00:00:00.000Z": 7000,
  });
  // The series is MARKED because 07-03 fell back to totalDurationMs for rNoDur.
  assert.equal(series(res, "p50DurationMs", null, null).durationFallback, true);
  assert.equal(series(res, "p95DurationMs", null, null).durationFallback, true);
});

// ── Acceptance #2 — capability split (D-OB14): separate labelled series, never blended ────────────

test("tokensIn / tokensOut split into one series per tokens class (exact vs estimated)", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["tokensIn", "tokensOut"] });

  // exact = engine + subscription + legacy (static-manifest fallback); none = the unmetered backend.
  // NEVER summed together.
  assert.deepEqual(pointMap(series(res, "tokensIn", null, "exact")), {
    "2026-07-01T00:00:00.000Z": 400, // rA1(100) + rO1(300)
    "2026-07-02T00:00:00.000Z": 450, // rA2(50) + rS1(400)
    "2026-07-03T00:00:00.000Z": 15, // rLegacy(10) + rNoDur(5)
  });
  assert.deepEqual(pointMap(series(res, "tokensIn", null, "none")), {
    "2026-07-02T00:00:00.000Z": 20, // rQ1 (persisted caps say tokens:none)
  });
  assert.deepEqual(pointMap(series(res, "tokensOut", null, "exact")), {
    "2026-07-01T00:00:00.000Z": 300,
    "2026-07-02T00:00:00.000Z": 650,
    "2026-07-03T00:00:00.000Z": 10,
  });

  // HONESTY GUARD: no token/cost series ever carries a null capability class (would be a blended sum).
  for (const s of res.series) {
    if (["tokensIn", "tokensOut", "costUsd"].includes(s.measure)) {
      assert.notEqual(s.capabilityClass, null, `${s.measure} must be capability-labelled`);
    }
  }
});

test("costUsd splits into api_exact / subscription_reference / none", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["costUsd"] });

  assert.deepEqual(pointMap(series(res, "costUsd", null, "api_exact")), {
    "2026-07-01T00:00:00.000Z": 0.6, // rA1(0.1) + rO1(0.5)
    "2026-07-02T00:00:00.000Z": 0.05,
    "2026-07-03T00:00:00.000Z": 0, // rLegacy(0) + rNoDur(0)
  });
  assert.deepEqual(pointMap(series(res, "costUsd", null, "subscription_reference")), {
    "2026-07-02T00:00:00.000Z": 1.23,
  });
  assert.deepEqual(pointMap(series(res, "costUsd", null, "none")), {
    "2026-07-02T00:00:00.000Z": 0,
  });
});

// ── Acceptance #1 — every groupBy dimension ───────────────────────────────────────────────────────

test("groupBy dimensions: model / provider / providerKind / environment / test / server / stopReasonCode", () => {
  const db = createDatabase();
  seedMixed(db);
  const count = (groupBy: Parameters<typeof computeRunMetrics>[1]["groupBy"]) => {
    const res = computeRunMetrics(db, { filter: {}, bucket: "day", groupBy, measures: ["count"] });
    // total count summed across every group's points.
    const totals = new Map<string | null, number>();
    for (const s of res.series) {
      const sum = s.points.reduce((a, p) => a + p.value, 0);
      totals.set(s.group, (totals.get(s.group) ?? 0) + sum);
    }
    return totals;
  };

  const byModel = count("model");
  assert.equal(byModel.get("claude-sonnet-4"), 3); // rA1, rA2, rNoDur
  assert.equal(byModel.get("gpt-5"), 1);
  assert.equal(byModel.get("llama-3"), 2); // rQ1, rLegacy

  const byKind = count("providerKind");
  assert.equal(byKind.get("anthropic"), 3);
  assert.equal(byKind.get("openai"), 1);
  assert.equal(byKind.get("claude_subscription"), 1);
  assert.equal(byKind.get("ollama"), 2);

  const byProvider = count("provider");
  assert.equal(byProvider.get("prov-ant"), 3);

  const byEnv = count("environment");
  assert.equal(byEnv.get("scn-ant"), 3);

  const byTest = count("test");
  assert.equal(byTest.get("t-1"), 5); // rA1, rA2, rQ1, rLegacy, rNoDur
  assert.equal(byTest.get("t-2"), 2);

  // server FANS OUT — scn-ant → {srv-1, srv-2}, scn-oai → {srv-2}. runs on scn-sub/scn-loc have no
  // server → contribute to no server group.
  const byServer = count("server");
  assert.equal(byServer.get("srv-1"), 3); // scn-ant runs (rA1, rA2, rNoDur)
  assert.equal(byServer.get("srv-2"), 4); // scn-ant (3) + scn-oai (rO1)

  const byStop = count("stopReasonCode");
  // Only rows with a stop_reason_code contribute; MIXED sets none → the grouped result is empty.
  assert.equal(byStop.size, 0);
});

test("groupBy=skill fans out; runs without a skill are omitted from the skill grouping", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    { id: "k1", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T00:00:00.000Z" },
    { id: "k2", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T00:00:00.000Z" },
  ]);
  db.prepare(
    "INSERT INTO run_skills (run_id, skill_id, skill_version_id) VALUES (@runId, @skillId, @svId)",
  ).run({ runId: "k1", skillId: "sk-1", svId: "sv-1" });
  const res = computeRunMetrics(db, { filter: {}, bucket: "day", groupBy: "skill", measures: ["count"] });
  const groups = res.series.map((s) => s.group).sort();
  assert.deepEqual(groups, ["sk-1"]); // k2 (no skill) contributes to no skill group
  assert.equal(series(res, "count", "sk-1", null).points[0]?.value, 1);
});

// ── Acceptance #1 — RunFilter composition ─────────────────────────────────────────────────────────

test("RunFilter composes with the metrics window (status + providerKind + date)", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: { providerKind: ["anthropic"], status: ["completed"] },
    bucket: "day",
    measures: ["count"],
  });
  // anthropic + completed = rA1 (07-01), rNoDur (07-03). rA2 is anthropic but stopped, not completed.
  assert.deepEqual(pointMap(series(res, "count", null, null)), {
    "2026-07-01T00:00:00.000Z": 1,
    "2026-07-03T00:00:00.000Z": 1,
  });

  const windowed = computeRunMetrics(db, {
    filter: {},
    from: "2026-07-02T00:00:00.000Z",
    to: "2026-07-02T23:59:59.999Z",
    bucket: "day",
    measures: ["count"],
  });
  assert.deepEqual(pointMap(series(windowed, "count", null, null)), {
    "2026-07-02T00:00:00.000Z": 3,
  });
  assert.equal(windowed.from, "2026-07-02T00:00:00.000Z");
  assert.equal(windowed.to, "2026-07-02T23:59:59.999Z");
});

// ── Empty slices OMITTED ──────────────────────────────────────────────────────────────────────────

test("empty slices are omitted (never zero-filled); feedbackRate is a real series now", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["meanScore", "feedbackRate"],
  });
  // No grades seeded → meanScore has NO points anywhere (omitted, not 0-filled).
  assert.equal(res.series.filter((s) => s.measure === "meanScore").length, 0);
  // AM-OB4 — `feedbackRate` is no longer permanently unavailable: it is a NAMED RATIO computed by the
  // same machinery as `ratio`. Nothing here has feedback, so every bucket's numerator is 0 while the
  // denominator is not — and a 0-of-N share IS a real measurement, so the points EXIST and read 0.
  // (Contrast the zero-DENOMINATOR case, which is omitted — pinned by its own test below.)
  assert.deepEqual(res.unavailableMeasures, []);
  const feedbackSeries = res.series.filter((s) => s.measure === "feedbackRate");
  assert.equal(feedbackSeries.length, 1);
  for (const point of (feedbackSeries[0] as RunMetricsSeries).points) {
    assert.equal(point.value, 0);
    assert.ok(point.n > 0, "n is the DENOMINATOR count, so a real 0% share still reports its base");
  }
});

// ── Acceptance #3 — meanScore equals the suite-analytics selection ────────────────────────────────

test("meanScore equals the suite-analytics (PRIMARY_GRADER_PRIORITY, latest-per-grader) selection", () => {
  const db = createDatabase();
  baseGraph(db);
  // All on one UTC day → one bucket. Graders chosen so priority selection MATTERS:
  //   g-a: outcome_judge 0.8 (primary present)
  //   g-b: outcome_judge 0.9 THEN 0.4 (latest wins) + tool_hygiene 0.99 (lower-priority, ignored)
  //   g-c: trajectory_judge 0.6 (no outcome_judge → falls to trajectory)
  //   g-d: tool_hygiene 0.5 only (lowest present)
  //   g-e: UNGRADED (excluded from the mean entirely)
  insertRuns(db, [
    { id: "g-a", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T01:00:00.000Z" },
    { id: "g-b", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T02:00:00.000Z" },
    { id: "g-c", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T03:00:00.000Z" },
    { id: "g-d", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T04:00:00.000Z" },
    { id: "g-e", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-07-01T05:00:00.000Z" },
  ]);
  const grade = db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, grading_version, created_at)
     VALUES (@id, @runId, @graderId, 'llm', 'graded', @score, 'm', 1, @createdAt)`,
  );
  grade.run({ id: "1", runId: "g-a", graderId: "outcome_judge", score: 0.8, createdAt: "2026-07-01T06:00:00.000Z" });
  grade.run({ id: "2", runId: "g-b", graderId: "outcome_judge", score: 0.9, createdAt: "2026-07-01T06:00:00.000Z" });
  grade.run({ id: "3", runId: "g-b", graderId: "outcome_judge", score: 0.4, createdAt: "2026-07-01T07:00:00.000Z" });
  grade.run({ id: "4", runId: "g-b", graderId: "tool_hygiene", score: 0.99, createdAt: "2026-07-01T07:00:00.000Z" });
  grade.run({ id: "5", runId: "g-c", graderId: "trajectory_judge", score: 0.6, createdAt: "2026-07-01T06:00:00.000Z" });
  grade.run({ id: "6", runId: "g-d", graderId: "tool_hygiene", score: 0.5, createdAt: "2026-07-01T06:00:00.000Z" });

  const res = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["meanScore"] });
  const meanScorePoint = series(res, "meanScore", null, null).points[0];

  // Independently compute via the CANONICAL suite-analytics path (collectChildData → outcomeScore).
  const runRepo = new RunRepository(db);
  const gradeRepo = new GradeRepository(db);
  const children = collectChildData(runRepo, gradeRepo, ["g-a", "g-b", "g-c", "g-d", "g-e"]);
  const scores = children.map((c) => c.outcomeScore).filter((s): s is number => s !== null);
  const expectedMean = scores.reduce((a, s) => a + s, 0) / scores.length;

  // Selected scores: 0.8, 0.4 (latest outcome_judge), 0.6 (trajectory), 0.5 (tool_hygiene). g-e excluded.
  assert.deepEqual(scores.sort(), [0.4, 0.5, 0.6, 0.8]);
  assert.equal(meanScorePoint?.value, expectedMean);
  assert.equal(meanScorePoint?.n, 4);
});

// ── Acceptance #4 — determinism (repeated calls identical, no caching) ────────────────────────────

test("repeated identical calls return byte-identical results (no cache, recomputed each time)", () => {
  const db = createDatabase();
  seedMixed(db);
  const params = {
    filter: { providerKind: ["anthropic", "ollama"] as const },
    bucket: "day" as const,
    groupBy: "providerKind" as const,
    measures: ["count", "tokensIn", "costUsd", "p95DurationMs"] as const,
  };
  const a = computeRunMetrics(db, { ...params, filter: { ...params.filter, providerKind: [...params.filter.providerKind] }, measures: [...params.measures] });
  const b = computeRunMetrics(db, { ...params, filter: { ...params.filter, providerKind: [...params.filter.providerKind] }, measures: [...params.measures] });
  assert.deepEqual(a, b);
  // And the JSON serialization is stable (series/points deterministically ordered).
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ── RM-33 WP 2.2 (D-CT6) — the cache measures, and what they do with an UNKNOWN split ────────────
//
// Before this, cached tokens could not be charted at all, so "is our cache hit rate degrading" was
// unanswerable. The hard part is not the sums; it is that a run whose split is unknown must be
// EXCLUDED, because a zero-filled bucket reads as "caching stopped working" and a silently dropped
// one reads as "no runs happened".

test("RM-33 — cache measures split by capability class and sum only KNOWN runs", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    {
      id: "r-known-1",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T01:00:00.000Z",
      tokensIn: 1000,
      tokensOut: 100,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    },
    {
      id: "r-known-2",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T01:30:00.000Z",
      tokensIn: 1000,
      tokensOut: 100,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
    },
    // Same bucket, but its split predates v59. It contributes to tokensIn and to NOTHING cache-shaped.
    {
      id: "r-unknown",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T01:45:00.000Z",
      tokensIn: 5000,
      tokensOut: 500,
    },
  ]);

  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["tokensIn", "cacheReadTokens", "cacheWriteTokens", "cacheHitRate"],
  });

  const read = res.series.find((s) => s.measure === "cacheReadTokens") as RunMetricsSeries;
  const write = res.series.find((s) => s.measure === "cacheWriteTokens") as RunMetricsSeries;
  assert.equal(read.points[0]?.value, 1400, "800 + 600 — the unknown run adds nothing");
  assert.equal(write.points[0]?.value, 100);
  assert.equal(read.points[0]?.n, 2, "n counts the runs that could actually answer, not all 3");
  assert.equal(read.capabilityClass, "exact", "token measures stay capability-split (D-OB14)");

  // D-CT1 — `tokensIn` is untouched and still counts all three runs.
  const tokensIn = res.series.find((s) => s.measure === "tokensIn") as RunMetricsSeries;
  assert.equal(tokensIn.points[0]?.value, 7000, "tokensIn still sums every run, unknown split or not");
  assert.equal(tokensIn.points[0]?.n, 3);

  // The hit rate divides like-for-like: 1400 reads over the 2000 gross input of the SAME two runs.
  // If it used the 7000 gross of all three, it would read 20% instead of 70% — an invented collapse.
  const hit = res.series.find((s) => s.measure === "cacheHitRate") as RunMetricsSeries;
  assert.equal(hit.capabilityClass, null, "a ratio is a single unlabelled series (errorRate precedent)");
  assert.equal(hit.points[0]?.value, 0.7);
});

test("RM-33 — a window of runs with NO known split reports the measures unavailable, not 0", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    {
      id: "r-legacy-1",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T01:00:00.000Z",
      tokensIn: 1000,
      tokensOut: 100,
    },
    {
      id: "r-legacy-2",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T02:00:00.000Z",
      tokensIn: 2000,
      tokensOut: 200,
    },
  ]);

  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["tokensIn", "cacheReadTokens", "cacheHitRate"],
  });

  assert.deepEqual(
    [...res.unavailableMeasures].sort(),
    ["cacheHitRate", "cacheReadTokens"],
    "the honest third answer — neither an empty chart nor a 0% line",
  );
  assert.equal(
    res.series.filter((s) => s.measure.startsWith("cache")).length,
    0,
    "and no cache series is emitted at all",
  );
  assert.ok(
    res.series.some((s) => s.measure === "tokensIn"),
    "…while the measures that CAN answer still do",
  );
});

test("RM-33 — a bucket whose only cache-known runs have zero input omits the hit rate", () => {
  // Guard on the division: `readSum / grossIn` with grossIn 0 is NaN, which would serialize as null
  // and render as a broken point rather than an absent one.
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    {
      id: "r-empty",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T01:00:00.000Z",
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ]);
  const res = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["cacheHitRate"] });
  assert.equal(res.series.length, 0, "no point, rather than a NaN one");
});

test("RM-33 — repeated calls with the cache measures stay byte-identical", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    {
      id: "r-det",
      scenarioId: "scn-ant",
      testId: "t-1",
      status: "completed",
      startedAt: "2026-06-01T01:00:00.000Z",
      tokensIn: 1000,
      tokensOut: 100,
      cacheReadTokens: 900,
      cacheWriteTokens: 50,
    },
  ]);
  const params = {
    filter: {},
    bucket: "day" as const,
    measures: ["cacheReadTokens", "cacheWriteTokens", "cacheHitRate"] as RunMetricsResponse["measures"],
  };
  assert.deepEqual(computeRunMetrics(db, params), computeRunMetrics(db, params));
});

// ── AM-OB12 — the auto-rating filter dimensions, through THIS translation ─────────────────────────
//
// A pointer test, deliberately small. The exhaustive three-way cross-check (this replica vs the
// repository SQL vs the pure predicate, over malformed / re-rated / unrated / wrong-shaped evidence)
// lives in `runs-filter.test.ts`; what belongs HERE is the fact that the metrics translation honours
// the dimensions at all, so someone editing `buildRunFilterWhere` in metrics.ts sees a red test
// rather than a chart that quietly stops narrowing.
test("AM-OB12 — a rating verdict narrows the metrics query, and an unrated run never joins it", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    { id: "mr-a", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-06-01T01:00:00.000Z" },
    { id: "mr-b", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-06-01T02:00:00.000Z" },
    { id: "mr-c", scenarioId: "scn-ant", testId: "t-1", status: "completed", startedAt: "2026-06-01T03:00:00.000Z" },
  ]);
  const rate = db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, evidence_json, grading_version, created_at)
     VALUES (@id, @runId, @graderId, 'llm', 'graded', 0.5, 'test', @evidence, 1, @createdAt)`,
  );
  rate.run({ id: "mg-a", runId: "mr-a", graderId: "answer_validation", evidence: '{"verdict":"unanswered"}', createdAt: "2026-06-01T01:30:00.000Z" });
  rate.run({ id: "mg-b", runId: "mr-b", graderId: "answer_validation", evidence: '{"verdict":"answered"}', createdAt: "2026-06-01T02:30:00.000Z" });
  // mr-c is never rated.

  const countOf = (filter: RunFilter): number =>
    computeRunMetrics(db, { filter, bucket: "day", measures: ["count"] })
      .series.flatMap((s) => s.points)
      .reduce((sum, p) => sum + p.value, 0);

  assert.equal(countOf({}), 3);
  assert.equal(countOf({ answerVerdict: ["unanswered"] }), 1);
  assert.equal(countOf({ answerVerdict: ["answered"] }), 1);
  // The whole vocabulary still leaves the unrated run out — absence is not a verdict.
  assert.equal(countOf({ answerVerdict: ["answered", "partial", "unanswered"] }), 2);
  // A verdict nobody holds yields NO bucket at all, rather than a bucket reading zero.
  assert.equal(
    computeRunMetrics(db, { filter: { answerVerdict: ["partial"] }, bucket: "day", measures: ["count"] }).series.length,
    0,
  );
});

// ══ AM-OB4 — the ratio measure ════════════════════════════════════════════════════════════════════
//
// A ratio is `matching(numerator) ÷ matching(denominator)` per bucket, each side named by its own
// RunFilter. The fixture below is deliberately hand-countable: every expectation in this block is a
// fraction written out as `x / y` with the runs named, so an agreeing PAIR of bugs (a wrong
// numerator AND a wrong denominator that happen to cancel) still fails.

/** The MIXED fixture's runs per UTC day, and which of them are errors — the hand count every
 *  expectation below is written against, so a fixture change breaks loudly rather than silently
 *  moving an expected share.
 *
 *   2026-07-01  rA1 (completed) · rO1 (ERROR)                       → 2 runs, 1 error
 *   2026-07-02  rA2 (guardrail) · rS1 (completed) · rQ1 (completed) → 3 runs, 0 errors
 *   2026-07-03  rLegacy (completed) · rNoDur (completed)            → 2 runs, 0 errors
 */
const DAY_1 = "2026-07-01T00:00:00.000Z";
const DAY_2 = "2026-07-02T00:00:00.000Z";
const DAY_3 = "2026-07-03T00:00:00.000Z";

test("ratio: value is (numerator ∩ denominator) ÷ denominator, hand-counted per bucket", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio"],
    // "What share of runs errored?" — the error rate, expressed as a filter instead of a branch.
    ratio: { numerator: { hasError: true } },
  });

  const s = series(res, "ratio", null, null);
  assert.deepEqual(pointMap(s), {
    [DAY_1]: 1 / 2, // rO1 of { rA1, rO1 }
    [DAY_2]: 0 / 3, // none of { rA2, rS1, rQ1 } — a real 0% share, NOT an omitted bucket
    [DAY_3]: 0 / 2, // none of { rLegacy, rNoDur }
  });
  // `n` is the DENOMINATOR count, so a tooltip can say what the share was taken over.
  assert.deepEqual(
    Object.fromEntries(s.points.map((p) => [p.bucketStart, p.n])),
    { [DAY_1]: 2, [DAY_2]: 3, [DAY_3]: 2 },
  );

  // The whole point of the measure: it reproduces the hardcoded `errorRate` exactly, which is the
  // evidence that the four bespoke shares did not need to be bespoke.
  const builtin = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["errorRate"] });
  assert.deepEqual(pointMap(series(builtin, "errorRate", null, null)), pointMap(s));
});

test("ratio: an explicit denominator NARROWS the base — 'of the failures, what share were X'", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio", "count"],
    // Denominator: the runs that did not simply complete. Numerator: of those, the guardrail stops.
    ratio: {
      denominator: { outcome: ["error", "stopped_guardrail"] },
      numerator: { outcome: ["stopped_guardrail"] },
    },
  });

  const s = series(res, "ratio", null, null);
  // Day 1: denominator { rO1 }, numerator {} → 0/1. Day 2: denominator { rA2 }, numerator { rA2 } →
  // 1/1. Day 3: denominator EMPTY → the bucket is OMITTED (see the zero-denominator test below).
  assert.deepEqual(pointMap(s), { [DAY_1]: 0, [DAY_2]: 1 });
  assert.deepEqual(
    Object.fromEntries(s.points.map((p) => [p.bucketStart, p.n])),
    { [DAY_1]: 1, [DAY_2]: 1 },
    "n follows the NARROWED denominator, not the query's own run count",
  );
  // …while `count` in the same response still reports the whole filtered population. The denominator
  // narrows the ratio only; it is not a second query filter.
  assert.deepEqual(pointMap(series(res, "count", null, null)), {
    [DAY_1]: 2,
    [DAY_2]: 3,
    [DAY_3]: 2,
  });
});

test("ratio: a ZERO DENOMINATOR omits the bucket — never 0, in any shape", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio"],
    // Nothing in the fixture is a fork, so EVERY bucket's denominator is 0.
    ratio: { denominator: { derived: true }, numerator: {} },
  });

  // The measure produces no series at all rather than three 0-valued points. This is the invariant
  // the whole measure rests on: "0% of runs errored" and "nothing ran" are different facts, and one
  // of them is a crisis — plotted as `0` they are the same pixel.
  assert.deepEqual(res.series.filter((s) => s.measure === "ratio"), []);

  // And the same for ONE empty bucket among non-empty ones (day 3 has no non-completed run).
  const partial = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio"],
    ratio: {
      denominator: { outcome: ["error", "stopped_guardrail"] },
      numerator: { outcome: ["stopped_guardrail"] },
    },
  });
  const points = series(partial, "ratio", null, null).points;
  assert.deepEqual(points.map((p) => p.bucketStart), [DAY_1, DAY_2]);
  for (const p of points) {
    assert.ok(p.n > 0, "a point only exists when its denominator did");
  }
  // Belt and braces against the specific regression: no point anywhere may carry n === 0, whatever
  // its value.
  assert.equal(
    partial.series.flatMap((s) => s.points).filter((p) => p.n === 0).length,
    0,
    "a zero-denominator bucket must be ABSENT, not present with n = 0",
  );
});

test("ratio: the numerator is INTERSECTED with the denominator — a share can never exceed 1", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio"],
    // A numerator that deliberately "escapes": completed runs, against a denominator of failures.
    ratio: {
      denominator: { outcome: ["error", "stopped_guardrail"] },
      numerator: { outcome: ["completed"] },
    },
  });
  for (const p of series(res, "ratio", null, null).points) {
    assert.ok(p.value >= 0 && p.value <= 1, `share out of range: ${p.value}`);
    assert.equal(p.value, 0, "a completed run is not in the failures denominator, so it cannot count");
  }
});

test("ratio: a numerator may name a dimension the scanned run row does not carry", () => {
  const db = createDatabase();
  seedMixed(db);
  // The skill-attach share — `run_skills` is a JOIN, not a column on `runs`, so this is the case that
  // rules out evaluating the numerator against the materialized row in JS.
  db.prepare(
    "INSERT INTO run_skills (run_id, skill_id, skill_version_id) VALUES (?, ?, ?)",
  ).run("rA1", "sk-1", "skv-1");

  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio"],
    ratio: { numerator: { skillId: ["sk-1"] } },
  });
  assert.deepEqual(pointMap(series(res, "ratio", null, null)), {
    [DAY_1]: 1 / 2, // rA1 of { rA1, rO1 }
    [DAY_2]: 0,
    [DAY_3]: 0,
  });
});

test("ratio: `derived` is INHERITED by a side that does not mention forks", () => {
  const db = createDatabase();
  seedMixed(db);
  // One fork of rA1, on day 1, that errored.
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, tokens_in,
                       tokens_out, cost_usd, turns, derived_from_run_id)
     VALUES ('rFork', 't-1', 'scn-ant', 'automated', 'error', 'error', '2026-07-01T11:00:00.000Z',
             0, 0, 0, 0, 'rA1')`,
  ).run();

  const res = computeRunMetrics(db, {
    filter: { derived: true }, // charting ONLY forks
    bucket: "day",
    measures: ["ratio", "count"],
    ratio: { numerator: { hasError: true } }, // says nothing about forks
  });

  // WITHOUT the inheritance rule the numerator would emit `derived_from_run_id IS NULL`, intersect
  // the query's `IS NOT NULL` to nothing, and report a confident 0% — the exact failure mode this
  // workstream keeps finding: a plausible number that means "the query was impossible".
  assert.deepEqual(pointMap(series(res, "count", null, null)), { [DAY_1]: 1 });
  assert.deepEqual(pointMap(series(res, "ratio", null, null)), { [DAY_1]: 1 });
});

test("ratio: composes with groupBy — one share per group, each with its own denominator", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    groupBy: "environment",
    measures: ["ratio"],
    ratio: { numerator: { hasError: true } },
  });
  // scn-oai has exactly one run (rO1, day 1) and it errored; scn-ant's day-1 run did not.
  assert.deepEqual(pointMap(series(res, "ratio", "scn-oai", null)), { [DAY_1]: 1 });
  assert.deepEqual(pointMap(series(res, "ratio", "scn-ant", null)), {
    [DAY_1]: 0,
    [DAY_2]: 0,
    [DAY_3]: 0,
  });
});

test("ratio: requested with NO config is unavailable — never a fabricated default", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["ratio", "count"] });
  assert.deepEqual(res.unavailableMeasures, ["ratio"]);
  assert.deepEqual(res.series.filter((s) => s.measure === "ratio"), []);
  // The rest of the response is unaffected — one unanswerable measure does not poison the others.
  assert.equal(series(res, "count", null, null).points.length, 3);
});

test("ratio: two ratio-bearing measures in one query keep their own bound params", () => {
  const db = createDatabase();
  seedMixed(db);
  seedFeedback(db, [{ runId: "rA1", key: "verdict", score: 1 }]);
  // `feedbackRate` (a NAMED ratio) and `ratio` (the caller's) are computed in the same statement, so
  // their `@pN` placeholders would collide if they were not prefixed per measure. A collision here
  // does not throw — it silently answers with the OTHER measure's values, which is why this asserts
  // two different, hand-counted results rather than merely that the query ran.
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio", "feedbackRate"],
    ratio: { numerator: { outcome: ["completed"] } },
  });
  assert.deepEqual(pointMap(series(res, "ratio", null, null)), {
    [DAY_1]: 1 / 2, // rA1 completed, rO1 errored
    [DAY_2]: 2 / 3, // rS1 + rQ1 completed, rA2 guardrail-stopped
    [DAY_3]: 2 / 2,
  });
  assert.deepEqual(pointMap(series(res, "feedbackRate", null, null)), {
    [DAY_1]: 1 / 2, // only rA1 carries feedback
    [DAY_2]: 0,
    [DAY_3]: 0,
  });
});

// ── feedbackRate — the first NAMED ratio (acceptance #4) ─────────────────────────────────────────

/** Seed `run_feedback` rows. `score: null` is a NOTE-ONLY row, which still counts as feedback. */
function seedFeedback(
  db: AppDatabase,
  rows: { runId: string; key: string; score: number | null; comment?: string }[],
): void {
  const stmt = db.prepare(
    `INSERT INTO run_feedback (id, run_id, step_id, key, score, comment, source, created_at)
     VALUES (@id, @runId, NULL, @key, @score, @comment, 'human', @now)`,
  );
  rows.forEach((r, i) => {
    stmt.run({
      id: `fb-${i}`,
      runId: r.runId,
      key: r.key,
      score: r.score,
      comment: r.comment ?? null,
      now: NOW,
    });
  });
}

test("feedbackRate returns real values over seeded run_feedback, and is no longer unavailable", () => {
  const db = createDatabase();
  seedMixed(db);
  seedFeedback(db, [
    { runId: "rA1", key: "verdict", score: 1 },
    // A NOTE-ONLY row on a second run — `feedbackRate` counts human attention, not scored attention,
    // so this run is in the numerator even though it has no score.
    { runId: "rS1", key: "notes", score: null, comment: "looked fine" },
    // A SECOND row on a run already counted — a run contributes ONCE, not once per feedback row.
    { runId: "rS1", key: "verdict", score: -1 },
  ]);

  const res = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["feedbackRate"] });
  assert.deepEqual(res.unavailableMeasures, []);
  assert.deepEqual(pointMap(series(res, "feedbackRate", null, null)), {
    [DAY_1]: 1 / 2, // rA1 of { rA1, rO1 }
    [DAY_2]: 1 / 3, // rS1 of { rA2, rS1, rQ1 } — counted once despite two rows
    [DAY_3]: 0 / 2,
  });
});

test("feedbackRate is EXACTLY the named ratio — not a second implementation that agrees today", () => {
  const db = createDatabase();
  seedMixed(db);
  seedFeedback(db, [{ runId: "rA1", key: "verdict", score: 1 }]);

  const named = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["feedbackRate"] });
  const explicit = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["ratio"],
    // The literal config `RUN_METRICS_NAMED_RATIOS.feedbackRate` holds.
    ratio: RUN_METRICS_NAMED_RATIOS.feedbackRate,
  });
  assert.deepEqual(
    pointMap(series(named, "feedbackRate", null, null)),
    pointMap(series(explicit, "ratio", null, null)),
  );
});

// ── AR6 / D-OB15 (acceptance #5) ─────────────────────────────────────────────────────────────────

test("AR6/D-OB15: a feedback ratio is its OWN lens — meanScore, run_grades and the suite aggregate are untouched", () => {
  const db = createDatabase();
  baseGraph(db);
  insertRuns(db, [
    { id: "g1", scenarioId: "scn-ant", testId: "t-1", status: "completed", outcome: "completed", startedAt: "2026-07-01T09:00:00.000Z" },
    { id: "g2", scenarioId: "scn-ant", testId: "t-1", status: "completed", outcome: "completed", startedAt: "2026-07-01T10:00:00.000Z" },
  ]);
  const grade = db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, grading_version, created_at)
     VALUES (@id, @runId, 'outcome_judge', 'llm', 'graded', @score, 'm', 1, @createdAt)`,
  );
  grade.run({ id: "ar6-1", runId: "g1", score: 0.9, createdAt: "2026-07-01T11:00:00.000Z" });
  grade.run({ id: "ar6-2", runId: "g2", score: 0.1, createdAt: "2026-07-01T11:00:00.000Z" });

  const gradeRowsBefore = db.prepare("SELECT * FROM run_grades ORDER BY id").all();
  const meanBefore = computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["meanScore"] });
  const runRepo = new RunRepository(db);
  const gradeRepo = new GradeRepository(db);
  const suiteBefore = collectChildData(runRepo, gradeRepo, ["g1", "g2"]);

  // Now add human feedback — on the LOW-scoring run, so a leak into the grade path would move the
  // mean rather than merely exist.
  seedFeedback(db, [{ runId: "g2", key: "verdict", score: 1 }]);

  const withFeedback = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["meanScore", "feedbackRate", "ratio"],
    ratio: { numerator: { feedback: { any: true } } },
  });

  // 1. The feedback lens reports what it should: 1 of 2 runs carries feedback.
  assert.deepEqual(pointMap(series(withFeedback, "feedbackRate", null, null)), { [DAY_1]: 1 / 2 });
  assert.deepEqual(pointMap(series(withFeedback, "ratio", null, null)), { [DAY_1]: 1 / 2 });

  // 2. `meanScore` is byte-identical to before the feedback existed — (0.9 + 0.1) / 2.
  assert.deepEqual(
    pointMap(series(withFeedback, "meanScore", null, null)),
    pointMap(series(meanBefore, "meanScore", null, null)),
  );
  assert.deepEqual(pointMap(series(withFeedback, "meanScore", null, null)), { [DAY_1]: 0.5 });

  // 3. Not one `run_grades` row moved. Human feedback is not a grade and never becomes one.
  assert.deepEqual(db.prepare("SELECT * FROM run_grades ORDER BY id").all(), gradeRowsBefore);

  // 4. The suite aggregate the orchestrator computes over the same runs is unchanged.
  assert.deepEqual(collectChildData(runRepo, gradeRepo, ["g1", "g2"]), suiteBefore);
});

// ── Acceptance #3 — the numerator is computed in the SAME row scan ────────────────────────────────

test("a ratio adds NO second query: computeRunMetrics still prepares exactly the statements it did", () => {
  const db = createDatabase();
  seedMixed(db);
  seedFeedback(db, [{ runId: "rA1", key: "verdict", score: 1 }]);

  // Count `prepare` calls rather than reading the source: a source-walk cannot tell a real second
  // pass from a string that merely contains "SELECT", and every one of these clauses contains
  // several (the correlated subqueries the filter grammar is built from).
  const prepared: string[] = [];
  const realPrepare = db.prepare.bind(db);
  (db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
    prepared.push(sql);
    return realPrepare(sql);
  }) as typeof db.prepare;

  const baseline = ["count"] as const;
  computeRunMetrics(db, { filter: {}, bucket: "day", measures: [...baseline] });
  const withoutRatio = prepared.length;

  prepared.length = 0;
  computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: [...baseline, "ratio", "feedbackRate"],
    ratio: { numerator: { hasError: true }, denominator: { outcome: ["completed", "error"] } },
  });
  const withRatio = prepared.length;

  assert.equal(
    withRatio,
    withoutRatio,
    `two ratios added ${withRatio - withoutRatio} statement(s); they must ride the existing row scan`,
  );
  // …and the membership columns really are on THAT statement, not smuggled onto another one.
  const runsScan = prepared.find((sql) => sql.includes("FROM runs"));
  assert.ok(runsScan, "the runs scan is still one statement");
  assert.ok(runsScan.includes("__ratio_num_ratio"), "the caller ratio projects onto the runs scan");
  assert.ok(
    runsScan.includes("__ratio_num_feedbackRate"),
    "the named ratio projects onto the same scan",
  );
});
