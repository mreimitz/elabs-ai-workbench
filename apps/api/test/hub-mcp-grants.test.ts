// Assistant Hub (roadmap/assistant-hub/, WP1.4, §1.6 / R-MCP1) — server-level tool grants v1 wired
// through the session-service, end-to-end with the citation apparatus, over a STUBBED model + a STUBBED
// MCP session (no provider, no child process, no live server). Proves: a granted server's tool is built
// into the model surface (WP0.5 bridge), the emitted tool_call part is tagged `source:"mcp"` + its
// `serverId` (R-MCP11), and a source the tool returns flows all the way to the settled message's
// `citations[]` (§1.7) — the whole grants → wrap → post-pass chain in one turn.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubEvent,
  type HubToolPart,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { beginHubCitationTurn } from "../src/hub/citations.js";
import { HubRepository } from "../src/hub/repository.js";
import { DEFAULT_CHAT_BUILTIN_NAMES } from "../src/hub/tools/index.js";
import { HubSessionService, type HubMcpGrantInputs } from "../src/hub/session-service.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import type { McpSession } from "../src/mcp/client.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-grants-"));
  tempDirs.push(dir);
  return dir;
}

/** A stub MCP session: `callTool` returns a fixed search result carrying one citable source. */
function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      structuredContent: {
        results: [{ title: "France — Wikipedia", url: "https://en.wikipedia.org/wiki/France" }],
      },
    }),
    close: async () => undefined,
  };
}

/** Grant one server ("srv-1") with tool "search"; open a stub session for it. */
function stubMcpGrants(): HubMcpGrantInputs {
  return {
    grants: { servers: { "srv-1": "all" }, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map([
      [
        "srv-1",
        {
          serverName: "Research server",
          tools: [
            {
              name: "search",
              description: "Search the web.",
              inputSchema: { type: "object", properties: { q: { type: "string" } } },
              raw: {},
            },
          ],
        },
      ],
    ]),
    sessions: new Map([["srv-1", stubSession()]]),
    sink: { toolCall: () => undefined },
  };
}

/** A model that calls the granted `search` tool, then answers citing `[1]`. */
function mockSearchThenCite(): MockLanguageModelV3 {
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
                toolName: "search",
                input: JSON.stringify({ q: "france" }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage: USAGE,
              },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Paris is the capital[1]." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

const silentSink: HubTurnSink = { onEvent: () => undefined, onDelta: () => undefined };

function assistantMessages(events: HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
}

test("a granted MCP server's tool is exposed, tagged with its origin, and its sources cite through", async () => {
  const repo = openRepo();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => mockSearchThenCite() as never,
    }),
    // WP1.4 wiring under test: the MCP grant provider + the citation apparatus.
    mcpGrantsProvider: () => stubMcpGrants(),
    beginCitationTurn: beginHubCitationTurn,
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
    },
  });

  const session = await service.createSession({ mode: "research", model: "gpt-4o" });
  // WP2.3 reconcile: an MCP tool call now gates for approval by default (always_ask + no owner-trust
  // store — R-MCP3), so approve it live from the sink; the grants/citations flow under test still runs.
  const approveSink: HubTurnSink = {
    onEvent: (e) => {
      if (e.type === "approval_requested" && !e.isAutomatic) {
        service.decideApproval(session.id, e.toolCallId, "allow-once");
      }
    },
    onDelta: () => undefined,
  };
  const outcome = await service.dispatchMessage(
    session.id,
    { text: "capital of france?" },
    approveSink,
  );
  assert.equal(outcome.kind, "ran");

  const events = repo.listEvents(session.id);

  // The tool call the model made was the GRANTED mcp tool, tagged with its source + origin server.
  const toolCall = events.find(
    (e): e is Extract<HubEvent, { type: "tool_call" }> => e.type === "tool_call",
  );
  assert.equal(
    toolCall?.part.toolName,
    "search",
    "the granted server tool was exposed to the model",
  );
  assert.equal(toolCall?.part.source, "mcp", "the emitted part is tagged mcp-source");
  assert.equal(
    toolCall?.part.serverId,
    "srv-1",
    "the part carries its origin server (R-MCP11 chip)",
  );

  // The source the granted tool returned resolved into the settled message's citations[] (§1.7).
  const [am] = assistantMessages(events);
  assert.equal(am?.citations.length, 1);
  assert.equal(am?.citations[0]?.url, "https://en.wikipedia.org/wiki/France");
  const toolPart = am?.parts.find((p): p is HubToolPart => p.type === "tool_call");
  assert.deepEqual(toolPart?.citationIds, ["1"]);
});

