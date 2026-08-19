// Observability WP4.3 — the notification center: migration v40, NotificationRepository CRUD, the
// `createNotifySink` seam-consumer (unblocks the WP4.1 inert `notify` action), and the
// list/read/read-all/stream routes.
//
// Proves (acceptance):
//   1. A `notify` action (both on-terminal and windowed shapes) is turned into a persisted
//      Notification with the correct severity/title/body/link, is published to the hub (so the SSE
//      stream forwards it live), and read state round-trips (mark-one + mark-all).
//   2. A windowed fire's `late: true` is preserved on the persisted row (the web bell's "while you
//      were away" chip reads this).
//   3. Migration v40 (`notifications`) lands on BOTH the fresh-DB path and the pre-v40 upgrade path;
//      idempotent re-apply.
//   4. `pruneRead` removes ONLY read + old rows (route-level coverage is maintenance-routes.test.ts).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Notification, RunSummary } from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { toErrorMessage } from "../src/utils/errors.js";
import type { WatchNotifyRequest } from "../src/watch/actions.js";
import { registerNotificationRoutes } from "../src/watch/notification-routes.js";
import { createNotifySink, NotificationHub, NotificationRepository } from "../src/watch/notifications.js";

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

function tableExists(db: AppDatabase, table: string): boolean {
  return (
    (
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table) as {
        n: number;
      }
    ).n === 1
  );
}

function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scenario-1",
    mode: "automated",
    status: "completed",
    outcome: "success",
    startedAt: "2026-07-16T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 100,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    ...overrides,
  };
}

async function makeApp(
  repository: NotificationRepository,
  hub: NotificationHub,
): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerNotificationRoutes(app, repository, hub);
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

// ── (1) Migration v40 — fresh + upgrade path ─────────────────────────────────────────────────────

test("migration v40 — a fresh DB carries the notifications table; LATEST is 55", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    58,
    "LATEST auto-derived to 58 (v40 = notifications; v41 = fleet issue aggregation; v42 = runs fork lineage; v43 = digest reports; v44 = model pricing; v45 = dashboard charts; v46 = review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, roadmap/ci WP 1.1)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 58, "fresh DB stamped at 58");
  assert.ok(tableExists(db, "notifications"), "fresh DB has the notifications table");

  // Immediately usable + the CHECK constraint on severity holds.
  db.prepare(
    "INSERT INTO notifications (id, at, severity, title, body) VALUES ('n1','2026-07-16T00:00:00.000Z','info','T','B')",
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO notifications (id, at, severity, title, body) VALUES ('n2','2026-07-16T00:00:00.000Z','bogus','T','B')",
        )
        .run(),
    /CHECK/,
    "the severity CHECK constraint rejects an unknown value",
  );
});

test("migration v40 — a pre-v40 (v39) DB gains the notifications table; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. notifications…
  db.exec("DROP TABLE IF EXISTS notifications;"); // …then rewind to a pre-v40 (v39) DB
  db.pragma("user_version = 39");
  assert.ok(!tableExists(db, "notifications"), "sanity: the v39 fixture lacks notifications");

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST (58) after v40+v41+v42+v43+v44+v45+v46",
  );
  assert.ok(tableExists(db, "notifications"), "v40 created notifications on the existing (v39) DB");

  db.prepare(
    "INSERT INTO notifications (id, at, severity, title, body) VALUES ('n1','2026-07-16T00:00:00.000Z','warning','T','B')",
  ).run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n,
    1,
    "notifications usable post-migration",
  );

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v40 is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), 58, "version unchanged after the re-run");
});

// ── (2) NotificationRepository — CRUD + filters + paging ────────────────────────────────────────

test("create/get round-trips every field; list filters by unread/severity/date + paginates; markRead/markAllRead", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);

  const a = repo.create({
    severity: "info",
    title: "A",
    body: "body-a",
    linkPath: "/testing/runs/r1",
    runId: "r1",
  });
  assert.equal(a.severity, "info");
  assert.equal(a.linkPath, "/testing/runs/r1");
  assert.equal(a.runId, "r1");
  assert.equal(a.read, false);
  assert.equal(a.late, false);
  assert.deepEqual(repo.get(a.id), a);

  const b = repo.create({ severity: "critical", title: "B", body: "body-b", late: true });
  assert.equal(b.late, true);

  // Unread filter + global unreadCount (independent of the filtered page).
  let page = repo.list({});
  assert.equal(page.total, 2);
  assert.equal(page.unreadCount, 2);

  repo.markRead(a.id);
  page = repo.list({ unread: true });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.id, b.id, "only the still-unread notification matches unread:true");
  assert.equal(page.unreadCount, 1, "unreadCount reflects the read state change globally");

  // Severity filter.
  page = repo.list({ severity: "critical" });
  assert.deepEqual(
    page.items.map((n) => n.id),
    [b.id],
  );

  // markAllRead flips everything + returns the count changed.
  const changed = repo.markAllRead();
  assert.equal(changed, 1, "only b was still unread");
  assert.equal(repo.list({}).unreadCount, 0);

  // markRead on an unknown id 404s (httpError).
  assert.throws(() => repo.markRead("nope"), /Notification not found/);
});

