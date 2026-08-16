import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { AnswersStepPayload, RunEvent, RunStep } from "@mcp-token-footprint/shared";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import {
  runQlikAnswers,
  type QlikAnswersRunConfig,
} from "../src/testing/qlik-answers-executor.js";

// Qlik Answers (WP 1.5) — the executor's 429/`AE-6` rate-limit retry (research doc §3.4: Qlik
// invoke/stream is Tier 2, 100 req/min/tenant). Phase 4: the prompt call is the cloud-assistants
// `actions/stream` POST (the retry target here). NO REAL TENANT is ever contacted: every tenant call
// goes through an injected `fetchImpl` stub, and every backoff wait goes through an injected `retrySleep`
// so these tests never actually sleep for real seconds.

type Call = { url: string; hasSignal: boolean; signalAborted: boolean };

const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What were Q3 revenues by region?";
const MESSAGE_ID = "msg-0";
const ANSWER = "The answer.";

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** The success SSE stream: one frame settling the answer's messageId. */
function successStream(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"messageId":"${MESSAGE_ID}"}\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", etag: "v1" } });
}

/** The answer message the messages GET returns after a successful prompt. */
function answerCard(): unknown {
  return {
    id: MESSAGE_ID,
    content: [{ card: { body: [{ type: "TextBlock", text: "Conclusion" }, { type: "TextBlock", text: ANSWER }] } }],
  };
}

/**
 * A stub fetch for the cloud-assistants wire. Resolution / thread / messages always succeed; `onStream`
 * is called once per PROMPT attempt (so a test can rate-limit the first K attempts before succeeding).
 * Rejects immediately if called with an already-aborted signal (mirrors the abort stubs elsewhere).
 */
function stubFetch(opts: {
  calls: Call[];
  onStream?: (attempt: number, init: RequestInit | undefined) => Response | Promise<Response>;
}): typeof fetch {
  let streamAttempt = 0;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    opts.calls.push({ url, hasSignal: signal != null, signalAborted: signal?.aborted ?? false });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (url.endsWith("/messages")) return jsonResponse({ data: [answerCard()] });
    if (url.endsWith("/actions/stream")) {
      if (!opts.onStream) throw new Error("unexpected /actions/stream call in stub");
      return opts.onStream(streamAttempt++, init);
    }
    if (url.endsWith("/cloud-assistants/threads")) return jsonResponse({ id: "thread-1" });
    if (url.includes("/api/v1/assistants/"))
      return jsonResponse({ id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] });
    throw new Error(`unexpected URL in stub: ${url}`);
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
    transport: "stream",
    // Instant, real-time-free backoff by default — individual tests override to exercise the deadline race.
    retrySleep: () => Promise.resolve(),
    retryRandom: () => 0,
    ...over,
  };
}

function collect(): { events: RunEvent[]; emit: (e: RunEvent) => void } {
  const events: RunEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

const stepByType = (events: RunEvent[], type: RunStep["type"]): RunStep | undefined =>
  events
    .filter((e): e is Extract<RunEvent, { type: "step" }> => e.type === "step")
    .map((e) => e.step)
    .find((s) => s.type === type);

const streamCallCount = (calls: Call[]): number =>
  calls.filter((c) => c.url.endsWith("/actions/stream")).length;

beforeEach(() => _clearQlikAnswersAppContextCache());

// ── (1) HTTP 429 for the first K attempts, then succeeds — retries, completes, 1 question ──────────

test("HTTP 429 for the first 2 prompt attempts then succeeds — retries with backoff and completes", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: (attempt) =>
      attempt < 2
        ? jsonResponse({ errors: [{ code: "AE-6", title: "Rate limited" }] }, { status: 429 })
        : successStream(),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-1", baseConfig({ fetchImpl }), emit);

  assert.equal(streamCallCount(calls), 3, "2 failed 429 attempts + 1 successful attempt = 3 total");
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  assert.equal(events.some((e) => e.type === "error"), false);

  const answerStep = stepByType(events, "llm_response");
  assert.equal(answerStep?.assistantText, ANSWER);
  // Only 1 question consumed — the failed 429 attempts are never counted (D-QA5).
  assert.equal((answerStep?.payload as AnswersStepPayload).questionsConsumed, 1);
});

