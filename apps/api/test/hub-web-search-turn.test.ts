// Assistant Hub — hub-fixes WP5.1 (RC5, D-HF2). End-to-end (STUBBED model, no provider/network) proof
// that provider-native `web.search` composes into a real turn: a non-agent session gets it by capability
// default, the model's provider-executed search is COUNTED (`usage.webSearches`) and its sources CITE
// through; a mission agent GRANTED it uses it; and `HUB_WEB_TOOLS=off` removes both tools everywhere,
// including agents. Tools offered to the model are captured from `doStream(options.tools)`.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_TOKEN_PROFILE, type HubEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { beginHubCitationTurn } from "../src/hub/citations.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSessionService,
  type HubMcpGrantInputs,
  type HubSessionServiceConfig,
} from "../src/hub/session-service.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-web-turn-"));
  tempDirs.push(dir);
  return dir;
}
const silentSink: HubTurnSink = { onEvent: () => undefined, onDelta: () => undefined };

function baseConfig(over: Partial<HubSessionServiceConfig> = {}): HubSessionServiceConfig {
  return {
    maxActiveSessions: 4,
    idleReleaseMs: 0,
    autoTitle: false,
    dataDir: tempDataDir(),
    toolLoadingDefault: "eager",
    autoFraction: 0.1,
    skillListingBudgetFraction: 0.01,
    skillEntryMaxChars: 1536,
    skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    ...over,
  };
}

/** Tool names the model was OFFERED, per `doStream` call (a provider tool's `name` is its sanitized key). */
function offeredNames(options: unknown): string[] {
  const tools = (options as { tools?: Array<{ name?: string; id?: string }> }).tools ?? [];
  return tools.map((t) => t.name ?? t.id ?? "?");
}

/** A model that runs a provider-executed `web_search`, then answers citing [1]. Records offered tools. */
function webSearchModel(offered: string[][]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      offered.push(offeredNames(options));
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "ws1",
              toolName: "web_search",
              input: JSON.stringify({ query: "cats" }),
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "ws1",
              toolName: "web_search",
              result: [
                {
                  type: "web_search_result",
                  url: "https://en.wikipedia.org/wiki/Cat",
                  title: "Cat — Wikipedia",
                  pageAge: null,
                  encryptedContent: "OPAQUE",
                },
              ],
              providerExecuted: true,
            },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Cats are felines[1]." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

/** A model that never calls a tool — used when web tools must be ABSENT (kill switch). Records offered. */
function textOnlyModel(offered: string[][]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      offered.push(offeredNames(options));
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "No web for me." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

function anthropicResolve(model: MockLanguageModelV3) {
  return () => ({
    providerKind: "anthropic" as const,
    modelId: "claude-x",
    contextWindow: 200000,
    buildModel: () => model as never,
  });
}

const roleTemplate = {
  roleName: "Investigator",
  roleSystemPrompt: "You investigate.",
  briefTarget: "the target",
  briefInputs: "Investigate cats.",
  expectedOutcome: "A short report.",
  agentBudget: "none" as const,
};

// ── (1) capability default → counted + cited ────────────────────────────────────────────────────────

test("a non-agent session on a search-capable model gets web.search by default, its search is counted, and its sources cite through", async () => {
  const repo = openRepo();
  const offered: string[][] = [];
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: anthropicResolve(webSearchModel(offered)),
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig(),
  });

  const session = await service.createSession({ mode: "research", model: "claude-x" });
  const outcome = await service.dispatchMessage(
    session.id,
    { text: "tell me about cats" },
    silentSink,
  );
  assert.equal(outcome.kind, "ran");

  // web.search + web.fetch were offered to the model (capability-derived default, unscoped session).
  assert.ok(offered[0]?.includes("web_search"), "web.search offered by default");
  assert.ok(offered[0]?.includes("web_fetch"), "web.fetch offered by default");

  const events = repo.listEvents(session.id);
  const message = events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
  assert.equal(
    message?.usage.webSearches,
    1,
    "the provider-executed web search is counted in usage",
  );
  const urls = (message?.citations ?? []).map((c) => c.url);
  assert.ok(
    urls.includes("https://en.wikipedia.org/wiki/Cat"),
    "the web-search source became a hub citation",
  );
  assert.ok(
    !JSON.stringify(message?.citations).includes("OPAQUE"),
    "opaque provider payload never enters a citation",
  );

  // The web.search tool call settled as a first-party (builtin-sourced) tool_result — never gated.
  const toolCall = events.find(
    (e): e is Extract<HubEvent, { type: "tool_call" }> => e.type === "tool_call",
  );
  assert.equal(toolCall?.part.toolName, "web.search");
  assert.equal(toolCall?.part.source, "builtin");
});

