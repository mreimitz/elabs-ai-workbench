import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSISTANT_DEFAULT_MODEL_ROSTER,
  MODEL_CONTEXT_LIMITS,
  ROSTER_GAP_MODEL_CONTEXT_LIMITS,
  type TokenUsageActual,
} from "@mcp-token-footprint/shared";
import {
  computeCostBreakdown,
  estimateCost,
  isModelPriced,
  MODEL_PRICING,
  ROSTER_GAP_MODEL_PRICING,
  ZERO_PRICE_MODELS,
} from "../src/providers/pricing.js";

// estimateCost mirrors how providers bill prompt caching (four token tiers). `inputTokens` is the
// provider TOTAL and ALREADY includes the cached slice (the AI SDK normalizes it this way), so the
// cached tokens must be subtracted before the full-rate term — otherwise each cached token is billed
// twice (full input rate + cache rate). These lock that math and guard the regression.

const MODEL = "claude-opus-4-8";
const p = MODEL_PRICING[MODEL];
assert.ok(p && p.cachedInPer1M !== undefined, "fixture model must publish a cache-read price");
const CACHE_WRITE_MULTIPLIER = 1.25; // Anthropic 5-min cache write = 1.25× input (mirrors pricing.ts)

test("estimateCost — cache read/write priced in distinct tiers; cached tokens not double-counted", () => {
  // 10_000 total input = 1_000 uncached + 8_000 cache-read + 1_000 cache-write.
  const usage = {
    inputTokens: 10_000,
    outputTokens: 2_000,
    cachedInputTokens: 9_000,
    cacheReadTokens: 8_000,
    cacheWriteTokens: 1_000,
  };
  const expected =
    (1_000 / 1e6) * p.inPer1M + // uncached at full input rate
    (8_000 / 1e6) * p.cachedInPer1M! + // cache read at the discounted read rate
    (1_000 / 1e6) * p.inPer1M * CACHE_WRITE_MULTIPLIER + // cache write at 1.25× input
    (2_000 / 1e6) * p.outPer1M;
  assert.ok(Math.abs(estimateCost(MODEL, usage) - expected) < 1e-12, "four-term cache pricing");
});

test("estimateCost — a cache-read-heavy step is NOT billed at the full input rate (the double-count bug)", () => {
  // 100k total input, almost all cache reads — the shape that inflated cost ~2× before the fix.
  const usage = {
    inputTokens: 100_000,
    outputTokens: 0,
    cachedInputTokens: 99_000,
    cacheReadTokens: 99_000,
    cacheWriteTokens: 0,
  };
  const correct = (1_000 / 1e6) * p.inPer1M + (99_000 / 1e6) * p.cachedInPer1M!;
  const buggy = (100_000 / 1e6) * p.inPer1M + (99_000 / 1e6) * p.cachedInPer1M!; // old: full total + cached again
  assert.ok(
    Math.abs(estimateCost(MODEL, usage) - correct) < 1e-12,
    "only the uncached slice at full rate",
  );
  assert.ok(estimateCost(MODEL, usage) < buggy, "far below the old double-counted cost");
});

test("estimateCost — no cache activity reduces to input×in + output×out", () => {
  const usage = { inputTokens: 1_000, outputTokens: 500 };
  const expected = (1_000 / 1e6) * p.inPer1M + (500 / 1e6) * p.outPer1M;
  assert.equal(estimateCost(MODEL, usage), expected);
});

test("estimateCost — legacy merged cachedInputTokens (no split) is treated as all cache-read", () => {
  const split = estimateCost(MODEL, {
    inputTokens: 10_000,
    outputTokens: 0,
    cacheReadTokens: 8_000,
    cacheWriteTokens: 0,
    cachedInputTokens: 8_000,
  });
  const mergedOnly = estimateCost(MODEL, {
    inputTokens: 10_000,
    outputTokens: 0,
    cachedInputTokens: 8_000,
  });
  assert.equal(mergedOnly, split, "merged-only usage prices identically to an all-read split");
});

test("estimateCost — unknown model contributes 0 (never crashes the run / trips the spend cap)", () => {
  assert.equal(
    estimateCost("totally-unknown-model", { inputTokens: 1_000, outputTokens: 1_000 }),
    0,
  );
});

