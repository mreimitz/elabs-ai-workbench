import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSISTANT_DEFAULT_MODEL_ROSTER } from "@mcp-token-footprint/shared";
import {
  type FetchLike,
  isChatModelId,
  listAvailableModels,
  parseAnthropicModels,
  parseGoogleModels,
  parseOpenAiModels,
  parseQlikAnswersAssistants,
} from "../src/providers/model-catalog.js";

// These lock the pure provider-response normalizers behind GET /api/providers/:id/models. They are
// the part most likely to drift as provider rosters change shape, and the only part testable without
// a live network call (the fetch/pagination glue around them is thin).

test("parseAnthropicModels maps id + display_name and skips entries without an id", () => {
  const payload = {
    data: [
      { type: "model", id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
      { type: "model", id: "claude-haiku-4-5" }, // no display_name → undefined
      { type: "model" }, // no id → dropped
      "garbage", // non-object → dropped
    ],
    has_more: false,
    last_id: "claude-haiku-4-5",
  };

  assert.deepEqual(parseAnthropicModels(payload), [
    { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5", displayName: undefined },
  ]);
});

test("parseOpenAiModels(filterChat) drops non-chat models but keeps gpt/o-series", () => {
  const payload = {
    object: "list",
    data: [
      { id: "gpt-5.5" },
      { id: "gpt-4o" },
      { id: "o3-mini" },
      { id: "chatgpt-4o-latest" },
      { id: "text-embedding-3-large" }, // embedding → dropped
      { id: "whisper-1" }, // whisper → dropped
      { id: "tts-1" }, // tts → dropped
      { id: "dall-e-3" }, // image → dropped
      { id: "omni-moderation-latest" }, // moderation → dropped
      { id: "gpt-4o-audio-preview" }, // audio → dropped
      { id: "gpt-4o-realtime-preview" }, // realtime → dropped
      { id: "davinci-002" }, // legacy base → dropped
    ],
  };

  assert.deepEqual(
    parseOpenAiModels(payload, true).map((m) => m.id),
    ["gpt-5.5", "gpt-4o", "o3-mini", "chatgpt-4o-latest"],
  );
});

test("parseOpenAiModels(filterChat=false) passes the roster through unfiltered", () => {
  const payload = { data: [{ id: "llama3.3" }, { id: "text-embedding-3-large" }, { id: 42 }] };
  // id:42 is not a string → dropped; the rest pass through with no chat filter.
  assert.deepEqual(
    parseOpenAiModels(payload, false).map((m) => m.id),
    ["llama3.3", "text-embedding-3-large"],
  );
});

test("parseGoogleModels keeps only generateContent models, strips the models/ prefix, maps limits", () => {
  const payload = {
    models: [
      {
        name: "models/gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        inputTokenLimit: 1048576,
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
      {
        name: "models/text-embedding-004",
        displayName: "Text Embedding 004",
        supportedGenerationMethods: ["embedContent"], // no generateContent → dropped
      },
      {
        name: "models/gemini-2.5-pro",
        supportedGenerationMethods: ["generateContent"], // no displayName / limit → undefined
      },
    ],
    nextPageToken: "",
  };

  assert.deepEqual(parseGoogleModels(payload), [
    {
      id: "gemini-3.5-flash",
      displayName: "Gemini 3.5 Flash",
      contextWindow: 1048576,
    },
    { id: "gemini-2.5-pro", displayName: undefined, contextWindow: undefined },
  ]);
});

test("parsers return [] for empty / malformed payloads", () => {
  for (const bad of [null, undefined, {}, { data: "nope" }, { models: 5 }, []]) {
    assert.deepEqual(parseAnthropicModels(bad), []);
    assert.deepEqual(parseOpenAiModels(bad, true), []);
    assert.deepEqual(parseGoogleModels(bad), []);
  }
});

test("isChatModelId rejects non-chat modalities and accepts real chat models", () => {
  for (const id of [
    "gpt-5.5",
    "o4-mini",
    "claude-opus-4-8",
    "gemini-3.5-flash",
    "chatgpt-4o-latest",
  ]) {
    assert.equal(isChatModelId(id), true, `${id} should be a chat model`);
  }
  for (const id of [
    "text-embedding-3-large",
    "whisper-1",
    "tts-1-hd",
    "dall-e-3",
    "omni-moderation-latest",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-search-preview",
    "babbage-002",
    "davinci-002",
  ]) {
    assert.equal(isChatModelId(id), false, `${id} should be filtered out`);
  }
});

// --- Qlik Answers assistants roster (WP 0.3) ---------------------------------------------------
// listAvailableModels() is normally thin fetch/pagination glue (untested elsewhere, per the file
// header). qlik_answers gets full coverage here because it must NEVER touch a real tenant — every
// call goes through the injectable `fetchImpl` seam, stubbed with fixtures shaped like the public
// Qlik Answers assistants API (`GET /api/v1/assistants` — verified against the qlik.dev OpenAPI
// spec + the generated `qlik-oss/qlik-api-ts` types).

test("parseQlikAnswersAssistants maps id + name and skips entries without an id", () => {
  const payload = [
    { id: "a1", name: "Sales Assistant", spaceId: "space-1" },
    { id: "a2" }, // no name → displayName undefined
    { name: "no id — dropped" },
    "garbage", // non-object → dropped
  ];
  assert.deepEqual(parseQlikAnswersAssistants(payload), [
    { id: "a1", displayName: "Sales Assistant" },
    { id: "a2", displayName: undefined },
  ]);
});

test("parseQlikAnswersAssistants returns [] for empty / malformed payloads", () => {
  for (const bad of [null, undefined, {}, "nope", 42]) {
    assert.deepEqual(parseQlikAnswersAssistants(bad), []);
  }
});

/** Builds a stub `fetchImpl` from an ordered list of `{ status, body }` responses, one per call. */
function stubFetch(responses: Array<{ status: number; body: unknown }>): FetchLike {
  let call = 0;
  return (async (_url: string | URL, _init?: RequestInit) => {
    const next = responses[call];
    call += 1;
    if (!next) throw new Error("stubFetch called more times than fixtures were provided");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike;
}

test("listAvailableModels(qlik_answers) fetches the roster with a bearer token and maps it", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        data: [
          { id: "a1", name: "Sales Assistant" },
          { id: "a2", name: "Support Assistant" },
        ],
        links: {},
        meta: { countTotal: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  const models = await listAvailableModels(
    { kind: "qlik_answers", baseUrl: "https://mytenant.us.qlikcloud.com", apiKey: "tenant-key" },
    fetchImpl,
  );

  assert.deepEqual(models, [
    { id: "a1", displayName: "Sales Assistant" },
    { id: "a2", displayName: "Support Assistant" },
  ]);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0] ?? "",
    /^https:\/\/mytenant\.us\.qlikcloud\.com\/api\/v1\/assistants\?limit=100$/,
  );
});

test("listAvailableModels(qlik_answers) follows links.next.href across pages and accumulates", async () => {
  const fetchImpl = stubFetch([
    {
      status: 200,
      body: {
        data: [{ id: "a1", name: "Page 1 Assistant" }],
        links: {
          next: {
            href: "https://mytenant.us.qlikcloud.com/api/v1/assistants?limit=100&next=cursor-2",
          },
        },
      },
    },
    {
      status: 200,
      body: {
        data: [{ id: "a2", name: "Page 2 Assistant" }],
        links: {}, // no next → pagination stops
      },
    },
  ]);

  const models = await listAvailableModels(
    { kind: "qlik_answers", baseUrl: "https://mytenant.us.qlikcloud.com", apiKey: "tenant-key" },
    fetchImpl,
  );

  assert.deepEqual(models, [
    { id: "a1", displayName: "Page 1 Assistant" },
    { id: "a2", displayName: "Page 2 Assistant" },
  ]);
});

test("listAvailableModels(qlik_answers) surfaces a 401/403 with a check-the-API-key hint", async () => {
  const fetchImpl = stubFetch([
    { status: 401, body: { errors: [{ code: "AE-3", title: "Unauthorized" }] } },
  ]);

  await assert.rejects(
    () =>
      listAvailableModels(
        { kind: "qlik_answers", baseUrl: "https://mytenant.us.qlikcloud.com", apiKey: "bad-key" },
        fetchImpl,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Qlik Answers returned 401/);
      assert.match(error.message, /check the API key/);
      return true;
    },
  );
});

// H-10 / 06-security-review.md M3 — the roster fetch used to carry an UNGATED
// `console.error("[QA-DEBUG roster]", ...)` (a self-labeled "TEMP DEBUG — REMOVE" leftover) that
// dumped up to 6 KB of the raw tenant assistant payload to stderr on EVERY roster fetch — unlike its
// sibling `qaDebug()` helper, which only logs when `QLIK_ANSWERS_DEBUG` is set. It has been deleted.
// Lock that: a roster fetch must never emit a `console.error` carrying that marker (or, as a stronger
// bar, must never call `console.error` at all when `QLIK_ANSWERS_DEBUG` is unset).
test("listAvailableModels(qlik_answers) never dumps the raw roster to stderr (H-10 debug leftover removed)", async (t) => {
  // Bracket-accessed via a variable (not a literal) key — matches the pattern already used by
  // assistant-env.test.ts's `freshConfig` helper, which the `noDelete`/`useLiteralKeys` lint pair
  // allows for a genuinely dynamic env-var unset/restore (a literal `delete obj.prop` does not).
  const debugEnvKey = "QLIK_ANSWERS_DEBUG";
  const originalDebugEnv = process.env[debugEnvKey];
  delete process.env[debugEnvKey];
  t.after(() => {
    if (originalDebugEnv === undefined) delete process.env[debugEnvKey];
    else process.env[debugEnvKey] = originalDebugEnv;
  });

  const errorCalls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorCalls.push(args);
  });

  const fetchImpl = (async (url: string | URL) => {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "a1",
            name: "Sales Assistant",
            // Exactly the kind of raw tenant metadata H-10 flagged as leaking (knowledgeBases/spaceId).
            spaceId: "space-1",
            knowledgeBases: ["kb-1", "kb-2"],
          },
        ],
        links: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  await listAvailableModels(
    { kind: "qlik_answers", baseUrl: "https://mytenant.us.qlikcloud.com", apiKey: "tenant-key" },
    fetchImpl,
  );

  assert.equal(errorCalls.length, 0, "console.error must not fire at all with QLIK_ANSWERS_DEBUG unset");
  assert.ok(
    !errorCalls.some((args) => String(args[0]).includes("QA-DEBUG roster")),
    "the removed [QA-DEBUG roster] marker must never be logged",
  );
});

