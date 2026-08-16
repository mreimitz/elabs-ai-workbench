import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// Smoke test for the Vercel AI SDK spine (WP 0.2): exercises generateText against
// Anthropic and asserts a non-empty result plus populated usage. Skips cleanly when
// no ANTHROPIC_API_KEY is set so CI without a key passes (no live call is made).
test("AI SDK generateText returns text and usage from Anthropic", async () => {
  if (!process.env.ANTHROPIC_API_KEY) return;

  const result = await generateText({
    model: anthropic("claude-opus-4-8"),
    prompt: "Reply with the single word: pong",
  });

  assert.equal(typeof result.text, "string");
  assert.ok(result.text.trim().length > 0, "expected non-empty result text");

  assert.ok(result.usage, "expected a populated usage object");
  assert.equal(typeof result.usage.totalTokens, "number");
  assert.ok((result.usage.totalTokens ?? 0) > 0, "expected usage.totalTokens > 0");
});
