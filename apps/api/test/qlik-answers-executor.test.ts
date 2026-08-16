import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type {
  AnswersStepPayload,
  RunDetail,
  RunEvent,
  RunStep,
  Test,
} from "@mcp-token-footprint/shared";
import { finalAssistantText, type GradeContext } from "../src/grading/grader.js";
import { ToolHygieneGrader } from "../src/grading/tool-hygiene.js";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import {
  PER_REQUEST_PRICING,
  estimateRequestCost,
  perRequestPrice,
} from "../src/providers/pricing.js";
import type { ScanRepository } from "../src/scans/repository.js";
import { runQlikAnswers, type QlikAnswersRunConfig } from "../src/testing/qlik-answers-executor.js";

// ── Test doubles (Phase 4 cloud-assistants wire) ─────────────────────────────────────────────────
//
// NO REAL TENANT is ever contacted: every tenant call goes through an injected `fetchImpl` stub whose
// fixtures are shaped per the customer `call_answers.py` reality:
//   - resolution:  GET  /api/v1/assistants/{id}                         → { …, appIds:["<app-guid>"] }
//   - thread:      POST /api/v1/cloud-assistants/threads                → { id }
//   - prompt:      POST /api/v1/cloud-assistants/{tid}/actions/stream   → SSE frames (messageId + deltas)
//   - answer:      GET  /api/v1/cloud-assistants/threads/{tid}/messages → { data:[ Adaptive-Card msg ] }

type Call = { url: string; method: string; body: unknown; hasSignal: boolean };

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What was the average NYC taxi fare?";
const ETAG = "assistant-version-42";
const MESSAGE_ID = "msg-1";
const ANSWER = "The average NYC taxi fare was $18.50.";
const EXPRESSIONS = ["Avg([fare_amount])"];
const SNAPSHOTS = [
  {
    title: "Avg fare",
    reason: "Shows the fare distribution.",
    measures: [{ expression: "Avg([fare_amount])", label: "Avg fare" }],
  },
];

/** A cloud-assistants answer message (Adaptive Card): reasoning → Conclusion → answer + snapshot + hypercube. */
function answerMessage(text = ANSWER): unknown {
  return {
    id: MESSAGE_ID,
    type: "ai",
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Reasoning: aggregated fares." },
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: text },
            {
              type: "Qlik.Snapshot",
              snapshot: {},
              source: {
                measures: [{ expression: "Avg([fare_amount])", label: "Avg fare" }],
                reason: "Shows the fare distribution.",
              },
            },
          ],
        },
      },
    ],
    analysis: { qHyperCubeDef: { qMeasures: [{ qDef: { qDef: EXPRESSIONS[0] } }] } },
  };
}

/** Build a streamed SSE `Response` from raw frames (already newline-terminated), split across chunks. */
function sseResponse(
  frames: string[],
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { "content-type": "text/event-stream", ...(init?.headers ?? {}) },
  });
}

/** The default SSE stream: two answer deltas then the settling messageId frame. */
function defaultStream(): Response {
  return sseResponse(
    [
      'data: {"output":"The average NYC taxi "}\n',
      'data: {"output":"fare was $18.50."}\n',
      `data: {"messageId":"${MESSAGE_ID}"}\n`,
    ],
    { headers: { etag: ETAG } },
  );
}

/**
 * A stub fetch dispatching the cloud-assistants wire and recording calls. Every stage has a sensible
 * default (resolution → app id, thread → thread-1, stream → default frames, messages → the answer card);
 * a test overrides only the stage it exercises.
 */
