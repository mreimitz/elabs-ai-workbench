import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type {
  AnswersStepPayload,
  NormalizedToolDefinition,
  RunStep,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import { ToolHygieneGrader } from "../src/grading/tool-hygiene.js";
import type { McpSession } from "../src/mcp/client.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import type { DecryptedCredential } from "../src/providers/registry.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { QLIK_ANSWERS_SESSION_CAPABILITIES } from "../src/testing/session-capabilities.js";
import { SkillRepository } from "../src/skills/repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// WP 1.2 — the RunService `cred.kind` branch that routes `qlik_answers` runs to the dedicated executor
// (clean-session: no MCP session / tool bridge / skill context ever) + interactive follow-ups on the
// KEPT thread with `promptType: "thread"`. NO REAL TENANT is contacted: the run service's injected
// `answersFetch` stub answers every tenant call; NO PROVIDER/MCP KEY is needed (the control run uses a
// MockLanguageModelV3 + a stub MCP session).

const NOW = "2026-07-11T00:00:00.000Z";
const QLIK_BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const QLIK_PROMPT = "What were Q3 revenues by region?";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
// Resolution caches the assistant → app id per (baseUrl, assistantId); clear so each case resolves fresh.
beforeEach(() => _clearQlikAnswersAppContextCache());

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

// ── Tenant HTTP stub — Phase 4 cloud-assistants wire (records every call; NEVER a real request) ──

type FetchCall = { url: string; method: string; body: unknown; hasSignal: boolean };

function jsonResponse(body: unknown, init?: { headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** A streamed SSE/NDJSON `Response` whose body is line-based cloud-assistants frames. */
function sseResponse(frames: string[], init?: { headers?: Record<string, string> }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...(init?.headers ?? {}) },
  });
}

/** A cloud-assistants Adaptive-Card answer message (answer = first TextBlock after "Conclusion"). */
function cardMessage(text: string, messageId: string): unknown {
  return {
    id: messageId,
    type: "ai",
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text },
          ],
        },
      },
    ],
  };
}

/**
 * A stub `fetch` for the cloud-assistants wire (resolution → thread → stream → messages). Each prompt's
 * answer text is captured under a synthetic `msg-<i>` id so the following messages GET returns it. The
 * default transport for a `qlik_answers` run is `stream` (D-QA2).
 */
function makeAnswersFetch(opts: {
  calls: FetchCall[];
  threadId?: string;
  answer?: (callIdx: number) => { text: string; etag?: string };
}): typeof fetch {
  let promptIdx = 0;
  const answers: { text: string; etag?: string }[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    opts.calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      hasSignal: init?.signal != null,
    });
    if (url.endsWith("/messages")) {
      return jsonResponse({ data: answers.map((a, i) => cardMessage(a.text, `msg-${i}`)) });
    }
    if (url.endsWith("/actions/stream")) {
      const a = (opts.answer ?? (() => ({ text: "Answer." })))(promptIdx);
      const messageId = `msg-${promptIdx}`;
      answers[promptIdx] = a;
      promptIdx += 1;
      return sseResponse(
        [`data: {"messageId":"${messageId}"}\n`],
        a.etag ? { headers: { etag: a.etag } } : undefined,
      );
    }
    if (url.endsWith("/cloud-assistants/threads"))
      return jsonResponse({ id: opts.threadId ?? "thread-1" });
    if (url.includes("/api/v1/assistants/")) {
      return jsonResponse({ id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] });
    }
    throw new Error(`unexpected tenant URL in stub: ${url}`);
  };
  return impl as typeof fetch;
}

// ── Control (non-qlik) doubles: a mock model + a stub MCP session ─────────────────────────────────

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

const USAGE = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

function mockAnswer(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Agent-loop answer." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ] as LanguageModelV3StreamPart[],
      }),
    }),
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

// ── Harness ───────────────────────────────────────────────────────────────────────────────────

type Harness = {
  db: AppDatabase;
  runService: RunService;
  runManager: RunManager;
  runRepo: RunRepository;
  gradeRepo: GradeRepository;
  scenarioRepo: ScenarioRepository;
  testService: TestService;
  qlikProviderId: string;
  anthropicProviderId: string;
  sessionCalls: string[];
};

