import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import { AssistantRepository } from "../src/assistant/repository.js";
import { pruneAssistantData } from "../src/assistant/retention.js";
import { ensureWorkspaceRoot } from "../src/assistant/workspace.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";

// WP 3.3 — `pruneAssistantData` (apps/api/src/assistant/retention.ts), exercised against a REAL
// temp-file DB (SQLite) and REAL temp directories (no SDK, no child, no network).

const dirs: string[] = [];
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const db of databases.splice(0)) db.close();
});

function tmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-retention-"));
  dirs.push(dir);
  return dir;
}

function createDb(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function createRepo(db: AppDatabase): AssistantRepository {
  return new AssistantRepository(db, new SecretStore(Buffer.alloc(32, 4)));
}

/** Backdate a thread's `updated_at` directly (repository has no public setter for it — this mirrors
 *  how other retention-style tests age a row for the cutoff comparison). */
function backdate(db: AppDatabase, threadId: string, daysAgo: number): void {
  const iso = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  db.prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ?").run(iso, threadId);
}

/** Set a file/dir's mtime `daysAgo` in the past (both atime and mtime, as `utimesSync` requires). */
function ageFile(target: string, daysAgo: number): void {
  const when = new Date(Date.now() - daysAgo * 86_400_000);
  fs.utimesSync(target, when, when);
}

const NEVER_LIVE = () => false;

test("days <= 0: no thread is pruned and the stale session-dir sweep is skipped, but the orphan sweep still runs", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir();

  const thread = repo.createThread({});
  backdate(db, thread.id, 400);

  // An orphaned ws/ dir for a thread id that was never created.
  fs.mkdirSync(path.join(dataDir, "ws", "ghost-1"), { recursive: true });
  // A stale-looking claude/projects dir — untouched because days <= 0 skips that pass entirely.
  const staleProject = path.join(dataDir, "claude", "projects", "proj-a");
  fs.mkdirSync(staleProject, { recursive: true });
  fs.writeFileSync(path.join(staleProject, "sess.jsonl"), "{}");
  ageFile(path.join(staleProject, "sess.jsonl"), 400);

  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: NEVER_LIVE,
    assistantDataDir: dataDir,
    days: 0,
  });

  assert.equal(result.retentionDays, 0);
  assert.deepEqual(result.prunedThreadIds, [], "no day-gated thread pruning when days=0");
  assert.equal(
    result.removedStaleSessionDirs,
    0,
    "the session-dir sweep is day-gated too — skipped",
  );
  assert.equal(
    result.removedOrphanWorkspaceDirs,
    1,
    "the orphan sweep is UNCONDITIONAL — still runs",
  );
  assert.equal(fs.existsSync(path.join(dataDir, "ws", "ghost-1")), false);
  assert.equal(fs.existsSync(staleProject), true, "the stale project dir survives when days=0");
  // The (400-day-old) thread itself is untouched — its row and events still exist.
  assert.doesNotThrow(() => repo.getThread(thread.id));
});

test("day-based retention prunes threads older than the window, cascading events, and removes their ws/threads dirs", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir();

  const old = repo.createThread({ title: "old" });
  repo.appendEvent(old.id, { type: "user_message", text: "hi" });
  backdate(db, old.id, 400);
  ensureWorkspaceRoot(dataDir, old.id);
  const oldScratch = path.join(dataDir, "threads", old.id);
  fs.mkdirSync(oldScratch, { recursive: true });

  const recent = repo.createThread({ title: "recent" });
  // No backdate — updated_at stays "now", well inside a 30-day window.

  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: NEVER_LIVE,
    assistantDataDir: dataDir,
    days: 30,
  });

  assert.deepEqual(result.prunedThreadIds, [old.id]);
  assert.equal(result.retentionDays, 30);
  assert.throws(
    () => repo.getThread(old.id),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
  const eventCount = (
    db.prepare("SELECT COUNT(*) AS n FROM assistant_events WHERE thread_id = ?").get(old.id) as {
      n: number;
    }
  ).n;
  assert.equal(eventCount, 0, "cascade deleted the pruned thread's events");
  assert.equal(fs.existsSync(path.join(dataDir, "ws", old.id)), false, "workspace root removed");
  assert.equal(fs.existsSync(oldScratch), false, "scratch cwd removed");
  // The recent thread is untouched.
  assert.doesNotThrow(() => repo.getThread(recent.id));
});

