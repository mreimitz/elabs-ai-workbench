// RM-33 WP 1.1 — the pure cache helpers over a TokenUsageActual record.
//
// The load-bearing property under test is D-CT6: a helper that cannot answer returns `null`, NEVER
// `0`. Before RM-33 the app had no shared reading of an absent cache split, so "this run had no
// cache" and "we don't know whether this run had cache" rendered identically — which is the exact
// confusion the workstream exists to remove.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheHitRate, usageInputSlices, usageSplitKind } from "./token-usage.js";
import type { TokenUsageActual } from "./types.js";

const exact: TokenUsageActual = {
  inputTokens: 1000,
  outputTokens: 100,
  cachedInputTokens: 900,
  cacheReadTokens: 800,
  cacheWriteTokens: 100,
};
const merged: TokenUsageActual = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900 };
const none: TokenUsageActual = { inputTokens: 1000, outputTokens: 100 };

// ── usageSplitKind ───────────────────────────────────────────────────────────────────────────────

test("usageSplitKind classifies the three record fidelities", () => {
  assert.equal(usageSplitKind(exact), "exact");
  assert.equal(usageSplitKind(merged), "merged");
  assert.equal(usageSplitKind(none), "none");
});

test("usageSplitKind treats one reported half as an exact split, not an unknown one", () => {
  // A provider saying "800 read" with no write key means "nothing was written", not "unknown".
  // This mirrors the `hasSplit` test the pricing function has always used — if the two ever disagree,
  // a record would be PRICED as an exact split while being DISPLAYED as a merged one.
  assert.equal(usageSplitKind({ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 800 }), "exact");
  assert.equal(
    usageSplitKind({ inputTokens: 1000, outputTokens: 0, cacheWriteTokens: 200 }),
    "exact",
  );
});

test("usageSplitKind: a merged ZERO is not a merged record", () => {
  // `cachedInputTokens: 0` is a positive statement that nothing was cached — the split is knowable
  // (it is nothing), so this must not degrade to the lossy "merged" mode.
  assert.equal(usageSplitKind({ inputTokens: 1000, outputTokens: 0, cachedInputTokens: 0 }), "none");
});

// ── cacheHitRate ─────────────────────────────────────────────────────────────────────────────────

test("cacheHitRate returns the cache-READ share of gross input", () => {
  // 800 of 1000 gross input were reads. The 100 cache-WRITE tokens are deliberately NOT in the
  // numerator: a write is a 1.25x premium, and counting it as a "hit" would overstate the benefit.
  assert.equal(cacheHitRate(exact), 0.8);
});

test("cacheHitRate returns null — not 0 — for a merged record (D-CT6)", () => {
  assert.equal(cacheHitRate(merged), null);
});

test("cacheHitRate returns null — not 0 — when there is no input to take a share of", () => {
  assert.equal(cacheHitRate({ inputTokens: 0, outputTokens: 50 }), null);
});

test("cacheHitRate returns a real 0 when we KNOW there was no cache", () => {
  // The one case where 0 is the honest answer, and it must be distinguishable from the nulls above.
  assert.equal(cacheHitRate(none), 0);
});

test("cacheHitRate clamps a provider reporting more cache than input", () => {
  const nonsense: TokenUsageActual = { inputTokens: 100, outputTokens: 0, cacheReadTokens: 500 };
  assert.equal(cacheHitRate(nonsense), 1);
});

// ── usageInputSlices ─────────────────────────────────────────────────────────────────────────────

test("usageInputSlices decomposes gross input into three mutually exclusive slices", () => {
  const slices = usageInputSlices(exact);
  assert.deepEqual(slices, { uncached: 100, cacheRead: 800, cacheWrite: 100 });
  // The slices must re-sum to the GROSS figure — D-CT1: nothing is subtracted from `inputTokens`.
  assert.equal(
    (slices?.uncached ?? 0) + (slices?.cacheRead ?? 0) + (slices?.cacheWrite ?? 0),
    exact.inputTokens,
  );
});

test("usageInputSlices refuses to fabricate a decomposition for a merged record", () => {
  // Guessing here would paint a cache WRITE as a cache READ — a premium rendered as a discount.
  assert.equal(usageInputSlices(merged), null);
});

test("usageInputSlices gives a no-cache record its whole input as uncached", () => {
  assert.deepEqual(usageInputSlices(none), { uncached: 1000, cacheRead: 0, cacheWrite: 0 });
});

test("usageInputSlices clamps `uncached` at zero on a nonsensical provider report", () => {
  const slices = usageInputSlices({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 500 });
  assert.equal(slices?.uncached, 0);
});