function makeHarness(opts: {
  answersFetch?: typeof fetch;
  grades?: boolean;
  model?: () => MockLanguageModelV3;
}): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));

  // A `qlik_answers` own-key credential (WP 0.2 resolves apiKey+baseUrl from the row).
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-qlik', 'qlik_answers', 'Qlik', @baseUrl, @key, @now, @now)`,
  ).run({ baseUrl: QLIK_BASE_URL, key: secrets.encryptText("tenant-bearer"), now: NOW });
  // A normal (non-qlik) credential + a scanned server, to prove the agent-loop path still opens sessions.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-anthropic', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now: NOW });
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'Stub', 'stdio', 'noop', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ now: NOW });

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
  const skills = new SkillRepository(db, secrets);
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, skills);
  const testService = new TestService(new TestRepository(db));
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  const gradeRepo = new GradeRepository(db);
  const grades = opts.grades
    ? new GradeService(gradeRepo, new TestService(new TestRepository(db)), new RunRepository(db), [
        new ToolHygieneGrader(new ScanRepository(db)),
      ])
    : undefined;

  const model = opts.model ?? mockAnswer;
  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => model();
  const sessionCalls: string[] = [];
  const sessionOpener: SessionOpener = async (config) => {
    sessionCalls.push(config.id);
    return stubSession();
  };

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
    skills,
    grades,
    opts.answersFetch,
  );

  return {
    db,
    runService,
    runManager,
    runRepo,
    gradeRepo,
    scenarioRepo,
    testService,
    qlikProviderId: "prov-qlik",
    anthropicProviderId: "prov-anthropic",
    sessionCalls,
  };
}

function qlikScenario(h: Harness, over: { answersMode?: { transport: "stream" | "invoke" } } = {}) {
  return h.scenarioRepo.create({
    name: "Qlik env",
    providerId: h.qlikProviderId,
    model: ASSISTANT_ID,
    params: {},
    systemPrompt: "",
    allowedServers: [], // clean-session: a qlik_answers scenario attaches NO servers
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
    ...(over.answersMode ? { answersMode: over.answersMode } : {}),
  });
}

function anthropicScenario(h: Harness) {
  return h.scenarioRepo.create({
    name: "Agent env",
    providerId: h.anthropicProviderId,
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [{ serverId: "srv-1", allowedTools: ["alpha"] }],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  });
}

function makeTest(h: Harness, over: { expectations?: Record<string, unknown> } = {}) {
  return h.testService.create({
    name: "Q3",
    userPrompt: QLIK_PROMPT,
    addedProfiles: [],
    ...(over.expectations ? { expectations: over.expectations } : {}),
  });
}

const stepsOf = (h: Harness, runId: string): RunStep[] => h.runRepo.getRun(runId).steps;
const stepsByType = (h: Harness, runId: string, type: RunStep["type"]): RunStep[] =>
  stepsOf(h, runId).filter((s) => s.type === type);

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timed out");
}

// ── Part A — routing + clean session ──────────────────────────────────────────────────────────

