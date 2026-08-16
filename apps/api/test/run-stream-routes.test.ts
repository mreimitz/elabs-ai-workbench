import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { NormalizedToolDefinition, RunEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { GradeService } from "../src/grading/grade-service.js";
import type { McpSession } from "../src/mcp/client.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { registerTestingRoutes, setSseHeartbeatMsForTesting } from "../src/testing/routes.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as agent-loop.test.ts / run-persistence.test.ts — no extra dependency, always matches the SDK).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

// ── Test doubles: a mock model + a stub MCP session, so NO provider/MCP key is ever needed ───────

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[], chunkDelayInMs: number | null = null) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs }) };
}

/** A run that calls one tool, then answers (two provider round-trips). Used for the happy path. */
function mockToolThenAnswer() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "alpha",
            input: JSON.stringify({ x: 1 }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Final answer." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

/**
 * A two-turn model that calls one tool (turn 1, fast → opening events land in the bounded buffer
 * immediately), then STALLS before the final answer (turn 2, slow chunks). The stall keeps the run
 * provably LIVE long enough for a late subscriber to attach while `isActive(runId)` is still true and
 * be backfilled from the in-memory bounded buffer (NOT the persisted-replay fallback). Mirrors
 * `mockToolThenAnswer` but with `chunkDelayInMs` on the second turn.
 */
function mockToolThenSlowAnswer() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "alpha",
            input: JSON.stringify({ x: 1 }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      return streamOf(
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Final" },
          { type: "text-delta", id: "t1", delta: " answer." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ],
        120, // 120ms between chunks on the answer turn → the run is still active well after subscribe
      );
    },
  });
}

/** A slow single-turn model so the run is still LIVE while the test posts `/stop`. */
function mockSlowAnswer() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf(
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "thinking" },
          { type: "text-delta", id: "t1", delta: " slowly" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ],
        200, // 200ms between chunks → plenty of time to abort mid-stream
      ),
  });
}

/** An interactive model: every turn answers with text then stops, so the loop awaits the next turn. */
function mockEchoEachTurn() {
  let turn = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      turn += 1;
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: `t${turn}` },
        { type: "text-delta", id: `t${turn}`, delta: `answer-${turn}` },
        { type: "text-end", id: `t${turn}` },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

/** A stub session that records whether `close()` was called (to prove session teardown). */
function trackingSession(closed: { value: boolean }): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => {
      closed.value = true;
    },
  };
}

const TOOL_DEFS: NormalizedToolDefinition[] = [
  { name: "alpha", description: "Alpha tool", inputSchema: { type: "object" }, raw: {} },
];

// ── App harness: real Fastify app over an in-memory DB; model + MCP session INJECTED ─────────────

type Harness = {
  app: FastifyInstance;
  baseUrl: string;
  testId: string;
  scenarioId: string;
  /** The live RunService — exposed so a test can assert `isActive(runId)` at subscribe time. */
  runService: RunService;
  /** The live RunManager — exposed so a test can assert the emitter's listener count after disconnect. */
  runManager: RunManager;
  /** The backing DB — exposed so the AR11 replay-synthesis test can rewind a persisted log. */
  db: AppDatabase;
};

