import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type {
  DigestPruneResult,
  HubMissionPlan,
  HubPruneResult,
  NotificationPruneResult,
  RunPruneResult,
  RunRetentionPolicy,
} from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import { registerMaintenanceRoutes } from "../src/db/maintenance.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { HubRepository } from "../src/hub/repository.js";
import { DigestReportRepository } from "../src/reports/digest.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { NotificationRepository } from "../src/watch/notifications.js";

// WP 3.3 — the assistant-specific maintenance route (`POST /api/maintenance/prune-assistant`), over a
// real Fastify app + in-memory DB + real temp directories. Fully offline: no SDK, no child.
// WP 1.6 (Observability, retention classes) extends the same harness with `runs`/`appSettings` for
// `POST /api/maintenance/prune-runs` and `GET`/`PUT /api/maintenance/run-retention-policy`.

const NOW = "2026-07-16T00:00:00.000Z";

const dirs: string[] = [];
const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const db of databases.splice(0)) db.close();
});

function tmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-maint-"));
  dirs.push(dir);
  return dir;
}

async function makeApp(): Promise<{
  baseUrl: string;
  repo: AssistantRepository;
  db: AppDatabase;
  dataDir: string;
  runs: RunRepository;
  appSettings: AppSettingsRepository;
  notifications: NotificationRepository;
  digests: DigestReportRepository;
  hub: HubRepository;
}> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  const secrets = new SecretStore(Buffer.alloc(32, 6));
  const repo = new AssistantRepository(db, secrets);
  const scans = new ScanRepository(db);
  const runs = new RunRepository(db);
  const appSettings = new AppSettingsRepository(db);
  const notifications = new NotificationRepository(db);
  const digests = new DigestReportRepository(db);
  const hub = new HubRepository(db);
  const dataDir = tmpDataDir();

  const app = Fastify({ logger: false });
  await registerMaintenanceRoutes(
    app,
    db,
    scans,
    {
      repository: repo,
      isThreadLive: () => false,
      assistantDataDir: dataDir,
    },
    runs,
    appSettings,
    notifications,
    digests,
    { repository: hub, dataDir },
  );
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    repo,
    db,
    dataDir,
    runs,
    appSettings,
    notifications,
    digests,
    hub,
  };
}

/** Seed the FK parents (provider → scenario, test) a `runs` row needs. */
function seedRunParents(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('scn-1', 'S', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('test-1', 'T', 'go', @now, @now)`,
  ).run({ now: NOW });
}

/** Insert a minimal `runs` row directly (no engine/event replay needed for retention-policy tests). */
function seedRun(
  db: AppDatabase,
  opts: { id: string; status: string; startedAt: string; pinned?: boolean },
): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, pinned)
     VALUES (@id, 'test-1', 'scn-1', 'automated', @status, @startedAt, @pinned)`,
  ).run({ id: opts.id, status: opts.status, startedAt: opts.startedAt, pinned: opts.pinned ? 1 : 0 });
}

test("POST /api/maintenance/prune-assistant with no query: retention disabled (days=0 default) — nothing pruned, 200", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  h.db
    .prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 400 * 86_400_000).toISOString(), thread.id);

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-assistant`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { retentionDays: number; prunedThreadIds: string[] };
  assert.equal(
    body.retentionDays,
    0,
    "config.assistantSessionRetentionDays defaults to 0 in tests",
  );
  assert.deepEqual(body.prunedThreadIds, []);
  assert.doesNotThrow(() => h.repo.getThread(thread.id));
});

test("POST /api/maintenance/prune-assistant?days=5 prunes a thread older than 5 days", async () => {
  const h = await makeApp();
  const old = h.repo.createThread({ title: "old" });
  h.db
    .prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 30 * 86_400_000).toISOString(), old.id);
  const recent = h.repo.createThread({ title: "recent" });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-assistant?days=5`, {
    method: "POST",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { retentionDays: number; prunedThreadIds: string[] };
  assert.equal(body.retentionDays, 5);
  assert.deepEqual(body.prunedThreadIds, [old.id]);
  assert.throws(
    () => h.repo.getThread(old.id),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
  assert.doesNotThrow(() => h.repo.getThread(recent.id));
});