test("automated: a qlik_answers run routes to the executor, opens NO MCP session, and completes", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({
    answersFetch: makeAnswersFetch({
      calls,
      answer: () => ({ text: "Q3 revenue was $4.2M, led by EMEA.", etag: "asst-v1" }),
    }),
  });
  const scenario = qlikScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  // Clean-session (STRUCTURAL): no MCP session was opened for a qlik_answers run.
  assert.deepEqual(h.sessionCalls, [], "no MCP session opened for a qlik_answers run");

  // Routed to the executor: resolved the app, created the kept thread, streamed the prompt, fetched the answer.
  assert.ok(
    calls.some((c) => c.url.endsWith(`/api/v1/assistants/${ASSISTANT_ID}`)),
    "resolved the assistant → app id",
  );
  assert.ok(
    calls.some((c) => c.url.endsWith("/cloud-assistants/threads")),
    "created the kept cloud-assistants thread",
  );
  assert.ok(
    calls.some((c) => c.url.endsWith("/actions/stream")),
    "streamed the prompt (D-QA2 default)",
  );
  assert.ok(
    calls.some((c) => c.url.endsWith("/messages")),
    "fetched the answer message",
  );

  // Terminal + persisted answer the graders read.
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  const answerSteps = stepsByType(h, handle.runId, "llm_response");
  assert.equal(answerSteps.length, 1);
  assert.equal(answerSteps[0]?.assistantText, "Q3 revenue was $4.2M, led by EMEA.");
  const payload = answerSteps[0]?.payload as AnswersStepPayload;
  assert.equal(payload.promptMode, "oneshot");
  assert.equal(payload.threadId, "thread-1");
  assert.equal(payload.appId, APP_ID);
  // (`estimatedTokens` is verified on the emitted event in qlik-answers-executor.test.ts; the persisted
  // copy is redacted because its key matches the token-secret strip — a run-repository behavior.)
  // No tool calls exist on a qlik run (clean-session) → tool_hygiene reads `unevaluable`, not 0.
  assert.equal(stepsByType(h, handle.runId, "tool_call").length, 0);
  // Observability WP3.1 (D-OB17) — the `tool_io` child is ENGINE-PATH ONLY (the engine's MCP-bridge
  // sink emits it). A qlik run has no tools + never uses that sink, so it emits NO tool_io step.
  assert.equal(
    stepsOf(h, handle.runId).filter((s) => s.spanKind === "tool_io").length,
    0,
    "a qlik run never emits a tool_io child (no MCP tools; not the engine sink)",
  );
  assert.equal(h.runRepo.getSummary(handle.runId).status, "completed");
});

// WP 2.3 (D-QA2 gap fix) — `answersMode` round-trips through `scenarios.answers_mode` (it was previously
// dropped on save). This proves the PERSISTED override — read back from the DB via `scenarioRepo.create()`
// → `get()` → `hydrate()`, not just the in-memory input object — actually reaches the executor. (Phase 4:
// the cloud-assistants prompt API is stream-shaped, so both transports POST to `actions/stream`; the
// `invoke` transport only suppresses live console deltas. The persistence + routing is what this locks.)
test("qlikScenario answersMode:{transport:'invoke'} persists, hydrates, and completes through the executor", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({
    answersFetch: makeAnswersFetch({
      calls,
      answer: () => ({ text: "Invoked answer.", etag: "asst-v1" }),
    }),
  });
  const scenario = qlikScenario(h, { answersMode: { transport: "invoke" } });
  // The round-trip itself: the returned scenario was RE-READ from SQLite, not echoed from the input.
  assert.equal(
    scenario.answersMode?.transport,
    "invoke",
    "answersMode survived the create() -> get() -> hydrate() round-trip",
  );

  const testRow = makeTest(h);
  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  assert.ok(
    calls.some((c) => c.url.endsWith("/actions/stream")),
    "the run reached the cloud-assistants prompt endpoint",
  );
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  assert.equal(stepsByType(h, handle.runId, "llm_response")[0]?.assistantText, "Invoked answer.");
});

test("additive branch: a NON-qlik run still opens its MCP session and runs the agent loop", async () => {
  const h = makeHarness({ model: mockAnswer });
  const scenario = anthropicScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  // The agent-loop path is UNCHANGED: it opened the allow-listed server's session.
  assert.deepEqual(h.sessionCalls, ["srv-1"], "the agent loop opened the MCP session");
  assert.equal(result.status, "completed");
  assert.ok(stepsByType(h, handle.runId, "llm_response").length >= 1);
});

test("a broken qlik_answers credential (no apiKey/baseUrl) fails with a clear terminal error", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({ answersFetch: makeAnswersFetch({ calls }) });
  // Null out the credential's auth so `resolveAnswers` throws BEFORE any tenant call.
  h.db
    .prepare(
      "UPDATE provider_credentials SET api_key_encrypted = NULL, base_url = NULL WHERE id = 'prov-qlik'",
    )
    .run();
  const scenario = qlikScenario(h);
  const testRow = makeTest(h);

  const result = await h.runService.start(testRow.id, scenario.id, "automated").done;

  assert.equal(result.status, "error");
  assert.match(result.stopReason ?? "", /API key or tenant base URL/);
  assert.deepEqual(calls, [], "no tenant call was made for a broken credential");
  assert.deepEqual(h.sessionCalls, [], "and no MCP session either");
});

