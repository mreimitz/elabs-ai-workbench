// Skill Studio WP 7.5 (SI7) — the ONE tool-reference matcher for the code editor's decoration +
// hover pipeline. PURE and deterministic over `(text, knownToolNames)` — no Monaco, no React, no
// fetch, zero imports — so it is exhaustively unit-testable (`tool-references.test.ts`) and safe to
// consume from `explainers.ts` (which the API test suite loads under tsx).
//
// Why this exists (the SI7 flakiness): the previous pass decorated a tool reference only when the
// projected graph carried a `tool_ref` node AND the backticked name sat on that node's
// `anchor.startLine` — so bare occurrences, repeat occurrences, occurrences in headings/bold, and
// anything rendered while the (debounced, server-side) projection was stale got no styling. This
// matcher works on the DOCUMENT TEXT alone:
//
//   • KNOWN — an occurrence of a bound tool's exact name (case-sensitive, word-boundary), whether
//     backticked or bare, in a heading, bold, prose, or a fenced example. List-driven: any name the
//     bound servers' latest scans expose matches, whatever its shape.
//   • UNKNOWN-TOOLLIKE — a BACKTICKED inline-code span whose whole text has the server tool-name
//     shape (`qlik_search`-style snake_case) but is NOT in the known list. Deliberately conservative
//     (false positives are worse than misses, same stance as the API's `extract-tools.ts`): bare
//     snake_case words are NEVER flagged, only exact single-token backticked spans are.
//
// Skipped contexts: the YAML frontmatter block (keys AND values — mirrors the API extractor) and
// fence DELIMITER lines (so a ``` language tag can never match). Inside a fence, backticks are
// literal, so fence content can still match KNOWN names (an example calling `qlik_search` is a real
// reference) but never produces unknown-toollike findings (example code is a false-positive magnet).

/** How a matched occurrence classifies against the bound servers' scanned tool names. */
export type ToolReferenceKind = "known" | "unknown-toollike";

/** One matched tool-name occurrence, in Monaco's 1-based line/column terms. */
export type ToolReferenceMatch = {
  kind: ToolReferenceKind;
  /** The matched tool name (for `unknown-toollike`, the full backticked span text). */
  name: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the name's first character (backticks excluded). */
  startColumn: number;
  /** 1-based column just past the name's last character (`startColumn + name.length`). */
  endColumn: number;
  /** True when the name is EXACTLY one inline-code span (`` `name` ``) on a prose line. */
  backticked: boolean;
};

/** One deduplicated unknown-toollike finding (per distinct name), for the problems surface. */
export type UnknownToolFinding = {
  name: string;
  /** 1-based line of the FIRST occurrence. */
  line: number;
  /** How many occurrences the document contains. */
  count: number;
};

/**
 * The server tool-name SHAPE an unknown-toollike span must have: lowercase snake_case with a first
 * segment of ≥ 2 chars and ≥ 1 underscore-joined segment (`qlik_search`, `qlik_get_data_model`).
 * Tightened from the audit's `^[a-z][a-z0-9]+_[a-z0-9_]+$` to reject trailing/double underscores —
 * conservative on purpose so ordinary prose tokens don't get flagged.
 */
export const TOOL_NAME_SHAPE_RE = /^[a-z][a-z0-9]+(?:_[a-z0-9]+)+$/;

/** Is `name` shaped like a server tool name (see {@link TOOL_NAME_SHAPE_RE})? */
export function isToolLikeName(name: string): boolean {
  return TOOL_NAME_SHAPE_RE.test(name);
}

/** A word character for boundary purposes — underscore included, so `qlik_search` never matches
 *  inside `qlik_search_advanced` (this is also what resolves overlapping names longest-first). */
const WORD_CHAR_RE = /[A-Za-z0-9_]/;

/** A fence delimiter line (``` or ~~~, optionally indented) — same toggle the repo's other markdown
 *  passes use. The whole line is skipped, which is what keeps language tags out of matching. */
