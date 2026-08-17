// Assistant Hub (roadmap/assistant-hub/, WP1.2, §1.4) — the Sessions API + SSE routes, over a REAL
// `HubRepository` + a REAL `HubSessionService` with a STUBBED model (mirrors `hub-session-service.test.ts`
// and the testing feature's `run-stream-routes.test.ts` — no provider/MCP key is ever needed).
//
// Proves (acceptance): project/session CRUD; `POST .../messages` dispatches (202 + streamUrl, fire-and-
// forget); SSE replay-then-live (a fresh connect gets full persisted history; a connection opened BEFORE
// dispatch sees the turn live, in order, every frame's `id:` line matching its `seq`); `Last-Event-ID`
// resume delivers only the un-seen tail exactly once (no dupes); a `{type:"ping"}` heartbeat never
// carries an `id:`; 409 when no hub-eligible provider credential exists (both on session create and on
// message dispatch); `reconcileOrphanHubSessions` aborts a session left `running` at boot with a settled
// `error` event, leaving non-running sessions untouched; `createHubModelResolver` picks a hub-eligible,
// name-hinted credential and 409s with none; stop/seen/end lifecycle actions; branch copies the
// conversational history into a new session and records `branch_created` on the source.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  DEFAULT_TOKEN_PROFILE,
  STOP_REASON_CODES,
  type ProviderKind,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  assertHubProviderConfigured,
  createHubModelResolver,
  hasHubProviderCredential,
  reconcileOrphanHubMissions,
  reconcileOrphanHubSessions,
  registerHubRoutes,
  setHubSseHeartbeatMsForTesting,
} from "../src/hub/routes.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSessionService,
  type HubModelResolver,
  type HubSessionServiceConfig,
} from "../src/hub/session-service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { toErrorMessage } from "../src/utils/errors.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
type Frame = Record<string, unknown> & { type: string; seq?: number; __sseId?: string };

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

function textModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ] as V3Part[],
      }),
    }),
  }) as unknown as LanguageModel;
}

function resolverFor(
  entries: Record<string, { kind: ProviderKind; model?: () => LanguageModel }>,
): HubModelResolver {
  return (modelId) => {
    const entry = entries[modelId];
    if (!entry) throw new Error(`no model resolution for "${modelId}"`);
    return {
      providerKind: entry.kind,
      modelId,
      contextWindow: 128000,
      ...(entry.model ? { buildModel: entry.model } : {}),
    };
  };
}

// ── DB / harness plumbing ────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const harnesses: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  setHubSseHeartbeatMsForTesting(15_000);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-routes-"));
  tempDirs.push(dir);
  return dir;
}

function seedAnthropicCredential(db: AppDatabase, secrets: SecretStore): void {
  const now = "2026-07-17T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now });
}

type Harness = { app: FastifyInstance; baseUrl: string; repo: HubRepository; db: AppDatabase };

async function makeApp(options: {
  resolveModel?: HubModelResolver;
  /** model-identity WP2.2 — build the resolver from the harness's OWN `ProviderRepository`, so a ROUTE
   *  test can exercise the PRODUCTION `createHubModelResolver` (and its D-MI9 409s) end to end instead
   *  of a stub. Exactly one of `resolveModel` / `resolveModelFrom` is required. */
  resolveModelFrom?: (providers: ProviderRepository) => HubModelResolver;
  seedProvider?: boolean;
  /** Extra credential rows, seeded BEFORE the repositories are built (so `authBroken` and eligibility
   *  are computed over them). Runs after the default `prov-1` anthropic seed. */
  seedCredentials?: (db: AppDatabase, secrets: SecretStore) => void;
  config?: Partial<HubSessionServiceConfig>;
  /** hub-fixes WP1.3 (RC3.4) — injects `POST /api/hub/servers/:id/reconnect`'s evict callback; absent
   *  ⇒ the route isn't mounted (mirrors every other optional dep this harness already handles). */
  evictHubMcpSession?: (serverId: string) => Promise<void> | void;
}): Promise<Harness> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  if (options.seedProvider !== false) seedAnthropicCredential(db, secrets);
  options.seedCredentials?.(db, secrets);
  const providerRepository = new ProviderRepository(db, secrets);
  const resolveModel = options.resolveModel ?? options.resolveModelFrom?.(providerRepository);
  if (!resolveModel) throw new Error("makeApp needs `resolveModel` or `resolveModelFrom`");
  const repo = new HubRepository(db);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
      ...options.config,
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
    ...(options.evictHubMcpSession ? { evictHubMcpSession: options.evictHubMcpSession } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${port}`, repo, db };
}

async function postJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSession(h: Harness, model: string): Promise<{ id: string; title: string }> {
  const res = await postJson(h, "/api/hub/sessions", { mode: "chat", model });
  assert.equal(res.status, 201, "session create succeeds");
  return (await res.json()) as { id: string; title: string };
}

/** Poll the replay detail until `predicate` matches one of its events (bounded). */
async function waitForEvent(
  h: Harness,
  sessionId: string,
  predicate: (event: Frame) => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = (await (await fetch(`${h.baseUrl}/api/hub/sessions/${sessionId}`)).json()) as {
      events: Frame[];
    };
    if (detail.events.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for a matching event on session ${sessionId}`);
}

// ── SSE client plumbing ──────────────────────────────────────────────────────────────────────────

type HubStream = { reader: ReadableStreamDefaultReader<Uint8Array>; close: () => void };

async function openHubStream(
  h: Harness,
  sessionId: string,
  headers?: Record<string, string>,
): Promise<HubStream> {
  // A hub session's stream has no server-driven terminal close (it's a long-lived thread, not a
  // one-shot run) — a plain `reader.cancel()` alone can leave the underlying keep-alive socket
  // lingering (undici pools it rather than tearing it down immediately), which stalls a SECOND
  // sequential connection in the same test for undici's own multi-second keep-alive timeout. Pairing
  // it with an `AbortController` (mirrors `run-stream-routes.test.ts`'s own disconnect test) forces an
  // immediate teardown instead.
  const controller = new AbortController();
  const res = await fetch(`${h.baseUrl}/api/hub/sessions/${sessionId}/stream`, {
    headers,
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  return {
    reader,
    close: () => {
      controller.abort();
      void reader.cancel().catch(() => undefined);
    },
  };
}

/** Read SSE frames off an open stream until `stopWhen` matches (or a timeout), then close it. */
async function pumpFrames(
  stream: HubStream,
  stopWhen: (frame: Frame) => boolean,
  timeoutMs = 5000,
): Promise<Frame[]> {
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await stream.reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let id: string | undefined;
        let parsed: Frame | undefined;
        for (const line of raw.split("\n")) {
          if (line.startsWith("id:")) id = line.slice(3).trim();
          else if (line.startsWith("data:")) parsed = JSON.parse(line.slice(5).trim()) as Frame;
        }
        if (!parsed) continue;
        const frame: Frame = { ...parsed, ...(id !== undefined ? { __sseId: id } : {}) };
        frames.push(frame);
        if (stopWhen(frame)) return frames;
      }
    }
    return frames;
  } finally {
    stream.close();
  }
}

// ── Project CRUD ──────────────────────────────────────────────────────────────────────────────────

test("project CRUD: create, list, patch, delete", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });

  const created = await postJson(h, "/api/hub/projects", { name: "Research", description: "d" });
  assert.equal(created.status, 201);
  const project = (await created.json()) as { id: string; name: string };
  assert.equal(project.name, "Research");

  const list = (await (await fetch(`${h.baseUrl}/api/hub/projects`)).json()) as Array<{
    id: string;
  }>;
  assert.ok(list.some((p) => p.id === project.id));

  const patched = await fetch(`${h.baseUrl}/api/hub/projects/${project.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Research 2" }),
  });
  assert.equal(patched.status, 200);
  assert.equal(((await patched.json()) as { name: string }).name, "Research 2");

  const deleted = await fetch(`${h.baseUrl}/api/hub/projects/${project.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);

  const listAfter = (await (await fetch(`${h.baseUrl}/api/hub/projects`)).json()) as Array<{
    id: string;
  }>;
  assert.ok(!listAfter.some((p) => p.id === project.id));
});

test("project detail: GET /:id 200s a known project and 404s an unknown one", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const created = await postJson(h, "/api/hub/projects", { name: "Research" });
  const project = (await created.json()) as { id: string };

  const found = await fetch(`${h.baseUrl}/api/hub/projects/${project.id}`);
  assert.equal(found.status, 200);
  assert.equal(((await found.json()) as { id: string }).id, project.id);

  const missing = await fetch(`${h.baseUrl}/api/hub/projects/does-not-exist`);
  assert.equal(missing.status, 404);
});

// ── WP3.1: project pinned files ─────────────────────────────────────────────────────────────────