// ── (2) a non-429 status carrying the AE-6 BODY code is ALSO treated as rate-limited ─────────────

test("a 400 response carrying the AE-6 body code (not HTTP 429) is also retried", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: (attempt) =>
      attempt < 1
        ? jsonResponse({ errors: [{ code: "AE-6", title: "Rate limited" }] }, { status: 400 })
        : successStream(),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-2", baseConfig({ fetchImpl }), emit);

  assert.equal(streamCallCount(calls), 2, "1 failed AE-6-at-400 attempt + 1 successful attempt");
  assert.equal(result.status, "completed");
  assert.equal(stepByType(events, "llm_response")?.assistantText, ANSWER);
});

// ── (3) Only 429/AE-6 is retried — AE-4 (prompt rejected) is a SINGLE attempt, never retried ─────

test("AE-4 (prompt rejected) is NEVER retried — a single attempt, terminal stopped_guardrail", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      jsonResponse({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }, { status: 400 }),
  });
  const { emit } = collect();

  const result = await runQlikAnswers("run-4", baseConfig({ fetchImpl }), emit);

  assert.equal(streamCallCount(calls), 1, "AE-4 is terminal on the FIRST attempt — never retried");
  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
});

// ── (4) Retries are exhausted after RATE_LIMIT_MAX_ATTEMPTS — a persistent 429 becomes a terminal error

test("a PERSISTENT 429 (never recovers) exhausts retries and settles as a terminal error, not a loop", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () => jsonResponse({ errors: [{ code: "AE-6" }] }, { status: 429 }),
  });
  const { emit } = collect();

  const result = await runQlikAnswers("run-5", baseConfig({ fetchImpl }), emit);

  const streams = streamCallCount(calls);
  assert.ok(streams >= 2 && streams <= 8, `bounded attempts: ${streams}`);
  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.ok(result.stopReason?.includes("AE-6"), `AE-6 surfaced: ${result.stopReason}`);
});

// ── (5) A 429 that persists PAST the run's deadline settles a guardrail STOP — never sleeps past it ──
//
// Unified Sessions (WP1.5) — the wall-cap trip is now `stopped`/`stopped_guardrail`/`max_duration`
// (via the shared `terminalFor` table), NEVER `aborted` (that terminal is reserved for an actual user
// stop — the deadline→aborted bug this WP fixes).

test("a persistent 429 past maxRunDurationMs settles a guardrail stop (no infinite retry past the deadline)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () => jsonResponse({ errors: [{ code: "AE-6" }] }, { status: 429 }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers(
    "run-6",
    baseConfig({
      fetchImpl,
      maxRunDurationMs: 20,
      retrySleep: undefined, // use the real default sleep — it must itself respect the abort signal
      retryRandom: undefined,
    }),
    emit,
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.ok(result.stopReason?.includes("maxRunDurationMs"));
  assert.equal(events.some((e) => e.type === "error"), false);
  assert.ok(streamCallCount(calls) >= 1, "at least the first attempt ran before the deadline hit");
});

// ── (6) A `Retry-After` header is honored (not just the plain exponential backoff) ────────────────

test("a `Retry-After` header drives the backoff wait handed to the injected sleep", async () => {
  const calls: Call[] = [];
  const seenWaits: number[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: (attempt) =>
      attempt < 1
        ? jsonResponse(
            { errors: [{ code: "AE-6" }] },
            { status: 429, headers: { "retry-after": "1" } }, // 1 second
          )
        : successStream(),
  });
  const { emit } = collect();

  const result = await runQlikAnswers(
    "run-7",
    baseConfig({
      fetchImpl,
      retrySleep: (ms) => {
        seenWaits.push(ms);
        return Promise.resolve();
      },
    }),
    emit,
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(seenWaits, [1000], "the Retry-After: 1 (second) header drove exactly a 1000ms wait");
});