function stubFetch(opts: {
  calls: Call[];
  detail?: unknown;
  thread?: () => Response;
  onStream?: (init: RequestInit | undefined) => Response | Promise<Response>;
  messages?: () => Response;
}): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    opts.calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      hasSignal: init?.signal != null,
    });
    if (url.endsWith("/messages"))
      return (opts.messages ?? (() => jsonResponse({ data: [answerMessage()] })))();
    if (url.endsWith("/actions/stream")) return (opts.onStream ?? (() => defaultStream()))(init);
    if (url.endsWith("/cloud-assistants/threads"))
      return (opts.thread ?? (() => jsonResponse({ id: "thread-1" })))();
    if (url.includes("/api/v1/assistants/"))
      return jsonResponse(opts.detail ?? { id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] });
    // cloud-assistants detail / KB fallbacks 404 — resolution used the assistant detail above.
    return new Response("not found", { status: 404 });
  };
  return impl as typeof fetch;
}

function baseConfig(
  over: Partial<QlikAnswersRunConfig> & Pick<QlikAnswersRunConfig, "fetchImpl">,
): QlikAnswersRunConfig {
  return {
    assistantId: ASSISTANT_ID,
    prompt: PROMPT,
    auth: { apiKey: "secret-key", baseUrl: BASE_URL },
    profiles: ["generic_o200k"],
    transport: "invoke",
    ...over,
  };
}

function collect(): { events: RunEvent[]; emit: (e: RunEvent) => void } {
  const events: RunEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

const stepsOf = (events: RunEvent[]): RunStep[] =>
  events
    .filter((e): e is Extract<RunEvent, { type: "step" }> => e.type === "step")
    .map((e) => e.step);
const kpiOf = (events: RunEvent[]) =>
  events.find((e): e is Extract<RunEvent, { type: "kpi" }> => e.type === "kpi");
const stepByType = (events: RunEvent[], type: RunStep["type"]): RunStep | undefined =>
  stepsOf(events).find((s) => s.type === type);
const eventTypes = (events: RunEvent[]): string[] =>
  events.map((e) => (e.type === "status" ? `status:${e.status}` : e.type));
const deltasOf = (events: RunEvent[]): Extract<RunEvent, { type: "delta" }>[] =>
  events.filter((e): e is Extract<RunEvent, { type: "delta" }> => e.type === "delta");
const terminalStopReasonCode = (events: RunEvent[]): string | undefined =>
  [...events]
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status")?.stopReasonCode;

// Resolution is cached per (baseUrl, assistantId) — clear it so each case exercises a fresh resolve.
beforeEach(() => _clearQlikAnswersAppContextCache());

// ── Acceptance 1: a normal answer → running · user_message · llm_response · kpi · completed ──────

test("a normal answer emits the full RunEvent vocabulary + a gradeable llm_response step (answer from the message card)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-1", baseConfig({ fetchImpl }), emit);

  // invoke transport → no live deltas, but the SAME settled vocabulary.
  assert.deepEqual(eventTypes(events), [
    "status:running",
    "step", // user_message
    "step", // llm_response
    "kpi",
    "status:completed",
  ]);

  // Resolution hit the assistant detail; thread create bound the resolved app as its context.
  assert.ok(
    calls.some((c) => c.url.endsWith(`/api/v1/assistants/${ASSISTANT_ID}`)),
    "resolved the assistant → app id",
  );
  const threadCall = calls.find((c) => c.url.endsWith("/cloud-assistants/threads"));
  assert.ok(threadCall, "thread create was called");
  assert.equal(threadCall?.method, "POST");
  assert.deepEqual(threadCall?.body, {
    name: "mcpfp run run-1",
    context: { type: "app", id: APP_ID, data: { mode: "live" } },
  });
  assert.equal(threadCall?.hasSignal, true);

  // The prompt POST carries the app context + the question as content[{text}] (NO promptType).
  const streamCall = calls.find((c) => c.url.endsWith("/actions/stream"));
  assert.ok(streamCall, "prompt streamed");
  assert.deepEqual(streamCall?.body, {
    context: { type: "app", id: APP_ID, data: { mode: "live" } },
    content: [{ text: PROMPT }],
  });
  assert.ok(streamCall?.url.includes("/cloud-assistants/thread-1/actions/stream"));

  // The answer was fetched from the messages endpoint of the SAME thread.
  assert.ok(calls.some((c) => c.url.endsWith("/cloud-assistants/threads/thread-1/messages")));

  const userStep = stepByType(events, "user_message");
  assert.equal((userStep?.payload as { text: string }).text, PROMPT);

  // The single llm_response step: assistantText = the CARD answer (graders read exactly this).
  const answerStep = stepByType(events, "llm_response");
  assert.ok(answerStep);
  assert.equal(answerStep?.assistantText, ANSWER);
  const payload = answerStep?.payload as AnswersStepPayload;
  assert.deepEqual(payload.sources, []); // app assistant — no document citations
  assert.deepEqual(payload.expressions, EXPRESSIONS);
  assert.deepEqual(payload.snapshots, SNAPSHOTS); // the Qlik.Snapshot insights (title/reason/measures)
  assert.equal(payload.reasoning, "Reasoning: aggregated fares.");
  assert.equal(payload.appId, APP_ID);
  assert.equal(payload.messageId, MESSAGE_ID);
  assert.equal(payload.assistantVersion, ETAG);
  assert.equal(payload.threadId, "thread-1");
  assert.equal(payload.promptMode, "oneshot");
  assert.equal(payload.estimatedTokens, true);
  assert.equal(payload.questionsConsumed, 1);
  assert.equal(payload.rejected, undefined);
  assert.ok(payload.rawResponse, "the full official message is captured");

  const kpi = kpiOf(events);
  assert.equal(kpi?.turns, 1);
  assert.equal(kpi?.toolCalls, 0);
  assert.ok((kpi?.tokensIn ?? 0) > 0);
  assert.ok((kpi?.tokensOut ?? 0) > 0);
  assert.equal(kpi?.contextTokens, 0);
  assert.equal(kpi?.costUsd, 0);

  assert.deepEqual(result, {
    status: "completed",
    outcome: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: kpi?.tokensIn,
    tokensOut: kpi?.tokensOut,
  });
});

