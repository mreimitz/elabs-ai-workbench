import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import { registerOpenAiFacade } from "../src/openai-facade/routes.js";
import type { OpenAiFacadeDeps } from "../src/openai-facade/types.js";
import { runQlikAnswers } from "../src/testing/qlik-answers-executor.js";
import type { RunEvent } from "@mcp-token-footprint/shared";

// ── Stub tenant wire (NO REAL TENANT — repo invariant) ───────────────────────────────────────────
//
// Mirrors the qlik-answers-executor test's cloud-assistants fixtures so the golden byte-identity
// test drives the executor and the facade over the SAME stub:
//   resolution → { appIds:[APP_ID] } · thread → { id } · actions/stream → SSE frames · messages → card

const FACADE_KEY = "mcpfp-test-key";
const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What was the average NYC taxi fare?";
const ETAG = "assistant-version-42";
const MESSAGE_ID = "msg-1";
const ANSWER = "The average NYC taxi fare was $18.50.";
const AUTH = { apiKey: "secret-key", baseUrl: BASE_URL };

type Call = { url: string; method: string; body: unknown };

/**
 * A permissive decoded-JSON view for the response bodies + SSE chunks the tests assert over (a
 * completion, a chunk, or an error envelope). Avoids `any`; the test dir is not tsc-checked, so the
 * loose field access reads at runtime exactly as decoded.
 */
type Body = {
  id?: string;
  object?: string;
  model?: string;
  created?: number;
  choices?: Array<{
    delta?: Record<string, string | undefined>;
    message?: Record<string, string | undefined>;
    finish_reason?: string | null;
  }>;
  usage?: Record<string, number>;
  citations?: unknown[];
  qlik_answers?: Record<string, unknown>;
  error?: { message: string; type: string; code: string | null; param: string | null };
  data?: Array<Record<string, unknown>>;
};

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** A cloud-assistants answer message: Reasoning → Conclusion → answer + a Qlik.Snapshot. */
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
    analysis: { qHyperCubeDef: { qMeasures: [{ qDef: { qDef: "Avg([fare_amount])" } }] } },
  };
}

function sseResponse(frames: string[], init?: { headers?: Record<string, string> }): Response {
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
    status: 200,
    headers: { "content-type": "text/event-stream", ...(init?.headers ?? {}) },
  });
}