test("list orders newest-first and paginates with limit/offset", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  // Insert with explicit `at` values (bypassing create's `now` stamp) so ordering is deterministic.
  const stmt = db.prepare(
    "INSERT INTO notifications (id, at, severity, title, body) VALUES (@id, @at, 'info', 'T', 'B')",
  );
  stmt.run({ id: "n1", at: "2026-07-16T00:00:01.000Z" });
  stmt.run({ id: "n2", at: "2026-07-16T00:00:02.000Z" });
  stmt.run({ id: "n3", at: "2026-07-16T00:00:03.000Z" });

  const page1 = repo.list({ limit: 2 });
  assert.deepEqual(
    page1.items.map((n) => n.id),
    ["n3", "n2"],
    "newest first",
  );
  assert.equal(page1.total, 3);

  const page2 = repo.list({ limit: 2, offset: 2 });
  assert.deepEqual(
    page2.items.map((n) => n.id),
    ["n1"],
  );
});

test("pruneRead removes ONLY read notifications older than N days; an unread row is never a victim", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const stmt = db.prepare(
    "INSERT INTO notifications (id, at, severity, title, body, read) VALUES (@id, @at, 'info', 'T', 'B', @read)",
  );
  stmt.run({ id: "old-read", at: "2020-01-01T00:00:00.000Z", read: 1 });
  stmt.run({ id: "old-unread", at: "2020-01-01T00:00:00.000Z", read: 0 });
  stmt.run({ id: "new-read", at: new Date().toISOString(), read: 1 });

  const result = repo.pruneRead(30);
  assert.deepEqual(result.prunedNotificationIds, ["old-read"]);
  assert.equal(result.retentionDays, 30);
  assert.throws(() => repo.get("old-read"));
  assert.doesNotThrow(() => repo.get("old-unread"));
  assert.doesNotThrow(() => repo.get("new-read"));

  // days <= 0 is a no-op.
  assert.deepEqual(repo.pruneRead(0).prunedNotificationIds, []);
});

// ── (3) createNotifySink — the WP4.1 seam consumer ───────────────────────────────────────────────

test("notify sink: an on-terminal request persists + publishes a notification enriched from the run summary", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const published: Notification[] = [];
  hub.subscribe((n) => published.push(n));

  const sink = createNotifySink({
    repository: repo,
    hub,
    getRunSummary: (runId) => makeSummary({ id: runId, status: "completed", outcome: "success" }),
  });

  const request: WatchNotifyRequest = { runId: "run-42", severity: "warning" };
  sink(request);

  const { items } = repo.list({});
  assert.equal(items.length, 1);
  const n = items[0]!;
  assert.equal(n.severity, "warning");
  assert.equal(n.runId, "run-42");
  assert.equal(n.linkPath, "/testing/runs/run-42");
  assert.equal(n.late, false);
  assert.match(n.title, /Completed/i);
  assert.ok(n.body.includes("test-1"), "body carries the enriched test id");

  assert.equal(published.length, 1, "the hub was published to");
  assert.deepEqual(published[0], n, "the published notification matches the persisted one");
});

test("notify sink: a `template` is used verbatim as the body", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const sink = createNotifySink({
    repository: repo,
    hub,
    getRunSummary: (runId) => makeSummary({ id: runId }),
  });

  sink({ runId: "run-1", severity: "critical", template: "custom message" });
  const n = repo.list({}).items[0]!;
  assert.equal(n.body, "custom message");
});

test("notify sink: an on-terminal request degrades honestly when the run lookup throws (never propagates)", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const sink = createNotifySink({
    repository: repo,
    hub,
    getRunSummary: () => {
      throw new Error("run vanished");
    },
  });

  assert.doesNotThrow(() => sink({ runId: "gone", severity: "info" }));
  const n = repo.list({}).items[0]!;
  assert.equal(n.title, "Run alert", "degrades to the generic title rather than throwing");
  assert.equal(n.runId, "gone");
});