test("project pinned files: create, list (metadata-only), read (with content), delete", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const created = await postJson(h, "/api/hub/projects", { name: "Research" });
  const project = (await created.json()) as { id: string };

  const pinned = await postJson(h, `/api/hub/projects/${project.id}/files`, {
    filename: "style-guide.md",
    content: "# Style guide\n\nUse tabular-nums for numbers.",
  });
  assert.equal(pinned.status, 201);
  const file = (await pinned.json()) as { id: string; filename?: string; bytes: number };
  assert.equal(file.filename, "style-guide.md");
  assert.ok(file.bytes > 0);
  assert.equal(
    (file as { content?: string }).content,
    undefined,
    "the list/create shape carries no content",
  );

  const list = (await (
    await fetch(`${h.baseUrl}/api/hub/projects/${project.id}/files`)
  ).json()) as Array<{
    id: string;
  }>;
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, file.id);

  const detail = await fetch(`${h.baseUrl}/api/hub/projects/${project.id}/files/${file.id}`);
  assert.equal(detail.status, 200);
  const detailBody = (await detail.json()) as { content: string };
  assert.match(detailBody.content, /Use tabular-nums/);

  const deleted = await fetch(`${h.baseUrl}/api/hub/projects/${project.id}/files/${file.id}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);

  const listAfter = (await (
    await fetch(`${h.baseUrl}/api/hub/projects/${project.id}/files`)
  ).json()) as unknown[];
  assert.equal(listAfter.length, 0);
});

test("project pinned files: a file id from a DIFFERENT project 404s (not cross-project readable)", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const projectA = (await (await postJson(h, "/api/hub/projects", { name: "A" })).json()) as {
    id: string;
  };
  const projectB = (await (await postJson(h, "/api/hub/projects", { name: "B" })).json()) as {
    id: string;
  };
  const pinned = await postJson(h, `/api/hub/projects/${projectA.id}/files`, {
    filename: "a.md",
    content: "A's content",
  });
  const file = (await pinned.json()) as { id: string };

  const crossRead = await fetch(`${h.baseUrl}/api/hub/projects/${projectB.id}/files/${file.id}`);
  assert.equal(crossRead.status, 404);

  const crossDelete = await fetch(`${h.baseUrl}/api/hub/projects/${projectB.id}/files/${file.id}`, {
    method: "DELETE",
  });
  assert.equal(crossDelete.status, 404);
});

test("project pinned files: an empty filename/content 400s (schema validation)", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const project = (await (await postJson(h, "/api/hub/projects", { name: "Research" })).json()) as {
    id: string;
  };
  const bad = await postJson(h, `/api/hub/projects/${project.id}/files`, {
    filename: "",
    content: "x",
  });
  assert.equal(bad.status, 400);
});

// ── Session CRUD + replay detail ─────────────────────────────────────────────────────────────────

test("session CRUD: create, replay detail, list filter, patch, delete", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });

  const session = await createSession(h, "gpt-4o");

  const detailRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`);
  assert.equal(detailRes.status, 200);
  const detail = (await detailRes.json()) as {
    session: { id: string; status: string };
    events: Frame[];
  };
  assert.equal(detail.session.id, session.id);
  assert.equal(detail.session.status, "pending");
  assert.deepEqual(detail.events, []);

  const listRes = await fetch(`${h.baseUrl}/api/hub/sessions?kind=chat`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as Array<{ id: string }>;
  assert.ok(list.some((s) => s.id === session.id));

  const patchRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Renamed" }),
  });
  assert.equal(patchRes.status, 200);
  assert.equal(((await patchRes.json()) as { title: string }).title, "Renamed");

  const delRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, { method: "DELETE" });
  assert.equal(delRes.status, 204);

  const getAfter = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`);
  assert.equal(getAfter.status, 404, "the deleted session's row is gone");
});

// ── WP1.4 (D-HUX4, P4) — the Sessions table's GET query params + archive PATCH ──────────────────────

test("GET /api/hub/sessions: topLevelOnly excludes a mission-agent child; the list-stats projection (turns/lastError/archived) rides along", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({
      "gpt-4o": { kind: "openai", model: () => textModel("Hi there.") },
    }),
  });

  const session = await createSession(h, "gpt-4o");
  await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hello" });
  await waitForEvent(h, session.id, (event) => event.type === "turn_done");

  const mission = h.repo.createMission({
    sessionId: session.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: { topology: "parallel", autonomy: "always_ask", agents: [] },
  });
  const agentChild = h.repo.createSession({
    mode: "mission",
    model: "gpt-4o",
    kind: "agent",
    parentSessionId: session.id,
    missionId: mission.id,
  });

  const unfiltered = (await (await fetch(`${h.baseUrl}/api/hub/sessions`)).json()) as Array<{
    id: string;
  }>;
  assert.ok(
    unfiltered.some((s) => s.id === agentChild.id),
    "the plain list (no topLevelOnly) still carries the agent child — unchanged for existing callers",
  );

  const topLevelRes = await fetch(`${h.baseUrl}/api/hub/sessions?topLevelOnly=true`);
  assert.equal(topLevelRes.status, 200);
  const topLevel = (await topLevelRes.json()) as Array<{
    id: string;
    turns: number;
    lastError?: string | null;
    archived: boolean;
  }>;
  assert.ok(
    !topLevel.some((s) => s.id === agentChild.id),
    "topLevelOnly=true excludes the agent child",
  );
  const row = topLevel.find((s) => s.id === session.id);
  assert.ok(row);
  assert.equal(row.turns, 1, "one settled user_message ⇒ turns:1");
  assert.equal(row.archived, false);
});

test("PATCH /api/hub/sessions/:id archives (and restores) a session — additive `archived` flag, no hard delete (P4); GET ...?includeArchived toggles it in/out of the list", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await createSession(h, "gpt-4o");

  const archiveRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived: true }),
  });
  assert.equal(archiveRes.status, 200);
  assert.equal(((await archiveRes.json()) as { archived: boolean }).archived, true);

  const excluded = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions?topLevelOnly=true&includeArchived=false`)
  ).json()) as Array<{ id: string }>;
  assert.ok(
    !excluded.some((s) => s.id === session.id),
    "includeArchived=false hides the archived row",
  );

  const included = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions?topLevelOnly=true&includeArchived=true`)
  ).json()) as Array<{ id: string; archived: boolean }>;
  const archivedRow = included.find((s) => s.id === session.id);
  assert.ok(archivedRow, "includeArchived=true shows the archived row");
  assert.equal(archivedRow?.archived, true);

  // Still fully addressable (soft-hide, not deleted) — the detail route 404s only on a REAL delete.
  const detailRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`);
  assert.equal(detailRes.status, 200);

  const restoreRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived: false }),
  });
  assert.equal(((await restoreRes.json()) as { archived: boolean }).archived, false);
  const restoredList = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions?topLevelOnly=true&includeArchived=false`)
  ).json()) as Array<{ id: string }>;
  assert.ok(
    restoredList.some((s) => s.id === session.id),
    "restored session is visible again by default",
  );
});

// ── hub-fixes WP6.2 (RC7) — `mode` PATCH + the running-mission guard ───────────────────────────────

test("PATCH /api/hub/sessions/:id switches `mode` (additive field) and persists it; auto<->chat<->research swaps freely", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await createSession(h, "gpt-4o"); // created as "chat" (createSession's helper)

  const toResearch = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "research" }),
  });
  assert.equal(toResearch.status, 200);
  assert.equal(((await toResearch.json()) as { mode: string }).mode, "research");

  const toAuto = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "auto" }),
  });
  assert.equal(toAuto.status, 200);
  assert.equal(((await toAuto.json()) as { mode: string }).mode, "auto");

  // A fresh GET (a re-render's data source, not just the PATCH response) reflects the switch.
  const detail = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`)
  ).json()) as { session: { mode: string } };
  assert.equal(detail.session.mode, "auto", "the switch persisted");
});

test("PATCH /api/hub/sessions/:id refuses a mission<->auto mode swap while the session's mission is still in flight (409, both directions); allowed once the mission is terminal", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const plan = { topology: "parallel" as const, autonomy: "always_ask" as const, agents: [] };

  // mission -> auto: blocked while the mission is running, allowed once it settles.
  const missionSession = h.repo.createSession({ mode: "mission", model: "gpt-4o" });
  const mission = h.repo.createMission({
    sessionId: missionSession.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan,
  });
  h.repo.updateMission(mission.id, { status: "running" });

  const blocked = await fetch(`${h.baseUrl}/api/hub/sessions/${missionSession.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "auto" }),
  });
  assert.equal(blocked.status, 409, "mission -> auto is refused while the mission is running");
  assert.match(((await blocked.json()) as { error: string }).error, /mission/i);

  const stillMission = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions/${missionSession.id}`)
  ).json()) as { session: { mode: string } };
  assert.equal(stillMission.session.mode, "mission", "the blocked PATCH left mode untouched");

  h.repo.updateMission(mission.id, { status: "completed", endedAt: new Date().toISOString() });
  const allowed = await fetch(`${h.baseUrl}/api/hub/sessions/${missionSession.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "auto" }),
  });
  assert.equal(allowed.status, 200, "mission -> auto succeeds once the mission is terminal");
  assert.equal(((await allowed.json()) as { mode: string }).mode, "auto");

  // auto -> mission: the SAME guard, the other direction — a top-level `auto` session with a LIVE
  // mission of its own (exactly the shape hub-fixes WP6.1's auto-routing produces).
  const autoSession = h.repo.createSession({ mode: "auto", model: "gpt-4o" });
  const autoMission = h.repo.createMission({
    sessionId: autoSession.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan,
  });
  h.repo.updateMission(autoMission.id, { status: "synthesizing" });
  const blockedReverse = await fetch(`${h.baseUrl}/api/hub/sessions/${autoSession.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "mission" }),
  });
  assert.equal(
    blockedReverse.status,
    409,
    "auto -> mission is refused the same way while ITS mission is in flight",
  );

  h.repo.updateMission(autoMission.id, { status: "failed", endedAt: new Date().toISOString() });
  const allowedReverse = await fetch(`${h.baseUrl}/api/hub/sessions/${autoSession.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "mission" }),
  });
  assert.equal(allowedReverse.status, 200, "auto -> mission succeeds once ITS mission is terminal");
});

test("PATCH /api/hub/sessions/:id: an unrecognized `mode` value 400s (schema validation, not a silent no-op)", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await createSession(h, "gpt-4o");
  const bad = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "not-a-real-mode" }),
  });
  assert.equal(bad.status, 400);
});

// ── 409 when no provider credential exists ──────────────────────────────────────────────────────

test("409 when no provider credential exists — both session create and message dispatch refuse", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}), seedProvider: false });

  const createRes = await postJson(h, "/api/hub/sessions", { mode: "chat", model: "gpt-4o" });
  assert.equal(createRes.status, 409);
  assert.match(((await createRes.json()) as { error: string }).error, /not configured/i);

  // Seed a session directly through the repository (bypassing the create-route gate) to prove the
  // MESSAGE route gates independently too.
  const session = h.repo.createSession({ mode: "chat", model: "gpt-4o" });
  const msgRes = await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  assert.equal(msgRes.status, 409);
});

// ── POST .../messages dispatches; a live SSE subscriber sees it end-to-end, in order ───────────────

test("POST .../messages dispatches a turn (202 + streamUrl); a live SSE subscriber sees it end-to-end", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({
      "gpt-4o": { kind: "openai", model: () => textModel("Hello there.") },
    }),
  });
  const session = await createSession(h, "gpt-4o");

  // Open + fully connect the stream BEFORE dispatching — the replay+subscribe are one synchronous block
  // server-side (no `await` between them), so once `fetch()` resolves the live subscription is already
  // registered (see routes.ts's `streamHubSession` doc).
  const reader = await openHubStream(h, session.id);
  const framesPromise = pumpFrames(reader, (frame) => frame.type === "turn_done");

  const dispatchRes = await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  assert.equal(dispatchRes.status, 202, "POST returns immediately (async kickoff)");
  const dispatchBody = (await dispatchRes.json()) as { sessionId: string; streamUrl: string };
  assert.equal(dispatchBody.sessionId, session.id);
  assert.equal(dispatchBody.streamUrl, `/api/hub/sessions/${session.id}/stream`);

  const frames = await framesPromise;
  const types = frames.map((f) => f.type);
  assert.ok(types.includes("user_message"), "the user message streamed live");
  assert.ok(types.includes("assistant_message"), "the settled assistant message streamed live");
  assert.equal(types.at(-1), "turn_done", "the stream ends on turn_done");

  const idxUser = types.indexOf("user_message");
  const idxAssistant = types.indexOf("assistant_message");
  const idxDone = types.indexOf("turn_done");
  assert.ok(idxUser < idxAssistant && idxAssistant < idxDone, "events are ordered");

  // WP1.2's Unified-Sessions SSE contract: every seq-carrying frame's `id:` line matches its own seq.
  for (const frame of frames) {
    if (frame.seq !== undefined) assert.equal(frame.__sseId, String(frame.seq));
  }
});

// ── SSE replay: a fresh connect after the turn settled still gets the full history ─────────────────

test("SSE replay: a fresh connect after the turn settled gets the full persisted history", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Bonjour.") } }),
  });
  const session = await createSession(h, "gpt-4o");
  await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  await waitForEvent(h, session.id, (e) => e.type === "turn_done");

  const reader = await openHubStream(h, session.id);
  const frames = await pumpFrames(reader, (frame) => frame.type === "turn_done");
  const types = frames.map((f) => f.type);
  assert.ok(types.includes("user_message"));
  assert.ok(types.includes("assistant_message"));
  assert.equal(types.at(-1), "turn_done");
});

// ── SSE Last-Event-ID resume: exactly the un-seen tail, no dupes ───────────────────────────────────

test("SSE: reconnect with Last-Event-ID resumes past the cursor exactly once (no dupes)", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Bonjour.") } }),
  });
  const session = await createSession(h, "gpt-4o");
  await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  await waitForEvent(h, session.id, (e) => e.type === "turn_done");

  const first = await pumpFrames(await openHubStream(h, session.id), (f) => f.type === "turn_done");
  const userMsg = first.find((f) => f.type === "user_message");
  assert.ok(userMsg && typeof userMsg.seq === "number", "captured a resume cursor");
  const cursor = userMsg!.seq as number;

  const resumed = await pumpFrames(
    await openHubStream(h, session.id, { "Last-Event-ID": String(cursor) }),
    (f) => f.type === "turn_done",
  );
  assert.ok(!resumed.some((f) => f.seq === cursor), "the already-seen cursor event is not re-sent");
  assert.ok(
    resumed.some((f) => f.type === "assistant_message"),
    "later events still arrive normally",
  );
  const seqs = resumed.map((f) => f.seq).filter((s): s is number => typeof s === "number");
  assert.ok(
    seqs.every((s) => s > cursor),
    "every resumed event's seq is strictly greater than the cursor",
  );
  assert.deepEqual(seqs, [...new Set(seqs)], "no duplicate seq values across the reconnect");
});

test('SSE: a {type:"ping"} heartbeat fires on the configured cadence and never carries an id:', async () => {
  setHubSseHeartbeatMsForTesting(30);
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await createSession(h, "gpt-4o");

  const reader = await openHubStream(h, session.id);
  const frames = await pumpFrames(reader, (frame) => frame.type === "ping", 3000);
  const ping = frames.find((f) => f.type === "ping");
  assert.ok(ping, "a ping frame arrived within the shortened heartbeat window");
  assert.equal(ping?.seq, undefined, "a ping carries no seq");
  assert.equal(ping?.__sseId, undefined, "a ping never carries an id: line");
});

// ── Startup orphan reconciliation ───────────────────────────────────────────────────────────────────

test("reconcileOrphanHubSessions aborts a session left running at boot with a settled error event", () => {
  const db = openDb();
  const repo = new HubRepository(db);
  const running = repo.createSession({ mode: "chat", model: "gpt-4o" });
  repo.setSessionLifecycle(running.id, { status: "running", phase: "starting" });
  const idle = repo.createSession({ mode: "chat", model: "gpt-4o" }); // left pending — must be untouched

  const count = reconcileOrphanHubSessions(repo);
  assert.equal(count, 1);

  const reconciled = repo.getSession(running.id);
  assert.equal(reconciled.status, "aborted");
  // The repository's row→wire mapping normalizes a NULL `phase` column to `undefined` (not `null`) —
  // see `HubRepository`'s `toSession` (`phase: (row.phase ?? undefined)`).
  assert.equal(reconciled.phase, undefined);
  const events = repo.listEvents(running.id);
  assert.ok(
    events.some((e) => e.type === "error" && e.message.toLowerCase().includes("restart")),
    "a settled error event explains the reconciliation",
  );

  assert.equal(repo.getSession(idle.id).status, "pending", "a non-running session is left alone");

  // Idempotent: a second pass finds nothing left to reconcile.
  assert.equal(reconcileOrphanHubSessions(repo), 0);
});

// WP4.3 — mission-level orphan reconciliation. A plain session-status sweep alone misses two real
// gaps: (1) an `approved` mission whose agent children were spawned (status `pending`) but never
// reached `running` before the crash, and (2) a `synthesizing` mission whose agents ALL already
// settled — nothing there is `running` at all, only the mission row itself is stuck.
test("reconcileOrphanHubMissions fails a mission left approved/running/synthesizing, aborting any non-terminal agent child (incl. still-pending ones)", () => {
  const db = openDb();
  const repo = new HubRepository(db);
  const plan = { topology: "parallel" as const, autonomy: "always_ask" as const, agents: [] };

  // Case 1: `approved`, with a spawned-but-never-started (`pending`) child and a mid-flight (`running`)
  // child — both must be aborted; the mission itself becomes `failed`.
  const root1 = repo.createSession({ mode: "mission", model: "gpt-4o" });
  const mission1 = repo.createMission({
    sessionId: root1.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan,
  });
  repo.updateMission(mission1.id, { status: "approved" });
  const pendingChild = repo.createSession({
    mode: "chat",
    model: "gpt-4o",
    kind: "agent",
    parentSessionId: root1.id,
    missionId: mission1.id,
  });
  const runningChild = repo.createSession({
    mode: "chat",
    model: "gpt-4o",
    kind: "agent",
    parentSessionId: root1.id,
    missionId: mission1.id,
  });
  repo.setSessionLifecycle(runningChild.id, { status: "running" });

  // Case 2: `synthesizing`, whose agents ALL already settled (`completed`) — no session-level orphan
  // at all; only the mission row is stuck.
  const root2 = repo.createSession({ mode: "mission", model: "gpt-4o" });
  const mission2 = repo.createMission({
    sessionId: root2.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan,
  });
  repo.updateMission(mission2.id, { status: "synthesizing" });
  const settledChild = repo.createSession({
    mode: "chat",
    model: "gpt-4o",
    kind: "agent",
    parentSessionId: root2.id,
    missionId: mission2.id,
  });
  repo.setSessionLifecycle(settledChild.id, { status: "completed" });

  // Control: a `proposed` mission is a genuine resting state (awaiting the operator's Approve) — never
  // touched. A `completed` mission is already terminal — never touched either.
  const root3 = repo.createSession({ mode: "mission", model: "gpt-4o" });
  const proposedMission = repo.createMission({
    sessionId: root3.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan,
  });
  const root4 = repo.createSession({ mode: "mission", model: "gpt-4o" });
  const completedMission = repo.createMission({
    sessionId: root4.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan,
  });
  repo.updateMission(completedMission.id, {
    status: "completed",
    endedAt: new Date().toISOString(),
  });

  const count = reconcileOrphanHubMissions(repo);
  assert.equal(count, 2, "exactly the approved + synthesizing missions are orphans");

  assert.equal(repo.getMission(mission1.id).status, "failed");
  assert.equal(repo.getMission(mission2.id).status, "failed");
  assert.equal(
    repo.getMission(proposedMission.id).status,
    "proposed",
    "a resting proposal is untouched",
  );
  assert.equal(
    repo.getMission(completedMission.id).status,
    "completed",
    "already-terminal is untouched",
  );

  assert.equal(
    repo.getSession(pendingChild.id).status,
    "aborted",
    "a never-started child is aborted",
  );
  assert.equal(repo.getSession(runningChild.id).status, "aborted", "a mid-flight child is aborted");
  assert.equal(
    repo.getSession(settledChild.id).status,
    "completed",
    "an already-settled child is left exactly as it was",
  );

  for (const childId of [pendingChild.id, runningChild.id]) {
    const events = repo.listEvents(childId);
    assert.ok(
      events.some((e) => e.type === "error" && e.message.toLowerCase().includes("restart")),
      `a settled error event explains ${childId}'s reconciliation`,
    );
  }
  const rootEvents = repo.listEvents(root1.id);
  assert.ok(
    rootEvents.some(
      (e) =>
        e.type === "error" &&
        e.message.toLowerCase().includes("mission") &&
        e.message.toLowerCase().includes("restart"),
    ),
    "the PARENT session log records why the mission was interrupted",
  );

  // Idempotent: a second pass finds nothing left to reconcile (both are now `failed`, a terminal status).
  assert.equal(reconcileOrphanHubMissions(repo), 0);
});