const FENCE_LINE_RE = /^\s*(?:```|~~~)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The inline-code spans of one prose line: inner text + 0-based inner start offset. */
function codeSpans(line: string): Array<{ inner: string; innerStart: number }> {
  const spans: Array<{ inner: string; innerStart: number }> = [];
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    const inner = match[1] ?? "";
    spans.push({ inner, innerStart: (match.index ?? 0) + 1 });
  }
  return spans;
}

/** The 0-based index of the line CLOSING a leading `---` frontmatter block, or -1 when there is no
 *  (terminated) frontmatter. Mirrors the API extractor: an unterminated opener is NOT frontmatter. */
function frontmatterEnd(lines: readonly string[]): number {
  if ((lines[0] ?? "").trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "---" || trimmed === "...") return i;
  }
  return -1;
}

/**
 * Match every tool-name occurrence in `text` against `knownToolNames` (see the module header for the
 * exact rules). Matches are returned in document order; ranges never overlap — an occurrence is
 * reported exactly once, and word boundaries make overlapping names (`qlik_search` vs
 * `qlik_search_advanced`) resolve to the longest actual name at each position.
 *
 * Classification is PURE list-membership: with an empty known list every backticked toollike span is
 * `unknown-toollike` — it is the CALLER's job to decide that an unbound skill (no scanned bound
 * tools) styles those neutrally and raises no problems.
 */
export function matchToolReferences(
  text: string,
  knownToolNames: readonly string[],
): ToolReferenceMatch[] {
  if (text === "") return [];
  const known = [...new Set(knownToolNames)].filter((name) => name.length > 0);
  const knownSet = new Set(known);
  // One alternation, longest-first, so at any position the regex engine prefers the longest known
  // name (boundary checks then reject prefix hits like `qlik_search` inside `qlik_search_advanced`).
  const knownRe =
    known.length > 0
      ? new RegExp(
          known
            .slice()
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join("|"),
          "g",
        )
      : null;

  const lines = text.split(/\r?\n/);
  const fmEnd = frontmatterEnd(lines);
  const matches: ToolReferenceMatch[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (fmEnd >= 0 && i <= fmEnd) continue; // frontmatter block (keys + values) never matches
    const lineText = lines[i] ?? "";
    if (FENCE_LINE_RE.test(lineText)) {
      inFence = !inFence; // the delimiter line itself (incl. its language tag) never matches
      continue;
    }
    const lineNumber = i + 1;

    // (a) Exact inline-code spans on prose lines — the only place unknown-toollike can arise.
    //     Inside a fence backticks are literal, so spans are not parsed there.
    const claimed: Array<{ start: number; end: number }> = [];
    if (!inFence) {
      for (const span of codeSpans(lineText)) {
        const start = span.innerStart;
        const end = start + span.inner.length;
        if (knownSet.has(span.inner)) {
          matches.push({
            kind: "known",
            name: span.inner,
            line: lineNumber,
            startColumn: start + 1,
            endColumn: end + 1,
            backticked: true,
          });
          claimed.push({ start, end });
        } else if (isToolLikeName(span.inner)) {
          matches.push({
            kind: "unknown-toollike",
            name: span.inner,
            line: lineNumber,
            startColumn: start + 1,
            endColumn: end + 1,
            backticked: true,
          });
          claimed.push({ start, end });
        }
      }
    }

    // (b) Bare occurrences of KNOWN names anywhere else on the line (word-boundary, case-sensitive).
    //     Also covers a known name inside a longer inline-code span (`` `use qlik_search here` ``)
    //     and known names inside fence content — those report as `backticked: false`.
    if (knownRe) {
      knownRe.lastIndex = 0;
      let hit: RegExpExecArray | null = knownRe.exec(lineText);
      while (hit !== null) {
        const matched = hit[0] ?? "";
        const start = hit.index;
        const end = start + matched.length;
        const before = start > 0 ? (lineText[start - 1] ?? "") : "";
        const after = end < lineText.length ? (lineText[end] ?? "") : "";
        const boundaryOk = !WORD_CHAR_RE.test(before) && !WORD_CHAR_RE.test(after);
        const alreadyClaimed = claimed.some((range) => start < range.end && end > range.start);
        if (boundaryOk && !alreadyClaimed && matched.length > 0) {
          matches.push({
            kind: "known",
            name: matched,
            line: lineNumber,
            startColumn: start + 1,
            endColumn: end + 1,
            backticked: false,
          });
          knownRe.lastIndex = end;
        } else {
          // Step one char forward on a rejected hit so a different (shorter) known name starting
          // inside this span can still be found.
          knownRe.lastIndex = boundaryOk && !alreadyClaimed ? end : start + 1;
        }
        hit = knownRe.exec(lineText);
      }
    }
  }

  matches.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return matches;
}

/**
 * The deduplicated unknown-toollike findings of `text` (one per distinct name, first line + count),
 * for the problems surface. Returns `[]` when `knownToolNames` is empty — an unbound skill (or one
 * whose bound servers have no completed scan) gives validation no basis, so it raises no findings
 * (the same honest degradation WP 8.2's providers apply).
 */
export function findUnknownToolReferences(
  text: string,
  knownToolNames: readonly string[],
): UnknownToolFinding[] {
  if (knownToolNames.length === 0) return [];
  const byName = new Map<string, UnknownToolFinding>();
  for (const match of matchToolReferences(text, knownToolNames)) {
    if (match.kind !== "unknown-toollike") continue;
    const existing = byName.get(match.name);
    if (existing) {
      existing.count += 1;
    } else {
      byName.set(match.name, { name: match.name, line: match.line, count: 1 });
    }
  }
  return [...byName.values()];
}

// ── The live unknown-tool warning string (the problems-panel wire) ─────────────────────────────────
// The live findings reach the unified problems panel through the `warnings: string[]` prop the panel
// already takes (its other props are owned by another surface), so the finding is carried AS a
// string. Builder + parser live TOGETHER here so the two ends can never drift: `UnifiedEditor`
// formats with one, `collectSkillProblems` (explainers.ts) recognizes + re-classifies with the other.

const UNKNOWN_TOOL_WARNING_RE =
  /^Unknown tool reference `([^`]+)` — not found in the bound servers’ latest scans \(line (\d+)(?:, ×\d+)?\)\.$/;

/** Format one live unknown-tool finding as a problems-panel warning string. */
export function formatUnknownToolWarning(finding: UnknownToolFinding): string {
  const occurrences = finding.count > 1 ? `, ×${finding.count}` : "";
  return `Unknown tool reference \`${finding.name}\` — not found in the bound servers’ latest scans (line ${finding.line}${occurrences}).`;
}

/** Parse a warning string produced by {@link formatUnknownToolWarning}; `null` for anything else. */
export function parseUnknownToolWarning(warning: string): { name: string; line: number } | null {
  const match = UNKNOWN_TOOL_WARNING_RE.exec(warning);
  if (!match) return null;
  const name = match[1] ?? "";
  const line = Number.parseInt(match[2] ?? "", 10);
  if (name === "" || Number.isNaN(line)) return null;
  return { name, line };
}
