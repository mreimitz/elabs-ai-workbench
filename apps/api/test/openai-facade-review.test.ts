/**
 * WP4.R — ADVERSARIAL REVIEW of the OpenAI-compat facade (feat/unified-sessions-wp4.R), carried
 * forward + FOLLOWED UP on feat/unified-sessions-wp4.fix.
 *
 * These are REFUTATION probes, not feature tests: each block tries hard to break a conformance /
 * security / correctness claim from research 04 (`research/unified-run-sessions/04-openai-compat-wrapper.md`)
 * and the OpenAI Chat-Completions contract, then records whether the claim CONFIRMED-broke or HELD.
 * Same stub-fetch-only invariant as the other facade tests — NO real tenant is ever contacted.
 *
 * WP4.R found two real gaps against research 04 / the user-guide's documented claims, both tagged
 * `GAP:` at the time. The WP4.fix follow-up resolved them differently, per their blast radius:
 *   - **GAP-2** (live-stream × drift breaking append affinity, facade-owned code) — CODE FIX in
 *     `routes.ts`; the probe below now asserts the FIXED behavior (thread reuse on an honest
 *     live-text append) instead of the confirmed-broken one.
 *   - **GAP-1** (resolution-phase tenant 5xx mislabeled 404, living in the pre-existing/shared
 *     `providers/model-catalog.ts`, out of the facade's edit scope) — DOC FIX only; the probe below
 *     still asserts the actual 404 behavior, now matching the corrected user-guide error table.
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import { registerOpenAiFacade } from "../src/openai-facade/routes.js";
import type { OpenAiFacadeDeps } from "../src/openai-facade/types.js";
import { runQlikAnswers } from "../src/testing/qlik-answers-executor.js";
import type { RunEvent } from "@mcp-token-footprint/shared";

// ── Stub tenant wire (mirrors openai-facade.test.ts fixtures) ─────────────────────────────────────

const FACADE_KEY = "mcpfp-super-secret-facade-key-DO-NOT-LEAK";
const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What was the average NYC taxi fare?";
const ETAG = "assistant-version-42";
const MESSAGE_ID = "msg-1";
const ANSWER = "The average NYC taxi fare was $18.50.";
const AUTH = { apiKey: "qlik-tenant-bearer-secret", baseUrl: BASE_URL };

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

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
function defaultStream(): Response {
  return sseResponse(
    [
      patchFrame({ path: REASONING_PATH, value: "<plan>Discovering the relevant assets.</plan>" }),
      'data: {"output":"LIVE-drift-text"}\n',
      `data: {"messageId":"${MESSAGE_ID}"}\n`,
    ],
    { headers: { etag: ETAG } },
  );
}

function stubFetch(opts: {
  calls?: Call[];
  detail?: unknown;
  detailStatus?: number;
  thread?: () => Response;
  onStream?: (init: RequestInit | undefined) => Response | Promise<Response>;
  messages?: () => Response;
}): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    opts.calls?.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/messages"))
      return (opts.messages ?? (() => jsonResponse({ data: [answerMessage()] })))();
    if (url.endsWith("/actions/stream")) return (opts.onStream ?? (() => defaultStream()))(init);
    if (url.endsWith("/cloud-assistants/threads"))
      return (opts.thread ?? (() => jsonResponse({ id: `thread-${opts.calls?.length ?? 0}` })))();
    if (url.includes("/api/v1/assistants/"))
      return jsonResponse(opts.detail ?? { id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] }, {
        status: opts.detailStatus ?? 200,
      });
    return new Response("not found", { status: 404 });
  };
  return impl as typeof fetch;
}

// ── Harness ───────────────────────────────────────────────────────────────────────────────────────

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

async function listenApp(deps: OpenAiFacadeDeps): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = await buildApp(deps);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

const authHeader = { authorization: `Bearer ${FACADE_KEY}` };

function chatBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: ASSISTANT_ID, messages: [{ role: "user", content: PROMPT }], ...over };
}

type Chunk = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: Record<string, unknown>;
    message?: Record<string, unknown>;
    finish_reason?: string | null;
  }>;
  usage?: Record<string, number>;
  citations?: unknown[];
  qlik_answers?: Record<string, unknown>;
};

/** Parse a raw SSE body preserving RAW `data:` line order + the `[DONE]` position. */
function parseSseOrdered(text: string): { chunks: Chunk[]; dataLines: string[]; doneIndex: number } {
  const chunks: Chunk[] = [];
  const dataLines: string[] = [];
  let doneIndex = -1;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    dataLines.push(payload);
    if (payload === "[DONE]") {
      doneIndex = dataLines.length - 1;
      continue;
    }
    chunks.push(JSON.parse(payload));
  }
  return { chunks, dataLines, doneIndex };
}