const REASONING_PATH = "/content/0/card/body/0/steps/0/content/toggleContent/0/items/0/text";
function patchFrame(params: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ method: "delta", params })}\n`;
}

/** The default stream: one reasoning frame (JSON-Patch), one live answer `output`, the messageId. */
function defaultStream(): Response {
  return sseResponse(
    [
      patchFrame({ path: REASONING_PATH, value: "<plan>Discovering the relevant assets.</plan>" }),
      'data: {"output":"LIVE-held-back-answer-text"}\n',
      `data: {"messageId":"${MESSAGE_ID}"}\n`,
    ],
    { headers: { etag: ETAG } },
  );
}

function stubFetch(opts: {
  calls?: Call[];
  detail?: unknown;
  thread?: () => Response;
  onStream?: (init: RequestInit | undefined) => Response | Promise<Response>;
  messages?: () => Response;
}): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    opts.calls?.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/messages"))
      return (opts.messages ?? (() => jsonResponse({ data: [answerMessage()] })))();
    if (url.endsWith("/actions/stream")) return (opts.onStream ?? (() => defaultStream()))(init);
    if (url.endsWith("/cloud-assistants/threads"))
      return (opts.thread ?? (() => jsonResponse({ id: "thread-1" })))();
    if (url.includes("/api/v1/assistants/"))
      return jsonResponse(
        opts.detail ?? { id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] },
      );
    return new Response("not found", { status: 404 });
  };
  return impl as typeof fetch;
}

// ── App harness ──────────────────────────────────────────────────────────────────────────────────

const apps: FastifyInstance[] = [];
beforeEach(() => _clearQlikAnswersAppContextCache());
afterEach(async () => {
  while (apps.length > 0) {
    const app = apps.pop();
    if (app) await app.close().catch(() => {});
  }
});

function makeDeps(over: Partial<OpenAiFacadeDeps> = {}): OpenAiFacadeDeps {
  return {
    facadeKey: FACADE_KEY,
    resolveModel: (model) => (model === ASSISTANT_ID ? AUTH : undefined),
    listModels: async () => [{ id: ASSISTANT_ID, displayName: "Sales Assistant" }],
    fetchImpl: stubFetch({}),
    tokenProfile: "generic_o200k",
    now: () => 1_700_000_000_000,
    ...over,
  };
}

async function buildApp(deps: OpenAiFacadeDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerOpenAiFacade(app, deps);
  apps.push(app);
  return app;
}

async function listenApp(
  deps: OpenAiFacadeDeps,
): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = await buildApp(deps);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

const authHeader = { authorization: `Bearer ${FACADE_KEY}` };

function chatBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: ASSISTANT_ID, messages: [{ role: "user", content: PROMPT }], ...over };
}

/** Parse a raw SSE body into its decoded chunks + whether `[DONE]` terminated it. */
function parseSse(text: string): { chunks: Body[]; done: boolean } {
  const chunks: Body[] = [];
  let done = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    chunks.push(JSON.parse(payload));
  }
  return { chunks, done };
}

// ── Golden byte-identity: facade answer === executor extraction over the SAME stub ───────────────

async function executorAnswerText(fetchImpl: typeof fetch): Promise<string> {
  const events: RunEvent[] = [];
  await runQlikAnswers(
    "golden-run",
    {
      assistantId: ASSISTANT_ID,
      prompt: PROMPT,
      auth: AUTH,
      profiles: ["generic_o200k"],
      transport: "invoke",
      fetchImpl,
    },
    (e) => events.push(e),
  );
  const step = events.find(
    (e): e is Extract<RunEvent, { type: "step" }> =>
      e.type === "step" && e.step.type === "llm_response",
  );
  return step?.step.assistantText ?? "<no answer>";
}

async function facadeAnswerText(fetchImpl: typeof fetch): Promise<string> {
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 200, res.payload);
  const body = res.json() as { choices: Array<{ message: { content: string } }> };
  return body.choices[0]!.message.content;
}

const GOLDEN_FIXTURES: Array<{ name: string; build: () => typeof fetch }> = [
  {
    name: "standard single-paragraph card answer",
    build: () => stubFetch({}),
  },
  {
    name: "multi-paragraph answer with citation markers stripped",
    build: () =>
      stubFetch({
        messages: () =>
          jsonResponse({
            data: [
              {
                id: MESSAGE_ID,
                type: "ai",
                content: [
                  {
                    card: {
                      body: [
                        { type: "TextBlock", text: "Conclusion" },
                        {
                          type: "TextBlock",
                          text: 'Fares rose 12%.<citation data-index="0">src</citation>',
                        },
                        { type: "TextBlock", text: "Weekends were highest." },
                      ],
                    },
                  },
                ],
              },
            ],
          }),
      }),
  },
  {
    name: "empty card → falls back to the live streamed text (identical fallback)",
    build: () =>
      stubFetch({
        messages: () =>
          jsonResponse({ data: [{ id: MESSAGE_ID, content: [{ card: { body: [] } }] }] }),
        onStream: () =>
          sseResponse([
            'data: {"output":"Live answer only."}\n',
            `data: {"messageId":"${MESSAGE_ID}"}\n`,
          ]),
      }),
  },
];

for (const fixture of GOLDEN_FIXTURES) {
  test(`golden byte-identity: facade content === executor extraction — ${fixture.name}`, async () => {
    const fromExecutor = await executorAnswerText(fixture.build());
    _clearQlikAnswersAppContextCache();
    const fromFacade = await facadeAnswerText(fixture.build());
    assert.equal(
      fromFacade,
      fromExecutor,
      "facade answer text must be byte-identical to the executor's",
    );
    assert.ok(fromFacade.length > 0, "the fixture produced a non-empty answer");
  });
}

// ── Non-streaming completion shape + vendor fields ───────────────────────────────────────────────

test("non-streaming: a chat.completion with finish_reason stop, usage, and vendor fields", async () => {
  const app = await buildApp(makeDeps());
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Body;
  assert.equal(body.object, "chat.completion");
  assert.ok(String(body.id).startsWith("chatcmpl-"));
  assert.equal(body.model, ASSISTANT_ID);
  assert.equal(body.choices[0].message.role, "assistant");
  assert.equal(body.choices[0].message.content, ANSWER);
  assert.equal(body.choices[0].finish_reason, "stop");
  // Usage present + estimated-marked in the vendor field.
  assert.ok(body.usage.prompt_tokens > 0 && body.usage.completion_tokens > 0);
  assert.equal(body.usage.total_tokens, body.usage.prompt_tokens + body.usage.completion_tokens);
  assert.equal(body.qlik_answers.estimatedTokens, true);
  assert.equal(body.qlik_answers.threadId, "thread-1");
  assert.equal(body.qlik_answers.appId, APP_ID);
  assert.equal(body.qlik_answers.messageId, MESSAGE_ID);
  assert.equal(body.qlik_answers.assistantVersion, ETAG);
  assert.equal(body.qlik_answers.questionsConsumed, 1);
  assert.deepEqual(body.qlik_answers.expressions, ["Avg([fare_amount])"]);
  assert.ok(Array.isArray(body.qlik_answers.snapshots) && body.qlik_answers.snapshots.length === 1);
  assert.deepEqual(body.citations, []); // app assistant → no document citations
});

// ── Streaming (hold-back default) ────────────────────────────────────────────────────────────────

async function streamChat(
  baseUrl: string,
  over: Record<string, unknown> = {},
): Promise<{
  status: number;
  contentType: string | null;
  chunks: Body[];
  done: boolean;
}> {
  const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader },
    body: JSON.stringify(chatBody({ stream: true, ...over })),
  });
  const text = await res.text();
  const { chunks, done } = parseSse(text);
  return { status: res.status, contentType: res.headers.get("content-type"), chunks, done };
}

test("streaming: reasoning mirrored live, settled answer held back to ONE content delta, usage + [DONE]", async () => {
  const { baseUrl } = await listenApp(makeDeps());
  const { status, contentType, chunks, done } = await streamChat(baseUrl);

  assert.equal(status, 200);
  assert.match(contentType ?? "", /text\/event-stream/);
  assert.equal(done, true, "stream terminated with [DONE]");

  // First chunk announces the role.
  assert.equal(chunks[0]!.choices[0].delta.role, "assistant");

  // Reasoning arrives live via reasoning_content (mirrored to reasoning), <plan> tags stripped.
  const reasoning = chunks.filter((c) => c.choices?.[0]?.delta?.reasoning_content !== undefined);
  assert.ok(reasoning.length > 0, "at least one reasoning delta");
  const reasoningText = reasoning.map((c) => c.choices[0].delta.reasoning_content).join("");
  assert.equal(reasoningText, "Discovering the relevant assets.");
  assert.ok(
    reasoning.every((c) => c.choices[0].delta.reasoning === c.choices[0].delta.reasoning_content),
    "reasoning mirrors reasoning_content",
  );

  // Hold-back: exactly ONE content delta, equal to the settled card answer — the LIVE streamed
  // answer text is NEVER emitted as content.
  const contentDeltas = chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices[0].delta.content);
  assert.deepEqual(contentDeltas, [ANSWER]);
  assert.ok(
    !contentDeltas.some((t) => t.includes("LIVE-held-back")),
    "live text was held back, not streamed",
  );

  // Finish chunk carries finish_reason + vendor fields.
  const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === "stop");
  assert.ok(finish, "a stop finish chunk");
  assert.equal(finish!.qlik_answers.threadId, "thread-1");
  assert.deepEqual(finish!.citations, []);

  // A usage chunk is ALWAYS emitted (empty choices, populated usage, estimated marker).
  const usage = chunks.find((c) => c.usage !== undefined);
  assert.ok(usage, "usage chunk present");
  assert.deepEqual(usage!.choices, []);
  assert.ok(usage!.usage.prompt_tokens > 0 && usage!.usage.completion_tokens > 0);
  assert.equal(usage!.qlik_answers.estimatedTokens, true);
});

test("streaming: usage chunk emitted even without stream_options.include_usage", async () => {
  const { baseUrl } = await listenApp(makeDeps());
  const { chunks } = await streamChat(baseUrl); // no stream_options
  assert.ok(
    chunks.some((c) => c.usage !== undefined),
    "usage chunk is unconditional",
  );
});

// ── AE-4 → content_filter (NOT an HTTP error) ────────────────────────────────────────────────────

test("non-streaming: AE-4 → finish_reason content_filter, empty content, rejected vendor field (HTTP 200)", async () => {
  const fetchImpl = stubFetch({
    onStream: () =>
      jsonResponse({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }, { status: 400 }),
  });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 200, "AE-4 is a normal completion, never an HTTP error");
  const body = res.json() as Body;
  assert.equal(body.choices[0].finish_reason, "content_filter");
  assert.equal(body.choices[0].message.content, "");
  assert.equal(body.qlik_answers.rejected, true);
});

test("streaming: AE-4 → a content_filter finish chunk over SSE, no HTTP error", async () => {
  const fetchImpl = stubFetch({
    onStream: () =>
      jsonResponse({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }, { status: 400 }),
  });
  const { baseUrl } = await listenApp(makeDeps({ fetchImpl }));
  const { status, chunks, done } = await streamChat(baseUrl);
  assert.equal(status, 200);
  assert.equal(done, true);
  const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === "content_filter");
  assert.ok(finish, "content_filter finish chunk");
  assert.equal(finish!.qlik_answers.rejected, true);
  assert.ok(
    !chunks.some((c) => typeof c.choices?.[0]?.delta?.content === "string"),
    "no answer content on a rejection",
  );
});

// ── Error mapping: 429 + Retry-After, 404 model_not_found, 401 auth ──────────────────────────────

test("AE-6 / 429 on the stream POST → HTTP 429 + Retry-After + rate_limit envelope", async () => {
  const fetchImpl = stubFetch({
    onStream: () =>
      jsonResponse(
        { errors: [{ code: "AE-6" }] },
        { status: 429, headers: { "retry-after": "3" } },
      ),
  });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "3");
  const body = res.json() as { error: { type: string; code: string } };
  assert.equal(body.error.type, "rate_limit_error");
  assert.equal(body.error.code, "rate_limit_exceeded");
});

test("an unknown model (resolveModel → undefined) → 404 model_not_found", async () => {
  const app = await buildApp(makeDeps());
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody({ model: "no-such-assistant" }),
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as { error: { code: string; param: string } };
  assert.equal(body.error.code, "model_not_found");
  assert.equal(body.error.param, "model");
});

test("an unresolvable app context (no app bound) → 404 model_not_found", async () => {
  // Assistant detail carries no appIds and every fallback 404s → QlikAnswersAppResolutionError.
  const fetchImpl = stubFetch({ detail: { id: ASSISTANT_ID, knowledgeBases: [] } });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 404);
  assert.equal((res.json() as { error: { code: string } }).error.code, "model_not_found");
});

test("a missing/wrong facade key → 401 invalid_api_key on both endpoints", async () => {
  const app = await buildApp(makeDeps());
  for (const headers of [{}, { authorization: "Bearer wrong" }]) {
    const chat = await app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers,
      payload: chatBody(),
    });
    assert.equal(chat.statusCode, 401);
    assert.equal((chat.json() as { error: { code: string } }).error.code, "invalid_api_key");
    const models = await app.inject({ method: "GET", url: "/openai/v1/models", headers });
    assert.equal(models.statusCode, 401);
  }
});

test("a malformed request (no messages) → 400 with a param-scoped envelope", async () => {
  const app = await buildApp(makeDeps());
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: { model: ASSISTANT_ID },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: { type: string; param: string } };
  assert.equal(body.error.type, "invalid_request_error");
  assert.equal(body.error.param, "messages");
});

// ── GET /openai/v1/models ────────────────────────────────────────────────────────────────────────

test("GET /openai/v1/models lists the resolvable assistants as models (owned_by qlik)", async () => {
  const app = await buildApp(makeDeps());
  const res = await app.inject({ method: "GET", url: "/openai/v1/models", headers: authHeader });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { object: string; data: Array<Record<string, unknown>> };
  assert.equal(body.object, "list");
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0]!.id, ASSISTANT_ID);
  assert.equal(body.data[0]!.object, "model");
  assert.equal(body.data[0]!.owned_by, "qlik");
});

// ── Thread affinity: append reuses one thread; edited history forks ──────────────────────────────

test("thread affinity: a 3-turn append conversation reuses ONE thread; an edited history forks", async () => {
  const calls: Call[] = [];
  const app = await buildApp(makeDeps({ fetchImpl: stubFetch({ calls }) }));
  const threadCreates = () =>
    calls.filter((c) => c.method === "POST" && c.url.endsWith("/cloud-assistants/threads")).length;

  const post = async (messages: Array<{ role: string; content: string }>) => {
    const res = await app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: authHeader,
      payload: { model: ASSISTANT_ID, messages },
    });
    assert.equal(res.statusCode, 200, res.payload);
  };

  await post([{ role: "user", content: "q1" }]);
  assert.equal(threadCreates(), 1, "turn 1 creates a thread");

  await post([
    { role: "user", content: "q1" },
    { role: "assistant", content: ANSWER },
    { role: "user", content: "q2" },
  ]);
  assert.equal(threadCreates(), 1, "turn 2 (append) reuses the thread — no new create");

  await post([
    { role: "user", content: "q1" },
    { role: "assistant", content: ANSWER },
    { role: "user", content: "q2" },
    { role: "assistant", content: ANSWER },
    { role: "user", content: "q3" },
  ]);
  assert.equal(threadCreates(), 1, "turn 3 (append) still reuses the thread");

  // Edited history (first turn changed) → cache miss → a NEW thread (documented amnesia).
  await post([
    { role: "user", content: "EDITED" },
    { role: "assistant", content: ANSWER },
    { role: "user", content: "q2" },
  ]);
  assert.equal(threadCreates(), 2, "an edited history forks a new thread");
});

// ── The facade key is never forwarded to the tenant ──────────────────────────────────────────────

test("the facade key is never forwarded to the tenant (tenant sees only the Qlik credential)", async () => {
  const seenAuth: string[] = [];
  const inner = stubFetch({});
  const spy: typeof fetch = async (input, init) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (auth) seenAuth.push(auth);
    return inner(input, init);
  };
  const app = await buildApp(makeDeps({ fetchImpl: spy }));
  await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.ok(seenAuth.length > 0, "the tenant was called");
  assert.ok(
    seenAuth.every((a) => a === `Bearer ${AUTH.apiKey}`),
    "tenant only ever sees the Qlik credential",
  );
  assert.ok(!seenAuth.some((a) => a.includes(FACADE_KEY)), "the facade key is never forwarded");
});
