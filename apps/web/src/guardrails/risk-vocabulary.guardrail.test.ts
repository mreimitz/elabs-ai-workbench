import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// RM-37 WP 0.5 — two reserved words: "risk" (action 9) and "Blocker" (action 7).
// ------------------------------------------------------------------------------------------------
// The app measures things. Three features were calling their measurements "risk" anyway:
// Compatibility ranked a model pairing "Blocker", Advisor painted a heuristic recommendation red,
// Issues did the same — and none of them had established that anything was AT risk. A word that
// means "something bad may happen to you" cannot also mean "this tool description is 40 tokens
// longer than the median", or the operator learns to discount it in both places.
//
// So the word is reserved. `features/security/` may say "risk" — it analyses definitions for
// hostile intent and its bands are literally named `Low risk` … `High risk`. Everywhere else states
// what was MEASURED: "Exceeds limit", "12 findings · 1 error", "Estimated saving ≈ 4,200 tokens".
//
// ── What this scans, and what it deliberately does not ─────────────────────────────────────────
// SCANS: the copy. Comments are stripped before matching, because this governs what an OPERATOR
// reads, not how an engineer explains a trade-off to the next engineer ("a deliberate, low-risk
// trade against touching the route surface" is fine in a comment and would be absurd to rewrite).
// DOES NOT SCAN: test files (they assert on strings this rule is about), and `features/security/`.
//
// Comment stripping is a regex, not a parser, so a `//` inside a string literal ends the "comment"
// early — which can only ever make this check see MORE text, never less. It fails safe.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(HERE, "..");
/** `Blocker` was a wire-value LABEL, so the ban has to reach the package that declares the labels. */
const SHARED_SRC = path.resolve(HERE, "../../../../packages/shared/src");

/** The one feature whose subject matter is risk. */
const RESERVED_FOR = path.join("features", "security");

/**
 * Files outside `features/security/` that may still say "risk" in their copy. Each entry states
 * WHY — an exemption is a decision on the record, not a way to skip the decision.
 */
const ALLOWED: Record<string, string> = {};

const WORD = /\brisks?\b/i;

/** Strip block and line comments so this matches COPY, not commentary. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes(".guardrail.");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !isTestFile(entry.name)) out.push(full);
  }
  return out;
}

describe("`risk` is reserved for security's error-class results (RM-37 WP 0.5)", () => {
  it("appears in no operator-facing copy outside features/security", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const relative = path.relative(WEB_SRC, file);
      if (relative.startsWith(RESERVED_FOR)) continue;
      if (relative in ALLOWED) continue;
      const copy = stripComments(readFileSync(file, "utf8"));
      if (WORD.test(copy)) {
        const line = copy.split("\n").findIndex((text) => WORD.test(text)) + 1;
        offenders.push(`${relative}:${line}`);
      }
    }
    expect(offenders, `"risk" in non-security copy — state the measurement instead`).toEqual([]);
  });

  it("is NOT vacuous — the security feature really does still use the word", () => {
    // If this ever fails, the check above has become a tautology and must be deleted or re-aimed.
    const securityFiles = walk(path.join(WEB_SRC, RESERVED_FOR));
    expect(securityFiles.length).toBeGreaterThan(0);
    const usesTheWord = securityFiles.some((file) =>
      WORD.test(stripComments(readFileSync(file, "utf8"))),
    );
    expect(usesTheWord).toBe(true);
  });
});

// RM-37 WP 0.5 (action 7) — "Blocker" is not a word this app says to an operator.
// ------------------------------------------------------------------------------------------------
// Compatibility's severities are LIMIT language now: "Exceeds limit" / "Near limit" / "Within limit"
// / "Advice". The wire values are frozen and unchanged — `blocker` still travels, still weights the
// score, still gates the heatmap band — so this bans the capitalised DISPLAY word only, and leaves
// the lower-case wire value deliberately alone.
//
// This assertion exists because the work package's acceptance was written as a `grep` to be run by
// hand and pasted into a report, and it got pasted wrong: two comment hits were reported as zero.
// A check that matters belongs in the suite, where nobody has to transcribe it.
describe('"Blocker" is a wire value, never a word shown to an operator (RM-37 WP 0.5)', () => {
  const DISPLAY_WORD = /\bBlocker\b/;

  it("appears in no copy in apps/web or packages/shared", () => {
    const offenders: string[] = [];
    for (const root of [WEB_SRC, SHARED_SRC]) {
      for (const file of walk(root)) {
        const copy = stripComments(readFileSync(file, "utf8"));
        if (DISPLAY_WORD.test(copy)) {
          const line = copy.split("\n").findIndex((text) => DISPLAY_WORD.test(text)) + 1;
          offenders.push(`${path.relative(root, file)}:${line}`);
        }
      }
    }
    expect(offenders, 'the display word "Blocker" — state the limit instead').toEqual([]);
  });

  it("has NOT banned the lower-case wire value, which must still exist", () => {
    // Non-vacuity in the other direction: if `blocker` ever stops appearing, this guard is policing
    // a vocabulary the app no longer has, and the check above has quietly become meaningless.
    const wire = walk(SHARED_SRC).some((file) => /\bblocker\b/.test(readFileSync(file, "utf8")));
    expect(wire).toBe(true);
  });
});