// ── Acceptance 2: tool-hygiene is `unevaluable` (never 0) + graders read the right text ──────────

test("a completed run has NO tool_call steps → tool_hygiene is unevaluable; finalAssistantText is the answer", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls });
  const { events, emit } = collect();
  await runQlikAnswers("run-2", baseConfig({ fetchImpl }), emit);

  const steps = stepsOf(events);
  assert.equal(steps.filter((s) => s.type === "tool_call").length, 0, "no tool_call steps");
  assert.equal(steps.filter((s) => s.type === "tool_result").length, 0, "no tool_result steps");

  const run = { id: "run-2", steps, events: [], skills: [] } as unknown as RunDetail;
  assert.equal(finalAssistantText(run), ANSWER);

  const scansStub = { getLatestForServer: () => null } as unknown as ScanRepository;
  const ctx: GradeContext = { run, test: {} as Test, finalAssistantText: finalAssistantText(run) };
  const verdict = new ToolHygieneGrader(scansStub).grade(ctx);
  assert.equal(verdict.status, "unevaluable");
  assert.equal(verdict.score, null);
});

// ── Acceptance 3: AE-4 (prompt rejected on the stream POST) → distinct terminal ──────────────────

test("AE-4 → status stopped · outcome stopped_guardrail · stopReason prompt_rejected · rejected payload", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      jsonResponse({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }, { status: 400 }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-3", baseConfig({ fetchImpl }), emit);

  assert.deepEqual(eventTypes(events), [
    "status:running",
    "step", // user_message
    "step", // llm_response (rejected — carries the payload signal, no answer text)
    "kpi",
    "phase", // stopping (Unified Sessions WP1.5 — stop-verdict-before-signal ordering)
    "status:stopped",
  ]);
  assert.equal(events.some((e) => e.type === "error"), false);

  const answerStep = stepByType(events, "llm_response");
  const payload = answerStep?.payload as AnswersStepPayload;
  assert.equal(answerStep?.assistantText, "", "no answer text on a rejected prompt");
  assert.equal(payload.rejected, true);
  assert.equal(payload.appId, APP_ID);
  assert.equal(payload.promptMode, "oneshot");
  assert.equal(payload.questionsConsumed, 1);
  assert.equal(payload.threadId, "thread-1");

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReason, "prompt_rejected");
  assert.equal(result.tokensOut, 0);
  // Unified Sessions (WP1.5) — the machine-readable stopReasonCode rides alongside the human text,
  // via the shared `terminalFor("prompt_rejected")` table.
  assert.equal(terminalStopReasonCode(events), "prompt_rejected");
});