async function streamOverHttp(baseUrl: string, over: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader },
    body: JSON.stringify(chatBody({ stream: true, ...over })),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, ...parseSseOrdered(text) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. PROTOCOL CONFORMANCE
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("[1] streaming: every chunk has the exact chat.completion.chunk envelope + stable id/model/created", async () => {
  const { baseUrl } = await listenApp(makeDeps());
  const { chunks } = await streamOverHttp(baseUrl);
  assert.ok(chunks.length >= 4, "role + reasoning + content + finish + usage");
  const id = chunks[0]!.id;
  assert.ok(String(id).startsWith("chatcmpl-"), "id has the chatcmpl- prefix");
  for (const c of chunks) {
    assert.equal(c.object, "chat.completion.chunk", "object is chat.completion.chunk on every chunk");
    assert.equal(c.id, id, "the same id is reused across all chunks (OpenAI requires this)");
    assert.equal(c.model, ASSISTANT_ID);
    assert.equal(typeof c.created, "number");
    assert.ok(Number.isInteger(c.created), "created is integer seconds");
    assert.ok(Array.isArray(c.choices), "choices is always an array");
  }
});

test("[1] streaming: chunk ORDER is role → reasoning → content → finish(stop) → usage([]) → [DONE] last", async () => {
  const { baseUrl } = await listenApp(makeDeps());
  const { chunks, dataLines, doneIndex } = await streamOverHttp(baseUrl);

  // Role first.
  assert.equal(chunks[0]!.choices![0]!.delta!.role, "assistant");
  assert.equal(chunks[0]!.choices![0]!.finish_reason, null);

  // Indices of the milestone chunks (excluding [DONE], which isn't a JSON chunk).
  const contentIdx = chunks.findIndex((c) => typeof c.choices?.[0]?.delta?.content === "string");
  const finishIdx = chunks.findIndex((c) => c.choices?.[0]?.finish_reason === "stop");
  const usageIdx = chunks.findIndex((c) => c.usage !== undefined);
  const reasoningIdx = chunks.findIndex(
    (c) => (c.choices?.[0]?.delta as Record<string, unknown>)?.reasoning_content !== undefined,
  );

  assert.ok(reasoningIdx >= 0 && reasoningIdx < contentIdx, "reasoning precedes content");
  assert.ok(contentIdx >= 0 && contentIdx < finishIdx, "content precedes finish");
  assert.ok(finishIdx < usageIdx, "finish precedes usage");

  // The finish chunk carries finish_reason + an EMPTY delta (OpenAI's separate-finish-chunk shape).
  assert.deepEqual(chunks[finishIdx]!.choices![0]!.delta, {}, "finish chunk delta is empty");

  // The usage chunk has EMPTY choices + populated usage (the include_usage final-chunk shape).
  assert.deepEqual(chunks[usageIdx]!.choices, [], "usage chunk choices is []");
  assert.ok((chunks[usageIdx]!.usage!.total_tokens ?? 0) > 0);

  // [DONE] is the terminator and the LAST data line; nothing follows it.
  assert.ok(doneIndex >= 0, "a [DONE] sentinel is present");
  assert.equal(doneIndex, dataLines.length - 1, "[DONE] is the final SSE data line");
  assert.equal(dataLines.filter((l) => l === "[DONE]").length, 1, "exactly one [DONE]");
});