test("notify sink: a windowed request persists the rule identity + late flag + rules link", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const sink = createNotifySink({
    repository: repo,
    hub,
    getRunSummary: () => makeSummary(),
  });

  const request: WatchNotifyRequest = {
    severity: "critical",
    window: {
      ruleId: "rule-1",
      ruleName: "Error rate spike",
      measure: "errorRate",
      op: ">=",
      threshold: 0.3,
      window: "1h",
      windowStart: "2026-07-16T00:00:00.000Z",
      windowEnd: "2026-07-16T01:00:00.000Z",
      value: 0.42,
      late: true,
    },
  };
  sink(request);

  const n = repo.list({}).items[0]!;
  assert.equal(n.title, "Error rate spike");
  assert.equal(n.ruleId, "rule-1");
  assert.equal(n.runId, undefined);
  assert.equal(n.linkPath, "/testing/observability/rules");
  assert.equal(n.late, true, "the boot-catch-up late flag is preserved for the bell's away chip");
  assert.match(n.body, /errorRate/);
  assert.match(n.body, /0\.42/);
});

test("notify sink: a persistence failure is swallowed — never thrown into the caller", () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  db.close(); // force repo.create to throw
  const hub = new NotificationHub();
  const sink = createNotifySink({ repository: repo, hub, getRunSummary: () => makeSummary() });
  assert.doesNotThrow(() => sink({ runId: "r1", severity: "info" }));
});

// ── (4) Routes — list/read/read-all/stream ───────────────────────────────────────────────────────

test("GET /api/notifications filters + pages; POST :id/read + read-all round-trip; a bad severity 400s", async () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const a = repo.create({ severity: "info", title: "A", body: "a" });
  repo.create({ severity: "critical", title: "B", body: "b" });
  const { app, baseUrl } = await makeApp(repo, hub);
  void app;

  const listRes = await fetch(`${baseUrl}/api/notifications`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { items: unknown[]; total: number; unreadCount: number };
  assert.equal(list.total, 2);
  assert.equal(list.unreadCount, 2);

  const filtered = await fetch(`${baseUrl}/api/notifications?severity=critical`);
  const filteredBody = (await filtered.json()) as { items: Array<{ severity: string }> };
  assert.deepEqual(
    filteredBody.items.map((n) => n.severity),
    ["critical"],
  );

  const readRes = await fetch(`${baseUrl}/api/notifications/${a.id}/read`, { method: "POST" });
  assert.equal(readRes.status, 200);
  const read = (await readRes.json()) as { read: boolean };
  assert.equal(read.read, true);

  const readAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, { method: "POST" });
  assert.equal(readAllRes.status, 200);
  assert.deepEqual(await readAllRes.json(), { count: 1 }, "only the still-unread B flips");

  const afterAll = (await (await fetch(`${baseUrl}/api/notifications`)).json()) as {
    unreadCount: number;
  };
  assert.equal(afterAll.unreadCount, 0);

  const bad = await fetch(`${baseUrl}/api/notifications?severity=bogus`);
  assert.equal(bad.status, 400, "an unknown severity is a ZodError -> 400");
});

test("POST /api/notifications/:id/read 404s for an unknown id", async () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const { baseUrl } = await makeApp(repo, hub);
  const res = await fetch(`${baseUrl}/api/notifications/nope/read`, { method: "POST" });
  assert.equal(res.status, 404);
});

test("GET /api/notifications/stream pushes a notification published to the hub as an SSE frame", async () => {
  const db = openFresh();
  const repo = new NotificationRepository(db);
  const hub = new NotificationHub();
  const { baseUrl } = await makeApp(repo, hub);

  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/notifications/stream`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // Publish AFTER the stream is open (a live push, not a replay).
  const notification = repo.create({ severity: "warning", title: "Live", body: "pushed" });
  hub.publish(notification);

  let buffer = "";
  let frame: string | undefined;
  while (frame === undefined) {
    const { value, done } = await reader.read();
    assert.ok(!done, "stream ended before the pushed frame arrived");
    buffer += decoder.decode(value, { stream: true });
    const sep = buffer.indexOf("\n\n");
    if (sep !== -1) frame = buffer.slice(0, sep);
  }
  assert.ok(frame.startsWith("data: "), "a real notification arrives as a data: frame");
  const parsed = JSON.parse(frame.slice("data: ".length)) as Notification;
  assert.equal(parsed.id, notification.id);
  assert.equal(parsed.title, "Live");

  controller.abort();
});
