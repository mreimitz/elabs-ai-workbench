// Assistant Hub — hub-fixes WP2.1 (RC2): the turn-engine mission agent runner. Driven by STUBBED models
// + a STUBBED MCP session (no provider key, no live MCP server), it proves that a planned mission agent
// now runs as a REAL child hub session through the turn engine — granted MCP tools callable, tool calls
// persisted into the CHILD log, real usage/cost — then a bounded structured extraction yields the report.
//
// Proves (per-Acceptance):
//   • [session] a plan with per-agent grants → the child session log contains tool_call + tool_result for
//     a GRANTED read-only MCP tool → the report validates against `hubAgentReportSchema` → synthesis runs;
//   • [negative] the child's `toolScope` is exactly the plan grants — a server OUTSIDE the grants is never
//     scoped in, so the agent can never call it;
//   • [approvals] per-tool approval was REMOVED (owner decision) — a NON-read-only (write) granted MCP
//     tool RUNS with no approval card and no auto-declined note, just like a read-only one;
//   • [usage] the runner returns the child turn's REAL accumulated tokens/cost PLUS the extraction call's —
//     never a hardcoded zero;
//   • [rollback] `HUB_AGENT_RUNNER=structured` (agentRunnerMode "structured") restores the OLD one-shot
//     path byte-compatibly (a synthetic report message written on the child by the orchestrator itself).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  hubAgentReportSchema,
  type HubAgentReport,
  type HubCitation,
  type HubEvent,
  type HubMissionPlan,
  type HubServerToolGrant,
  type HubToolGrants,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSessionService,
  type HubAgentTurnResult,
  type HubMcpGrantInputs,
} from "../src/hub/session-service.js";
import type { HubTurnResult } from "../src/hub/turn-engine.js";
import {
  createSessionAgentRunner,
  HubMissionService,
  type HubAgentRunInput,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";
import type { McpSession } from "../src/mcp/client.js";
import type { HubMcpServerCatalog } from "../src/hub/tools/index.js";
import { DEFAULT_CHAT_BUILTIN_NAMES } from "../src/hub/tools/index.js";
import { estimateCost } from "../src/providers/pricing.js";

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}
function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-agent-runner-"));
  tempDirs.push(dir);
  return dir;
}

const PRICED_MODEL = "gpt-4o"; // a priced model so the turn + extraction cost are genuinely non-zero

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const STREAM_USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 12, text: 12, reasoning: 0 },
} as const;
/** The V3 nested usage the extraction `doGenerate` reports; the SDK surfaces `.usage.inputTokens` = the
 *  nested `.total`, so the runner sees 20 in / 10 out for the extraction call. */
const GEN_USAGE = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
} as const;
const GEN_TOKENS_IN = 20;
const GEN_TOKENS_OUT = 10;

/** A schema-valid structured report — what the stubbed EXTRACTION model returns for every agent. */
const AGENT_REPORT: HubAgentReport = {
  summary: "Completed the assigned investigation slice.",
  findings: [{ summary: "A concrete finding grounded in the tool result.", confidence: "high" }],
  citations: [],
  artifacts: [],
  confidence: "high",
  openQuestions: [],
};

/** A stub MCP session whose `callTool` returns a fixed textual result. */
function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [{ type: "text", text: "tool ran: ok" }] }),
    close: async () => undefined,
  };
}

type ToolSpec = { name: string; readOnly: boolean };

/** Build a scanned-catalog entry for one server exposing one tool (optionally read-only-annotated). */
function serverCatalog(serverName: string, tool: ToolSpec): HubMcpServerCatalog {
  return {
    serverName,
    tools: [
      {
        name: tool.name,
        description: `The ${tool.name} tool.`,
        inputSchema: { type: "object", properties: { message: { type: "string" } } },
        ...(tool.readOnly ? { annotations: { readOnlyHint: true } } : {}),
        raw: {},
      },
    ],
  };
}

/**
 * A faithful scope-HONORING MCP grants provider (mirrors production `resolveHubMcpGrants`, WP1.2): given a
 * catalog of servers, it grants ONLY the servers present in `ctx.session.toolScope.servers` — an
 * absent-from-the-scope server is never exposed. Records the scopes it saw + the server ids it granted so
 * the negative test can assert the child was scoped to exactly the plan grants.
 */
