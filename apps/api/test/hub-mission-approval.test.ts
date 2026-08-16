// Assistant Hub — mission-agent per-tool approval (OWNER DECISION, feat/hub-free-run-tools-roster).
//
// Per-tool approval was REMOVED from the Hub entirely: a granted tool/server/skill is authorization
// enough, so a mission agent runs ALL of its granted MCP tools with no per-call approval. Driven by
// STUBBED models + a STUBBED MCP session (no provider key, no live MCP server), this proves:
//   • `resolveMissionApprovalGate` NEVER gates a tool call — first-party AND mcp, read-only /
//     unannotated / destructive alike, under every autonomy dial. `destructive` stays flagged as inert
//     card context but does not gate.
//   • `buildMissionAgentHitl` therefore reports every granted tool ungated and never auto-declines.
//   • End-to-end: the mission PLAN-approval step is UNCHANGED (an always_ask session still proposes a
//     plan you approve; an auto session auto-launches), but once running, an UNANNOTATED tool (which the
//     old policy would have gated/auto-declined) RUNS to a real result with NO board approval card, and
//     the mission synthesizes — no auto-declined note, no invisible stall.
// The live browser round-trip + both-theme look are owner-acceptance.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubAutonomyLevel,
  type HubEvent,
  type HubMissionPlan,
  type HubToolGrants,
  type HubServerToolGrant,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { HubSessionService, type HubMcpGrantInputs } from "../src/hub/session-service.js";
import {
  buildMissionAgentHitl,
  resolveMissionApprovalGate,
} from "../src/hub/tools/approval-policy.js";
import type { HubApprovalMeta } from "../src/hub/hitl.js";
import type { HubResolvedToolset } from "../src/hub/turn-engine.js";
import {
  createSessionAgentRunner,
  HubMissionService,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";
import type { McpSession } from "../src/mcp/client.js";
import type { HubMcpServerCatalog } from "../src/hub/tools/index.js";
import { DEFAULT_CHAT_BUILTIN_NAMES } from "../src/hub/tools/index.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-mission-approval-"));
  tempDirs.push(dir);
  return dir;
}

// ── Unit: resolveMissionApprovalGate never gates a tool call ──────────────────────────────────────────

const mcpMeta = (annotations?: HubApprovalMeta["annotations"]): HubApprovalMeta => ({
  source: "mcp",
  serverId: "srv-1",
  ...(annotations ? { annotations } : {}),
});

test("gate: NEVER gates a tool call — first-party AND mcp, any annotations, any autonomy", () => {
  const annotationCases: Array<HubApprovalMeta["annotations"] | undefined> = [
    undefined,
    { readOnlyHint: true },
    { destructiveHint: true },
    { readOnlyHint: true, destructiveHint: true },
  ];
  for (const autonomy of ["always_ask", "threshold", "auto"] as const) {
    for (const source of ["builtin", "skill", "genui"] as const) {
      assert.equal(resolveMissionApprovalGate({ source }, autonomy).gated, false, `${source} @ ${autonomy}`);
    }
    for (const annotations of annotationCases) {
      const gate = resolveMissionApprovalGate(mcpMeta(annotations), autonomy);
      assert.equal(gate.gated, false, `mcp @ ${autonomy} (${JSON.stringify(annotations)}) never gates`);
    }
  }
});

test("gate: a destructive tool is still FLAGGED destructive (inert card context) but not gated", () => {
  const gate = resolveMissionApprovalGate(mcpMeta({ destructiveHint: true }), "auto");
  assert.equal(gate.gated, false, "destructive still runs — no per-call approval");
  assert.equal(gate.destructive, true, "but it is still flagged destructive for the card context");
  assert.deepEqual(gate.options, ["allow-once"], "destructive never offers `always`");
});

// ── Unit: buildMissionAgentHitl reports everything ungated, never auto-declines ────────────────────────

function toolsetWith(annotations?: HubApprovalMeta["annotations"]): HubResolvedToolset {
  return {
    tools: {},
    approvalMeta: { act: mcpMeta(annotations) },
    sources: { act: "mcp" },
  };
}

