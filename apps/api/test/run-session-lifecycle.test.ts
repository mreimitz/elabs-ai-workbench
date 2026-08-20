// Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — persistence + API surface tests.
//
// Part A: repository-level unit tests (no HTTP, no engine) for the new session-lifecycle write
// primitives (setCapabilities/setPhase/recordDurations/markEnded/markSeen), the NULL-safe read side
// (toRunSummary's new fields), openQuestions reconstruction, and the RunManager terminal-set/
// user-initiated-stop-flag additions.
//
// Part B: route-level tests (a real Fastify app + RunService + a mock provider model, no real
// provider/MCP key — the run-stream-routes.test.ts harness pattern) for `POST /api/runs/:id/end`,
// `POST /api/runs/:id/seen`, and the extended `GET /api/runs/:id`.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { NormalizedToolDefinition, SessionCapabilities } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { McpSession } from "../src/mcp/client.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { RunManager, type RunEmitMeta } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { registerTestingRoutes } from "../src/testing/routes.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { terminalFor } from "../src/testing/session-terminal.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

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

const NOW = "2026-06-20T00:00:00.000Z";

/** Seed the FK parents (provider → scenario, test) a `runs` row needs. */
function seedParents(
  db: AppDatabase,
  testId: string,
  scenarioId: string,
  { mode }: { mode?: string } = {},
): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'List files', 'Use the tools, then answer.', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });
  void mode;
}

// ── Part A: repository + manager unit tests ──────────────────────────────────────────────────────

test("RunManager: 'ended' joins the terminal set", () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  const manager = new RunManager(runs);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "interactive" });
  manager.create("run-1");
  assert.equal(manager.isActive("run-1"), true);
  manager.emit("run-1", { type: "status", status: "ended", outcome: "ended" });
  // The manager's cleanup fires only once terminal AND rating-settled; emit a settled rating too so
  // cleanup actually runs (mirrors how the run service always follows a terminal with one).
  manager.emit("run-1", { type: "rating", state: "skipped" });
  assert.equal(manager.isActive("run-1"), false, "'ended' + a settled rating triggers cleanup");
});

test("RunManager: markUserInitiatedStop/wasUserInitiatedStop round-trip while the run is registered", () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  const manager = new RunManager(runs);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "interactive" });
  manager.create("run-1");

  assert.equal(manager.wasUserInitiatedStop("run-1"), false, "false before marking");
  manager.markUserInitiatedStop("run-1");
  assert.equal(manager.wasUserInitiatedStop("run-1"), true, "true after marking");

  // Unknown/already-settled run: no-op / false, never throws.
  assert.doesNotThrow(() => manager.markUserInitiatedStop("nope"));
  assert.equal(manager.wasUserInitiatedStop("nope"), false);
});