// ── Part C — the grading chain fires post-terminal ──────────────────────────────────────────────

test("grading fires post-terminal for a completed qlik_answers run; tool_hygiene is unevaluable", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({
    grades: true,
    answersFetch: makeAnswersFetch({
      calls,
      answer: () => ({ text: "EMEA led Q3 revenue growth.", etag: "asst-v1" }),
    }),
  });
  const scenario = qlikScenario(h);
  // tool_hygiene is expectation-gated → give the test expectations so it is eligible on completion.
  const testRow = makeTest(h, { expectations: { expectedInsight: "revenue grew" } });

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  await handle.done;

  assert.equal(h.runRepo.getSummary(handle.runId).status, "completed");
  const grades = h.gradeRepo.listByRun(handle.runId);
  const hygiene = grades.find((g) => g.graderId === "tool_hygiene");
  assert.ok(hygiene, "the grading chain ran the tool_hygiene grader");
  assert.equal(hygiene?.status, "unevaluable", "a run with no tool calls is unevaluable, never 0");
  assert.equal(hygiene?.score, null);
});

// ── Part B — interactive follow-ups on the KEPT cloud-assistants thread ──────────────────────────

test("interactive: a follow-up turn continues the SAME kept cloud-assistants thread", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({
    answersFetch: makeAnswersFetch({
      calls,
      answer: (i) => ({ text: i === 0 ? "Opener answer." : "Follow-up answer.", etag: "v" }),
    }),
  });
  const scenario = qlikScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "interactive");
  // The run stays LIVE after the opener, awaiting the next turn (NOT terminal → no 409).
  await waitFor(() => h.runService.isAwaitingInput(handle.runId));
  assert.equal(h.runService.isActive(handle.runId), true, "an interactive qlik run stays live");

  // The follow-up turn (what POST /api/runs/:id/turns bridges into) continues the thread.
  h.runService.submitTurn(handle.runId, "And by product line?");
  await waitFor(() => stepsByType(h, handle.runId, "llm_response").length >= 2);

  // Exactly ONE thread was created and KEPT — the follow-up reused it (the thread itself carries the
  // conversation context; the cloud-assistants body has no `promptType`, D-QA3 revised).
  assert.equal(
    calls.filter((c) => c.url.endsWith("/cloud-assistants/threads")).length,
    1,
    "one kept thread",
  );
  const streamCalls = calls.filter((c) => c.url.endsWith("/actions/stream"));
  assert.equal(streamCalls.length, 2, "opener + one follow-up prompt");
  // Both prompts ran on the SAME kept thread id, each posting content:[{text}] + the app context.
  assert.ok(streamCalls[0]?.url.includes("/cloud-assistants/thread-1/actions/stream"));
  assert.ok(streamCalls[1]?.url.includes("/cloud-assistants/thread-1/actions/stream"));
  assert.deepEqual(streamCalls[1]?.body, {
    context: { type: "app", id: APP_ID, data: { mode: "live" } },
    content: [{ text: "And by product line?" }],
  });

  // The appended answer steps carry the right promptMode label; each turn drew 1 question (D-QA5).
  const answers = stepsByType(h, handle.runId, "llm_response");
  assert.equal((answers[0]?.payload as AnswersStepPayload).promptMode, "oneshot");
  assert.equal((answers[1]?.payload as AnswersStepPayload).promptMode, "thread");
  assert.equal((answers[1]?.payload as AnswersStepPayload).questionsConsumed, 1);
  assert.equal(answers[1]?.assistantText, "Follow-up answer.");

  // Stopping the session settles it (a stopped interactive run → aborted).
  h.runService.stop(handle.runId);
  const result = await handle.done;
  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.turns, 2, "two answered turns");
});

test("interactive: a turn is rejected (409) once the run has settled", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({
    answersFetch: makeAnswersFetch({ calls, answer: () => ({ text: "Answer." }) }),
  });
  const scenario = qlikScenario(h);
  const testRow = makeTest(h);

  // An AUTOMATED qlik run finishes after one prompt → a turn 409s (scripted single runs stay one-shot).
  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  await handle.done;
  assert.throws(
    () => h.runService.submitTurn(handle.runId, "late turn"),
    /not accepting interactive turns/,
  );
});

