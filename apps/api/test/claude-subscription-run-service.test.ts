import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { NormalizedToolDefinition, RunStep } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
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
import {
  RunService,
  type ClaudeSubscriptionAuthResolver,
  type ModelFactory,
  type SessionOpener,
} from "../src/testing/run-service.js";
import { SUBSCRIPTION_SESSION_CAPABILITIES } from "../src/testing/session-capabilities.js";
import type { SupportedModelIdSource } from "../src/providers/subscription-models.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import {
  LIST_SKILL_FILES_TOOL,
  READ_SKILL_FILE_TOOL,
  SUBSCRIPTION_SKILLS_MCP_KEY,
} from "../src/testing/subscription-skill-tools.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// WP 1.2 (planning/Roadmap/RM-09-claude-subscription/) — the RunService `execute()` fork that routes a
// `claude_subscription` credential to the subscription executor (parallel to the acme_answers branch)
// instead of the AI-SDK agent loop. Exercised ENTIRELY through a SCRIPTED FAKE driver + a stub auth
// resolver: NO SDK is imported, NO child is spawned, NO Anthropic call is made, and the not-signed-in
// path degrades to an honest `auth` error (never a fabricated result). Non-subscription runs are proven
// to fall through UNCHANGED (agent loop opens its MCP session).

const NOW = "2026-07-13T00:00:00.000Z";
const SUB_PROMPT = "Summarize the taxi dataset.";
const SUB_AUTH: AssistantAuthSource = {
  kind: "claude_oauth",
  token: "sk-ant-oat01-fake-subscription-token",
};

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

// ── The scripted fake Agent-SDK driver (SDK-free; never spawns a child) ───────────────────────────

class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  onSend?: (text: string, session: FakeSession) => void;
  constructor(options: DriverStartOptions) {
    this.options = options;
    this.out.push({ type: "session", sessionId: "sess-fake" });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
    this.onSend?.(message.text, this);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  onStart?: (session: FakeSession) => void;
  onSend?: (text: string, session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options);
    session.onSend = this.onSend;
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
}

const TURN_DONE: DriverEvent = {
  type: "turn_done",
  usage: {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
};

// ── Control (non-subscription) doubles: a mock model + a stub MCP session ─────────────────────────

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

/** A `SkillFileInput` from plain text (WP 1.4 skill fixtures — mirrors `skill-context.test.ts`'s helper). */
function skillFile(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

// ── Harness ───────────────────────────────────────────────────────────────────────────────────────

type Harness = {
  db: AppDatabase;
  runService: RunService;
  runRepo: RunRepository;
  scenarioRepo: ScenarioRepository;
  testService: TestService;
  servers: ServerRepository;
  scans: ScanRepository;
  skills: SkillRepository;
  driver: FakeDriver;
  subProviderId: string;
  anthropicProviderId: string;
  sessionCalls: string[];
};

function makeHarness(opts: {
  driver?: FakeDriver;
  /** The injected subscription auth resolver — omit to construct WITHOUT one (defaults to null). */
  resolveAuth?: ClaudeSubscriptionAuthResolver;
  /** Omit the subscription DRIVER seam entirely (the "not configured" honest-failure case). */
  omitDriver?: boolean;
  /** The LIVE supported-model-id source (cache read only) — omit to construct WITHOUT strict validation. */
  subscriptionModels?: SupportedModelIdSource;
}): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));

  // A `claude_subscription` credential carries NO stored key (D-CS7) — its auth comes from the
  // injected resolver at run time, not this row.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-sub', 'claude_subscription', 'My Claude', NULL, NULL, @now, @now)`,
  ).run({ now: NOW });
  // A normal (non-subscription) credential + a scanned server, to prove the agent-loop path is intact.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-anthropic', 'anthropic', 'Claude API', NULL, @key, @now, @now)`,
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

  const modelFactory: ModelFactory = (_cred: DecryptedCredential) => mockAnswer();
  const sessionCalls: string[] = [];
  const sessionOpener: SessionOpener = async (config) => {
    sessionCalls.push(config.id);
    return stubSession();
  };

  const driver = opts.driver ?? new FakeDriver();
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
    undefined, // grades
    undefined, // issues
    opts.omitDriver ? undefined : driver,
    opts.resolveAuth,
    undefined, // subscriptionConcurrency
    opts.subscriptionModels,
  );

  return {
    db,
    runService,
    runRepo,
    scenarioRepo,
    testService,
    servers,
    scans,
    skills,
    driver,
    subProviderId: "prov-sub",
    anthropicProviderId: "prov-anthropic",
    sessionCalls,
  };
}