function scopeHonoringGrants(
  catalog: Map<string, HubMcpServerCatalog>,
  record: { scopes: Array<HubToolGrants | null | undefined>; granted: string[][] },
) {
  return (ctx: { session: { toolScope?: HubToolGrants | null } }): HubMcpGrantInputs | null => {
    const scope = ctx.session.toolScope ?? null;
    record.scopes.push(scope);
    const grantServers: Record<string, HubServerToolGrant> = {};
    const scoped = new Map<string, HubMcpServerCatalog>();
    const sessions = new Map<string, McpSession>();
    for (const [serverId, entry] of catalog) {
      const grant: HubServerToolGrant | undefined = scope ? scope.servers[serverId] : "all";
      if (grant === undefined) continue; // scoped-out server — never exposed
      grantServers[serverId] = grant;
      scoped.set(serverId, entry);
      sessions.set(serverId, stubSession());
    }
    record.granted.push(Object.keys(grantServers));
    if (Object.keys(grantServers).length === 0) return null;
    return {
      grants: { servers: grantServers, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
      catalog: scoped,
      sessions,
      sink: { toolCall: () => undefined },
    };
  };
}

/** A turn model that calls the named tool once (with `{message}`), then answers with a short reply. */
function turnModelCalling(toolName: string): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tc-1",
                toolName,
                input: JSON.stringify({ message: "investigate" }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: STREAM_USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Investigation complete." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: STREAM_USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

/** An extraction model (generateObject) that returns the schema-valid report. */
function extractionModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(AGENT_REPORT) }],
      finishReason: "stop",
      usage: GEN_USAGE,
      warnings: [],
    }),
  }) as unknown as LanguageModel;
}

const MISSION_CONFIG: HubMissionServiceConfig = {
  maxAgents: 6,
  maxParallel: 3,
  defaultBudgetUsd: 2.0,
  maxBudgetUsd: 10.0,
  askAboveAgents: 3,
  askAboveUsd: 1.0,
  defaultAutonomy: "auto",
};

function sessionServiceWith(opts: {
  repo: HubRepository;
  mcpGrantsProvider: (ctx: { session: { id: string; toolScope?: HubToolGrants | null } }) => HubMcpGrantInputs | null;
  buildTurnModel: () => MockLanguageModelV3;
}): HubSessionService {
  return new HubSessionService({
    repository: opts.repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: PRICED_MODEL,
      contextWindow: 128_000,
      buildModel: () => opts.buildTurnModel() as never,
    }),
    mcpGrantsProvider: (ctx) => opts.mcpGrantsProvider(ctx),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager", // scoped grants → immediately callable (no tool_search dance)
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25_000 },
    },
  });
}

/** A stub planner returning a fixed single-agent plan granting the given servers, on the given model. */
function plannerGranting(grants: HubToolGrants, model: string = PRICED_MODEL): HubPlanner {
  return async (): Promise<HubMissionPlan> => ({
    topology: "parallel",
    autonomy: "auto",
    agents: [
      {
        key: "agent-1",
        name: "Investigator",
        systemPrompt: "You are a focused investigator.",
        model,
        toolGrants: grants,
        skillIds: [],
        brief: "Investigate the target and report your findings.",
        target: "Investigate the target.",
        expectedOutcome: "A short structured report.",
      },
    ],
  });
}

const synthesizerStub: HubSynthesizer = async () => ({
  text: "Synthesis: the agent investigated and reported [1].",
  usage: { tokensIn: 15, tokensOut: 10 },
  costUsd: 0.02,
});

function collectSink() {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e: HubEvent) => events.push(e), onDelta: () => undefined }, events };
}

function childEvents(repo: HubRepository, parentSessionId: string): { childId: string; events: HubEvent[] } {
  const childIds = repo.listChildSessionIds(parentSessionId);
  assert.equal(childIds.length, 1, "exactly one child agent session was spawned");
  const childId = childIds[0]!;
  return { childId, events: repo.listEvents(childId) };
}

// ── [session] granted read-only MCP tool called end-to-end; report validates; synthesis runs ──────────