test("hitl: every granted MCP tool is ungated under every autonomy — nothing is auto-declined", () => {
  for (const autonomy of ["always_ask", "threshold", "auto"] as const) {
    for (const annotations of [undefined, { readOnlyHint: true }, { destructiveHint: true }] as const) {
      const built = buildMissionAgentHitl({ toolset: toolsetWith(annotations), autonomy });
      assert.equal(
        built.hitl.gate("act")?.gated,
        false,
        `granted tool ungated @ ${autonomy} (${JSON.stringify(annotations)})`,
      );
    }
    const built = buildMissionAgentHitl({ toolset: toolsetWith(), autonomy });
    assert.equal(built.deniedCount(), 0, `no denials @ ${autonomy}`);
    assert.equal(built.timedOutCount(), 0, `no timeouts @ ${autonomy}`);
  }
});

// ── Integration harness: a mission that calls one MCP tool, end-to-end ─────────────────────────────────

const PRICED_MODEL = "gpt-4o";
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const STREAM_USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 12, text: 12, reasoning: 0 },
} as const;
const GEN_USAGE = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
} as const;

const AGENT_REPORT = {
  summary: "Completed the assigned investigation slice.",
  findings: [{ summary: "A concrete finding grounded in the tool result.", confidence: "high" }],
  citations: [],
  artifacts: [],
  confidence: "high",
  openQuestions: [],
} as const;

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [{ type: "text", text: "tool ran: ok" }] }),
    close: async () => undefined,
  };
}

/** One UNANNOTATED MCP tool on `srv-1` — under the OLD policy this gated (always_ask) or was
 *  auto-declined (auto/threshold); under the new "granted ⇒ run" default it executes with no card. */
function unannotatedCatalog(): Map<string, HubMcpServerCatalog> {
  return new Map([
    [
      "srv-1",
      {
        serverName: "Action server",
        tools: [
          {
            name: "readtool",
            description: "The tool.",
            inputSchema: { type: "object", properties: { message: { type: "string" } } },
            raw: {},
          },
        ],
      },
    ],
  ]);
}

function scopeHonoringGrants(catalog: Map<string, HubMcpServerCatalog>) {
  return (ctx: { session: { toolScope?: HubToolGrants | null } }): HubMcpGrantInputs | null => {
    const scope = ctx.session.toolScope ?? null;
    const grantServers: Record<string, HubServerToolGrant> = {};
    const scoped = new Map<string, HubMcpServerCatalog>();
    const sessions = new Map<string, McpSession>();
    for (const [serverId, entry] of catalog) {
      const grant: HubServerToolGrant | undefined = scope ? scope.servers[serverId] : "all";
      if (grant === undefined) continue;
      grantServers[serverId] = grant;
      scoped.set(serverId, entry);
      sessions.set(serverId, stubSession());
    }
    if (Object.keys(grantServers).length === 0) return null;
    return {
      grants: { servers: grantServers, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
      catalog: scoped,
      sessions,
      sink: { toolCall: () => undefined },
    };
  };
}

/** A turn model that calls `readtool` once, then answers. */
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

function missionConfig(over: Partial<HubMissionServiceConfig> = {}): HubMissionServiceConfig {
  return {
    maxAgents: 6,
    maxParallel: 3,
    defaultBudgetUsd: 2.0,
    maxBudgetUsd: 10.0,
    askAboveAgents: 3,
    askAboveUsd: 1.0,
    defaultAutonomy: "always_ask",
    agentRunnerMode: "session",
    ...over,
  };
}

function sessionServiceWith(repo: HubRepository, catalog: Map<string, HubMcpServerCatalog>): HubSessionService {
  return new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: PRICED_MODEL,
      contextWindow: 128_000,
      buildModel: () => turnModelCalling("readtool") as never,
    }),
    mcpGrantsProvider: (ctx) => scopeHonoringGrants(catalog)(ctx),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25_000 },
    },
  });
}