test("isModelPriced — distinguishes a genuinely unknown model from a priced/zero-price one (issue #10)", () => {
  // A model with a real per-token rate is priced.
  assert.equal(isModelPriced(MODEL), true, "a priced model is known");
  // Local/free models on the explicit zero-price allowlist are KNOWN (cost 0 by design, not unknown).
  for (const local of ZERO_PRICE_MODELS) {
    assert.equal(
      isModelPriced(local),
      true,
      `${local} is an explicit zero-price (known-free) model`,
    );
    assert.equal(
      estimateCost(local, { inputTokens: 1_000, outputTokens: 1_000 }),
      0,
      `${local} costs 0`,
    );
  }
  // A model with NO pricing entry is unknown — even though estimateCost also returns 0 for it.
  assert.equal(isModelPriced("no-such-model-9000"), false, "an unpriced model is reported unknown");
});

// --- D-MI11 (planning/Roadmap/RM-16-model-identity/) — every roster model must be priced AND have a context window.
//
// The owner's failing Hub session ran on `claude-sonnet-5`, which was absent from BOTH
// `MODEL_CONTEXT_LIMITS` and `MODEL_PRICING`: the research dataset snapshot (as-of 2026-06-21)
// predates it. That is not cosmetic — an unknown model resolves to a context window of `0` (which
// disables compaction) and to no price at all (which makes `isModelPriced()` false, so a cost-capped
// run is refused, and `estimateCost()` returns 0, so a mission's auto-approve compares against $0).
//
// WHAT THESE CAN AND CANNOT CATCH — corrected by model-identity WP6.1 (F6). The original comment here
// claimed they "lock the invariant so the gap cannot silently reopen when a new model joins the
// roster". **They cannot, and it was wrong to say so.** These iterate the STATIC
// `ASSISTANT_DEFAULT_MODEL_ROSTER` (4 ids) plus one hardcoded 3-id list, while the LIVE roster comes
// from the SDK (`providers/subscription-models.ts` `mapModels` → `model.resolvedModel`) and never
// joins that constant. An id that does not exist yet cannot be asserted about by any test.
//
// So the coverage is split three ways, honestly:
//   • these tests lock the ids we KNOW about today (a regression if someone deletes an entry);
//   • the cross-check below catches the realistic DRIFT mode — an id added to one gap map and
//     forgotten in the other (`claude-sonnet-5` was missing from BOTH, and half-adding is the likely
//     next failure);
//   • a genuinely NEW SDK id is caught at RUNTIME, not here: `createHubModelResolver`
//     (`hub/routes.ts`) now emits a structured `log.warn` the first time it resolves a model with no
//     known context window, naming the id and what to do about it.
// The fix for any of them is to add the id to `ROSTER_GAP_MODEL_{CONTEXT_LIMITS,PRICING}` (or refresh
// the dataset and regenerate), never to relax an assertion.

test("D-MI11 — every ASSISTANT_DEFAULT_MODEL_ROSTER model has a positive context window", () => {
  for (const model of ASSISTANT_DEFAULT_MODEL_ROSTER) {
    const window = MODEL_CONTEXT_LIMITS[model];
    assert.ok(
      typeof window === "number" && window > 0,
      `roster model "${model}" has no context window (resolves to ${String(window)}) — a 0-token ` +
        "window disables compaction and makes every context-usage surface meaningless",
    );
  }
});

test("D-MI11 — every ASSISTANT_DEFAULT_MODEL_ROSTER model is priced", () => {
  for (const model of ASSISTANT_DEFAULT_MODEL_ROSTER) {
    assert.ok(
      isModelPriced(model),
      `roster model "${model}" is unpriced — a cost-capped run on it is refused, and estimateCost() ` +
        "silently returns 0",
    );
  }
});

// The three ids the signed-in Claude subscription actually reports (verified against the live
// instance 2026-07-27). They are byte-identical to Anthropic API model ids — which is the root cause
// of the model-identity defect — so they must resolve on BOTH paths.
test("D-MI11 — the live Claude-subscription roster ids resolve to a window and a price", () => {
  for (const model of ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"]) {
    const window = MODEL_CONTEXT_LIMITS[model];
    assert.ok(typeof window === "number" && window > 0, `subscription model "${model}": no window`);
    assert.ok(isModelPriced(model), `subscription model "${model}": unpriced`);
  }
});

