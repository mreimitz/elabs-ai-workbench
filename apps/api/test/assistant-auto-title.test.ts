import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSISTANT_TITLE_MAX_LENGTH } from "@mcp-token-footprint/shared";
import { buildTitlePrompt, deterministicTitle } from "../src/assistant/auto-title.js";

// R2.2 (D-AS26) — the deterministic title slug is PURE (no DB/SDK/network), so it is unit-tested here
// directly: trim, whitespace-collapse, sentence-ish prefix, truncation with a real ellipsis, empties,
// and non-ASCII preservation. This slug is BOTH the instant first-message title AND the guaranteed
// floor the best-effort LLM refine silently falls back to.

test("deterministicTitle trims leading/trailing whitespace", () => {
  assert.equal(deterministicTitle("   hello world   "), "hello world");
});

test("deterministicTitle collapses ALL internal whitespace (newlines/tabs/runs) to single spaces", () => {
  assert.equal(deterministicTitle("a\n\n  b\t c"), "a b c");
  assert.equal(deterministicTitle("one   two\tthree\nfour"), "one two three four");
});

test("deterministicTitle returns an empty string for empty / whitespace-only input", () => {
  assert.equal(deterministicTitle(""), "");
  assert.equal(deterministicTitle("   \n\t  "), "");
});

test("deterministicTitle prefers a short leading sentence when the message opens with one", () => {
  assert.equal(deterministicTitle("Do this. Then that."), "Do this.");
  assert.equal(
    deterministicTitle("What tools does it expose? And how many?"),
    "What tools does it expose?",
  );
  assert.equal(deterministicTitle("Stop! Wait a moment."), "Stop!");
});

test("deterministicTitle keeps a message that has no sentence terminator and fits under the cap", () => {
  assert.equal(deterministicTitle("compare two servers"), "compare two servers");
});

test("deterministicTitle caps at the max length with a REAL ellipsis on truncation", () => {
  const long =
    "This is a really long first message that keeps going on well beyond the sixty character cap for titles";
  const title = deterministicTitle(long);
  assert.ok(
    title.length <= ASSISTANT_TITLE_MAX_LENGTH,
    `"${title}" (${title.length}) must be <= ${ASSISTANT_TITLE_MAX_LENGTH}`,
  );
  assert.ok(title.endsWith("…"), "a truncated title ends with a single-character ellipsis");
  assert.ok(!title.includes("..."), "it uses the real ellipsis, not three dots");
});

test("deterministicTitle truncates a single over-long token without a word boundary", () => {
  const token = "x".repeat(ASSISTANT_TITLE_MAX_LENGTH + 5);
  const title = deterministicTitle(token);
  assert.equal(
    title.length,
    ASSISTANT_TITLE_MAX_LENGTH,
    "fills exactly to the cap (chars + ellipsis)",
  );
  assert.ok(title.endsWith("…"));
});

test("deterministicTitle returns a string exactly at the cap unchanged (no ellipsis)", () => {
  const exact = "y".repeat(ASSISTANT_TITLE_MAX_LENGTH);
  assert.equal(deterministicTitle(exact), exact);
});

test("deterministicTitle preserves non-ASCII characters", () => {
  assert.equal(deterministicTitle("  café ☕ münchen  "), "café ☕ münchen");
});

test("deterministicTitle honors a custom maxLength", () => {
  const title = deterministicTitle("alpha beta gamma delta epsilon", 12);
  assert.ok(title.length <= 12, `"${title}" must be <= 12`);
  assert.ok(title.endsWith("…"));
});

test("buildTitlePrompt includes both the user message and the assistant reply, clipped", () => {
  const prompt = buildTitlePrompt("  the   user   asked  ", "the\nassistant\nreplied");
  assert.match(
    prompt,
    /User: the user asked/,
    "the user message is whitespace-collapsed into the prompt",
  );
  assert.match(
    prompt,
    /Assistant: the assistant replied/,
    "the assistant reply is whitespace-collapsed into the prompt",
  );
  assert.match(prompt, /max 6 words/, "the instruction bounds the title length");
});

test("buildTitlePrompt clips very long inputs so the refine stays cheap", () => {
  const huge = "word ".repeat(400); // ~2000 chars
  const prompt = buildTitlePrompt(huge, huge);
  // Each side is clipped to <= 500 chars, so the whole prompt stays well under the raw input size.
  assert.ok(
    prompt.length < 1400,
    `prompt length ${prompt.length} should be bounded by the per-side clip`,
  );
});