// ── createHubModelResolver / the provider-configured gate ──────────────────────────────────────────

test("hasHubProviderCredential / assertHubProviderConfigured reflect hub-eligible credentials only", () => {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providers = new ProviderRepository(db, secrets);

  assert.equal(hasHubProviderCredential(providers), false);
  assert.throws(
    () => assertHubProviderConfigured(providers),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 409,
  );

  const now = "2026-07-17T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-anthropic', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy"), now });
  assert.equal(hasHubProviderCredential(providers), true);
  assert.doesNotThrow(() => assertHubProviderConfigured(providers));
});

test("createHubModelResolver 409s with no hub-eligible credential", () => {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providers = new ProviderRepository(db, secrets);
  const resolveModel = createHubModelResolver(providers);
  assert.throws(
    () => resolveModel("claude-sonnet-4-6"),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 409,
  );
});

// REGRESSION LOCK (model-identity WP2.1): this is the UNPINNED path — no `providerCredentialId` is
// passed, so the historical name heuristic must behave exactly as it did before the WP. It is deliberately
// left byte-identical; the pinned path is proven by the three tests below it.
test("createHubModelResolver prefers a name-hinted credential kind and builds a real AI-SDK model", () => {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const now = "2026-07-17T00:00:00.000Z";
  for (const [id, kind] of [
    ["prov-openai", "openai"],
    ["prov-anthropic", "anthropic"],
  ] as const) {
    db.prepare(
      `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES (@id, @kind, @kind, NULL, @key, @now, @now)`,
    ).run({ id, kind, key: secrets.encryptText("dummy"), now });
  }
  const providers = new ProviderRepository(db, secrets);
  const resolveModel = createHubModelResolver(providers);

  const anthropicResolution = resolveModel("claude-sonnet-4-6");
  assert.equal(anthropicResolution.providerKind, "anthropic");
  assert.equal(typeof anthropicResolution.buildModel, "function");
  // Constructing the AI-SDK model object is pure/local (no network call until streamText runs it).
  assert.equal(typeof anthropicResolution.buildModel!(), "object");

  const openaiResolution = resolveModel("gpt-4o");
  assert.equal(openaiResolution.providerKind, "openai");
});

// ── model-identity WP2.1 (D-MI1) — the explicit `providerCredentialId` is AUTHORITATIVE ────────────────
//
// THE DEFECT THIS LOCKS: a Hub session created on an "Anthropic CLI" (`claude_subscription`) model ran on
// the metered Anthropic API key and failed with "your credit balance is too low". `inferHubModelKind`
// maps ANY id starting with `claude` to `"anthropic"`, and its return type (`HubAiSdkModelKind |
// undefined`) structurally EXCLUDES `claude_subscription` — so the resolver could never select the
// subscription, and `session-service.ts`'s subscription branch was dead code. Aggravating it: the
// subscription roster emits Anthropic's CANONICAL ids ON PURPOSE (`providers/subscription-models.ts`, so
// `resolvePrice`/`MODEL_CONTEXT_LIMITS` exact-key lookups keep working), so `claude-sonnet-5` names BOTH
// an `anthropic` API model and a `claude_subscription` one — the model name genuinely cannot decide.
//
// A `claude_subscription` credential is `authBroken` unless a subscription-auth resolver is wired (its
// only auth source is the signed-in Claude OAuth credential), so these tests inject a stub resolver —
// that is a sign-in stand-in, not a token: nothing is ever decrypted or logged here.
const SIGNED_IN_SUBSCRIPTION = { resolve: () => ({ token: "stub-subscription-token" }) };

/** The API key seeded below. Distinctive on purpose: every 409 message this file asserts on is checked
 *  for its absence, so a refusal can never start leaking credential material unnoticed. */
const SEEDED_API_KEY = "sk-hub-resolver-test-secret-value";

/** A db seeded with BOTH an `anthropic` API credential and a `claude_subscription` one — the exact
 *  ambiguity that makes the model name insufficient. Returns the repository plus both ids.
 *
 *  `signedIn: false` omits the subscription-auth resolver, which is exactly what makes the
 *  `claude_subscription` credential `authBroken` (its only auth source is the signed-in Claude OAuth). */
function seedAmbiguousClaudeCredentials(options: { signedIn?: boolean } = {}): {
  providers: ProviderRepository;
  anthropicId: string;
  subscriptionId: string;
} {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const now = "2026-07-27T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-anthropic', 'anthropic', 'Anthropic API', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText(SEEDED_API_KEY), now });
  // A subscription credential carries NO key of its own (D-CS7) — auth comes from the signed-in OAuth.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-subscription', 'claude_subscription', 'Anthropic CLI', NULL, NULL, @now, @now)`,
  ).run({ now });
  return {
    providers: new ProviderRepository(
      db,
      secrets,
      options.signedIn === false ? undefined : SIGNED_IN_SUBSCRIPTION,
    ),
    anthropicId: "prov-anthropic",
    subscriptionId: "prov-subscription",
  };
}

/** Assert a resolver call REFUSES with a real 409 (the module's `NO_PROVIDER_MESSAGE` posture) rather
 *  than returning a resolution, and hand the message back for content assertions. Returning at all is
 *  the failure mode D-MI9 exists to prevent — a silent re-pick onto some other credential. */
function expectResolverRefusal(call: () => unknown): string {
  let resolved: unknown;
  try {
    resolved = call();
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    assert.equal(
      err.statusCode,
      409,
      `expected a 409 refusal, got status ${String(err.statusCode)}`,
    );
    const message = err.message ?? "";
    assert.ok(
      !message.includes(SEEDED_API_KEY) && !message.includes("stub-subscription-token"),
      "a refusal message must never carry credential material",
    );
    return message;
  }
  assert.fail(
    `expected a 409 refusal, but the resolver silently re-picked: ${JSON.stringify(resolved)}`,
  );
}