test("listAvailableModels(qlik_answers) requires baseUrl and apiKey", async () => {
  const fetchImpl = stubFetch([]);
  await assert.rejects(
    () => listAvailableModels({ kind: "qlik_answers", apiKey: "k" }, fetchImpl),
    /requires a base URL/,
  );
  await assert.rejects(
    () =>
      listAvailableModels(
        { kind: "qlik_answers", baseUrl: "https://mytenant.us.qlikcloud.com" },
        fetchImpl,
      ),
    /has no API key/,
  );
});

// --- Claude subscription roster (roadmap/claude-subscription/, WP 0.3, D-CS5) -------------------
// No REST call, no API key/baseUrl — the roster is the same static ASSISTANT_DEFAULT_MODEL_ROSTER
// the embedded Assistant dock's model picker falls back to. A stub fetchImpl that throws on any
// call proves no network round-trip happens for this kind.

test("listAvailableModels(claude_subscription) returns the Assistant's static roster with no network call", async () => {
  const fetchImpl = (async () => {
    throw new Error("must not be called for claude_subscription");
  }) as FetchLike;

  const models = await listAvailableModels({ kind: "claude_subscription" }, fetchImpl);

  assert.deepEqual(
    models.map((m) => m.id),
    [...ASSISTANT_DEFAULT_MODEL_ROSTER],
  );
  // Every entry is id-only (no displayName/contextWindow fabricated).
  for (const model of models) {
    assert.deepEqual(Object.keys(model), ["id"]);
  }
});

test("listAvailableModels(claude_subscription) needs neither apiKey nor baseUrl", async () => {
  const models = await listAvailableModels({ kind: "claude_subscription" });
  assert.ok(models.length > 0);
});

test("listAvailableModels(claude_subscription) returns the LIVE list from an injected resolver (no network)", async () => {
  const live = [
    { id: "claude-opus-4-8", displayName: "Opus 4.8" },
    { id: "claude-fable-5", displayName: "Fable 5" },
    { id: "claude-sonnet-5", displayName: "Sonnet 5" },
  ];
  const subscriptionModels = { resolve: async () => live };
  const fetchImpl = (async () => {
    throw new Error("must not be called for claude_subscription");
  }) as FetchLike;

  const models = await listAvailableModels({ kind: "claude_subscription" }, fetchImpl, subscriptionModels);

  // The resolver's live roster is passed through verbatim (order + displayName), never the static list.
  assert.deepEqual(models, live);
});