test("with no MCP grant provider the surface stays built-ins only (WP1.1 behavior unchanged)", async () => {
  const repo = openRepo();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () =>
        new MockLanguageModelV3({
          doStream: async () => ({
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                { type: "text-start", id: "t1" },
                { type: "text-delta", id: "t1", delta: "hi" },
                { type: "text-end", id: "t1" },
                {
                  type: "finish",
                  finishReason: { unified: "stop", raw: "end_turn" },
                  usage: USAGE,
                },
              ] as V3Part[],
            }),
          }),
        }) as never,
    }),
    beginCitationTurn: beginHubCitationTurn,
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
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const outcome = await service.dispatchMessage(session.id, { text: "hi" }, silentSink);
  assert.equal(outcome.kind, "ran");
  const [am] = assistantMessages(repo.listEvents(session.id));
  assert.equal(am?.citations.length, 0, "no mcp servers → no citations, no crash");
});

// ── WP1.1 (hub-fixes, D-HF1 / RC1) — deferred-loading callability suite ────────────────────────────
// The MISSING test RC1 named: in DEFERRED mode a granted MCP tool is NOT resident at step 1, a
// `tool_search` hit PROMOTES it, and the model calls it successfully in the SAME turn's next step. Also
// proves the per-step gate: the granted tool is absent from the model's tool surface until promoted.

/** The tool names the SDK forwarded to the provider on each step (deferred-mode gating is observable
 *  here — a gated tool is filtered out of `options.tools` before `doStream` sees it). */
function toolNamesSeen(options: unknown): string[] {
  const tools = (options as { tools?: Array<{ name: string }> }).tools ?? [];
  return tools.map((t) => t.name).sort();
}

/** step 1 → `tool_search("search")`; step 2 → call the now-promoted `search`; step 3 → answer. Records
 *  the active tool names it saw per step into `seen`. */
function mockDeferredSearchThenCall(seen: string[][]): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async (options) => {
      call += 1;
      seen.push(toolNamesSeen(options));
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "ts-1",
                toolName: "tool_search",
                input: JSON.stringify({ query: "search" }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
            ] as V3Part[],
          }),
        };
      }
      if (call === 2) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tc-1",
                toolName: "search",
                input: JSON.stringify({ q: "france" }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Paris." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

function deferredConfig(dataDir: string) {
  return {
    maxActiveSessions: 4,
    idleReleaseMs: 0,
    autoTitle: false,
    dataDir,
    // The production default path (deferred) — the one RC1 proved had no callability test.
    toolLoadingDefault: "deferred" as const,
    autoFraction: 0.1,
    skillListingBudgetFraction: 0.01,
    skillEntryMaxChars: 1536,
    skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
  };
}

test("DEFERRED mode: tool_search PROMOTES a granted tool so it is callable in the same turn (RC1)", async () => {
  const repo = openRepo();
  const seen: string[][] = [];
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => mockDeferredSearchThenCall(seen) as never,
    }),
    mcpGrantsProvider: () => stubMcpGrants(),
    beginCitationTurn: beginHubCitationTurn,
    config: deferredConfig(tempDataDir()),
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  // The promoted `search` call is approval-gated by default (serverTrusted:false) — approve it live.
  const approveSink: HubTurnSink = {
    onEvent: (e) => {
      if (e.type === "approval_requested" && !e.isAutomatic) {
        service.decideApproval(session.id, e.toolCallId, "allow-once");
      }
    },
    onDelta: () => undefined,
  };
  const outcome = await service.dispatchMessage(session.id, { text: "capital of france?" }, approveSink);
  assert.equal(outcome.kind, "ran");

  // The per-step gate: step 1 offered `tool_search` but NOT the deferred `search`; step 2 offered it
  // (promoted). This is the whole point of RC1 — the tool becomes callable only after discovery.
  assert.ok(seen[0]?.includes("tool_search"), "step 1 has the tool_search affordance");
  assert.ok(!seen[0]?.includes("search"), "step 1 does NOT expose the deferred granted tool");
  assert.ok(seen[1]?.includes("search"), "step 2 exposes the promoted granted tool");

  const events = repo.listEvents(session.id);
  const toolCalls = events.filter(
    (e): e is Extract<HubEvent, { type: "tool_call" }> => e.type === "tool_call",
  );
  // Both the discovery call and the promoted granted-tool call are persisted.
  assert.ok(
    toolCalls.some((e) => e.part.toolName === "tool_search"),
    "the tool_search discovery call is persisted",
  );
  const searchCall = toolCalls.find((e) => e.part.toolName === "search");
  assert.ok(searchCall, "the promoted granted MCP tool was actually called");
  assert.equal(searchCall?.part.source, "mcp", "the promoted call is tagged mcp-source");
  assert.equal(searchCall?.part.serverId, "srv-1", "the promoted call carries its origin server");

  // Its result is persisted as a settled tool_result (output-available), proving it ran end-to-end.
  const results = events.filter(
    (e): e is Extract<HubEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
  assert.ok(
    results.some((e) => e.toolCallId === "tc-1" && e.state === "output-available"),
    "the promoted tool's result settled as output-available",
  );
});