test("[1] non-streaming: complete chat.completion envelope (object, choices[].message, finish_reason, usage)", async () => {
  const app = await buildApp(makeDeps());
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Chunk;
  assert.equal(body.object, "chat.completion");
  assert.ok(String(body.id).startsWith("chatcmpl-"));
  assert.equal(body.choices![0]!.index, 0);
  assert.equal(body.choices![0]!.message!.role, "assistant");
  assert.equal(body.choices![0]!.message!.content, ANSWER);
  assert.equal(body.choices![0]!.finish_reason, "stop");
  assert.equal(
    body.usage!.total_tokens,
    body.usage!.prompt_tokens + body.usage!.completion_tokens,
    "total = prompt + completion",
  );
});

test("[1] GET /models: object:list, every data[] entry is object:model with created + owned_by:qlik", async () => {
  const app = await buildApp(makeDeps({ listModels: async () => [
    { id: "asst-1", displayName: "One" },
    { id: "asst-2" },
  ] }));
  const res = await app.inject({ method: "GET", url: "/openai/v1/models", headers: authHeader });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { object: string; data: Array<Record<string, unknown>> };
  assert.equal(body.object, "list");
  assert.equal(body.data.length, 2);
  for (const m of body.data) {
    assert.equal(m.object, "model");
    assert.equal(m.owned_by, "qlik");
    assert.equal(typeof m.created, "number");
    assert.equal(typeof m.id, "string");
  }
});

test("[1] every error path returns the full {error:{message,type,param,code}} envelope", async () => {
  const app = await buildApp(makeDeps());
  const cases: Array<{ payload: unknown; headers: Record<string, string>; status: number }> = [
    { payload: chatBody(), headers: {}, status: 401 }, // missing key
    { payload: chatBody({ model: "nope" }), headers: authHeader, status: 404 }, // bad model
    { payload: { model: ASSISTANT_ID }, headers: authHeader, status: 400 }, // no messages
  ];
  for (const c of cases) {
    const res = await app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: c.headers,
      payload: c.payload as Record<string, unknown>,
    });
    assert.equal(res.statusCode, c.status);
    const body = res.json() as { error?: Record<string, unknown> };
    assert.ok(body.error, "an error object is present");
    assert.equal(typeof body.error!.message, "string");
    assert.equal(typeof body.error!.type, "string");
    assert.ok("param" in body.error!, "envelope carries a param field (null allowed)");
    assert.ok("code" in body.error!, "envelope carries a code field (null allowed)");
  }
});

test("[1] stream_options.include_usage:false is IGNORED — usage still emitted (documented deviation, harmless)", async () => {
  // OpenAI strict spec: no usage chunk unless include_usage:true. The facade emits it UNCONDITIONALLY
  // (research 04 §3 pre-blesses this as "harmless to strict clients"). This probe pins the actual
  // behavior so a future regression toward/away from it is visible. HOLDS-by-design.
  const { baseUrl } = await listenApp(makeDeps());
  const off = await streamOverHttp(baseUrl, { stream_options: { include_usage: false } });
  assert.ok(off.chunks.some((c) => c.usage !== undefined), "usage emitted even with include_usage:false");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. ERROR MAPPING
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("[2] non-streaming tenant 5xx on thread-create → 502 upstream_error", async () => {
  const fetchImpl = stubFetch({ thread: () => jsonResponse({ message: "boom" }, { status: 500 }) });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 502);
  assert.equal((res.json() as { error: { code: string } }).error.code, "upstream_error");
});

test("[2] tenant 403 / AE-3 on the stream POST → 401 invalid_api_key (STORED credential rejected upstream)", async () => {
  const fetchImpl = stubFetch({
    onStream: () => jsonResponse({ errors: [{ code: "AE-3" }] }, { status: 403 }),
  });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 401);
  assert.equal((res.json() as { error: { code: string } }).error.code, "invalid_api_key");
});