function subscriptionScenario(h: Harness) {
  return h.scenarioRepo.create({
    name: "Subscription env",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [], // tools-less at THIS WP (MCP is WP 1.3)
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12 },
    toolLoadingMode: "eager",
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

function makeTest(h: Harness) {
  return h.testService.create({ name: "Q1", userPrompt: SUB_PROMPT, addedProfiles: [] });
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

// ── Automated routing + config wiring ─────────────────────────────────────────────────────────────

test("automated: a claude_subscription run routes to the executor, opens NO MCP session, and completes", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_delta", text: "The average fare " });
    s.emit({ type: "assistant_message", text: "The average fare was $18.50." });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  // NOT clean-session structurally, but tools-less at THIS WP → no MCP session opened.
  assert.deepEqual(h.sessionCalls, [], "no MCP session opened for a subscription run");

  // Routed to the subscription executor: exactly one warm session driven with the opener prompt.
  assert.equal(driver.sessions.length, 1, "one subscription session started");
  assert.deepEqual(driver.sessions[0]?.sent, [SUB_PROMPT]);

  // Config sources threaded from scenario/test (SAME sources as the agent-loop path).
  const startOpts = driver.sessions[0]?.options;
  assert.equal(startOpts?.model, "claude-sonnet-4-5"); // scenario.model
  assert.equal(startOpts?.maxTurns, 12); // scenario.guardrails.maxTurns
  assert.equal(startOpts?.systemPrompt, "You are a data analyst agent."); // scenario systemPrompt
  assert.deepEqual(startOpts?.mcpServers, {}, "tools-less at THIS WP (WP 1.3 seam)");
  // Subscription-only auth injected into the child env; never an API key.
  assert.equal(startOpts?.env.CLAUDE_CODE_OAUTH_TOKEN, SUB_AUTH.token);
  assert.equal(startOpts?.env.ANTHROPIC_API_KEY, undefined);

  // Terminal + persisted answer the graders read.
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  const answerSteps = stepsByType(h, handle.runId, "llm_response");
  assert.equal(answerSteps.length, 1);
  assert.equal(answerSteps[0]?.assistantText, "The average fare was $18.50.");
  assert.equal(h.runRepo.getSummary(handle.runId).status, "completed");
});

test("automated (D-CS8): a scenario spend cap threads through resolveClaudeSubscription and stops the run (stopped_guardrail)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "The average fare was $18.50." });
    s.emit(TURN_DONE); // 100 input + 40 output on claude-sonnet-4-5 → a shadow cost of $0.0009
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  // A cap BELOW the single turn's shadow cost ($0.0009) → the run stops on the spend guardrail. This
  // exercises the full path: resolveClaudeSubscription reads scenario.guardrails.maxCostUsd (the SAME
  // source the agent-loop path uses) → the executor shadow-prices exact tokens → `>= maxCostUsd` stops it.
  const scenario = h.scenarioRepo.create({
    name: "Capped subscription env",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12, maxCostUsd: 0.0005 },
    toolLoadingMode: "eager",
  });
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /maxCostUsd/);
  assert.equal(h.runRepo.getSummary(handle.runId).status, "stopped");
});

// ── Interactive routing (branches to the interactive executor; user stop → aborted) ───────────────

