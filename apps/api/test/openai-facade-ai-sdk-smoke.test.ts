import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, test } from "node:test";
import { createOpenAICompatible, type MetadataExtractor } from "@ai-sdk/openai-compatible";
import Fastify, { type FastifyInstance } from "fastify";
import { streamText, type TextStreamPart, type ToolSet } from "ai";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import { registerOpenAiFacade } from "../src/openai-facade/routes.js";
import type { OpenAiFacadeDeps } from "../src/openai-facade/types.js";

/**
 * WP4.2 — the in-process AI-SDK smoke test the WP calls for: spin up the real facade on a real
 * (loopback-only) Fastify listener and drive it with the GENUINE Vercel AI-SDK OpenAI-compatible
 * client (`createOpenAICompatible`, already a dependency of `apps/api` — `registry.ts` uses the
 * same package for the app's own `openai_compatible`/`ollama` providers), not a hand-rolled fetch
 * client. This proves the facade is byte-for-byte consumable by the REAL client library our own
 * engine would use, end to end:
 *   - reasoning parts arrive on `fullStream` (`reasoning-delta`), parsed by the SDK from the
 *     facade's `reasoning_content` deltas (research 04 §1 — this parsing is a de-facto SDK
 *     feature, not something the facade has to special-case);
 *   - a `usage` object arrives (`result.usage`), converted from the facade's OpenAI-shaped
 *     `usage` chunk into the SDK's `LanguageModelUsage` (`inputTokens`/`outputTokens`/`totalTokens`);
 *   - a `metadataExtractor` sees the `qlik_answers` + `citations` vendor fields, surfaced as
 *     `result.providerMetadata` — proving the vendor-field pass-through contract (research 04 §3)
 *     works through the SDK's own extension point, not just via raw JSON assertions.
 *
 * Only the LOOPBACK call from the AI-SDK client to this in-process facade is a real network call
 * (the same pattern `openai-facade.test.ts`'s `listenApp`/`streamChat` already use) — the facade's
 * OWN call to the Qlik tenant is, as everywhere else in this repo, fully stubbed via the injected
 * `fetchImpl`. No real Qlik tenant is ever contacted (the repo invariant).
 */

const FACADE_KEY = "mcpfp-test-key";
const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What was the average NYC taxi fare?";
const ETAG = "assistant-version-42";
const MESSAGE_ID = "msg-1";
const ANSWER = "The average NYC taxi fare was $18.50.";
const AUTH = { apiKey: "secret-key", baseUrl: BASE_URL };

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function answerMessage(): unknown {
  return {
    id: MESSAGE_ID,
    type: "ai",
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Reasoning: aggregated fares." },
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: ANSWER },
          ],
        },
      },
    ],
    analysis: { qHyperCubeDef: { qMeasures: [{ qDef: { qDef: "Avg([fare_amount])" } }] } },
  };
}

const REASONING_PATH = "/content/0/card/body/0/steps/0/content/toggleContent/0/items/0/text";
function patchFrame(path: string, value: string): string {
  return `data: ${JSON.stringify({ method: "delta", params: { path, value } })}\n`;
}

/** Two reasoning frames (proving MULTIPLE live `reasoning-delta` parts arrive, not just one). */
function stream(): Response {
  const encoder = new TextEncoder();
  const frames = [
    patchFrame(REASONING_PATH, "<plan>Discovering the relevant assets.</plan>"),
    patchFrame(REASONING_PATH, " Aggregating fares."),
    `data: {"messageId":"${MESSAGE_ID}"}\n`,
  ];
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
    headers: { "content-type": "text/event-stream", etag: ETAG },
  });
}

function stubTenantFetch(): typeof fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/messages")) return jsonResponse({ data: [answerMessage()] });
    if (url.endsWith("/actions/stream")) return stream();
    if (url.endsWith("/cloud-assistants/threads")) return jsonResponse({ id: "thread-1" });
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

