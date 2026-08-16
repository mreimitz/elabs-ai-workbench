// Skill Studio WP 7.3a (audit SI1, D-UX17a) — the pure text engine behind the Tools palette's
// "Bind server" UI: read and edit the `servers:` list in a SKILL.md YAML frontmatter block WITHOUT a
// YAML library. Deliberately conservative and line/offset-based so an edit splices in the new bytes
// and PRESERVES EVERY UNTOUCHED BYTE (indentation, comments, key order, CRLF vs LF, quoting of other
// entries) — the same "preserve every untouched byte" contract the server-side edit engine holds.
//
// Read semantics mirror the API's manifest parser (apps/api/src/skills/manifest.ts):
//  - frontmatter = a leading `---`-fenced block (optional BOM; `---` may carry trailing spaces/tabs);
//  - `servers:` accepts a scalar, a flow list (`[a, b]`), or a block list (`- a` items);
//  - names are trimmed, empties dropped, duplicates deduped keeping first occurrence.
//
// Write semantics (the app's canonical style, matching the server-scaffold output):
//  - a missing frontmatter block is created; a missing `servers:` key is appended before the closing
//    fence; a block list gains a new item matching the existing items' indentation (2-space default);
//  - a flow list is spliced in place (style preserved); a scalar is normalized to a block list;
//  - adding an already-present name is a no-op (returns the input string identically);
//  - removing the last name drops the `servers:` key, and dropping the key from an otherwise-empty
//    frontmatter block drops the whole block (so add→remove on a document with no frontmatter
//    round-trips to the exact original text).

/** One physical line of the document, tracked by absolute character offsets so edits splice exactly. */
type Line = {
  /** Offset of the first character of the line. */
  start: number;
  /** Offset just past the last content character (the EOL, if any, starts here). */
  end: number;
  /** The line's content WITHOUT its terminator. */
  text: string;
  /** The line's terminator: "\n", "\r\n", or "" for a final unterminated line. */
  eol: string;
};

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i), eol: "\n" });
      i += 1;
      start = i;
    } else if (ch === "\r" && text[i + 1] === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i), eol: "\r\n" });
      i += 2;
      start = i;
    } else {
      i += 1;
    }
  }
  if (start < text.length) {
    lines.push({ start, end: text.length, text: text.slice(start), eol: "" });
  }
  return lines;
}

/** The document's dominant EOL — the first line's terminator, defaulting to "\n". */
function docEol(lines: Line[]): string {
  for (const line of lines) {
    if (line.eol !== "") return line.eol;
  }
  return "\n";
}

const FENCE_RE = /^---[ \t]*$/;
const BOM = "﻿";

type FrontmatterBlock = {
  /** Index (into the lines array) of the opening `---` fence. Always 0 (after an optional BOM). */
  openLine: number;
  /** Index of the closing `---` fence. */
  closeLine: number;
};

/**
 * Locate the leading frontmatter block: an opening `---` fence on the FIRST line (optionally after a
 * BOM) plus a closing `---` fence somewhere below. An unterminated fence is treated as "no
 * frontmatter" (matching the server's parser, which requires both fences).
 */
function findFrontmatter(lines: Line[]): FrontmatterBlock | null {
  const first = lines[0];
  if (!first) return null;
  const content = first.text.startsWith(BOM) ? first.text.slice(1) : first.text;
  if (!FENCE_RE.test(content)) return null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line && FENCE_RE.test(line.text)) return { openLine: 0, closeLine: i };
  }
  return null;
}

const SERVERS_KEY_RE = /^servers[ \t]*:(.*)$/;

/** One block-list item (`  - name`), with the line it lives on and its leading indentation. */
type BlockItem = { lineIndex: number; indent: string; value: string };

/** One flow-list segment: the raw text between commas, with offsets RELATIVE to the flow inner. */
type FlowSegment = { raw: string; start: number; end: number };

type ServersEntry =
  | { kind: "none" }
  /** A `servers:` value this editor doesn't understand (nested map, unbalanced flow, …) — read as
   *  empty and NEVER edited (add/remove return the text unchanged rather than corrupt it). */
  | { kind: "opaque" }
  | { kind: "scalar"; lineIndex: number; value: string }
  | {
      kind: "flow";
      lineIndex: number;
      /** Absolute offsets of the text INSIDE the brackets. */
      innerStart: number;
      innerEnd: number;
      segments: FlowSegment[];
    }
  | { kind: "block"; keyLineIndex: number; items: BlockItem[] };