test("interactive: a claude_subscription run branches to the interactive executor; a follow-up continues one warm session; stop → aborted", async () => {
  const driver = new FakeDriver();
  let turnNo = 0;
  driver.onSend = (_text, s) => {
    turnNo += 1;
    s.emit({ type: "assistant_message", text: `answer ${turnNo}` });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "interactive");
  // The run stays LIVE after the opener, awaiting the next turn (NOT terminal).
  await waitFor(() => h.runService.isAwaitingInput(handle.runId));
  assert.equal(h.runService.isActive(handle.runId), true, "an interactive subscription run stays live");

  // The follow-up turn (what POST /api/runs/:id/turns bridges into) continues the SAME warm session.
  h.runService.submitTurn(handle.runId, "And by product line?");
  await waitFor(() => stepsByType(h, handle.runId, "llm_response").length >= 2);

  assert.equal(driver.sessions.length, 1, "one warm session drove both turns");
  assert.deepEqual(driver.sessions[0]?.sent, [SUB_PROMPT, "And by product line?"]);

  // Stopping the session settles it (a user-ended interactive run → aborted, matching every other path).
  h.runService.stop(handle.runId);
  const result = await handle.done;
  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.turns, 2, "two answered turns");
});

// ── Honest degradation (D-CS7) ────────────────────────────────────────────────────────────────────

test("not signed in (auth resolver → null): the run degrades to an honest `auth` error, never a fake result", async () => {
  const driver = new FakeDriver();
  const h = makeHarness({ driver, resolveAuth: () => null });
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.match(result.stopReason ?? "", /signed-in Claude subscription/);
  assert.equal(driver.sessions.length, 0, "never started a child for a not-signed-in run");
  assert.deepEqual(h.sessionCalls, [], "and no MCP session either");
  // No fabricated success: no llm_response step, and the persisted summary is a terminal error.
  assert.equal(stepsByType(h, handle.runId, "llm_response").length, 0);
  assert.equal(h.runRepo.getSummary(handle.runId).status, "error");
});

test("no auth resolver injected at all → still degrades to an honest `auth` error (defaults to null)", async () => {
  const driver = new FakeDriver();
  const h = makeHarness({ driver }); // no resolveAuth
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const result = await h.runService.start(testRow.id, scenario.id, "automated").done;
  assert.equal(result.status, "error");
  assert.match(result.stopReason ?? "", /signed-in Claude subscription/);
  assert.equal(driver.sessions.length, 0);
});

test("driver seam not configured → an honest terminal error (never a fake result)", async () => {
  const h = makeHarness({ omitDriver: true, resolveAuth: () => SUB_AUTH });
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const result = await h.runService.start(testRow.id, scenario.id, "automated").done;
  assert.equal(result.status, "error");
  assert.match(result.stopReason ?? "", /not configured/);
  assert.deepEqual(h.sessionCalls, [], "no MCP session for a misconfigured subscription run");
});

// ── Non-subscription runs are unchanged (byte-for-byte fallthrough) ───────────────────────────────

// ── WP 1.3: MCP tools via the Agent SDK mcpServers option (server → config + allow patterns) ───────

/** Complete a running scan for `serverId` exposing exactly `toolNames` (mirrors makeHarness's scan). */
function scanServerWithTools(h: Harness, serverId: string, toolNames: string[]): void {
  const scan = h.scans.createRunningScan(serverId, "generic_o200k");
  h.scans.completeScan(
    scan.id,
    {
      totalTools: toolNames.length,
      totalTokens: 0,
      totalRawBytes: 0,
      averageTokensPerTool: 0,
      largestToolName: toolNames[0] ?? "",
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
    toolNames.map((name) => ({
      toolName: name,
      description: `${name} tool`,
      inputSchema: { type: "object" },
      annotations: undefined,
      rawTool: {},
      totalTokens: 0,
      nameTokens: 0,
      descriptionTokens: 0,
      schemaTokens: 0,
      annotationsTokens: 0,
      rawBytes: 0,
      contributionPercent: 0,
    })),
  );
}

test("subscription run with an allow-listed STDIO server → the SDK mcpServers entry + allow patterns + a default-deny gate; NO MCP session opened", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "answer" });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  // srv-1 (stdio, command "noop") is already scanned with the tool "alpha" in makeHarness.
  const scenario = h.scenarioRepo.create({
    name: "Subscription env + tools",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [{ serverId: "srv-1", allowedTools: ["alpha"] }],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12 },
    toolLoadingMode: "eager",
  });
  const testRow = makeTest(h);

  const result = await h.runService.start(testRow.id, scenario.id, "automated").done;
  assert.equal(result.status, "completed");

  // The SDK connects/spawns the server in ITS child, so the run service opens NO McpSession.
  assert.deepEqual(h.sessionCalls, [], "no McpSession opened — the Agent SDK owns the connections");

  const opts = h.driver.sessions[0]!.options;
  // (a) The stdio server maps to the SDK stdio config (empty args/env are omitted).
  assert.deepEqual(opts.mcpServers, { "srv-1": { type: "stdio", command: "noop" } });
  // Allow patterns are the fully-qualified `mcp__<serverKey>__<toolName>` names.
  assert.deepEqual([...(opts.allowedTools ?? [])], ["mcp__srv-1__alpha"]);

  // (b) A non-allow-listed tool is genuinely uncallable (default-deny gate); the allow-listed one runs.
  const signal = new AbortController().signal;
  const allow = await opts.canUseTool!({ toolName: "mcp__srv-1__alpha", input: {}, toolUseId: "a", signal });
  assert.equal(allow.behavior, "allow");
  const deny = await opts.canUseTool!({ toolName: "mcp__srv-1__beta", input: {}, toolUseId: "b", signal });
  assert.equal(deny.behavior, "deny");
});

