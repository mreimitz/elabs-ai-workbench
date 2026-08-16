import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AssistantEvent } from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";

// Assistant (WP 0.1) — repository roundtrip, event seq monotonicity, and credential
// encrypted-at-rest coverage. Mirrors provider-credentials.test.ts / server-repository.test.ts.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function createRepository(db: AppDatabase, keyByte = 1): AssistantRepository {
  return new AssistantRepository(db, new SecretStore(Buffer.alloc(32, keyByte)));
}

// ── Threads: create/read/list/update/listByEntity/delete ────────────────────────────────────────

test("createThread + getThread roundtrip, applying defaults for an omitted title/model/authSource", () => {
  const repo = createRepository(createDatabase());

  const thread = repo.createThread({});
  assert.equal(thread.title, "New thread");
  assert.equal(thread.model, "claude-sonnet-4-5");
  assert.equal(thread.authSource, "subscription");
  assert.equal(thread.status, "idle");
  assert.equal(thread.autoAccept, false);
  assert.equal(thread.entityKind, undefined);
  assert.equal(thread.entityId, undefined);
  assert.equal(thread.sdkSessionId, undefined);
  assert.ok(thread.id);
  assert.ok(thread.createdAt);
  assert.equal(thread.createdAt, thread.updatedAt);

  const fetched = repo.getThread(thread.id);
  assert.deepEqual(fetched, thread);
});

test("createThread honors explicit fields, including the entity pin (D-AS15)", () => {
  const repo = createRepository(createDatabase());

  const thread = repo.createThread({
    title: "Triage run-abc123",
    entityKind: "run",
    entityId: "run-abc123",
    model: "claude-opus-4-8",
    authSource: "api_key",
  });

  assert.equal(thread.title, "Triage run-abc123");
  assert.equal(thread.entityKind, "run");
  assert.equal(thread.entityId, "run-abc123");
  assert.equal(thread.model, "claude-opus-4-8");
  assert.equal(thread.authSource, "api_key");
});

test("createThread honors autoAccept (born with the chosen write mode); defaults OFF", () => {
  const repo = createRepository(createDatabase());
  // Default: auto-accept OFF.
  assert.equal(repo.createThread({}).autoAccept, false);
  // Explicit ON — the dock (re)creates a thread carrying auto-accept when the active one 404s.
  const on = repo.createThread({ autoAccept: true });
  assert.equal(on.autoAccept, true);
  // Persisted (not just echoed): a fresh read still sees it ON.
  assert.equal(repo.getThread(on.id).autoAccept, true);
});