// ── Acceptance 4: a non-AE-4 AE-x → outcome error, with the AE code in errorMessage ─────────────

test("AE-3 (auth) on the stream POST → outcome error with the AE code in the message; no llm_response step", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      jsonResponse({ errors: [{ code: "AE-3", title: "Not authorized" }] }, { status: 403 }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-4", baseConfig({ fetchImpl }), emit);

  assert.deepEqual(eventTypes(events), [
    "status:running",
    "step", // user_message
    "error",
    "kpi",
    "phase", // stopping (Unified Sessions WP1.5 — stop-verdict-before-signal ordering)
    "status:error",
  ]);
  assert.equal(stepByType(events, "llm_response"), undefined, "no answer step on a hard error");
  const errorEvent = events.find(
    (e): e is Extract<RunEvent, { type: "error" }> => e.type === "error",
  );
  assert.ok(errorEvent?.message.includes("AE-3"));
  assert.equal(result.outcome, "error");
  assert.ok(result.stopReason?.includes("AE-3"));
  // Unified Sessions (WP1.5) — "keep the existing AE-x -> outcome intent for the others": outcome
  // stays `error`, now carrying the machine-readable `provider_error` stopReasonCode.
  assert.equal(terminalStopReasonCode(events), "provider_error");
});

test("thread-create failure → outcome error (prompt never runs)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    thread: () =>
      jsonResponse({ errors: [{ code: "AE-3", title: "Not authorized" }] }, { status: 403 }),
    onStream: () => {
      throw new Error("stream should not be reached when thread create fails");
    },
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-5", baseConfig({ fetchImpl }), emit);

  assert.equal(result.outcome, "error");
  assert.ok(result.stopReason?.includes("AE-3"));
  assert.equal(calls.some((c) => c.url.endsWith("/actions/stream")), false, "stream never called");
  assert.equal(stepByType(events, "llm_response"), undefined);
});

test("app-context resolution failure → outcome error (the owner-locked STOP case); no thread/prompt", async () => {
  const calls: Call[] = [];
  // The assistant detail resolves no app id, and every fallback endpoint 404s.
  const fetchImpl = stubFetch({ calls, detail: { id: ASSISTANT_ID, knowledgeBases: [] } });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-5b", baseConfig({ fetchImpl }), emit);

  assert.equal(result.outcome, "error");
  assert.match(result.stopReason ?? "", /Could not resolve the Qlik Sense app/);
  assert.equal(calls.some((c) => c.url.endsWith("/cloud-assistants/threads")), false);
  assert.equal(stepByType(events, "llm_response"), undefined);
});

// ── Acceptance 5: the run duration cap (Unified Sessions WP1.5 — the deadline→aborted bug fix) ───
//
// Before WP1.5, a wall-clock trip and a genuine user stop both collapsed into the SAME `outcome:
// "aborted"` ("Stopped by you" in the console — wrong for a run that timed out on its own). The wall
// cap now routes through the shared `terminalFor("max_duration")` table like every other backend's
// guardrail stop: `status: "stopped"` / `outcome: "stopped_guardrail"` / `stopReasonCode:
// "max_duration"`. `aborted` is now reserved for an ACTUAL user stop (see the next test).

