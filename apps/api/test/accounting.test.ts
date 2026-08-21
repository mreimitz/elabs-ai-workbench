import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition, RunEvent, RunStep } from "@mcp-token-footprint/shared";
import type { LanguageModelUsage } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { McpSession } from "../src/mcp/client.js";

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as agent-loop.test.ts — no extra dependency, always matches the installed SDK).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

import { AccountingSink, type AccountingContext } from "../src/testing/accounting.js";
import { runAgentLoop, type AccountingHooks, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";
import { createAccountingStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool, type StepSink } from "../src/testing/tool-bridge.js";

// A no-op tool-bridge sink: these tests drive the AccountingSink directly via the engine's onLlmStep
// hook, so the tool-side sink only needs to satisfy buildTools' signature. (Used by the tests that
// never issue a tool call. F3 made the run KPI a SINGLE accounting source — so a test that asserts a
// tool-call KPI must feed the call through the REAL `createAccountingStepSink`, as production does.)
const noopSink: StepSink = { toolCall: () => undefined };

// ── Test doubles (no API key, no child process — per the WP 1.3 pattern) ────────────────────────

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

const TOOL_DEFS: NormalizedToolDefinition[] = [
  {
    name: "alpha",
    description: "Alpha tool — fetches a value for a key",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "the lookup key" } },
      required: ["key"],
    },
    raw: {},
  },
  {
    name: "beta",
    description: "Beta tool — stores a value under a key",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "the storage key" },
        value: { type: "string", description: "the value to store" },
      },
      required: ["key", "value"],
    },
    raw: {},
  },
];