/**
 * Parse ONE scalar value the way YAML would for the simple cases this file writes/reads: strip an
 * unquoted trailing ` # comment`, unwrap double quotes (JSON-style escapes) and single quotes
 * (`''` → `'`), and trim. Malformed quoting degrades to the raw trimmed text (never throws).
 */
function parseScalarValue(raw: string): string {
  let value = raw.trim();
  if (value === "") return "";
  if (value.startsWith('"')) {
    const match = value.match(/^"((?:[^"\\]|\\.)*)"/);
    if (match) {
      try {
        return JSON.parse(`"${match[1] ?? ""}"`) as string;
      } catch {
        return (match[1] ?? "").trim();
      }
    }
    return value;
  }
  if (value.startsWith("'")) {
    const match = value.match(/^'((?:[^']|'')*)'/);
    if (match) return (match[1] ?? "").replace(/''/g, "'");
    return value;
  }
  const comment = value.search(/[ \t]#/);
  if (comment >= 0) value = value.slice(0, comment).trimEnd();
  return value;
}

/** Split a single-line flow list's inner text into raw segments (offsets kept), respecting quotes. */
function splitFlowSegments(inner: string): FlowSegment[] {
  const segments: FlowSegment[] = [];
  let segStart = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
    } else if (quote === "'") {
      if (ch === "'") {
        if (inner[i + 1] === "'") i += 1;
        else quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      segments.push({ raw: inner.slice(segStart, i), start: segStart, end: i });
      segStart = i + 1;
    }
  }
  segments.push({ raw: inner.slice(segStart), start: segStart, end: inner.length });
  return segments;
}