test("createHubModelResolver: an explicit claude_subscription credential wins over the claude- name hint (no buildModel ⇒ the subscription executor runs the turn)", () => {
  const { providers, anthropicId, subscriptionId } = seedAmbiguousClaudeCredentials();
  const resolveModel = createHubModelResolver(providers);

  // THE FIX: pinned to the subscription, a canonical Anthropic model id resolves to the SUBSCRIPTION…
  const pinned = resolveModel("claude-sonnet-5", subscriptionId);
  assert.equal(
    pinned.providerKind,
    "claude_subscription",
    "the explicit credential is authoritative — the claude- name hint never runs",
  );
  assert.equal(
    pinned.buildModel,
    undefined,
    "no AI-SDK model builder: absence is what routes the turn to the subscription executor instead of the metered API key",
  );
  assert.equal(pinned.modelId, "claude-sonnet-5", "the model id is carried through unchanged");

  // …and pinned to the API credential, the SAME model id resolves to the metered API path.
  const apiPinned = resolveModel("claude-sonnet-5", anthropicId);
  assert.equal(apiPinned.providerKind, "anthropic");
  assert.equal(typeof apiPinned.buildModel, "function", "the API path still builds a real AI-SDK model");
  assert.equal(typeof apiPinned.buildModel!(), "object");
});

test("createHubModelResolver: with NO explicit credential the historical heuristic is unchanged — a claude- id still picks the anthropic API credential", () => {
  const { providers } = seedAmbiguousClaudeCredentials();
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const resolveModel = createHubModelResolver(providers, {
    warn: (context, message) => warnings.push({ context, message }),
  });

  const guessed = resolveModel("claude-sonnet-5");
  assert.equal(
    guessed.providerKind,
    "anthropic",
    "REGRESSION LOCK: an unpinned (pre-v55/legacy) row replays through the exact same heuristic as before",
  );
  assert.equal(typeof guessed.buildModel, "function");

  // The guess is now VISIBLE in the log instead of silent — and it never carries a secret.
  assert.equal(warnings.length, 1, "the heuristic path logs exactly one warning");
  assert.equal(warnings[0]?.context.modelId, "claude-sonnet-5");
  assert.equal(warnings[0]?.context.credentialId, "prov-anthropic");
  assert.equal(warnings[0]?.context.credentialKind, "anthropic");
  // model-identity WP2.2 (D-MI9) — the warning says WHICH heuristic branch fired, so a name-hint match
  // is distinguishable from the untyped first-eligible fallback below.
  assert.equal(warnings[0]?.context.heuristic, "name_hint_match");
  assert.equal(warnings[0]?.context.hintedKind, "anthropic");
  assert.ok(
    !JSON.stringify(warnings[0]).includes("stub-subscription-token") &&
      !JSON.stringify(warnings[0]).includes(SEEDED_API_KEY),
    "no decrypted credential material is ever logged",
  );
});

// model-identity WP2.2 (D-MI9) — the OTHER heuristic branch. `pool[0]` is the untyped fallback that made
// a subscription-only install "work by accident" (README §1), so it must be logged just as loudly as a
// hinted match — and distinguishably, or a wrong guess reads in the log like a deliberate one.
test("createHubModelResolver: the untyped first-eligible fallback warns too, and says so", () => {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const now = "2026-07-27T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-openai', 'openai', 'OpenAI', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText(SEEDED_API_KEY), now });
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const resolveModel = createHubModelResolver(new ProviderRepository(db, secrets), {
    warn: (context, message) => warnings.push({ context, message }),
  });

  // No name hint matches an `openai` credential — `inferHubModelKind` maps `claude-` to `anthropic`, and
  // there is none — so the resolver falls back to the first eligible credential.
  const guessed = resolveModel("claude-sonnet-5");
  assert.equal(guessed.providerKind, "openai", "REGRESSION LOCK: the fallback itself is unchanged");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.context.heuristic, "first_eligible");
  assert.equal(
    warnings[0]?.context.hintedKind,
    "anthropic",
    "the hint that found no match is recorded",
  );
  assert.equal(warnings[0]?.context.credentialId, "prov-openai");
  assert.match(String(warnings[0]?.message), /FIRST eligible credential/);

  // And a model id the heuristic has NO hint for at all still warns (hintedKind is explicitly null).
  const noHint = resolveModel("some-unknown-model");
  assert.equal(noHint.providerKind, "openai");
  const heuristicWarnings = warnings.filter((w) => w.context.heuristic !== undefined);
  assert.equal(heuristicWarnings.length, 2);
  assert.equal(heuristicWarnings[1]?.context.heuristic, "first_eligible");
  assert.equal(heuristicWarnings[1]?.context.hintedKind, null);
  // model-identity WP6.1 (F6) — `some-unknown-model` also has no known context window, which now warns
  // SEPARATELY (it used to be silent). See the dedicated test below.
  assert.equal(
    warnings.filter((w) => /context window/.test(w.message)).length,
    1,
    "the unknown-window warning is a distinct second signal, not folded into the heuristic one",
  );
});

// model-identity WP6.1 (F6 / D-MI11) — a model with NO known context window resolves to `0`, which
// DISABLES compaction (`hub/compaction.ts` gates on a positive window) and makes every context-usage
// surface meaningless. That was the owner's original secondary defect and it happened in total silence.
//
// It is the one half of D-MI11 no test can cover: the failure arrives when the SDK starts reporting an
// id that does not exist yet (`providers/subscription-models.ts` `mapModels` → `resolvedModel`), which
// never joins the static `ASSISTANT_DEFAULT_MODEL_ROSTER` the WP1.3 tests iterate. A runtime warning is
// what CAN name it — the first time it is actually resolved.
test("F6: resolving a model with no known context window warns loudly, naming the id (a known id does not)", () => {
  const { providers } = seedAmbiguousClaudeCredentials();
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const resolveModel = createHubModelResolver(providers, {
    warn: (context, message) => warnings.push({ context, message }),
  });

  const unknown = resolveModel("claude-not-a-real-model-9000", "prov-anthropic");
  assert.equal(unknown.contextWindow, 0, "the resolution itself is unchanged — still 0, still usable");
  const windowWarnings = warnings.filter((w) => /context window/.test(w.message));
  assert.equal(windowWarnings.length, 1, "…but it is no longer silent");
  assert.equal(windowWarnings[0]?.context.modelId, "claude-not-a-real-model-9000");
  assert.match(String(windowWarnings[0]?.message), /compaction is DISABLED/);
  assert.match(
    String(windowWarnings[0]?.message),
    /ROSTER_GAP_MODEL_CONTEXT_LIMITS/,
    "the warning says what to do about it, not just that something is wrong",
  );
  assert.ok(
    !JSON.stringify(windowWarnings[0]).includes(SEEDED_API_KEY),
    "and it never carries credential material",
  );

  // A known id (one of the roster-gap entries the owner's failing session needed) warns about nothing.
  warnings.length = 0;
  const known = resolveModel("claude-sonnet-5", "prov-anthropic");
  assert.ok(known.contextWindow > 0, "claude-sonnet-5 has a window (ROSTER_GAP_MODEL_CONTEXT_LIMITS)");
  assert.equal(warnings.length, 0, "an explicit pin on a known model is silent — no warning noise");
});

// ── model-identity WP2.2 (D-MI9) — fail honestly, never re-guess ───────────────────────────────────
//
// WP2.1 made an explicit pin authoritative but left the FAILURE case degrading to the name heuristic.
// That degrade is the original defect wearing a different hat: the operator pins the subscription, the
// pin turns out unusable, and the metered API key silently runs (and bills) the turn with nothing said.
// Every test below therefore asserts on a REFUSAL — and on `warnings.length === 0`, which is the direct
// evidence that the heuristic branch never executed rather than merely losing a race.
//
// Deliberate asymmetry, do not "fix" it: this is the REQUEST path (an id supplied on THIS call). The
// READ/replay path is the opposite by design — `ON DELETE SET NULL` (D-MI1/D-MI2) blanks a deleted
// credential on `hub_sessions`/`hub_agents` so a session replays through the heuristic instead of
// bricking, and `hub/usage.ts`'s resolver reports such a row as `unpinned`. Both behaviours are correct;
// they answer different questions.

test("createHubModelResolver: an UNKNOWN explicit credential 409s and never re-picks another one", () => {
  const { providers } = seedAmbiguousClaudeCredentials();
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const resolveModel = createHubModelResolver(providers, {
    warn: (context, message) => warnings.push({ context, message }),
  });

  // Pre-WP2.2 this returned `providerKind: "anthropic"` — the metered key, silently.
  const message = expectResolverRefusal(() =>
    resolveModel("claude-sonnet-5", "prov-does-not-exist"),
  );
  assert.match(
    message,
    /prov-does-not-exist/,
    "the refusal names the credential that was requested",
  );
  assert.match(message, /no longer exists/, "…and why it can't be used");
  assert.match(message, /claude-sonnet-5/, "…and for which model");
  assert.equal(
    warnings.length,
    0,
    "the heuristic branch never ran — a refusal is not a fallback with an error attached",
  );

  // The refusal is specific to the bad pin: a VALID pin on the same resolver still resolves (WP2.1).
  const stillWorks = resolveModel("claude-sonnet-5", "prov-subscription");
  assert.equal(stillWorks.providerKind, "claude_subscription");
  assert.equal(stillWorks.buildModel, undefined);
  assert.equal(warnings.length, 0, "and an explicit resolution never logs a guess");
});

test("createHubModelResolver: an AUTH-BROKEN explicit credential 409s instead of falling back to the metered key", () => {
  // Nobody signed in ⇒ the `claude_subscription` credential is auth-broken (its only auth source is the
  // signed-in Claude OAuth). This is the highest-stakes case: degrading here is EXACTLY the reported
  // defect — "Anthropic CLI" picked, `api.anthropic.com` billed, "your credit balance is too low".
  const { providers, subscriptionId } = seedAmbiguousClaudeCredentials({ signedIn: false });
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const resolveModel = createHubModelResolver(providers, {
    warn: (context, message) => warnings.push({ context, message }),
  });

  const message = expectResolverRefusal(() => resolveModel("claude-sonnet-5", subscriptionId));
  assert.match(
    message,
    /Anthropic CLI/,
    "the refusal names the credential the operator actually picked",
  );
  assert.match(message, /authentication is broken/);
  assert.equal(warnings.length, 0, "no heuristic warning — because no heuristic ran");

  // The co-resident metered credential is still perfectly usable when it is the one PINNED.
  const explicitApi = resolveModel("claude-sonnet-5", "prov-anthropic");
  assert.equal(explicitApi.providerKind, "anthropic");
  assert.equal(typeof explicitApi.buildModel, "function");
});

// ── model-identity WP2.2 (D-MI9) at the ROUTE — the level that actually matters ─────────────────────
//
// The three tests above prove the resolver refuses. They do NOT prove `POST /api/hub/sessions` refuses,
// and it did not: `HubSessionService.createSession` wrote the `hub_sessions` row BEFORE resolving, so an
// UNKNOWN pin died on the `provider_credential_id` foreign key (`db/database.ts` runs
// `PRAGMA foreign_keys = ON`). A better-sqlite3 constraint error carries `code`, not `statusCode`, and
// `index.ts`'s handler maps only `ZodError` → 400 before falling back to `statusCode ?? 500` — so the
// operator got a **500** and the resolver never ran. These tests exercise the ROUTE with the PRODUCTION
// resolver and additionally assert NO row is written, because "409 but an orphan session" is only half a
// fix. The FK is still there; it is now a backstop rather than the mechanism.

/** How many `hub_sessions` rows exist — the orphan check. */
function sessionRowCount(h: Harness): number {
  return (h.db.prepare("SELECT COUNT(*) AS n FROM hub_sessions").get() as { n: number }).n;
}

const nowIso = "2026-07-27T00:00:00.000Z";

