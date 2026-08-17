// Assistant Hub (roadmap/assistant-hub/, WP3.2, §1.4 / D-AH11a) — the `hub_memory` REST surface over a
// REAL `HubRepository`, mirroring `hub-agent-routes.test.ts`'s harness (a real `HubSessionService` with
// no model ever invoked — memory routes never touch the turn engine).
//
// Proves (acceptance): create/list/get/patch/delete; a direct-UI `POST` is always `source:"user"` and
// `status:"active"` immediately (D-AH11 — a user-authored row needs no accept step); list filters by
// `status`/`kind`; 404s on an unknown id for every verb; a request body failing
// `hubMemoryInputSchema`/`hubMemoryPatchSchema` validation is rejected (400); the propose→explicit-save
// flow — a `assistant_proposed`/`proposed` row PATCHed to `active` with `?sessionId=` appends a durable
// `memory_saved` event (§1.3) to that session's log, a re-accept (already active) does NOT double-append,
// and a bad/unknown `?sessionId=` still commits the memory change (best-effort companion event only).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { HubMemory } from "@mcp-token-footprint/shared";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-memory-routes-"));
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
      throw new Error("memory routes never resolve a model");
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

async function postJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createMemory(
  h: Harness,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<HubMemory> {
  const res = await postJson(h, "/api/hub/memory", {
    kind: "preference",
    content: "Prefers concise answers.",
    ...overrides,
  });
  assert.equal(res.status, 201);
  return (await res.json()) as HubMemory;
}

// ── Direct-UI CRUD (source:"user") ──────────────────────────────────────────────────────────────────

test("POST /api/hub/memory creates a user-authored row that is active immediately; GET list/detail reflect it", async () => {
  const h = await makeApp();
  const memory = await createMemory(h, { kind: "profile", content: "Works on the elabs team." });
  assert.equal(memory.kind, "profile");
  assert.equal(memory.source, "user");
  assert.equal(memory.status, "active"); // D-AH11 — a user-authored row needs no accept step

  const listRes = await fetch(`${h.baseUrl}/api/hub/memory`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as HubMemory[];
  assert.ok(list.some((m) => m.id === memory.id));

  const getRes = await fetch(`${h.baseUrl}/api/hub/memory/${memory.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(((await getRes.json()) as HubMemory).id, memory.id);
});

test("POST /api/hub/memory 400s on a body failing hubMemoryInputSchema", async () => {
  const h = await makeApp();
  const res = await postJson(h, "/api/hub/memory", { kind: "preference", content: "" }); // empty content
  assert.equal(res.status, 400);
});

test("GET /api/hub/memory filters by status and kind", async () => {
  const h = await makeApp();
  await createMemory(h, { kind: "profile", content: "Profile row" });
  await createMemory(h, { kind: "preference", content: "Preference row" });
  h.repo.createMemory({
    kind: "instruction",
    content: "Proposed row",
    source: "assistant_proposed",
  });

  const byKind = (await (
    await fetch(`${h.baseUrl}/api/hub/memory?kind=profile`)
  ).json()) as HubMemory[];
  assert.ok(byKind.every((m) => m.kind === "profile"));
  assert.ok(byKind.length >= 1);

  const proposed = (await (
    await fetch(`${h.baseUrl}/api/hub/memory?status=proposed`)
  ).json()) as HubMemory[];
  assert.ok(proposed.every((m) => m.status === "proposed"));
  assert.ok(proposed.some((m) => m.content === "Proposed row"));

  const active = (await (
    await fetch(`${h.baseUrl}/api/hub/memory?status=active`)
  ).json()) as HubMemory[];
  assert.ok(active.every((m) => m.status === "active"));
  assert.ok(!active.some((m) => m.content === "Proposed row"));
});

test("PATCH /api/hub/memory/:id edits content and archives", async () => {
  const h = await makeApp();
  const memory = await createMemory(h);

  const edited = await patchJson(h, `/api/hub/memory/${memory.id}`, { content: "Prefers bullet points." });
  assert.equal(edited.status, 200);
  assert.equal(((await edited.json()) as HubMemory).content, "Prefers bullet points.");

  const archived = await patchJson(h, `/api/hub/memory/${memory.id}`, { status: "archived" });
  assert.equal(archived.status, 200);
  assert.equal(((await archived.json()) as HubMemory).status, "archived");

  const activeList = (await (
    await fetch(`${h.baseUrl}/api/hub/memory?status=active`)
  ).json()) as HubMemory[];
  assert.ok(!activeList.some((m) => m.id === memory.id));
});

test("PATCH /api/hub/memory/:id 400s on a body failing hubMemoryPatchSchema", async () => {
  const h = await makeApp();
  const memory = await createMemory(h);
  const res = await patchJson(h, `/api/hub/memory/${memory.id}`, { status: "not-a-real-status" });
  assert.equal(res.status, 400);
});

test("GET/PATCH/DELETE /api/hub/memory/:id 404 on an unknown id", async () => {
  const h = await makeApp();
  assert.equal((await fetch(`${h.baseUrl}/api/hub/memory/does-not-exist`)).status, 404);
  assert.equal(
    (await patchJson(h, "/api/hub/memory/does-not-exist", { content: "x" })).status,
    404,
  );
  assert.equal(
    (await fetch(`${h.baseUrl}/api/hub/memory/does-not-exist`, { method: "DELETE" })).status,
    404,
  );
});

test("DELETE /api/hub/memory/:id hard-deletes the row", async () => {
  const h = await makeApp();
  const memory = await createMemory(h);
  const res = await fetch(`${h.baseUrl}/api/hub/memory/${memory.id}`, { method: "DELETE" });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${h.baseUrl}/api/hub/memory/${memory.id}`)).status, 404);
});

