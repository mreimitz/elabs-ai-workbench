import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { RunDetail, RunEvent, RunStep } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { estimateCost } from "../src/providers/pricing.js";
import { RunRepository } from "../src/testing/run-repository.js";
import {
  runSessionLevel,
  sessionRunFromDetail,
  type SessionRun,
} from "../src/compatibility/session.js";

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const find = (results: { testId: string }[], id: string) => results.find((r) => r.testId === id);

function baseRun(over: Partial<SessionRun> = {}): SessionRun {
  return {
    runId: "run_1",
    peakContextTokens: 50_000,
    turns: [{ toolCallCount: 2, parallelCallCount: 2 }],
    toolResults: [{ toolName: "alpha", tokens: 1_000, durationMs: 500 }],
    systemPromptTokens: 500,
    toolDefTokens: 2_000,
    totals: { inputTokens: 10_000, outputTokens: 2_000, cachedInputTokens: 0, reasoningTokens: 0 },
    tokensPerMinute: 100_000,
    ...over,
  };
}

// ── runSessionLevel: the 8 session tests over synthetic runs ────────────────────────────────────

test("runSessionLevel emits exactly the 7 measurable session-level tests, all subjectType=session", () => {
  const results = runSessionLevel(baseRun(), "gpt-5.5");
  const ids = results.map((r) => r.testId).sort();
  // SESSION_RATE_LIMIT_THROUGHPUT is excluded (its input_tpm_tier source is unmodelled → permanent na),
  // alongside SESSION_TASK_SUCCESS_RATE — see the EXCLUDED set in runSessionLevel.
  assert.deepEqual(ids, [
    "SESSION_CACHE_ELIGIBILITY",
    "SESSION_CALLS_PER_TURN",
    "SESSION_CONTEXT_HIGHWATER",
    "SESSION_COST_PER_TASK",
    "SESSION_PARALLEL_CALLS",
    "SESSION_TOOL_RESULT_SIZE",
    "SESSION_TOOL_TIMEOUT",
  ]);
  assert.ok(results.every((r) => r.level === "session" && r.subjectType === "session"));
  assert.ok(results.every((r) => r.subjectId === "run_1"));
});

test("SESSION_RATE_LIMIT_THROUGHPUT is excluded (no input_tpm_tier modelled), not emitted as a dead na", () => {
  const results = runSessionLevel(baseRun(), "gpt-5.5");
  assert.equal(find(results, "SESSION_RATE_LIMIT_THROUGHPUT"), undefined);
});

test("unknown model → no results", () => {
  assert.deepEqual(runSessionLevel(baseRun(), "no-such-model"), []);
});

test("a healthy run passes the window-bound + cost tests on a frontier model", () => {
  const results = runSessionLevel(baseRun(), "gpt-5.5");
  assert.equal(find(results, "SESSION_CONTEXT_HIGHWATER")?.verdict, "pass");
  assert.equal(find(results, "SESSION_TOOL_RESULT_SIZE")?.verdict, "pass");
  assert.equal(find(results, "SESSION_CALLS_PER_TURN")?.verdict, "pass");
});

test("an over-window cumulative high-water trips SESSION_CONTEXT_HIGHWATER as a blocker fail", () => {
  // microsoft/phi-4 window = 16,384; a 20k peak overflows. The authored per-model rule grades
  // overflow on a small window (<32k) as a BLOCKER (on a ≥200k window it resolves to `high` — see
  // the SESSION_CONTEXT_HIGHWATER model_severity window bands).
  const results = runSessionLevel(baseRun({ peakContextTokens: 20_000 }), "microsoft/phi-4");
  const hw = find(results, "SESSION_CONTEXT_HIGHWATER");
  assert.equal(hw?.verdict, "fail");
  assert.equal(hw?.severity, "blocker");
  assert.equal(hw?.measured.value, 20_000);
  assert.equal(typeof hw?.threshold.value, "number");
  assert.ok((hw?.threshold.value as number) < 20_000, "threshold is the model window");
});