test("subscription run with an allow-listed streamable-HTTP server → the SDK http config carries the resolved auth headers", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "answer" });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  // A streamable-HTTP server with a custom auth header (encrypted at rest; decrypted for the child).
  const httpServer = h.servers.create({
    name: "HTTP tool server",
    transport: "streamable_http",
    url: "https://mcp.example.com/rpc",
    headers: { "X-Api-Key": "secret-header-value" },
  });
  scanServerWithTools(h, httpServer.id, ["htool"]);

  const scenario = h.scenarioRepo.create({
    name: "Subscription env + http",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [{ serverId: httpServer.id, allowedTools: ["htool"] }],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12 },
    toolLoadingMode: "eager",
  });
  const testRow = makeTest(h);

  const result = await h.runService.start(testRow.id, scenario.id, "automated").done;
  assert.equal(result.status, "completed");
  assert.deepEqual(h.sessionCalls, [], "no McpSession opened for the http server either");

  const opts = h.driver.sessions[0]!.options;
  assert.deepEqual(opts.mcpServers, {
    [httpServer.id]: {
      type: "http",
      url: "https://mcp.example.com/rpc",
      headers: { "X-Api-Key": "secret-header-value" },
    },
  });
  assert.deepEqual([...(opts.allowedTools ?? [])], [`mcp__${httpServer.id}__htool`]);
});

test("a NON-subscription run still opens its MCP session and runs the agent loop (unchanged)", async () => {
  const driver = new FakeDriver();
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const scenario = anthropicScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  // The agent-loop path is UNCHANGED: it opened the allow-listed server's session, and the
  // subscription driver was NEVER touched.
  assert.deepEqual(h.sessionCalls, ["srv-1"], "the agent loop opened the MCP session");
  assert.equal(driver.sessions.length, 0, "the subscription driver is never used for a non-subscription run");
  assert.equal(result.status, "completed");
  assert.ok(stepsByType(h, handle.runId, "llm_response").length >= 1);
});

// ── WP 1.4 (D-CS9, skills half): attached skills, resolved + materialized on the subscription path ──

/** Create + version a "pdf-processing" skill, returning its skillId/versionId/versionLabel. */
function seedSkill(h: Harness): { skillId: string; versionId: string; versionLabel: string } {
  const skill = h.skills.create({
    name: "pdf-processing",
    sourceType: "upload",
    description: "Extract PDF text, fill forms, merge PDFs.",
  });
  const { version } = h.skills.createVersion(
    skill.id,
    [
      skillFile("SKILL.md", "---\nname: pdf-processing\ndescription: Extract PDF text.\n---\nUse pdftk."),
      skillFile("reference.md", "See appendix for the full CLI reference."),
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-processing", description: "Extract PDF text." },
    },
  );
  return { skillId: skill.id, versionId: version.id, versionLabel: version.versionLabel };
}