test("getThread on a missing id throws a 404", () => {
  const repo = createRepository(createDatabase());
  assert.throws(
    () => repo.getThread("does-not-exist"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

test("listThreads orders by updated_at DESC; listByEntity filters to the pinned entity only", () => {
  const repo = createRepository(createDatabase());

  const unpinned = repo.createThread({ title: "Global chat" });
  const pinnedRunA = repo.createThread({
    title: "Run A triage",
    entityKind: "run",
    entityId: "run-a",
  });
  const pinnedRunB = repo.createThread({
    title: "Run B triage",
    entityKind: "run",
    entityId: "run-b",
  });
  const pinnedSkill = repo.createThread({
    title: "Skill triage",
    entityKind: "skill",
    entityId: "skill-1",
  });

  const all = repo.listThreads();
  assert.equal(all.length, 4);
  // Most-recently-created (== most-recently-updated, nothing else touched them) sorts first.
  assert.equal(all[0]?.id, pinnedSkill.id);

  const runAThreads = repo.listByEntity("run", "run-a");
  assert.deepEqual(
    runAThreads.map((t) => t.id),
    [pinnedRunA.id],
  );

  const allRunThreads = repo.listThreads({ entityKind: "run" });
  assert.deepEqual(
    new Set(allRunThreads.map((t) => t.id)),
    new Set([pinnedRunA.id, pinnedRunB.id]),
  );
  assert.ok(!allRunThreads.some((t) => t.id === unpinned.id));
});

test("updateThread changes only title/model/autoAccept and bumps updated_at; other fields untouched", async () => {
  const repo = createRepository(createDatabase());
  const thread = repo.createThread({ entityKind: "skill", entityId: "skill-9" });

  // Ensure a >0ms gap so updated_at is provably different (ISO millisecond resolution).
  await new Promise((resolve) => setTimeout(resolve, 5));

  const updated = repo.updateThread(thread.id, { title: "Renamed", autoAccept: true });
  assert.equal(updated.title, "Renamed");
  assert.equal(updated.autoAccept, true);
  assert.equal(updated.model, thread.model, "model left untouched when omitted");
  assert.equal(updated.entityKind, "skill", "entity pin is not touched by updateThread");
  assert.equal(updated.entityId, "skill-9");
  assert.notEqual(updated.updatedAt, thread.updatedAt);
});

test("setSessionState transitions status/sdkSessionId — the path PATCH cannot reach", () => {
  const repo = createRepository(createDatabase());
  const thread = repo.createThread({});

  const running = repo.setSessionState(thread.id, {
    status: "running",
    sdkSessionId: "sdk-session-1",
  });
  assert.equal(running.status, "running");
  assert.equal(running.sdkSessionId, "sdk-session-1");

  const parked = repo.setSessionState(thread.id, { status: "idle" });
  assert.equal(parked.status, "idle");
  assert.equal(
    parked.sdkSessionId,
    "sdk-session-1",
    "omitted sdkSessionId is preserved, not cleared",
  );
});

test("deleteThread removes the thread and cascades its events; deleting twice 404s", () => {
  const repo = createRepository(createDatabase());
  const thread = repo.createThread({});
  repo.appendEvent(thread.id, { type: "user_message", text: "hello" });

  repo.deleteThread(thread.id);
  assert.throws(
    () => repo.getThread(thread.id),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
  assert.throws(
    () => repo.deleteThread(thread.id),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

// ── Events: append-only, per-thread monotonic seq ────────────────────────────────────────────────

test("appendEvent stamps a per-thread monotonic seq (1, 2, 3…) and listEvents replays in order", () => {
  const repo = createRepository(createDatabase());
  const thread = repo.createThread({});

  const first = repo.appendEvent(thread.id, { type: "user_message", text: "Analyze this run" });
  const second = repo.appendEvent(thread.id, {
    type: "assistant_message",
    text: "Looking into it…",
  });
  const third = repo.appendEvent(thread.id, {
    type: "tool_call",
    toolUseId: "call-1",
    toolName: "runs_get",
    input: { runId: "run-1" },
  });

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(third.seq, 3);
  assert.ok(first.createdAt);

  const replayed = repo.listEvents(thread.id);
  assert.equal(replayed.length, 3);
  assert.deepEqual(
    replayed.map((event) => event.seq),
    [1, 2, 3],
  );
  assert.deepEqual(
    replayed.map((event) => event.type),
    ["user_message", "assistant_message", "tool_call"],
  );
  // Round-trips the union payload byte-for-byte for structured fields (not just the type).
  const toolCall = replayed[2] as Extract<AssistantEvent, { type: "tool_call" }>;
  assert.equal(toolCall.toolUseId, "call-1");
  assert.equal(toolCall.toolName, "runs_get");
  assert.deepEqual(toolCall.input, { runId: "run-1" });
});

test("seq sequences are independent per thread — two threads both start at 1", () => {
  const repo = createRepository(createDatabase());
  const threadA = repo.createThread({ title: "A" });
  const threadB = repo.createThread({ title: "B" });

  repo.appendEvent(threadA.id, { type: "user_message", text: "a1" });
  const aSecond = repo.appendEvent(threadA.id, { type: "user_message", text: "a2" });
  const bFirst = repo.appendEvent(threadB.id, { type: "user_message", text: "b1" });

  assert.equal(aSecond.seq, 2);
  assert.equal(bFirst.seq, 1, "thread B's sequence is independent of thread A's");
  assert.equal(repo.listEvents(threadA.id).length, 2);
  assert.equal(repo.listEvents(threadB.id).length, 1);
});

test("appendEvent on a missing thread throws a 404 and writes no row", () => {
  const db = createDatabase();
  const repo = createRepository(db);

  assert.throws(
    () => repo.appendEvent("does-not-exist", { type: "user_message", text: "hi" }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM assistant_events").get() as { n: number };
  assert.equal(count.n, 0);
});

test("permission_request / permission_decision / limit_error / turn_done round-trip their full shape", () => {
  const repo = createRepository(createDatabase());
  const thread = repo.createThread({});

  const request = repo.appendEvent(thread.id, {
    type: "permission_request",
    requestId: "req-1",
    toolName: "skills.commit_workspace",
    input: { skillId: "skill-1", note: "fix trigger" },
    diffPreview: "- old\n+ new",
  });
  const decision = repo.appendEvent(thread.id, {
    type: "permission_decision",
    requestId: "req-1",
    behavior: "allow",
    updatedInput: { skillId: "skill-1", note: "fix trigger (edited)" },
  });
  const limitError = repo.appendEvent(thread.id, {
    type: "limit_error",
    message: "Subscription usage limit reached",
    source: "subscription",
  });
  const turnDone = repo.appendEvent(thread.id, { type: "turn_done", turnIndex: 2 });

  const [r, d, l, t] = repo.listEvents(thread.id);
  assert.deepEqual(r, request);
  assert.deepEqual(d, decision);
  assert.deepEqual(l, limitError);
  assert.deepEqual(t, turnDone);
});

// ── Credentials: encrypted at rest, never returned except via the INTERNAL getDecrypted() ──────────

const TOKEN = "sk-ant-oat01-super-secret-token-value";

test("createCredential encrypts the token at rest; the redacted summary carries no token field", () => {
  const db = createDatabase();
  const repo = createRepository(db, 2);

  const created = repo.createCredential({
    kind: "claude_oauth",
    token: TOKEN,
    label: "Owner subscription",
  });
  assert.equal(created.kind, "claude_oauth");
  assert.equal(created.label, "Owner subscription");
  assert.equal(
    (created as { token?: unknown }).token,
    undefined,
    "summary has no token field at all",
  );
  assert.equal(
    JSON.stringify(created).includes(TOKEN),
    false,
    "serialized summary never contains the raw token",
  );

  const row = db
    .prepare("SELECT token_encrypted FROM assistant_credentials WHERE id = ?")
    .get(created.id) as {
    token_encrypted: string;
  };
  assert.match(row.token_encrypted, /^enc:v1:/);
  assert.equal(row.token_encrypted.includes(TOKEN), false, "the stored row is not the plaintext");
  assert.notEqual(row.token_encrypted, TOKEN);
});

test("getDecrypted (INTERNAL ONLY) round-trips the original token; list/get never do", () => {
  const repo = createRepository(createDatabase(), 3);
  const created = repo.createCredential({ kind: "claude_oauth", token: TOKEN });

  assert.equal(repo.getDecrypted(created.id).token, TOKEN);

  const fetched = repo.getCredential(created.id);
  assert.equal((fetched as { token?: unknown }).token, undefined);
  assert.equal(JSON.stringify(fetched).includes(TOKEN), false);

  const listed = repo.listCredentials();
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes(TOKEN), false, "list never leaks the token either");
});

test("touchCredentialLastUsed sets last_used_at; deleteCredential removes the row (404 on repeat)", () => {
  const repo = createRepository(createDatabase(), 4);
  const created = repo.createCredential({ kind: "claude_oauth", token: TOKEN });
  assert.equal(created.lastUsedAt, null);

  repo.touchCredentialLastUsed(created.id);
  const touched = repo.getCredential(created.id);
  assert.ok(touched.lastUsedAt);

  repo.deleteCredential(created.id);
  assert.throws(
    () => repo.getCredential(created.id),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
  assert.throws(
    () => repo.deleteCredential(created.id),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});