test("over-window high-water on a large-window model resolves to high (authored window band)", () => {
  // Same overflow on gpt-5.5 (≈1.05M window) is still a fail, but the authored rule weights it `high`.
  const hw = find(
    runSessionLevel(baseRun({ peakContextTokens: 1_200_000 }), "gpt-5.5"),
    "SESSION_CONTEXT_HIGHWATER",
  );
  assert.equal(hw?.verdict, "fail");
  assert.equal(hw?.severity, "high");
});

test("the window high-water warns in the 80–100% band", () => {
  const window = find(runSessionLevel(baseRun(), "gpt-5.5"), "SESSION_CONTEXT_HIGHWATER")?.threshold
    .value as number;
  const results = runSessionLevel(
    baseRun({ peakContextTokens: Math.round(0.9 * window) }),
    "gpt-5.5",
  );
  assert.equal(find(results, "SESSION_CONTEXT_HIGHWATER")?.verdict, "warn");
});

test("a chatty tool result trips SESSION_TOOL_RESULT_SIZE via the window-share budget", () => {
  // microsoft/phi-4 has a small window (16,384); a 200k-token result blows past the 25% fail band.
  const chatty = baseRun({
    toolResults: [{ toolName: "chatty", tokens: 200_000, durationMs: 100 }],
  });
  const trs = find(runSessionLevel(chatty, "microsoft/phi-4"), "SESSION_TOOL_RESULT_SIZE");
  assert.equal(trs?.verdict, "fail");
  assert.equal(trs?.measured.value, 200_000);

  // The same modest result on a frontier model is well within budget.
  const fine = find(runSessionLevel(baseRun(), "gpt-5.5"), "SESSION_TOOL_RESULT_SIZE");
  assert.equal(fine?.verdict, "pass");
});

test("a documented byte cap is used when the result carries bytes (OpenAI 512KB)", () => {
  // gpt-5.5 documents max_tool_result_size = 512KB; a 600KB result fails on bytes (not window share).
  const big = baseRun({
    toolResults: [{ toolName: "blob", tokens: 1_000, bytes: 600 * 1024, durationMs: 10 }],
  });
  const trs = find(runSessionLevel(big, "gpt-5.5"), "SESSION_TOOL_RESULT_SIZE");
  assert.equal(trs?.verdict, "fail");
  assert.equal(trs?.threshold.unit, "bytes");
  assert.equal(trs?.threshold.value, 512 * 1024);
});

test("SESSION_COST_PER_TASK uses the unified dataset pricing (matches estimateCost)", () => {
  const run = baseRun();
  const cost = find(runSessionLevel(run, "gpt-5.5"), "SESSION_COST_PER_TASK");
  const expected = Number(estimateCost("gpt-5.5", run.totals).toFixed(6));
  assert.equal(cost?.measured.value, expected);
  assert.equal(cost?.measured.unit, "USD");
  assert.equal(cost?.verdict, "pass"); // informational without a budget
});

test("SESSION_COST_PER_TASK warns above a per-task budget", () => {
  const run = baseRun();
  const cost = estimateCost("gpt-5.5", run.totals);
  const warned = find(
    runSessionLevel(run, "gpt-5.5", { costBudgetUsd: cost / 2 }),
    "SESSION_COST_PER_TASK",
  );
  assert.equal(warned?.verdict, "warn");
  const under = find(
    runSessionLevel(run, "gpt-5.5", { costBudgetUsd: cost * 2 }),
    "SESSION_COST_PER_TASK",
  );
  assert.equal(under?.verdict, "pass");
});

test("SESSION_COST_PER_TASK is NA for a self-hosted (unpriced) model", () => {
  const cost = find(runSessionLevel(baseRun(), "microsoft/phi-4"), "SESSION_COST_PER_TASK");
  assert.equal(cost?.verdict, "na");
});

test("SESSION_CACHE_ELIGIBILITY: pass when prefix ≥ min, warn below, NA for a non-caching model", () => {
  // gpt-5.5 caches with a 1024 minimum; a 2,500-token prefix is eligible.
  assert.equal(
    find(runSessionLevel(baseRun(), "gpt-5.5"), "SESSION_CACHE_ELIGIBILITY")?.verdict,
    "pass",
  );

  // A tiny prefix won't trigger caching → warn.
  const tiny = baseRun({ systemPromptTokens: 10, toolDefTokens: 50 });
  assert.equal(
    find(runSessionLevel(tiny, "gpt-5.5"), "SESSION_CACHE_ELIGIBILITY")?.verdict,
    "warn",
  );

  // microsoft/phi-4 has no prompt caching → NA.
  assert.equal(
    find(runSessionLevel(baseRun(), "microsoft/phi-4"), "SESSION_CACHE_ELIGIBILITY")?.verdict,
    "na",
  );
});