test("POST /api/maintenance/prune-assistant?days=0 explicitly disables day-gated pruning but still sweeps orphans", async () => {
  const h = await makeApp();
  fs.mkdirSync(path.join(h.dataDir, "ws", "orphan-thread"), { recursive: true });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-assistant?days=0`, {
    method: "POST",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { retentionDays: number; removedOrphanWorkspaceDirs: number };
  assert.equal(body.retentionDays, 0);
  assert.equal(body.removedOrphanWorkspaceDirs, 1);
  assert.equal(fs.existsSync(path.join(h.dataDir, "ws", "orphan-thread")), false);
});

test("POST /api/maintenance/prune-assistant?days=-1 (invalid) falls back to the configured default, same as an absent/garbage query", async () => {
  const h = await makeApp();
  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-assistant?days=-1`, {
    method: "POST",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { retentionDays: number };
  assert.equal(
    body.retentionDays,
    0,
    "negative override is rejected — falls back to the configured (0) default",
  );
});

// ── Observability WP1.6 — retention classes: GET/PUT run-retention-policy + POST prune-runs ────────

test("GET /api/maintenance/run-retention-policy defaults to the empty policy (byStatus: {}) — pruning OFF", async () => {
  const h = await makeApp();
  const res = await fetch(`${h.baseUrl}/api/maintenance/run-retention-policy`);
  assert.equal(res.status, 200);
  const policy = (await res.json()) as RunRetentionPolicy;
  assert.deepEqual(policy, { byStatus: {} });
});

test("PUT /api/maintenance/run-retention-policy round-trips through GET and is honored by prune-runs", async () => {
  const h = await makeApp();
  const policy: RunRetentionPolicy = { byStatus: { completed: { keepNewest: 1 } } };

  const putRes = await fetch(`${h.baseUrl}/api/maintenance/run-retention-policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(policy),
  });
  assert.equal(putRes.status, 200);
  assert.deepEqual(await putRes.json(), policy);

  const getRes = await fetch(`${h.baseUrl}/api/maintenance/run-retention-policy`);
  assert.deepEqual(await getRes.json(), policy, "PUT persists — GET reflects it");

  seedRunParents(h.db);
  seedRun(h.db, { id: "old", status: "completed", startedAt: "2026-01-01T00:00:00.000Z" });
  seedRun(h.db, { id: "new", status: "completed", startedAt: "2026-07-01T00:00:00.000Z" });

  // No body → uses the PERSISTED policy (keepNewest: 1 on 'completed' → the older run is pruned).
  const pruneRes = await fetch(`${h.baseUrl}/api/maintenance/prune-runs`, { method: "POST" });
  assert.equal(pruneRes.status, 200);
  const result = (await pruneRes.json()) as RunPruneResult;
  assert.deepEqual(result.prunedRunIds, ["old"]);
  assert.deepEqual(result.policy, policy);
});

test("POST /api/maintenance/prune-runs with an empty/absent policy is a no-op (defaults OFF)", async () => {
  const h = await makeApp();
  seedRunParents(h.db);
  seedRun(h.db, { id: "r1", status: "completed", startedAt: "2020-01-01T00:00:00.000Z" });
  seedRun(h.db, { id: "r2", status: "error", startedAt: "2020-01-01T00:00:00.000Z" });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-runs`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as RunPruneResult;
  assert.deepEqual(result.prunedRunIds, [], "no persisted policy, no request override → nothing pruned");
  assert.doesNotThrow(() => h.runs.getSummary("r1"));
  assert.doesNotThrow(() => h.runs.getSummary("r2"));
});

test("POST /api/maintenance/prune-runs with a request-body policy override prunes WITHOUT persisting it", async () => {
  const h = await makeApp();
  seedRunParents(h.db);
  seedRun(h.db, { id: "old-err", status: "error", startedAt: "2026-01-01T00:00:00.000Z" });

  const overridePolicy: RunRetentionPolicy = { byStatus: { error: { olderThanDays: 30 } } };
  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ policy: overridePolicy }),
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as RunPruneResult;
  assert.deepEqual(result.prunedRunIds, ["old-err"]);

  // The override was NOT persisted — the saved policy is still the empty default.
  const getRes = await fetch(`${h.baseUrl}/api/maintenance/run-retention-policy`);
  assert.deepEqual(await getRes.json(), { byStatus: {} }, "an ad hoc prune override is never persisted");
});