/** Flush the microtask queue (RunManager.emit's persistence dispatch is a deferred `Promise.resolve().then`). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("RunManager.emit's optional `meta` (durations) reaches RunRepository.finalize on a terminal event", async () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  const manager = new RunManager(runs);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create("run-1");

  const meta: RunEmitMeta = { activeDurationMs: 4200, totalDurationMs: 9000 };
  manager.emit(
    "run-1",
    { type: "status", status: "completed", outcome: "completed", stopReasonCode: undefined },
    meta,
  );
  await flush();

  const summary = runs.getSummary("run-1");
  assert.equal(summary.activeDurationMs, 4200, "activeDurationMs persisted from the emit-path meta");
  assert.equal(summary.totalDurationMs, 9000, "totalDurationMs persisted from the emit-path meta");
  assert.ok(summary.endedAt, "ended_at stamped for every terminal disposition, not just 'ended'");
});

test("RunManager.emit without `meta` leaves the duration columns NULL (absent on the summary)", async () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  const manager = new RunManager(runs);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create("run-1");
  manager.emit("run-1", { type: "status", status: "completed", outcome: "completed" });
  await flush();

  const summary = runs.getSummary("run-1");
  assert.equal(summary.activeDurationMs, undefined, "no meta supplied → activeDurationMs absent");
  assert.equal(summary.totalDurationMs, undefined, "no meta supplied → totalDurationMs absent");
});

test("RunManager.emit persists a terminal `stopReasonCode` via finalize", async () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  const manager = new RunManager(runs);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  manager.create("run-1");
  const verdict = terminalFor("stalled");
  manager.emit("run-1", {
    type: "status",
    status: verdict.status,
    outcome: verdict.outcome,
    stopReasonCode: verdict.stopReasonCode,
  });
  await flush();

  const summary = runs.getSummary("run-1");
  assert.equal(summary.stopReasonCode, "stalled", "stopReasonCode persisted from the terminal event");
  assert.equal(summary.status, "stopped");
  assert.equal(summary.outcome, "stopped_guardrail");
});

test("RunRepository: setCapabilities/setPhase/recordDurations/markEnded/markSeen round-trip", () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "interactive" });

  const caps: SessionCapabilities = {
    liveText: true,
    liveReasoning: "raw",
    toolCalls: true,
    contextWindow: true,
    tokens: "exact",
    costBasis: "api_exact",
    followUps: true,
    askUser: true,
  };
  runs.setCapabilities("run-1", caps);
  runs.setPhase("run-1", "waiting_input");
  runs.recordDurations("run-1", { activeDurationMs: 111, totalDurationMs: 222 });
  runs.markSeen("run-1");
  runs.markEnded("run-1");

  const summary = runs.getSummary("run-1");
  assert.deepEqual(summary.capabilities, caps, "capabilities round-trip through capabilities_json");
  assert.equal(summary.phase, "waiting_input");
  assert.equal(summary.activeDurationMs, 111);
  assert.equal(summary.totalDurationMs, 222);
  assert.equal(summary.seen, true);
  assert.ok(summary.endedAt, "markEnded stamps ended_at directly");

  // setPhase(null) clears it.
  runs.setPhase("run-1", null);
  assert.equal(runs.getSummary("run-1").phase, undefined, "phase:null clears the column (reads absent)");

  // Unknown run: every write is a no-op, never throws.
  assert.doesNotThrow(() => {
    runs.setCapabilities("nope", caps);
    runs.setPhase("nope", "queued");
    runs.recordDurations("nope", { activeDurationMs: 1 });
    runs.markSeen("nope");
    runs.markEnded("nope");
  });
});

test("RunRepository: a pre-contract run reads all new fields NULL-safe (absent/false)", () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  runs.createRun("run-old", { testId: "t-1", scenarioId: "s-1", mode: "automated" });

  const summary = runs.getSummary("run-old");
  assert.equal(summary.phase, undefined);
  assert.equal(summary.stopReasonCode, undefined);
  assert.equal(summary.endedAt, undefined);
  assert.equal(summary.seen, false, "seen defaults false, not undefined");
  assert.equal(summary.capabilities, undefined);
  assert.equal(summary.activeDurationMs, undefined);
  assert.equal(summary.totalDurationMs, undefined);
});

test("RunRepository: a malformed capabilities_json cell parses to undefined, never throws", () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "automated" });
  db.prepare("UPDATE runs SET capabilities_json = ? WHERE id = ?").run(
    '{"liveText": "not-a-boolean"}', // shape-invalid against sessionCapabilitiesSchema
    "run-1",
  );
  assert.equal(runs.getSummary("run-1").capabilities, undefined, "invalid shape → absent, not thrown");
});

test("RunRepository.getRun: openQuestions reconstructs still-open questions from the event log", async () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  const manager = new RunManager(runs);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "interactive" });
  manager.create("run-1");

  manager.emit("run-1", {
    type: "question",
    questionId: "q1",
    prompt: "Pick one",
    options: [{ label: "A" }, { label: "B", description: "the B option" }],
    allowOther: true,
  });
  manager.emit("run-1", { type: "question", questionId: "q2", prompt: "Another open one" });
  manager.emit("run-1", { type: "question_resolved", questionId: "q1", answer: "A" });
  await flush();

  const detail = runs.getRun("run-1");
  assert.deepEqual(
    detail.openQuestions,
    [{ questionId: "q2", prompt: "Another open one", options: undefined, allowOther: undefined }],
    "only the unresolved question (q2) is reconstructed; the resolved one (q1) is excluded",
  );

  // Resolve q2 too — no open questions remain.
  manager.emit("run-1", { type: "question_resolved", questionId: "q2", answer: null });
  await flush();
  assert.deepEqual(runs.getRun("run-1").openQuestions, [], "no open questions once every one resolves");
});

test("RunRepository.abortOrphanedRuns settles a crashed-mid-review 'ended' run's rating to 'skipped'", () => {
  const db = createDatabase();
  seedParents(db, "t-1", "s-1");
  const runs = new RunRepository(db);
  runs.createRun("run-1", { testId: "t-1", scenarioId: "s-1", mode: "interactive" });
  db.prepare("UPDATE runs SET status = 'ended', outcome = 'ended', rating_state = 'rating' WHERE id = ?").run(
    "run-1",
  );

  runs.abortOrphanedRuns();

  assert.equal(runs.getSummary("run-1").ratingState, "skipped", "an 'ended' run mid-review settles too");
  assert.equal(runs.getSummary("run-1").status, "ended", "abortOrphanedRuns never touches 'ended' status");
});

// ── Part B: route-level tests (real Fastify app + RunService + mock provider model) ────────────────

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[], chunkDelayInMs: number | null = null) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs }) };
}

/** Answers once then STOPS — for an `interactive` run this leaves the loop blocked awaiting the next
 *  turn (the `waiting_input`-shaped live state `/end`'s happy path needs). */