test("SESSION_CALLS_PER_TURN trips against the provider agent-loop cap (OpenAI 10)", () => {
  const busy = baseRun({ turns: [{ toolCallCount: 15, parallelCallCount: 1 }] });
  const calls = find(runSessionLevel(busy, "gpt-5.5"), "SESSION_CALLS_PER_TURN");
  assert.equal(calls?.verdict, "fail");
  assert.equal(calls?.threshold.value, 10);
});

test("SESSION_PARALLEL_CALLS is NA when no parallel-call cap is documented", () => {
  const results = runSessionLevel(baseRun(), "gpt-5.5");
  assert.equal(find(results, "SESSION_PARALLEL_CALLS")?.verdict, "na");
});

test("SESSION_TOOL_TIMEOUT: client timeout wins; a slow tool fails the cancellation band", () => {
  // m365_copilot documents a 45s tool-call timeout; a 50s tool exceeds it (fail).
  const slow = baseRun({ toolResults: [{ toolName: "slow", tokens: 10, durationMs: 50_000 }] });
  const t = find(
    runSessionLevel(slow, "gpt-5.5", { client: "m365_copilot" }),
    "SESSION_TOOL_TIMEOUT",
  );
  assert.equal(t?.verdict, "fail");
  assert.equal(t?.threshold.value, 45_000);
  assert.equal(t?.threshold.source, "cross.clients.m365_copilot.tool_call_timeout_ms");

  // Without a client, the SDK 60s default applies; a 500ms tool passes.
  const fast = find(runSessionLevel(baseRun(), "gpt-5.5"), "SESSION_TOOL_TIMEOUT");
  assert.equal(fast?.verdict, "pass");
  assert.equal(fast?.threshold.value, 60_000);
});

// ── sessionRunFromDetail: adapt a persisted RunDetail ───────────────────────────────────────────

test("sessionRunFromDetail derives turns, tool-result sizes/latency, prefix, totals + peak", () => {
  const detail: RunDetail = {
    id: "run_42",
    testId: "t1",
    scenarioId: "s1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-06-21T00:00:00.000Z",
    durationMs: 30_000, // 30s → token rate is (in+out) * 2 per minute
    turns: 2,
    toolCalls: 3,
    peakContextTokens: 0, // intentionally stale: the per-step series should win
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    steps: [
      {
        id: "a0",
        runId: "run_42",
        index: 0,
        type: "llm_response",
        label: "gpt-5.5",
        status: "ok",
        profileTokens: { generic_o200k: 1_000 },
        usageActual: { inputTokens: 4_000, outputTokens: 500 },
        context: {
          total: 4_500,
          limit: 1_050_000,
          segments: {
            system: 300,
            tool_defs: 2_000,
            history: 1_200,
            tool_results: 0,
            output: 1_000,
          },
        },
        cumulativeTokens: 4_500,
        payload: {},
      },
      // Two tool calls issued by turn 0 (a parallel batch of 2).
      {
        id: "m0",
        runId: "run_42",
        index: 1,
        type: "tool_call",
        label: "alpha",
        status: "ok",
        durationMs: 250,
        toolName: "alpha",
        profileTokens: { generic_o200k: 800 },
        payload: {},
      },
      {
        id: "m1",
        runId: "run_42",
        index: 2,
        type: "tool_call",
        label: "beta",
        status: "ok",
        durationMs: 9_000,
        toolName: "beta",
        profileTokens: { generic_o200k: 120_000 },
        payload: {},
      },
      {
        id: "a1",
        runId: "run_42",
        index: 3,
        type: "llm_response",
        label: "gpt-5.5",
        status: "ok",
        profileTokens: { generic_o200k: 2_000 },
        usageActual: { inputTokens: 6_000, outputTokens: 800, cachedInputTokens: 100 },
        context: {
          total: 130_000,
          limit: 1_050_000,
          segments: {
            system: 300,
            tool_defs: 2_000,
            history: 5_000,
            tool_results: 121_000,
            output: 1_700,
          },
        },
        cumulativeTokens: 130_000,
        payload: {},
      },
    ],
    events: [],
  };

  const run = sessionRunFromDetail(detail);

  // Two turns; turn 0 issued a parallel batch of 2, turn 1 none.
  assert.equal(run.turns.length, 2);
  assert.equal(run.turns[0]?.toolCallCount, 2);
  assert.equal(run.turns[0]?.parallelCallCount, 2);
  assert.equal(run.turns[1]?.toolCallCount, 0);

  // Tool-result sizes + latency come off the tool_call steps' profileTokens / durationMs.
  assert.equal(run.toolResults.length, 2);
  assert.deepEqual(
    run.toolResults.map((r) => [r.toolName, r.tokens, r.durationMs]),
    [
      ["alpha", 800, 250],
      ["beta", 120_000, 9_000],
    ],
  );

  // Static prefix from the first snapshot's system + tool_defs segments.
  assert.equal(run.systemPromptTokens, 300);
  assert.equal(run.toolDefTokens, 2_000);

  // Totals summed from per-step provider-actual usage.
  assert.equal(run.totals.inputTokens, 10_000);
  assert.equal(run.totals.outputTokens, 1_300);
  assert.equal(run.totals.cachedInputTokens, 100);

  // Peak from the per-step cumulative series (beats the stale summary 0).
  assert.equal(run.peakContextTokens, 130_000);

  // Rate: (10000 + 1300) tokens over 30s → ×2 per minute.
  assert.equal(run.tokensPerMinute, (11_300 * 60_000) / 30_000);

  // And it scores end-to-end: the 120k-token beta result + 9s latency are within a frontier model's budget.
  const results = runSessionLevel(run, "gpt-5.5");
  assert.equal(find(results, "SESSION_TOOL_RESULT_SIZE")?.measured.value, 120_000);
  assert.equal(find(results, "SESSION_CONTEXT_HIGHWATER")?.measured.value, 130_000);
});

