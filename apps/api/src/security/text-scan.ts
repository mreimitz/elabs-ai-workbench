// The shared text heuristics (roadmap/security-posture/, WP 1.3 · **D-SP14**) — the ONE definition of
// the three questions both analyzers ask of a block of untrusted text.
//
// "Does this text tell the model to override its instructions?", "does it carry a block addressed to
// the model rather than to me?" and "does it contain characters I cannot see?" are the same question
// whether the text is an MCP tool description (`analyzer.ts`, WP 1.2) or a SKILL.md body
// (`skill-analyzer.ts`, WP 1.3). Copying the phrase list into a second file is how the two drift until
// `poisoning.injection-phrasing` and `skill-surface.injection-phrasing` mean different things while
// claiming to mean the same one — and a CI gate that compares finding sets across releases cannot
// survive that. So the constants and the matchers live here, `analyzer.ts` re-exports every one of
// them it exported before, and both analyzers are thin callers.
//
// Everything below moved out of `analyzer.ts` VERBATIM, comments included. Each matcher's comment
// says what it deliberately does NOT match (D-SP11) — that comment is the false-positive review, and
// losing it in the move would have been the whole cost of the move. `apps/api/test/
// security-analyzer.test.ts` is byte-identical to its pre-WP-1.3 state and still green: that file is
// the proof the extraction preserved behaviour, which is why it was not allowed to be touched.
//
// This module is PURE, to the same standard `analyzer.ts` is held to (D-SP7): no database handle, no
// clock, no network, no filesystem, no module-level mutable state. A test reads this source and fails
// on `better-sqlite3`, `node:fs`, `fastify`, `new Date(` or `Date.now(`.

// ── Shared text helpers ─────────────────────────────────────────────────────────────────────────

/** How much text either side of a match an excerpt carries. Enough to read, short enough to scan. */
export const EVIDENCE_CONTEXT_CHARS = 40;

/** Defensive: the wire types say these are strings, but the rows come from arbitrary third parties. */
export function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The `{ raw, offset }` pair `createSecurityFinding` wants: the match plus
 * {@link EVIDENCE_CONTEXT_CHARS} either side, and the match's offset in the SOURCE text (not in the
 * excerpt) so a reader can find it again. The excerpt is redacted downstream, never here.
 */
export function evidenceAround(
  text: string,
  index: number,
  length: number,
): { raw: string; offset: number } {
  const start = Math.max(0, index - EVIDENCE_CONTEXT_CHARS);
  const end = Math.min(text.length, index + length + EVIDENCE_CONTEXT_CHARS);
  return { raw: text.slice(start, end), offset: index };
}

