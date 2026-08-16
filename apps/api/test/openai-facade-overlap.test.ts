// assistant-hub v1-fixes (F8) — the Qlik answer-stream OVERLAP GUARD. Observed tenant streams re-sent
// the tail of the previous frame at the head of the next one; verbatim accumulation turned that into
// mid-word duplication in settled hub messages ("visualizations:izations:izations:"). The guard drops
// a replicated head of >= MIN_ANSWER_OVERLAP chars and leaves legitimate short repetition alone.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dropStreamOverlap, MIN_ANSWER_OVERLAP } from "../src/openai-facade/qlik-call.js";

test("a frame that re-sends the previous tail is deduplicated (the observed 'izations:' shape)", () => {
  const existing = "Now I'll build these expressions and create the visualizations:";
  assert.equal(dropStreamOverlap(existing, "izations: Let me extract"), " Let me extract");
});

test("a frame that re-sends a whole sentence tail is deduplicated", () => {
  const existing = "The documentation returned no substantive content. ";
  assert.equal(
    dropStreamOverlap(existing, "substantive content. Structured data was retrieved."),
    "Structured data was retrieved.",
  );
});

test("legitimate short repetition survives (below the overlap threshold)", () => {
  assert.equal(dropStreamOverlap("no no", " no"), " no");
  assert.ok(MIN_ANSWER_OVERLAP > 3);
});

test("no overlap appends verbatim; empty incoming appends nothing", () => {
  assert.equal(dropStreamOverlap("hello ", "world"), "world");
  assert.equal(dropStreamOverlap("hello", ""), "");
  assert.equal(dropStreamOverlap("", "fresh start of a stream"), "fresh start of a stream");
});
