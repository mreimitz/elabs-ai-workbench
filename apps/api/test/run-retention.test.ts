// Observability (roadmap/observability/, WP1.6) — retention classes: pinned runs + class-aware pruning.
//
// Proves (acceptance):
//   1. Pin round-trips at the repository level AND via the route (`POST`/`DELETE /api/runs/:id/pin`),
//      404s on an unknown run, and the `pinned` RunSummary field is honest.
//   2. `pruneRuns` honors `olderThanDays` / `keepNewest` (union semantics), ignores a non-terminal
//      status entry, and a PINNED run survives EVERY prune configuration — even a maximally
//      aggressive one that would otherwise sweep it.
//   3. Pruning deletes through the SAME full run-delete cascade `DELETE /api/runs/:id` uses: steps/
//      events are counted + gone, and — with the WP1.3 full-text index present — the run's FTS
//      documents + docmap rows are purged too (never a bespoke bulk `DELETE FROM runs`).
//   4. Defaults are OFF: an empty/absent policy prunes nothing.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import type { RunEvent, RunStep } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { registerTestingRoutes } from "../src/testing/routes.js";
import type { RunService } from "../src/testing/run-service.js";
import type { ScenarioService } from "../src/testing/scenario-service.js";
import type { TestService } from "../src/testing/test-service.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-16T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** Seed the FK parents (provider → scenario, test) a `runs` row needs. */
function seedParents(db: AppDatabase, testId: string, scenarioId: string): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, 'S', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, 'T', 'go', @now, @now)`,
  ).run({ id: testId, now: NOW });
}

function step(runId: string, index: number, partial: Partial<RunStep> & { type: RunStep["type"] }): RunStep {
  return {
    id: `${runId}:s${index}`,
    runId,
    index,
    label: partial.label ?? partial.type,
    status: partial.status ?? "ok",
    profileTokens: {},
    payload: partial.payload ?? null,
    ...partial,
  };
}

function emit(runs: RunRepository, runId: string, event: RunEvent): void {
  runs.onEvent(runId, event);
}

/** Create + fully terminate a run through the LIVE write hooks (indexes FTS + writes steps/events),
 *  exactly as production does — never a raw INSERT — so the prune-deletes-via-the-full-path assertion
 *  is proven against real indexed content. */
function buildIndexedRun(
  db: AppDatabase,
  runs: RunRepository,
  runId: string,
  opts: { testId: string; scenarioId: string; status: "completed" | "error"; startedAt: string; pinned?: boolean },
): void {
  runs.createRun(runId, { testId: opts.testId, scenarioId: opts.scenarioId, mode: "automated" });
  emit(runs, runId, {
    type: "step",
    step: step(runId, 0, {
      type: "llm_response",
      label: "assistant",
      assistantText: `the analysis for ${runId} is complete`,
    }),
  });
  emit(runs, runId, {
    type: "kpi",
    turns: 1,
    toolCalls: 0,
    tokensIn: 10,
    tokensOut: 5,
    contextTokens: 15,
    costUsd: 0,
  });
  emit(runs, runId, {
    type: "status",
    status: opts.status,
    outcome: opts.status === "error" ? "error" : "completed",
  });
  if (opts.pinned) runs.setPinned(runId, true);
  // Backdate startedAt directly — the engine always stamps "now"; the prune age bound needs control.
  db.prepare("UPDATE runs SET started_at = @startedAt WHERE id = @runId").run({
    runId,
    startedAt: opts.startedAt,
  });
}

function docsForRun(db: AppDatabase, runId: string): unknown[] {
  return db.prepare("SELECT 1 FROM run_search WHERE run_id = ?").all(runId);
}

function docMapForRun(db: AppDatabase, runId: string): unknown[] {
  return db.prepare("SELECT 1 FROM run_search_map WHERE run_id = ?").all(runId);
}

// ── (1) Pin round-trip — repository + route ─────────────────────────────────────────────────────

test("setPinned round-trips at the repository level; 404s on an unknown run; toRunSummary reflects it", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  runs.createRun("run-1", { testId: "t-1", scenarioId: "scn-1", mode: "automated" });

  assert.equal(runs.getSummary("run-1").pinned, false, "a fresh run is unpinned by default");

  const pinned = runs.setPinned("run-1", true);
  assert.deepEqual(pinned, { runId: "run-1", pinned: true });
  assert.equal(runs.getSummary("run-1").pinned, true);

  const unpinned = runs.setPinned("run-1", false);
  assert.deepEqual(unpinned, { runId: "run-1", pinned: false });
  assert.equal(runs.getSummary("run-1").pinned, false);

  assert.throws(
    () => runs.setPinned("nope", true),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
});

function buildRouteApp(runs: RunRepository) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: typed.message });
  });
  const runManager = new RunManager(runs);
  return registerTestingRoutes(
    app,
    {} as unknown as ScenarioService,
    {} as unknown as TestService,
    {} as unknown as RunService,
    runs,
    runManager,
  ).then(() => app);
}

test("POST/DELETE /api/runs/:id/pin round-trip over HTTP; 404 on an unknown run", async () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  runs.createRun("run-1", { testId: "t-1", scenarioId: "scn-1", mode: "automated" });
  const app = await buildRouteApp(runs);

  const pinRes = await app.inject({ method: "POST", url: "/api/runs/run-1/pin" });
  assert.equal(pinRes.statusCode, 200);
  assert.deepEqual(JSON.parse(pinRes.body), { runId: "run-1", pinned: true });
  assert.equal(runs.getSummary("run-1").pinned, true);

  const unpinRes = await app.inject({ method: "DELETE", url: "/api/runs/run-1/pin" });
  assert.equal(unpinRes.statusCode, 200);
  assert.deepEqual(JSON.parse(unpinRes.body), { runId: "run-1", pinned: false });
  assert.equal(runs.getSummary("run-1").pinned, false);

  const notFound = await app.inject({ method: "POST", url: "/api/runs/nope/pin" });
  assert.equal(notFound.statusCode, 404);
});

// ── (2) pruneRuns — olderThanDays / keepNewest, non-terminal ignored, pinned NEVER a victim ────────

test("pruneRuns: defaults are OFF — an empty/absent policy prunes nothing", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  buildIndexedRun(db, runs, "r1", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: "2020-01-01T00:00:00.000Z" });

  const result = runs.pruneRuns({ byStatus: {} });
  assert.deepEqual(result, { policy: { byStatus: {} }, prunedRunIds: [], deletedSteps: 0, deletedEvents: 0 });
  assert.doesNotThrow(() => runs.getSummary("r1"));
});

test("pruneRuns: olderThanDays deletes only runs of that status past the age bound", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  const oldIso = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const recentIso = new Date(Date.now() - 2 * 86_400_000).toISOString();
  buildIndexedRun(db, runs, "old-completed", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: oldIso });
  buildIndexedRun(db, runs, "recent-completed", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: recentIso });
  buildIndexedRun(db, runs, "old-error", { testId: "t-1", scenarioId: "scn-1", status: "error", startedAt: oldIso });

  const result = runs.pruneRuns({ byStatus: { completed: { olderThanDays: 30 } } });
  assert.deepEqual(result.prunedRunIds, ["old-completed"], "only the old COMPLETED run — error status untouched");
  assert.doesNotThrow(() => runs.getSummary("recent-completed"));
  assert.doesNotThrow(() => runs.getSummary("old-error"));
});

test("pruneRuns: keepNewest keeps only the N newest of that status (globally), deletes the rest", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  buildIndexedRun(db, runs, "c1", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: "2026-01-01T00:00:00.000Z" });
  buildIndexedRun(db, runs, "c2", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: "2026-02-01T00:00:00.000Z" });
  buildIndexedRun(db, runs, "c3", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: "2026-03-01T00:00:00.000Z" });

  const result = runs.pruneRuns({ byStatus: { completed: { keepNewest: 2 } } });
  assert.deepEqual(result.prunedRunIds, ["c1"], "keeps the 2 newest (c2, c3); prunes the oldest (c1)");
  assert.doesNotThrow(() => runs.getSummary("c2"));
  assert.doesNotThrow(() => runs.getSummary("c3"));
});

test("pruneRuns: olderThanDays OR keepNewest — the victim set is their UNION, not their intersection", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  // Relative to Date.now() (never a hardcoded absolute date) so the assertions hold regardless of
  // the wall-clock date the test happens to run on.
  const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  buildIndexedRun(db, runs, "c1", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: days(100) });
  buildIndexedRun(db, runs, "c2", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: days(45) });
  buildIndexedRun(db, runs, "c3", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: days(15) });
  buildIndexedRun(db, runs, "c4", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: days(2) });

  // Both bounds select a SUFFIX of the recency-ordered list (oldest-first), so union = the LONGER
  // suffix and intersection = the SHORTER one — genuinely distinguishable:
  //   olderThanDays:30 alone → {c1 (100d), c2 (45d)}                      (suffix length 2)
  //   keepNewest:3     alone → {c1}         (keeps the 3 newest: c4,c3,c2) (suffix length 1)
  // UNION → {c1, c2} (the longer suffix). An INTERSECTION bug would wrongly yield only {c1}.
  const result = runs.pruneRuns({ byStatus: { completed: { olderThanDays: 30, keepNewest: 3 } } });
  assert.deepEqual(
    result.prunedRunIds.sort(),
    ["c1", "c2"],
    "union (the longer suffix), not the intersection (which would be just c1)",
  );
  assert.doesNotThrow(() => runs.getSummary("c3"));
  assert.doesNotThrow(() => runs.getSummary("c4"));
});

test("pruneRuns: a non-terminal (pending/running) status entry is silently ignored — a live run is never pruned", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  runs.createRun("live-run", { testId: "t-1", scenarioId: "scn-1", mode: "automated" }); // status: running
  db.prepare("UPDATE runs SET started_at = ? WHERE id = 'live-run'").run("2020-01-01T00:00:00.000Z");

  const result = runs.pruneRuns({ byStatus: { running: { olderThanDays: 1, keepNewest: 0 } } });
  assert.deepEqual(result.prunedRunIds, []);
  assert.doesNotThrow(() => runs.getSummary("live-run"));
});

test("pruneRuns: a PINNED run survives EVERY prune configuration, even a maximally aggressive one", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  const veryOld = new Date(Date.now() - 365 * 86_400_000).toISOString();
  buildIndexedRun(db, runs, "pinned-1", {
    testId: "t-1",
    scenarioId: "scn-1",
    status: "completed",
    startedAt: veryOld,
    pinned: true,
  });
  buildIndexedRun(db, runs, "pinned-2", {
    testId: "t-1",
    scenarioId: "scn-1",
    status: "error",
    startedAt: veryOld,
    pinned: true,
  });
  buildIndexedRun(db, runs, "unpinned-victim", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: veryOld });

  // Sweep-everything policies across every terminal status.
  const aggressivePolicies = [
    { byStatus: { completed: { keepNewest: 0 }, error: { keepNewest: 0 }, stopped: { keepNewest: 0 }, aborted: { keepNewest: 0 }, ended: { keepNewest: 0 } } },
    { byStatus: { completed: { olderThanDays: 1 }, error: { olderThanDays: 1 } } },
    { byStatus: { completed: { olderThanDays: 1, keepNewest: 0 }, error: { olderThanDays: 1, keepNewest: 0 } } },
  ];
  for (const policy of aggressivePolicies) {
    const result = runs.pruneRuns(policy);
    assert.ok(!result.prunedRunIds.includes("pinned-1"), `pinned-1 must survive ${JSON.stringify(policy)}`);
    assert.ok(!result.prunedRunIds.includes("pinned-2"), `pinned-2 must survive ${JSON.stringify(policy)}`);
  }
  assert.doesNotThrow(() => runs.getSummary("pinned-1"));
  assert.doesNotThrow(() => runs.getSummary("pinned-2"));
  // The unpinned sibling under the same policy IS pruned (proves the policy was actually live, not a no-op).
  assert.throws(
    () => runs.getSummary("unpinned-victim"),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
});

// ── (3) Pruning deletes via the FULL run-delete cascade — FTS docs + docmap rows gone ──────────────

test("pruneRuns deletes through the full run-delete cascade: steps/events counted + gone, FTS docs + docmap purged", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, "t-1", "scn-1");
  const veryOld = new Date(Date.now() - 365 * 86_400_000).toISOString();
  buildIndexedRun(db, runs, "victim", { testId: "t-1", scenarioId: "scn-1", status: "completed", startedAt: veryOld });
  buildIndexedRun(db, runs, "pinned-survivor", {
    testId: "t-1",
    scenarioId: "scn-1",
    status: "completed",
    startedAt: veryOld,
    pinned: true,
  });

  // Sanity: both runs are indexed (the WP1.3 FTS surface) before pruning.
  assert.ok(docsForRun(db, "victim").length > 0, "sanity: victim has indexed FTS documents");
  assert.ok(docMapForRun(db, "victim").length > 0, "sanity: victim has docmap rows");
  assert.ok(docsForRun(db, "pinned-survivor").length > 0, "sanity: pinned-survivor has indexed FTS documents");

  const stepsBefore = (db.prepare("SELECT COUNT(*) AS n FROM run_steps WHERE run_id = 'victim'").get() as { n: number }).n;
  const eventsBefore = (db.prepare("SELECT COUNT(*) AS n FROM run_events WHERE run_id = 'victim'").get() as { n: number }).n;
  assert.ok(stepsBefore > 0 && eventsBefore > 0, "sanity: victim has steps + events before pruning");

  const result = runs.pruneRuns({ byStatus: { completed: { keepNewest: 0 } } });

  assert.deepEqual(result.prunedRunIds, ["victim"], "the pinned run is excluded from the candidate set entirely");
  assert.equal(result.deletedSteps, stepsBefore, "prune reports the SAME deleted-step count the full delete path would");
  assert.equal(result.deletedEvents, eventsBefore);

  // The run row itself, its steps, and events are gone (the ordinary cascade).
  assert.throws(
    () => runs.getSummary("victim"),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM run_steps WHERE run_id = 'victim'").get() as { n: number }).n,
    0,
    "run_steps gone",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM run_events WHERE run_id = 'victim'").get() as { n: number }).n,
    0,
    "run_events gone",
  );

  // The WP1.3 full-text index rows are purged too — the SAME purge `DELETE /api/runs/:id` performs.
  assert.deepEqual(docsForRun(db, "victim"), [], "run_search documents purged for the pruned run");
  assert.deepEqual(docMapForRun(db, "victim"), [], "run_search_map docmap rows purged for the pruned run");

  // The pinned survivor keeps everything, including its FTS documents.
  assert.doesNotThrow(() => runs.getSummary("pinned-survivor"));
  assert.ok(docsForRun(db, "pinned-survivor").length > 0, "pinned-survivor's FTS documents are untouched");
});