test("POST /api/hub/sessions: an UNKNOWN providerCredentialId is a 409 (not a 500 from the FK) and writes no row", async () => {
  const h = await makeApp({ resolveModelFrom: (providers) => createHubModelResolver(providers) });

  const res = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-does-not-exist",
  });
  assert.equal(res.status, 409, "the FK used to make this a 500");
  const body = (await res.json()) as { error?: string };
  assert.match(String(body.error), /prov-does-not-exist/);
  assert.match(String(body.error), /no longer exists/);
  assert.equal(sessionRowCount(h), 0, "a refused create leaves no orphan hub_sessions row");
});

test("POST /api/hub/sessions: an authBroken pin is a 409 and writes no row", async () => {
  // No subscription-auth resolver is wired into the harness's ProviderRepository, so a
  // `claude_subscription` credential is auth-broken — the reported defect's exact shape, at the route.
  const h = await makeApp({
    seedCredentials: (db) => {
      db.prepare(
        `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
         VALUES ('prov-subscription', 'claude_subscription', 'Anthropic CLI', NULL, NULL, @now, @now)`,
      ).run({ now: nowIso });
    },
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });

  const res = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-subscription",
  });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(String(body.error), /Anthropic CLI/);
  assert.match(String(body.error), /authentication is broken/);
  assert.equal(
    sessionRowCount(h),
    0,
    "no session on the metered key behind the operator's back, and no orphan row",
  );
});

test("POST /api/hub/sessions: a VALID pin still creates the session and persists it (regression lock)", async () => {
  const h = await makeApp({ resolveModelFrom: (providers) => createHubModelResolver(providers) });

  const res = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-1",
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(created.providerCredentialId, "prov-1");
  assert.equal(sessionRowCount(h), 1);
  assert.equal(h.repo.getSession(created.id).providerCredentialId, "prov-1");
});

test("POST /api/hub/sessions: an ABSENT pin still creates via the heuristic, with the warn (historical-replay lock)", async () => {
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const h = await makeApp({
    resolveModelFrom: (providers) =>
      createHubModelResolver(providers, {
        warn: (context, message) => warnings.push({ context, message }),
      }),
  });

  const res = await postJson(h, "/api/hub/sessions", { mode: "chat", model: "claude-sonnet-5" });
  assert.equal(
    res.status,
    201,
    "an unpinned create is NOT an error — every pre-v55 row is unpinned",
  );
  const created = (await res.json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(created.providerCredentialId, null, "it reads back null, i.e. unpinned");
  assert.equal(sessionRowCount(h), 1);

  assert.equal(warnings.length, 1, "and the guess is visible in the log");
  assert.equal(warnings[0]?.context.credentialId, "prov-1");
  assert.equal(warnings[0]?.context.heuristic, "name_hint_match");
});

// ── model-identity WP2.2 (D-MI9) — the RE-PIN path (`PATCH /api/hub/sessions/:id`) ──────────────────
//
// `repository.updateSession` writes `provider_credential_id` straight through with NO resolver call, so
// before this WP a re-pin had two distinct holes: an unknown id died on the FK (a 500, the same defect as
// create), and a non-eligible or auth-broken id was persisted with NO error whatsoever — the failure only
// surfacing at the next turn. The silent-accept half is the worse one, and it is the exact class of
// mis-routing this workstream exists to close. WP1.1 put `providerCredentialId` on this schema as
// `.nullable()` precisely so re-pinning becomes possible (README §1 blast-radius row 2), so it has to be
// possible SAFELY.

/** The persisted pin, read straight from the column — proof a refused PATCH changed nothing. */
function persistedPin(h: Harness, sessionId: string): string | null {
  return (
    h.db
      .prepare("SELECT provider_credential_id AS pin FROM hub_sessions WHERE id = ?")
      .get(sessionId) as { pin: string | null }
  ).pin;
}

async function patchJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A harness on the PRODUCTION resolver with a session already pinned to the valid `prov-1`, plus
 *  whatever extra credentials the case needs. The starting pin is what each refusal must leave intact. */
async function makeRepinHarness(
  seedCredentials?: (db: AppDatabase, secrets: SecretStore) => void,
): Promise<{ h: Harness; sessionId: string }> {
  const h = await makeApp({
    ...(seedCredentials ? { seedCredentials } : {}),
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });
  const res = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-1",
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  assert.equal(persistedPin(h, id), "prov-1");
  return { h, sessionId: id };
}

test("PATCH /api/hub/sessions/:id: an UNKNOWN re-pin is a 409 (not a 500) and leaves the pin unchanged", async () => {
  const { h, sessionId } = await makeRepinHarness();

  const res = await patchJson(h, `/api/hub/sessions/${sessionId}`, {
    providerCredentialId: "prov-does-not-exist",
  });
  assert.equal(res.status, 409, "the FK used to make this a 500");
  assert.match(String(((await res.json()) as { error?: string }).error), /no longer exists/);
  assert.equal(persistedPin(h, sessionId), "prov-1", "the existing pin survives a refused re-pin");
});

test("PATCH /api/hub/sessions/:id: an authBroken re-pin is a 409 (it used to be silently persisted)", async () => {
  const { h, sessionId } = await makeRepinHarness((db) => {
    db.prepare(
      `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES ('prov-subscription', 'claude_subscription', 'Anthropic CLI', NULL, NULL, @now, @now)`,
    ).run({ now: nowIso });
  });

  const res = await patchJson(h, `/api/hub/sessions/${sessionId}`, {
    providerCredentialId: "prov-subscription",
  });
  assert.equal(res.status, 409);
  assert.match(
    String(((await res.json()) as { error?: string }).error),
    /authentication is broken/,
  );
  assert.equal(persistedPin(h, sessionId), "prov-1");
});

test("PATCH /api/hub/sessions/:id: a VALID re-pin is a 200 and persists the new credential", async () => {
  const { h, sessionId } = await makeRepinHarness((db, secrets) => {
    db.prepare(
      `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES ('prov-openai', 'openai', 'OpenAI', NULL, @key, @now, @now)`,
    ).run({ key: secrets.encryptText(SEEDED_API_KEY), now: nowIso });
  });

  const res = await patchJson(h, `/api/hub/sessions/${sessionId}`, {
    model: "gpt-4o",
    providerCredentialId: "prov-openai",
  });
  assert.equal(res.status, 200);
  const patched = (await res.json()) as { model: string; providerCredentialId?: string | null };
  assert.equal(patched.providerCredentialId, "prov-openai");
  assert.equal(patched.model, "gpt-4o", "model + pin can move together");
  assert.equal(persistedPin(h, sessionId), "prov-openai");
});

test("PATCH /api/hub/sessions/:id: an explicit null UNPINS (200) and a later resolve takes the heuristic", async () => {
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const h = await makeApp({
    resolveModelFrom: (providers) =>
      createHubModelResolver(providers, {
        warn: (context, message) => warnings.push({ context, message }),
      }),
  });
  const created = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-1",
  });
  const { id } = (await created.json()) as { id: string };
  assert.equal(warnings.length, 0, "a pinned create never guesses");

  // `null` is a real value (D-MI1's unpin), NOT an unusable credential — it must never 409.
  const res = await patchJson(h, `/api/hub/sessions/${id}`, { providerCredentialId: null });
  assert.equal(res.status, 200);
  assert.equal(
    ((await res.json()) as { providerCredentialId?: string | null }).providerCredentialId,
    null,
  );
  assert.equal(persistedPin(h, id), null, "the column is genuinely NULL, i.e. unpinned");

  // And the unpinned session now resolves through the heuristic — the observable that proves the unpin
  // took effect end to end, not just in the column.
  const res2 = await postJson(h, "/api/hub/sessions", { mode: "chat", model: "claude-sonnet-5" });
  assert.equal(res2.status, 201);
  assert.equal(warnings.length, 1, "the heuristic ran and said so");
  assert.equal(warnings[0]?.context.heuristic, "name_hint_match");
});

test("PATCH /api/hub/sessions/:id: a title-only patch does NOT trigger a credential check and leaves the pin alone", async () => {
  // The absent-field case. A broken credential exists in the store, but the patch never names one, so no
  // validation may run — turning an unrelated edit into a credential refusal would be its own defect.
  const { h, sessionId } = await makeRepinHarness((db) => {
    db.prepare(
      `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES ('prov-subscription', 'claude_subscription', 'Anthropic CLI', NULL, NULL, @now, @now)`,
    ).run({ now: nowIso });
  });

  const res = await patchJson(h, `/api/hub/sessions/${sessionId}`, { title: "Renamed" });
  assert.equal(res.status, 200);
  const patched = (await res.json()) as { title: string; providerCredentialId?: string | null };
  assert.equal(patched.title, "Renamed");
  assert.equal(patched.providerCredentialId, "prov-1", "absent ⇒ the pin is untouched");
  assert.equal(persistedPin(h, sessionId), "prov-1");
});

// ── model-identity WP2.2 (D-MI9) — the SAVED ROLE surface (`/api/hub/agents`) ───────────────────────
//
// `hub_agents.provider_credential_id` exists because of this workstream: WP2.1's migration v55 added it
// so README §1 blast-radius row 9 ("Saved agent default model … An agent cannot be bound to the
// subscription") could be closed. But `createAgentRole`/`updateAgentRole` wrote it with no resolver call,
// so the role library carried the SAME two failure modes as the session routes — an unknown id dying on
// the FK as a 500, and a non-eligible / auth-broken id persisted silently, only surfacing when a mission
// eventually tried to run that agent. The role shape is NOT the session shape: its model field is
// `defaultModel`, and on CREATE the pin is `.optional()` but not nullable (no `null` case to exempt).

/** The persisted role pin, straight from the column. */
function persistedRolePin(h: Harness, roleId: string): string | null {
  return (
    h.db
      .prepare("SELECT provider_credential_id AS pin FROM hub_agents WHERE id = ?")
      .get(roleId) as {
      pin: string | null;
    }
  ).pin;
}

function roleRowCount(h: Harness): number {
  return (h.db.prepare("SELECT COUNT(*) AS n FROM hub_agents").get() as { n: number }).n;
}

/** A minimal valid role body; `over` supplies the pin / model under test. */
function roleBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Researcher",
    systemPrompt: "Research things.",
    defaultModel: "claude-sonnet-5",
    target: "A question",
    expectedOutcome: "An answer",
    ...over,
  };
}

/** `prov-subscription` (auth-broken: no subscription-auth resolver is wired into the harness's
 *  ProviderRepository), alongside the default valid `prov-1`. */
function seedRefusableCredentials(db: AppDatabase, _secrets: SecretStore): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-subscription', 'claude_subscription', 'Anthropic CLI', NULL, NULL, @now, @now)`,
  ).run({ now: nowIso });
}

/** The reachable refusal reasons and the phrase each must surface — one vocabulary across all three
 *  surfaces (sessions create, sessions patch, roles), because there is one validator. (The validator's
 *  third reason, a non-hub-eligible KIND, has no reachable fixture: every live ProviderKind is
 *  hub-eligible today — see `hub-capabilities.test.ts`.) */
const REFUSALS = [
  { pin: "prov-does-not-exist", reason: "unknown", match: /no longer exists/ },
  { pin: "prov-subscription", reason: "auth-broken", match: /authentication is broken/ },
] as const;

test("POST /api/hub/agents: an unusable pin is a 409 for every reachable reason, and no role row is created", async () => {
  const h = await makeApp({
    seedCredentials: seedRefusableCredentials,
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });

  for (const { pin, reason, match } of REFUSALS) {
    const res = await postJson(h, "/api/hub/agents", roleBody({ providerCredentialId: pin }));
    assert.equal(res.status, 409, `${reason} pin ⇒ 409 (unknown used to be a 500 from the FK)`);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), match, `${reason} pin ⇒ the right reason`);
    assert.ok(!String(body.error).includes(SEEDED_API_KEY), "and no credential material");
  }
  assert.equal(roleRowCount(h), 0, "a refused create writes no hub_agents row");
});

