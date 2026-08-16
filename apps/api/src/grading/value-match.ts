import { VALUE_MATCH_REL_TOLERANCE } from "@mcp-token-footprint/shared";
import type { GradeContext, Grader, GraderResult } from "./grader.js";

/**
 * value_match grader (B4) — structured/numeric check of the run's answer vs the test's `expectedValue`.
 * Deterministic and offline (never calls a model or a tool; it only parses text the model already
 * produced).
 *
 * Flow: if the test declares no `expectedValue` → `unevaluable`. Else parse the LAST JSON block in the
 * final answer (a fenced ```json … ``` block wins; otherwise the last balanced top-level `{…}`/`[…]`).
 * If nothing parses → `unevaluable` (NOT a fail, NOT a 0 — the model simply produced no structured
 * answer to check). Otherwise compare deeply, numbers within a RELATIVE tolerance:
 *   - `expectedValue` a plain object → score = matching leaf keys / expected leaf keys (partial credit).
 *   - `expectedValue` scalar/array   → score = 1.0 iff deep-equal, else 0.0.
 */

const METHOD = "value_match_json";

export const valueMatchGrader = {
  id: "value_match",
  kind: "deterministic",
  grade(ctx: GradeContext): GraderResult {
    const expected = ctx.test.expectations?.expectedValue;
    if (expected === undefined) {
      return {
        status: "unevaluable",
        score: null,
        method: METHOD,
        reasoning: "test declares no expectedValue",
      };
    }

    const parsed = extractLastJson(ctx.finalAssistantText);
    if (!parsed.ok) {
      return {
        status: "unevaluable",
        score: null,
        method: METHOD,
        reasoning: "no parseable JSON block found in the final answer",
      };
    }

    if (isPlainObject(expected)) {
      const expectedLeaves = leaves(expected);
      if (expectedLeaves.length === 0) {
        // An empty expected object: full credit iff the parsed value deep-equals it.
        const equal = deepEqual(expected, parsed.value);
        return {
          status: "graded",
          score: equal ? 1 : 0,
          method: METHOD,
          reasoning: equal
            ? "empty expected object matched"
            : "empty expected object did not match",
          evidence: { parsed: parsed.value },
        };
      }
      const mismatched: string[] = [];
      let matches = 0;
      for (const leaf of expectedLeaves) {
        const got = getByPath(parsed.value, leaf.path);
        if (got.found && deepEqual(leaf.value, got.value)) matches += 1;
        else mismatched.push(leaf.path.join("."));
      }
      const score = matches / expectedLeaves.length;
      return {
        status: "graded",
        score,
        method: METHOD,
        reasoning:
          mismatched.length === 0
            ? `all ${expectedLeaves.length} expected leaf keys matched`
            : `mismatched keys: ${mismatched.join(", ")} (${matches}/${expectedLeaves.length} matched)`,
        evidence: { parsed: parsed.value, matches, total: expectedLeaves.length, mismatched },
      };
    }

    // Scalar or array expected value: all-or-nothing deep equality.
    const equal = deepEqual(expected, parsed.value);
    return {
      status: "graded",
      score: equal ? 1 : 0,
      method: METHOD,
      reasoning: equal ? "value deep-equal" : "value mismatch",
      evidence: { parsed: parsed.value },
    };
  },
} satisfies Grader;

// ── JSON extraction ─────────────────────────────────────────────────────────────────────────────

type ParseResult = { ok: true; value: unknown } | { ok: false };

/**
 * The LAST JSON value in `text`: prefer the last fenced ```json … ``` block that parses; else the last
 * balanced top-level `{…}`/`[…]` that parses. `{ ok:false }` when neither yields valid JSON.
 */
function extractLastJson(text: string): ParseResult {
  const fenceRe = /```json\s*([\s\S]*?)```/gi;
  const fenced: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match[1] !== undefined) fenced.push(match[1]);
  }
  for (let i = fenced.length - 1; i >= 0; i--) {
    const candidate = fenced[i];
    if (candidate === undefined) continue;
    const parsed = tryParse(candidate);
    if (parsed.ok) return parsed;
  }

  const blocks = topLevelJsonBlocks(text);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const candidate = blocks[i];
    if (candidate === undefined) continue;
    const parsed = tryParse(candidate);
    if (parsed.ok) return parsed;
  }
  return { ok: false };
}

function tryParse(raw: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** Every top-level (non-nested) balanced `{…}`/`[…]` substring in `text`, in order. */
function topLevelJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text.charAt(i);
    if (ch === "{" || ch === "[") {
      const end = scanBalanced(text, i);
      if (end > i) {
        blocks.push(text.slice(i, end));
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return blocks;
}

/** Exclusive end index of the balanced bracket run starting at `start`, or -1 if unbalanced. String-aware. */
function scanBalanced(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// ── Structural comparison ─────────────────────────────────────────────────────────────────────────

type Leaf = { path: string[]; value: unknown };

/** Every leaf (scalar/array/null) path of a plain object, recursing into nested plain objects only. */
function leaves(obj: Record<string, unknown>, prefix: string[] = []): Leaf[] {
  const out: Leaf[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];
    if (isPlainObject(value)) out.push(...leaves(value, path));
    else out.push({ path, value });
  }
  return out;
}

function getByPath(root: unknown, path: string[]): { found: boolean; value?: unknown } {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isPlainObject(cursor) || !(key in cursor)) return { found: false };
    cursor = cursor[key];
  }
  return { found: true, value: cursor };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return numbersClose(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return a === b;
}

/** Equal within a relative tolerance (B4; `VALUE_MATCH_REL_TOLERANCE`). Exact for non-finite handling. */
function numbersClose(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= VALUE_MATCH_REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