test("a claude_subscription run with an attached skill: resolves + persists run_skills, prepends the L1 block, and wires the skills mcpServer/allowedTools/additionalDirectories", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "Used the skill." });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const seeded = seedSkill(h);
  const scenario = h.scenarioRepo.create({
    name: "Subscription env + skill",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [],
    allowedSkills: [{ skillId: seeded.skillId, versionMode: "latest" }],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12 },
    toolLoadingMode: "eager",
  });
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;
  assert.equal(result.status, "completed");

  // The L1 <available_skills> metadata block is prepended to the SAME base system prompt.
  const opts = h.driver.sessions[0]!.options;
  assert.match(opts.systemPrompt, /<available_skills>/);
  assert.match(opts.systemPrompt, /pdf-processing/);
  assert.match(opts.systemPrompt, /You are a data analyst agent\.$/);

  // The skills in-process MCP server + its two allow patterns are wired (no MCP servers were
  // allow-listed, so the skill tools are the ONLY thing gating a default-deny canUseTool).
  assert.ok(opts.mcpServers[SUBSCRIPTION_SKILLS_MCP_KEY], "the skills mcpServer entry is present");
  assert.deepEqual(
    [...(opts.allowedTools ?? [])].sort(),
    [
      `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${LIST_SKILL_FILES_TOOL}`,
      `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${READ_SKILL_FILE_TOOL}`,
    ].sort(),
  );
  assert.ok(Array.isArray(opts.additionalDirectories) && opts.additionalDirectories.length === 1);

  // The resolution is persisted exactly like the AI-SDK path's, so the run console's Skills panel
  // (`RunDetail.skills`) renders identically for a subscription run.
  const detail = h.runRepo.getRun(handle.runId);
  assert.equal(detail.skills.length, 1);
  assert.equal(detail.skills[0]?.skillId, seeded.skillId);
  assert.equal(detail.skills[0]?.skillVersionId, seeded.versionId);
  assert.equal(detail.skills[0]?.versionLabel, seeded.versionLabel);
  assert.equal(detail.skills[0]?.eager, false);
  assert.notEqual(detail.skills[0]?.footprint, null, "the resolved version's footprint joins in");
});

test("a claude_subscription run with NO attached skills: no run_skills rows, system prompt unchanged, no skills mcpServer", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const scenario = subscriptionScenario(h); // allowedSkills: []
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;
  assert.equal(result.status, "completed");

  const opts = h.driver.sessions[0]!.options;
  assert.equal(opts.systemPrompt, "You are a data analyst agent.", "no L1 block prepended");
  assert.deepEqual(opts.mcpServers, {}, "no skills mcpServer entry");
  assert.equal(opts.allowedTools, undefined);
  assert.equal(opts.additionalDirectories, undefined);

  const detail = h.runRepo.getRun(handle.runId);
  assert.deepEqual(detail.skills, [], "no resolved skills persisted");
});

test("a claude_subscription run with a PINNED skill attachment resolves the pinned version, not whatever is current", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const seeded = seedSkill(h);
  // Publish a v2 so "latest" would differ from the pinned v1.
  h.skills.createVersion(
    seeded.skillId,
    [skillFile("SKILL.md", "---\nname: pdf-processing\ndescription: v2.\n---\nv2 body")],
    { sourceKind: "upload", importedFrom: "upload", manifest: { name: "pdf-processing", description: "v2" } },
  );
  const scenario = h.scenarioRepo.create({
    name: "Subscription env + pinned skill",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [],
    allowedSkills: [{ skillId: seeded.skillId, versionMode: "pinned", pinnedVersionId: seeded.versionId }],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12 },
    toolLoadingMode: "eager",
  });
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  await handle.done;

  const detail = h.runRepo.getRun(handle.runId);
  assert.equal(detail.skills.length, 1);
  assert.equal(detail.skills[0]?.skillVersionId, seeded.versionId, "pinned stays on the fixed version");
});

// ── LIVE-roster model validation (planning/Roadmap/RM-09-claude-subscription/ follow-up) ───────────────────────────
// `resolveClaudeSubscription` rejects a run whose selected model the signed-in subscription does NOT
// offer — but ONLY when the LIVE list is available from the resolver's cache (no hot-path spawn). When
// the live list is unavailable (fallback in effect → `cachedSupportedModelIds()` returns undefined) the
// guard is skipped so a transient list failure never blocks a run.