test("POST /api/hub/agents: a valid pin creates the role and persists the credential", async () => {
  const h = await makeApp({ resolveModelFrom: (providers) => createHubModelResolver(providers) });

  const res = await postJson(h, "/api/hub/agents", roleBody({ providerCredentialId: "prov-1" }));
  assert.equal(res.status, 201);
  const role = (await res.json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(role.providerCredentialId, "prov-1");
  assert.equal(persistedRolePin(h, role.id), "prov-1");

  // An unpinned role is still perfectly legal (the field is optional) — this is the legacy/heuristic row.
  const unpinned = await postJson(h, "/api/hub/agents", roleBody({ name: "Unpinned" }));
  assert.equal(unpinned.status, 201);
  assert.equal(persistedRolePin(h, ((await unpinned.json()) as { id: string }).id), null);
});

test("PATCH /api/hub/agents/:id: an unusable re-pin is a 409 for every reachable reason and leaves the pin unchanged", async () => {
  const h = await makeApp({
    seedCredentials: seedRefusableCredentials,
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });
  const created = await postJson(
    h,
    "/api/hub/agents",
    roleBody({ providerCredentialId: "prov-1" }),
  );
  const { id } = (await created.json()) as { id: string };

  for (const { pin, reason, match } of REFUSALS) {
    const res = await patchJson(h, `/api/hub/agents/${id}`, { providerCredentialId: pin });
    assert.equal(res.status, 409, `${reason} re-pin ⇒ 409`);
    assert.match(String(((await res.json()) as { error?: string }).error), match);
    assert.equal(
      persistedRolePin(h, id),
      "prov-1",
      `${reason} re-pin left the existing pin intact (it used to be silently persisted)`,
    );
  }
});

test("PATCH /api/hub/agents/:id: valid re-pin persists, explicit null unpins, and a rename touches neither", async () => {
  const h = await makeApp({
    seedCredentials: (db, secrets) => {
      db.prepare(
        `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
         VALUES ('prov-openai', 'openai', 'OpenAI', NULL, @key, @now, @now)`,
      ).run({ key: secrets.encryptText(SEEDED_API_KEY), now: nowIso });
    },
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });
  const created = await postJson(
    h,
    "/api/hub/agents",
    roleBody({ providerCredentialId: "prov-1" }),
  );
  const { id } = (await created.json()) as { id: string };

  // Valid re-pin, moving `defaultModel` and the pin together (the post-patch pair is what's validated).
  const repin = await patchJson(h, `/api/hub/agents/${id}`, {
    defaultModel: "gpt-4o",
    providerCredentialId: "prov-openai",
  });
  assert.equal(repin.status, 200);
  const repinned = (await repin.json()) as {
    defaultModel: string;
    providerCredentialId?: string | null;
  };
  assert.equal(repinned.providerCredentialId, "prov-openai");
  assert.equal(repinned.defaultModel, "gpt-4o");
  assert.equal(persistedRolePin(h, id), "prov-openai");

  // Explicit `null` unpins (D-MI1) — a legitimate value, never a 409.
  const unpin = await patchJson(h, `/api/hub/agents/${id}`, { providerCredentialId: null });
  assert.equal(unpin.status, 200);
  assert.equal(persistedRolePin(h, id), null, "the column is genuinely NULL");

  // Absent field ⇒ no validation and no change. Re-pin first so there is something to leave alone.
  await patchJson(h, `/api/hub/agents/${id}`, { providerCredentialId: "prov-1" });
  const renamed = await patchJson(h, `/api/hub/agents/${id}`, { name: "Renamed" });
  assert.equal(renamed.status, 200, "a rename must not become a credential check");
  assert.equal(((await renamed.json()) as { name: string }).name, "Renamed");
  assert.equal(persistedRolePin(h, id), "prov-1", "absent ⇒ the pin is untouched");
});

// model-identity WP6.1 (F5) — CREW-MEMBER pins are a FIFTH write binding WP2.2's "exactly 4, all
// guarded" sweep missed. `POST/PATCH /api/hub/crews` called the repository bare, so a `acme_answers` or
// auth-broken member pin was accepted silently and an unknown one was not caught at all (members ride
// the `hub_crews.members_json` blob, which no foreign key protects). These are NEW tests: a route that
// never called the validator cannot be surfaced by mutating one.

/** A minimal, schema-valid crew body around one member. */
function crewBody(member: Record<string, unknown>): Record<string, unknown> {
  return { name: "Crew", topology: "parallel", members: [member] };
}

test("F5: POST /api/hub/crews 409s on an unusable MEMBER pin for every reachable reason, and writes no crew", async () => {
  const h = await makeApp({
    seedCredentials: seedRefusableCredentials,
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });
  const role = (await (
    await postJson(h, "/api/hub/agents", roleBody({}))
  ).json()) as { id: string };

  for (const { pin, reason, match } of REFUSALS) {
    const res = await postJson(
      h,
      "/api/hub/crews",
      crewBody({ agentId: role.id, model: "gpt-4o", providerCredentialId: pin }),
    );
    assert.equal(res.status, 409, `${reason} member pin ⇒ 409 (it used to be accepted, or a raw 500)`);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), match, `${reason} ⇒ the same vocabulary the agent routes use`);
    assert.ok(!String(body.error).includes(SEEDED_API_KEY), "and no credential material");
  }
  const crews = (await (await fetch(`${h.baseUrl}/api/hub/crews`)).json()) as unknown[];
  assert.equal(crews.length, 0, "a refused create writes no hub_crews row");
});

test("F5: PATCH /api/hub/crews/:id validates a members replacement; a rename validates nothing; a valid pin persists", async () => {
  const h = await makeApp({
    seedCredentials: seedRefusableCredentials,
    resolveModelFrom: (providers) => createHubModelResolver(providers),
  });
  const role = (await (
    await postJson(h, "/api/hub/agents", roleBody({}))
  ).json()) as { id: string };

  // A valid pin is accepted and round-trips (the guard refuses, it does not reject everything).
  const createRes = await postJson(
    h,
    "/api/hub/crews",
    crewBody({ agentId: role.id, providerCredentialId: "prov-1" }),
  );
  assert.equal(createRes.status, 201);
  const crew = (await createRes.json()) as {
    id: string;
    members: { providerCredentialId?: string }[];
  };
  assert.equal(crew.members[0]?.providerCredentialId, "prov-1");

  // A members REPLACEMENT is a fresh write of every pin in it ⇒ validated.
  const bad = await patchJson(h, `/api/hub/crews/${crew.id}`, {
    members: [{ agentId: role.id, providerCredentialId: "prov-subscription" }],
  });
  assert.equal(bad.status, 409);
  assert.match(String(((await bad.json()) as { error?: string }).error), /authentication is broken/);

  // A rename touches no members ⇒ nothing is validated (the agent PATCH's own convention).
  const renamed = await patchJson(h, `/api/hub/crews/${crew.id}`, { name: "Renamed" });
  assert.equal(renamed.status, 200, "a rename must not become a credential check");
  const after = (await (await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`)).json()) as {
    members: { providerCredentialId?: string }[];
  };
  assert.equal(after.members[0]?.providerCredentialId, "prov-1", "the pin survived untouched");
});

// ── model-identity WP4.4 — a refused pin on `POST .../messages` must not be a SILENT NO-OP ──────────
//
// The four surfaces above are all REQUEST/RESPONSE: the D-MI9 409 is the HTTP status, so the operator
// cannot miss it. `POST /api/hub/sessions/:id/messages` is not. It answers **202** and dispatches
// fire-and-forget into a `.catch(log.warn)`, and `dispatchMessage` awaited `resolveModel` BEFORE
// `acquireSlot`, before the `user_message` was persisted, and before any `sink.onEvent` — with no
// try/catch. So the one D-MI9 refusal an operator actually triggers by hand reached NOBODY: a 202,
// then nothing at all. Concretely it made WP4.3's limit-error "retry on the other auth source" button
// — whose entire job is to send a DIFFERENT `providerCredentialId` — do nothing when that credential
// was refused. A dead button is worse than an error.
//
// The fix keeps the 202 and mirrors the `@`-mention handoff catch a few lines away in the same method
// (`session-service.ts`, "so the client isn't left with a dangling, un-answered user message"): settle
// the turn over the SAME live sink as `error` + `turn_done`. These tests drive the REAL route with the
// PRODUCTION resolver, and assert on the persisted event log — i.e. what a reconnecting client replays.

/** A resolver that keeps the PRODUCTION refusal semantics (`createHubModelResolver`, incl. every D-MI9
 *  409) but swaps `buildModel` for an offline mock, so a test can prove BOTH halves in one harness: the
 *  refused send settles honestly, and a good send afterwards still runs a real turn. Only model
 *  CONSTRUCTION is stubbed — credential lookup, eligibility and `authBroken` are the shipped code. */
function productionResolverWithMockModel(providers: ProviderRepository): HubModelResolver {
  const production = createHubModelResolver(providers);
  return async (modelId, providerCredentialId) => {
    const resolution = await production(modelId, providerCredentialId);
    return { ...resolution, buildModel: () => textModel("mock reply") };
  };
}

/** The session's persisted events, newest last — what a reconnecting client replays. */
async function sessionEvents(h: Harness, sessionId: string): Promise<Frame[]> {
  const detail = (await (await fetch(`${h.baseUrl}/api/hub/sessions/${sessionId}`)).json()) as {
    events: Frame[];
  };
  return detail.events;
}

/** Send a message and wait for THIS turn to settle, then return the whole persisted log. Counts
 *  `turn_done`s rather than matching one, so a second send in the same session doesn't return
 *  instantly on the previous turn's terminal. */
async function sendAndSettle(
  h: Harness,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Frame[]> {
  const before = (await sessionEvents(h, sessionId)).filter((e) => e.type === "turn_done").length;
  const res = await postJson(h, `/api/hub/sessions/${sessionId}/messages`, body);
  assert.equal(res.status, 202, "the 202 contract is unchanged — WP4.4 changes what follows it");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const events = await sessionEvents(h, sessionId);
    if (events.filter((e) => e.type === "turn_done").length > before) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for turn ${before + 1} to settle on session ${sessionId}`);
}

for (const refusal of [
  {
    name: "UNKNOWN",
    pin: "prov-does-not-exist",
    seed: undefined,
    expect: /no longer exists/,
  },
  {
    name: "authBroken",
    pin: "prov-subscription",
    // No subscription-auth resolver is wired into the harness's ProviderRepository, so a
    // `claude_subscription` credential is auth-broken — the reported defect's exact shape.
    seed: (db: AppDatabase) => {
      db.prepare(
        `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
         VALUES ('prov-subscription', 'claude_subscription', 'Anthropic CLI', NULL, NULL, @now, @now)`,
      ).run({ now: nowIso });
    },
    expect: /authentication is broken/,
  },
] as const) {
  test(`POST .../messages: a ${refusal.name} per-message providerCredentialId surfaces over the SINK (202, then a real error — never silence)`, async () => {
    const h = await makeApp({
      ...(refusal.seed ? { seedCredentials: refusal.seed } : {}),
      resolveModelFrom: productionResolverWithMockModel,
    });
    const session = await createSession(h, "claude-sonnet-5");

    const events = await sendAndSettle(h, session.id, {
      text: "retry this on the other source",
      providerCredentialId: refusal.pin,
    });

    const error = events.find((e) => e.type === "error");
    assert.ok(error, "the refusal reached the client as an error event (pre-WP4.4: nothing at all)");
    assert.match(String(error?.message), refusal.expect, "and it carries the REAL D-MI9 reason");
    assert.ok(
      !String(error?.message).includes(SEEDED_API_KEY),
      "a refusal never leaks credential material",
    );
    assert.ok(
      events.some((e) => e.type === "turn_done"),
      "the turn SETTLED — the client is not left waiting on a turn that never started",
    );

    // No dangling user message: the failure happens before the `user_message` is persisted, unlike the
    // handoff path (which persists the ask first and therefore has one to settle).
    assert.equal(
      events.filter((e) => e.type === "user_message").length,
      0,
      "a refused send persists NO user_message",
    );

    // No slot was ever acquired (`acquireSlot` runs after the guard), so the session is left clean.
    const session_ = h.repo.getSession(session.id);
    assert.notEqual(session_.status, "running", "the session is not wedged in `running`");
    assert.equal(
      session_.stopReasonCode ?? null,
      null,
      "no STOP_REASON_CODES value was minted for a turn that never started (README §3)",
    );
    assert.ok(
      !events.some((e) => "stopReasonCode" in e && e.stopReasonCode),
      "and no emitted event carries one either",
    );

    // …and the NEXT send works, on the session's own (valid) credential — the refusal was per-message.
    const after = await sendAndSettle(h, session.id, { text: "ok, use the session's model" });
    assert.equal(
      after.filter((e) => e.type === "user_message").length,
      1,
      "the follow-up send is accepted (the refusal left nothing latched)",
    );
    assert.ok(
      after.some((e) => e.type === "assistant_message"),
      "and it produced a real assistant turn",
    );
  });
}

test("POST .../messages: a VALID per-message providerCredentialId still dispatches normally (regression lock)", async () => {
  const h = await makeApp({ resolveModelFrom: productionResolverWithMockModel });
  const session = await createSession(h, "claude-sonnet-5");

  const events = await sendAndSettle(h, session.id, {
    text: "run it on the pinned credential",
    providerCredentialId: "prov-1",
  });

  assert.ok(!events.some((e) => e.type === "error"), "a usable pin is not refused");
  assert.equal(events.filter((e) => e.type === "user_message").length, 1);
  assert.ok(events.some((e) => e.type === "assistant_message"), "the turn ran");
});

test("POST .../messages: an ABSENT providerCredentialId still dispatches via the heuristic (historical-replay lock)", async () => {
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const h = await makeApp({
    resolveModelFrom: (providers) => {
      const production = createHubModelResolver(providers, {
        warn: (context, message) => warnings.push({ context, message }),
      });
      return async (modelId, providerCredentialId) => ({
        ...(await production(modelId, providerCredentialId)),
        buildModel: () => textModel("mock reply"),
      });
    },
  });
  // Created WITHOUT a pin, exactly like every pre-v55 row, and sent without one.
  const session = await createSession(h, "claude-sonnet-5");
  const events = await sendAndSettle(h, session.id, { text: "legacy unpinned send" });

  assert.ok(!events.some((e) => e.type === "error"), "an unpinned send is NOT an error");
  assert.equal(events.filter((e) => e.type === "user_message").length, 1);
  assert.ok(events.some((e) => e.type === "assistant_message"));
  assert.equal(
    h.repo.getSession(session.id).providerCredentialId ?? null,
    null,
    "and it stayed unpinned — WP4.4 introduced no write-back",
  );
  // The heuristic ran (create + send), and is still merely LOGGED — never promoted to a refusal.
  assert.ok(warnings.length >= 1, "the guess stays visible in the log");
  assert.ok(
    warnings.every((w) => w.context.credentialId === "prov-1"),
    "…and resolves to the single eligible credential, as before",
  );
});

test("model-identity WP4.4 minted no STOP_REASON_CODES member (README §3 — the frozen terminal vocabulary)", () => {
  // A settled REFUSAL is not a terminal cause: the turn never started, so it has no stop reason. Adding
  // or repurposing one to represent it would corrupt every observability/auto-rating bucket that reads
  // them (`session-terminal.ts`). `session-terminal.test.ts` locks the cause→verdict table; this locks
  // the code list itself, which a non-terminal addition would otherwise slip past.
  assert.deepEqual(
    [...STOP_REASON_CODES],
    [
      "user_stop",
      "session_ended",
      "max_duration",
      "stalled",
      "wait_expired",
      "max_turns",
      "max_tokens",
      "max_context_tokens",
      "max_cost",
      "context_overflow",
      "provider_error",
      "auth",
      "rate_limit",
      "max_tool_calls",
    ],
  );
});

test("a hub session persists its providerCredentialId and reads it back; one created without it reads back null", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "claude-sonnet-5": { kind: "anthropic" } }),
  });
  // `makeApp` already seeded the hub-eligible `prov-1` credential, so the FK is satisfiable.
  const pinnedRes = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-1",
  });
  assert.equal(pinnedRes.status, 201);
  const pinned = (await pinnedRes.json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(
    pinned.providerCredentialId,
    "prov-1",
    "the create response already carries the pin (it round-trips through the hub_sessions column)",
  );
  const reread = (await (await fetch(`${h.baseUrl}/api/hub/sessions/${pinned.id}`)).json()) as {
    session: { providerCredentialId?: string | null };
  };
  assert.equal(reread.session.providerCredentialId, "prov-1", "and it survives a re-read");
  assert.equal(
    h.repo.getSession(pinned.id).providerCredentialId,
    "prov-1",
    "the repository read shape exposes it too",
  );

  // No pin ⇒ NULL ⇒ the legacy heuristic path, exactly like every pre-v55 row.
  const unpinnedRes = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
  });
  assert.equal(unpinnedRes.status, 201);
  const unpinned = (await unpinnedRes.json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(unpinned.providerCredentialId, null, "an unpinned session reads back null, not undefined");

  // PATCH re-pins (a mis-pinned session must be correctable) and `null` explicitly unpins.
  const patchRes = await fetch(`${h.baseUrl}/api/hub/sessions/${unpinned.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerCredentialId: "prov-1" }),
  });
  assert.equal(patchRes.status, 200);
  assert.equal(
    ((await patchRes.json()) as { providerCredentialId?: string | null }).providerCredentialId,
    "prov-1",
  );
  const unpinRes = await fetch(`${h.baseUrl}/api/hub/sessions/${unpinned.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerCredentialId: null }),
  });
  assert.equal(
    ((await unpinRes.json()) as { providerCredentialId?: string | null }).providerCredentialId,
    null,
    "an explicit null unpins back to the heuristic",
  );

  // ON DELETE SET NULL, NOT the Testing feature's RESTRICT: `hub_sessions` is a historical REPLAY table,
  // so RESTRICT would make a credential permanently undeletable once any session had used it. Deleting
  // it must therefore SUCCEED and degrade the pinned session to the legacy heuristic path.
  h.db.prepare("DELETE FROM provider_credentials WHERE id = 'prov-1'").run();
  assert.equal(
    h.repo.getSession(pinned.id).providerCredentialId,
    null,
    "deleting the credential is allowed and nulls the pin (the session's history survives)",
  );
});