test("a thread with a LIVE session is NEVER pruned, even past the retention window", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir();

  const live = repo.createThread({ title: "live" });
  backdate(db, live.id, 400);

  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: (id) => id === live.id,
    assistantDataDir: dataDir,
    days: 30,
  });

  assert.deepEqual(result.prunedThreadIds, []);
  assert.doesNotThrow(() => repo.getThread(live.id));
});

test("orphan sweep removes ws/<id> and threads/<id> dirs whose thread id no longer exists in the DB", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir();

  const kept = repo.createThread({});
  ensureWorkspaceRoot(dataDir, kept.id);
  fs.mkdirSync(path.join(dataDir, "threads", kept.id), { recursive: true });

  fs.mkdirSync(path.join(dataDir, "ws", "orphan-a"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "threads", "orphan-b"), { recursive: true });

  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: NEVER_LIVE,
    assistantDataDir: dataDir,
    days: 0,
  });

  assert.equal(result.removedOrphanWorkspaceDirs, 1);
  assert.equal(result.removedOrphanScratchDirs, 1);
  assert.equal(fs.existsSync(path.join(dataDir, "ws", "orphan-a")), false);
  assert.equal(fs.existsSync(path.join(dataDir, "threads", "orphan-b")), false);
  // The kept thread's own directories survive.
  assert.equal(fs.existsSync(path.join(dataDir, "ws", kept.id)), true);
  assert.equal(fs.existsSync(path.join(dataDir, "threads", kept.id)), true);
});

test("missing ws/threads/claude directories (nothing ever created) are a harmless no-op, not a crash", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir(); // exists, but no ws/threads/claude subdirs inside it

  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: NEVER_LIVE,
    assistantDataDir: dataDir,
    days: 30,
  });

  assert.deepEqual(result, {
    retentionDays: 30,
    prunedThreadIds: [],
    removedOrphanWorkspaceDirs: 0,
    removedOrphanScratchDirs: 0,
    removedStaleSessionDirs: 0,
  });
});

test("stale SDK session-transcript sweep removes old project dirs under claude/projects by mtime, keeps fresh ones", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir();

  const stale = path.join(dataDir, "claude", "projects", "proj-stale");
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, "sess-1.jsonl"), "{}");
  ageFile(path.join(stale, "sess-1.jsonl"), 90);
  ageFile(stale, 90);

  const fresh = path.join(dataDir, "claude", "projects", "proj-fresh");
  fs.mkdirSync(fresh, { recursive: true });
  fs.writeFileSync(path.join(fresh, "sess-2.jsonl"), "{}"); // untouched — mtime is "now"

  // A stale TOP-level dir but with one FRESH nested file — the newest mtime anywhere in the tree wins,
  // so it must survive (never prune based on only the top directory's own mtime).
  const mixed = path.join(dataDir, "claude", "projects", "proj-mixed");
  fs.mkdirSync(mixed, { recursive: true });
  ageFile(mixed, 90);
  fs.writeFileSync(path.join(mixed, "sess-3.jsonl"), "{}"); // freshly written — NOT aged

  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: NEVER_LIVE,
    assistantDataDir: dataDir,
    days: 30,
  });

  assert.equal(result.removedStaleSessionDirs, 1);
  assert.equal(fs.existsSync(stale), false, "the stale project dir was removed");
  assert.equal(fs.existsSync(fresh), true, "the fresh project dir survives");
  assert.equal(fs.existsSync(mixed), true, "a dir with any fresh file anywhere inside survives");
});

test("?days= override precedence is the CALLER's concern, not pruneAssistantData's — it always uses the days it's given", () => {
  const db = createDb();
  const repo = createRepo(db);
  const dataDir = tmpDataDir();
  const thread = repo.createThread({});
  backdate(db, thread.id, 10);

  // days=5 prunes a 10-day-old thread; days=30 would not have.
  const result = pruneAssistantData({
    repository: repo,
    isThreadLive: NEVER_LIVE,
    assistantDataDir: dataDir,
    days: 5,
  });
  assert.deepEqual(result.prunedThreadIds, [thread.id]);
});
