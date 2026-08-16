import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { TOKEN_COUNTING_VERSION, TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import { getTokenCounter, listTokenCounters } from "../src/token-counting/profiles.js";

// Token-counting correctness (#8). These are GOLDEN tests: the expected token counts are the real
// js-tiktoken BPE counts for the fixed fixture below, derived by encoding the SERIALIZED tool object
// with the bundled `o200k_base` / `cl100k_base` rank tables (no network — js-tiktoken ships the ranks
// via its `ranks/*` subpath imports, so counting works fully offline). Re-derive after a deliberate
// counting change by encoding `stableStringify(TOOL.raw)` with the matching encoding.

const TOOL: NormalizedToolDefinition = {
  name: "search_documents",
  description: "Search the knowledge base for documents matching a query string.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      limit: { type: "integer", description: "Max results to return.", default: 10 },
    },
    required: ["query"],
  },
  annotations: { readOnlyHint: true, title: "Search Documents" },
  raw: {
    name: "search_documents",
    description: "Search the knowledge base for documents matching a query string.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        limit: { type: "integer", description: "Max results to return.", default: 10 },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, title: "Search Documents" },
  },
};

// --- Golden BPE counts (serialized raw-MCP tool object) --------------------------------------

test("generic_o200k is the real o200k_base BPE — golden count for the fixture", async () => {
  const counter = getTokenCounter("generic_o200k");
  const breakdown = await counter.countToolDefinition(TOOL);
  // 79 = js-tiktoken o200k_base encode of stableStringify(TOOL.raw) (378 bytes).
  assert.equal(breakdown.totalTokens, 79);
  assert.equal(breakdown.nameTokens, 2);
  assert.equal(breakdown.descriptionTokens, 11);
  assert.equal(breakdown.schemaTokens, 43);
  assert.equal(breakdown.annotationsTokens, 12);
  assert.equal(breakdown.rawBytes, 378);
});

test("generic_cl100k is the real cl100k_base BPE — golden count for the fixture", async () => {
  const counter = getTokenCounter("generic_cl100k");
  const breakdown = await counter.countToolDefinition(TOOL);
  // 74 = js-tiktoken cl100k_base encode of stableStringify(TOOL.raw). Differs from o200k (79),
  // proving the two encoding profiles are genuinely distinct real tokenizers, not one shared estimate.
  assert.equal(breakdown.totalTokens, 74);
  assert.equal(breakdown.schemaTokens, 41);
  assert.equal(breakdown.annotationsTokens, 11);
});

test("real BPE counts differ from the heuristic (encoding names are not estimates)", async () => {
  // A real tokenizer merges "hello world" into 2 tokens; the byte/lexical heuristic over-counts to 3.
  assert.equal(await getTokenCounter("generic_o200k").countText("hello world"), 2);
  assert.equal(await getTokenCounter("generic_cl100k").countText("hello world"), 2);
  assert.equal(await getTokenCounter("generic_estimate").countText("hello world"), 3);
});

// --- Serialized payload > naive sum-of-fields (envelope + JSON structure) ---------------------

test("headline tool total counts the SERIALIZED payload, exceeding the naive field sum", async () => {
  for (const profile of ["generic_o200k", "generic_cl100k"] as const) {
    const b = await getTokenCounter(profile).countToolDefinition(TOOL);
    const naiveSum = b.nameTokens + b.descriptionTokens + b.schemaTokens + b.annotationsTokens;
    assert.ok(
      b.totalTokens > naiveSum,
      `${profile}: serialized total ${b.totalTokens} must exceed field sum ${naiveSum} (JSON keys/braces + envelope)`,
    );
  }
});

// --- Provider-shape serialization is the single, live path ------------------------------------

test("countToolDefinition routes through the provider-shape adapter (envelope changes the count)", async () => {
  const counter = getTokenCounter("generic_o200k");
  const raw = await counter.countToolDefinition(TOOL); // default: raw MCP shape
  const openai = await counter.countToolDefinition(TOOL, "openai_function");
  const anthropic = await counter.countToolDefinition(TOOL, "anthropic_tool");
  // Each provider wraps the tool differently, so the serialized token total is shape-dependent —
  // the same serialization path the compatibility recount uses (no dead adapters).
  assert.notEqual(raw.totalTokens, openai.totalTokens);
  assert.notEqual(openai.totalTokens, anthropic.totalTokens);
  // The per-field facets are shape-independent (they count isolated fields, not the envelope).
  assert.equal(raw.nameTokens, openai.nameTokens);
  assert.equal(raw.schemaTokens, anthropic.schemaTokens);
});

// --- Profile registry -------------------------------------------------------------------------

test("every token profile resolves to a counter and none named after an encoding is a heuristic", () => {
  assert.deepEqual(
    TOKEN_PROFILES.slice().sort(),
    ["generic_cl100k", "generic_estimate", "generic_o200k", "raw_json_rough"].sort(),
  );
  const counters = listTokenCounters();
  assert.equal(counters.length, TOKEN_PROFILES.length);
  // The encoding-named profiles advertise the real tiktoken encoding in their label.
  assert.match(getTokenCounter("generic_o200k").label, /o200k_base/);
  assert.match(getTokenCounter("generic_cl100k").label, /cl100k_base/);
});

test("counting version is a positive integer (stamped onto scans for change detection)", () => {
  assert.equal(Number.isInteger(TOKEN_COUNTING_VERSION), true);
  assert.ok(TOKEN_COUNTING_VERSION >= 2);
});