// WP4.3 — capability-gating verification (D-US4 discipline): `google`/`openai_compatible`/`ollama` are
// hub model kinds exactly like `anthropic`/`openai` (D-AH4's `HUB_MODEL_KINDS`) — resolved, capability-
// manifested, and modeled through the SAME generic code paths, never a dedicated branch that could
// silently omit one. Each is exercised in its OWN isolated db (a single hub-eligible credential) so the
// resolver's pool-fallback — the actual path an unhinted `openai_compatible`/`ollama` model id takes,
// since `inferHubModelKind` only recognizes claude-/gpt-/gemini- prefixes — is what's really proven.
test("createHubModelResolver resolves google/openai_compatible/ollama credentials, each building a real AI-SDK model", () => {
  const now = "2026-07-17T00:00:00.000Z";

  // google — the "gemini-" name hint finds it directly even alongside a non-google credential.
  const googleDb = openDb();
  const googleSecrets = new SecretStore(crypto.randomBytes(32));
  for (const [id, kind] of [
    ["prov-google", "google"],
    ["prov-anthropic", "anthropic"],
  ] as const) {
    googleDb
      .prepare(
        `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
         VALUES (@id, @kind, @kind, NULL, @key, @now, @now)`,
      )
      .run({ id, kind, key: googleSecrets.encryptText("dummy"), now });
  }
  const resolveGoogle = createHubModelResolver(new ProviderRepository(googleDb, googleSecrets));
  const googleResolution = resolveGoogle("gemini-2.5-pro");
  assert.equal(googleResolution.providerKind, "google");
  assert.equal(typeof googleResolution.buildModel, "function");
  assert.equal(typeof googleResolution.buildModel!(), "object");

  // openai_compatible — requires an explicit base_url (`modelFor`'s `requireBaseUrl` gate); the model
  // id hints at NOTHING, so this proves the pool-fallback path, not a name match.
  const ocDb = openDb();
  const ocSecrets = new SecretStore(crypto.randomBytes(32));
  ocDb
    .prepare(
      `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES ('prov-oc', 'openai_compatible', 'Self-hosted', 'https://llm.example.com/v1', @key, @now, @now)`,
    )
    .run({ key: ocSecrets.encryptText("dummy"), now });
  const resolveOc = createHubModelResolver(new ProviderRepository(ocDb, ocSecrets));
  const ocResolution = resolveOc("mixtral-8x7b");
  assert.equal(ocResolution.providerKind, "openai_compatible");
  assert.equal(typeof ocResolution.buildModel!(), "object");

  // ollama — no base_url row needed (`modelFor` defaults to the local daemon endpoint); also proves
  // the pool-fallback path.
  const ollamaDb = openDb();
  const ollamaSecrets = new SecretStore(crypto.randomBytes(32));
  ollamaDb
    .prepare(
      `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES ('prov-ollama', 'ollama', 'Local', NULL, @key, @now, @now)`,
    )
    .run({ key: ollamaSecrets.encryptText("dummy"), now });
  const resolveOllama = createHubModelResolver(new ProviderRepository(ollamaDb, ollamaSecrets));
  const ollamaResolution = resolveOllama("llama3.1");
  assert.equal(ollamaResolution.providerKind, "ollama");
  assert.equal(typeof ollamaResolution.buildModel!(), "object");
});

// ── stop / seen / end lifecycle actions ─────────────────────────────────────────────────────────────

test("stop is an idempotent no-op when nothing is running; seen marks the session read; end terminates it", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await createSession(h, "gpt-4o");

  const stopRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/stop`, {
    method: "POST",
  });
  assert.equal(stopRes.status, 202);

  const seenRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/seen`, {
    method: "POST",
  });
  assert.equal(seenRes.status, 202);
  const afterSeen = (await (await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`)).json()) as {
    session: { seen: boolean };
  };
  assert.equal(afterSeen.session.seen, true);

  const endRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/end`, { method: "POST" });
  assert.equal(endRes.status, 200);
  const ended = (await endRes.json()) as { status: string; stopReasonCode?: string };
  assert.equal(ended.status, "ended");
  assert.equal(ended.stopReasonCode, "session_ended");

  const endAgain = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/end`, {
    method: "POST",
  });
  assert.equal(endAgain.status, 409, "ending an already-ended session is refused");
});

// `hub_sessions.status` is a PER-TURN disposition (runHubTurn sets it to `completed` after every normal
// turn — the session stays open for the next message). A session whose LAST turn merely `completed` is
// NOT itself "ended" — `/end` must still succeed for it (this is the bug the `session.status === "ended"`
// guard fixes over a naive `isTerminalStatus` check, which would wrongly 409 here).
test("end succeeds on a session whose last turn merely completed (status !== the session-level 'ended')", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Bonjour.") } }),
  });
  const session = await createSession(h, "gpt-4o");
  await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  await waitForEvent(h, session.id, (e) => e.type === "turn_done");

  const afterTurn = (await (await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`)).json()) as {
    session: { status: string };
  };
  assert.equal(
    afterTurn.session.status,
    "completed",
    "the turn's own status, not a session-level end",
  );

  const endRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/end`, { method: "POST" });
  assert.equal(
    endRes.status,
    200,
    "ending a session whose last turn completed normally must succeed",
  );
  assert.equal(((await endRes.json()) as { status: string }).status, "ended");
});

test("lifecycle routes 404 on an unknown session id (stop, seen, end, messages, stream)", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const missing = "does-not-exist";
  const stop = await fetch(`${h.baseUrl}/api/hub/sessions/${missing}/stop`, { method: "POST" });
  assert.equal(stop.status, 404);
  const seen = await fetch(`${h.baseUrl}/api/hub/sessions/${missing}/seen`, { method: "POST" });
  assert.equal(seen.status, 404);
  const end = await fetch(`${h.baseUrl}/api/hub/sessions/${missing}/end`, { method: "POST" });
  assert.equal(end.status, 404);
  const messages = await postJson(h, `/api/hub/sessions/${missing}/messages`, { text: "hi" });
  assert.equal(messages.status, 404);
  const stream = await fetch(`${h.baseUrl}/api/hub/sessions/${missing}/stream`);
  assert.equal(stream.status, 404, "the socket is never hijacked for an unknown session");
  const branch = await postJson(h, `/api/hub/sessions/${missing}/branch`, {});
  assert.equal(branch.status, 404);
});

// Deleting a session while its turn is still live must not crash the server — the in-flight turn's own
// eventual persistence writes against the now-gone row become harmless no-ops (swallowed + logged by the
// `POST .../messages` kickoff's `.catch`), and the app keeps serving other requests afterward.
test("deleting a session mid-turn does not crash the server (best-effort stop, swallowed background error)", async () => {
  let releaseStream: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });
  const hangingModel: LanguageModel = new MockLanguageModelV3({
    doStream: async () => {
      await gate;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "late" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  const h = await makeApp({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => hangingModel } }),
  });
  const session = await createSession(h, "gpt-4o");

  const dispatchRes = await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  assert.equal(dispatchRes.status, 202);

  const delRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`, { method: "DELETE" });
  assert.equal(delRes.status, 204, "the delete itself succeeds immediately (best-effort stop)");

  releaseStream?.(); // let the (now orphaned) turn actually finish resolving in the background
  await new Promise((resolve) => setTimeout(resolve, 50));

  // The server is still healthy — an unrelated request succeeds.
  const health = await fetch(`${h.baseUrl}/api/hub/projects`);
  assert.equal(health.status, 200);
});

