import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { NormalizedToolDefinition, RunDetail, RunSummary } from "@mcp-token-footprint/shared";
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
import { registerTestingRoutes } from "../src/testing/routes.js";
import { SUBSCRIPTION_SESSION_CAPABILITIES } from "../src/testing/session-capabilities.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Observability WP3.3 (D-OB18) — the fork-from-step REBUN endpoint end-to-end (stubbed engine, NO
// provider/MCP key): whole-run + mid-run forks complete + grade + persist lineage; suite-member → 409;
// a mid-run fork of a kind whose manifest can't seed a prefix → 422; derived runs hidden by default +
// forks render both directions.

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
} as const;

function streamOf(chunks: StreamPart[]) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
}

/** Turn 1 calls tool `alpha`; every later turn answers with text — so parent AND its forks complete. */
function mockToolThenAnswer() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "c1", toolName: "alpha", input: JSON.stringify({ x: 1 }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
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

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

const TOOL_DEFS: NormalizedToolDefinition[] = [
  { name: "alpha", description: "Alpha tool", inputSchema: { type: "object" }, raw: {} },
];

type Harness = {
  app: FastifyInstance;
  baseUrl: string;
  testId: string;
  scenarioId: string;
  runService: RunService;
  runs: RunRepository;
  db: AppDatabase;
};

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.app.close();
    h.db.close();
  }
});

async function makeApp(): Promise<Harness> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  const secrets = new SecretStore(crypto.randomBytes(32));
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

  const runs = new RunRepository(db);
  const runManager = new RunManager(runs);
  const model = mockToolThenAnswer();
  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => model;
  const sessionOpener: SessionOpener = async () => stubSession();
  // A trivial stub GradeService so the derived run's rating axis settles `rated` (proves it "grades
  // normally"); gradeRun is a no-op that resolves.
  const grades = { gradeRun: async () => undefined } as unknown as GradeService;
  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runs,
    modelFactory,
    sessionOpener,
    undefined,
    grades,
  );

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerTestingRoutes(app, scenarioService, testService, runService, runs, runManager);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const harness: Harness = {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    testId: testRow.id,
    scenarioId: scenario.id,
    runService,
    runs,
    db,
  };
  harnesses.push(harness);
  return harness;
}

/** Run a run to its terminal state + settled rating (via the service handle, so the test is synchronous). */
async function runToDone(h: Harness): Promise<string> {
  const handle = h.runService.start(h.testId, h.scenarioId, "automated");
  await handle.done;
  await settle();
  return handle.runId;
}