function plannerGranting(grants: HubToolGrants): HubPlanner {
  return async (): Promise<HubMissionPlan> => ({
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      {
        key: "agent-1",
        name: "Investigator",
        systemPrompt: "You are a focused investigator.",
        model: PRICED_MODEL,
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

function missionServiceWith(
  repo: HubRepository,
  sessionService: HubSessionService,
  config: HubMissionServiceConfig,
): HubMissionService {
  return new HubMissionService({
    repository: repo,
    config,
    planner: plannerGranting({ servers: { "srv-1": "all" }, builtins: [] }),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => extractionModel(),
    }),
    synthesizer: synthesizerStub,
    now: () => "2026-07-19T00:00:00.000Z",
  });
}

/** Propose (always_ask waits for plan approval; auto auto-launches) then run a mission end-to-end.
 *  Returns the collected PARENT-log events + the proposed vs final mission status. */
async function runMission(opts: {
  autonomy: HubAutonomyLevel;
  catalog?: Map<string, HubMcpServerCatalog>;
  config?: Partial<HubMissionServiceConfig>;
}): Promise<{ repo: HubRepository; events: HubEvent[]; proposedStatus: string; finalStatus: string }> {
  const repo = openRepo();
  const catalog = opts.catalog ?? unannotatedCatalog();
  const sessionService = sessionServiceWith(repo, catalog);
  const mission = missionServiceWith(repo, sessionService, missionConfig(opts.config));

  const session = repo.createSession({ mode: "mission", model: PRICED_MODEL, autonomy: opts.autonomy });
  const events: HubEvent[] = [];
  const sink = { onEvent: (event: HubEvent) => events.push(event), onDelta: () => undefined };

  const proposed = await mission.proposePlan({ sessionId: session.id, text: "Investigate.", sink });
  const proposedStatus = proposed.status;
  // always_ask still gates the PLAN (unchanged) — approve it to run. auto auto-launched already.
  if (proposedStatus === "proposed") {
    await mission.approve({ missionId: proposed.id, sink });
  }
  return { repo, events, proposedStatus, finalStatus: repo.getMission(proposed.id).status };
}

function assertRanWithoutApprovalCard(repo: HubRepository, events: HubEvent[]): void {
  assert.ok(
    !events.some((e) => e.type === "agent_approval_requested"),
    "NO per-tool approval card is ever surfaced — granted tools run freely",
  );
  const spawned = events.find((e) => e.type === "agent_spawned") as Extract<HubEvent, { type: "agent_spawned" }>;
  const toolResult = repo.listEvents(spawned.agentSessionId).find((e) => e.type === "tool_result");
  assert.equal(
    toolResult?.type === "tool_result" && toolResult.state,
    "output-available",
    "the granted tool ran to a real result (never denied)",
  );
  const report = events.find((e) => e.type === "agent_report") as Extract<HubEvent, { type: "agent_report" }>;
  assert.ok(
    !report.report.openQuestions.some((q) => q.toLowerCase().includes("auto-declined")),
    "no auto-declined note — the tool was not gated",
  );
  assert.ok(events.some((e) => e.type === "mission_synthesis"), "the mission synthesized");
}

test("e2e: an always_ask mission still gates the PLAN, but once approved its tools RUN with no per-call card", async () => {
  const { repo, events, proposedStatus, finalStatus } = await runMission({
    autonomy: "always_ask",
    catalog: unannotatedCatalog(),
  });
  assert.equal(proposedStatus, "proposed", "always_ask still requires PLAN approval before running");
  assertRanWithoutApprovalCard(repo, events);
  assert.equal(finalStatus, "completed", "the mission completed after plan approval");
});

test("e2e: an auto mission runs an UNANNOTATED (previously auto-declined) tool with no approval at all", async () => {
  const { repo, events, proposedStatus } = await runMission({
    autonomy: "auto",
    catalog: unannotatedCatalog(),
  });
  assert.notEqual(proposedStatus, "proposed", "auto auto-launches the plan — no plan-approval click");
  assertRanWithoutApprovalCard(repo, events);
});