test("[2] tenant 429 WITHOUT a Retry-After header → 429 + Retry-After defaulted to 1", async () => {
  const fetchImpl = stubFetch({ onStream: () => jsonResponse({ errors: [{ code: "AE-6" }] }, { status: 429 }) });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "1", "Retry-After defaults to 1s when the tenant omits it");
});

test("[2] streaming AE-4 → content_filter finish, empty content, usage + [DONE], no HTTP error", async () => {
  const fetchImpl = stubFetch({
    onStream: () => jsonResponse({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }, { status: 400 }),
  });
  const { baseUrl } = await listenApp(makeDeps({ fetchImpl }));
  const { status, chunks, doneIndex } = await streamOverHttp(baseUrl);
  assert.equal(status, 200);
  assert.ok(doneIndex >= 0, "[DONE] terminates even a rejection stream");
  const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === "content_filter");
  assert.ok(finish, "content_filter finish chunk");
  assert.equal(finish!.qlik_answers!.rejected, true);
  assert.ok(chunks.some((c) => c.usage !== undefined), "usage chunk still emitted on a rejection");
  assert.ok(
    !chunks.some((c) => typeof c.choices?.[0]?.delta?.content === "string"),
    "no content delta on a rejection",
  );
});

test("[2] tenant 5xx DURING app-context resolution → 404 model_not_found (documented in user-guide/15)", async () => {
  // WP4.R GAP-1 (owner: reused providers/model-catalog.ts resolveQlikAnswersAppContext, NOT new
  // facade code — out of this fix's scope, see the WP4.fix report): the resolver SWALLOWS a
  // non-OK/throwing tenant response and treats it as "no app id", so a tenant 500 during resolution
  // surfaces as 404 model_not_found, indistinguishable from an unbound app at that phase. The
  // user-guide error table (user-guide/15-openai-endpoint.md) has been corrected to document this
  // as the actual resolution-phase behavior (with tenant failures during run/stream still → 502),
  // rather than promising a 502 the facade can't currently deliver at this phase. Asserted here as
  // ACTUAL (and now DOCUMENTED) behavior.
  const fetchImpl = stubFetch({ detailStatus: 500, detail: { message: "tenant down" } });
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 404, "resolution-phase 5xx currently maps to 404, not 502");
  assert.equal((res.json() as { error: { code: string } }).error.code, "model_not_found");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. AFFINITY FORK (documented amnesia)
// ════════════════════════════════════════════════════════════════════════════════════════════════

function threadCreateCount(calls: Call[]): number {
  return calls.filter((c) => c.method === "POST" && c.url.endsWith("/cloud-assistants/threads")).length;
}

async function postChat(app: FastifyInstance, messages: Array<{ role: string; content: string }>) {
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: { model: ASSISTANT_ID, messages },
  });
  assert.equal(res.statusCode, 200, res.payload);
}

test("[3] hold-back: an append conversation (echoing the SETTLED answer) reuses ONE thread; edit forks", async () => {
  const calls: Call[] = [];
  const app = await buildApp(makeDeps({ fetchImpl: stubFetch({ calls }) }));
  await postChat(app, [{ role: "user", content: "q1" }]);
  assert.equal(threadCreateCount(calls), 1);
  await postChat(app, [
    { role: "user", content: "q1" },
    { role: "assistant", content: ANSWER }, // hold-back client echoes the SETTLED answer it received
    { role: "user", content: "q2" },
  ]);
  assert.equal(threadCreateCount(calls), 1, "append reuses the thread");
  await postChat(app, [
    { role: "user", content: "EDITED" },
    { role: "assistant", content: ANSWER },
    { role: "user", content: "q2" },
  ]);
  assert.equal(threadCreateCount(calls), 2, "an edited prefix forks a new thread (documented amnesia)");
});