function mockAnswerThenWait() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Opening answer." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]),
  });
}

/** A slow single-turn model so an AUTOMATED run stays provably LIVE while a test probes it. */
function mockSlowAnswer() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf(
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "thinking slowly" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ],
        200,
      ),
  });
}

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

const TOOL_DEFS: NormalizedToolDefinition[] = [];

type Harness = {
  app: FastifyInstance;
  testId: string;
  scenarioId: string;
  runService: RunService;
  runManager: RunManager;
};
const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.app.close();
});

async function makeApp(model: MockLanguageModelV3): Promise<Harness> {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));

  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now: NOW });

  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const scenarioRepo = new ScenarioRepository(db);
  const scans = new ScanRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans);
  const testRepo = new TestRepository(db);
  const testService = new TestService(testRepo);

  const scenario = scenarioRepo.create({
    name: "Baseline",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  const testRow = testService.create({
    name: "Chat",
    userPrompt: "Hello.",
    systemPromptOverride: undefined,
    addedProfiles: [],
  });

  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => model;
  const sessionOpener: SessionOpener = async () => stubSession();
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
  );

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerTestingRoutes(app, scenarioService, testService, runService, runRepo, runManager);

  const harness: Harness = {
    app,
    testId: testRow.id,
    scenarioId: scenario.id,
    runService,
    runManager,
  };
  harnesses.push(harness);
  void TOOL_DEFS;
  return harness;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startRun(h: Harness, mode: "automated" | "interactive"): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { testId: h.testId, scenarioId: h.scenarioId, mode },
  });
  assert.equal(res.statusCode, 202);
  return (res.json() as { runId: string }).runId;
}

// WP1.7 (D-US1 follow-up) — GET /api/runs/:id reflects the phase clear: while genuinely awaiting the
// next turn the phase reads `waiting_input`; once that wait resumes/ends, the persisted phase is never
// left stuck there. Uses the SAME deterministic "stop while waiting" shape as the `/end` tests above (no
// timing race on whether a next turn re-enters `waiting_input` before the assertion runs).
test("GET /api/runs/:id — an interactive engine run's phase is `waiting_input` while genuinely waiting, then clears (not left stuck) once the run stops", async () => {
  const h = await makeApp(mockAnswerThenWait());
  const runId = await startRun(h, "interactive");

  for (let i = 0; i < 300 && !h.runService.isAwaitingInput(runId); i += 1) await delay(10);
  assert.equal(h.runService.isAwaitingInput(runId), true, "the run is paused awaiting the next turn");

  const mid = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  assert.equal(mid.statusCode, 200);
  assert.equal((mid.json() as { phase?: string }).phase, "waiting_input", "genuinely waiting on the operator");

  const stop = await h.app.inject({ method: "POST", url: `/api/runs/${runId}/stop` });
  assert.equal(stop.statusCode, 202);
  for (let i = 0; i < 300 && h.runService.isActive(runId); i += 1) await delay(10);

  const after = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  assert.equal(after.statusCode, 200);
  const body = after.json() as { status: string; phase?: string };
  assert.equal(body.status, "aborted");
  assert.equal(body.phase, undefined, "GET reflects the clear — not left stuck at waiting_input");
});