test("exceeding maxRunDurationMs → status stopped · outcome stopped_guardrail (NOT aborted)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: (init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-6", baseConfig({ fetchImpl, maxRunDurationMs: 15 }), emit);

  assert.deepEqual(eventTypes(events), [
    "status:running",
    "step", // user_message
    "kpi",
    "phase", // stopping (Unified Sessions WP1.5 — stop-verdict-before-signal ordering)
    "status:stopped",
  ]);
  assert.equal(result.status, "stopped", "the deadline fix: NEVER aborted for a wall-cap trip");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.ok(result.stopReason?.includes("maxRunDurationMs"));
  assert.equal(terminalStopReasonCode(events), "max_duration");
});

test("a user abort signal → status aborted (distinct stopReason)", async () => {
  const calls: Call[] = [];
  const controller = new AbortController();
  const fetchImpl = stubFetch({
    calls,
    onStream: (init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        controller.abort();
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers(
    "run-7",
    baseConfig({ fetchImpl, abortSignal: controller.signal, maxRunDurationMs: 60_000 }),
    emit,
  );

  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.stopReason, "Run aborted by user");
  // Unified Sessions (WP1.5) — a REAL user stop stays `user_stop`, distinct from a wall-cap trip even
  // though both share the same internal abort mechanism (this is the precedence the deadline fix relies
  // on: `cfg.abortSignal.aborted` is checked before the SessionClock's own `fired` cause).
  assert.equal(terminalStopReasonCode(events), "user_stop");
});

// ── Cost: questions × the OPTIONAL per-request price (D-QA5) ─────────────────────────────────────

test("per-request pricing: default unpriced → cost 0; a configured €/question surfaces in costUsd", async () => {
  assert.equal(perRequestPrice("anything"), undefined);
  assert.equal(estimateRequestCost("anything", 5), 0);
  assert.equal(estimateRequestCost("anything", -3), 0);

  const pricedId = "priced-assistant-xyz";
  PER_REQUEST_PRICING[pricedId] = { perRequestUsd: 0.25 };
  try {
    assert.equal(estimateRequestCost(pricedId, 4), 1);
    const calls: Call[] = [];
    const fetchImpl = stubFetch({ calls });
    const { events, emit } = collect();
    await runQlikAnswers("run-8", baseConfig({ fetchImpl, assistantId: pricedId }), emit);
    assert.equal(kpiOf(events)?.costUsd, 0.25, "1 question × €0.25");
  } finally {
    delete PER_REQUEST_PRICING[pricedId];
  }
});

// ── Acceptance 6: the `stream` transport — live `delta` text + the SAME settled answer ────────────

test("stream: live text arrives as ordered `delta` events; the settled answer comes from the message card", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => defaultStream() });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-9", baseConfig({ fetchImpl, transport: "stream" }), emit);

  const deltas = deltasOf(events);
  assert.deepEqual(
    deltas.map((d) => d.text),
    ["The average NYC taxi ", "fare was $18.50."],
  );
  assert.ok(deltas.every((d) => d.channel === "text" && d.turnIndex === 0));

  assert.deepEqual(eventTypes(events), [
    "status:running",
    "step", // user_message
    "delta",
    "delta",
    "step", // llm_response
    "kpi",
    "status:completed",
  ]);

  const answerStep = stepByType(events, "llm_response");
  // The SETTLED answer is the card text from the messages fetch (authoritative), not the raw stream.
  assert.equal(answerStep?.assistantText, ANSWER);
  const payload = answerStep?.payload as AnswersStepPayload;
  assert.equal(payload.messageId, MESSAGE_ID);
  assert.equal(payload.assistantVersion, ETAG);
  assert.equal(result.status, "completed");
});

test("stream: a frame carrying only a messageId (no delta text) still settles the card answer, no deltas", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () => sseResponse([`data: {"messageId":"${MESSAGE_ID}"}\n`]),
  });
  const { events, emit } = collect();
  await runQlikAnswers("run-10", baseConfig({ fetchImpl, transport: "stream" }), emit);

  assert.equal(deltasOf(events).length, 0, "no delta frames → no delta events");
  assert.equal(stepByType(events, "llm_response")?.assistantText, ANSWER);
});