test("POST /api/maintenance/prune-runs NEVER prunes a pinned run, under any configured policy", async () => {
  const h = await makeApp();
  seedRunParents(h.db);
  seedRun(h.db, {
    id: "pinned-old",
    status: "completed",
    startedAt: "2020-01-01T00:00:00.000Z",
    pinned: true,
  });
  seedRun(h.db, { id: "unpinned-old", status: "completed", startedAt: "2020-01-01T00:00:00.000Z" });

  // An aggressive policy that would otherwise sweep everything (keepNewest: 0 + a 1-day age bound).
  const aggressive: RunRetentionPolicy = {
    byStatus: { completed: { keepNewest: 0, olderThanDays: 1 } },
  };
  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ policy: aggressive }),
  });
  const result = (await res.json()) as RunPruneResult;
  assert.deepEqual(result.prunedRunIds, ["unpinned-old"], "the pinned run is never a candidate");
  assert.doesNotThrow(() => h.runs.getSummary("pinned-old"), "pinned survives the aggressive policy");
});

test("POST /api/maintenance/prune-runs ignores a non-terminal (pending/running) status entry — a live run is never pruned", async () => {
  const h = await makeApp();
  seedRunParents(h.db);
  seedRun(h.db, { id: "live", status: "running", startedAt: "2020-01-01T00:00:00.000Z" });

  const misconfigured: RunRetentionPolicy = {
    byStatus: { running: { olderThanDays: 1, keepNewest: 0 } },
  };
  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ policy: misconfigured }),
  });
  const result = (await res.json()) as RunPruneResult;
  assert.deepEqual(result.prunedRunIds, [], "pending/running is silently ignored — never a candidate");
  assert.doesNotThrow(() => h.runs.getSummary("live"));
});

// ── Observability (WP4.3) — POST /api/maintenance/prune-notifications ────────────────────────────
// Only READ notifications older than the retention window are pruned; an UNREAD one is NEVER a
// victim regardless of age (an operator must see an alert at least once).

/** Insert a notification row directly (bypassing NotificationRepository.create's `at = now` stamp) so
 *  a test can control age + read state precisely. */
function seedNotification(
  db: AppDatabase,
  opts: { id: string; at: string; read: boolean },
): void {
  db.prepare(
    `INSERT INTO notifications (id, at, severity, title, body, read, late)
     VALUES (@id, @at, 'info', 'T', 'B', @read, 0)`,
  ).run({ id: opts.id, at: opts.at, read: opts.read ? 1 : 0 });
}

test("POST /api/maintenance/prune-notifications removes ONLY read notifications older than the retention window", async () => {
  const h = await makeApp();
  seedNotification(h.db, { id: "old-read", at: "2020-01-01T00:00:00.000Z", read: true });
  seedNotification(h.db, { id: "old-unread", at: "2020-01-01T00:00:00.000Z", read: false });
  seedNotification(h.db, { id: "new-read", at: new Date().toISOString(), read: true });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-notifications?days=30`, {
    method: "POST",
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as NotificationPruneResult;
  assert.equal(result.retentionDays, 30);
  assert.deepEqual(result.prunedNotificationIds, ["old-read"], "only the old READ row is pruned");

  assert.doesNotThrow(() => h.notifications.get("old-unread"), "unread survives regardless of age");
  assert.doesNotThrow(() => h.notifications.get("new-read"), "a recent read row survives");
  assert.throws(() => h.notifications.get("old-read"), "the old read row is gone");
});

test("POST /api/maintenance/prune-notifications with no ?days= uses the default retention", async () => {
  const h = await makeApp();
  seedNotification(h.db, { id: "n1", at: new Date().toISOString(), read: true });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-notifications`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as NotificationPruneResult;
  assert.equal(result.retentionDays, 30, "defaults to NOTIFICATION_RETENTION_DAYS_DEFAULT");
  assert.deepEqual(result.prunedNotificationIds, [], "a fresh read row is within the default window");
});