const harnesses: Harness[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.app.close();
  for (const db of databases.splice(0)) db.close();
  // WP2.1 — always restore the true production heartbeat cadence, whether or not the just-finished
  // test touched it (a couple of the WP2.1 tests below shrink it to observe a ping without a real 15s
  // wait; every other test, and every production deployment, must see the real default).
  setSseHeartbeatMsForTesting(15_000);
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

async function makeApp(
  model: MockLanguageModelV3,
  sessionFactory: () => McpSession = stubSession,
  /**
   * AR11 — an optional injected grade service so the rating-axis tests can drive `rating` → `rated`
   * (a stub succeeding/throwing gradeRun; production wires the real GradeService). Absent (every
   * pre-existing test) → auto-rating is not active and the review settles `skipped`.
   */
  grades?: GradeService,
): Promise<Harness> {
  const db = createDatabase();
  // A real SecretStore with a throwaway key so getDecrypted round-trips a DUMMY api key (the injected
  // model never uses it; no real provider key exists).
  const secrets = new SecretStore(crypto.randomBytes(32));

  // Seed provider + server + a scan with the `alpha` tool, then a scenario allow-listing it + a test.
  const now = "2026-06-20T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now });
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'Stub', 'stdio', 'noop', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ now });

  const scans = new ScanRepository(db);
  const scan = scans.createRunningScan("srv-1", "generic_o200k");
  scans.completeScan(
    scan.id,
    {
      totalTools: 1,
      totalTokens: 0,
      totalRawBytes: 0,
      averageTokensPerTool: 0,
      largestToolName: "alpha",
      largestToolTokens: 0,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    TOOL_DEFS.map((def) => ({
      toolName: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: undefined,
      rawTool: def.raw,
      totalTokens: 0,
      nameTokens: 0,
      descriptionTokens: 0,
      schemaTokens: 0,
      annotationsTokens: 0,
      rawBytes: 0,
      contributionPercent: 0,
    })),
  );

  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans);
  const testRepo = new TestRepository(db);
  const testService = new TestService(testRepo);

  const scenario = scenarioRepo.create({
    name: "Baseline",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [{ serverId: "srv-1", allowedTools: ["alpha"] }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  const testRow = testService.create({
    name: "List files",
    userPrompt: "Use the tools, then answer.",
    systemPromptOverride: undefined,
    addedProfiles: [],
  });

  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => model;
  const sessionOpener: SessionOpener = async () => sessionFactory();
  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runRepo,
    modelFactory,
    sessionOpener,
    undefined, // skills — not exercised here
    grades, // AR11 — optional injected grade service (rating-axis tests)
  );

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerTestingRoutes(app, scenarioService, testService, runService, runRepo, runManager);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const harness: Harness = {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    testId: testRow.id,
    scenarioId: scenario.id,
    runService,
    runManager,
    db,
  };
  harnesses.push(harness);
  return harness;
}

// ── SSE client: read the stream and collect parsed RunEvents until terminal (or aborted) ─────────

async function startRun(h: Harness, mode: "automated" | "interactive"): Promise<string> {
  const res = await fetch(`${h.baseUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ testId: h.testId, scenarioId: h.scenarioId, mode }),
  });
  assert.equal(res.status, 202, "POST /api/runs returns immediately (202, async kickoff)");
  const body = (await res.json()) as { runId: string; streamUrl: string };
  assert.ok(body.runId, "runId returned");
  assert.equal(
    body.streamUrl,
    `/api/runs/${body.runId}/stream`,
    "streamUrl points at the SSE route",
  );
  return body.runId;
}

/**
 * Open the SSE stream and collect ordered RunEvents until a terminal `status` (or the controller is
 * aborted). Invokes `onEvent` for each event so a test can react (e.g. post a turn / stop) live.
 */
async function readStream(
  h: Harness,
  runId: string,
  onEvent?: (event: RunEvent, all: RunEvent[]) => void | Promise<void>,
): Promise<RunEvent[]> {
  const res = await fetch(`${h.baseUrl}/api/runs/${runId}/stream`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: RunEvent[] = [];
  let buffer = "";
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        // WP2.1 — skip non-`data:` framing lines (`id:`); a ping now arrives as a real
        // `data: {"type":"ping"}` line and is parsed like any other event (harmless here: these
        // fast tests never run long enough for the 15s heartbeat to fire).
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5).trim()) as RunEvent;
        events.push(event);
        if (onEvent) await onEvent(event, events);
        if (event.type === "status" && isTerminal(event.status)) done = true;
      }
    }
  }
  await reader.cancel().catch(() => undefined);
  return events;
}

function isTerminal(status: string): boolean {
  return ["completed", "stopped", "error", "aborted"].includes(status);
}

async function post(h: Harness, path: string, body?: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${path}`, {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

function statusEvents(events: RunEvent[]): Array<Extract<RunEvent, { type: "status" }>> {
  return events.filter((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the live listener count on a run's internal EventEmitter (test-only introspection). The manager
 * keeps a private `runs` Map of `{ emitter }`; the SSE route attaches one `"run-event"` listener per
 * connected client, so this proves the disconnect teardown removed it (or that terminal cleanup did).
 * Returns 0 when the run is no longer registered (terminal cleanup dropped it entirely).
 */
function listenerCount(manager: RunManager, runId: string): number {
  const runs = (manager as unknown as { runs: Map<string, { emitter: EventEmitter }> }).runs;
  const run = runs.get(runId);
  return run ? run.emitter.listenerCount("run-event") : 0;
}

/**
 * WP2.1 test-only introspection: forcibly trim a LIVE run's in-memory replay buffer down to just its
 * newest `keep` events — simulating what {@link RunManager}'s own `MAX_BUFFERED_EVENTS` (2000) eviction
 * does over a long run, without actually emitting 2000+ events (slow, and orthogonal to what this test
 * is proving). Mirrors {@link listenerCount}'s existing reflection into the manager's private `runs`
 * map — there is no production seam to force a real eviction quickly, and none should exist for this.
 */
function trimBuffer(manager: RunManager, runId: string, keep: number): void {
  const runs = (manager as unknown as { runs: Map<string, { buffered: RunEvent[] }> }).runs;
  const run = runs.get(runId);
  if (run) run.buffered = run.buffered.slice(-keep);
}

/** One parsed SSE frame: the `id:` line (if any) alongside its `data:`-decoded {@link RunEvent}. */
type SseFrame = { id?: string; event: RunEvent };

/**
 * Like {@link readStream}, but ALSO captures the `id:` line per frame and accepts request headers (a
 * `Last-Event-ID` cursor for reconnect tests) — the WP2.1 cursor-resume + `id:` assertions need both.
 */
async function readStreamWithIds(
  h: Harness,
  runId: string,
  headers?: Record<string, string>,
): Promise<SseFrame[]> {
  const res = await fetch(`${h.baseUrl}/api/runs/${runId}/stream`, { headers });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let id: string | undefined;
      let event: RunEvent | undefined;
      for (const line of frame.split("\n")) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) event = JSON.parse(line.slice(5).trim()) as RunEvent;
      }
      if (!event) continue;
      frames.push({ id, event });
      if (event.type === "status" && isTerminal(event.status)) done = true;
    }
  }
  await reader.cancel().catch(() => undefined);
  return frames;
}

// ── Acceptance 1: ordered RunEvent stream ending in a terminal status; kpi AND step arrive ───────

test("start → subscribe → ordered RunEvent stream ends in a terminal status (kpi + step present)", async () => {
  const h = await makeApp(mockToolThenAnswer());
  const runId = await startRun(h, "automated");
  const events = await readStream(h, runId);

  // Ordered: first status is `running`, the last STATUS event is the terminal `completed` one, and
  // the stream itself now ends on the settled `rating` event (the post-terminal review axis).
  const statuses = statusEvents(events);
  assert.equal(statuses[0]?.status, "running", "first status event is running");
  assert.equal(statuses[statuses.length - 1]?.status, "completed", "last status is completed");
  const last = events[events.length - 1];
  assert.equal(last?.type, "rating", "stream ends on the settled rating event");

  // KPI + step events both arrived over the wire.
  assert.ok(
    events.some((e) => e.type === "kpi"),
    "a kpi event arrived",
  );
  const steps = events.filter((e): e is Extract<RunEvent, { type: "step" }> => e.type === "step");
  assert.ok(steps.length > 0, "step events arrived");
  assert.ok(
    steps.some((e) => e.step.type === "tool_call" && e.step.toolName === "alpha"),
    "the alpha tool_call step streamed",
  );

  // Ordering: `running` precedes the first step which precedes the final kpi which precedes the
  // terminal status (the settled rating event trails it).
  const idxRunning = events.findIndex((e) => e.type === "status" && e.status === "running");
  const idxStep = events.findIndex((e) => e.type === "step");
  const idxKpi = events.findIndex((e) => e.type === "kpi");
  const idxTerminal = events.findIndex((e) => e.type === "status" && e.status === "completed");
  assert.ok(
    idxRunning < idxStep && idxStep < idxKpi && idxKpi <= idxTerminal,
    "events are ordered",
  );
});

// ── Acceptance 2: POST /stop aborts a live run; the stream ends with outcome:"aborted" ───────────

test("POST /stop aborts a live run; the stream ends with terminal outcome:aborted", async () => {
  const h = await makeApp(mockSlowAnswer());
  const runId = await startRun(h, "automated");

  // Stop the run shortly after it starts streaming (the slow mock keeps it live).
  const events = await readStream(h, runId, async (event) => {
    if (event.type === "status" && event.status === "running") {
      await delay(20);
      const res = await post(h, `/api/runs/${runId}/stop`);
      assert.equal(res.status, 202, "POST /stop is accepted");
    }
  });

  // The last STATUS event is the aborted terminal (the settled rating event trails it, AR5 — the
  // review also runs on aborted runs).
  const statuses = statusEvents(events);
  const lastStatus = statuses[statuses.length - 1];
  assert.equal(lastStatus?.status, "aborted", "terminal status is aborted");
  assert.equal(lastStatus?.outcome, "aborted", "terminal outcome is aborted");

  // The detail row reflects the aborted outcome after the engine settles.
  const detail = await (await fetch(`${h.baseUrl}/api/runs/${runId}`)).json();
  assert.equal((detail as { status: string }).status, "aborted", "persisted run is aborted");
});

// ── F3: DELETE on a LIVE run aborts + detaches it BEFORE removing the row (no orphaned spending) ──

test("DELETE on a live run aborts + detaches it before removing the row (no orphaned spending)", async () => {
  // A slow single-turn model keeps the run provably LIVE while we DELETE it. A tracking MCP session
  // proves the run-service `finally` still closes sessions after the abort-and-detach (no leak).
  const closed = { value: false };
  const h = await makeApp(mockSlowAnswer(), () => trackingSession(closed));
  const runId = await startRun(h, "automated");

  // Wait until the run has actually started streaming (status `running` ⇒ MCP sessions are open).
  for (let i = 0; i < 300 && h.runManager.status(runId) !== "running"; i += 1) await delay(10);
  assert.equal(h.runManager.status(runId), "running", "the run is live (streaming) before delete");
  assert.equal(h.runService.isActive(runId), true, "run is active before delete");

  // DELETE the live run. The route must abort + detach it BEFORE the DB delete.
  const res = await fetch(`${h.baseUrl}/api/runs/${runId}`, { method: "DELETE" });
  assert.equal(res.status, 200, "DELETE succeeds");
  assert.equal(((await res.json()) as { runId: string }).runId, runId);

  // Detached immediately: no further events/persistence are routed for this run.
  assert.equal(h.runService.isActive(runId), false, "the run is no longer active after delete");

  // The MCP sessions are still torn down by the run-service `finally` once the aborted loop settles.
  for (let i = 0; i < 300 && !closed.value; i += 1) await delay(10);
  assert.equal(closed.value, true, "MCP session closed after the aborted-and-detached run settled");

  // The row is gone (and stayed gone — no late terminal event re-created or resurrected it).
  const get = await fetch(`${h.baseUrl}/api/runs/${runId}`);
  assert.equal(get.status, 404, "the deleted run's row is gone");
});

// ── H-2: deleting a test/scenario referenced by a LIVE run is rejected (409); allowed once settled ──

test("H-2: DELETE /api/tests/:id and /api/scenarios/:id are 409 while a run is live, allowed after", async () => {
  // A slow single-turn model keeps the run provably LIVE while we attempt the deletes. `runs.test_id`/
  // `runs.scenario_id` are ON DELETE CASCADE, so an unguarded delete would remove the running run row
  // while the loop keeps spending — the guard must refuse.
  const h = await makeApp(mockSlowAnswer());
  const runId = await startRun(h, "automated");

  // Wait until the run is provably LIVE (registered + streaming).
  for (let i = 0; i < 300 && h.runManager.status(runId) !== "running"; i += 1) await delay(10);
  assert.equal(h.runService.isActive(runId), true, "run is active before the delete attempts");

  // Deleting the TEST the live run references is rejected with a typed 409 naming the blocking run.
  const delTest = await fetch(`${h.baseUrl}/api/tests/${h.testId}`, { method: "DELETE" });
  assert.equal(delTest.status, 409, "DELETE /api/tests/:id is 409 while a run is live");
  assert.ok(
    ((await delTest.json()) as { error: string }).error.includes(runId),
    "the 409 message names the blocking run",
  );

  // Deleting the SCENARIO the live run references is likewise rejected.
  const delScenario = await fetch(`${h.baseUrl}/api/scenarios/${h.scenarioId}`, { method: "DELETE" });
  assert.equal(delScenario.status, 409, "DELETE /api/scenarios/:id is 409 while a run is live");

  // Nothing was partially removed — the test + scenario are still present after the refused deletes.
  const testsStillThere = (await (await fetch(`${h.baseUrl}/api/tests`)).json()) as Array<{
    id: string;
  }>;
  assert.ok(
    testsStillThere.some((t) => t.id === h.testId),
    "the test still exists after the refused delete",
  );
  const scenariosStillThere = (await (await fetch(`${h.baseUrl}/api/scenarios`)).json()) as Array<{
    id: string;
  }>;
  assert.ok(
    scenariosStillThere.some((s) => s.id === h.scenarioId),
    "the scenario still exists after the refused delete",
  );

  // Stop the run; once it settles (no longer live) the SAME deletes are ALLOWED — the guard only blocks
  // a genuinely live run in THIS process, not a finished/aborted one.
  await post(h, `/api/runs/${runId}/stop`);
  for (let i = 0; i < 300 && h.runService.isActive(runId); i += 1) await delay(10);
  assert.equal(h.runService.isActive(runId), false, "run settled after stop");

  const delTest2 = await fetch(`${h.baseUrl}/api/tests/${h.testId}`, { method: "DELETE" });
  assert.equal(delTest2.status, 204, "DELETE /api/tests/:id succeeds once no run is live");
  const delScenario2 = await fetch(`${h.baseUrl}/api/scenarios/${h.scenarioId}`, { method: "DELETE" });
  assert.equal(delScenario2.status, 204, "DELETE /api/scenarios/:id succeeds once no run is live");
});

// ── Acceptance 3: interactive — posting a /turns message resumes the loop, producing more events ──

test("interactive: posting a /turns message resumes the loop and produces further events", async () => {
  const h = await makeApp(mockEchoEachTurn());
  const runId = await startRun(h, "interactive");

  let posted = false;
  const events = await readStream(h, runId, async (event, all) => {
    // After the opener turn's answer streams, the run blocks awaiting input. Post one follow-up turn,
    // then stop so the run reaches a terminal state for the test.
    if (!posted && event.type === "delta" && event.text.includes("answer-1")) {
      posted = true;
      await delay(20);
      const res = await post(h, `/api/runs/${runId}/turns`, { text: "second user turn" });
      assert.equal(res.status, 202, "POST /turns is accepted while awaiting input");
    }
    // Once the SECOND turn's answer streams, stop the run so the stream terminates.
    if (posted && event.type === "delta" && event.text.includes("answer-2")) {
      await delay(20);
      await post(h, `/api/runs/${runId}/stop`);
      void all;
    }
  });

  const deltas = events.filter(
    (e): e is Extract<RunEvent, { type: "delta" }> => e.type === "delta",
  );
  assert.ok(
    deltas.some((e) => e.text.includes("answer-1")),
    "opener turn produced events",
  );
  assert.ok(
    deltas.some((e) => e.text.includes("answer-2")),
    "the posted turn RESUMED the loop and produced further events",
  );
  assert.ok(
    isTerminal(statusEvents(events).at(-1)?.status ?? ""),
    "the run reached a terminal status",
  );
});

// ── Acceptance 4: a subscriber that connects slightly AFTER start loses no opening events ─────────

test("no event loss for a subscriber that connects slightly after start (buffer/replay works)", async () => {
  const h = await makeApp(mockToolThenAnswer());
  const runId = await startRun(h, "automated");

  // Connect a beat after the async kickoff. The opening events must still be present — either replayed
  // from the manager's bounded buffer (run still live) or from the persisted log (run already done).
  await delay(30);
  const events = await readStream(h, runId);

  const statuses = statusEvents(events);
  assert.equal(statuses[0]?.status, "running", "the opening `running` status is not lost");
  assert.ok(
    events.some((e) => e.type === "step" && e.step.type === "tool_call"),
    "the opening tool_call step is not lost",
  );
  assert.ok(
    events.some((e) => e.type === "kpi"),
    "the kpi event is present",
  );
  assert.equal(statuses.at(-1)?.status, "completed", "the stream still ends in a terminal status");
});

// ── Acceptance 4b: a LIVE late subscriber is backfilled from the in-memory bounded buffer ─────────

test("a late subscriber that attaches while the run is still LIVE is replayed from the bounded buffer", async () => {
  // The model calls a tool fast (opening events buffer immediately), then STALLS on the answer turn,
  // so the run stays active far longer than the connect delay → the subscribe provably hits the
  // in-memory bounded-buffer replay path, NOT the persisted-replay (`getRun`) fallback.
  const h = await makeApp(mockToolThenSlowAnswer());
  const runId = await startRun(h, "automated");

  // Poll until the opening events are in the bounded buffer (the run has emitted its `running` status
  // and the alpha tool_call step) BUT the run is still live — i.e. the answer turn hasn't finished.
  // This proves the subscriber below exercises the live-buffer branch of `streamRun`, not `getRun`.
  let bufferReady = false;
  for (let i = 0; i < 50 && !bufferReady; i += 1) {
    await delay(10);
    if (!h.runService.isActive(runId)) break; // would mean the slow turn finished too early (it won't)
    // Peek the buffer via a throwaway subscription (synchronous backlog replay), then immediately
    // detach so it doesn't consume the live stream the real client opens next.
    const seen: RunEvent[] = [];
    const off = h.runService.subscribeEvents(runId, (e) => seen.push(e));
    off();
    bufferReady =
      seen.some((e) => e.type === "status" && e.status === "running") &&
      seen.some((e) => e.type === "step" && e.step.type === "tool_call");
  }
  assert.ok(
    bufferReady,
    "opening running + tool_call events are buffered while the run is still live",
  );

  // The decisive assertion: at subscribe time the run is STILL active, so `streamRun` takes the live
  // branch (bounded-buffer replay + live listener), not the `getRun` persisted-replay fallback.
  assert.equal(h.runService.isActive(runId), true, "run is provably still LIVE at subscribe time");

  const events = await readStream(h, runId);

  // The opening events were replayed from the bounded buffer, in order, even though we connected mid-run.
  const statuses = statusEvents(events);
  assert.equal(statuses[0]?.status, "running", "the opening `running` status came from the buffer");
  const idxRunning = events.findIndex((e) => e.type === "status" && e.status === "running");
  const idxStep = events.findIndex((e) => e.type === "step" && e.step.type === "tool_call");
  assert.ok(idxStep !== -1, "the opening alpha tool_call step was not lost");
  assert.ok(
    idxRunning < idxStep,
    "buffered events are replayed in order (running before the step)",
  );
  assert.ok(
    events.some((e) => e.type === "kpi"),
    "the kpi event is present",
  );
  assert.equal(statuses.at(-1)?.status, "completed", "the stream still ends in a terminal status");
});

// ── Acceptance 5: a client disconnect tears down the SSE emitter listener AND the MCP sessions ────

test("client disconnect mid-run tears down the SSE listener and (on settle) the MCP sessions", async () => {
  // The two-turn model calls a tool fast then STALLS on the answer turn (120ms chunks), so the run
  // stays LIVE far past connect+disconnect — the disconnect provably lands mid-stream (the path that
  // registers `request.raw.on('close', close)`). A tracking MCP session proves the run-service
  // `finally` closes sessions (no child-process / connection leak).
  const closed = { value: false };
  const h = await makeApp(mockToolThenSlowAnswer(), () => trackingSession(closed));
  const runId = await startRun(h, "automated");

  // Connect the SSE client. Reading the first frame both establishes the socket and registers the
  // route's single live `"run-event"` listener on the run's emitter.
  const controller = new AbortController();
  const res = await fetch(`${h.baseUrl}/api/runs/${runId}/stream`, { signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  await reader.read(); // first frame (the buffered `running` status) → connection + listener established

  // The run is still LIVE (the answer turn is stalling) and the route attached exactly its listener.
  assert.equal(
    h.runService.isActive(runId),
    true,
    "the run is provably still live while connected",
  );
  const before = listenerCount(h.runManager, runId);
  assert.ok(before >= 1, "the connected SSE client registered a live listener on the run emitter");

  // DISCONNECT: abort the fetch to simulate the browser closing the EventSource mid-stream.
  controller.abort();
  await reader.cancel().catch(() => undefined);

  // The route's `request.raw.on('close', …)` handler must remove its listener. Poll until the live
  // listener count drops below `before` (disconnect teardown) OR the run settles (terminal cleanup
  // removes all listeners) — either way no leaked emitter listener remains.
  let torn = false;
  for (let i = 0; i < 200 && !torn; i += 1) {
    await delay(10);
    if (!h.runService.isActive(runId)) break;
    torn = listenerCount(h.runManager, runId) < before;
  }
  assert.ok(
    torn || !h.runService.isActive(runId),
    "the disconnected client's SSE listener was removed (no leaked emitter listener)",
  );

  // Let the run finish on its own; the run-service `finally` must always close the MCP sessions.
  for (let i = 0; i < 300 && h.runService.isActive(runId); i += 1) await delay(10);
  assert.equal(h.runService.isActive(runId), false, "the run settled after the disconnect");
  // Sessions close on a microtask after the engine settles — give the queue a beat.
  for (let i = 0; i < 50 && !closed.value; i += 1) await delay(10);
  assert.equal(closed.value, true, "the MCP session was torn down after the run settled (no leak)");

  // The detail row still opens read-only after the disconnect (the persistence sink kept writing).
  const detail = (await (await fetch(`${h.baseUrl}/api/runs/${runId}`)).json()) as {
    status: string;
  };
  assert.ok(
    ["completed", "stopped", "error", "aborted"].includes(detail.status),
    "the run reached a terminal state",
  );
});

// ── AR11: the rating axis — lifecycle transitions, SSE close semantics, replay convergence ────────

/**
 * Read the SSE stream until the SERVER closes it (not merely until the terminal status), collecting
 * every event — the AR11 close-semantics reader: the stream must stay open through the post-terminal
 * review and end only after a SETTLED `rating` event.
 */
async function readStreamToClose(
  h: Harness,
  runId: string,
  // WP2.1 — optional request headers (a `Last-Event-ID` cursor for reconnect tests); every pre-existing
  // call site omits this and gets a plain connect exactly as before.
  headers?: Record<string, string>,
): Promise<RunEvent[]> {
  const res = await fetch(`${h.baseUrl}/api/runs/${runId}/stream`, { headers });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: RunEvent[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        // WP2.1 — skip non-`data:` framing lines (`id:`); a ping now arrives as a real
        // `data: {"type":"ping"}` line and is parsed like any other event (harmless here: these
        // fast tests never run long enough for the 15s heartbeat to fire).
        if (!line.startsWith("data:")) continue;
        events.push(JSON.parse(line.slice(5).trim()) as RunEvent);
      }
    }
  }
  return events;
}

function ratingEvents(events: RunEvent[]): Array<Extract<RunEvent, { type: "rating" }>> {
  return events.filter((e): e is Extract<RunEvent, { type: "rating" }> => e.type === "rating");
}

/** A stub GradeService whose gradeRun resolves (or throws) — the AR11 review chain's injected seam. */
function stubGrades(behavior: "ok" | "throw"): GradeService {
  return {
    gradeRun: async () => {
      if (behavior === "throw") throw new Error("judge exploded");
      return [];
    },
  } as unknown as GradeService;
}

test("AR11: a completed run transitions rating→rated; the stream closes only after the settled rating", async () => {
  const h = await makeApp(mockToolThenAnswer(), stubSession, stubGrades("ok"));
  const runId = await startRun(h, "automated");
  const events = await readStreamToClose(h, runId);

  // The terminal status arrived — and the stream did NOT close on it: the rating events follow.
  const statuses = statusEvents(events);
  assert.equal(statuses.at(-1)?.status, "completed", "the run reached its terminal status");
  const ratings = ratingEvents(events);
  assert.deepEqual(
    ratings.map((e) => e.state),
    ["rating", "rated"],
    "the review streamed `rating` then the settled `rated`",
  );

  // Ordering: terminal status BEFORE the review events; the settled rating is the FINAL event.
  const idxTerminal = events.findIndex((e) => e.type === "status" && e.status === "completed");
  const idxRating = events.findIndex((e) => e.type === "rating");
  assert.ok(idxTerminal < idxRating, "the review starts only after the terminal status");
  const last = events[events.length - 1];
  assert.ok(
    last?.type === "rating" && last.state === "rated",
    "the stream's final event is the settled rating (close waits for it)",
  );

  // The run row carries the settled state — additive, never touching the terminal status/outcome.
  const summary = (await (await fetch(`${h.baseUrl}/api/runs/${runId}`)).json()) as {
    status: string;
    ratingState: string;
  };
  assert.equal(summary.status, "completed", "terminal status untouched by the review");
  assert.equal(summary.ratingState, "rated", "the persisted ratingState settled to rated");
});

test("AR11: a grade-service crash settles the axis to `failed` — the run's own result is untouched", async () => {
  const h = await makeApp(mockToolThenAnswer(), stubSession, stubGrades("throw"));
  const runId = await startRun(h, "automated");
  const events = await readStreamToClose(h, runId);

  assert.deepEqual(
    ratingEvents(events).map((e) => e.state),
    ["rating", "failed"],
    "the review crash lands on the settled `failed` state (still emitted — the close depends on it)",
  );
  const summary = (await (await fetch(`${h.baseUrl}/api/runs/${runId}`)).json()) as {
    status: string;
    outcome?: string;
    ratingState: string;
  };
  assert.equal(summary.status, "completed", "a rating crash NEVER marks the run itself failed");
  assert.equal(summary.outcome, "completed", "the engine outcome is untouched");
  assert.equal(summary.ratingState, "failed", "the axis records the crash honestly");
});

test("AR11: no grade service wired → the axis settles `skipped` (never a fake rating/rated)", async () => {
  const h = await makeApp(mockToolThenAnswer()); // the default harness wires NO grade service
  const runId = await startRun(h, "automated");
  const events = await readStreamToClose(h, runId);

  assert.deepEqual(
    ratingEvents(events).map((e) => e.state),
    ["skipped"],
    "auto-rating inactive → one settled `skipped` event, no `rating` phase",
  );
  const summary = (await (await fetch(`${h.baseUrl}/api/runs/${runId}`)).json()) as {
    ratingState: string;
  };
  assert.equal(summary.ratingState, "skipped");
});

test("AR11: a finished run's replayed stream carries the persisted rating events and still ends settled", async () => {
  const h = await makeApp(mockToolThenAnswer(), stubSession, stubGrades("ok"));
  const runId = await startRun(h, "automated");
  await readStreamToClose(h, runId); // let the run + review fully settle (live pass)

  // Second subscription: the manager is gone, so this is the PERSISTED replay path.
  assert.equal(h.runService.isActive(runId), false, "the run is fully settled before the replay");
  const replayed = await readStreamToClose(h, runId);
  assert.deepEqual(
    ratingEvents(replayed).map((e) => e.state),
    ["rating", "rated"],
    "the persisted run_events log carries the review transitions for replay",
  );
});

test("AR11: a legacy/backfilled log without rating events synthesizes one from the run row", async () => {
  const h = await makeApp(mockToolThenAnswer(), stubSession, stubGrades("ok"));
  const runId = await startRun(h, "automated");
  await readStreamToClose(h, runId); // settle fully

  // Rewind to the pre-rating world: strip the persisted rating events (the row keeps `rated` — the
  // exact shape of a v27-backfilled run, whose log predates the rating events entirely).
  h.db.prepare("DELETE FROM run_events WHERE run_id = ? AND type = 'rating'").run(runId);

  const replayed = await readStreamToClose(h, runId);
  const ratings = ratingEvents(replayed);
  assert.deepEqual(
    ratings.map((e) => e.state),
    ["rated"],
    "one final rating event is synthesized from the row so clients converge",
  );
  assert.equal(replayed.at(-1)?.type, "rating", "the synthesized rating is the final event");
});

// ── Bonus: history + compare reads over the wire ─────────────────────────────────────────────────

test("GET /api/runs lists history and GET /api/runs/compare returns CompareRow[] for the ids", async () => {
  const h = await makeApp(mockToolThenAnswer());
  const runId = await startRun(h, "automated");
  await readStream(h, runId); // let it settle so the row is finalized

  const history = (await (await fetch(`${h.baseUrl}/api/runs`)).json()) as Array<{ id: string }>;
  assert.ok(
    history.some((r) => r.id === runId),
    "history lists the run",
  );

  const compare = (await (
    await fetch(`${h.baseUrl}/api/runs/compare?ids=${runId}`)
  ).json()) as Array<{ id: string; scenarioName: string; model: string }>;
  assert.equal(compare.length, 1, "compare returns one row for the id");
  assert.equal(compare[0]?.id, runId);
  assert.equal(compare[0]?.scenarioName, "Baseline", "compare row carries the scenario name");
  assert.equal(compare[0]?.model, "claude-sonnet-4", "compare row carries the model");
});

// ── WP2.1 (Unified Sessions, D-US8): SSE `id: <seq>` + `Last-Event-ID` cursor resume + ping ───────

test("WP2.1: every streamed event carries an `id:` line matching its own `seq`", async () => {
  const h = await makeApp(mockToolThenAnswer(), stubSession, stubGrades("ok"));
  const runId = await startRun(h, "automated");
  const frames = await readStreamWithIds(h, runId);

  assert.ok(frames.length > 0, "frames were captured");
  for (const frame of frames) {
    assert.equal(typeof frame.event.seq, "number", `event ${frame.event.type} carries a seq`);
    assert.equal(
      frame.id,
      String(frame.event.seq),
      "the SSE `id:` line matches the event's own `seq`",
    );
  }
  // seqs are strictly ascending and gapless from 0 (the stream's own emission order).
  const seqs = frames.map((f) => f.event.seq as number);
  assert.deepEqual(
    seqs,
    seqs.map((_, i) => i),
    "seq is gapless and strictly ascending from 0",
  );
});

test("WP2.1: reconnect with Last-Event-ID resumes from the in-memory buffer (seq > cursor, no dupes)", async () => {
  const h = await makeApp(mockToolThenSlowAnswer());
  const runId = await startRun(h, "automated");

  // Poll (the same throwaway-peek-subscription trick as the pre-existing "late subscriber" test) until
  // the opening tool_call step has buffered — its `seq` becomes our resume cursor. The run stays LIVE
  // throughout (the answer turn stalls), so this provably exercises the in-memory-buffer branch, not a
  // finished-run persisted replay.
  let cursor: number | undefined;
  for (let i = 0; i < 50 && cursor === undefined; i += 1) {
    await delay(10);
    if (!h.runService.isActive(runId)) break;
    const seen: RunEvent[] = [];
    const off = h.runService.subscribeEvents(runId, (e) => seen.push(e));
    off();
    const step = seen.find((e) => e.type === "step" && e.step.type === "tool_call");
    if (step) cursor = step.seq;
  }
  assert.ok(cursor !== undefined, "captured a resume cursor from the buffered opening events");
  assert.equal(h.runService.isActive(runId), true, "the run is still live at reconnect time");

  const frames = await readStreamWithIds(h, runId, { "Last-Event-ID": String(cursor) });
  assert.ok(frames.length > 0, "the resumed stream delivered events");

  const seqs = frames.map((f) => f.event.seq).filter((s): s is number => s !== undefined);
  assert.ok(
    seqs.every((s) => s > (cursor as number)),
    "every resumed event's seq is strictly greater than the cursor",
  );
  assert.deepEqual(seqs, [...new Set(seqs)], "no duplicate seq values across the reconnect");
  assert.ok(
    !frames.some((f) => f.event.type === "step" && f.event.seq === cursor),
    "the already-seen tool_call step (at the cursor) is not re-sent",
  );
  assert.ok(
    frames.some((f) => f.event.type === "kpi"),
    "later events past the cursor still arrive normally",
  );
});

test("WP2.1: a reconnect cursor beyond the in-memory buffer replays the missing tail from run_events (DB)", async () => {
  const h = await makeApp(mockToolThenSlowAnswer());
  const runId = await startRun(h, "automated");

  // Wait for the opening events (running status + the alpha tool_call step) to be buffered while the
  // run is still live (the stalling answer turn keeps it that way).
  let sawStep = false;
  for (let i = 0; i < 50 && !sawStep; i += 1) {
    await delay(10);
    if (!h.runService.isActive(runId)) break;
    const seen: RunEvent[] = [];
    const off = h.runService.subscribeEvents(runId, (e) => seen.push(e));
    off();
    sawStep = seen.some((e) => e.type === "step" && e.step.type === "tool_call");
  }
  assert.ok(sawStep, "the opening tool_call step buffered while still live");
  assert.equal(h.runService.isActive(runId), true, "run still live before trimming its buffer");

  // Simulate what a long run's MAX_BUFFERED_EVENTS eviction eventually does: forcibly trim the
  // in-memory buffer to just its newest event, so it no longer covers a cursor sitting right after the
  // very first (seq 0) event. The reconnect below must then fall back to the persisted `run_events` log
  // for the missing tail (an existing repository read — `RunRepository.getRun` — not a new one).
  trimBuffer(h.runManager, runId, 1);

  // Cursor 0 — "I've already seen seq 0" (the opening `running` status; WP2.1's own `id:` test proves
  // seqs are gapless from 0) — a valid, real `Last-Event-ID` a client would actually hold. `-1`/negative
  // cursors are rejected by `parseLastEventId` (real clients never send one), so this is the smallest
  // legitimate cursor that still guarantees a gap against the just-trimmed 1-event buffer.
  const cursor = 0;
  const frames = await readStreamWithIds(h, runId, { "Last-Event-ID": String(cursor) });

  assert.ok(
    !frames.some((f) => f.event.seq === 0),
    "the already-seen seq-0 `running` status is not re-sent (no dupe)",
  );
  assert.ok(
    frames.some((f) => f.event.type === "step" && f.event.step.type === "tool_call"),
    "the evicted opening tool_call step (seq > cursor) was backfilled from the persisted log",
  );

  // Zero loss AND zero dupes: seqs are present, strictly ascending, each exactly once, gapless from 1.
  const seqs = frames.map((f) => f.event.seq).filter((s): s is number => s !== undefined);
  assert.deepEqual(
    seqs,
    [...seqs].sort((a, b) => a - b),
    "events arrive in ascending seq order",
  );
  assert.deepEqual(seqs, [...new Set(seqs)], "no duplicate seq values (DB tail + buffer tail overlap-safe)");
  assert.ok(seqs.every((s) => s > cursor), "every replayed event's seq is greater than the cursor");
  assert.deepEqual(
    seqs,
    seqs.map((_, i) => i + 1),
    "the full missing tail from seq 1 onward was recovered, gaplessly",
  );
});

test('WP2.1: a `{type:"ping"}` keepalive is emitted on the SSE heartbeat interval and never carries an id:', async () => {
  // Shrink the heartbeat cadence for this test only (restored in `afterEach`) so a real 15s wait isn't
  // needed — see `setSseHeartbeatMsForTesting`'s doc.
  setSseHeartbeatMsForTesting(30);

  const h = await makeApp(mockSlowAnswer()); // 200ms between chunks — the run stays live long enough
  const runId = await startRun(h, "automated");

  const res = await fetch(`${h.baseUrl}/api/runs/${runId}/stream`);
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pingFrame: SseFrame | undefined;
  const deadline = Date.now() + 3000;
  while (!pingFrame && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let id: string | undefined;
      let event: RunEvent | undefined;
      for (const line of frame.split("\n")) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) event = JSON.parse(line.slice(5).trim()) as RunEvent;
      }
      if (event?.type === "ping") pingFrame = { id, event };
    }
  }
  await post(h, `/api/runs/${runId}/stop`);
  await reader.cancel().catch(() => undefined);
  // Let the aborted run settle in the background before the test (and `afterEach`) tears the app down —
  // matches the "POST /stop aborts a live run" test's cleanliness (no dangling async work post-test).
  for (let i = 0; i < 300 && h.runService.isActive(runId); i += 1) await delay(10);

  assert.ok(pingFrame, "a `{type:\"ping\"}` event arrived within the shortened heartbeat window");
  assert.equal(pingFrame?.id, undefined, "a ping never carries an `id:` line (no seq, no cursor advance)");
  assert.equal(pingFrame?.event.seq, undefined, "a ping's payload carries no `seq` either");
});

