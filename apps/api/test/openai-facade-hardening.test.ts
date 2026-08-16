import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import { FacadeConcurrencyLimiter } from "../src/openai-facade/concurrency.js";
import {
  DEFAULT_FACADE_LIVE_STREAM,
  DEFAULT_FACADE_MAX_CONCURRENCY,
  LIVE_STREAM_ENV_VAR,
  MAX_CONCURRENCY_ENV_VAR,
  resolveLiveStream,
  resolveMaxConcurrency,
} from "../src/openai-facade/config.js";
import { registerOpenAiFacade } from "../src/openai-facade/routes.js";
import type { OpenAiFacadeDeps } from "../src/openai-facade/types.js";

// WP4.2 — facade-side concurrency cap + the live-stream config flag (research 04 §6, D-US12). Same
// stub-fetch-only invariant as openai-facade.test.ts — NO real tenant is ever contacted.

const FACADE_KEY = "mcpfp-test-key";
const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What was the average NYC taxi fare?";
const ETAG = "assistant-version-42";
const MESSAGE_ID = "msg-1";
const ANSWER = "The average NYC taxi fare was $18.50.";
const AUTH = { apiKey: "secret-key", baseUrl: BASE_URL };

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

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
            { type: "TextBlock", text },
          ],
        },
      },
    ],
    analysis: { qHyperCubeDef: { qMeasures: [] } },
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

function defaultStream(): Response {
  return sseResponse(['data: {"output":"live text"}\n', `data: {"messageId":"${MESSAGE_ID}"}\n`], {
    headers: { etag: ETAG },
  });
}

type Call = { url: string; method: string; body: unknown };

function stubFetch(opts: {
  calls?: Call[];
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
      return jsonResponse({ id: `thread-${Math.random().toString(36).slice(2, 8)}` });
    if (url.includes("/api/v1/assistants/"))
      return jsonResponse({ id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] });
    return new Response("not found", { status: 404 });
  };
  return impl as typeof fetch;
}

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

const authHeader = { authorization: `Bearer ${FACADE_KEY}` };

function chatBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: ASSISTANT_ID, messages: [{ role: "user", content: PROMPT }], ...over };
}

type Body = {
  choices?: Array<{
    delta?: Record<string, string | undefined>;
    message?: Record<string, string | undefined>;
    finish_reason?: string | null;
  }>;
  error?: { message: string; type: string; code: string | null; param: string | null };
};

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

// ── FacadeConcurrencyLimiter: the non-blocking reject-fast gate in isolation ─────────────────────

test("FacadeConcurrencyLimiter: admits up to `max` in flight, then rejects until a release", () => {
  const limiter = new FacadeConcurrencyLimiter(2, 3);
  assert.equal(limiter.current(), 0);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.current(), 2);
  // Over capacity: tryAcquire returns false WITHOUT blocking or incrementing.
  assert.equal(limiter.tryAcquire(), false);
  assert.equal(limiter.current(), 2);

  limiter.release();
  assert.equal(limiter.current(), 1);
  assert.equal(limiter.tryAcquire(), true, "a released slot is admitted again");
  assert.equal(limiter.current(), 2);
});

test("FacadeConcurrencyLimiter: rejection() maps to a 429 rate_limit_error with the configured Retry-After", () => {
  const limiter = new FacadeConcurrencyLimiter(1, 7);
  const err = limiter.rejection();
  assert.equal(err.httpStatus, 429);
  assert.equal(err.type, "rate_limit_error");
  assert.equal(err.code, "facade_concurrency_limit_exceeded");
  assert.equal(err.retryAfterSeconds, 7);
});

test("FacadeConcurrencyLimiter: clamps a non-positive max to 1 and a negative Retry-After to 0", () => {
  const limiter = new FacadeConcurrencyLimiter(0, -5);
  assert.equal(limiter.max, 1);
  assert.equal(limiter.retryAfterSeconds, 0);
});

// ── config resolution: explicit dep wins, then the env var, then the documented default ──────────