test("mission-e2e-stub: a granted read-only MCP tool is called in the child turn; report validates; synthesis runs", async () => {
  const repo = openRepo();
  const record = { scopes: [] as Array<HubToolGrants | null | undefined>, granted: [] as string[][] };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-1", serverCatalog("Research server", { name: "readtool", readOnly: true })],
  ]);
  const sessionService = sessionServiceWith({
    repo,
    mcpGrantsProvider: scopeHonoringGrants(catalog, record),
    buildTurnModel: () => turnModelCalling("readtool"),
  });
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session" },
    planner: plannerGranting({ servers: { "srv-1": "all" }, builtins: [] }),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(),
    }),
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });

  const session = repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Investigate the target.", sink });

  assert.equal(result.status, "completed", "the mission completed");

  // The child's toolScope was persisted = the plan grants (srv-1 only).
  const { childId, events: log } = childEvents(repo, session.id);
  const child = repo.getSession(childId);
  assert.deepEqual(
    child.toolScope,
    { servers: { "srv-1": "all" }, builtins: [] },
    "the child agent session persisted the plan grants as its tool scope",
  );

  // The child session log contains a tool_call + tool_result for the GRANTED read-only MCP tool.
  const toolCall = log.find(
    (e): e is Extract<HubEvent, { type: "tool_call" }> => e.type === "tool_call",
  );
  assert.equal(toolCall?.part.toolName, "readtool", "the granted MCP tool was called in the child turn");
  assert.equal(toolCall?.part.source, "mcp", "the call is tagged mcp-source");
  assert.equal(toolCall?.part.serverId, "srv-1", "the call carries its origin server");
  const toolResult = log.find(
    (e): e is Extract<HubEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
  assert.equal(toolResult?.state, "output-available", "the granted read-only tool produced a real result");

  // A read-only-annotated tool auto-runs under mission `auto` — no approval was ever requested.
  assert.equal(
    log.some((e) => e.type === "approval_requested"),
    false,
    "a read-only-annotated MCP tool auto-runs (no approval gate) under mission auto",
  );

  // The agent report reached the board (parent log) and validates against the schema.
  const agentReport = events.find(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  );
  assert.ok(agentReport, "the board received an agent_report");
  assert.doesNotThrow(
    () => hubAgentReportSchema.parse(agentReport!.report),
    "the extracted report validates against hubAgentReportSchema",
  );
  assert.equal(agentReport!.report.agentSessionId, childId, "the report is stamped with the child id");

  // Synthesis ran (the parent's mission_synthesis event landed).
  assert.ok(
    events.some((e) => e.type === "mission_synthesis"),
    "synthesis ran after the agent report",
  );
});

// ── [negative] the child can NEVER be scoped to a server outside its grants ───────────────────────────

test("negative: an agent is scoped to exactly its plan grants — a non-granted server is never exposed", async () => {
  const repo = openRepo();
  const record = { scopes: [] as Array<HubToolGrants | null | undefined>, granted: [] as string[][] };
  // The catalog exposes TWO servers, but the plan grants only srv-1.
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-1", serverCatalog("Granted server", { name: "readtool", readOnly: true })],
    ["srv-2", serverCatalog("Forbidden server", { name: "forbiddentool", readOnly: true })],
  ]);
  const sessionService = sessionServiceWith({
    repo,
    mcpGrantsProvider: scopeHonoringGrants(catalog, record),
    buildTurnModel: () => turnModelCalling("readtool"),
  });
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session" },
    planner: plannerGranting({ servers: { "srv-1": "all" }, builtins: [] }),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(),
    }),
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });

  const session = repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  await mission.proposePlan({ sessionId: session.id, text: "Investigate.", sink });

  const { childId, events: log } = childEvents(repo, session.id);
  const child = repo.getSession(childId);

  // The child's scope carries ONLY srv-1 — srv-2 is not in it.
  assert.deepEqual(child.toolScope?.servers, { "srv-1": "all" }, "the child scope is exactly the plan grants");
  assert.equal(child.toolScope?.servers["srv-2"], undefined, "srv-2 (outside the grants) is not scoped in");

  // The scope-honoring grants provider saw the child's srv-1-only scope and granted ONLY srv-1.
  assert.ok(record.granted.length >= 1, "the grants provider ran for the child turn");
  for (const granted of record.granted) {
    assert.ok(!granted.includes("srv-2"), "srv-2 was never granted to the child agent");
  }

  // No tool call in the child log ever targeted srv-2 (the forbidden server is uncallable).
  const srv2Calls = log.filter(
    (e): e is Extract<HubEvent, { type: "tool_call" }> =>
      e.type === "tool_call" && e.part.serverId === "srv-2",
  );
  assert.equal(srv2Calls.length, 0, "the agent never called the non-granted server's tool");
});

