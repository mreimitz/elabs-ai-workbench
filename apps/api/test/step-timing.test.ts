import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { NormalizedToolDefinition, RunStep } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { McpSession } from "../src/mcp/client.js";

// Track E — per-step wall-clock timing (Gantt foundation; findings/09 §3). This locks the regression
// that an interactive run persists REAL per-step `startedAt`/`endedAt` for BOTH the LLM steps (captured
// at each `streamText` step boundary in the engine) AND the tool steps (captured around `session.callTool`
// in the tool bridge), and that the timeline (steps sorted by start) is monotonic non-decreasing in both
// start and end. We drive the REAL engine + accounting + persistence stack with a MockLanguageModelV3
// that calls a tool then answers, reload the run from the DB, and assert the timing contract.
//
// Would FAIL without the emit: before Track E, `run_steps` had no time column and neither the engine's
// `onStepFinish` (LLM) nor the tool bridge stamped a wall-clock onto its step, so BOTH the
// `llm_response` and `tool_call` steps would reload with `startedAt`/`endedAt` === undefined and the
// "carries valid ISO startedAt/endedAt" assertions below would throw.

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as run-persistence.test.ts / accounting.test.ts — no extra dependency, always matches the SDK).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

import { AccountingSink } from "../src/testing/accounting.js";
import { runAgentLoop, type AccountingHooks, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { createAccountingStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";

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

/** Seed the FK parents (provider → scenario, test) a `runs` row needs. */
function seedParents(db: AppDatabase, testId: string, scenarioId: string): void {
  const now = "2026-06-20T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'List files', 'Use the tools, then answer.', '[]', @now, @now)`,
  ).run({ id: testId, now });
}

const ALPHA: NormalizedToolDefinition = {
  name: "alpha",
  description: "Alpha tool",
  inputSchema: { type: "object", properties: { key: { type: "string" } } },
  raw: {},
};

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    // A tiny await defers the resolution to a later tick so the measured call has a non-zero (or at
    // least non-decreasing) wall-clock window — the contract only requires startedAt <= endedAt.
    callTool: async (name: string) => {
      await new Promise((resolve) => setImmediate(resolve));
      return { content: [{ type: "text", text: `${name}:ok` }] };
    },
    close: async () => undefined,
  };
}

const USAGE = {
  inputTokens: { total: 137, noCache: 137, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 23, text: 23, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

/** Mock model: call one tool, then answer. Two provider round-trips (two LLM steps). */
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
            input: JSON.stringify({ key: "x" }),
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
        { type: "text-delta", id: "t1", delta: "The final answer." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

/**
 * The accounting adapter the engine drives — mirrors the production `RunService` adapter: it forwards
 * the engine's Track E `timing` (the real `streamText` step boundary) onto the `llm_response` step so
 * the wall-clock reaches the accounting sink + persistence.
 */
function hooksFor(accounting: AccountingSink): AccountingHooks {
  return {
    onLlmStep: async (step, timing) => {
      await accounting.llmStep({
        requestMessages: step.response.messages,
        responseContent: step.content,
        usage: step.usage,
        providerMetadata: step.providerMetadata,
        requestBody: step.request.body,
        text: step.text,
        reasoningText: step.reasoningText,
        ...(timing ? { startedAt: timing.startedAt, endedAt: timing.endedAt } : {}),
      });
    },
    onOverflow: (message) => accounting.emitOverflowStep(message),
    getRunKpis: () => {
      const k = accounting.runKpis;
      return {
        turns: k.turns,
        toolCalls: k.toolCalls,
        tokensIn: k.tokensIn,
        tokensOut: k.tokensOut,
        costUsd: k.costUsd,
        peakContextTokens: k.peakContextTokens,
      };
    },
  };
}

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Use the tools, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    modelId: "claude-sonnet-4",
    providerKind: "anthropic",
    ...over,
  };
}

/** Drive one full run (engine + accounting + persistence) and return the reloading repo. */
async function driveRun(
  db: AppDatabase,
  runId: string,
  testId: string,
  scenarioId: string,
): Promise<RunRepository> {
  const repo = new RunRepository(db);
  repo.createRun(runId, { testId, scenarioId, mode: "automated" });
  const manager = new RunManager(repo);
  manager.create(runId);

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: ALPHA }];
  const accounting = new AccountingSink(
    {
      runId,
      profiles: ["generic_o200k"],
      system: "You are a test harness.",
      allowedTools: allowed.map((a) => a.def),
      model: "claude-sonnet-4",
      providerKind: "anthropic",
    },
    (e) => manager.emit(runId, e),
  );
  const sink = createAccountingStepSink(manager, runId, accounting);
  const tools = buildTools(allowed, sessions, sink);

  const model = mockToolThenAnswer();
  await runAgentLoop(runId, baseConfig({ model, tools, accounting: hooksFor(accounting) }), (e) =>
    manager.emit(runId, e),
  );

  // The persistence sink runs on a microtask (the manager isolates it) — let the queue drain.
  await new Promise((resolve) => setImmediate(resolve));
  return repo;
}

