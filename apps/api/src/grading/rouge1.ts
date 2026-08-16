import { stableStringify } from "../utils/json.js";
import type { GradeContext, Grader, GraderResult } from "./grader.js";

/**
 * ROUGE-1 grader (B4) — in-house unigram F1 of the run's final answer vs the test's ground-truth text.
 * NO dependency: pure string math. Deterministic and offline (never calls a model or a tool).
 *
 * Reference text = `expectedInsight` (if present) + " " + a stable stringification of `expectedValue`
 * (if present). Candidate = the run's `finalAssistantText`. Both are normalized (lowercase, punctuation
 * → spaces, whitespace collapsed) and split into a unigram MULTISET; the overlap is Σ min(count) per
 * token, and F1 = 2·p·r/(p+r).
 *
 * Worked partial example (documented for the property test):
 *   reference "the cat sat" → [the, cat, sat]; candidate "the cat ran" → [the, cat, ran].
 *   overlap = min(1,1)["the"] + min(1,1)["cat"] + min(0,1)["sat"] = 2.
 *   p = 2/3, r = 2/3, F1 = 2·(2/3)·(2/3) / (2/3 + 2/3) = (8/9) / (4/3) = 2/3 ≈ 0.6666666667.
 */

const METHOD = "rouge1_unigram_f1";

/** Lowercase, replace every non-alphanumeric (unicode-aware) run with a space, split, drop empties. */
function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function multiset(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export const rouge1Grader = {
  id: "rouge1",
  kind: "deterministic",
  grade(ctx: GradeContext): GraderResult {
    const exp = ctx.test.expectations;
    // A non-empty authored insight, and/or a structured expectedValue, provide the reference text.
    const insight = typeof exp?.expectedInsight === "string" ? exp.expectedInsight.trim() : "";
    const hasInsight = insight.length > 0;
    const hasValue = exp?.expectedValue !== undefined;
    if (!hasInsight && !hasValue) {
      return {
        status: "unevaluable",
        score: null,
        method: METHOD,
        reasoning: "no expectedInsight or expectedValue to compare against",
      };
    }

    const parts: string[] = [];
    if (hasInsight) parts.push(insight);
    if (hasValue) parts.push(stableStringify(exp?.expectedValue));
    const reference = parts.join(" ");

    const refTokens = normalizeTokens(reference);
    const candTokens = normalizeTokens(ctx.finalAssistantText);
    const refCounts = multiset(refTokens);
    const candCounts = multiset(candTokens);

    let overlap = 0;
    for (const [token, refCount] of refCounts) {
      overlap += Math.min(refCount, candCounts.get(token) ?? 0);
    }

    const precision = candTokens.length === 0 ? 0 : overlap / candTokens.length;
    const recall = refTokens.length === 0 ? 0 : overlap / refTokens.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    return {
      status: "graded",
      score: f1,
      method: METHOD,
      reasoning: `unigram overlap ${overlap} (cand ${candTokens.length} tokens, ref ${refTokens.length} tokens; p=${precision.toFixed(4)}, r=${recall.toFixed(4)})`,
      evidence: {
        precision,
        recall,
        overlap,
        candTokens: candTokens.length,
        refTokens: refTokens.length,
      },
    };
  },
} satisfies Grader;