test("sessionRunFromDetail de-dups the stream+bridge tool_call pair and groups by turnIndex (no double count)", () => {
  // Each LOGICAL call persists TWO tool_call steps: the engine STREAM step (turnIndex + zero tokens)
  // and the MCP-BRIDGE step (serverId + durationMs + real size/bytes), sharing payload.toolCallId.
  const llm = (turnIndex: number, cumulative: number): RunStep => ({
    id: `a${turnIndex}`,
    runId: "r",
    index: 0,
    type: "llm_response",
    label: "gpt-5.5",
    status: "ok",
    turnIndex,
    profileTokens: { generic_o200k: 1 },
    usageActual: { inputTokens: 100, outputTokens: 10 },
    cumulativeTokens: cumulative,
    payload: {},
  });
  const stream = (id: string, name: string, turnIndex: number): RunStep => ({
    id: `s_${id}`,
    runId: "r",
    index: 0,
    type: "tool_call",
    label: name,
    status: "ok",
    turnIndex,
    profileTokens: { generic_o200k: 0 },
    payload: { toolCallId: id },
  });
  const bridge = (
    id: string,
    name: string,
    tokens: number,
    bytes: number,
    durationMs: number,
  ): RunStep => ({
    id: `b_${id}`,
    runId: "r",
    index: 0,
    type: "tool_call",
    label: name,
    status: "ok",
    durationMs,
    serverId: "srv",
    toolName: name,
    profileTokens: { generic_o200k: tokens },
    resultBytes: bytes,
    payload: { toolCallId: id },
  });
  const detail: RunDetail = {
    id: "run_dup",
    testId: "t",
    scenarioId: "s",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-06-21T00:00:00.000Z",
    durationMs: 60_000,
    turns: 2,
    toolCalls: 3,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    events: [],
    steps: [
      llm(0, 4_500),
      stream("c1", "alpha", 0),
      stream("c2", "beta", 0), // two parallel calls in assistant turn 0
      bridge("c1", "alpha", 800, 1_000, 100),
      bridge("c2", "beta", 1_200, 2_000, 200),
      llm(1, 9_000),
      stream("c3", "gamma", 1),
      bridge("c3", "gamma", 500, 700, 50), // one call in turn 1
    ],
  };
  const run = sessionRunFromDetail(detail);

  // 3 logical calls (not 6) — the stream + bridge steps collapsed by toolCallId; sizes/bytes from the bridge.
  assert.equal(run.toolResults.length, 3);
  assert.deepEqual(
    run.toolResults.map((r) => [r.toolName, r.tokens, r.bytes, r.durationMs]),
    [
      ["alpha", 800, 1_000, 100],
      ["beta", 1_200, 2_000, 200],
      ["gamma", 500, 700, 50],
    ],
  );
  // Turn 0 = 2 parallel calls, turn 1 = 1 — NOT the old doubled 4 / 2.
  assert.deepEqual(
    run.turns.map((t) => t.toolCallCount),
    [2, 1],
  );
  assert.deepEqual(
    run.turns.map((t) => t.parallelCallCount),
    [2, 1],
  );

  // And it scores: OpenAI's agent-loop cap is 10, so 2 calls/turn passes (the double-count would have
  // counted 4 — still a pass here, but the parallel/sequential semantics are now correct).
  assert.equal(find(runSessionLevel(run, "gpt-5.5"), "SESSION_CALLS_PER_TURN")?.verdict, "pass");
});

