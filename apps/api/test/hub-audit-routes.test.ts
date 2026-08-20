// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.2, §1.4 / D-AH13, R-UX7) — `GET /api/hub/audit` over a
// REAL `HubRepository`, mirroring `hub-memory-routes.test.ts`'s harness (a real `HubSessionService`
// with no model ever invoked — the audit projection never touches the turn engine, it only reads
// `hub_events` back). Events are seeded directly via `repo.appendEvent` (the same choke point the
// turn engine/missions/HITL routes use) rather than driving a full turn, so each scenario is precise.
//
// Proves (acceptance): a `tool_call`+`tool_result` pair (same `toolCallId`) merges into ONE row with
// the settled state/isError; an `approval_requested`+`approval_responded` pair merges into ONE row
// with the terminal resolution; `agent_spawned` and a settled `assistant_message` each surface as their
// own row (`spawn`/`model_call`); `annotations` (destructive/open-world) ride along on tool_call/
// approval rows (R-UX7's "irreversible external writes labeled"); filtering by `sessionId`/`kind`/
// `tool`/`since`/`until` narrows correctly; an unknown `?sessionId=` 404s; an `agent`-kind session's
// rows carry `rootSessionId` = that session's `parentSessionId` (the deep-link target — the app has no
// standalone per-agent transcript view, so the mission board on the parent is where that activity
// renders), while a `chat`-kind session's rows carry `rootSessionId` = its own id and (when resolvable)
// a `messageId` anchor; pagination (`limit`/`before`) returns every row exactly once, newest first.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { HubAuditEntry, HubAuditPage } from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubRepository } from "../src/hub/repository.js";
import { HubSessionService } from "../src/hub/session-service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { toErrorMessage } from "../src/utils/errors.js";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const harnesses: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-audit-routes-"));
  tempDirs.push(dir);
  return dir;
}

type Harness = { baseUrl: string; repo: HubRepository };

async function makeApp(): Promise<Harness> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: () => {
      throw new Error("audit routes never resolve a model");
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo };
}

async function getAudit(h: Harness, qs = ""): Promise<HubAuditPage> {
  const res = await fetch(`${h.baseUrl}/api/hub/audit${qs}`);
  assert.equal(res.status, 200);
  return (await res.json()) as HubAuditPage;
}

function entry(page: HubAuditPage, id: string): HubAuditEntry {
  const found = page.entries.find((e) => e.id === id);
  assert.ok(found, `expected an audit row with id ${id}`);
  return found;
}

test("a tool_call + tool_result pair (same toolCallId) merges into one settled row", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  h.repo.appendEvent(session.id, {
    type: "tool_call",
    messageId: "msg-1",
    part: {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "servers.scan",
      source: "builtin",
      state: "input-available",
      annotations: { destructiveHint: true, openWorldHint: false },
    },
  });
  h.repo.appendEvent(session.id, {
    type: "tool_result",
    toolCallId: "call-1",
    state: "output-available",
    isError: false,
  });

  const page = await getAudit(h);
  assert.equal(page.entries.length, 1);
  const row = entry(page, "tool_call:call-1");
  assert.equal(row.kind, "tool_call");
  assert.equal(row.toolName, "servers.scan");
  assert.equal(row.state, "output-available");
  assert.equal(row.isError, false);
  assert.equal(row.messageId, "msg-1");
  assert.equal(row.sessionId, session.id);
  assert.equal(row.rootSessionId, session.id);
  assert.ok(row.settledAt, "expected a settledAt from the tool_result");
  assert.deepEqual(row.annotations, { destructiveHint: true, openWorldHint: false });
});

test("a still-pending tool_call (no tool_result yet) surfaces with state 'pending'", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  h.repo.appendEvent(session.id, {
    type: "tool_call",
    part: {
      type: "tool_call",
      toolCallId: "call-pending",
      toolName: "workspace.files.write",
      source: "builtin",
      state: "input-available",
    },
  });

  const page = await getAudit(h);
  const row = entry(page, "tool_call:call-pending");
  assert.equal(row.state, "pending");
  assert.equal(row.settledAt, undefined);
});

test("an approval_requested + approval_responded pair merges into one resolved row", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  h.repo.appendEvent(session.id, {
    type: "approval_requested",
    toolCallId: "call-2",
    toolName: "files.delete",
    messageId: "msg-2",
    source: "mcp",
    serverId: "srv-1",
    annotations: { destructiveHint: true },
    options: ["allow-once", "always"],
    autonomy: "always_ask",
  });
  h.repo.appendEvent(session.id, {
    type: "approval_responded",
    toolCallId: "call-2",
    resolution: "allow-once",
  });

  const page = await getAudit(h, "?kind=approval");
  assert.equal(page.entries.length, 1);
  const row = entry(page, "approval:call-2");
  assert.equal(row.kind, "approval");
  assert.equal(row.toolName, "files.delete");
  assert.equal(row.resolution, "allow-once");
  assert.equal(row.serverId, "srv-1");
  assert.equal(row.messageId, "msg-2");
  assert.deepEqual(row.annotations, { destructiveHint: true });
});

test("a pending approval (no response yet) surfaces with resolution 'pending'", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  h.repo.appendEvent(session.id, {
    type: "approval_requested",
    toolCallId: "call-3",
    toolName: "servers.write",
    source: "mcp",
    options: ["allow-once"],
  });

  const row = entry(await getAudit(h, "?kind=approval"), "approval:call-3");
  assert.equal(row.resolution, "pending");
});

