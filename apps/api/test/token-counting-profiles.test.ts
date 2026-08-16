import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import {
  toClaudeStyleTool,
  toGeminiDeclarationTool,
  toOpenAIStyleTool,
  toRawMcpTool,
} from "../src/token-counting/provider-shapes.js";

// EXTENDS token-counting.test.ts (#8 golden BPE) — covers the two HEURISTIC profiles' golden text
// counts and the per-PROVIDER-shape envelope, on a fixed tool fixture. No network (heuristics are
// pure; tiktoken ranks are bundled offline).

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

// ── Golden heuristic text counts (derived by hand from countTextEstimate in profiles.ts) ─────────

test("raw_json_rough is bytes/4 (rounded up), min 1, 0 for empty", async () => {
  const counter = getTokenCounter("raw_json_rough");
  assert.equal(await counter.countText(""), 0);
  assert.equal(await counter.countText("search"), 2); // ceil(6 / 4)
  assert.equal(await counter.countText("hello world"), 3); // ceil(11 / 4)
});

test("generic_estimate blends a byte-length and a lexical/punctuation structure estimate", async () => {
  const counter = getTokenCounter("generic_estimate");
  assert.equal(await counter.countText(""), 0);
  // "search": length=ceil(6/4.05)=2, structure=ceil(1 word)=1 → max=2.
  assert.equal(await counter.countText("search"), 2);
  // "hello world": length=ceil(11/4.05)=3, structure=ceil(2 words)=2 → max=3.
  assert.equal(await counter.countText("hello world"), 3);
});

test("the two heuristic names are distinct counters and differ from the real BPE on the tool", async () => {
  const estimate = await getTokenCounter("generic_estimate").countToolDefinition(TOOL);
  const rough = await getTokenCounter("raw_json_rough").countToolDefinition(TOOL);
  const bpe = await getTokenCounter("generic_o200k").countToolDefinition(TOOL);
  assert.ok(estimate.totalTokens > 0 && rough.totalTokens > 0);
  assert.notEqual(estimate.totalTokens, bpe.totalTokens);
  assert.notEqual(rough.totalTokens, bpe.totalTokens);
});

// ── Serialized payload > naive facet sum, for EVERY profile ──────────────────────────────────────

test("headline (raw-shape) total exceeds the naive field sum for every profile", async () => {
  for (const profile of TOKEN_PROFILES) {
    const b = await getTokenCounter(profile).countToolDefinition(TOOL);
    const facetSum = b.nameTokens + b.descriptionTokens + b.schemaTokens + b.annotationsTokens;
    assert.ok(
      b.totalTokens > facetSum,
      `${profile}: serialized total ${b.totalTokens} should exceed facet sum ${facetSum} (JSON keys/braces/envelope)`,
    );
  }
});

// ── Provider-shape envelopes change the count ────────────────────────────────────────────────────

test("provider shapes serialize distinct envelopes (openai/anthropic/gemini/raw)", () => {
  const openai = toOpenAIStyleTool(TOOL) as { type: string; function: { name: string } };
  const anthropic = toClaudeStyleTool(TOOL) as { input_schema: unknown };
  const gemini = toGeminiDeclarationTool(TOOL) as { parameters: unknown };
  const raw = toRawMcpTool(TOOL);

  assert.equal(openai.type, "function");
  assert.equal(openai.function.name, "search_documents");
  assert.ok("input_schema" in anthropic, "claude shape renames inputSchema → input_schema");
  assert.ok("parameters" in gemini, "gemini shape renames inputSchema → parameters");
  assert.equal(raw, TOOL.raw);
});

test("countToolDefinition routes each provider shape to a different serialized total", async () => {
  const counter = getTokenCounter("generic_o200k");
  const raw = (await counter.countToolDefinition(TOOL)).totalTokens;
  const openai = (await counter.countToolDefinition(TOOL, "openai_function")).totalTokens;
  const anthropic = (await counter.countToolDefinition(TOOL, "anthropic_tool")).totalTokens;
  const gemini = (await counter.countToolDefinition(TOOL, "gemini_declaration")).totalTokens;

  // Each provider shape re-serializes the tool under a DIFFERENT envelope (the raw MCP shape keeps
  // `annotations`; openai adds a `{ type, function }` wrapper; anthropic uses `input_schema`; gemini
  // uses `parameters`), so the selected shape changes the counted total — they are not collapsed to
  // one number.
  assert.notEqual(openai, raw, "openai envelope differs from the raw MCP shape");
  assert.ok(
    new Set([raw, openai, anthropic, gemini]).size >= 3,
    "shapes are not collapsed to one count",
  );
});