test("GET /api/hub/memory filters by scope and scopeId (WP2.4, D-HUX11)", async () => {
  const h = await makeApp();
  // A scoped memory write requires an EXISTING owning entity (`resolveMemoryScope`'s 404 guard) — real
  // crew/agent rows first, not bare fixture ids.
  const crewOneId = h.repo.createCrew({
    name: "Crew one",
    topology: "parallel",
    members: [],
  }).id;
  const crewTwoId = h.repo.createCrew({
    name: "Crew two",
    topology: "parallel",
    members: [],
  }).id;
  const agentId = h.repo.createAgentRole({
    name: "Agent one",
    systemPrompt: "x",
    defaultModel: "test-model",
    target: "x",
    expectedOutcome: "x",
  }).id;

  await createMemory(h, { kind: "instruction", content: "Global profile note." }); // scope omitted ⇒ profile
  await createMemory(h, {
    kind: "instruction",
    content: "This crew always cites sources.",
    scope: "crew",
    scopeId: crewOneId,
  });
  await createMemory(h, {
    kind: "instruction",
    content: "A different crew's note.",
    scope: "crew",
    scopeId: crewTwoId,
  });
  await createMemory(h, {
    kind: "instruction",
    content: "An agent's own note.",
    scope: "agent",
    scopeId: agentId,
  });

  const crewOne = (await (
    await fetch(`${h.baseUrl}/api/hub/memory?scope=crew&scopeId=${crewOneId}`)
  ).json()) as HubMemory[];
  assert.equal(crewOne.length, 1);
  assert.equal(crewOne[0]?.content, "This crew always cites sources.");
  assert.equal(crewOne[0]?.scope, "crew");
  assert.equal(crewOne[0]?.scopeId, crewOneId);

  const crewOnly = (await (
    await fetch(`${h.baseUrl}/api/hub/memory?scope=crew`)
  ).json()) as HubMemory[];
  assert.equal(crewOnly.length, 2);
  assert.ok(crewOnly.every((m) => m.scope === "crew"));

  // An omitted scope still returns EVERY scope (unchanged default for existing callers).
  const all = (await (await fetch(`${h.baseUrl}/api/hub/memory`)).json()) as HubMemory[];
  assert.ok(all.length >= 4);
});

// ── The propose → explicit-save accept flow (D-AH11, §1.3 R-SES1) ──────────────────────────────────

test("PATCH .../memory/:id?sessionId=... on a proposed→active transition appends a durable memory_saved event", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  const proposed = h.repo.createMemory({
    kind: "preference",
    content: "Prefers concise answers.",
    source: "assistant_proposed",
  });
  assert.equal(proposed.status, "proposed");

  const res = await patchJson(
    h,
    `/api/hub/memory/${proposed.id}?sessionId=${session.id}`,
    { status: "active" },
  );
  assert.equal(res.status, 200);
  const saved = (await res.json()) as HubMemory;
  assert.equal(saved.status, "active");
  assert.equal(saved.source, "assistant_proposed");

  const events = h.repo.listEvents(session.id);
  const savedEvent = events.find((e) => e.type === "memory_saved");
  assert.ok(savedEvent, "expected a memory_saved event on the given session");
  assert.equal(savedEvent?.type === "memory_saved" && savedEvent.memoryId, proposed.id);
  assert.equal(savedEvent?.type === "memory_saved" && savedEvent.kind, "preference");
  assert.equal(savedEvent?.type === "memory_saved" && savedEvent.source, "assistant_proposed");
});

test("PATCH .../memory/:id without ?sessionId= still accepts the proposal (no event, no crash)", async () => {
  const h = await makeApp();
  const proposed = h.repo.createMemory({
    kind: "instruction",
    content: "Always cite sources.",
    source: "assistant_proposed",
  });

  const res = await patchJson(h, `/api/hub/memory/${proposed.id}`, { status: "active" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as HubMemory).status, "active");
});

test("PATCH .../memory/:id?sessionId=<unknown> still commits the memory change (best-effort companion event)", async () => {
  const h = await makeApp();
  const proposed = h.repo.createMemory({
    kind: "instruction",
    content: "Always cite sources.",
    source: "assistant_proposed",
  });

  const res = await patchJson(
    h,
    `/api/hub/memory/${proposed.id}?sessionId=does-not-exist`,
    { status: "active" },
  );
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as HubMemory).status, "active");
});

test("re-accepting an already-active row with ?sessionId= does NOT append a second memory_saved event", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  const proposed = h.repo.createMemory({
    kind: "preference",
    content: "Prefers concise answers.",
    source: "assistant_proposed",
  });
  await patchJson(h, `/api/hub/memory/${proposed.id}?sessionId=${session.id}`, { status: "active" });
  // A second PATCH while already "active" (e.g. just editing content) is not a fresh accept.
  await patchJson(h, `/api/hub/memory/${proposed.id}?sessionId=${session.id}`, {
    content: "Prefers very concise answers.",
  });

  const events = h.repo.listEvents(session.id);
  const savedEvents = events.filter((e) => e.type === "memory_saved");
  assert.equal(savedEvents.length, 1);
});