// ── (2) mission agent granted web.search uses it ─────────────────────────────────────────────────────

test("a mission agent granted web.search receives it and uses it in its child turn", async () => {
  const repo = openRepo();
  const offered: string[][] = [];
  const grantWebSearch = (): HubMcpGrantInputs => ({
    grants: { servers: {}, builtins: ["web.search"] },
    catalog: new Map(),
    sessions: new Map(),
    sink: { toolCall: () => undefined },
  });
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: anthropicResolve(webSearchModel(offered)),
    mcpGrantsProvider: grantWebSearch,
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig(),
  });

  const child = repo.createSession({ mode: "chat", model: "claude-x", kind: "agent" });
  const result = await service.runAgentTurn({
    agentSessionId: child.id,
    roleTemplate,
    brief: "Research cats and report.",
    abortSignal: new AbortController().signal,
  });

  assert.equal(result.result.status, "completed");
  assert.ok(
    offered[0]?.includes("web_search"),
    "the explicitly-granted web.search is offered to the agent",
  );
  const events = repo.listEvents(child.id);
  const toolResult = events.find(
    (e): e is Extract<HubEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
  assert.ok(toolResult, "the agent's web.search settled into a tool_result in its own log");
  const message = events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
  assert.equal(message?.usage.webSearches, 1, "the agent's web search is counted");
});

// ── (3) kill switch removes both tools everywhere (session AND agent) ────────────────────────────────

test("HUB_WEB_TOOLS=off removes web.search + web.fetch from a normal session AND a mission agent", async () => {
  const repo = openRepo();

  // A normal session: neither tool is offered even though the model + scope would otherwise get them.
  const sessionOffered: string[][] = [];
  const sessionService = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: anthropicResolve(textOnlyModel(sessionOffered)),
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig({ webToolsEnabled: false }),
  });
  const session = await sessionService.createSession({ mode: "research", model: "claude-x" });
  await sessionService.dispatchMessage(session.id, { text: "hi" }, silentSink);
  assert.ok(
    !sessionOffered[0]?.includes("web_search"),
    "session: web.search removed by the kill switch",
  );
  assert.ok(
    !sessionOffered[0]?.includes("web_fetch"),
    "session: web.fetch removed by the kill switch",
  );

  // A mission agent EXPLICITLY granted web.search still gets nothing when the kill switch is off.
  const agentOffered: string[][] = [];
  const agentService = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: anthropicResolve(textOnlyModel(agentOffered)),
    mcpGrantsProvider: () => ({
      grants: { servers: {}, builtins: ["web.search", "web.fetch"] },
      catalog: new Map(),
      sessions: new Map(),
      sink: { toolCall: () => undefined },
    }),
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig({ webToolsEnabled: false }),
  });
  const child = repo.createSession({ mode: "chat", model: "claude-x", kind: "agent" });
  await agentService.runAgentTurn({
    agentSessionId: child.id,
    roleTemplate,
    brief: "Research cats.",
    abortSignal: new AbortController().signal,
  });
  assert.ok(
    !agentOffered[0]?.includes("web_search"),
    "agent: kill switch removes even an explicit web.search grant",
  );
  assert.ok(!agentOffered[0]?.includes("web_fetch"), "agent: web.fetch removed too");
});