/** Locate + shape the top-level `servers:` entry inside the frontmatter block, if any. */
function findServersEntry(lines: Line[], block: FrontmatterBlock): ServersEntry {
  for (let i = block.openLine + 1; i < block.closeLine; i++) {
    const line = lines[i];
    if (!line) continue;
    const keyMatch = line.text.match(SERVERS_KEY_RE);
    if (!keyMatch) continue;
    const rest = (keyMatch[1] ?? "").trim();

    if (rest === "" || rest.startsWith("#")) {
      // Block list (possibly empty): collect `- item` lines until a non-item, non-blank, non-comment.
      const items: BlockItem[] = [];
      for (let j = i + 1; j < block.closeLine; j++) {
        const itemLine = lines[j];
        if (!itemLine) break;
        const itemMatch = itemLine.text.match(/^([ \t]+)-[ \t]*(.*)$/);
        if (itemMatch) {
          items.push({
            lineIndex: j,
            indent: itemMatch[1] ?? "  ",
            value: parseScalarValue(itemMatch[2] ?? ""),
          });
          continue;
        }
        if (/^[ \t]*$/.test(itemLine.text) || /^[ \t]*#/.test(itemLine.text)) continue;
        // An indented non-item line directly under the key (e.g. a nested map) is a structure this
        // editor doesn't understand — refuse to edit rather than splice into it.
        if (items.length === 0 && /^[ \t]/.test(itemLine.text)) return { kind: "opaque" };
        break;
      }
      return { kind: "block", keyLineIndex: i, items };
    }

    if (rest.startsWith("[")) {
      // Single-line flow list only (the conservative subset — the app never writes multi-line flow).
      const open = line.text.indexOf("[");
      const close = line.text.lastIndexOf("]");
      if (open >= 0 && close > open) {
        const innerStart = line.start + open + 1;
        const innerEnd = line.start + close;
        const inner = line.text.slice(open + 1, close);
        return {
          kind: "flow",
          lineIndex: i,
          innerStart,
          innerEnd,
          segments: splitFlowSegments(inner),
        };
      }
      // Unbalanced brackets (multi-line flow?) — opaque: read as empty, never edited.
      return { kind: "opaque" };
    }

    return { kind: "scalar", lineIndex: i, value: parseScalarValue(rest) };
  }
  return { kind: "none" };
}

/** Trim + drop empties + dedupe keeping first occurrence (the server's `coerceStringList` parity). */
function normalizeNames(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const name = entry.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The `servers:` names declared in the SKILL.md frontmatter, in order — trimmed, empties dropped,
 * deduped (first occurrence wins), exactly like the API's manifest parser. No frontmatter, no
 * `servers:` key, or an unparseable shape all degrade to `[]` (never a throw).
 */
export function parseFrontmatterServers(text: string): string[] {
  const lines = splitLines(text);
  const block = findFrontmatter(lines);
  if (!block) return [];
  const entry = findServersEntry(lines, block);
  switch (entry.kind) {
    case "none":
    case "opaque":
      return [];
    case "scalar":
      return normalizeNames([entry.value]);
    case "flow":
      return normalizeNames(entry.segments.map((segment) => parseScalarValue(segment.raw)));
    case "block":
      return normalizeNames(entry.items.map((item) => item.value));
  }
}

/** Words / shapes YAML would NOT read back as the intended plain string — these get double-quoted. */
const AMBIGUOUS_PLAIN = new Set(["true", "false", "yes", "no", "on", "off", "null", "~"]);
const PLAIN_SAFE_RE = /^[A-Za-z_][A-Za-z0-9._/-]*$/;

/** Serialize a server name as a YAML scalar: plain when unambiguous, else double-quoted (JSON rules). */
function yamlName(name: string): string {
  if (PLAIN_SAFE_RE.test(name) && !AMBIGUOUS_PLAIN.has(name.toLowerCase())) return name;
  return JSON.stringify(name);
}

/** Replace `[from, to)` of `text` with `insert`. */
function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

/** The offset just past a line INCLUDING its terminator (the start of the next line). */
function lineSpanEnd(line: Line): number {
  return line.end + line.eol.length;
}

/**
 * Add `name` to the frontmatter `servers:` list, preserving every untouched byte. A blank name or an
 * already-declared name (trimmed comparison) returns the input text unchanged (identity — callers can
 * `===` to detect the no-op). Creates the frontmatter block and/or the key as needed.
 */
export function addFrontmatterServer(text: string, name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return text;
  if (parseFrontmatterServers(text).includes(trimmed)) return text;

  const lines = splitLines(text);
  const eol = docEol(lines);
  const block = findFrontmatter(lines);

  if (!block) {
    const hasBom = text.startsWith(BOM);
    const body = hasBom ? text.slice(1) : text;
    const created = `---${eol}servers:${eol}  - ${yamlName(trimmed)}${eol}---${eol}`;
    return (hasBom ? BOM : "") + created + body;
  }

  const closeLine = lines[block.closeLine];
  if (!closeLine) return text; // unreachable — findFrontmatter guarantees the index
  const entry = findServersEntry(lines, block);

  switch (entry.kind) {
    case "opaque":
      return text; // a shape we don't understand — never splice into it
    case "none": {
      // Append the key + first item just before the closing fence.
      const insert = `servers:${eol}  - ${yamlName(trimmed)}${eol}`;
      return splice(text, closeLine.start, closeLine.start, insert);
    }
    case "block": {
      const lastItem = entry.items[entry.items.length - 1];
      if (!lastItem) {
        // `servers:` with no items yet — insert the first item right after the key line.
        const keyLine = lines[entry.keyLineIndex];
        if (!keyLine) return text;
        const at = lineSpanEnd(keyLine);
        return splice(text, at, at, `  - ${yamlName(trimmed)}${eol}`);
      }
      const itemLine = lines[lastItem.lineIndex];
      if (!itemLine) return text;
      const at = lineSpanEnd(itemLine);
      const itemEol = itemLine.eol !== "" ? itemLine.eol : eol;
      return splice(text, at, at, `${lastItem.indent}- ${yamlName(trimmed)}${itemEol}`);
    }
    case "flow": {
      const inner = text.slice(entry.innerStart, entry.innerEnd);
      const hasItems = entry.segments.some((segment) => parseScalarValue(segment.raw) !== "");
      if (!hasItems) {
        return splice(text, entry.innerStart, entry.innerEnd, yamlName(trimmed));
      }
      const separator = inner.includes(", ") ? ", " : ",";
      return splice(text, entry.innerEnd, entry.innerEnd, `${separator}${yamlName(trimmed)}`);
    }
    case "scalar": {
      // Normalize `servers: old` to a block list carrying both names (documented normalization —
      // the only edit that rewrites an existing value's formatting).
      const line = lines[entry.lineIndex];
      if (!line) return text;
      const lineEol = line.eol !== "" ? line.eol : eol;
      const replacement = `servers:${lineEol}  - ${yamlName(entry.value)}${lineEol}  - ${yamlName(trimmed)}${lineEol}`;
      return splice(text, line.start, lineSpanEnd(line), replacement);
    }
  }
}

/**
 * Remove `name` from the frontmatter `servers:` list, preserving every untouched byte. A name that
 * isn't declared returns the input text unchanged (identity). Removing the last name drops the
 * `servers:` key line; if that leaves the frontmatter block completely empty, the block is dropped
 * too (add→remove on a frontmatter-less document round-trips exactly).
 */
export function removeFrontmatterServer(text: string, name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return text;

  const lines = splitLines(text);
  const block = findFrontmatter(lines);
  if (!block) return text;
  const entry = findServersEntry(lines, block);

  switch (entry.kind) {
    case "none":
    case "opaque":
      return text;
    case "scalar": {
      if (entry.value !== trimmed) return text;
      const line = lines[entry.lineIndex];
      if (!line) return text;
      return dropEmptyFrontmatter(splice(text, line.start, lineSpanEnd(line), ""));
    }
    case "block": {
      const matches = entry.items.filter((item) => item.value === trimmed);
      if (matches.length === 0) return text;
      const removeLines = new Set(matches.map((item) => item.lineIndex));
      const removingAll = matches.length === entry.items.length;
      if (removingAll) removeLines.add(entry.keyLineIndex);
      // Splice from the bottom up so earlier offsets stay valid.
      let next = text;
      const ordered = [...removeLines].sort((a, b) => b - a);
      for (const index of ordered) {
        const line = lines[index];
        if (!line) continue;
        next = splice(next, line.start, lineSpanEnd(line), "");
      }
      return removingAll ? dropEmptyFrontmatter(next) : next;
    }
    case "flow": {
      const parsed = entry.segments.map((segment) => parseScalarValue(segment.raw));
      const matchIndexes = parsed
        .map((value, index) => (value === trimmed ? index : -1))
        .filter((index) => index >= 0);
      if (matchIndexes.length === 0) return text;
      const keptCount = parsed.filter((value) => value !== "").length - matchIndexes.length;
      if (keptCount <= 0) {
        const line = lines[entry.lineIndex];
        if (!line) return text;
        return dropEmptyFrontmatter(splice(text, line.start, lineSpanEnd(line), ""));
      }
      // Remove each matching segment plus ONE adjacent comma, bottom-up, preserving all other bytes.
      let next = text;
      for (let m = matchIndexes.length - 1; m >= 0; m--) {
        const index = matchIndexes[m];
        if (index === undefined) continue;
        const segment = entry.segments[index];
        if (!segment) continue;
        const previous = index > 0 ? entry.segments[index - 1] : undefined;
        const from = previous ? entry.innerStart + previous.end : entry.innerStart + segment.start;
        const to = previous
          ? entry.innerStart + segment.end
          : entry.innerStart + segment.end + (entry.segments.length > 1 ? 1 : 0);
        next = splice(next, from, to, "");
      }
      return next;
    }
  }
}

/**
 * If the document now starts with a frontmatter block whose fences enclose NOTHING (zero lines), drop
 * the block entirely. Blocks that still hold blank/comment lines are left alone — we only tidy what a
 * `servers:`-only block leaves behind, so unknown authored content is never destroyed.
 */
function dropEmptyFrontmatter(text: string): string {
  const lines = splitLines(text);
  const block = findFrontmatter(lines);
  if (!block || block.closeLine !== block.openLine + 1) return text;
  const openLine = lines[block.openLine];
  const closeLine = lines[block.closeLine];
  if (!openLine || !closeLine) return text;
  const hasBom = openLine.text.startsWith(BOM);
  const from = hasBom ? openLine.start + BOM.length : openLine.start;
  return splice(text, from, lineSpanEnd(closeLine), "");
}