test("agent_spawned surfaces as a spawn row; assistant_message surfaces as a model_call row", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "mission", model: "test-model" });
  h.repo.appendEvent(session.id, {
    type: "agent_spawned",
    missionId: "mission-1",
    agentSessionId: "agent-session-1",
    key: "researcher",
    roleName: "Researcher",
    model: "gpt-test",
  });
  h.repo.appendEvent(session.id, {
    type: "assistant_message",
    messageId: "msg-3",
    model: "claude-test",
    parts: [{ type: "text", text: "hi" }],
    citations: [],
    artifactsTouched: [],
    usage: { tokensIn: 10, tokensOut: 5 },
    costUsd: 0.002,
  });

  const spawnPage = await getAudit(h, "?kind=spawn");
  assert.equal(spawnPage.entries.length, 1);
  const spawnRow = entry(spawnPage, "spawn:agent-session-1");
  assert.equal(spawnRow.roleName, "Researcher");
  assert.equal(spawnRow.model, "gpt-test");
  assert.equal(spawnRow.missionId, "mission-1");
  assert.equal(spawnRow.agentSessionId, "agent-session-1");

  const modelPage = await getAudit(h, "?kind=model_call");
  assert.equal(modelPage.entries.length, 1);
  const modelRow = entry(modelPage, "model_call:msg-3");
  assert.equal(modelRow.model, "claude-test");
  assert.equal(modelRow.costUsd, 0.002);
  assert.deepEqual(modelRow.usage, { tokensIn: 10, tokensOut: 5 });
});

test("an agent (mission-member) session's rows carry rootSessionId = its parent chat session", async () => {
  const h = await makeApp();
  const parent = h.repo.createSession({ mode: "mission", model: "test-model" });
  const child = h.repo.createSession({
    mode: "mission",
    model: "test-model",
    kind: "agent",
    parentSessionId: parent.id,
  });
  h.repo.appendEvent(child.id, {
    type: "tool_call",
    part: {
      type: "tool_call",
      toolCallId: "call-agent-1",
      toolName: "servers.scan",
      source: "builtin",
      state: "input-available",
    },
  });

  const row = entry(await getAudit(h), "tool_call:call-agent-1");
  assert.equal(row.sessionId, child.id);
  assert.equal(row.sessionKind, "agent");
  assert.equal(row.rootSessionId, parent.id);
});

test("filters by sessionId, tool (case-insensitive substring), and time range", async () => {
  const h = await makeApp();
  const sessionA = h.repo.createSession({ mode: "chat", model: "test-model" });
  const sessionB = h.repo.createSession({ mode: "chat", model: "test-model" });
  h.repo.appendEvent(sessionA.id, {
    type: "tool_call",
    part: {
      type: "tool_call",
      toolCallId: "call-a",
      toolName: "MCP.SearchWeb",
      source: "mcp",
      state: "input-available",
    },
  });
  h.repo.appendEvent(sessionB.id, {
    type: "tool_call",
    part: {
      type: "tool_call",
      toolCallId: "call-b",
      toolName: "workspace.files.read",
      source: "builtin",
      state: "input-available",
    },
  });

  const bySession = await getAudit(h, `?sessionId=${sessionA.id}`);
  assert.equal(bySession.entries.length, 1);
  assert.equal(bySession.entries[0]?.sessionId, sessionA.id);

  const byTool = await getAudit(h, "?tool=searchweb");
  assert.equal(byTool.entries.length, 1);
  assert.equal(byTool.entries[0]?.toolName, "MCP.SearchWeb");

  const future = new Date(Date.now() + 60_000).toISOString();
  const byTimeMiss = await getAudit(h, `?since=${encodeURIComponent(future)}`);
  assert.equal(byTimeMiss.entries.length, 0);

  const past = new Date(Date.now() - 60_000).toISOString();
  const byTimeHit = await getAudit(h, `?since=${encodeURIComponent(past)}`);
  assert.equal(byTimeHit.entries.length, 2);
});

test("GET /api/hub/audit 404s on an unknown ?sessionId= filter", async () => {
  const h = await makeApp();
  const res = await fetch(`${h.baseUrl}/api/hub/audit?sessionId=does-not-exist`);
  assert.equal(res.status, 404);
});

test("pagination (limit/before) returns every row exactly once, newest first", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  for (let i = 0; i < 5; i += 1) {
    h.repo.appendEvent(session.id, {
      type: "tool_call",
      part: {
        type: "tool_call",
        toolCallId: `call-${i}`,
        toolName: "workspace.files.write",
        source: "builtin",
        state: "input-available",
      },
    });
  }

  const firstPage = await getAudit(h, "?limit=2");
  assert.equal(firstPage.entries.length, 2);
  assert.ok(firstPage.nextBefore, "expected a nextBefore cursor with more rows behind it");
  // Newest first: the LAST-appended call (call-4) sorts first.
  assert.equal(firstPage.entries[0]?.id, "tool_call:call-4");

  const seen = new Set(firstPage.entries.map((e) => e.id));
  let cursor = firstPage.nextBefore;
  while (cursor) {
    const page = await getAudit(h, `?limit=2&before=${encodeURIComponent(cursor)}`);
    for (const e of page.entries) seen.add(e.id);
    cursor = page.nextBefore;
  }
  assert.equal(seen.size, 5);
});