/** A reloaded step carries valid ISO startedAt/endedAt with startedAt <= endedAt. */
function assertTimedStep(step: RunStep, label: string): { start: number; end: number } {
  assert.ok(step.startedAt, `${label} step carries startedAt`);
  assert.ok(step.endedAt, `${label} step carries endedAt`);
  const start = Date.parse(step.startedAt);
  const end = Date.parse(step.endedAt);
  assert.ok(
    Number.isFinite(start),
    `${label} startedAt is a valid ISO timestamp (got ${step.startedAt})`,
  );
  assert.ok(
    Number.isFinite(end),
    `${label} endedAt is a valid ISO timestamp (got ${step.endedAt})`,
  );
  // Round-trips back to ISO-8601 (rules out a bare number / malformed string slipping through).
  assert.equal(new Date(start).toISOString(), step.startedAt, `${label} startedAt is ISO-8601`);
  assert.equal(new Date(end).toISOString(), step.endedAt, `${label} endedAt is ISO-8601`);
  assert.ok(start <= end, `${label} startedAt <= endedAt (${step.startedAt} <= ${step.endedAt})`);
  return { start, end };
}

test("an interactive-style run persists monotonic per-step wall-clock for BOTH llm and tool steps", async () => {
  const db = createDatabase();
  seedParents(db, "test-timing", "scn-1");
  const runId = "run-timing";

  const repo = await driveRun(db, runId, "test-timing", "scn-1");
  const detail = repo.getRun(runId);

  // BOTH an llm_response step AND a tool_call step reload with valid timing. The engine emits TWO
  // `tool_call` steps per call — the stream-side one (no server/timing) and the MCP-sink one (carries
  // `serverId` + the real wall-clock around `session.callTool`). The timed step is the MCP-sink one.
  const llmStep = detail.steps.find((s) => s.type === "llm_response");
  const toolStep = detail.steps.find((s) => s.type === "tool_call" && s.serverId !== undefined);
  assert.ok(llmStep, "an llm_response step reloaded");
  assert.ok(toolStep, "an MCP-sink tool_call step reloaded");
  assertTimedStep(llmStep, "llm_response");
  assertTimedStep(toolStep, "tool_call");

  // The timeline reads in wall-clock order (the Gantt invariant). Collect every timed step.
  type Timed = { type: RunStep["type"]; start: number; end: number };
  const timed: Timed[] = detail.steps
    .filter(
      (s): s is RunStep & { startedAt: string; endedAt: string } =>
        s.startedAt !== undefined && s.endedAt !== undefined,
    )
    .map((s) => ({ type: s.type, start: Date.parse(s.startedAt), end: Date.parse(s.endedAt) }))
    .sort((a, b) => a.start - b.start);
  assert.ok(timed.length >= 2, "at least the llm + tool steps carry timing");

  // Whole timeline: sorted by start, every step's start is non-decreasing (trivially after sort, but
  // it also pins that no two steps invert) and every step is self-consistent (start <= end).
  for (let i = 1; i < timed.length; i += 1) {
    const prev = timed[i - 1]!;
    const cur = timed[i]!;
    assert.ok(cur.start >= prev.start, `timeline non-decreasing in start at index ${i}`);
    assert.ok(cur.start <= cur.end, `timeline step self-consistent (start <= end) at index ${i}`);
  }

  // The LLM-response spine — the sequential turn boundaries — is monotonic non-decreasing in BOTH
  // start AND end (turns run back-to-back, never overlapping: turn K ends exactly where turn K+1 begins).
  const llmTimed = timed.filter((t) => t.type === "llm_response");
  assert.ok(llmTimed.length >= 2, "two llm_response steps carry timing (tool turn + answer turn)");
  for (let i = 1; i < llmTimed.length; i += 1) {
    const prev = llmTimed[i - 1]!;
    const cur = llmTimed[i]!;
    assert.ok(cur.start >= prev.start, `llm spine non-decreasing in start at index ${i}`);
    assert.ok(cur.end >= prev.end, `llm spine non-decreasing in end at index ${i}`);
  }

  // A tool call nests inside the LLM timeline (its bar sits within a turn): every tool step's window
  // falls within the overall LLM span [first llm start, last llm end] — the correct Gantt layout.
  const runStart = llmTimed[0]!.start;
  const runEnd = llmTimed[llmTimed.length - 1]!.end;
  for (const t of timed.filter((x) => x.type === "tool_call")) {
    assert.ok(t.start >= runStart, "tool step starts within the run's LLM timeline");
    assert.ok(t.end <= runEnd, "tool step ends within the run's LLM timeline");
  }
});