/**
 * Escape a literal for embedding in a `RegExp`. The phrase/verb lists are hand-written constants, but
 * building the pattern from them is what keeps the LIST the single declaration.
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How many UTF-16 code units one code point occupies: 2 for an astral character, 1 otherwise. */
export function codePointUnits(code: number): number {
  return code > 0xffff ? 2 : 1;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Heuristic 1 — injection phrasing
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Words that make "ignore previous …" an instruction override rather than ordinary English.
 *
 * A tool description that says "this endpoint will ignore previous **drafts**" is describing its own
 * behaviour; one that says "ignore previous **instructions**" is addressing the model. The object
 * noun is the only thing that separates them, so the three "previous"/"above" phrases below require
 * one and the literal phrases do not.
 */
export const INJECTION_INSTRUCTION_OBJECTS = [
  "instruction",
  "instructions",
  "prompt",
  "prompts",
  "message",
  "messages",
  "direction",
  "directions",
  "rule",
  "rules",
  "guidance",
  "context",
  "command",
  "commands",
  "order",
  "orders",
  "turn",
  "turns",
] as const;

/** Filler allowed between the phrase and its object, so "ignore previous system prompts" still fires. */
const INJECTION_OBJECT_MODIFIERS = [
  "the",
  "all",
  "any",
  "your",
  "my",
  "own",
  "above",
  "earlier",
  "prior",
  "user",
  "system",
  "assistant",
  "other",
] as const;

export type InjectionPhrase = {
  /** Matched case-insensitively; a space in the phrase matches any run of whitespace. */
  phrase: string;
  /**
   * When set, the phrase alone is not enough — it must be followed by one of
   * {@link INJECTION_INSTRUCTION_OBJECTS} (optionally through a modifier or two).
   */
  requiresInstructionObject?: true;
};

/**
 * The whole of the injection heuristic. Deliberately SHORT and LITERAL.
 *
 * What it deliberately does NOT match:
 *   • a bare "ignore", "override" or "system" anywhere in a description — a broad regex over those
 *     would fire on half the honest servers in the world ("ignores case", "overrides the default",
 *     "the system clock"), and a poisoning rule that cries wolf is a poisoning rule nobody reads;
 *   • "ignore previous drafts" / "disregard the above defaults" — the four phrases whose object is a
 *     plain noun in ordinary prose carry `requiresInstructionObject`, so the sentence has to name an
 *     instruction, prompt, rule or message to fire;
 *   • paraphrases. This list is exact strings, not semantics. A determined attacker rewrites around
 *     it; the rule exists to catch the copy-pasted payloads that make up nearly all of what is
 *     actually seen in the wild, without a false-positive rate that gets the whole report ignored.
 */
export const INJECTION_PHRASES: readonly InjectionPhrase[] = [
  { phrase: "ignore previous", requiresInstructionObject: true },
  { phrase: "ignore all previous", requiresInstructionObject: true },
  { phrase: "disregard previous", requiresInstructionObject: true },
  { phrase: "disregard the above", requiresInstructionObject: true },
  { phrase: "do not tell the user" },
  { phrase: "don't tell the user" },
  { phrase: "without telling the user" },
  { phrase: "do not mention this" },
  { phrase: "before using any other tool" },
  { phrase: "before doing anything else" },
  { phrase: "you must first read" },
  { phrase: "override your instructions" },
  { phrase: "override the system" },
];

const INJECTION_PATTERNS: readonly { entry: InjectionPhrase; pattern: RegExp }[] =
  INJECTION_PHRASES.map((entry) => {
    const literal = escapeRegExp(entry.phrase).replace(/ /g, String.raw`\s+`);
    const object = entry.requiresInstructionObject
      ? `(?:\\s+(?:${INJECTION_OBJECT_MODIFIERS.join("|")}))*\\s+(?:${INJECTION_INSTRUCTION_OBJECTS.join("|")})\\b`
      : "";
    return { entry, pattern: new RegExp(literal + object, "i") };
  });

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
  INJECTION_PATTERNS.forEach(({ entry, pattern }, order) => {
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

/**
 * An HTML comment. Renders as nothing in every UI that shows a description as markup, and is read
 * verbatim by the model — the definition of a channel you did not approve.
 *
 * Does NOT match a lone `-->` or a lone `<!--`: an unterminated comment is a typo, not a payload.
 */
export const HIDDEN_HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/;

/**
 * An UPPERCASE pseudo-tag — `<IMPORTANT>`, `</SYSTEM>`, `<INSTRUCTIONS priority="1">`. Case-SENSITIVE
 * on purpose (note the missing `i` flag): the shouted form is the prompt-injection idiom, and the
 * lower-case forms are ordinary words that appear inside real markup.
 *
 * Does NOT match `<b>`, `<code>`, `<important>`, or any tag outside the six names — a description
 * containing HTML is common and is not by itself a finding.
 */
export const HIDDEN_PSEUDO_TAG_PATTERN =
  /<\/?(IMPORTANT|SYSTEM|INSTRUCTION|INSTRUCTIONS|SECRET|ADMIN)\b[^>]*>/;

/**
 * Prose addressed to the model rather than to the reader: "Note to the assistant: …",
 * "AI instructions:".
 *
 * Does NOT match "note to self", "note to the caller", or a description that merely contains the word
 * "assistant" — the address form is what makes it an out-of-band instruction.
 */
export const HIDDEN_MODEL_ADDRESS_PATTERN =
  /note to (?:the )?(?:assistant|model|ai)\b|ai instructions?:/i;

/** Which of the three shapes fired. The `label` is the phrase a finding's message reads back. */
export type HiddenInstructionKind = "html-comment" | "pseudo-tag" | "model-address";

export type HiddenInstructionMatch = {
  kind: HiddenInstructionKind;
  label: string;
  match: string;
  offset: number;
};

const HIDDEN_INSTRUCTION_PATTERNS: readonly {
  kind: HiddenInstructionKind;
  label: string;
  pattern: RegExp;
}[] = [
  { kind: "html-comment", label: "an HTML comment", pattern: HIDDEN_HTML_COMMENT_PATTERN },
  { kind: "pseudo-tag", label: "an uppercase pseudo-tag", pattern: HIDDEN_PSEUDO_TAG_PATTERN },
  {
    kind: "model-address",
    label: "an instruction addressed to the model",
    pattern: HIDDEN_MODEL_ADDRESS_PATTERN,
  },
];

/**
 * EVERY hidden-instruction shape that matches, earliest first, declaration order breaking a tie —
 * the same total order {@link findInjectionPhrases} uses, for the same byte-stability reason (D-SP6).
 *
 * The `kind` is what lets a caller take only SOME of the three: the skill rule deliberately ignores a
 * bare `html-comment`, because a SKILL.md is authored Markdown where `<!-- prettier-ignore -->` is
 * ordinary editorial furniture, unlike a tool description, which is a wire string with no reason to
 * carry one.
 */
export function findHiddenInstructionBlocks(text: string): HiddenInstructionMatch[] {
  if (text.length === 0) return [];

  const matches: (HiddenInstructionMatch & { order: number })[] = [];
  HIDDEN_INSTRUCTION_PATTERNS.forEach(({ kind, label, pattern }, order) => {
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

/** One HTML comment: the whole `<!-- … -->` span, its INNER text, and where the span starts. */
export type HtmlComment = { match: string; inner: string; offset: number };

/**
 * Every HTML comment in `text`, in source order.
 *
 * The skill rule needs all of them, not just the first: a SKILL.md that opens with
 * `<!-- prettier-ignore -->` and hides a payload in its third comment must still be caught, and a
 * first-match-only scan would stop at the innocent one. The global copy is built from
 * {@link HIDDEN_HTML_COMMENT_PATTERN}'s own source, so there is still exactly one definition of what
 * an HTML comment is — and it is built per call rather than kept at module level, because a shared
 * `g`-flagged regex carries `lastIndex` between calls and would make the answer depend on what ran
 * before it (D-SP6).
 */
export function findHtmlComments(text: string): HtmlComment[] {
  const scanner = new RegExp(HIDDEN_HTML_COMMENT_PATTERN.source, "g");
  const comments: HtmlComment[] = [];
  for (const match of text.matchAll(scanner)) {
    const span = match[0];
    comments.push({
      match: span,
      inner: span.slice("<!--".length, -"-->".length),
      offset: match.index,
    });
  }
  return comments;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Heuristic 3 — invisible characters
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Code-point ranges a tool definition has no legitimate reason to carry.
 *
 * What it deliberately does NOT match: ordinary punctuation and accented letters. An em-dash
 * (U+2014), a curly quote (U+2019), `é` (U+00E9) and every emoji are all outside these ranges, so a
 * description written by a human with a decent keyboard never fires this rule. Nor does a plain
 * newline or tab: those are legitimate inside a long description, and they are visible in the
 * evidence excerpt anyway because `redactSecurityEvidence` escapes them there.
 *
 * What it DOES match is text that is invisible to you and meaningful to the model: zero-width
 * spaces/joiners, the bidi overrides that let a name render backwards, the invisible math operators,
 * the BOM, the Unicode TAG block (the "smuggled ASCII" carrier), and the private-use area.
 */
export const INVISIBLE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f], // zero-width space/non-joiner/joiner, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings and RIGHT-TO-LEFT OVERRIDE
  [0x2060, 0x2064], // word joiner and the invisible operators
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xe000, 0xf8ff], // private use area — renders as a box or as nothing, means whatever a font says
  [0xe0000, 0xe007f], // TAG block: ASCII smuggled as invisible code points
];

export function isInvisibleCodePoint(code: number): boolean {
  return INVISIBLE_CODE_POINT_RANGES.some(([low, high]) => code >= low && code <= high);
}

/** The UTF-16 index and code point of the first invisible character, or `null`. */
export function findInvisible(text: string): { index: number; length: number; code: number } | null {
  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index);
    if (code === undefined) break;
    const length = codePointUnits(code);
    if (isInvisibleCodePoint(code)) return { index, length, code };
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