function defFor(name: string): NormalizedToolDefinition {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no def for ${name}`);
  return def;
}

// Provider-actual usage the mock model reports on `finish` (V3 usage shape). Distinct from any
// estimator lens so the estimate − actual delta is non-trivial.
const USAGE = {
  inputTokens: { total: 137, noCache: 137, cacheRead: 11, cacheWrite: 0 },
  outputTokens: { total: 23, text: 23, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

/** A mock model that calls one tool, then answers — exercising the LLM-step accounting on both turns. */
function mockToolThenAnswer(toolCall: { id: string; name: string; input: unknown }) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: JSON.stringify(toolCall.input),
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

/** A mock model that throws a provider context-length error from doStream (the overflow path). */
function mockContextOverflow() {
  return new MockLanguageModelV3({
    doStream: async () => {
      throw new Error("prompt is too long: 250000 tokens > 200000 maximum context length");
    },
  });
}

function collect(): { manager: RunManager; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const manager = new RunManager();
  return { manager, events };
}

function ctxFor(
  runId: string,
  allowed: AllowedTool[],
  over: Partial<AccountingContext> = {},
): AccountingContext {
  return {
    runId,
    profiles: ["generic_o200k", "generic_cl100k"],
    system: "You are a test harness.",
    allowedTools: allowed.map((a) => a.def),
    model: "claude-sonnet-4",
    providerKind: "anthropic",
    ...over,
  };
}

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Use the tools, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k", "generic_cl100k"],
    ...over,
  };
}

function hooksFor(accounting: AccountingSink): AccountingHooks {
  return {
    onLlmStep: async (step) => {
      await accounting.llmStep({
        requestMessages: step.response.messages,
        responseContent: step.content,
        usage: step.usage,
        providerMetadata: step.providerMetadata,
        requestBody: step.request.body,
        // F2 — per-turn prose + reasoning settle on the llm_response step.
        text: step.text,
        reasoningText: step.reasoningText,
      });
    },
    onOverflow: (message) => accounting.emitOverflowStep(message),
    // F3 — the engine's FINAL kpi reads the accounting sink's rolled-up totals (single KPI source).
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
    // RM-33 — the cache composition of the final kpi, delegated to the sink (one omit-when-absent rule).
    cacheKpiFields: () => accounting.cacheKpiFields(),
  };
}

function acctSteps(events: RunEvent[]): RunStep[] {
  return events
    .filter(
      (e): e is Extract<RunEvent, { type: "step" }> =>
        e.type === "step" && e.step.id.includes(":acct:"),
    )
    .map((e) => e.step);
}

// ── Acceptance 1: every llm_* step has estimator lenses AND provider-actual usage, with a delta ──

test("each llm step carries estimator lens counts, provider-actual usage, and a computed delta", async () => {
  const { manager, events } = collect();
  const runId = "run-lenses";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const accounting = new AccountingSink(ctxFor(runId, allowed), (e) => manager.emit(runId, e));
  // F3 — the run KPI is now sourced solely from the accounting sink, so feed the tool call through the
  // real accounting step sink (as production does) for the toolCalls KPI to reflect it.
  const tools = buildTools(allowed, sessions, createAccountingStepSink(manager, runId, accounting));

  const model = mockToolThenAnswer({ id: "c1", name: "alpha", input: { key: "x" } });
  const result = await runAgentLoop(
    runId,
    baseConfig({ model, tools, accounting: hooksFor(accounting) }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "completed");

  // Two provider round-trips → two accounting llm_response steps.
  const steps = acctSteps(events);
  assert.equal(steps.length, 2, "one accounting step per LLM round-trip");

  for (const step of steps) {
    assert.equal(step.type, "llm_response");

    // BOTH estimator lenses are populated (the run's two resolved profiles).
    assert.ok(typeof step.profileTokens.generic_o200k === "number", "o200k lens count present");
    assert.ok(typeof step.profileTokens.generic_cl100k === "number", "cl100k lens count present");
    assert.ok((step.profileTokens.generic_o200k ?? 0) > 0, "o200k lens count is non-zero");

    // Provider-actual usage from the scripted `finish.usage`.
    assert.ok(step.usageActual, "provider-actual usage present");
    assert.equal(step.usageActual.inputTokens, USAGE.inputTokens.total);
    assert.equal(step.usageActual.outputTokens, USAGE.outputTokens.total);
    assert.equal(
      step.usageActual.cachedInputTokens,
      USAGE.inputTokens.cacheRead,
      "anthropic cache read mapped",
    );
    assert.equal(
      step.usageActual.cacheReadTokens,
      USAGE.inputTokens.cacheRead,
      "cache-read split mapped",
    );
    assert.equal(
      step.usageActual.cacheWriteTokens,
      USAGE.inputTokens.cacheWrite,
      "cache-write split mapped",
    );

    // The estimate − actual delta is computed per lens in the redacted payload.
    const payload = step.payload as {
      deltas: Array<{ profile: string; inputDelta: number | null }>;
    };
    assert.ok(
      Array.isArray(payload.deltas) && payload.deltas.length === 2,
      "a delta per active lens",
    );
    const o200k = payload.deltas.find((d) => d.profile === "generic_o200k");
    assert.ok(o200k, "o200k delta present");
    assert.equal(typeof o200k.inputDelta, "number", "input delta is computed (actual − estimate)");

    // A context snapshot rolls up the segments for this step.
    assert.ok(step.context, "context snapshot present");
    assert.equal(step.context.limit, 200000, "limit comes from MODEL_CONTEXT_LIMITS");
    const seg = step.context.segments;
    assert.equal(
      step.context.total,
      seg.system + seg.tool_defs + seg.history + seg.tool_results + seg.output,
      "total rolls up the segments",
    );
  }

  // KPIs accumulate provider-actual tokens across both turns.
  const lastKpi = [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "kpi" }> => e.type === "kpi");
  assert.ok(lastKpi);
  assert.equal(lastKpi.tokensIn, USAGE.inputTokens.total * 2, "tokensIn summed across both steps");
  assert.equal(
    lastKpi.tokensOut,
    USAGE.outputTokens.total * 2,
    "tokensOut summed across both steps",
  );
  assert.equal(lastKpi.toolCalls, 1, "one tool call recorded");
});

// ── Acceptance 2 (the thesis): adding a tool to the allow-list raises turn-0 tool_defs tokens ────

test("the thesis: adding a tool to the allow-list raises the turn-0 tool_defs segment", async () => {
  async function turn0ToolDefs(allowed: AllowedTool[]): Promise<number> {
    const { manager, events } = collect();
    const runId = `run-thesis-${allowed.length}`;
    manager.create(runId);
    manager.subscribe(runId, (e) => events.push(e));

    const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
    const accounting = new AccountingSink(ctxFor(runId, allowed), (e) => manager.emit(runId, e));
    const tools = buildTools(allowed, sessions, noopSink);

    // No tool call — go straight to a final answer so turn 0 is the first (and only) LLM step.
    const model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "done" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ]),
    });

    await runAgentLoop(runId, baseConfig({ model, tools, accounting: hooksFor(accounting) }), (e) =>
      manager.emit(runId, e),
    );

    const steps = acctSteps(events);
    assert.ok(steps.length >= 1, "at least one accounting step at turn 0");
    return steps[0]!.context!.segments.tool_defs;
  }

  const withOne = await turn0ToolDefs([{ serverId: "srv", def: defFor("alpha") }]);
  const withTwo = await turn0ToolDefs([
    { serverId: "srv", def: defFor("alpha") },
    { serverId: "srv", def: defFor("beta") },
  ]);

  assert.ok(withOne > 0, "the single-tool baseline has a non-zero tool_defs slice");
  assert.ok(
    withTwo > withOne,
    `adding a tool strictly raises turn-0 tool_defs tokens (N=${withOne} → N+1=${withTwo})`,
  );
});

// ── Deferred tool loading: the resident tool_defs segment is 0 even with allow-listed tools ──────

test("deferred tool loading drops the resident tool_defs segment to 0", async () => {
  const { manager, events } = collect();
  const runId = "run-deferred-tooldefs";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const allowed: AllowedTool[] = [
    { serverId: "srv", def: defFor("alpha") },
    { serverId: "srv", def: defFor("beta") },
  ];
  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  // Deferred mode: the catalog is searched on demand, so the prefix carries no tool definitions.
  const accounting = new AccountingSink(
    ctxFor(runId, allowed, { toolLoadingMode: "deferred" }),
    (e) => manager.emit(runId, e),
  );
  const tools = buildTools(allowed, sessions, noopSink, undefined, { deferLoading: true });

  const model = new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "done" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]),
  });

  await runAgentLoop(runId, baseConfig({ model, tools, accounting: hooksFor(accounting) }), (e) =>
    manager.emit(runId, e),
  );

  const steps = acctSteps(events);
  assert.ok(steps.length >= 1, "at least one accounting step at turn 0");
  assert.equal(
    steps[0]!.context!.segments.tool_defs,
    0,
    "deferred mode keeps the tool definitions out of the resident prefix (tool_defs = 0)",
  );
});

// ── Deferred tool loading: the deferred catalog is EXCLUDED from the lens, not relabeled into history ─

test("deferred mode strips the deferred catalog from the lensed request body (not just tool_defs)", async () => {
  const allowed: AllowedTool[] = [
    { serverId: "srv", def: defFor("alpha") },
    { serverId: "srv", def: defFor("beta") },
  ];
  // A realistically-sized deferred tool entry as the Anthropic provider serializes it into the request
  // body: full name/description/input_schema, only tagged `defer_loading: true`.
  const deferredEntry = (name: string) => ({
    name,
    description: `Tool ${name}: ${"detailed behaviour ".repeat(20)}`,
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "q".repeat(120) } },
    },
    defer_loading: true,
  });

  async function snapshotFor(bodyTools: unknown[]) {
    const events: RunEvent[] = [];
    const accounting = new AccountingSink(
      ctxFor("run-strip", allowed, { toolLoadingMode: "deferred" }),
      (e) => events.push(e),
    );
    // Drive one settled LLM step directly with a production-shaped request body (the engine path uses
    // a mock that never sets request.body, so it would not exercise the strip).
    await accounting.llmStep({
      requestMessages: [{ role: "user", content: "hello" }],
      responseContent: [{ type: "text", text: "done" }],
      usage: { inputTokens: 100, outputTokens: 10 } as unknown as LanguageModelUsage,
      requestBody: {
        model: "claude-sonnet-4",
        system: "You are a test harness.",
        messages: [{ role: "user", content: "hello" }],
        tools: bodyTools,
      },
    });
    const step = events.find(
      (e): e is Extract<RunEvent, { type: "step" }> => e.type === "step" && Boolean(e.step.context),
    );
    assert.ok(step, "an accounting step with a context snapshot was emitted");
    return step.step.context!;
  }

  const withCatalog = await snapshotFor([deferredEntry("alpha"), deferredEntry("beta")]);
  const withoutCatalog = await snapshotFor([]);

  assert.equal(withCatalog.segments.tool_defs, 0, "deferred keeps the tool_defs segment at 0");
  // The deferred catalog is stripped BEFORE counting, so adding it to the body must not change the
  // lensed total or history — i.e. it is excluded, not merely relabeled from tool_defs into history.
  assert.equal(
    withCatalog.total,
    withoutCatalog.total,
    "the deferred catalog is excluded from the lensed total (not relabeled into history)",
  );
  assert.equal(
    withCatalog.segments.history,
    withoutCatalog.segments.history,
    "history is unaffected by the deferred catalog",
  );
});

// ── Acceptance 3: a forced context-limit error → outcome context_overflow, no crash ─────────────

test("a forced context-limit error yields outcome context_overflow and does not crash the run", async () => {
  const { manager, events } = collect();
  const runId = "run-overflow";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const accounting = new AccountingSink(ctxFor(runId, allowed), (e) => manager.emit(runId, e));

  const model = mockContextOverflow();
  // The loop must NOT throw — a provider context-limit error is recorded as a legitimate result.
  const result = await runAgentLoop(
    runId,
    baseConfig({ model, tools: {}, accounting: hooksFor(accounting) }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.outcome, "context_overflow", "the run outcome is context_overflow");
  assert.notEqual(result.status, "error", "context overflow is a legitimate result, not an error");

  // A context_event step was recorded.
  const overflowStep = acctSteps(events).find((s) => s.type === "context_event");
  assert.ok(overflowStep, "a context_event step is emitted for the overflow");
  assert.equal(overflowStep.label, "context_overflow");
  assert.match((overflowStep.payload as { message: string }).message, /too long|context/i);

  // The terminal status event carries outcome context_overflow.
  const lastStatus = [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
  assert.equal(lastStatus?.status, "stopped");
  assert.equal(lastStatus?.outcome, "context_overflow", "terminal status reports context_overflow");

  // No generic `error` RunEvent was emitted (overflow is not a crash).
  assert.ok(
    !events.some((e) => e.type === "error"),
    "no generic error event — overflow is recorded, not crashed",
  );

  // AR11 — the manager stays registered through the post-terminal review window and cleans up once
  // a SETTLED `rating` event lands on top of the terminal status (the run service guarantees one).
  manager.emit(runId, { type: "rating", state: "skipped" });
  assert.equal(
    manager.isActive(runId),
    false,
    "the run manager cleaned up after the settled rating",
  );
});

// ── RM-33 WP 1.2 (D-CT1/D-CT2/D-CT6) — the cache split on the rolled-up `kpi` event ─────────────
//
// Before this, the sink accumulated `cachedTokens` internally and the emit dropped it, so the ONE
// event the console KPI rail and the run row are both built from could not say how much of its
// `tokensIn` was cache. The RunRepository worked around it by re-summing the steps; nothing on the
// wire could.

test("RM-33 — the kpi event carries the cache split, and tokensIn stays GROSS", async () => {
  const { manager, events } = collect();
  const runId = "run-kpi-cache";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const accounting = new AccountingSink(ctxFor(runId, allowed), (e) => manager.emit(runId, e));
  const tools = buildTools(allowed, sessions, createAccountingStepSink(manager, runId, accounting));

  const model = mockToolThenAnswer({ id: "c1", name: "alpha", input: { key: "x" } });
  await runAgentLoop(
    runId,
    baseConfig({ model, tools, accounting: hooksFor(accounting) }),
    (e) => manager.emit(runId, e),
  );

  const lastKpi = [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "kpi" }> => e.type === "kpi");
  assert.ok(lastKpi);

  // D-CT1 — the split is ADDITIVE. `tokensIn` is untouched: still the provider-billed gross total,
  // cached slice included. Nothing was subtracted from it to make room for the new fields.
  assert.equal(lastKpi.tokensIn, USAGE.inputTokens.total * 2, "tokensIn is unchanged and gross");

  assert.equal(lastKpi.cacheReadTokens, USAGE.inputTokens.cacheRead * 2, "cache reads summed");
  assert.equal(lastKpi.cacheWriteTokens, USAGE.inputTokens.cacheWrite * 2, "cache writes summed");
  assert.equal(
    lastKpi.cachedTokens,
    (USAGE.inputTokens.cacheRead + USAGE.inputTokens.cacheWrite) * 2,
    "the merged figure is still the sum of the two halves",
  );
  // The split can never exceed the gross it decomposes.
  assert.ok(
    (lastKpi.cacheReadTokens ?? 0) + (lastKpi.cacheWriteTokens ?? 0) <= lastKpi.tokensIn,
    "the cache slice is a SUBSET of tokensIn, never an addition to it",
  );
});

test("RM-33 — a run with no cache slice emits the pre-RM-33 kpi event VERBATIM", async () => {
  // D-CT6's other half. "Additive" has to mean it: a backend that never reports cache must not start
  // emitting three new keys, because a consumer cannot tell a `cacheReadTokens: 0` that means "no
  // cache happened" from one that means "this backend does not report cache". Absence is the signal.
  const { manager, events } = collect();
  const runId = "run-kpi-nocache";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  // A provider that reports NO cache detail at all — not one that reports a zero. The distinction is
  // the whole point: `cacheRead: 0` is the provider SAYING "nothing was cached", which is real
  // information and does get emitted. Silence is different, and must stay silent on the wire.
  const noCacheUsage = {
    inputTokens: { total: 137, noCache: 137 },
    outputTokens: { total: 23, text: 23 },
  } as const;
  const model = new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Answer." },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "end_turn" },
          usage: noCacheUsage as unknown as LanguageModelUsage,
        },
      ]),
  });

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const accounting = new AccountingSink(ctxFor(runId, allowed), (e) => manager.emit(runId, e));
  const tools = buildTools(allowed, sessions, noopSink);
  await runAgentLoop(
    runId,
    baseConfig({ model, tools, accounting: hooksFor(accounting) }),
    (e) => manager.emit(runId, e),
  );

  const lastKpi = [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "kpi" }> => e.type === "kpi");
  assert.ok(lastKpi);
  assert.equal(lastKpi.tokensIn, noCacheUsage.inputTokens.total);
  assert.ok(!("cachedTokens" in lastKpi), "no cachedTokens key at all");
  assert.ok(!("cacheReadTokens" in lastKpi), "no cacheReadTokens key at all");
  assert.ok(!("cacheWriteTokens" in lastKpi), "no cacheWriteTokens key at all");
});

test("RM-33 — a provider that reports no cache at all yields no cache fields", async () => {
  // Scope note, so this test is not read as more than it is: the CURRENT extractor derives
  // `cachedInputTokens` by summing the two halves, so it can never produce a merged-only record. The
  // merged-only shape is HISTORICAL — 6 runs in a real 163-run database carry it, persisted by an
  // older extractor — and it reaches the run row through REPLAY of those persisted steps, not through
  // this sink. The guard for it therefore lives in `RunRepository.finalize` and migration v59, and is
  // tested there (run-persistence.test.ts, migrations.test.ts case b2). What this test pins is the
  // simpler live invariant: silence in, silence out.
  const { manager, events } = collect();
  const runId = "run-kpi-silent";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const accounting = new AccountingSink(ctxFor(runId, []), (e) => manager.emit(runId, e));
  await accounting.llmStep({
    requestMessages: [],
    responseContent: [{ type: "text", text: "hi" }],
    usage: { inputTokens: 1000, outputTokens: 20 } as unknown as LanguageModelUsage,
    providerMetadata: undefined,
    requestBody: undefined,
    text: "hi",
  });

  assert.deepEqual(
    accounting.cacheKpiFields(),
    {},
    "no cache reported at all ⇒ no keys (the pre-RM-33 event shape, byte-for-byte)",
  );
});