/** Run `fn` with `vars` set on `process.env`, restoring the prior values afterward — even when `fn`
 * is async (awaited BEFORE restoring, so the env var is still in effect for the whole async body). */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("resolveMaxConcurrency: explicit > env var > default; ignores non-positive/malformed values", async () => {
  await withEnv({ [MAX_CONCURRENCY_ENV_VAR]: undefined }, () => {
    assert.equal(resolveMaxConcurrency(undefined), DEFAULT_FACADE_MAX_CONCURRENCY);
  });
  await withEnv({ [MAX_CONCURRENCY_ENV_VAR]: "9" }, () => {
    assert.equal(resolveMaxConcurrency(undefined), 9, "env var wins over the default");
    assert.equal(resolveMaxConcurrency(2), 2, "an explicit value wins over the env var");
  });
  await withEnv({ [MAX_CONCURRENCY_ENV_VAR]: "not-a-number" }, () => {
    assert.equal(
      resolveMaxConcurrency(undefined),
      DEFAULT_FACADE_MAX_CONCURRENCY,
      "a malformed env var falls back to the default",
    );
  });
  await withEnv({ [MAX_CONCURRENCY_ENV_VAR]: "0" }, () => {
    assert.equal(
      resolveMaxConcurrency(undefined),
      DEFAULT_FACADE_MAX_CONCURRENCY,
      "a non-positive env var falls back to the default",
    );
  });
  assert.equal(
    resolveMaxConcurrency(0),
    DEFAULT_FACADE_MAX_CONCURRENCY,
    "an explicit non-positive value is ignored, not treated as a cap of zero",
  );
});

test("resolveLiveStream: explicit > env var (true/1) > default false (D-US12 hold-back stays default)", async () => {
  await withEnv({ [LIVE_STREAM_ENV_VAR]: undefined }, () => {
    assert.equal(resolveLiveStream(undefined), DEFAULT_FACADE_LIVE_STREAM);
    assert.equal(resolveLiveStream(undefined), false);
  });
  await withEnv({ [LIVE_STREAM_ENV_VAR]: "true" }, () => {
    assert.equal(resolveLiveStream(undefined), true);
    assert.equal(resolveLiveStream(false), false, "an explicit false wins over the env var");
  });
  await withEnv({ [LIVE_STREAM_ENV_VAR]: "1" }, () => {
    assert.equal(resolveLiveStream(undefined), true);
  });
  await withEnv({ [LIVE_STREAM_ENV_VAR]: "nope" }, () => {
    assert.equal(resolveLiveStream(undefined), false);
  });
});

// ── Integration: the concurrency cap over HTTP ────────────────────────────────────────────────────

/** A stub whose `actions/stream` call blocks until `release()` is invoked, flagging `started` first. */
function gatedStubFetch(): { fetchImpl: typeof fetch; started: () => boolean; release: () => void } {
  let started = false;
  let releaseFn: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  const fetchImpl = stubFetch({
    onStream: async () => {
      started = true;
      await gate;
      return defaultStream();
    },
  });
  return { fetchImpl, started: () => started, release: () => releaseFn?.() };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("concurrency cap: an over-cap request gets 429 + Retry-After, same OpenAI envelope", async () => {
  const { fetchImpl, started, release } = gatedStubFetch();
  const app = await buildApp(makeDeps({ fetchImpl, maxConcurrency: 1 }));

  const firstPromise = app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  // Deterministically wait until the first request has genuinely acquired its slot and is blocked
  // on the (gated) tenant call — `tryAcquire()` happens well before this point in the handler.
  await waitUntil(started);

  const second = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody({ messages: [{ role: "user", content: "a different question" }] }),
  });
  assert.equal(second.statusCode, 429);
  assert.equal(second.headers["retry-after"], "1");
  const body = second.json() as { error: { type: string; code: string } };
  assert.equal(body.error.type, "rate_limit_error");
  assert.equal(body.error.code, "facade_concurrency_limit_exceeded");

  release();
  const first = await firstPromise;
  assert.equal(first.statusCode, 200, "the first (in-flight) request still completes normally");
});

test("concurrency cap: a released slot is available to the next request", async () => {
  const { fetchImpl, started, release } = gatedStubFetch();
  const app = await buildApp(makeDeps({ fetchImpl, maxConcurrency: 1 }));

  const firstPromise = app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  await waitUntil(started);
  release();
  const first = await firstPromise;
  assert.equal(first.statusCode, 200);

  // The slot was released when the first request settled — a new request is admitted normally.
  const third = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody({ messages: [{ role: "user", content: "another question" }] }),
  });
  assert.equal(third.statusCode, 200);
});