/** Yield so the post-terminal review chain (chained on `.then`) settles the rating axis before asserts. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function post(h: Harness, path: string, body?: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function getJson<T>(h: Harness, path: string): Promise<T> {
  const res = await fetch(`${h.baseUrl}${path}`);
  assert.equal(res.status, 200, `GET ${path}`);
  return (await res.json()) as T;
}

test("whole-run rerun: creates a derived run that completes + grades + persists lineage (all 3 kinds share this path)", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);

  const res = await post(h, `/api/runs/${parentId}/rerun`, { overrides: { prompt: "Different ask." } });
  assert.equal(res.status, 202, "rerun returns immediately (202, async kickoff)");
  const { runId: derivedId, streamUrl } = (await res.json()) as { runId: string; streamUrl: string };
  assert.equal(streamUrl, `/api/runs/${derivedId}/stream`);

  // Await the derived run's own completion + rating settle (it kicked off async).
  for (let i = 0; i < 50 && h.runService.isActive(derivedId); i++) await settle();
  await settle();

  const derived = await getJson<RunDetail>(h, `/api/runs/${derivedId}`);
  assert.equal(derived.status, "completed", "derived run completes under the stubbed engine");
  assert.ok(
    derived.ratingState && derived.ratingState !== "pending" && derived.ratingState !== "rating",
    "derived run's rating axis settled (grades normally)",
  );
  assert.equal(derived.derivedFromRunId, parentId, "child→parent lineage persisted");
  assert.equal(derived.forkStepId, undefined, "whole-run re-launch has no fork step");
  assert.equal(derived.scenarioId, h.scenarioId, "fork reuses the parent environment");
});

test("mid-run fork: reconstructs the prefix at a step, applies the prompt override, completes", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  const parent = await getJson<RunDetail>(h, `/api/runs/${parentId}`);
  const forkStep = parent.steps.find((s) => s.type === "llm_response");
  assert.ok(forkStep, "parent has an llm_response step to fork at");

  const res = await post(h, `/api/runs/${parentId}/rerun`, {
    fromStepId: forkStep!.id,
    overrides: { prompt: "Continue differently." },
  });
  assert.equal(res.status, 202);
  const { runId: derivedId } = (await res.json()) as { runId: string };
  for (let i = 0; i < 50 && h.runService.isActive(derivedId); i++) await settle();
  await settle();

  const derived = await getJson<RunDetail>(h, `/api/runs/${derivedId}`);
  assert.equal(derived.status, "completed");
  assert.equal(derived.derivedFromRunId, parentId);
  assert.equal(derived.forkStepId, forkStep!.id, "fork step persisted");
});

test("lineage renders BOTH directions: parent lists its forks, child names its parent", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  const res = await post(h, `/api/runs/${parentId}/rerun`, {});
  const { runId: derivedId } = (await res.json()) as { runId: string };
  for (let i = 0; i < 50 && h.runService.isActive(derivedId); i++) await settle();
  await settle();

  const parent = await getJson<RunDetail>(h, `/api/runs/${parentId}`);
  assert.ok(parent.forks, "parent detail carries a forks array");
  assert.deepEqual(
    parent.forks!.map((f) => f.runId),
    [derivedId],
    "parent lists the derived run as a fork",
  );

  const child = await getJson<RunSummary>(h, `/api/runs/${derivedId}`);
  assert.equal(child.derivedFromRunId, parentId, "child names its parent");
});

test("derived runs are HIDDEN by default in the feed, shown only with derived:true", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  const res = await post(h, `/api/runs/${parentId}/rerun`, {});
  const { runId: derivedId } = (await res.json()) as { runId: string };
  for (let i = 0; i < 50 && h.runService.isActive(derivedId); i++) await settle();
  await settle();

  // Default feed (no filter param) — the fork is HIDDEN (still uses the legacy list, which is derived-
  // agnostic; the filtered feed is where "show forks" applies).
  const filtered = await getJson<RunSummary[]>(
    h,
    `/api/runs?filter=${encodeURIComponent(JSON.stringify({}))}`,
  );
  assert.ok(
    !filtered.some((r) => r.id === derivedId),
    "a filtered feed with no derived flag excludes the fork",
  );
  assert.ok(filtered.some((r) => r.id === parentId), "the parent is still listed");

  const forksShown = await getJson<RunSummary[]>(
    h,
    `/api/runs?filter=${encodeURIComponent(JSON.stringify({ derived: true }))}`,
  );
  assert.deepEqual(
    forksShown.map((r) => r.id),
    [derivedId],
    "derived:true shows ONLY the fork",
  );
});

test("a derived run is NEVER a suite member → absent from suite analytics (suite_run_id stays NULL)", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  // A real suite member (denormalized `suite_run_id` linkage; NOT an FK) alongside a fork (never linked).
  const memberId = await runToDone(h);
  h.runs.linkRunToSuite(memberId, "sr-1", 1);

  const res = await post(h, `/api/runs/${parentId}/rerun`, {});
  const { runId: derivedId } = (await res.json()) as { runId: string };
  for (let i = 0; i < 50 && h.runService.isActive(derivedId); i++) await settle();
  await settle();

  // The suite-analytics member source (`SELECT id FROM runs WHERE suite_run_id = ?`) sees ONLY the
  // linked member, never the fork — a fork's suite_run_id is NULL by construction (never linked).
  const members = h.db
    .prepare("SELECT id FROM runs WHERE suite_run_id = 'sr-1'")
    .all() as Array<{ id: string }>;
  assert.deepEqual(members.map((m) => m.id), [memberId], "only the linked member is a suite child");
  const forkRow = h.db
    .prepare("SELECT suite_run_id FROM runs WHERE id = ?")
    .get(derivedId) as { suite_run_id: string | null };
  assert.equal(forkRow.suite_run_id, null, "the fork carries no suite linkage");
});

test("a suite-run member cannot be forked → 409 (D-OB18)", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  h.runs.linkRunToSuite(parentId, "sr-x", 1); // denormalized suite membership

  const res = await post(h, `/api/runs/${parentId}/rerun`, {});
  assert.equal(res.status, 409, "a suite member is refused");
});

test("a mid-run fork of a kind whose manifest can't seed a prefix → 422; whole-run still works", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  const parent = await getJson<RunDetail>(h, `/api/runs/${parentId}`);
  const forkStep = parent.steps.find((s) => s.type === "llm_response")!;
  // Overlay a capability manifest with contextWindow:false (the subscription child's) so the fork gate
  // reads the MANIFEST, not the providerKind (D-US4). A mid-run fork must be refused; a whole-run
  // re-launch must still work.
  h.runs.setCapabilities(parentId, SUBSCRIPTION_SESSION_CAPABILITIES);

  const midRun = await post(h, `/api/runs/${parentId}/rerun`, { fromStepId: forkStep.id });
  assert.equal(midRun.status, 422, "mid-run fork refused by the capability gate");

  const wholeRun = await post(h, `/api/runs/${parentId}/rerun`, {});
  assert.equal(wholeRun.status, 202, "whole-run re-launch is allowed for every kind");
});

test("a still-running (non-terminal) run cannot be forked → 409", async () => {
  const h = await makeApp();
  // Insert a running run row directly (never finalized) — the endpoint must refuse it.
  h.db
    .prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
       VALUES ('run-live', @testId, @scenarioId, 'automated', 'running', @now)`,
    )
    .run({ testId: h.testId, scenarioId: h.scenarioId, now: "2026-06-20T00:00:00.000Z" });

  const res = await post(h, `/api/runs/run-live/rerun`, {});
  assert.equal(res.status, 409, "a non-terminal run is refused");
});

test("an unknown skill-version override → 422", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  const res = await post(h, `/api/runs/${parentId}/rerun`, {
    overrides: { skillVersionId: "does-not-exist" },
  });
  assert.equal(res.status, 422, "a stale skill-version override is rejected");
});

test("the parent environment is NOT mutated by a model/temperature override", async () => {
  const h = await makeApp();
  const parentId = await runToDone(h);
  const res = await post(h, `/api/runs/${parentId}/rerun`, {
    overrides: { model: "claude-opus-4", temperature: 0.9 },
  });
  assert.equal(res.status, 202);
  // The scenario row is untouched — the override rode only the fork's run config.
  const scenarios = await getJson<Array<{ id: string; model: string }>>(h, `/api/scenarios`);
  const env = scenarios.find((s) => s.id === h.scenarioId);
  assert.equal(env?.model, "claude-sonnet-4", "environment model unchanged by the override");
});
