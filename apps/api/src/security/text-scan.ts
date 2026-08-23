// The shared text heuristics (planning/Roadmap/RM-20-security-posture/, WP 1.3 · **D-SP14**) — the ONE definition of
// the three questions both analyzers ask of a block of untrusted text.
//
// "Does this text tell the model to override its instructions?", "does it carry a block addressed to
// the model rather than to me?" and "does it contain characters I cannot see?" are the same question
// whether the text is an MCP tool description (`analyzer.ts`, WP 1.2) or a SKILL.md body
// (`skill-analyzer.ts`, WP 1.3). Copying a matcher into a second file is how the two drift until
// `poisoning.injection-phrasing` and `skill-surface.injection-phrasing` mean different things while
// claiming to mean the same one — and a CI gate that compares finding sets across releases cannot
// survive that. So the matchers live here and both analyzers are thin callers.
//
// **RM-38 WP 2.1 — the VOCABULARY left this file; the MATCHING stayed.** The phrase list, the three
// hidden-instruction patterns and the invisible-code-point ranges are now
// `data-pack/security/signatures.json`, reached through `securitySignatures()`. Each list's
// false-positive review — what it deliberately does NOT match, and why — travels WITH it, in that
// file's `…Note` fields, which is where a reviewer editing the list will actually read it.
//
// Two consequences worth stating, because both are load-bearing:
//
//   * **Every read is at CALL time, never at module load.** In ESM, every import in `index.ts` is
//     evaluated before the first statement of `index.ts` runs, so a module-level `const` built from
//     the tables would snapshot the BUNDLED tables and silently ignore a refreshed pack. "Install
//     before the consumer" is not something that can be arranged for a module-level read.
//   * **Nothing here compiles a regex.** Every pattern was built once, at pack load (D-DP9), which
//     is also what makes a malformed pattern a pack REFUSAL rather than a throw halfway through a
//     scan an operator asked for.
//
// This module is PURE, to the same standard `analyzer.ts` is held to (D-SP7): no database handle, no
// clock, no network, no filesystem, no module-level mutable state. A test reads this source verbatim
// and fails on the same five forbidden tokens it checks `analyzer.ts` for — which is why they are not
// spelled out in this comment: the check reads the RAW file, so naming them here would fail it.

import {
  type HiddenInstructionKind,
  type InjectionPhrase,
  escapeRegExp,
  securitySignatures,
} from "@mcp-token-footprint/shared";

export { escapeRegExp };
export type { HiddenInstructionKind, InjectionPhrase };

// ── Shared text helpers ─────────────────────────────────────────────────────────────────────────

/** How much text either side of a match an excerpt carries. Enough to read, short enough to scan. */
export function evidenceContextChars(): number {
  return securitySignatures().evidenceContextChars;
}

/** Defensive: the wire types say these are strings, but the rows come from arbitrary third parties. */
export function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The `{ raw, offset }` pair `createSecurityFinding` wants: the match plus
 * {@link evidenceContextChars} either side, and the match's offset in the SOURCE text (not in the
 * excerpt) so a reader can find it again. The excerpt is redacted downstream, never here.
 */
export function evidenceAround(
  text: string,
  index: number,
  length: number,
): { raw: string; offset: number } {
  const context = evidenceContextChars();
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + length + context);
  return { raw: text.slice(start, end), offset: index };
}