test("resolveClaudeSubscription rejects a run whose model the LIVE subscription list does not offer", async () => {
  const driver = new FakeDriver();
  // A live set that does NOT contain the scenario's model (`claude-sonnet-4-5`) — the stale id.
  const supported: SupportedModelIdSource = {
    cachedSupportedModelIds: () => new Set(["claude-opus-4-8", "claude-sonnet-5", "claude-fable-5"]),
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH, subscriptionModels: supported });
  const scenario = subscriptionScenario(h); // model: claude-sonnet-4-5
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;

  assert.equal(result.status, "error");
  assert.match(result.stopReason ?? "", /not offered by the signed-in Claude subscription/);
  // Rejected BEFORE any child was spawned — no driver session was ever started.
  assert.equal(driver.sessions.length, 0);
  // The honest terminal error is persisted (not a fabricated result).
  assert.equal(h.runRepo.getSummary(handle.runId).status, "error");
});

test("resolveClaudeSubscription does NOT validate when the live list is UNAVAILABLE (fallback in effect)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "Answer." });
    s.emit(TURN_DONE);
  };
  // `undefined` = the resolver fell back / cache is cold → skip strict validation.
  const supported: SupportedModelIdSource = { cachedSupportedModelIds: () => undefined };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH, subscriptionModels: supported });
  const scenario = subscriptionScenario(h); // model: claude-sonnet-4-5 (would be rejected if validated)
  const testRow = makeTest(h);

  const result = await h.runService.start(testRow.id, scenario.id, "automated").done;

  // No rejection: the run reaches the executor and completes.
  assert.equal(result.status, "completed");
  assert.equal(driver.sessions.length, 1);
});

// ── WP1.7 (D-US4) — capabilities + durations persistence, wired via run-service.ts ─────────────────

test("WP1.7 (D-US4): an automated claude_subscription run persists its capability manifest + SessionClock durations (GET /api/runs/:id surface)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "Answer." });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  const result = await handle.done;
  assert.equal(result.status, "completed");

  const summary = h.runRepo.getSummary(handle.runId);
  assert.deepEqual(
    summary.capabilities,
    SUBSCRIPTION_SESSION_CAPABILITIES,
    "run-service.ts wires ClaudeSubscriptionRunConfig.recordCapabilities to RunRepository.setCapabilities",
  );
  assert.equal(typeof summary.activeDurationMs, "number");
  assert.equal(typeof summary.totalDurationMs, "number");
});

// ── WP1.7 (D-US1 follow-up) — the interactive run's persisted phase clears, never stuck at waiting_input ──

test("WP1.7 (D-US1 follow-up): an interactive claude_subscription run's persisted phase is `waiting_input` while genuinely waiting, then clears (not left stuck) once stopped", async () => {
  const driver = new FakeDriver();
  driver.onSend = (_text, s) => {
    s.emit({ type: "assistant_message", text: "answer" });
    s.emit(TURN_DONE);
  };
  const h = makeHarness({ driver, resolveAuth: () => SUB_AUTH });
  const scenario = subscriptionScenario(h);
  const testRow = makeTest(h);

  const handle = h.runService.start(testRow.id, scenario.id, "interactive");
  await waitFor(() => h.runService.isAwaitingInput(handle.runId));
  await waitFor(() => h.runRepo.getSummary(handle.runId).phase === "waiting_input");
  assert.equal(h.runRepo.getSummary(handle.runId).phase, "waiting_input", "genuinely waiting on the operator");

  h.runService.stop(handle.runId);
  const result = await handle.done;
  assert.equal(result.status, "aborted");

  const summary = h.runRepo.getSummary(handle.runId);
  assert.equal(summary.phase, undefined, "GET /api/runs/:id reflects the clear — not left stuck at waiting_input");
  // Task A, mirrored here: durations are recorded on a non-completed terminal too, not just "completed".
  assert.equal(typeof summary.activeDurationMs, "number");
  assert.equal(typeof summary.totalDurationMs, "number");
});