// ── [approvals] a NON-read-only granted tool RUNS with no approval (per-tool approval removed) ─────────

test("approvals: a non-read-only granted MCP tool RUNS with no approval card and no auto-declined note", async () => {
  const repo = openRepo();
  const record = { scopes: [] as Array<HubToolGrants | null | undefined>, granted: [] as string[][] };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-1", serverCatalog("Write server", { name: "writetool", readOnly: false })],
  ]);
  const sessionService = sessionServiceWith({
    repo,
    mcpGrantsProvider: scopeHonoringGrants(catalog, record),
    buildTurnModel: () => turnModelCalling("writetool"),
  });
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session" },
    planner: plannerGranting({ servers: { "srv-1": "all" }, builtins: [] }),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(),
    }),
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });

  const session = repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  await mission.proposePlan({ sessionId: session.id, text: "Do the work.", sink });

  const { events: log } = childEvents(repo, session.id);

  // Owner decision: a granted tool is authorization enough — even a non-read-only (write) tool RUNS with
  // no approval card (previously it was gated closed / auto-declined under mission auto).
  assert.ok(
    !log.some((e) => e.type === "approval_requested"),
    "a non-read-only MCP tool runs with no approval gate",
  );
  const result = log.find(
    (e): e is Extract<HubEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
  assert.equal(result?.state, "output-available", "the write tool ran to a real result");

  // The report carries NO auto-declined note — nothing was gated.
  const agentReport = events.find(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  );
  assert.ok(
    !agentReport!.report.openQuestions.some((q) => q.includes("auto-declined")),
    "no auto-declined note — the tool was not gated",
  );
});

// ── [usage] the runner returns REAL accumulated usage/cost — no hardcoded zeros ────────────────────────

test("real-usage: the session runner mirrors the child turn's tokens/cost plus the extraction (no hardcoded zeros)", async () => {
  const repo = openRepo();
  // A minimal in-memory child so the runner's transcript read + extraction has something to read.
  const child = repo.createSession({ mode: "chat", model: PRICED_MODEL, kind: "agent" });
  repo.appendEvent(child.id, { type: "user_message", messageId: "u1", text: "Investigate." });

  const turnUsage: HubTurnResult = {
    status: "completed",
    outcome: "completed",
    costUsd: 0.05,
    tokensIn: 100,
    tokensOut: 50,
    activeDurationMs: 10,
    totalDurationMs: 10,
    completed: true,
  };
  const runner = createSessionAgentRunner({
    // Stub the turn seam directly with REAL non-zero usage the turn engine would have accumulated.
    runAgentTurn: async (): Promise<HubAgentTurnResult> => ({ result: turnUsage, deniedToolCalls: 0 }),
    repository: repo,
    buildModel: () => extractionModel(),
  });

  const input: HubAgentRunInput = {
    agentSessionId: child.id,
    missionId: "m1",
    key: "agent-1",
    roleName: "Investigator",
    model: PRICED_MODEL,
    systemPrompt: "role prompt",
    roleTemplate: {
      roleName: "Investigator",
      roleSystemPrompt: "You investigate.",
      briefTarget: "the target",
      briefInputs: "Investigate.",
      expectedOutcome: "A report.",
      agentBudget: "none",
    },
    brief: "Investigate.",
    expectedOutcome: "A report.",
    abortSignal: new AbortController().signal,
  };
  const out = await runner(input);

  assert.doesNotThrow(() => hubAgentReportSchema.parse(out.report), "the runner returns a valid report");
  // Tokens = turn tokens + extraction tokens (GEN_USAGE = 20 in / 10 out).
  assert.equal(out.tokensIn, 100 + GEN_TOKENS_IN, "tokensIn = child turn + extraction");
  assert.equal(out.tokensOut, 50 + GEN_TOKENS_OUT, "tokensOut = child turn + extraction");
  // Cost = the REAL turn cost + the priced extraction cost — strictly greater than the turn cost alone,
  // and never the old hardcoded zero.
  const extractionCost = estimateCost(PRICED_MODEL, {
    inputTokens: GEN_TOKENS_IN,
    outputTokens: GEN_TOKENS_OUT,
  });
  assert.ok(extractionCost > 0, "the priced extraction call has a real cost");
  assert.equal(out.costUsd, 0.05 + extractionCost, "costUsd = child turn cost + extraction cost");
  assert.ok(out.costUsd > 0, "the runner never returns a hardcoded zero cost");
});