// ── WP1.7 (D-US4) — capabilities + durations persistence, wired via run-service.ts ─────────────────

test("WP1.7 (D-US4): an automated qlik_answers run persists its (enriched) capability manifest + SessionClock durations (GET /api/runs/:id surface)", async () => {
  const calls: FetchCall[] = [];
  const h = makeHarness({
    answersFetch: makeAnswersFetch({
      calls,
      answer: () => ({ text: "Q3 revenue was $4.2M, led by EMEA.", etag: "asst-v1" }),
    }),
  });
  const scenario = qlikScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;
  assert.equal(result.status, "completed");

  const summary = h.runRepo.getSummary(handle.runId);
  assert.ok(
    summary.capabilities,
    "run-service.ts threads runId into resolveAnswers() and wires QlikAnswersRunConfig.onCapabilities to RunRepository.setCapabilities",
  );
  assert.equal(summary.capabilities?.tokens, QLIK_ANSWERS_SESSION_CAPABILITIES.tokens);
  assert.equal(summary.capabilities?.costBasis, QLIK_ANSWERS_SESSION_CAPABILITIES.costBasis);
  // The manifest is ENRICHED with the resolved assistant identity (appId + version), not just the base.
  assert.equal(summary.capabilities?.identity?.kind, "qlik_assistant");
  assert.equal(summary.capabilities?.identity?.assistantId, ASSISTANT_ID);
  assert.equal(summary.capabilities?.identity?.appId, APP_ID);
  assert.equal(typeof summary.activeDurationMs, "number");
  assert.equal(typeof summary.totalDurationMs, "number");
});

// ── WP1.7 (D-US1 follow-up) — the interactive run's persisted phase clears, never stuck at waiting_input ──

test("WP1.7 (D-US1 follow-up): an interactive qlik_answers run's persisted phase clears (not left at waiting_input) once a wait resolves via a real follow-up turn", async () => {
  const calls: FetchCall[] = [];
  let promptCount = 0;
  let unblockSecond: (() => void) | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      hasSignal: init?.signal != null,
    });
    if (url.endsWith("/messages")) {
      return jsonResponse({
        data: [cardMessage("Opener answer.", "msg-0"), cardMessage("Follow-up answer.", "msg-1")],
      });
    }
    if (url.endsWith("/actions/stream")) {
      const idx = promptCount;
      promptCount += 1;
      if (idx === 1) {
        // Hang the SECOND prompt until the test unblocks it — keeps the run mid-turn (its wait already
        // resolved normally, so its phase already cleared to null) long enough to observe the DB write
        // deterministically, with no race against the run re-entering `waiting_input` for a 3rd turn.
        await new Promise<void>((resolve) => {
          unblockSecond = resolve;
        });
      }
      return sseResponse([`data: {"messageId":"msg-${idx}"}\n`]);
    }
    if (url.endsWith("/cloud-assistants/threads")) return jsonResponse({ id: "thread-1" });
    if (url.includes("/api/v1/assistants/")) {
      return jsonResponse({ id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] });
    }
    throw new Error(`unexpected tenant URL in stub: ${url}`);
  };

  const h = makeHarness({ answersFetch: fetchImpl });
  const scenario = qlikScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "interactive");
  await waitFor(() => h.runService.isAwaitingInput(handle.runId));
  assert.equal(
    h.runRepo.getSummary(handle.runId).phase,
    "waiting_input",
    "genuinely waiting on the operator",
  );

  h.runService.submitTurn(handle.runId, "And by region?");
  await waitFor(() => h.runRepo.getSummary(handle.runId).phase === undefined);
  assert.equal(
    h.runRepo.getSummary(handle.runId).phase,
    undefined,
    "GET /api/runs/:id reflects the clear — not left stuck at waiting_input",
  );

  unblockSecond?.();
  h.runService.stop(handle.runId);
  const result = await handle.done;
  assert.equal(result.status, "aborted");
});