// ── Observability (WP5.5, D-OB22) — POST /api/maintenance/prune-digests ──────────────────────────

/** A minimal, honest-empty DigestReport for a prune fixture — the content itself is irrelevant here. */
function emptyDigestReport(id: string, generatedAt: string) {
  return {
    id,
    windowKind: "daily" as const,
    windowFrom: "2020-01-01T00:00:00.000Z",
    windowTo: "2020-01-02T00:00:00.000Z",
    prevWindowFrom: "2019-12-31T00:00:00.000Z",
    prevWindowTo: "2020-01-01T00:00:00.000Z",
    generatedAt,
    late: false,
    headline: { runs: { current: 0, previous: 0, delta: 0 }, errorRate: null, costByBasis: {} },
    newIssues: [],
    regressedIssues: [],
    resolvedIssues: [],
    movers: [],
    notableRuns: [],
    scanMovers: [],
  };
}

test("POST /api/maintenance/prune-digests removes digests older than the retention window", async () => {
  const h = await makeApp();
  h.digests.insert({
    windowKind: "daily",
    windowFrom: "2020-01-01T00:00:00.000Z",
    windowTo: "2020-01-02T00:00:00.000Z",
    generatedAt: "2020-01-02T08:00:00.000Z",
    late: false,
    report: emptyDigestReport("old-digest", "2020-01-02T08:00:00.000Z"),
  });
  h.digests.insert({
    windowKind: "daily",
    windowFrom: "2020-01-01T00:00:00.000Z",
    windowTo: "2020-01-02T00:00:00.000Z",
    generatedAt: new Date().toISOString(),
    late: false,
    report: emptyDigestReport("new-digest", new Date().toISOString()),
  });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-digests?days=30`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as DigestPruneResult;
  assert.equal(result.retentionDays, 30);
  assert.deepEqual(result.prunedDigestIds, ["old-digest"]);
  assert.throws(() => h.digests.get("old-digest"));
  assert.doesNotThrow(() => h.digests.get("new-digest"));
});

test("POST /api/maintenance/prune-digests with no ?days= uses the default retention", async () => {
  const h = await makeApp();
  h.digests.insert({
    windowKind: "daily",
    windowFrom: "2020-01-01T00:00:00.000Z",
    windowTo: "2020-01-02T00:00:00.000Z",
    generatedAt: new Date().toISOString(),
    late: false,
    report: emptyDigestReport("d1", new Date().toISOString()),
  });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-digests`, { method: "POST" });
  assert.equal(res.status, 200);
  const result = (await res.json()) as DigestPruneResult;
  assert.equal(result.retentionDays, 180, "defaults to DIGEST_RETENTION_DAYS_DEFAULT");
  assert.deepEqual(result.prunedDigestIds, [], "a fresh row is within the default window");
});

// ── prune-hub (Assistant Hub, WP4.3) ────────────────────────────────────────────────────────────────

const MINIMAL_MISSION_PLAN: HubMissionPlan = { topology: "parallel", autonomy: "always_ask", agents: [] };