// model-identity WP6.1 (F6) — the guard that catches the REALISTIC drift: the two hand-maintained gap
// maps live in different packages (`packages/shared/src/constants.ts` and `apps/api/src/providers/
// pricing.ts`) with nothing tying them together, so adding a newly-reported roster id to one and
// forgetting the other is a single-keystroke mistake. It is also exactly half of the owner's original
// defect — `claude-sonnet-5` was missing from BOTH — and the half-missing case is strictly harder to
// notice, because the surface that breaks (compaction, or the cost cap) is not the one you edited.
//
// This is NOT circular with the tests above: neither map is asserted against itself. Each is asserted
// against the OTHER lookup, which is what actually has to agree.
test("D-MI11 — the two roster-gap maps agree: every gap-priced id has a window, and vice versa", () => {
  for (const model of Object.keys(ROSTER_GAP_MODEL_PRICING)) {
    const window = MODEL_CONTEXT_LIMITS[model];
    assert.ok(
      typeof window === "number" && window > 0,
      `"${model}" was added to ROSTER_GAP_MODEL_PRICING but has no context window — a 0-token window ` +
        "disables compaction. Add it to ROSTER_GAP_MODEL_CONTEXT_LIMITS too (packages/shared).",
    );
  }
  for (const model of Object.keys(ROSTER_GAP_MODEL_CONTEXT_LIMITS)) {
    assert.ok(
      isModelPriced(model),
      `"${model}" was added to ROSTER_GAP_MODEL_CONTEXT_LIMITS but is unpriced — a cost-capped run on ` +
        "it is refused and estimateCost() returns 0. Add it to ROSTER_GAP_MODEL_PRICING too.",
    );
  }
});

// ── RM-33 WP 1.1 (D-CT5) — one pricing code path ────────────────────────────────────────────────
//
// `estimateCost` is now a thin caller of `computeCostBreakdown`. The whole point of the extraction is
// that the headline cost and its breakdown can never disagree — so THIS is the tooth. If someone
// later "optimizes" estimateCost back into its own arithmetic, or adds a term to one and not the
// other, these go red.

const BREAKDOWN_CASES: Array<{ label: string; model: string; usage: TokenUsageActual }> = [
  {
    label: "exact split (read + write)",
    model: MODEL,
    usage: {
      inputTokens: 100_000,
      outputTokens: 2_000,
      cachedInputTokens: 90_000,
      cacheReadTokens: 80_000,
      cacheWriteTokens: 10_000,
    },
  },
  {
    label: "read-only split",
    model: MODEL,
    usage: { inputTokens: 50_000, outputTokens: 500, cacheReadTokens: 49_999 },
  },
  {
    label: "write-heavy split (a PREMIUM, not a discount)",
    model: MODEL,
    usage: { inputTokens: 40_000, outputTokens: 100, cacheWriteTokens: 40_000 },
  },
  {
    label: "merged legacy record (priced entirely as cache-read)",
    model: MODEL,
    usage: { inputTokens: 30_000, outputTokens: 300, cachedInputTokens: 25_000 },
  },
  { label: "no cache at all", model: MODEL, usage: { inputTokens: 1_000, outputTokens: 200 } },
  { label: "zero input", model: MODEL, usage: { inputTokens: 0, outputTokens: 0 } },
  {
    label: "unpriced model",
    model: "totally-made-up-model-id",
    usage: { inputTokens: 10_000, outputTokens: 100, cacheReadTokens: 9_000 },
  },
  {
    label: "explicitly zero-priced local model",
    model: ZERO_PRICE_MODELS[0] as string,
    usage: { inputTokens: 10_000, outputTokens: 100, cacheReadTokens: 9_000 },
  },
];