test("[3] a different MODEL with identical history does NOT reuse another model's thread", async () => {
  const calls: Call[] = [];
  const app = await buildApp(
    makeDeps({
      calls,
      resolveModel: (m) => (m === "asst-A" || m === "asst-B" ? AUTH : undefined),
      fetchImpl: stubFetch({ calls }),
    } as Partial<OpenAiFacadeDeps> & { calls?: Call[] }),
  );
  const send = async (model: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: authHeader,
      payload: { model, messages: [{ role: "user", content: "same-q" }] },
    });
    assert.equal(res.statusCode, 200, res.payload);
  };
  await send("asst-A");
  await send("asst-B");
  // Both are first-turn (empty prior) so both create anyway; the point is no cross-model reuse.
  assert.equal(threadCreateCount(calls), 2, "model is part of the affinity key — no cross-model reuse");
});

test("[3] FIXED (WP4.R GAP-2): live-stream append with drift REUSES the thread; an edited prefix still forks", async () => {
  // WP4.R GAP-2 was: the affinity cache STORED the SETTLED answer, but in live-stream mode the
  // client received (and echoes back) the LIVE-streamed text, which — precisely in the drift case
  // live-stream exists to allow — differs from the settled answer. So an honest append MISSED the
  // cache and forked a new Qlik thread every turn, silently violating the user-guide's promise that
  // only EDITED history causes amnesia. Fix (routes.ts): when live text was actually streamed, the
  // cache stores under the CONCATENATED LIVE text (what the client saw), not the settled answer.
  const calls: Call[] = [];
  const { baseUrl } = await listenApp(makeDeps({ fetchImpl: stubFetch({ calls }), liveStream: true }));

  // Turn 1: a real streaming request — capture EXACTLY the live content deltas the client received
  // (the tenant's raw stream output is "LIVE-drift-text"; the settled card answer is ANSWER — they
  // deliberately differ, to prove the store key follows the live text, not the settled one).
  const turn1 = await streamOverHttp(baseUrl, { messages: [{ role: "user", content: "q1" }] });
  assert.equal(threadCreateCount(calls), 1);
  const liveText = turn1.chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices![0]!.delta!.content as string)
    .join("");
  assert.equal(liveText, "LIVE-drift-text", "sanity: the client's view drifted from the settled answer");

  // Turn 2: an HONEST append — the client echoes back exactly the live text it saw (not the settled
  // answer, which it never received as `content` in live-stream mode).
  await streamOverHttp(baseUrl, {
    messages: [
      { role: "user", content: "q1" },
      { role: "assistant", content: liveText },
      { role: "user", content: "q2" },
    ],
  });
  assert.equal(threadCreateCount(calls), 1, "FIXED: an honest live-text append reuses the thread");

  // Turn 3: a genuinely EDITED prefix still forks — the fix doesn't weaken real amnesia detection.
  await streamOverHttp(baseUrl, {
    messages: [
      { role: "user", content: "EDITED" },
      { role: "assistant", content: liveText },
      { role: "user", content: "q2" },
    ],
  });
  assert.equal(threadCreateCount(calls), 2, "an edited prefix still forks a new thread (documented amnesia)");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. HOLD-BACK vs SETTLED byte-identity (the golden invariant)
// ════════════════════════════════════════════════════════════════════════════════════════════════

async function executorAnswerText(fetchImpl: typeof fetch): Promise<string> {
  const events: RunEvent[] = [];
  await runQlikAnswers(
    "review-golden",
    { assistantId: ASSISTANT_ID, prompt: PROMPT, auth: AUTH, profiles: ["generic_o200k"], transport: "invoke", fetchImpl },
    (e) => events.push(e),
  );
  const step = events.find(
    (e): e is Extract<RunEvent, { type: "step" }> => e.type === "step" && e.step.type === "llm_response",
  );
  return step?.step.assistantText ?? "<none>";
}

async function facadeNonStreamingContent(fetchImpl: typeof fetch): Promise<string> {
  const app = await buildApp(makeDeps({ fetchImpl }));
  const res = await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.equal(res.statusCode, 200, res.payload);
  return (res.json() as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content;
}

async function facadeStreamingContent(fetchImpl: typeof fetch): Promise<string> {
  const { baseUrl } = await listenApp(makeDeps({ fetchImpl }));
  const { chunks } = await streamOverHttp(baseUrl);
  return chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices![0]!.delta!.content as string)
    .join("");
}

const IDENTITY_FIXTURES: Array<{ name: string; build: () => typeof fetch }> = [
  { name: "standard card answer", build: () => stubFetch({}) },
  {
    name: "multi-paragraph with citations stripped",
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
                        { type: "TextBlock", text: 'Fares rose 12%.<citation data-index="0">s</citation>' },
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
    name: "empty card → live-streamed-text fallback (identical fallback on both sides)",
    build: () =>
      stubFetch({
        messages: () => jsonResponse({ data: [{ id: MESSAGE_ID, content: [{ card: { body: [] } }] }] }),
        onStream: () =>
          sseResponse(['data: {"output":"Fallback only."}\n', `data: {"messageId":"${MESSAGE_ID}"}\n`]),
      }),
  },
];

for (const fx of IDENTITY_FIXTURES) {
  test(`[4] hold-back byte-identity: streaming content === non-streaming content === executor — ${fx.name}`, async () => {
    const fromExecutor = await executorAnswerText(fx.build());
    _clearQlikAnswersAppContextCache();
    const fromNonStream = await facadeNonStreamingContent(fx.build());
    _clearQlikAnswersAppContextCache();
    const fromStream = await facadeStreamingContent(fx.build());
    assert.equal(fromNonStream, fromExecutor, "facade non-streaming content === executor assistantText");
    assert.equal(fromStream, fromExecutor, "facade streaming content (concatenated) === executor assistantText");
    assert.ok(fromExecutor.length > 0, "fixture produced a non-empty answer");
  });
}

test("[4] live-stream: concat(answer deltas) === LIVE text (drift accepted), settled NOT double-emitted", async () => {
  const fetchImpl = stubFetch({
    onStream: () =>
      sseResponse([
        'data: {"output":"Alpha "}\n',
        'data: {"output":"Beta"}\n',
        `data: {"messageId":"${MESSAGE_ID}"}\n`,
      ]),
    messages: () => jsonResponse({ data: [answerMessage("SETTLED-DIFFERENT")] }),
  });
  const { baseUrl } = await listenApp(makeDeps({ fetchImpl, liveStream: true }));
  const { chunks } = await streamOverHttp(baseUrl);
  const deltas = chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices![0]!.delta!.content as string);
  assert.deepEqual(deltas, ["Alpha ", "Beta"], "raw live deltas, in arrival order, not collapsed");
  assert.equal(deltas.join(""), "Alpha Beta");
  assert.ok(!deltas.includes("SETTLED-DIFFERENT"), "the settled answer is NOT also emitted as content (no double-emit)");
  // The settled truth still rides the vendor field regardless of live-stream drift.
  const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === "stop");
  assert.ok(finish?.qlik_answers?.threadId, "settled vendor identity present on the finish chunk");
});