async function listenFacade(over: Partial<OpenAiFacadeDeps> = {}): Promise<string> {
  const deps: OpenAiFacadeDeps = {
    facadeKey: FACADE_KEY,
    resolveModel: (model) => (model === ASSISTANT_ID ? AUTH : undefined),
    listModels: async () => [{ id: ASSISTANT_ID, displayName: "Sales Assistant" }],
    fetchImpl: stubTenantFetch(),
    tokenProfile: "generic_o200k",
    ...over,
  };
  const app = Fastify({ logger: false });
  await registerOpenAiFacade(app, deps);
  apps.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/openai/v1`;
}

/**
 * Sanctioned pass-through of the vendor fields into `providerMetadata` — mirrors what a REAL
 * consumer would write (research 04 §1: "`@ai-sdk/openai-compatible` offers a sanctioned
 * pass-through for nonstandard fields (`metadataExtractor` → `providerMetadata`)").
 *
 * IMPORTANT (verified against the installed `@ai-sdk/openai-compatible@3.0.3` source, not
 * guessed): `extractMetadata`/`buildMetadata`'s return value is spread onto the model's
 * `providerMetadata` object AS-IS — it is NOT auto-nested under the provider name — so per the
 * type's own doc ("the metadata should be under a key indicating the provider id"), the extractor
 * must nest its own payload under `providerKey` itself.
 */
function qlikMetadataExtractor(providerKey: string): MetadataExtractor {
  return {
    async extractMetadata({ parsedBody }) {
      const body = parsedBody as { qlik_answers?: unknown; citations?: unknown };
      if (!body?.qlik_answers) return undefined;
      return { [providerKey]: { qlik_answers: body.qlik_answers, citations: body.citations } };
    },
    createStreamExtractor() {
      let qlikAnswers: unknown;
      let citations: unknown;
      return {
        processChunk(parsedChunk) {
          const chunk = parsedChunk as { qlik_answers?: unknown; citations?: unknown };
          // The full-fidelity `qlik_answers` object lands on the FINISH chunk (has `threadId`); the
          // minimal `{ estimatedTokens: true }` marker on the usage chunk is skipped in favor of it.
          if (
            chunk?.qlik_answers &&
            typeof chunk.qlik_answers === "object" &&
            "threadId" in (chunk.qlik_answers as Record<string, unknown>)
          ) {
            qlikAnswers = chunk.qlik_answers;
          }
          if (chunk?.citations !== undefined) citations = chunk.citations;
        },
        buildMetadata() {
          if (!qlikAnswers) return undefined;
          return { [providerKey]: { qlik_answers: qlikAnswers, citations } };
        },
      };
    },
  };
}

test("AI-SDK smoke: createOpenAICompatible driving the real facade — reasoning parts, usage, vendor metadata", async () => {
  const baseURL = await listenFacade();
  const providerKey = "qlik_answers_smoke";
  const provider = createOpenAICompatible({
    name: providerKey,
    baseURL,
    apiKey: FACADE_KEY,
    metadataExtractor: qlikMetadataExtractor(providerKey),
  });

  const result = streamText({ model: provider(ASSISTANT_ID), prompt: PROMPT });

  const reasoningDeltas: string[] = [];
  const textDeltas: string[] = [];
  for await (const part of result.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
    if (part.type === "reasoning-delta" && part.text) reasoningDeltas.push(part.text);
    if (part.type === "text-delta" && part.text) textDeltas.push(part.text);
  }

  // ── Reasoning parts arrived, live, as first-class stream parts ──────────────────────────────
  assert.ok(reasoningDeltas.length > 0, "at least one reasoning-delta part arrived");
  assert.equal(
    reasoningDeltas.join(""),
    "Discovering the relevant assets. Aggregating fares.",
    "the SDK parsed reasoning_content (mirrored from reasoning) into text, <plan> tags stripped",
  );

  // ── The settled (hold-back) answer arrived as ordinary text content ─────────────────────────
  assert.equal(textDeltas.join(""), ANSWER);

  // ── A usage object arrived, converted into the SDK's own shape ──────────────────────────────
  const usage = await result.usage;
  assert.ok(usage.inputTokens !== undefined && usage.inputTokens > 0);
  assert.ok(usage.outputTokens !== undefined && usage.outputTokens > 0);
  assert.equal(usage.totalTokens, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));

  // ── The metadataExtractor saw the qlik_answers + citations vendor fields ────────────────────
  const providerMetadata = await result.providerMetadata;
  const vendor = providerMetadata?.qlik_answers_smoke as
    | { qlik_answers?: Record<string, unknown>; citations?: unknown[] }
    | undefined;
  assert.ok(vendor?.qlik_answers, "the metadataExtractor captured the qlik_answers vendor object");
  assert.equal(vendor?.qlik_answers?.threadId, "thread-1");
  assert.equal(vendor?.qlik_answers?.appId, APP_ID);
  assert.equal(vendor?.qlik_answers?.assistantVersion, ETAG);
  assert.equal(vendor?.qlik_answers?.estimatedTokens, true);
  assert.deepEqual(vendor?.citations, [], "citations is present (empty for an app-backed assistant)");
});

test("AI-SDK smoke: a wrong facade key surfaces as the SDK's own auth error (invalid_api_key)", async () => {
  const baseURL = await listenFacade();
  const provider = createOpenAICompatible({
    name: "qlik_answers_smoke_bad_key",
    baseURL,
    apiKey: "wrong-key",
  });

  // AI SDK v7 delivers a failed language-model call to the `onError` callback (and an `error` part
  // on `fullStream`) rather than rejecting the `streamText()`/`fullStream` promise chain directly —
  // verified against the installed SDK, not assumed.
  let captured: unknown;
  const result = streamText({
    model: provider(ASSISTANT_ID),
    prompt: PROMPT,
    onError: ({ error }) => {
      captured = error;
    },
  });
  const parts: Array<TextStreamPart<ToolSet>> = [];
  for await (const part of result.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
    parts.push(part);
  }

  assert.ok(captured, "onError received the upstream 401");
  const message = captured instanceof Error ? captured.message : String(captured);
  assert.match(message, /api key|401|unauthor/i);
  assert.ok(
    parts.some((p) => p.type === "error"),
    "an error part also surfaced on fullStream",
  );
});