test("D-CT5 — computeCostBreakdown().totalUsd IS estimateCost(), for every record shape", () => {
  for (const { label, model, usage } of BREAKDOWN_CASES) {
    const breakdown = computeCostBreakdown(model, usage);
    assert.equal(
      breakdown.totalUsd,
      estimateCost(model, usage),
      `${label}: the breakdown total and the headline cost diverged — there are now two cost formulas`,
    );
    assert.equal(
      breakdown.uncachedUsd + breakdown.cacheReadUsd + breakdown.cacheWriteUsd + breakdown.outputUsd,
      breakdown.totalUsd,
      `${label}: the four terms do not re-sum to the total`,
    );
  }
});

test("D-CT5 — the breakdown reports the split fidelity it priced under", () => {
  assert.equal(
    computeCostBreakdown(MODEL, {
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 50,
    }).split,
    "exact",
  );
  assert.equal(
    computeCostBreakdown(MODEL, {
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 50,
    }).split,
    "merged",
  );
  assert.equal(computeCostBreakdown(MODEL, { inputTokens: 100, outputTokens: 0 }).split, "none");
});

test("D-CT5 — `priced` separates 'cannot price it' from 'genuinely free'", () => {
  const usage: TokenUsageActual = { inputTokens: 10_000, outputTokens: 100 };
  const unknown = computeCostBreakdown("totally-made-up-model-id", usage);
  assert.equal(unknown.totalUsd, 0);
  assert.equal(unknown.priced, false, "an unpriced model must not look like a free one");

  const free = computeCostBreakdown(ZERO_PRICE_MODELS[0] as string, usage);
  assert.equal(free.totalUsd, 0);
  assert.equal(free.priced, true, "an explicitly zero-priced local model IS priced");
  // ...and both agree with the standalone signal the spend cap reads.
  assert.equal(unknown.priced, isModelPriced("totally-made-up-model-id"));
  assert.equal(free.priced, isModelPriced(ZERO_PRICE_MODELS[0] as string));
});

test("D-CT2 — savedVsUncachedUsd is POSITIVE when cache reads dominate", () => {
  const b = computeCostBreakdown(MODEL, {
    inputTokens: 100_000,
    outputTokens: 1_000,
    cacheReadTokens: 99_000,
  });
  assert.ok(
    b.savedVsUncachedUsd > 0,
    `cache reads are a ~0.1x discount, so this must be a real saving (got ${b.savedVsUncachedUsd})`,
  );
});

test("D-CT2 — savedVsUncachedUsd goes NEGATIVE when cache writes dominate", () => {
  // The whole reason the field is signed. A cache WRITE costs 1.25x the input rate, so a turn that
  // only writes the cache genuinely spent MORE than the same tokens uncached. A surface that renders
  // this as "savings" without the sign is presenting a premium as a discount — and the merged
  // "cached tokens" number every pre-RM-33 screen showed did exactly that.
  const b = computeCostBreakdown(MODEL, {
    inputTokens: 100_000,
    outputTokens: 0,
    cacheWriteTokens: 100_000,
  });
  assert.ok(
    b.savedVsUncachedUsd < 0,
    `a fully cache-WRITE turn costs more than uncached (got ${b.savedVsUncachedUsd})`,
  );
  // And the magnitude is exactly the 0.25x premium on the whole input.
  assert.ok(
    Math.abs(b.savedVsUncachedUsd + (100_000 / 1e6) * p.inPer1M * (CACHE_WRITE_MULTIPLIER - 1)) <
      1e-9,
  );
});

test("D-CT2 — a merged record is priced as READ, and says so", () => {
  // The only safe reading of one merged number: attribute it all to the cheap side is WRONG for cost
  // (it under-reports), attributing it to the expensive side is wrong the other way. The app keeps
  // the historical read assumption — but `split: "merged"` is what lets a surface refuse to imply a
  // precision it does not have.
  const merged = computeCostBreakdown(MODEL, {
    inputTokens: 100_000,
    outputTokens: 0,
    cachedInputTokens: 100_000,
  });
  const asRead = computeCostBreakdown(MODEL, {
    inputTokens: 100_000,
    outputTokens: 0,
    cacheReadTokens: 100_000,
  });
  assert.equal(merged.totalUsd, asRead.totalUsd);
  assert.equal(merged.cacheWriteUsd, 0);
  assert.equal(merged.split, "merged");
  assert.equal(asRead.split, "exact");
});