test("stream: a malformed/truncated tail after a valid frame settles gracefully (no run-crashing throw)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      sseResponse([`data: {"messageId":"${MESSAGE_ID}"}\n`, 'data: {"output":"truncated-mid-str']),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-11", baseConfig({ fetchImpl, transport: "stream" }), emit);

  assert.equal(result.status, "completed");
  assert.equal(stepByType(events, "llm_response")?.assistantText, ANSWER);
  assert.equal(events.some((e) => e.type === "error"), false);
});

test("the answer falls back to the streamed text when the message card has no extractable answer", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    // Card with no "Conclusion" and no ai-text fallback → extractor returns "" → use streamed text.
    messages: () => jsonResponse({ data: [{ id: MESSAGE_ID, content: [{ card: { body: [] } }] }] }),
    onStream: () =>
      sseResponse([
        'data: {"output":"Live answer only."}\n',
        `data: {"messageId":"${MESSAGE_ID}"}\n`,
      ]),
  });
  const { events, emit } = collect();
  await runQlikAnswers("run-12", baseConfig({ fetchImpl, transport: "stream" }), emit);

  assert.equal(stepByType(events, "llm_response")?.assistantText, "Live answer only.");
});

// ── Acceptance 7 (Phase 4c): the agent PROCESS streams as live `reasoning` deltas + persists ──────
//
// The cloud-assistants stream is JSON-Patch frames; the reasoning stepper (`/steps/…/toggleContent/…`)
// carries the live process (plan, tool/search findings, composition). It must surface as live
// `reasoning` deltas AND persist on the answer step (`reasoningText` + `payload.reasoning`) so replay
// shows it too — while the settled answer still comes from the messages card.

const reasoningDeltasOf = (events: RunEvent[]) =>
  events.filter(
    (e): e is Extract<RunEvent, { type: "delta"; channel: "reasoning" }> =>
      e.type === "delta" && e.channel === "reasoning",
  );

test("stream: reasoning-stepper frames surface as live `reasoning` deltas + persist on the answer step", async () => {
  const REASONING_PATH = "/content/0/card/body/0/steps/0/content/toggleContent/0/items/0/text";
  const frame = (params: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ method: "delta", params })}\n`;
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      sseResponse([
        frame({ path: REASONING_PATH, value: "<plan>1. Understanding" }),
        frame({ path: REASONING_PATH, value: " the question.</plan>" }),
        frame({ messageId: MESSAGE_ID }),
      ]),
  });
  const { events, emit } = collect();
  await runQlikAnswers("run-r", baseConfig({ fetchImpl, transport: "stream" }), emit);

  // Live: ordered `reasoning` deltas, with the <plan>/</plan> wrapper tags stripped.
  assert.deepEqual(
    reasoningDeltasOf(events).map((d) => d.text),
    ["1. Understanding", " the question."],
  );

  // Settled: the answer step persists the full reasoning (replay) + the clean answer (from messages).
  const step = stepByType(events, "llm_response");
  assert.equal(step?.reasoningText, "1. Understanding the question.");
  assert.equal(step?.assistantText, ANSWER);
  assert.equal((step?.payload as AnswersStepPayload).reasoning, "1. Understanding the question.");
});

test("invoke transport: reasoning is still persisted, but NOT streamed as live deltas", async () => {
  const REASONING_PATH = "/content/0/card/body/0/steps/0/content/toggleContent/0/items/0/text";
  const frame = (params: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ method: "delta", params })}\n`;
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      sseResponse([
        frame({ path: REASONING_PATH, value: "Discovering assets." }),
        frame({ messageId: MESSAGE_ID }),
      ]),
  });
  const { events, emit } = collect();
  await runQlikAnswers("run-ri", baseConfig({ fetchImpl, transport: "invoke" }), emit);

  assert.equal(reasoningDeltasOf(events).length, 0, "invoke suppresses live reasoning deltas");
  const step = stepByType(events, "llm_response");
  assert.equal(step?.reasoningText, "Discovering assets.", "but the reasoning is still captured");
});