test("DEFERRED mode: an UNGRANTED tool can NEVER be promoted or become callable (negative)", async () => {
  const repo = openRepo();
  const seen: string[][] = [];
  // The model tries to discover (and hopes to call) a tool that is NOT granted to this session.
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      call += 1;
      seen.push(toolNamesSeen(options));
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "ts-1",
                toolName: "tool_search",
                input: JSON.stringify({ query: "delete_everything" }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "no such tool." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => model as never,
    }),
    // The session grants ONLY srv-1's "search" — "delete_everything" is never granted anywhere.
    mcpGrantsProvider: () => stubMcpGrants(),
    beginCitationTurn: beginHubCitationTurn,
    config: deferredConfig(tempDataDir()),
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const outcome = await service.dispatchMessage(session.id, { text: "delete everything" }, silentSink);
  assert.equal(outcome.kind, "ran");

  // No step ever exposes the ungranted tool — it is not in the toolset at all, so it can never be
  // promoted or activated. (Only `tool_search` + the granted `search` could ever appear.)
  for (const step of seen) {
    assert.ok(!step.includes("delete_everything"), "the ungranted tool never appears in any step");
  }
  const events = repo.listEvents(session.id);
  const toolCalls = events.filter(
    (e): e is Extract<HubEvent, { type: "tool_call" }> => e.type === "tool_call",
  );
  assert.ok(
    !toolCalls.some((e) => e.part.toolName === "delete_everything"),
    "the ungranted tool was never called",
  );
});

// ── hub-fixes WP1.3 (RC3.4) — kill the silent grant-drop: status events + the honest prompt line ────
// The MISSING behavior RC3.4 named: a granted server that fails to open used to vanish without a
// trace — no event, and (if it was the only server) the prompt fell back to the misleading "No MCP
// tools are granted in this session". These tests prove the fix at the `HubSessionService` level
// (the layer index.ts's `resolveHubMcpGrants` reports INTO), stubbing `mcpGrantsProvider` to hand back
// `serverStatuses` exactly like the real index.ts implementation now does.

function statusEvents(events: HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "mcp_server_status" }> => e.type === "mcp_server_status",
  );
}

type RecordedCall = { system: string; toolNames: string[] };

/** Records the assembled SYSTEM prompt + the tool names offered on every `doStream` call, then answers
 *  plainly — mirrors `hub-session-service.test.ts`'s own `recordingModelAnd` pattern. */