// ── Persistence: the new run_steps.cumulative_tokens column round-trips ──────────────────────────

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

function seedParents(db: AppDatabase, testId: string, scenarioId: string): void {
  const now = "2026-06-21T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'openai', 'GPT', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'gpt-5.5', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'List', 'go', '[]', @now, @now)`,
  ).run({ id: testId, now });
}

test("schema defines run_steps.cumulative_tokens and it round-trips through the repository", () => {
  const db = createDatabase();

  // The column exists on a fresh schema (CREATE TABLE) — the additive migration covers existing DBs.
  const columns = (db.prepare("PRAGMA table_info(run_steps)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  assert.ok(columns.includes("cumulative_tokens"), "run_steps has the cumulative_tokens column");

  seedParents(db, "t1", "s1");
  const repo = new RunRepository(db);
  repo.createRun("run-cumul", { testId: "t1", scenarioId: "s1", mode: "automated" });

  // Emit an LLM step carrying a cumulative total + a tool_call step without one (NULL is preserved).
  const llmStep: RunEvent = {
    type: "step",
    step: {
      id: "x",
      runId: "run-cumul",
      index: 0,
      type: "llm_response",
      label: "gpt-5.5",
      status: "ok",
      profileTokens: { generic_o200k: 1_234 },
      usageActual: { inputTokens: 100, outputTokens: 20 },
      context: {
        total: 4_321,
        limit: 1_050_000,
        segments: { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 },
      },
      cumulativeTokens: 4_321,
      payload: {},
    },
  };
  const toolStep: RunEvent = {
    type: "step",
    step: {
      id: "y",
      runId: "run-cumul",
      index: 1,
      type: "tool_call",
      label: "alpha",
      status: "ok",
      durationMs: 12,
      toolName: "alpha",
      profileTokens: { generic_o200k: 50 },
      resultBytes: 4_096,
      payload: {},
    },
  };
  repo.onEvent("run-cumul", llmStep);
  repo.onEvent("run-cumul", toolStep);
  repo.onEvent("run-cumul", {
    type: "kpi",
    turns: 1,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 4_321,
    costUsd: 0,
  });
  repo.onEvent("run-cumul", { type: "status", status: "completed", outcome: "completed" });

  const detail = repo.getRun("run-cumul");
  const llm = detail.steps.find((s) => s.type === "llm_response");
  const tool = detail.steps.find((s) => s.type === "tool_call");
  assert.equal(llm?.cumulativeTokens, 4_321, "cumulative_tokens persisted + read back");
  assert.equal(tool?.cumulativeTokens, undefined, "absent cumulative stays NULL/undefined");
  assert.equal(
    tool?.resultBytes,
    4_096,
    "result_bytes persisted + read back on the tool_call step",
  );
  assert.equal(llm?.resultBytes, undefined, "absent result_bytes stays NULL/undefined");

  // The adapter then reads the same cumulative series for the high-water test.
  const run = sessionRunFromDetail(detail);
  assert.equal(run.peakContextTokens, 4_321);
});
