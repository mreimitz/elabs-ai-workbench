import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  GuardrailConfig,
  NormalizedToolDefinition,
  RunEvent,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { MODEL_PRICING, estimateCost } from "../src/providers/pricing.js";
import type { McpSession } from "../src/mcp/client.js";
import { runAgentLoop, type EngineConfig } from "../src/testing/engine.js";
import { check, initialGuardrailState } from "../src/testing/guardrails.js";
import { RunManager } from "../src/testing/run-manager.js";
import { createDefaultStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as agent-loop.test.ts / accounting.test.ts — no extra dependency, always matches the SDK).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

// ── Test doubles (no API key, no child process — per the WP 1.3 pattern) ────────────────────────

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

function defFor(name: string): NormalizedToolDefinition {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no def for ${name}`);
  return def;
}

// Provider-actual usage reported on every `finish`. Distinct in/out so token math is unambiguous.
const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
} as const;

const STEP_TOKENS = USAGE.inputTokens.total + USAGE.outputTokens.total; // 150 per step

function streamOf(chunks: LanguageModelV3StreamPart[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

/**
 * A mock model that calls `alpha` on EVERY step and never finishes naturally. Each step is a tool
 * round-trip with the scripted usage, so the multi-step loop keeps going until a guardrail (or the
 * step cap) stops it. The SDK re-evaluates `stopWhen` after each tool round-trip.
 */
function mockAlwaysCallsTool() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      return streamOf([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: `c${call}`,
          toolName: "alpha",
          input: JSON.stringify({ n: call }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
      ]);
    },
  });
}

/** A mock model that stops on its own after one round-trip (finishReason "stop") — no tool calls. */
function mockStopsImmediately() {
  return new MockLanguageModelV3({
    doStream: async () =>
      streamOf([
        { type: "stream-start", warnings: [] },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
      ]),
  });
}

function collect(): { manager: RunManager; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const manager = new RunManager();
  return { manager, events };
}

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Use the tools.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    modelId: "claude-sonnet-4",
    providerKind: "anthropic",
    ...over,
  };
}

/** Run the always-tool-calling model under a guardrail config; return the terminal result + events. */
async function runUnderGuardrail(runId: string, guardrails: GuardrailConfig) {
  const { manager, events } = collect();
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));
  const model = mockAlwaysCallsTool();

  const result = await runAgentLoop(runId, baseConfig({ model, tools, guardrails }), (e) =>
    manager.emit(runId, e),
  );
  return { result, events };
}

function lastStatus(events: RunEvent[]) {
  return [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
}

function lastKpi(events: RunEvent[]) {
  return [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "kpi" }> => e.type === "kpi");
}

// ── Unit: the pure `check()` names the FIRST crossed budget, `>=`, in order ──────────────────────

test("check() names the first crossed guardrail (>=, in tool→token→context→cost order)", () => {
  const s = initialGuardrailState();
  s.toolCalls = 3;
  s.tokens = 1000;
  s.contextTokens = 500;
  s.costUsd = 0.1;

  assert.equal(check(s, {}), undefined, "no caps → never trips");
  assert.equal(check(s, { maxCostUsd: 0.05 }), "maxCostUsd", "cost crosses");
  assert.equal(check(s, { maxContextTokens: 500 }), "maxContextTokens", ">= boundary trips");
  assert.equal(check(s, { maxTokens: 1000 }), "maxTokens", ">= boundary trips");
  assert.equal(check(s, { maxToolCalls: 3 }), "maxToolCalls", ">= boundary trips");
  // First-in-order wins when several cross at once.
  assert.equal(
    check(s, { maxToolCalls: 3, maxTokens: 1000, maxContextTokens: 500, maxCostUsd: 0.05 }),
    "maxToolCalls",
  );
  // A 0/unset cap is "no limit".
  assert.equal(check(s, { maxToolCalls: 0 }), undefined, "a 0 cap is no-limit");
});

// ── Acceptance 1a: maxToolCalls fires and names itself ───────────────────────────────────────────

test("maxToolCalls guardrail fires and names itself in stop_reason", async () => {
  const { result, events } = await runUnderGuardrail("run-tool-cap", { maxToolCalls: 2 });

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReason, "maxToolCalls", "the tripped guardrail names itself");
  assert.ok(result.toolCalls >= 2, "the loop ran at least up to the cap");

  const status = lastStatus(events);
  assert.equal(status?.outcome, "stopped_guardrail");
  assert.equal(status?.stopReason, "maxToolCalls");
  // WP1.7 — closes the WP1.1 gap: maxToolCalls now carries its own machine-readable stopReasonCode.
  assert.equal(status?.stopReasonCode, "max_tool_calls");
});

// ── Acceptance 1b: maxTokens fires and names itself ──────────────────────────────────────────────

test("maxTokens guardrail fires and names itself in stop_reason", async () => {
  // Each step = 150 provider-actual tokens; a 200-token cap trips after the 2nd step.
  const { result } = await runUnderGuardrail("run-token-cap", { maxTokens: 200 });

  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReason, "maxTokens", "the token budget names itself");
});

// ── Acceptance 1c: maxContextTokens fires and names itself ───────────────────────────────────────

test("maxContextTokens guardrail fires and names itself in stop_reason", async () => {
  // Context = the latest step window (150 tokens). A 150-token context cap trips at the boundary.
  const { result } = await runUnderGuardrail("run-context-cap", { maxContextTokens: STEP_TOKENS });

  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReason, "maxContextTokens", "the context budget names itself");
});

// ── Acceptance 1d + 2: maxCostUsd fires, names itself, and cost == actual tokens × pricing ───────

test("maxCostUsd guardrail halts the run; cost equals actual tokens × pricing", async () => {
  const MODEL = "claude-sonnet-4";
  const pricing = MODEL_PRICING[MODEL];
  assert.ok(pricing, "known pricing entry under test");

  // Exact per-step cost from the known pricing + known mock usage (no cache).
  const perStepCost =
    (USAGE.inputTokens.total / 1e6) * pricing.inPer1M +
    (USAGE.outputTokens.total / 1e6) * pricing.outPer1M;
  assert.ok(perStepCost > 0, "per-step cost is non-zero");

  // estimateCost is the SAME function the engine prices with — assert it matches the hand math.
  assert.equal(
    estimateCost(MODEL, {
      inputTokens: USAGE.inputTokens.total,
      outputTokens: USAGE.outputTokens.total,
    }),
    perStepCost,
    "estimateCost == actual tokens × pricing",
  );

  // Cap at 1.5× the per-step cost → trips after the 2nd step (cumulative 2× crosses 1.5×).
  const cap = perStepCost * 1.5;
  const { result, events } = await runUnderGuardrail("run-cost-cap", { maxCostUsd: cap });

  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReason, "maxCostUsd", "the spend cap names itself");

  // The reported run cost is the exact cumulative actual-tokens × pricing for the steps that ran.
  const kpi = lastKpi(events);
  assert.ok(kpi);
  assert.ok(kpi.costUsd >= cap, "the run halted at or past the spend cap");
  const expected = perStepCost * result.turns;
  assert.ok(
    Math.abs(kpi.costUsd - expected) < 1e-12,
    `run cost == per-step cost × turns (${kpi.costUsd} vs ${expected})`,
  );
});

// ── Issue #10: a cost-capped run on an UNPRICED model is rejected, not silently allowed ──────────

test("maxCostUsd on an unpriced model is REJECTED up front (never runs uncapped)", async () => {
  const { manager, events } = collect();
  const runId = "run-unpriced-cost-cap";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));
  const model = mockAlwaysCallsTool(); // would loop forever spending unbounded if allowed to run

  const result = await runAgentLoop(
    runId,
    // A spend cap is set, but the model has NO known pricing → the cap could never fire.
    baseConfig({ model, tools, guardrails: { maxCostUsd: 1 }, modelId: "no-such-model-9000" }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "error", "the run is blocked, not run silently uncapped");
  assert.equal(result.outcome, "error");
  assert.match(
    result.stopReason ?? "",
    /no known pricing/,
    "the error explains why the run was refused",
  );
  assert.equal(
    result.turns,
    0,
    "the model was never invoked (rejected before any provider round-trip)",
  );

  const status = lastStatus(events);
  assert.equal(status?.status, "error");
  assert.equal(status?.outcome, "error");
});

test("maxCostUsd on a PRICED zero-price (local) model still runs — free is known, not unknown", async () => {
  // A local/free model is on the explicit zero-price allowlist → priced (cost 0), so a spend cap is
  // enforceable (it just never trips) and the run proceeds normally, stopping at the default step cap.
  const { manager, events } = collect();
  const runId = "run-local-cost-cap";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));
  const model = mockAlwaysCallsTool();

  const result = await runAgentLoop(
    runId,
    baseConfig({
      model,
      tools,
      guardrails: { maxCostUsd: 1 },
      modelId: "llama3.1",
      providerKind: "ollama",
    }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "stopped", "a priced local model runs (not rejected)");
  assert.match(
    result.stopReason ?? "",
    /maxTurns/,
    "it stops at the default step cap, not the spend cap",
  );
});

// ── Unified Sessions (WP1.3, D-US3): an interactive run whose wait budget expires instead of ─────
// ── holding sessions open forever (formerly the bespoke "idle timeout", issue #10) ───────────────

test("interactive run's SessionClock wait budget expires awaiting the next turn and finalizes as wait_expired", async () => {
  const { manager, events } = collect();
  const runId = "run-wait-expired";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const model = mockStopsImmediately();
  // The opener turn completes with finishReason "stop"; the loop then awaits the next user turn, which
  // NEVER arrives → the SessionClock's wait budget must fire so the run finalizes (and the caller
  // closes sessions). SessionClock's real timers are deliberately `unref()`'d (session-clock.ts — a
  // pending SessionClock timer must never by itself keep the Node process alive), so a bare
  // never-resolving promise here would leave NOTHING ref'd to keep the event loop alive long enough
  // for the 20ms wait timer to actually fire — a REF'd (default) long timer, well past the 20ms
  // budget, keeps the loop alive without ever winning the race itself.
  const interactive = {
    nextTurn: () => new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 500)),
  };

  const result = await runAgentLoop(
    runId,
    baseConfig({ model, tools: {}, interactive, sessionClockOptions: { waitBudgetMs: 20 } }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "stopped", "an expired wait interactive run is finalized, not left hanging");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /wait budget/i, "the wait-budget expiry names itself");

  const status = lastStatus(events);
  assert.equal(status?.status, "stopped");
  assert.equal(status?.stopReasonCode, "wait_expired", "the machine-readable cause is wait_expired");

  // The waiting_input phase fired before the wait budget expired.
  const waitingPhase = events.find(
    (e): e is Extract<RunEvent, { type: "phase" }> => e.type === "phase" && e.phase === "waiting_input",
  );
  assert.ok(waitingPhase, "a waiting_input phase event was emitted before the expiry");
  assert.equal(waitingPhase?.detail?.reason, "next_turn");
});

// ── Acceptance 3: no guardrails → the AI SDK default stepCountIs(20) still stops a forever loop ───

test("with NO budget guardrails, a forever-looping model still stops at stepCountIs(20)", async () => {
  const { manager, events } = collect();
  const runId = "run-default-cap";
  manager.create(runId);
  manager.subscribe(runId, (e) => events.push(e));

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const tools = buildTools(allowed, sessions, createDefaultStepSink(manager, runId));
  const model = mockAlwaysCallsTool(); // never finishes on its own

  // No guardrails set → maxTurns defaults to 20 (the AI SDK default stepCountIs(20)).
  const result = await runAgentLoop(
    runId,
    baseConfig({ model, tools, maxTurns: 20, guardrails: {} }),
    (e) => manager.emit(runId, e),
  );

  assert.equal(result.status, "stopped", "the forever loop is stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /maxTurns \(20\)/, "stopped by the default step cap of 20");
  assert.equal(result.turns, 20, "exactly 20 steps ran before the default cap");
});