test("POST /api/maintenance/prune-hub with no query: retention disabled (days=0 default) — nothing pruned, 200", async () => {
  const h = await makeApp();
  const session = h.hub.createSession({ mode: "chat", model: "gpt-4o" });
  h.hub.setSessionLifecycle(session.id, { status: "completed" });
  h.db
    .prepare("UPDATE hub_sessions SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 400 * 86_400_000).toISOString(), session.id);

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-hub`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as HubPruneResult;
  assert.equal(body.retentionDays, 0, "config.hubSessionRetentionDays defaults to 0 in tests");
  assert.deepEqual(body.prunedSessionIds, []);
  assert.doesNotThrow(() => h.hub.getSession(session.id));
});

test("POST /api/maintenance/prune-hub?days=5 prunes a TERMINAL root session older than 5 days, leaves a recent one and a non-terminal one alone", async () => {
  const h = await makeApp();
  const old = h.hub.createSession({ mode: "chat", model: "gpt-4o" });
  h.hub.setSessionLifecycle(old.id, { status: "completed" });
  h.db
    .prepare("UPDATE hub_sessions SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 30 * 86_400_000).toISOString(), old.id);

  const recent = h.hub.createSession({ mode: "chat", model: "gpt-4o" });
  h.hub.setSessionLifecycle(recent.id, { status: "completed" });

  // Old but STILL RUNNING — never a prune victim regardless of age.
  const stillRunning = h.hub.createSession({ mode: "chat", model: "gpt-4o" });
  h.hub.setSessionLifecycle(stillRunning.id, { status: "running" });
  h.db
    .prepare("UPDATE hub_sessions SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 30 * 86_400_000).toISOString(), stillRunning.id);

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-hub?days=5`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as HubPruneResult;
  assert.equal(body.retentionDays, 5);
  assert.deepEqual(body.prunedSessionIds, [old.id]);
  assert.throws(
    () => h.hub.getSession(old.id),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
  assert.doesNotThrow(() => h.hub.getSession(recent.id));
  assert.doesNotThrow(() => h.hub.getSession(stillRunning.id));
});

test("POST /api/maintenance/prune-hub skips a root session whose MISSION is still in flight, even though the session's own status is terminal and it's old", async () => {
  const h = await makeApp();
  const root = h.hub.createSession({ mode: "mission", model: "gpt-4o" });
  h.hub.setSessionLifecycle(root.id, { status: "completed" }); // the planner turn settled…
  const mission = h.hub.createMission({
    sessionId: root.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: MINIMAL_MISSION_PLAN,
  });
  h.hub.updateMission(mission.id, { status: "running" }); // …but the mission itself is still running
  h.db
    .prepare("UPDATE hub_sessions SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 30 * 86_400_000).toISOString(), root.id);

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-hub?days=5`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as HubPruneResult;
  assert.deepEqual(body.prunedSessionIds, []);
  assert.doesNotThrow(() => h.hub.getSession(root.id));
});

test("POST /api/maintenance/prune-hub?days=0 explicitly disables day-gated pruning but still sweeps orphan workspace dirs + dangling files", async () => {
  const h = await makeApp();
  fs.mkdirSync(path.join(h.dataDir, "hub", "ws", "orphan-session"), { recursive: true });
  // A file whose only link points at a session id that no longer exists (D-AH12's denormalized
  // target_id, no real FK) — the sweep should remove the dangling link, then the now-unlinked blob.
  h.db
    .prepare(
      `INSERT INTO hub_files (id, sha256, mime, bytes, filename, content, created_at)
       VALUES ('file-1', 'sha', 'text/plain', 3, 'a.txt', x'616263', @now)`,
    )
    .run({ now: NOW });
  h.db
    .prepare(
      `INSERT INTO hub_file_links (id, file_id, role, target_kind, target_id, created_at)
       VALUES ('link-1', 'file-1', 'upload', 'session', 'gone-session-id', @now)`,
    )
    .run({ now: NOW });

  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-hub?days=0`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as HubPruneResult;
  assert.equal(body.retentionDays, 0);
  assert.equal(body.removedOrphanWorkspaceDirs, 1);
  assert.equal(fs.existsSync(path.join(h.dataDir, "hub", "ws", "orphan-session")), false);
  assert.equal(body.prunedDanglingFileLinks, 1);
  assert.equal(body.prunedUnlinkedFiles, 1);
  assert.equal(h.db.prepare("SELECT * FROM hub_files WHERE id = 'file-1'").get(), undefined);
});

test("POST /api/maintenance/prune-hub?days=-1 (invalid) falls back to the configured default, same as an absent/garbage query", async () => {
  const h = await makeApp();
  const res = await fetch(`${h.baseUrl}/api/maintenance/prune-hub?days=-1`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as HubPruneResult;
  assert.equal(
    body.retentionDays,
    0,
    "negative override is rejected — falls back to the configured (0) default",
  );
});