test("POST /api/runs/:id/end — happy path: a live interactive run ends as status ended/outcome ended", async () => {
  const h = await makeApp(mockAnswerThenWait());
  const runId = await startRun(h, "interactive");

  // Wait until the loop is blocked awaiting the next turn (the opener answered and paused).
  for (let i = 0; i < 300 && !h.runService.isAwaitingInput(runId); i += 1) await delay(10);
  assert.equal(h.runService.isAwaitingInput(runId), true, "the run is paused awaiting the next turn");
  assert.equal(h.runService.isActive(runId), true, "the run is live");

  const end = await h.app.inject({ method: "POST", url: `/api/runs/${runId}/end` });
  assert.equal(end.statusCode, 202, "POST /end is accepted");

  // Let the abort propagate + the review chain settle.
  for (let i = 0; i < 300 && h.runService.isActive(runId); i += 1) await delay(10);

  const detail = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  assert.equal(detail.statusCode, 200);
  const body = detail.json() as {
    status: string;
    outcome: string;
    stopReasonCode: string;
    endedAt?: string;
  };
  assert.equal(body.status, "ended", "terminal status is 'ended', never 'aborted'");
  assert.equal(body.outcome, "ended");
  assert.equal(body.stopReasonCode, "session_ended");
  assert.ok(body.endedAt, "endedAt is stamped");
});

test("POST /api/runs/:id/end — 409 on a non-interactive (automated) run", async () => {
  const h = await makeApp(mockSlowAnswer());
  const runId = await startRun(h, "automated");
  for (let i = 0; i < 300 && h.runManager.status(runId) !== "running"; i += 1) await delay(5);
  assert.equal(h.runService.isActive(runId), true, "the automated run is live before /end");

  const end = await h.app.inject({ method: "POST", url: `/api/runs/${runId}/end` });
  assert.equal(end.statusCode, 409, "End session is rejected for an automated run");

  await h.app.inject({ method: "POST", url: `/api/runs/${runId}/stop` }); // let it settle for cleanup
});

test("POST /api/runs/:id/end — 409 once the run is already terminal", async () => {
  const h = await makeApp(mockAnswerThenWait());
  const runId = await startRun(h, "interactive");
  for (let i = 0; i < 300 && !h.runService.isAwaitingInput(runId); i += 1) await delay(10);

  await h.app.inject({ method: "POST", url: `/api/runs/${runId}/stop` });
  for (let i = 0; i < 300 && h.runService.isActive(runId); i += 1) await delay(10);
  assert.equal(h.runService.isActive(runId), false, "the run is settled (aborted) before the /end call");

  const end = await h.app.inject({ method: "POST", url: `/api/runs/${runId}/end` });
  assert.equal(end.statusCode, 409, "End session 409s once the run has already terminated");
});

test("POST /api/runs/:id/end — 404 on an unknown run", async () => {
  const h = await makeApp(mockAnswerThenWait());
  const end = await h.app.inject({ method: "POST", url: "/api/runs/does-not-exist/end" });
  assert.equal(end.statusCode, 404);
});

test("POST /api/runs/:id/seen marks the run seen; GET reflects it; 404 on an unknown run", async () => {
  const h = await makeApp(mockSlowAnswer());
  const runId = await startRun(h, "automated");

  const before = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  assert.equal((before.json() as { seen?: boolean }).seen, false, "a fresh run starts unseen");

  const seen = await h.app.inject({ method: "POST", url: `/api/runs/${runId}/seen` });
  assert.equal(seen.statusCode, 202);

  const after = await h.app.inject({ method: "GET", url: `/api/runs/${runId}` });
  assert.equal((after.json() as { seen?: boolean }).seen, true, "GET reflects seen:true");

  const unknown = await h.app.inject({ method: "POST", url: "/api/runs/does-not-exist/seen" });
  assert.equal(unknown.statusCode, 404);

  await h.app.inject({ method: "POST", url: `/api/runs/${runId}/stop` }); // let it settle for cleanup
});