test("WP2.1: terminal + settled rating still closes cleanly, and a resumed reconnect on the finished run replays only the tail", async () => {
  const h = await makeApp(mockToolThenAnswer(), stubSession, stubGrades("ok"));
  const runId = await startRun(h, "automated");
  const events = await readStreamToClose(h, runId); // must not throw / hang / surface an error

  const last = events[events.length - 1];
  assert.equal(last?.type, "rating", "the stream's final event is the settled rating");
  assert.ok(last?.type === "rating" && last.state === "rated", "the review settled to rated");

  // Reconnect AFTER the run is fully settled (isActive is false — the persisted-replay branch), with a
  // cursor at the second-to-last event: only the un-seen tail (here, just the final `rating` event)
  // should replay — cursor resume composes cleanly with the terminal+settled-rating close rule, and no
  // error surfaces on a reconnect to an already-finished run.
  assert.equal(h.runService.isActive(runId), false, "the run is fully settled before the reconnect");
  const secondLast = events[events.length - 2];
  assert.ok(secondLast?.seq !== undefined, "the second-to-last event carries a seq to resume from");

  const replayed = await readStreamWithIds(h, runId, {
    "Last-Event-ID": String(secondLast?.seq),
  });
  assert.deepEqual(
    replayed.map((f) => f.event.type),
    ["rating"],
    "only the tail past the cursor replays — the settled rating event",
  );
});