test("concurrency cap: GET /models is NOT gated (never calls the tenant)", async () => {
  const { fetchImpl, started, release } = gatedStubFetch();
  const app = await buildApp(makeDeps({ fetchImpl, maxConcurrency: 1 }));
  const firstPromise = app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  await waitUntil(started);
  const models = await app.inject({ method: "GET", url: "/openai/v1/models", headers: authHeader });
  assert.equal(models.statusCode, 200, "models listing is unaffected by the chat-completions cap");
  release();
  await firstPromise;
});

// ── Integration: the live-stream flag ─────────────────────────────────────────────────────────────

async function streamChat(app: FastifyInstance, over: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody({ stream: true, ...over }),
  });
  const { chunks, done } = parseSse(res.payload);
  return { status: res.statusCode, chunks, done };
}

test("live-stream OFF (default): the answer is held back to ONE settled content delta", async () => {
  const app = await buildApp(makeDeps()); // liveStream defaults to false
  const { chunks } = await streamChat(app);
  const contentDeltas = chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices?.[0]?.delta?.content);
  assert.deepEqual(contentDeltas, [ANSWER], "hold-back stays the default (D-US12)");
});

test("live-stream ON: raw answer deltas stream live, token-by-token, as they arrive", async () => {
  const fetchImpl = stubFetch({
    onStream: () =>
      sseResponse([
        'data: {"output":"Hello "}\n',
        'data: {"output":"world"}\n',
        `data: {"messageId":"${MESSAGE_ID}"}\n`,
      ]),
  });
  const app = await buildApp(makeDeps({ fetchImpl, liveStream: true }));
  const { status, chunks, done } = await streamChat(app);
  assert.equal(status, 200);
  assert.equal(done, true);

  const contentDeltas = chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices?.[0]?.delta?.content as string);
  // Two live deltas, in arrival order — NOT collapsed into one settled chunk.
  assert.deepEqual(contentDeltas, ["Hello ", "world"]);
  const concatenated = contentDeltas.join("");
  assert.equal(concatenated, "Hello world");
  // Documented drift (research 04 §4 M2): the live text differs from the settled card answer, and
  // the settled answer is NOT also emitted as a duplicate content chunk.
  assert.notEqual(concatenated, ANSWER);
  assert.ok(!contentDeltas.includes(ANSWER));

  // The finish chunk's vendor field still carries the SETTLED truth regardless of live-stream mode.
  const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === "stop") as
    | (Body & { qlik_answers?: Record<string, unknown> })
    | undefined;
  assert.ok(finish?.qlik_answers, "vendor fields present on the finish chunk");
});

test("live-stream ON: falls back to the settled content when the tenant emitted no live answer text", async () => {
  const fetchImpl = stubFetch({
    onStream: () => sseResponse([`data: {"messageId":"${MESSAGE_ID}"}\n`]), // no "output" chunks
    messages: () => jsonResponse({ data: [answerMessage("Fallback settled answer.")] }),
  });
  const app = await buildApp(makeDeps({ fetchImpl, liveStream: true }));
  const { chunks } = await streamChat(app);
  const contentDeltas = chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices?.[0]?.delta?.content);
  assert.deepEqual(
    contentDeltas,
    ["Fallback settled answer."],
    "with nothing streamed live, the settled answer is still delivered exactly once",
  );
});

test("live-stream flag defaults from OPENAI_FACADE_LIVE_STREAM when deps.liveStream is omitted", async () => {
  await withEnv({ [LIVE_STREAM_ENV_VAR]: "true" }, async () => {
    const fetchImpl = stubFetch({
      onStream: () =>
        sseResponse([
          'data: {"output":"env-driven live text"}\n',
          `data: {"messageId":"${MESSAGE_ID}"}\n`,
        ]),
    });
    const app = await buildApp(makeDeps({ fetchImpl })); // no explicit liveStream
    const { chunks } = await streamChat(app);
    const contentDeltas = chunks
      .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
      .map((c) => c.choices?.[0]?.delta?.content);
    assert.deepEqual(contentDeltas, ["env-driven live text"]);
  });
});