// ── [rollback] HUB_AGENT_RUNNER=structured restores the old one-shot path byte-compatibly ─────────────

test("rollback: agentRunnerMode 'structured' writes the synthetic child report message (old path, byte-compatible)", async () => {
  const repo = openRepo();
  const inputs: HubAgentRunInput[] = [];
  // The STRUCTURED runner returns a report directly (it does NOT drive a child turn) — the orchestrator
  // itself writes the child's brief + synthetic report message + terminal, exactly as pre-WP2.1.
  const structuredRunner = async (input: HubAgentRunInput) => {
    inputs.push(input);
    return { report: AGENT_REPORT, costUsd: 0, tokensIn: 42, tokensOut: 21 };
  };
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "structured" },
    planner: plannerGranting({ servers: {}, builtins: [] }),
    runAgent: structuredRunner,
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });

  const session = repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Investigate.", sink });
  assert.equal(result.status, "completed", "the structured mission completed");

  const { childId, events: log } = childEvents(repo, session.id);
  // The orchestrator wrote the isolated brief as the child's SOLE user turn.
  const userTurns = log.filter((e) => e.type === "user_message");
  assert.equal(userTurns.length, 1, "the structured path wrote exactly one child brief user_message");
  // The orchestrator wrote a SYNTHETIC assistant_message rendering the report prose (the old shape).
  const assistant = log.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
  assert.ok(assistant, "the structured path wrote a synthetic child report message");
  assert.ok(
    assistant!.parts.some((p) => p.type === "text" && p.text.includes("Completed the assigned")),
    "the synthetic message renders the report prose",
  );
  // The child settled completed with the runner's usage (byte-compatible with the old path).
  const child = repo.getSession(childId);
  assert.equal(child.status, "completed");
  assert.equal(child.tokensIn, 42, "the child carries the structured runner's tokens");
  // The STRUCTURED runner still receives a system prompt (the tools-less role prompt) as before.
  assert.ok(inputs[0]!.systemPrompt.length > 0, "the structured runner still gets the assembled role prompt");
});

// ── [Defect 2] the report-extraction step no longer FAILS an agent that produced a real answer ─────────
//
// A Qlik-Answers FACADE model (`assistant|<server>|<assistant>`) has no structured-output mode, so the
// old runner — which extracted with the AGENT's own model — threw and wrongly marked such an agent
// `error`, discarding its real findings. The fix: extract with the PARENT/mission model (never the agent
// model), and on a structured-incapable extraction model (or an extraction failure) fall back to a
// DETERMINISTIC projection of the agent's settled prose so the work is never dropped.

const FACADE_MODEL = "assistant|hsbc|sales-analytics";

/** A completed-turn result stub (real accumulated usage) for the direct-runner tests. */
function completedTurn(): HubTurnResult {
  return {
    status: "completed",
    outcome: "completed",
    costUsd: 0.05,
    tokensIn: 100,
    tokensOut: 50,
    activeDurationMs: 10,
    totalDurationMs: 10,
    completed: true,
  };
}

/** A turn model that answers with fixed prose and calls no tool (a facade-agent shape). */
function turnModelAnswering(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: STREAM_USAGE },
        ] as V3Part[],
      }),
    }),
  });
}

/** Seed a child agent session with a settled prose message (optionally citations) so the runner's
 *  transcript read + report projection have real content. */
function seedChildWithProse(repo: HubRepository, prose: string, citations: HubCitation[] = []): string {
  const child = repo.createSession({ mode: "chat", model: FACADE_MODEL, kind: "agent" });
  repo.appendEvent(child.id, { type: "user_message", messageId: "u1", text: "Analyze." });
  repo.appendEvent(child.id, {
    type: "assistant_message",
    messageId: "a1",
    model: FACADE_MODEL,
    parts: [{ type: "text", text: prose }],
    citations,
    artifactsTouched: [],
  });
  return child.id;
}

