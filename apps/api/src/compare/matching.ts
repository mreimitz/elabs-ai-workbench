// Pure, DB-free tool-matching primitives for cross-server / tool-level comparison (north-star #4).
// Tools from two scans are paired in three phases: exact name, normalized name, then fuzzy
// (Jaccard) similarity. Everything here is deterministic and unit-testable in isolation.

import type { ToolMatchBasis } from "@mcp-token-footprint/shared";

/** A tool reference the matcher needs: its name and (optional) description. */
export type MatchableTool = {
  toolName: string;
  description?: string;
};

/** A pairing of one tool from A with one tool from B (indices into the original arrays). */
export type RawMatch<A extends MatchableTool, B extends MatchableTool> = {
  a: A;
  b: B;
  basis: ToolMatchBasis;
  similarity: number;
};

export type MatchResult<A extends MatchableTool, B extends MatchableTool> = {
  matched: RawMatch<A, B>[];
  onlyInA: A[];
  onlyInB: B[];
};

/**
 * Collapse a tool name to a comparable key: lowercase, trim, strip every non-alphanumeric
 * character. So `get_user`, `getUser`, and `Get-User` all collapse to `getuser`.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Split text into lowercased word tokens, breaking on non-alphanumeric boundaries AND on
 * camelCase boundaries. `getUserById` -> {get, user, by, id}. Empties are dropped.
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  if (!text) return tokens;

  // Insert a separator at every lower->Upper and letter<->digit boundary so camelCase splits,
  // then break on any run of non-alphanumeric characters.
  const withBoundaries = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2");

  for (const piece of withBoundaries.split(/[^A-Za-z0-9]+/)) {
    if (piece.length === 0) continue;
    tokens.add(piece.toLowerCase());
  }

  return tokens;
}

/** The combined name + description token set for a tool. */
function toolTokens(tool: MatchableTool): Set<string> {
  const tokens = tokenize(tool.toolName);
  if (tool.description) {
    for (const token of tokenize(tool.description)) tokens.add(token);
  }
  return tokens;
}

/**
 * Jaccard similarity in [0,1] over the union of each tool's name + description tokens:
 * |A ∩ B| / |A ∪ B|. Identical sets -> 1, disjoint -> 0. Two empty token sets -> 0 (no signal).
 */
export function similarity(a: MatchableTool, b: MatchableTool): number {
  const setA = toolTokens(a);
  const setB = toolTokens(b);

  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Pair tools from `aTools` and `bTools` in three deterministic phases:
 *   1. exact      — identical `toolName` (similarity 1).
 *   2. normalized — equal `normalizeName` on the remainder (similarity 1).
 *   3. fuzzy      — greedy best-first over cross-pair Jaccard `similarity`, taking a pair only
 *                   when BOTH tools are still unmatched AND similarity >= threshold.
 * Leftovers fall to `onlyInA` / `onlyInB`. Order is stable (tie-broken by toolName) so results
 * are reproducible.
 */
export function matchTools<A extends MatchableTool, B extends MatchableTool>(
  aTools: A[],
  bTools: B[],
  threshold: number,
): MatchResult<A, B> {
  const matched: RawMatch<A, B>[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  const isAvailableB = (index: number) => !usedB.has(index);

  const takePair = (aIndex: number, bIndex: number, basis: ToolMatchBasis, score: number) => {
    usedA.add(aIndex);
    usedB.add(bIndex);
    matched.push({ a: aTools[aIndex]!, b: bTools[bIndex]!, basis, similarity: score });
  };

  // Phase 1: exact name. First unused B with an identical toolName wins (stable by index).
  for (let i = 0; i < aTools.length; i += 1) {
    if (usedA.has(i)) continue;
    const name = aTools[i]!.toolName;
    for (let j = 0; j < bTools.length; j += 1) {
      if (!isAvailableB(j)) continue;
      if (bTools[j]!.toolName === name) {
        takePair(i, j, "exact", 1);
        break;
      }
    }
  }

  // Phase 2: normalized name on the remainder.
  for (let i = 0; i < aTools.length; i += 1) {
    if (usedA.has(i)) continue;
    const norm = normalizeName(aTools[i]!.toolName);
    for (let j = 0; j < bTools.length; j += 1) {
      if (!isAvailableB(j)) continue;
      if (normalizeName(bTools[j]!.toolName) === norm) {
        takePair(i, j, "normalized", 1);
        break;
      }
    }
  }

  // Phase 3: fuzzy. Compute every remaining cross-pair's similarity, then greedily assign
  // best-first. Sort by similarity desc with a stable tie-break (A name, then B name) so the
  // greedy order — and therefore the result — is fully deterministic.
  const candidates: Array<{ aIndex: number; bIndex: number; score: number }> = [];
  for (let i = 0; i < aTools.length; i += 1) {
    if (usedA.has(i)) continue;
    for (let j = 0; j < bTools.length; j += 1) {
      if (!isAvailableB(j)) continue;
      const score = similarity(aTools[i]!, bTools[j]!);
      if (score >= threshold && score > 0) {
        candidates.push({ aIndex: i, bIndex: j, score });
      }
    }
  }

  candidates.sort((x, y) => {
    // Highest similarity first; tie-break deterministically by the A-side name, then the B-side
    // name, so the greedy assignment below is fully reproducible.
    if (y.score !== x.score) return y.score - x.score;
    const aNameCmp = aTools[x.aIndex]!.toolName.localeCompare(aTools[y.aIndex]!.toolName);
    if (aNameCmp !== 0) return aNameCmp;
    return bTools[x.bIndex]!.toolName.localeCompare(bTools[y.bIndex]!.toolName);
  });

  for (const candidate of candidates) {
    if (usedA.has(candidate.aIndex) || usedB.has(candidate.bIndex)) continue;
    takePair(candidate.aIndex, candidate.bIndex, "fuzzy", candidate.score);
  }

  const onlyInA: A[] = [];
  for (let i = 0; i < aTools.length; i += 1) {
    if (!usedA.has(i)) onlyInA.push(aTools[i]!);
  }
  const onlyInB: B[] = [];
  for (let j = 0; j < bTools.length; j += 1) {
    if (!usedB.has(j)) onlyInB.push(bTools[j]!);
  }

  return { matched, onlyInA, onlyInB };
}