// ── branch ───────────────────────────────────────────────────────────────────────────────────────

test("branch copies the conversational history into a new session and records branch_created on the source", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Bonjour.") } }),
  });
  const session = await createSession(h, "gpt-4o");
  await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "hi" });
  await waitForEvent(h, session.id, (e) => e.type === "turn_done");

  const branchRes = await postJson(h, `/api/hub/sessions/${session.id}/branch`, { label: "Fork" });
  assert.equal(branchRes.status, 201);
  const forked = (await branchRes.json()) as { id: string; title: string; capabilities?: unknown };
  assert.equal(forked.title, "Fork");
  assert.notEqual(forked.id, session.id);
  // Branched THROUGH `sessionService.createSession` (not a bare repository insert), so the new session's
  // capability manifest is resolved + persisted immediately (D-US4) instead of sitting null until its
  // first message.
  assert.ok(forked.capabilities, "the branched session's capability manifest is already populated");

  const forkedDetail = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions/${forked.id}`)
  ).json()) as {
    events: Frame[];
  };
  const forkedTypes = forkedDetail.events.map((e) => e.type);
  assert.ok(forkedTypes.includes("user_message"));
  assert.ok(forkedTypes.includes("assistant_message"));

  const sourceDetail = (await (
    await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}`)
  ).json()) as {
    events: Frame[];
  };
  assert.ok(
    sourceDetail.events.some((e) => e.type === "branch_created" && e.branchSessionId === forked.id),
    "the source session records the branch",
  );
});

// model-identity WP6.1 (F3) — the branch route omitted `source.providerCredentialId`, so every fork was
// UNPINNED. Regenerate is `branchHubSession(...)` → `sendHubMessage(forked.id, {text, model})`, which
// means a regenerated turn fell back to the NAME HEURISTIC (the metered key), not to the session pin the
// ledger claimed. A branch continues this conversation; it must run on the same credential.
test("F3: branch carries the source session's provider pin onto the fork; an unpinned source stays unpinned", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "claude-sonnet-5": { kind: "anthropic" } }),
  });
  const pinnedRes = await postJson(h, "/api/hub/sessions", {
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: "prov-1",
  });
  const pinned = (await pinnedRes.json()) as { id: string };

  const branchRes = await postJson(h, `/api/hub/sessions/${pinned.id}/branch`, {});
  assert.equal(branchRes.status, 201);
  const forked = (await branchRes.json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(
    forked.providerCredentialId,
    "prov-1",
    "the fork inherits the pin — without it, regenerate re-guesses the provider from the model name",
  );
  assert.equal(h.repo.getSession(forked.id).providerCredentialId, "prov-1", "and it is persisted");

  // An unpinned source still forks unpinned ⇒ the unchanged heuristic (no backfill, replay intact).
  const bare = await createSession(h, "claude-sonnet-5");
  const bareFork = (await (
    await postJson(h, `/api/hub/sessions/${bare.id}/branch`, {})
  ).json()) as { id: string; providerCredentialId?: string | null };
  assert.equal(bareFork.providerCredentialId, null, "an unpinned source forks unpinned");
});

// ── WP2.3 — live HITL decision routes + the autonomy dial ────────────────────────────────────────

test("PATCH .../autonomy sets the session's dial (D-AH6)", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "claude-3-5-sonnet": { kind: "anthropic" } }),
  });
  const session = await createSession(h, "claude-3-5-sonnet");
  const res = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/autonomy`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autonomy: "auto" }),
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as { autonomy?: string };
  assert.equal(updated.autonomy, "auto");
  // A bad value is rejected (the dial is a closed enum).
  const bad = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/autonomy`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autonomy: "yolo" }),
  });
  assert.equal(bad.status, 400);
});

// ── WP2.6 — the GenUI per-message ui-state route (R-GUI5 client-op persistence) ─────────────────────

test("POST .../ui-state appends a replay-rehydratable ui_state event (R-GUI5); 404 for an unknown session", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "claude-3-5-sonnet": { kind: "anthropic" } }),
  });
  const session = await createSession(h, "claude-3-5-sonnet");

  const res = await postJson(h, `/api/hub/sessions/${session.id}/ui-state`, {
    messageId: "m1",
    key: "w1",
    state: { forms: { classify: { values: { label: "bug" } } } },
  });
  assert.equal(res.status, 202);

  // The event is in the durable replay log, source "user", stamped with the spec version (R-SES1).
  const events = h.repo.listEvents(session.id);
  const uiState = events.find((e) => e.type === "ui_state");
  assert.ok(uiState, "a ui_state event was appended");
  if (uiState?.type === "ui_state") {
    assert.equal(uiState.messageId, "m1");
    assert.equal(uiState.key, "w1");
    assert.equal(uiState.source, "user");
    assert.deepEqual(uiState.state, { forms: { classify: { values: { label: "bug" } } } });
    assert.ok(uiState.specVersion, "spec version stamped");
  }

  // Unknown session → 404 (route guards before appending).
  const missing = await postJson(h, `/api/hub/sessions/does-not-exist/ui-state`, {
    messageId: "m1",
    state: {},
  });
  assert.equal(missing.status, 404);
});

test("POST .../approvals + .../elicitation 409 when nothing is pending (stale/duplicate decision)", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({ "claude-3-5-sonnet": { kind: "anthropic" } }),
  });
  const session = await createSession(h, "claude-3-5-sonnet");

  const approval = await postJson(h, `/api/hub/sessions/${session.id}/approvals`, {
    toolCallId: "tc-nope",
    resolution: "allow-once",
  });
  assert.equal(approval.status, 409);

  const elicit = await postJson(h, `/api/hub/sessions/${session.id}/elicitation`, {
    elicitationId: "el-nope",
    action: "accept",
    content: { branch: "main" },
  });
  assert.equal(elicit.status, 409);

  // Unknown session id → 404 (checked before the decision).
  const missing = await postJson(h, "/api/hub/sessions/does-not-exist/approvals", {
    toolCallId: "tc-1",
    resolution: "deny",
  });
  assert.equal(missing.status, 404);
});

test("POST .../steer 404s when missions are not enabled (no missionService wired)", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const res = await postJson(h, "/api/hub/missions/mis-1/agents/agent-1/steer", {
    text: "focus on X",
  });
  assert.equal(res.status, 404);
});

// ── hub-fixes WP1.3 (RC3.4) — POST /api/hub/servers/:id/reconnect ───────────────────────────────────

test("POST /api/hub/servers/:id/reconnect calls the injected evict callback with the server id and 202s", async () => {
  const evicted: string[] = [];
  const h = await makeApp({
    resolveModel: resolverFor({}),
    evictHubMcpSession: (serverId) => {
      evicted.push(serverId);
    },
  });

  const res = await postJson(h, "/api/hub/servers/srv-acme/reconnect", {});
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(evicted, ["srv-acme"], "the route forwarded the path serverId to the evict callback");
});

test("POST /api/hub/servers/:id/reconnect awaits an async evict callback before responding", async () => {
  let resolved = false;
  const h = await makeApp({
    resolveModel: resolverFor({}),
    evictHubMcpSession: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      resolved = true;
    },
  });

  const res = await postJson(h, "/api/hub/servers/srv-acme/reconnect", {});
  assert.equal(res.status, 202);
  assert.equal(resolved, true, "the response only sent after the async evict settled");
});

test("POST /api/hub/servers/:id/reconnect is NOT mounted (404) when evictHubMcpSession isn't wired", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const res = await postJson(h, "/api/hub/servers/srv-acme/reconnect", {});
  assert.equal(res.status, 404);
});

// ── Interactive ask_user answer route + full-transcript export ─────────────────────────────────────

test("POST .../answers 404s an unknown session and 409s when no question is pending", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const unknown = await postJson(h, "/api/hub/sessions/nope/answers", {
    questionId: "q1",
    answer: "x",
  });
  assert.equal(unknown.status, 404, "unknown session 404s");

  const session = await createSession(h, "gpt-4o");
  const stale = await postJson(h, `/api/hub/sessions/${session.id}/answers`, {
    questionId: "q1",
    answer: "x",
  });
  assert.equal(stale.status, 409, "no question pending → 409 (stale/duplicate answer)");
});

test("POST .../answers validates the body (empty answer 400s)", async () => {
  const h = await makeApp({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await createSession(h, "gpt-4o");
  const bad = await postJson(h, `/api/hub/sessions/${session.id}/answers`, {
    questionId: "q1",
    answer: "",
  });
  assert.equal(bad.status, 400, "empty answer fails schema validation");
});

test("GET .../report/{markdown,json} exports the full ordered transcript", async () => {
  const h = await makeApp({
    resolveModel: resolverFor({
      "gpt-4o": { kind: "openai", model: () => textModel("Your top 3 RMs are A, B, C.") },
    }),
  });
  const session = await createSession(h, "gpt-4o");
  await postJson(h, `/api/hub/sessions/${session.id}/messages`, { text: "who are my top 3 RMs?" });
  await waitForEvent(h, session.id, (e) => e.type === "turn_done");

  const mdRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/report/markdown`);
  assert.equal(mdRes.status, 200);
  assert.match(mdRes.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(mdRes.headers.get("content-disposition") ?? "", /attachment; filename="hub-session-/);
  const md = await mdRes.text();
  assert.match(md, /# Assistant session transcript/);
  assert.match(md, /who are my top 3 RMs\?/, "the user input is in the transcript");
  assert.match(md, /Your top 3 RMs are A, B, C\./, "the assistant output is in the transcript");
  assert.ok(md.indexOf("who are my top 3 RMs?") < md.indexOf("Your top 3 RMs are A, B, C."), "in order");

  const jsonRes = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/report/json`);
  assert.equal(jsonRes.status, 200);
  const report = (await jsonRes.json()) as { kind: string; events: { type: string }[] };
  assert.equal(report.kind, "hub_session_report");
  const types = report.events.map((e) => e.type);
  assert.ok(types.includes("user_message") && types.includes("assistant_message"));
});

test("GET .../report/markdown 404s an unknown session", async () => {
  const h = await makeApp({ resolveModel: resolverFor({}) });
  const res = await fetch(`${h.baseUrl}/api/hub/sessions/nope/report/markdown`);
  assert.equal(res.status, 404);
});