/** A minimal runner input for the direct-runner tests. */
function runnerInput(agentSessionId: string, over: Partial<HubAgentRunInput> = {}): HubAgentRunInput {
  return {
    agentSessionId,
    missionId: "m1",
    key: "agent-1",
    roleName: "Investigator",
    model: FACADE_MODEL,
    systemPrompt: "role prompt",
    roleTemplate: {
      roleName: "Investigator",
      roleSystemPrompt: "You investigate.",
      briefTarget: "the target",
      briefInputs: "Analyze.",
      expectedOutcome: "A report.",
      agentBudget: "none",
    },
    brief: "Analyze.",
    expectedOutcome: "A report.",
    abortSignal: new AbortController().signal,
    ...over,
  };
}

test("defect-2: a facade extraction model skips the structured call and projects the child's prose", async () => {
  const repo = openRepo();
  const childId = seedChildWithProse(repo, "All five regions declined continuously across Q1–Q4 2026.");
  let buildModelCalls = 0;
  const runner = createSessionAgentRunner({
    runAgentTurn: async () => ({ result: completedTurn(), deniedToolCalls: 0 }),
    repository: repo,
    buildModel: () => {
      buildModelCalls += 1;
      return extractionModel();
    },
  });
  const out = await runner(runnerInput(childId, { model: FACADE_MODEL, extractionModel: FACADE_MODEL }));
  assert.equal(buildModelCalls, 0, "no structured-extraction call is made for a facade extraction model");
  assert.doesNotThrow(() => hubAgentReportSchema.parse(out.report), "the projected report validates");
  assert.ok(out.report?.summary?.includes("regions declined"), "the projection summarizes the agent's prose");
  assert.ok(out.report && out.report.findings.length >= 1, "the projection carries at least one finding");
});

test("defect-2: a failed structured extraction falls back to the prose projection (agent not failed)", async () => {
  const repo = openRepo();
  const childId = seedChildWithProse(repo, "Every RM shows a perfectly flat AUM across all periods.");
  const throwingExtractor = new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("structured output not supported");
    },
  }) as unknown as LanguageModel;
  const runner = createSessionAgentRunner({
    runAgentTurn: async () => ({ result: completedTurn(), deniedToolCalls: 0 }),
    repository: repo,
    buildModel: () => throwingExtractor,
  });
  // extractionModel is a structured-capable id, so the runner DOES attempt generateObject — which throws —
  // then salvages the prose rather than failing the agent.
  const out = await runner(runnerInput(childId, { extractionModel: PRICED_MODEL }));
  assert.doesNotThrow(() => hubAgentReportSchema.parse(out.report), "the fallback report validates");
  assert.ok(out.report?.summary?.includes("flat AUM"), "the fallback projects the agent's prose");
});

test("defect-2: extraction runs on the parent/extraction model, never the facade agent model", async () => {
  const repo = openRepo();
  const childId = seedChildWithProse(repo, "Regional analysis complete.");
  const seen: string[] = [];
  const runner = createSessionAgentRunner({
    runAgentTurn: async () => ({ result: completedTurn(), deniedToolCalls: 0 }),
    repository: repo,
    buildModel: (id) => {
      seen.push(id);
      return extractionModel();
    },
  });
  const out = await runner(runnerInput(childId, { model: FACADE_MODEL, extractionModel: PRICED_MODEL }));
  assert.doesNotThrow(() => hubAgentReportSchema.parse(out.report));
  assert.deepEqual(seen, [PRICED_MODEL], "the extraction ran on the parent model");
  assert.ok(!seen.includes(FACADE_MODEL), "the facade agent model was never used for extraction");
});

test("defect-2: the prose projection preserves the agent's citations", async () => {
  const repo = openRepo();
  const citation: HubCitation = { id: "1", title: "Sales Analytics", url: "https://example.test/app" };
  const childId = seedChildWithProse(repo, "Revenue fell 12% QoQ [1].", [citation]);
  const runner = createSessionAgentRunner({
    runAgentTurn: async () => ({ result: completedTurn(), deniedToolCalls: 0 }),
    repository: repo,
    buildModel: () => extractionModel(),
  });
  const out = await runner(runnerInput(childId, { model: FACADE_MODEL, extractionModel: FACADE_MODEL }));
  assert.equal(out.report?.citations.length, 1, "the projected report carries the agent's citation");
  assert.equal(out.report?.citations[0]?.id, "1");
});