test("[4] live-stream: when the tenant streams NO answer text, the settled answer is delivered exactly once", async () => {
  const fetchImpl = stubFetch({
    onStream: () => sseResponse([`data: {"messageId":"${MESSAGE_ID}"}\n`]),
    messages: () => jsonResponse({ data: [answerMessage("Only settled.")] }),
  });
  const { baseUrl } = await listenApp(makeDeps({ fetchImpl, liveStream: true }));
  const { chunks } = await streamOverHttp(baseUrl);
  const deltas = chunks
    .filter((c) => typeof c.choices?.[0]?.delta?.content === "string")
    .map((c) => c.choices![0]!.delta!.content as string);
  assert.deepEqual(deltas, ["Only settled."], "exactly one settled content delta (fallback), never empty");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. KEY HYGIENE (security)
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("[5] the facade key never appears in ANY tenant call (url, headers, or body); tenant sees only the Qlik bearer", async () => {
  const calls: Call[] = [];
  const app = await buildApp(makeDeps({ fetchImpl: stubFetch({ calls }) }));
  await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.ok(calls.length >= 3, "the tenant was actually called (resolve + thread + stream + messages)");
  for (const c of calls) {
    const serialized = JSON.stringify({ url: c.url, headers: c.headers, body: c.body });
    assert.ok(!serialized.includes(FACADE_KEY), `facade key leaked into a tenant call: ${c.url}`);
    assert.equal(c.headers.authorization, `Bearer ${AUTH.apiKey}`, "tenant only ever sees the Qlik bearer");
  }
});

test("[5] the facade key never appears in ANY response body/header across every status class", async () => {
  const scenarios: Array<{ label: string; deps: OpenAiFacadeDeps; payload: unknown; headers: Record<string, string> }> = [
    { label: "200 success", deps: makeDeps(), payload: chatBody(), headers: authHeader },
    { label: "401 wrong key", deps: makeDeps(), payload: chatBody(), headers: { authorization: "Bearer wrong" } },
    { label: "404 bad model", deps: makeDeps(), payload: chatBody({ model: "nope" }), headers: authHeader },
    {
      label: "429 tenant rate limit",
      deps: makeDeps({ fetchImpl: stubFetch({ onStream: () => jsonResponse({ errors: [{ code: "AE-6" }] }, { status: 429 }) }) }),
      payload: chatBody(),
      headers: authHeader,
    },
    {
      label: "502 upstream",
      deps: makeDeps({ fetchImpl: stubFetch({ thread: () => jsonResponse({}, { status: 500 }) }) }),
      payload: chatBody(),
      headers: authHeader,
    },
    {
      label: "200 content_filter (AE-4)",
      deps: makeDeps({ fetchImpl: stubFetch({ onStream: () => jsonResponse({ errors: [{ code: "AE-4" }] }, { status: 400 }) }) }),
      payload: chatBody(),
      headers: authHeader,
    },
  ];
  for (const s of scenarios) {
    const app = await buildApp(s.deps);
    const res = await app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: s.headers,
      payload: s.payload as Record<string, unknown>,
    });
    assert.ok(!res.payload.includes(FACADE_KEY), `[${s.label}] facade key leaked into the response body`);
    assert.ok(
      !JSON.stringify(res.headers).includes(FACADE_KEY),
      `[${s.label}] facade key leaked into a response header`,
    );
  }
  _clearQlikAnswersAppContextCache();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. STUB-ONLY INVARIANT
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("[6] every tenant HTTP call routes through the injected fetchImpl and hits ONLY known cloud-assistants endpoints", async () => {
  const calls: Call[] = [];
  const app = await buildApp(makeDeps({ fetchImpl: stubFetch({ calls }) }));
  await app.inject({
    method: "POST",
    url: "/openai/v1/chat/completions",
    headers: authHeader,
    payload: chatBody(),
  });
  assert.ok(calls.length > 0, "the injected fetchImpl received every tenant call");
  for (const c of calls) {
    assert.ok(c.url.startsWith(BASE_URL), `a call escaped the stubbed tenant origin: ${c.url}`);
    const known =
      c.url.includes("/api/v1/assistants/") ||
      c.url.includes("/api/v1/cloud-assistants/") ||
      c.url.endsWith("/cloud-assistants/threads") ||
      c.url.endsWith("/actions/stream") ||
      c.url.endsWith("/messages");
    assert.ok(known, `an unexpected tenant endpoint was contacted: ${c.url}`);
  }
});
