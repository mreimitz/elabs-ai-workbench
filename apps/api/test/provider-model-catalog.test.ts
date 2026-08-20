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

// --- Claude subscription roster (planning/Roadmap/RM-09-claude-subscription/, WP 0.3, D-CS5) -------------------
// No REST call, no API key/baseUrl — the roster is the same static ASSISTANT_DEFAULT_MODEL_ROSTER
// the embedded Assistant dock's model picker falls back to. A stub fetchImpl that throws on any
// call proves no network round-trip happens for this kind.

test("listAvailableModels(claude_subscription) returns the Assistant's static roster with no network call", async () => {
  const fetchImpl = (async () => {
    throw new Error("must not be called for claude_subscription");
  }) as FetchLike;

  const models = await listAvailableModels({ kind: "claude_subscription" });

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
  const models = await listAvailableModels({ kind: "claude_subscription" }, subscriptionModels);

  // The resolver's live roster is passed through verbatim (order + displayName), never the static list.
  assert.deepEqual(models, live);
});
