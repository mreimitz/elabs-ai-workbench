import assert from "node:assert/strict";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, test } from "node:test";
import { type AppDatabase, applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { registerRatingIssueRoutes } from "../src/grading/issue-routes.js";
import {
  ISSUE_VERIFICATION_LINKS_KEY,
  IssueVerificationStore,
} from "../src/grading/issue-verification.js";
import { RunRepository } from "../src/testing/run-repository.js";

// Observability WP5.4 — the issue⇆run VERIFICATION link mark: an app_settings JSON document (NO schema
// change) + the read route that hydrates each link with its run's live status.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** Insert a terminal `runs` row (FK off so no test/scenario parents are needed). */
function insertRun(db: AppDatabase, id: string, status: string, outcome: string | null): void {
  db.pragma("foreign_keys = OFF");
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, ended_at)
     VALUES (@id, 't-1', 'sc-1', 'automated', @status, @outcome, @at, @at)`,
  ).run({ id, status, outcome, at: "2026-07-15T00:00:00.000Z" });
  db.pragma("foreign_keys = ON");
}

function seedIssue(issues: RatingIssueRepository): string {
  const issue = issues.insert({
    targetKind: "mcp_server",
    targetId: "srv-1",
    targetName: "Qlik MCP",
    title: "run_query rejects a date filter",
    summary: "schema-validation error",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "loosen the schema",
    severity: "high",
    ratingVersion: 3,
    occurrence: {
      runId: "run-main",
      findingDigest: "d1",
      category: "failed_tool_call",
      message: "rejected",
    },
  });
  return issue.id;
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────

class InMemoryKv {
  private store = new Map<string, unknown>();
  get(key: string): unknown {
    return this.store.get(key);
  }
  put(key: string, value: unknown): void {
    this.store.set(key, value);
  }
  seed(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

test("IssueVerificationStore.link records a link and list reads it back", () => {
  const store = new IssueVerificationStore(new InMemoryKv());
  assert.deepEqual(store.list("issue-1"), []);
  store.link("issue-1", { runId: "run-fork-1", sourceRunId: "run-1", note: "pin v4", at: "2026-07-15T00:00:00.000Z" });
  const links = store.list("issue-1");
  assert.equal(links.length, 1);
  assert.equal(links[0]?.runId, "run-fork-1");
  assert.equal(links[0]?.sourceRunId, "run-1");
  assert.equal(links[0]?.note, "pin v4");
});

test("IssueVerificationStore.link is idempotent per runId (a retried fork updates in place, no duplicate)", () => {
  const store = new IssueVerificationStore(new InMemoryKv());
  store.link("issue-1", { runId: "run-fork-1", note: "first", at: "2026-07-15T00:00:00.000Z" });
  store.link("issue-1", { runId: "run-fork-1", note: "second", at: "2026-07-15T01:00:00.000Z" });
  const links = store.list("issue-1");
  assert.equal(links.length, 1, "same runId is deduped");
  assert.equal(links[0]?.note, "second", "the note updated in place");
});

test("IssueVerificationStore keeps issues separate + repairs a corrupt document to empty", () => {
  const kv = new InMemoryKv();
  const store = new IssueVerificationStore(kv);
  store.link("issue-a", { runId: "run-a", at: "2026-07-15T00:00:00.000Z" });
  store.link("issue-b", { runId: "run-b", at: "2026-07-15T00:00:00.000Z" });
  assert.equal(store.list("issue-a").length, 1);
  assert.equal(store.list("issue-b").length, 1);

  // A corrupt persisted value degrades to empty, never throws.
  kv.seed(ISSUE_VERIFICATION_LINKS_KEY, "not-an-object");
  assert.deepEqual(store.read(), {});
  // A malformed link entry (no runId) is dropped.
  kv.seed(ISSUE_VERIFICATION_LINKS_KEY, { "issue-c": [{ note: "no runId" }] });
  assert.deepEqual(store.list("issue-c"), []);
});

// ── the route ─────────────────────────────────────────────────────────────────────────────────────

async function buildApp(db: AppDatabase): Promise<{
  app: FastifyInstance;
  issues: RatingIssueRepository;
  store: IssueVerificationStore;
}> {
  const issues = new RatingIssueRepository(db);
  const store = new IssueVerificationStore(new AppSettingsRepository(db));
  const runs = new RunRepository(db);
  const app = Fastify();
  await registerRatingIssueRoutes(app, issues, undefined, undefined, store, runs);
  await app.ready();
  apps.push(app);
  return { app, issues, store };
}

test("GET /api/issues/:id/verification-runs hydrates each link with its run's live status/outcome", async () => {
  const db = createDatabase();
  insertRun(db, "run-fork-1", "completed", "completed");
  const { app, issues, store } = await buildApp(db);
  const issueId = seedIssue(issues);
  store.link(issueId, { runId: "run-fork-1", sourceRunId: "run-main", note: "pin v4", at: "2026-07-15T00:00:00.000Z" });

  const res = await app.inject({ method: "GET", url: `/api/issues/${issueId}/verification-runs` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { runs: Array<{ runId: string; status?: string; outcome?: string; note?: string }> };
  assert.equal(body.runs.length, 1);
  assert.equal(body.runs[0]?.runId, "run-fork-1");
  assert.equal(body.runs[0]?.status, "completed");
  assert.equal(body.runs[0]?.outcome, "completed");
  assert.equal(body.runs[0]?.note, "pin v4");
});

test("GET /api/issues/:id/verification-runs returns [] for an issue with no verification runs", async () => {
  const db = createDatabase();
  const { app, issues } = await buildApp(db);
  const issueId = seedIssue(issues);
  const res = await app.inject({ method: "GET", url: `/api/issues/${issueId}/verification-runs` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual((res.json() as { runs: unknown[] }).runs, []);
});

test("GET /api/issues/:id/verification-runs 404s on an unknown issue id", async () => {
  const db = createDatabase();
  const { app } = await buildApp(db);
  const res = await app.inject({ method: "GET", url: "/api/issues/nope/verification-runs" });
  assert.equal(res.statusCode, 404);
});

test("a deleted derived run degrades to the bare link (no status), never a 500", async () => {
  const db = createDatabase();
  // No `runs` row for run-gone — getSummary throws 404 internally; the route swallows it.
  const { app, issues, store } = await buildApp(db);
  const issueId = seedIssue(issues);
  store.link(issueId, { runId: "run-gone", at: "2026-07-15T00:00:00.000Z" });
  const res = await app.inject({ method: "GET", url: `/api/issues/${issueId}/verification-runs` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { runs: Array<{ runId: string; status?: string }> };
  assert.equal(body.runs[0]?.runId, "run-gone");
  assert.equal(body.runs[0]?.status, undefined, "no live status when the run is gone");
});