/** How many UTF-16 code units one code point occupies: 2 for an astral character, 1 otherwise. */
export function codePointUnits(code: number): number {
  return code > 0xffff ? 2 : 1;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Heuristic 1 — injection phrasing
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** One matched injection phrase: which list entry fired, the matched span, and where it starts. */
export type InjectionPhraseMatch = {
  /** The list entry's `phrase`, for a message an operator can look up. */
  phrase: string;
  /** The text that actually matched, which may be longer than `phrase` (the object noun). */
  match: string;
  /** Character offset of the match in the source text. */
  offset: number;
};

/**
 * EVERY injection phrase that matches, in one total order: earliest match first, with the phrase
 * list's declaration order breaking a tie. Callers that emit at most one finding take `[0]`; the
 * length is what lets a message say how many further phrases matched, so nothing is hidden.
 */
export function findInjectionPhrases(text: string): InjectionPhraseMatch[] {
  if (text.length === 0) return [];

  const matches: (InjectionPhraseMatch & { order: number })[] = [];
  securitySignatures().injectionPatterns.forEach(({ entry, pattern }, order) => {
    const match = pattern.exec(text);
    if (match) matches.push({ phrase: entry.phrase, match: match[0], offset: match.index, order });
  });
  matches.sort((a, b) => a.offset - b.offset || a.order - b.order);
  return matches.map(({ phrase, match, offset }) => ({ phrase, match, offset }));
}

/** The first injection phrase in `text`, or `null`. See {@link findInjectionPhrases} for the order. */
export function findInjectionPhrase(text: string): InjectionPhraseMatch | null {
  return findInjectionPhrases(text)[0] ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Heuristic 2 — hidden instruction blocks
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type HiddenInstructionMatch = {
  kind: HiddenInstructionKind;
  label: string;
  match: string;
  offset: number;
};

/**
 * EVERY hidden-instruction shape that matches, earliest first, declaration order breaking a tie —
 * the same total order {@link findInjectionPhrases} uses, for the same byte-stability reason (D-SP6).
 *
 * The `kind` is what lets a caller take only SOME of the three: the skill rule deliberately ignores a
 * bare `html-comment`, because a SKILL.md is authored Markdown where an editorial directive comment
 * is ordinary furniture, unlike a tool description, which is a wire string with no reason to carry
 * one.
 */
export function findHiddenInstructionBlocks(text: string): HiddenInstructionMatch[] {
  if (text.length === 0) return [];

  const matches: (HiddenInstructionMatch & { order: number })[] = [];
  securitySignatures().hiddenInstructionPatterns.forEach(({ kind, label, pattern }, order) => {
    const match = pattern.exec(text);
    if (match) matches.push({ kind, label, match: match[0], offset: match.index, order });
  });
  matches.sort((a, b) => a.offset - b.offset || a.order - b.order);
  return matches.map(({ kind, label, match, offset }) => ({ kind, label, match, offset }));
}

/** The first hidden-instruction block in `text`, or `null`. */
export function findHiddenInstructionBlock(text: string): HiddenInstructionMatch | null {
  return findHiddenInstructionBlocks(text)[0] ?? null;
}

/** One HTML comment: the whole span, its INNER text, and where the span starts. */
export type HtmlComment = { match: string; inner: string; offset: number };

const HTML_COMMENT_OPEN_LENGTH = 4;
const HTML_COMMENT_CLOSE_LENGTH = 3;

/**
 * Every HTML comment in `text`, in source order.
 *
 * The skill rule needs all of them, not just the first: a SKILL.md that opens with an innocent
 * editorial comment and hides a payload in its third one must still be caught, and a
 * first-match-only scan would stop at the innocent one. The global copy is built from the pack's own
 * html-comment pattern, so there is still exactly one definition of what an HTML comment is — and it
 * is built per call rather than kept at module level, because a shared `g`-flagged regex carries
 * `lastIndex` between calls and would make the answer depend on what ran before it (D-SP6).
 */
export function findHtmlComments(text: string): HtmlComment[] {
  const scanner = new RegExp(securitySignatures().htmlCommentPattern.source, "g");
  const comments: HtmlComment[] = [];
  for (const match of text.matchAll(scanner)) {
    const span = match[0];
    comments.push({
      match: span,
      inner: span.slice(HTML_COMMENT_OPEN_LENGTH, -HTML_COMMENT_CLOSE_LENGTH),
      offset: match.index,
    });
  }
  return comments;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Heuristic 3 — invisible characters
// ══════════════════════════════════════════════════════════════════════════════════════════════

export function isInvisibleCodePoint(code: number): boolean {
  return securitySignatures().invisibleCodePointRanges.some(
    ([low, high]) => code >= low && code <= high,
  );
}

/** The UTF-16 index and code point of the first invisible character, or `null`. */
export function findInvisible(
  text: string,
): { index: number; length: number; code: number } | null {
  const ranges = securitySignatures().invisibleCodePointRanges;
  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index);
    if (code === undefined) break;
    const length = codePointUnits(code);
    if (ranges.some(([low, high]) => code >= low && code <= high)) return { index, length, code };
    index += length;
  }
  return null;
}

/** The first invisible character in `text`, or `null`. `offset` is a UTF-16 index into `text`. */
export function findInvisibleCharacter(text: string): { code: number; offset: number } | null {
  const hit = findInvisible(text);
  return hit === null ? null : { code: hit.code, offset: hit.index };
}

/** `0x200b` → `U+200B`. The form a finding's message names the offending character in. */
export function describeCodePoint(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}