test("defect-2/3: a facade-model agent settles COMPLETED (not error) and its report reaches synthesis", async () => {
  const repo = openRepo();
  const sessionService = sessionServiceWith({
    repo,
    mcpGrantsProvider: () => null, // no MCP — the facade agent just produces prose
    buildTurnModel: () => turnModelAnswering("All five regions declined continuously across Q1–Q4 2026."),
  });
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session" },
    planner: plannerGranting({ servers: {}, builtins: [] }, FACADE_MODEL),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(), // never reached — facade extraction short-circuits to projection
    }),
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });
  // The parent/mission model is a FACADE too, so per-agent `extractionModel` is a facade → projection path.
  const session = repo.createSession({ mode: "mission", model: FACADE_MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Analyze sales.", sink });

  assert.equal(result.status, "completed", "the mission completed");
  const { childId } = childEvents(repo, session.id);
  assert.equal(
    repo.getSession(childId).status,
    "completed",
    "the facade agent settled COMPLETED — not error (the Defect 2 regression)",
  );
  const agentReport = events.find(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  );
  assert.ok(agentReport, "the facade agent's report reached the board");
  assert.ok(
    agentReport!.report.summary?.includes("regions declined"),
    "the report carries the facade agent's real answer",
  );
  assert.ok(
    events.some((e) => e.type === "mission_synthesis"),
    "synthesis ran, INCLUDING the facade agent (the Defect 3 regression)",
  );
});

test("defect-3: TWO facade agents both reach synthesis — the run is NOT partial", async () => {
  const repo = openRepo();
  const sessionService = sessionServiceWith({
    repo,
    mcpGrantsProvider: () => null,
    buildTurnModel: () => turnModelAnswering("Regional and RM analysis complete with cited figures."),
  });
  const twoFacadeAgents: HubPlanner = async () => ({
    topology: "parallel",
    autonomy: "auto",
    agents: [
      {
        key: "region",
        name: "Region",
        systemPrompt: "Analyze regions.",
        model: FACADE_MODEL,
        toolGrants: { servers: {}, builtins: [] },
        skillIds: [],
        brief: "Analyze regions.",
        target: "regions",
        expectedOutcome: "A report.",
      },
      {
        key: "rm",
        name: "RM",
        systemPrompt: "Analyze RMs.",
        model: FACADE_MODEL,
        toolGrants: { servers: {}, builtins: [] },
        skillIds: [],
        brief: "Analyze RMs.",
        target: "RMs",
        expectedOutcome: "A report.",
      },
    ],
  });
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session" },
    planner: twoFacadeAgents,
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(),
    }),
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });
  const session = repo.createSession({ mode: "mission", model: FACADE_MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Analyze sales.", sink });
  assert.equal(result.status, "completed");

  const childIds = repo.listChildSessionIds(session.id);
  assert.equal(childIds.length, 2, "two agent children were spawned");
  for (const id of childIds) {
    assert.equal(repo.getSession(id).status, "completed", "each facade agent settled completed");
  }

  const reports = events.filter((e) => e.type === "agent_report");
  assert.equal(reports.length, 2, "both facade agents reported to the board");

  const synth = events.find(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis",
  );
  assert.ok(synth, "synthesis ran");
  assert.equal(synth!.partial, false, "the run is NOT partial — every agent produced a report");
  assert.equal(synth!.agentReportRefs.length, 2, "synthesis referenced BOTH agent reports");
});

// ── [Defect 1c] pre-run readiness gate — never spawn a tool-less agent for an unauthenticated server ──

test("defect-1c: a mission granting an UNAUTHENTICATED server is BLOCKED before spawning (re-approvable)", async () => {
  const repo = openRepo();
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session", defaultAutonomy: "auto" },
    planner: plannerGranting({ servers: { "srv-qlik": "all" }, builtins: [] }),
    runAgent: async () => {
      throw new Error("runAgent must not be called when the readiness gate blocks");
    },
    synthesizer: synthesizerStub,
    // The Qlik server the plan grants is registered but NOT authenticated (a headless child can't OAuth).
    isServerRunReady: () => ({ ready: false, serverName: "qlik-mreimitz" }),
    now: () => "2026-07-19T00:00:00.000Z",
  });
  // The session scopes the server in (so it survives the clamp) — but it's unauthenticated.
  const session = repo.createSession({
    mode: "mission",
    model: PRICED_MODEL,
    autonomy: "auto",
    toolScope: { servers: { "srv-qlik": "all" }, builtins: [] },
  });
  const { sink, events } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Analyze.", sink });

  assert.equal(result.status, "proposed", "the mission is left proposed (blocked, re-approvable) — not run");
  assert.equal(repo.listChildSessionIds(session.id).length, 0, "no agent child was spawned");
  const err = events.find((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error");
  assert.ok(err, "a recoverable authenticate error was emitted");
  assert.equal(err!.authRequired, true, "the error flags authRequired for the Authenticate affordance");
  assert.deepEqual(err!.serverIds, ["srv-qlik"], "the error names the unready server id");
  assert.ok(err!.message.includes("qlik-mreimitz"), "the message names the server to connect");
});

