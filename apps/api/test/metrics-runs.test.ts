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

// ── Empty slices OMITTED, feedbackRate unavailable ────────────────────────────────────────────────

test("empty slices are omitted (never zero-filled); feedbackRate is unavailable (no series)", () => {
  const db = createDatabase();
  seedMixed(db);
  const res = computeRunMetrics(db, {
    filter: {},
    bucket: "day",
    measures: ["meanScore", "feedbackRate"],
  });
  // No grades seeded → meanScore has NO points anywhere (omitted, not 0-filled).
  assert.equal(res.series.filter((s) => s.measure === "meanScore").length, 0);
  // feedbackRate has no backing store → listed in unavailableMeasures, emits no series.
  assert.deepEqual(res.unavailableMeasures, ["feedbackRate"]);
  assert.equal(res.series.filter((s) => s.measure === "feedbackRate").length, 0);
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
