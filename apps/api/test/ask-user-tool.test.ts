import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { ToolExecutionOptions } from "ai";
import {
  ASK_USER_MCP_KEY,
  ASK_USER_TOOL,
  type AskUserBridge,
  askUserToolPattern,
  buildAskUserAiTool,
  buildAskUserSdkServer,
} from "../src/testing/ask-user-tool.js";
import { runAgentLoop, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";

// ── Test doubles ───────────────────────────────────────────────────────────────────────────────

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;
const streamOf = (chunks: LanguageModelV3StreamPart[]) => ({ stream: simulateReadableStream({ chunks }) });

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
} as const;

/** A fake bridge that records emitted events and resolves `waitForAnswer` with a fixed answer. */
function fakeBridge(answer: string | null): { events: RunEvent[]; bridge: AskUserBridge } {
  const events: RunEvent[] = [];
  let counter = 0;
  return {
    events,
    bridge: {
      emit: (event) => events.push(event),
      newQuestionId: () => `q${counter++}`,
      waitForAnswer: async () => answer,
    },
  };
}

/** Invoke the AI-SDK tool's `execute` (its options arg is ignored by the tool). */
function callExecute(bridge: AskUserBridge, args: unknown): Promise<unknown> {
  const execute = buildAskUserAiTool(bridge)[ASK_USER_TOOL]?.execute;
  assert.ok(execute, "ask_user tool exposes an execute");
  return execute(args, {} as unknown as ToolExecutionOptions<unknown>);
}

function asQuestion(event: RunEvent): Extract<RunEvent, { type: "question" }> {
  assert.equal(event.type, "question");
  return event as Extract<RunEvent, { type: "question" }>;
}
function asResolved(event: RunEvent): Extract<RunEvent, { type: "question_resolved" }> {
  assert.equal(event.type, "question_resolved");
  return event as Extract<RunEvent, { type: "question_resolved" }>;
}

// ── The tool contract ────────────────────────────────────────────────────────────────────────

test("ask_user emits a question, returns the answer, and emits its resolution", async () => {
  const { events, bridge } = fakeBridge("Option A");
  const result = await callExecute(bridge, {
    question: "Pick one",
    options: [{ label: "Option A" }, { label: "Option B", description: "the second" }],
  });

  // The answer is handed back to the model verbatim.
  assert.deepEqual(result, { content: [{ type: "text", text: "Option A" }] });

  // Exactly two events, in order: the ask, then its resolution.
  assert.equal(events.length, 2);
  const q = asQuestion(events[0]!);
  assert.equal(q.prompt, "Pick one");
  assert.equal(q.questionId, "q0");
  assert.equal(q.allowOther, true);
  assert.deepEqual(q.options, [{ label: "Option A" }, { label: "Option B", description: "the second" }]);

  const resolved = asResolved(events[1]!);
  assert.equal(resolved.questionId, "q0");
  assert.equal(resolved.answer, "Option A");
});

test("ask_user returns an error result (never an answer) when the run is stopped first", async () => {
  const { events, bridge } = fakeBridge(null);
  const result = (await callExecute(bridge, { question: "Anything?" })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };

  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /stopped the run/i);
  assert.equal(asResolved(events[1]!).answer, null);
});

test("ask_user drops blank options and honors allowOther:false", async () => {
  const { events, bridge } = fakeBridge("x");
  await callExecute(bridge, {
    question: "Q",
    options: [{ label: "" }, { label: "keep", description: "kept" }, { label: "  " }],
    allowOther: false,
  });
  const q = asQuestion(events[0]!);
  assert.deepEqual(q.options, [{ label: "keep", description: "kept" }]);
  assert.equal(q.allowOther, false);
});

test("ask_user omits options entirely when none survive normalization", async () => {
  const { events, bridge } = fakeBridge("x");
  await callExecute(bridge, { question: "Q", options: [{ label: "" }] });
  const q = asQuestion(events[0]!);
  assert.equal(q.options, undefined, "an all-blank options list is dropped, not sent as []");
});

test("the ask tool key, name and allow-list pattern are stable", () => {
  assert.equal(ASK_USER_MCP_KEY, "ask");
  assert.equal(ASK_USER_TOOL, "ask_user");
  assert.equal(askUserToolPattern(), "mcp__ask__ask_user");
});

test("the subscription-path in-process server builds without touching the network", () => {
  const { bridge } = fakeBridge("x");
  // createSdkMcpServer is in-process (no child/network) — building it must not throw.
  assert.ok(buildAskUserSdkServer(bridge));
});

// ── Real-engine integration: pause on the ask, resume when the operator answers ─────────────────

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Ask the operator, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k"],
    ...over,
  };
}

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("the real engine invokes ask_user, PAUSES the run, and feeds the answer back to the model", async () => {
  const runId = "run-ask";
  const manager = new RunManager();
  manager.create(runId);
  const events: RunEvent[] = [];
  const unsub = manager.subscribe(runId, (event) => events.push(event));

  // A bridge whose answer is delivered LATER (mid-run) — mirroring the operator's POST /answers while
  // the tool's execute is blocked. `waitForAnswer` parks the resolver; the test resolves it once the
  // `question` event proves the run has actually paused on the ask.
  let resolveAnswer: ((answer: string | null) => void) | undefined;
  const bridge: AskUserBridge = {
    emit: (event) => manager.emit(runId, event),
    newQuestionId: () => "q1",
    waitForAnswer: () => new Promise((resolve) => (resolveAnswer = resolve)),
  };

  // Capture each provider request so we can prove turn 2 saw the answer as the tool result.
  const prompts: unknown[] = [];
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: ASK_USER_TOOL,
            input: JSON.stringify({
              question: "Which environment?",
              options: [{ label: "staging" }, { label: "prod" }],
            }),
          },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Using staging." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });

  const tools = buildAskUserAiTool(bridge);
  const loop = runAgentLoop(runId, baseConfig({ model, tools }), (event) => manager.emit(runId, event));

  // The run must pause on the ask BEFORE the model is called a second time.
  await waitUntil(() => resolveAnswer !== undefined);
  assert.equal(call, 1, "the model is NOT called for turn 2 while the ask is unanswered (run is paused)");
  assert.ok(
    events.some((e) => e.type === "question"),
    "a question event is emitted while paused",
  );

  // The operator answers → the tool unblocks and the run resumes.
  resolveAnswer!("staging");
  const result = await loop;
  unsub();

  assert.equal(result.status, "completed");
  assert.equal(call, 2, "the model runs a second turn once answered");

  const q = asQuestion(events.find((e) => e.type === "question")!);
  assert.deepEqual(q.options, [{ label: "staging" }, { label: "prod" }]);
  assert.equal(asResolved(events.find((e) => e.type === "question_resolved")!).answer, "staging");

  // The answer reached the model as the tool result on turn 2 (the proof the loop resumed with it).
  assert.match(JSON.stringify(prompts[1]), /staging/);
});