test("defect-1c: a mission whose granted server IS ready runs normally", async () => {
  const repo = openRepo();
  const record = { scopes: [] as Array<HubToolGrants | null | undefined>, granted: [] as string[][] };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-1", serverCatalog("Ready server", { name: "readtool", readOnly: true })],
  ]);
  const sessionService = sessionServiceWith({
    repo,
    mcpGrantsProvider: scopeHonoringGrants(catalog, record),
    buildTurnModel: () => turnModelCalling("readtool"),
  });
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session" },
    planner: plannerGranting({ servers: { "srv-1": "all" }, builtins: [] }),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(),
    }),
    synthesizer: synthesizerStub,
    isServerRunReady: () => ({ ready: true }),
    now: () => "2026-07-19T00:00:00.000Z",
  });
  const session = repo.createSession({
    mode: "mission",
    model: PRICED_MODEL,
    autonomy: "auto",
    toolScope: { servers: { "srv-1": "all" }, builtins: [] },
  });
  const { sink, events } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Investigate.", sink });
  assert.equal(result.status, "completed", "a ready server runs the mission to completion");
  assert.ok(
    events.some((e) => e.type === "mission_synthesis"),
    "synthesis ran (the gate let it through)",
  );
});

// ── [Defect 4] the watchdog — a hung extraction / a wedged agent can never freeze the mission ─────────

test("defect-4: a HUNG report-extraction times out and falls back to the projection (agent still reports)", async () => {
  const repo = openRepo();
  const childId = seedChildWithProse(repo, "Regional revenue fell 12% QoQ across every region.");
  // An extraction model that NEVER resolves until its abort signal fires (a hung provider call).
  const hangingExtractor = new MockLanguageModelV3({
    doGenerate: async (options) => {
      await new Promise<never>((_resolve, reject) => {
        options.abortSignal?.addEventListener("abort", () => reject(new Error("extraction aborted")), {
          once: true,
        });
      });
      return { content: [], finishReason: "stop", usage: GEN_USAGE, warnings: [] };
    },
  }) as unknown as LanguageModel;
  const runner = createSessionAgentRunner({
    runAgentTurn: async () => ({ result: completedTurn(), deniedToolCalls: 0 }),
    repository: repo,
    buildModel: () => hangingExtractor,
    extractionTimeoutMs: 20, // tiny cap so the hung extraction is aborted fast
  });
  const out = await runner(runnerInput(childId, { extractionModel: PRICED_MODEL }));
  assert.doesNotThrow(() => hubAgentReportSchema.parse(out.report), "the projected report validates");
  assert.ok(out.report?.summary?.includes("revenue fell"), "the projection salvaged the agent's prose");
});

test("defect-4: a wedged agent is soft-timed-out by the overall cap and the mission still completes (partial)", async () => {
  const repo = openRepo();
  const resolveAborted = (input: HubAgentRunInput) =>
    new Promise<{ report: undefined; costUsd: number; tokensIn: number; tokensOut: number; aborted: true }>(
      (resolve) => {
        const done = () =>
          resolve({ report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true });
        if (input.abortSignal.aborted) done();
        else input.abortSignal.addEventListener("abort", done, { once: true });
      },
    );
  const mission = new HubMissionService({
    repository: repo,
    config: { ...MISSION_CONFIG, agentRunnerMode: "session", agentMaxDurationMs: 20 },
    planner: plannerGranting({ servers: {}, builtins: [] }),
    runAgent: resolveAborted, // hangs until aborted, then settles with no report
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });
  const session = repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await mission.proposePlan({ sessionId: session.id, text: "Analyze.", sink });

  assert.equal(result.status, "completed", "the mission completed despite a wedged agent — not hung");
  const synth = events.find(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis",
  );
  assert.ok(synth, "synthesis ran");
  assert.equal(synth!.partial, true, "the wedged (aborted, report-less) agent → partial synthesis");
});
