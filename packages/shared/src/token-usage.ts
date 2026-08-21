// RM-33 — pure helpers over a {@link TokenUsageActual} record.
//
// These exist so that no surface re-derives "how much of this was cache" for itself. Before RM-33 the
// only cache-aware derivations in the app lived in `apps/web/.../analytics-derive.ts` and in the
// pricing function — three separate readings of the same record, none of which agreed about what an
// ABSENT split meant.
//
// Two rules govern everything here, and both are load-bearing:
//
//  - **D-CT1 — `inputTokens` is GROSS.** It already includes the cached slice (the AI SDK normalizes
//    Anthropic / OpenAI / Gemini this way: `inputTokens = noCache + cacheRead + cacheWrite`). Nothing
//    in this module subtracts from it or redefines it.
//  - **D-CT6 — absent is UNKNOWN, never zero.** A helper that cannot answer returns `null`. Returning
//    `0` would make "this run had no cache" indistinguishable from "we do not know", which is exactly
//    the confusion this workstream exists to remove.

import type { CostBreakdownSplit, TokenUsageActual } from "./types.js";

/**
 * How faithfully this record can answer read-vs-write. See {@link CostBreakdownSplit}.
 *
 * A record counts as `"exact"` when the provider reported EITHER half of the split — reporting
 * `cacheReadTokens: 900` with no `cacheWriteTokens` means "900 read, nothing written", not "the split
 * is unknown". This mirrors the `hasSplit` test the pricing function has always used, so the two can
 * never disagree about which record is which.
 */
export function usageSplitKind(usage: TokenUsageActual): CostBreakdownSplit {
  if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) return "exact";
  if (usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0) return "merged";
  return "none";
}

/**
 * The cache-READ share of the provider-billed input, as a fraction in `[0, 1]`.
 *
 * `null` — meaning "cannot be known", never "zero" — when:
 *   - there is no input to take a share of (`inputTokens <= 0`), or
 *   - the record is `"merged"`: one number cannot say how much of it was a read, and guessing would
 *     present a cache WRITE (a 1.25x premium) as if it were a cache READ (a 0.1x discount).
 *
 * A `"none"` record legitimately returns `0` — we know there was no cache.
 */
export function cacheHitRate(usage: TokenUsageActual): number | null {
  if (usage.inputTokens <= 0) return null;
  const kind = usageSplitKind(usage);
  if (kind === "merged") return null;
  if (kind === "none") return 0;
  const read = usage.cacheReadTokens ?? 0;
  return Math.min(1, Math.max(0, read / usage.inputTokens));
}

/**
 * The three mutually exclusive slices of `inputTokens`, for a surface that wants to stack them.
 * `null` when the split is `"merged"` — the caller must render the merged figure and say so, rather
 * than receive a fabricated decomposition. `uncached` is clamped at 0: a provider that reports a
 * cached slice larger than its own input total is reporting nonsense, and the sum must still be safe.
 */
export function usageInputSlices(
  usage: TokenUsageActual,
): { uncached: number; cacheRead: number; cacheWrite: number } | null {
  if (usageSplitKind(usage) === "merged") return null;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return {
    uncached: Math.max(0, usage.inputTokens - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
  };
}