function recordingTextModel(recorded: RecordedCall[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (options: unknown) => {
      const opts = options as {
        prompt: Array<{ role: string; content: unknown }>;
        tools?: Array<{ name: string }>;
      };
      const sys = opts.prompt.find((m) => m.role === "system");
      recorded.push({
        system: typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content ?? ""),
        toolNames: (opts.tools ?? []).map((t) => t.name),
      });
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

const baseConfig = (dataDir: string) => ({
  maxActiveSessions: 4,
  idleReleaseMs: 0,
  autoTitle: false,
  dataDir,
  toolLoadingDefault: "eager" as const,
  autoFraction: 0.1,
  skillListingBudgetFraction: 0.01,
  skillEntryMaxChars: 1536,
  skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
});

/** One server connected (with a real callable tool) + one dropped — mirrors what `index.ts`'s
 *  `resolveHubMcpGrants` hands back after a partial connection failure: the dropped server is already
 *  removed from `grants`/`catalog`/`sessions`, but its outcome still rides on `serverStatuses`. */
function mcpGrantsWithOneDrop(): HubMcpGrantInputs {
  return {
    grants: { servers: { "srv-1": "all" }, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map([
      [
        "srv-1",
        {
          serverName: "Research server",
          tools: [
            {
              name: "search",
              description: "Search the web.",
              inputSchema: { type: "object", properties: { q: { type: "string" } } },
              raw: {},
            },
          ],
        },
      ],
    ]),
    sessions: new Map([["srv-1", stubSession()]]),
    sink: { toolCall: () => undefined },
    serverStatuses: [
      { serverId: "srv-1", serverName: "Research server", status: "connected" },
      { serverId: "srv-2", serverName: "Qlik server", status: "error", message: "connection refused" },
    ],
  };
}

test("hub-fixes WP1.3 (RC3.4): a dropped granted server gets a persisted status event, the prompt states the truth, and the surviving server's tool still resolves", async () => {
  const repo = openRepo();
  const recorded: RecordedCall[] = [];
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => recordingTextModel(recorded) as never,
    }),
    mcpGrantsProvider: () => mcpGrantsWithOneDrop(),
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig(tempDataDir()),
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const first = await service.dispatchMessage(session.id, { text: "hi" }, silentSink);
  assert.equal(first.kind, "ran");

  const eventsAfterFirst = statusEvents(repo.listEvents(session.id));
  assert.equal(eventsAfterFirst.length, 2, "one status event per ATTEMPTED server on the first turn");
  const dropped = eventsAfterFirst.find((e) => e.serverId === "srv-2");
  assert.equal(dropped?.status, "error");
  assert.equal(dropped?.message, "connection refused");
  const connected = eventsAfterFirst.find((e) => e.serverId === "srv-1");
  assert.equal(connected?.status, "connected");

  assert.match(
    recorded[0]?.system ?? "",
    /Unreachable this turn: Qlik server \(connection refused\)/,
    "the prompt states the truth instead of pretending nothing was granted",
  );
  assert.ok(
    recorded[0]?.toolNames.includes("search"),
    "the surviving connected server's tool still resolves",
  );

  // Second turn, the SAME statuses: no NEW status events (dedupe on last-known-status per session), but
  // the prompt line still appears EVERY turn — the model needs the current truth, not just on change.
  const second = await service.dispatchMessage(session.id, { text: "again" }, silentSink);
  assert.equal(second.kind, "ran");
  const eventsAfterSecond = statusEvents(repo.listEvents(session.id));
  assert.equal(
    eventsAfterSecond.length,
    2,
    "no NEW status events on an unchanged second turn (dedupe on last-known status)",
  );
  assert.match(recorded[1]?.system ?? "", /Unreachable this turn: Qlik server/);
});

test("hub-fixes WP1.3 (RC3.4): all-fail ⇒ no more silent null — status events + the prompt line still land, and the turn proceeds on built-ins", async () => {
  const repo = openRepo();
  const recorded: RecordedCall[] = [];
  const allFail: HubMcpGrantInputs = {
    grants: { servers: {}, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map(),
    sessions: new Map(),
    sink: { toolCall: () => undefined },
    serverStatuses: [
      { serverId: "srv-1", serverName: "Research server", status: "error", message: "ECONNREFUSED" },
      { serverId: "srv-2", serverName: "Qlik server", status: "error", message: "OAuth expired" },
    ],
  };
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => recordingTextModel(recorded) as never,
    }),
    mcpGrantsProvider: () => allFail,
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig(tempDataDir()),
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const outcome = await service.dispatchMessage(session.id, { text: "hi" }, silentSink);
  assert.equal(outcome.kind, "ran", "the turn proceeds on built-ins instead of a silent failure");
  if (outcome.kind === "ran") assert.equal(outcome.result.status, "completed");

  const events = statusEvents(repo.listEvents(session.id));
  assert.equal(events.length, 2, "both dropped servers get a persisted status event, even though");
  assert.ok(events.every((e) => e.status === "error"));

  const system = recorded[0]?.system ?? "";
  assert.match(system, /Unreachable this turn: Research server \(ECONNREFUSED\)/);
  assert.match(system, /Unreachable this turn: Qlik server \(OAuth expired\)/);
  assert.ok(
    !system.includes("No MCP tools are granted in this session"),
    "the honest per-server text replaces the misleading blanket fallback (RC3.4's whole point)",
  );
});

test("an auth failure carries authRequired through to the persisted mcp_server_status event; a transport failure does not", async () => {
  const repo = openRepo();
  const recorded: RecordedCall[] = [];
  const grants: HubMcpGrantInputs = {
    grants: { servers: {}, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map(),
    sessions: new Map(),
    sink: { toolCall: () => undefined },
    serverStatuses: [
      {
        serverId: "srv-auth",
        serverName: "qlik-stage",
        status: "error",
        message: "Unauthorized",
        authRequired: true,
      },
      { serverId: "srv-net", serverName: "textops", status: "error", message: "fetch failed" },
    ],
  };
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => recordingTextModel(recorded) as never,
    }),
    mcpGrantsProvider: () => grants,
    beginCitationTurn: beginHubCitationTurn,
    config: baseConfig(tempDataDir()),
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  const events = statusEvents(repo.listEvents(session.id));
  const auth = events.find((e) => e.serverId === "srv-auth");
  assert.equal(auth?.authRequired, true, "the auth failure is flagged (drives the Authenticate action)");
  const net = events.find((e) => e.serverId === "srv-net");
  assert.equal(net?.authRequired, undefined, "a plain transport failure carries no auth flag");
});
