import {
  DEFAULT_SKILL_FLOW_ID,
  SKILLFLOW_ANNOTATION_PREFIX,
  type SkillEditOp,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphNode,
} from "@mcp-token-footprint/shared";
import { stringify as stringifyYaml } from "yaml";
import { isSectionNode } from "./edit-ops.js";
import { projectSkillGraph } from "./projector.js";

/**
 * One applied line-range splice, in ORIGINAL-document coordinates (1-based `startLine`). Returned
 * alongside the edited text so callers/tests can verify the byte-exactness guarantee MECHANICALLY:
 * re-applying `edits` to the original lines must reproduce the result exactly, which proves the
 * engine touched nothing outside these ranges.
 */
export type AppliedEdit = {
  /** 1-based first line of the replaced range (for a pure insertion: the line the block lands BEFORE). */
  startLine: number;
  /** Number of original lines deleted (0 = pure insertion before `startLine`). */
  deletedLines: number;
  /** The replacement lines (verbatim, including any CR of a CRLF document). */
  insertedLines: string[];
};

export type ApplyEditOpsResult = {
  skillMd: string;
  warnings: string[];
  /** The splices that were applied, ascending by `startLine` — the mechanical byte-exactness proof. */
  edits: AppliedEdit[];
};

/**
 * Apply a batch of graph-level edit ops to a `SKILL.md` through the projected anchors (WP 4.1).
 *
 * PURE — no I/O, no clock. The core discipline (D5: untouched prose byte-for-byte):
 * - The source is split into lines ONCE (on `\n`, so a CRLF document keeps its `\r` inside each
 *   line string — untouched lines round-trip byte-exact, and line numbering matches the projector's
 *   `\r?\n` split). Every mutation is an anchor-scoped line-range splice; untouched regions are
 *   NEVER re-serialized (no markdown parser round-trip). After all splices, lines are re-joined.
 * - Splices are collected first (in original coordinates), overlap-checked, then applied bottom-up
 *   (descending start; deletions before insertions at the same start) so earlier anchors stay
 *   valid. An op whose splice would overlap an earlier op's range degrades to a warning + skip.
 * - Anything unimplementable without guessing (accessory removal, an un-anchored edge condition, a
 *   non-locatable expectation sentence) degrades to a warning + skip — NEVER a corrupted document.
 *
 * Span semantics (documented choices):
 * - a section's BODY = the lines between its heading and the next heading of ANY level (i.e. child
 *   subsections are NOT part of the body — `update_section_body` never swallows a child section);
 * - a section's FULL SPAN (for `remove_node` / `reorder` / insert-after) = heading through the end
 *   of its SUBTREE (up to the next heading of the same-or-shallower level), plus any
 *   `<!-- skillflow:… -->` annotation comment directly above the heading — a graph-level move or
 *   removal takes the section's children with it (leaving orphaned `###` children under a
 *   different parent would silently reshape the graph);
 * - `add_subroutine` inserts an H2 with one blank line of separation (the documents' prevailing
 *   style) after the target's full span, or at the document end for `afterNodeId: null`.
 *
 * Zero ops (or every op skipped) returns the input string unchanged (`===`).
 */
export function applyEditOps(
  skillMd: string,
  files: SkillFileNode[],
  graph: SkillGraph,
  ops: SkillEditOp[],
): ApplyEditOpsResult {
  const warnings: string[] = [];
  // Split on "\n" only: a CRLF document keeps "\r" inside each line, so untouched lines are
  // byte-exact on re-join. Numbering is identical to the projector's split(/\r?\n/).
  const lines = skillMd.split("\n");
  // Line-ending suffix for INSERTED lines, matching the document's prevailing style.
  const cr = skillMd.includes("\r\n") ? "\r" : "";

  const sections = scanSections(lines);
  const byHeadingLine = new Map(sections.map((s) => [s.headingIdx + 1, s]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const splices: Splice[] = [];

  /** Resolve an op's node to its SECTION (heading-anchored); undefined → warning pushed. */
  const sectionFor = (op: SkillEditOp, nodeId: string): Section | undefined => {
    const node = nodesById.get(nodeId);
    if (!node) {
      warnings.push(`${op.op}: unknown nodeId "${nodeId}"; skipped.`);
      return undefined;
    }
    const section = byHeadingLine.get(node.anchor.startLine);
    if (!section || !isSectionNode(node)) {
      warnings.push(
        `${op.op}: node "${nodeId}" (${node.kind}) is not a heading-anchored section; skipped.`,
      );
      return undefined;
    }
    return section;
  };

  for (const op of ops) {
    switch (op.op) {
      case "rename_node":
        applyRename(op, sectionFor(op, op.nodeId), lines, splices, warnings);
        break;
      case "update_section_body":
        applyUpdateBody(op, sectionFor(op, op.nodeId), lines, splices, warnings, cr);
        break;
      case "add_subroutine":
        applyAddSubroutine(op, lines, nodesById, byHeadingLine, splices, warnings, cr);
        break;
      case "remove_node":
        applyRemove(op, nodesById.get(op.nodeId), byHeadingLine, splices, warnings);
        break;
      case "reorder":
        applyReorder(op, lines, sections, sectionFor, splices, warnings);
        break;
      case "set_edge_condition":
        applyEdgeCondition(op, graph, lines, splices, warnings);
        break;
      case "add_asset_ref":
        applyAssetRef(
          "add_asset_ref",
          op.path,
          op.sentence,
          sectionFor(op, op.nodeId),
          lines,
          files,
          splices,
          warnings,
          cr,
        );
        break;
      case "set_gate_expectation":
        applyGateExpectation(
          op,
          nodesById.get(op.nodeId),
          byHeadingLine,
          lines,
          splices,
          warnings,
          cr,
        );
        break;
      case "set_annotation":
        applyAnnotation(op, sectionFor(op, op.nodeId), splices, warnings, cr);
        break;
      // --- Skill IDE WP 2.1 — command CRUD, keywords, asset connect/disconnect --------------------
      case "add_command":
        applyAddCommand(op, lines, graph, splices, warnings, cr);
        break;
      case "rename_command":
        applyRenameCommand(op, nodesById.get(op.nodeId), byHeadingLine, lines, splices, warnings);
        break;
      case "delete_command":
        applyDeleteCommand(op, nodesById.get(op.nodeId), byHeadingLine, splices, warnings);
        break;
      case "set_keywords":
        applySetKeywords(op, lines, splices, warnings, cr);
        break;
      case "connect_asset":
        // Aliases add_asset_ref exactly (I2 "wire a step to a bundled file") — same body-append
        // mechanics through the SAME code path; only the warning label differs.
        applyAssetRef(
          "connect_asset",
          op.path,
          op.sentence,
          sectionFor(op, op.nodeId),
          lines,
          files,
          splices,
          warnings,
          cr,
        );
        break;
      case "disconnect_asset":
        applyDisconnectAsset(op, sectionFor(op, op.nodeId), lines, splices, warnings);
        break;
      case "add_tool_ref":
        // Skill IDE WP 8.3 (I9.3) — append a tool-reference sentence to the section body, through the
        // SAME body-append splice add_asset_ref uses (never a duplicated splice path).
        applyToolRef(op, sectionFor(op, op.nodeId), lines, splices, warnings, cr);
        break;
    }
  }

  if (splices.length === 0) {
    return { skillMd, warnings, edits: [] };
  }

  // Apply bottom-up: descending start, and at the same start the deletion/replacement BEFORE the
  // pure insertion (so an insertion at index i lands before line i's replacement, not inside it).
  const ordered = [...splices].sort((a, b) => b.start - a.start || b.deleteCount - a.deleteCount);
  const out = [...lines];
  for (const splice of ordered) {
    out.splice(splice.start, splice.deleteCount, ...splice.insert);
  }

  const edits: AppliedEdit[] = [...splices]
    .sort((a, b) => a.start - b.start || b.deleteCount - a.deleteCount)
    .map((s) => ({ startLine: s.start + 1, deletedLines: s.deleteCount, insertedLines: s.insert }));

  return { skillMd: out.join("\n"), warnings, edits };
}

/**
 * Skill IDE WP 9.1 (I10.1) — the ONE canonical `content + anchored ops → content'` splice, shared by
 * BOTH the persisted edits route (`POST /api/skills/:id/versions/:vid/edits`) AND the stateless
 * `apply-preview` endpoint (`POST /api/skillflow/apply-preview`). Because the live preview and a real
 * save run this SAME code, they are byte-identical BY CONSTRUCTION — the live-draft engine's core
 * guarantee.
 *
 * It projects the graph from `content` + `files` the SAME way the persisted path does (pure,
 * deterministic — {@link projectSkillGraph}) then applies the ops through {@link applyEditOps}. A
 * caller that already projected the graph (the edits route validates its ops against it first) may
 * pass it in to avoid a second projection; because projection is deterministic the result is
 * identical either way. PURE — no I/O, no clock, no persistence.
 */
export function applyOpsToContent(
  content: string,
  files: SkillFileNode[],
  ops: SkillEditOp[],
  graph: SkillGraph = projectSkillGraph(content, files),
): ApplyEditOpsResult {
  return applyEditOps(content, files, graph, ops);
}

// --- Section scanning (same heading rules as the projector: frontmatter + fences skipped) --------

type Section = {
  title: string;
  level: number;
  /** 0-based index of the heading line. */
  headingIdx: number;
  /** 0-based EXCLUSIVE end of the section body (the next heading of ANY level, or EOF). */
  bodyEndIdx: number;
  /** 0-based EXCLUSIVE end of the section's subtree (next heading of level ≤ this, or EOF). */
  subtreeEndIdx: number;
  /** 0-based index of a `<!-- skillflow:… -->` comment directly above the heading, if any. */
  annotationIdx?: number;
};

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Scan ATX headings after any YAML frontmatter, skipping fenced code blocks (projector rules). */
function scanSections(lines: string[]): Section[] {
  type Heading = { level: number; title: string; idx: number };
  const headings: Heading[] = [];

  let start = 0;
  if (stripCr(lines[0] ?? "").trim() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      if (stripCr(lines[i] ?? "").trim() === "---") {
        start = i + 1;
        break;
      }
    }
  }

  let inFence = false;
  for (let i = start; i < lines.length; i += 1) {
    const line = stripCr(lines[i] ?? "");
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING_RE.exec(line);
    if (match && (match[2] ?? "").trim() !== "") {
      headings.push({ level: match[1]!.length, title: match[2]!.trim(), idx: i });
    }
  }

  // A heading's span starts at its own `<!-- skillflow:… -->` annotation comment (if any) — so a
  // PREVIOUS section's body/subtree ends BEFORE the next section's annotation (the annotation
  // belongs to the section it targets, even though the projector's anchor `endLine` runs up to the
  // next heading line itself).
  const annotationIdxs = headings.map((heading) => findAnnotationAbove(lines, heading.idx));
  const startOf = (h: number): number => annotationIdxs[h] ?? headings[h]!.idx;

  return headings.map((heading, h) => {
    const nextIdx = h + 1 < headings.length ? startOf(h + 1) : lines.length;
    let shallowerIdx = lines.length;
    for (let j = h + 1; j < headings.length; j += 1) {
      if (headings[j]!.level <= heading.level) {
        shallowerIdx = startOf(j);
        break;
      }
    }
    return {
      title: heading.title,
      level: heading.level,
      headingIdx: heading.idx,
      bodyEndIdx: nextIdx,
      subtreeEndIdx: shallowerIdx,
      annotationIdx: annotationIdxs[h],
    };
  });
}

/** The `<!-- skillflow:… -->` comment sitting directly above a heading (blank lines tolerated). */
function findAnnotationAbove(lines: string[], headingIdx: number): number | undefined {
  let k = headingIdx - 1;
  while (k >= 0 && stripCr(lines[k] ?? "").trim() === "") k -= 1;
  if (k < 0) return undefined;
  const match = /^<!--\s*(.*?)\s*-->$/.exec(stripCr(lines[k] ?? "").trim());
  if (match && (match[1] ?? "").trim().startsWith(SKILLFLOW_ANNOTATION_PREFIX)) return k;
  return undefined;
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** The 0-based START of a section's full span: its annotation comment (if any), else its heading. */
function spanStart(section: Section): number {
  return section.annotationIdx ?? section.headingIdx;
}

/**
 * WP 5.2 — read a SECTION node's CURRENT body text: the exact span `update_section_body` would
 * replace (the lines between its heading and the next heading of ANY level, i.e. excluding child
 * subsections), trimmed of outer blank lines and with any trailing `\r` stripped per line. Returns
 * `undefined` when `nodeId` isn't a heading-anchored section node or its heading can't be located in
 * `skillMd` — never a guess. Exported so the suggestion engine (`suggestions.ts`) can compose a new
 * body (current text + an appended sentence) through the SAME section-scanning rules
 * `applyEditOps` itself uses, guaranteeing the two agree on what "the body" means.
 */
export function readSectionBody(
  skillMd: string,
  graph: SkillGraph,
  nodeId: string,
): string | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !isSectionNode(node)) return undefined;
  const lines = skillMd.split("\n");
  const sections = scanSections(lines);
  const section = sections.find((candidate) => candidate.headingIdx + 1 === node.anchor.startLine);
  if (!section) return undefined;
  return lines
    .slice(section.headingIdx + 1, section.bodyEndIdx)
    .map(stripCr)
    .join("\n")
    .trim();
}

// --- Splice collection ----------------------------------------------------------------------------

type Splice = { start: number; deleteCount: number; insert: string[] };

/**
 * Register a splice unless it overlaps one already collected (composing ops must touch disjoint
 * ranges; a pure insertion may sit at a boundary but not strictly inside a deleted range).
 * Returns false (with a warning) on overlap — the op is skipped, never applied partially.
 */
function addSplice(
  splices: Splice[],
  warnings: string[],
  opLabel: string,
  start: number,
  deleteCount: number,
  insert: string[],
): boolean {
  for (const other of splices) {
    if (overlaps(start, deleteCount, other.start, other.deleteCount)) {
      warnings.push(`${opLabel}: its line range overlaps an earlier edit in this batch; skipped.`);
      return false;
    }
  }
  splices.push({ start, deleteCount, insert });
  return true;
}

function overlaps(aStart: number, aDel: number, bStart: number, bDel: number): boolean {
  if (aDel === 0 && bDel === 0) return aStart === bStart; // two insertions at one point: ambiguous
  if (aDel === 0) return aStart > bStart && aStart < bStart + bDel;
  if (bDel === 0) return bStart > aStart && bStart < aStart + aDel;
  return aStart < bStart + bDel && bStart < aStart + aDel;
}

// --- Per-op appliers -------------------------------------------------------------------------------

/** rename_node → rewrite ONLY the heading line's text (level prefix + any trailing CR preserved). */
function applyRename(
  op: Extract<SkillEditOp, { op: "rename_node" }>,
  section: Section | undefined,
  lines: string[],
  splices: Splice[],
  warnings: string[],
): void {
  if (!section) return;
  const original = lines[section.headingIdx] ?? "";
  const lineCr = original.endsWith("\r") ? "\r" : "";
  const hashes = "#".repeat(section.level);
  addSplice(splices, warnings, "rename_node", section.headingIdx, 1, [
    `${hashes} ${op.label.trim()}${lineCr}`,
  ]);
}

/**
 * update_section_body → replace the lines between the heading and the section end, EXCLUSIVE of
 * nested subsection headings (body = up to the first child heading or section end — a child
 * section is its own node and is edited through its own anchor). The new body is wrapped in single
 * blank lines to keep the document's one-blank-line separation style.
 */
function applyUpdateBody(
  op: Extract<SkillEditOp, { op: "update_section_body" }>,
  section: Section | undefined,
  lines: string[],
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  if (!section) return;
  const start = section.headingIdx + 1;
  const deleteCount = section.bodyEndIdx - start;
  const bodyLines = normalizeBody(op.body);
  const atEof = section.bodyEndIdx >= lines.length;
  // One blank line after the heading, one before the next heading (or a trailing newline at EOF).
  const insert = ["", ...bodyLines, ""].map((line) => `${line}${cr}`);
  if (atEof && insert.length > 0) insert[insert.length - 1] = ""; // bare final sentinel (no CR)
  addSplice(splices, warnings, "update_section_body", start, Math.max(deleteCount, 0), insert);
}

/**
 * add_subroutine → insert a new `## Title` (+ optional body) AFTER the target section's full span
 * (subtree end), or at the document end for `afterNodeId: null`, separated by one blank line.
 */
function applyAddSubroutine(
  op: Extract<SkillEditOp, { op: "add_subroutine" }>,
  lines: string[],
  nodesById: Map<string, SkillGraphNode>,
  byHeadingLine: Map<number, Section>,
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  let insertAt = lines.length;
  if (op.afterNodeId !== null) {
    const node = nodesById.get(op.afterNodeId);
    const section = node ? byHeadingLine.get(node.anchor.startLine) : undefined;
    if (!node || !section || !isSectionNode(node)) {
      warnings.push(
        `add_subroutine: afterNodeId "${op.afterNodeId}" is not a heading-anchored section; skipped.`,
      );
      return;
    }
    insertAt = section.subtreeEndIdx;
  }

  const bodyLines = op.body !== undefined ? normalizeBody(op.body) : [];
  const block: string[] = [`## ${op.title.trim()}`];
  if (bodyLines.length > 0) block.push("", ...bodyLines);

  insertSectionBlock("add_subroutine", lines, insertAt, block, splices, warnings, cr);
}

/**
 * Splice a section BLOCK (a heading + optional body, no outer separators) into `lines` at the 0-based
 * exclusive index `insertAt`, normalizing exactly one blank line of separation on each side that
 * needs it. EOF handling preserves the document's trailing-newline style: a document that ends with a
 * newline keeps the sentinel as the separating blank; one that does NOT end with a newline gets its
 * trailing newline created INSIDE the inserted span (outside-span bytes stay identical). Shared by
 * `add_subroutine` and `add_command`.
 */
function insertSectionBlock(
  opLabel: string,
  lines: string[],
  insertAt: number,
  block: string[],
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  const b = [...block];
  const prev = insertAt > 0 ? stripCr(lines[insertAt - 1] ?? "") : undefined;
  const atEof = insertAt >= lines.length;
  if (atEof) {
    if (prev !== undefined && prev.trim() !== "") {
      // Document does not end with a newline: open with a blank line, keep the no-trailing-newline style.
      b.unshift("");
      addSplice(
        splices,
        warnings,
        opLabel,
        insertAt,
        0,
        b.map((l) => `${l}${cr}`),
      );
    } else {
      // The trailing-newline sentinel becomes the separating blank line; restore it at the end.
      const insert = [...b.map((l) => `${l}${cr}`), ""];
      addSplice(splices, warnings, opLabel, insertAt, 0, insert);
    }
    return;
  }

  if (prev !== undefined && prev.trim() !== "") b.unshift("");
  const next = stripCr(lines[insertAt] ?? "");
  if (next.trim() !== "") b.push("");
  addSplice(
    splices,
    warnings,
    opLabel,
    insertAt,
    0,
    b.map((l) => `${l}${cr}`),
  );
}

/**
 * remove_node → SECTION nodes: remove the full anchored span (annotation comment + heading +
 * subtree). ACCESSORY nodes (asset / inferred gate / loop guard): removal is not a safe text
 * deletion — it means editing the sentence that references the file — so it degrades to a warning
 * + skip (the UI uses `update_section_body` for that).
 */
function applyRemove(
  op: Extract<SkillEditOp, { op: "remove_node" }>,
  node: SkillGraphNode | undefined,
  byHeadingLine: Map<number, Section>,
  splices: Splice[],
  warnings: string[],
): void {
  if (!node) {
    warnings.push(`remove_node: unknown nodeId "${op.nodeId}"; skipped.`);
    return;
  }
  const section = byHeadingLine.get(node.anchor.startLine);
  if (!section || !isSectionNode(node)) {
    warnings.push(
      `remove_node: "${op.nodeId}" is a ${node.kind} accessory — removing it means editing the sentence that references it; use update_section_body on its section instead. Skipped.`,
    );
    return;
  }
  const start = spanStart(section);
  addSplice(splices, warnings, "remove_node", start, section.subtreeEndIdx - start, []);
}

/** reorder → cut the section's full span and re-insert it after the target's span (null = front). */
function applyReorder(
  op: Extract<SkillEditOp, { op: "reorder" }>,
  lines: string[],
  sections: Section[],
  sectionFor: (op: SkillEditOp, nodeId: string) => Section | undefined,
  splices: Splice[],
  warnings: string[],
): void {
  const section = sectionFor(op, op.nodeId);
  if (!section) return;

  let destIdx: number;
  if (op.afterNodeId === null) {
    const first = sections[0];
    if (!first) return;
    destIdx = spanStart(first);
  } else {
    const target = sectionFor(op, op.afterNodeId);
    if (!target) return;
    destIdx = target.subtreeEndIdx;
  }

  const start = spanStart(section);
  const end = section.subtreeEndIdx;
  if (destIdx >= start && destIdx <= end) {
    warnings.push(`reorder: "${op.nodeId}" would move onto itself (no-op); skipped.`);
    return;
  }

  const block = lines.slice(start, end); // verbatim — the moved bytes are preserved exactly
  // Register the insertion first so a failed overlap check never leaves a half-applied move.
  if (!addSplice(splices, warnings, "reorder", destIdx, 0, block)) return;
  if (!addSplice(splices, warnings, "reorder", start, end - start, [])) {
    splices.pop(); // roll back the insertion — never apply half a move
  }
}

/**
 * set_edge_condition → gatekeeper edges: rewrite ONLY the condition text inside the branching
 * sentence, IF the edge's anchor pins it (the current condition text must be found verbatim on a
 * single line within the anchor's range). An edge without an anchor/condition, or a condition the
 * anchor can't locate, degrades to a warning + skip — never a guess.
 */
function applyEdgeCondition(
  op: Extract<SkillEditOp, { op: "set_edge_condition" }>,
  graph: SkillGraph,
  lines: string[],
  splices: Splice[],
  warnings: string[],
): void {
  const edge = graph.edges.find((candidate) => candidate.id === op.edgeId);
  if (!edge) {
    warnings.push(`set_edge_condition: unknown edgeId "${op.edgeId}"; skipped.`);
    return;
  }
  if (!edge.anchor || !edge.condition) {
    warnings.push(
      `set_edge_condition: edge "${op.edgeId}" has no anchor pinning its condition text; skipped.`,
    );
    return;
  }
  for (let i = edge.anchor.startLine - 1; i < Math.min(edge.anchor.endLine, lines.length); i += 1) {
    const line = lines[i] ?? "";
    if (line.includes(edge.condition)) {
      addSplice(splices, warnings, "set_edge_condition", i, 1, [
        line.replace(edge.condition, op.condition.trim()),
      ]);
      return;
    }
  }
  warnings.push(
    `set_edge_condition: condition "${edge.condition}" of edge "${op.edgeId}" was not found within its anchor; skipped.`,
  );
}

/**
 * add_asset_ref / connect_asset → append a reference sentence to the section body's end (one blank
 * line above). Both ops share this exact body-append mechanic (connect_asset is the edge-aware I2
 * alias): the only difference is the warning label. A `sentence` overrides the default `See \`p\`.`.
 */
function applyAssetRef(
  opLabel: "add_asset_ref" | "connect_asset",
  path: string,
  sentence: string | undefined,
  section: Section | undefined,
  lines: string[],
  files: SkillFileNode[],
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  if (!section) return;
  if (!files.some((file) => file.path === path)) {
    warnings.push(
      `${opLabel}: "${path}" is not a file of this version — the reference is inserted but will project as a missing-file warning.`,
    );
  }
  const text = sentence?.trim() || `See \`${path}\`.`;
  appendToBodyEnd(section, lines, splices, warnings, opLabel, text, cr);
}

/**
 * add_tool_ref (Skill IDE WP 8.3, I9.3) → append a tool-REFERENCE sentence to the section body's end,
 * reusing the SAME body-append splice (`appendToBodyEnd`) as add_asset_ref / connect_asset — no
 * duplicated splice logic. The default sentence `Call \`<tool>\`.` deliberately carries BOTH the
 * backticked identifier AND the "Call" context word `extract-tools.ts`'s conservative heuristic needs,
 * so re-projecting the edited SKILL.md lifts it back into a `tool_ref` node. A caller `sentence`
 * overrides the default. Unlike an asset ref there is no file to check — `server` scopes the reference
 * for binding/validation but does not change the appended prose (the reference is the bare tool name).
 */
function applyToolRef(
  op: Extract<SkillEditOp, { op: "add_tool_ref" }>,
  section: Section | undefined,
  lines: string[],
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  if (!section) return;
  const text = op.sentence?.trim() || `Call \`${op.tool}\`.`;
  appendToBodyEnd(section, lines, splices, warnings, "add_tool_ref", text, cr);
}

/**
 * set_gate_expectation → rewrite the expectation sentence at the gate's anchor when the current
 * expectation text is locatable on a single line; otherwise append the new expectation to the
 * gate's section body with a warning.
 */
function applyGateExpectation(
  op: Extract<SkillEditOp, { op: "set_gate_expectation" }>,
  node: SkillGraphNode | undefined,
  byHeadingLine: Map<number, Section>,
  lines: string[],
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  if (!node || node.kind !== "validation_gate") {
    warnings.push(`set_gate_expectation: node "${op.nodeId}" is not a validation gate; skipped.`);
    return;
  }
  const section = byHeadingLine.get(node.anchor.startLine);
  if (!section) {
    warnings.push(`set_gate_expectation: gate "${op.nodeId}" has no locatable section; skipped.`);
    return;
  }
  const expectation = op.expectation.trim();
  const current = node.expectation;
  if (current) {
    for (let i = section.headingIdx + 1; i < section.bodyEndIdx; i += 1) {
      const line = lines[i] ?? "";
      if (line.includes(current)) {
        addSplice(splices, warnings, "set_gate_expectation", i, 1, [
          line.replace(current, expectation),
        ]);
        return;
      }
    }
  }
  warnings.push(
    `set_gate_expectation: the current expectation sentence of "${op.nodeId}" spans lines or was not found; appended the new expectation to the section body instead.`,
  );
  appendToBodyEnd(section, lines, splices, warnings, "set_gate_expectation", expectation, cr);
}

/**
 * set_annotation → insert or update the `<!-- skillflow:kind id=… -->` comment directly above the
 * section's heading (the D2 annotation format `annotations.ts` parses).
 */
function applyAnnotation(
  op: Extract<SkillEditOp, { op: "set_annotation" }>,
  section: Section | undefined,
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  if (!section) return;
  const comment = `<!-- ${SKILLFLOW_ANNOTATION_PREFIX}${op.kind} id=${op.id.trim()} -->${cr}`;
  if (section.annotationIdx !== undefined) {
    addSplice(splices, warnings, "set_annotation", section.annotationIdx, 1, [comment]);
  } else {
    addSplice(splices, warnings, "set_annotation", section.headingIdx, 0, [comment]);
  }
}

// --- Skill IDE WP 2.1 appliers (command CRUD, keywords, asset disconnect) -------------------------

/**
 * add_command → insert a new `## /command [title]` section (+ optional body) after the last section
 * of the reference flow (`afterFlowId`), or at the document end when `afterFlowId` is absent. Reuses
 * `insertSectionBlock` so the blank-line + trailing-newline discipline is identical to add_subroutine
 * (a doc without a trailing newline gets one INSIDE the inserted span). Duplicate-token / unknown-flow
 * rejection is the validator's job (400); here an unresolvable flow degrades to document-end + warning.
 */
function applyAddCommand(
  op: Extract<SkillEditOp, { op: "add_command" }>,
  lines: string[],
  graph: SkillGraph,
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  let insertAt = lines.length;
  if (op.afterFlowId !== undefined) {
    const end = flowEndLine(graph, op.afterFlowId);
    if (end === undefined) {
      warnings.push(
        `add_command: afterFlowId "${op.afterFlowId}" has no sections to insert after; appended at the document end.`,
      );
    } else {
      // `end` is a 1-based inclusive last line; the 0-based index just AFTER it is the insert point.
      insertAt = end;
    }
  }

  const title = op.title?.trim();
  const heading = `## ${op.command.trim()}${title ? ` ${title}` : ""}`;
  const bodyLines = op.body !== undefined ? normalizeBody(op.body) : [];
  const block: string[] = [heading];
  if (bodyLines.length > 0) block.push("", ...bodyLines);

  insertSectionBlock("add_command", lines, insertAt, block, splices, warnings, cr);
}

/** The 1-based last document line occupied by any node of `flowId` (its last section's body end). */
function flowEndLine(graph: SkillGraph, flowId: string): number | undefined {
  let maxEnd = -1;
  for (const node of graph.nodes) {
    if ((node.flowId ?? DEFAULT_SKILL_FLOW_ID) === flowId) {
      maxEnd = Math.max(maxEnd, node.anchor.endLine);
    }
  }
  return maxEnd >= 0 ? maxEnd : undefined;
}

/**
 * rename_command → rewrite ONLY the leading `/token` of the command's heading line, preserving the
 * heading level, spacing, any trailing title words, a trailing CR, AND any `skillflow:command id=`
 * annotation pin above it (that comment line is never in the spliced range). A node that isn't a
 * `/command` entry point, or a heading with no `/token`, degrades to a warning + skip.
 */
function applyRenameCommand(
  op: Extract<SkillEditOp, { op: "rename_command" }>,
  node: SkillGraphNode | undefined,
  byHeadingLine: Map<number, Section>,
  lines: string[],
  splices: Splice[],
  warnings: string[],
): void {
  if (!node) {
    warnings.push(`rename_command: unknown nodeId "${op.nodeId}"; skipped.`);
    return;
  }
  if (node.kind !== "entry_point" || node.trigger.type !== "command") {
    warnings.push(
      `rename_command: "${op.nodeId}" (${node.kind}) is not a /command entry point; skipped.`,
    );
    return;
  }
  const section = byHeadingLine.get(node.anchor.startLine);
  if (!section) {
    warnings.push(`rename_command: no locatable heading for "${op.nodeId}"; skipped.`);
    return;
  }
  const original = lines[section.headingIdx] ?? "";
  const lineCr = original.endsWith("\r") ? "\r" : "";
  const bare = lineCr ? original.slice(0, -1) : original;
  // Capture: heading hashes + space | the leading /token | the remainder (title words, closing #s).
  const match = /^(#{1,6}\s+)(\/\S+)(.*)$/.exec(bare);
  if (!match) {
    warnings.push(
      `rename_command: heading of "${op.nodeId}" has no /command token to rewrite; skipped.`,
    );
    return;
  }
  addSplice(splices, warnings, "rename_command", section.headingIdx, 1, [
    `${match[1]}${op.command.trim()}${match[3]}${lineCr}`,
  ]);
}

/**
 * delete_command → remove the command's WHOLE flow subtree: from the entry section's span start (its
 * `skillflow:command` pin if present, else its heading) through the end of the flow (the next
 * same-or-higher-level heading, i.e. the entry section's `subtreeEndIdx`). Shared assets survive (only
 * text inside this span is cut; bundled files are never touched). Cross-flow references TO this
 * command that live in OTHER flows are outside the span and are left untouched (they become dangling).
 */
function applyDeleteCommand(
  op: Extract<SkillEditOp, { op: "delete_command" }>,
  node: SkillGraphNode | undefined,
  byHeadingLine: Map<number, Section>,
  splices: Splice[],
  warnings: string[],
): void {
  if (!node) {
    warnings.push(`delete_command: unknown nodeId "${op.nodeId}"; skipped.`);
    return;
  }
  if (node.kind !== "entry_point" || node.trigger.type !== "command") {
    warnings.push(
      `delete_command: "${op.nodeId}" (${node.kind}) is not a /command entry point; skipped.`,
    );
    return;
  }
  const section = byHeadingLine.get(node.anchor.startLine);
  if (!section) {
    warnings.push(`delete_command: no locatable heading for "${op.nodeId}"; skipped.`);
    return;
  }
  const start = spanStart(section);
  addSplice(splices, warnings, "delete_command", start, section.subtreeEndIdx - start, []);
}

/**
 * set_keywords → create or update the frontmatter `keywords:` list, YAML-safe via the `yaml` package.
 * Splices ONLY the `keywords:` block (its key line through its indented list items), leaving every
 * other frontmatter byte verbatim. If there is no `keywords:` key it is inserted just before the
 * closing `---`; if there is no frontmatter at all a minimal `---\nkeywords: …\n---\n` is inserted at
 * byte 0. Never re-serializes the whole frontmatter.
 */
function applySetKeywords(
  op: Extract<SkillEditOp, { op: "set_keywords" }>,
  lines: string[],
  splices: Splice[],
  warnings: string[],
  cr: string,
): void {
  const keywords = op.keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword !== "");
  const blockLines = stringifyYaml({ keywords }).replace(/\n+$/, "").split("\n");

  if (stripCr(lines[0] ?? "").trim() !== "---") {
    // No frontmatter: insert a fresh block at byte 0 (blank line separates it from the body).
    const insert = ["---", ...blockLines, "---", ""].map((line) => `${line}${cr}`);
    addSplice(splices, warnings, "set_keywords", 0, 0, insert);
    return;
  }

  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (stripCr(lines[i] ?? "").trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    warnings.push("set_keywords: frontmatter is opened but never closed; skipped.");
    return;
  }

  let keyIdx = -1;
  for (let i = 1; i < close; i += 1) {
    if (/^keywords\s*:/.test(stripCr(lines[i] ?? ""))) {
      keyIdx = i;
      break;
    }
  }
  const insert = blockLines.map((line) => `${line}${cr}`);
  if (keyIdx >= 0) {
    // Replace the existing block: the key line plus its indented continuation lines (list items).
    let end = keyIdx + 1;
    while (end < close && /^\s+\S/.test(stripCr(lines[end] ?? ""))) end += 1;
    addSplice(splices, warnings, "set_keywords", keyIdx, end - keyIdx, insert);
  } else {
    // No keywords key yet — insert just before the closing `---` (preserving every other key).
    addSplice(splices, warnings, "set_keywords", close, 0, insert);
  }
}

/**
 * disconnect_asset → remove the sentence referencing `path` from the node's section body, but ONLY
 * when that reference is exactly locatable on a SINGLE line (the path appears on one body line). If it
 * is on zero or multiple lines, degrade to a warning + skip rather than guess which text to cut. A
 * file that stays referenced elsewhere (or is otherwise unused) survives — only this one line is cut.
 */
function applyDisconnectAsset(
  op: Extract<SkillEditOp, { op: "disconnect_asset" }>,
  section: Section | undefined,
  lines: string[],
  splices: Splice[],
  warnings: string[],
): void {
  if (!section) return;
  const hits: number[] = [];
  for (let i = section.headingIdx + 1; i < section.bodyEndIdx; i += 1) {
    if (stripCr(lines[i] ?? "").includes(op.path)) hits.push(i);
  }
  if (hits.length === 0) {
    warnings.push(
      `disconnect_asset: "${op.path}" is not referenced in the body of node "${op.nodeId}"; skipped.`,
    );
    return;
  }
  if (hits.length > 1) {
    warnings.push(
      `disconnect_asset: "${op.path}" is referenced on ${hits.length} lines of node "${op.nodeId}"; not removing (would need to guess which). Skipped.`,
    );
    return;
  }
  addSplice(splices, warnings, "disconnect_asset", hits[0]!, 1, []);
}

// --- Small helpers ---------------------------------------------------------------------------------

/** Split a caller-provided body into bare lines (any EOL style) with outer blank lines trimmed. */
function normalizeBody(body: string): string[] {
  const bodyLines = body.split(/\r?\n/);
  while (bodyLines.length > 0 && (bodyLines[0] ?? "").trim() === "") bodyLines.shift();
  while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? "").trim() === "") {
    bodyLines.pop();
  }
  return bodyLines;
}

/** Insert `sentence` as a new paragraph after the last non-blank body line of `section`. */
function appendToBodyEnd(
  section: Section,
  lines: string[],
  splices: Splice[],
  warnings: string[],
  opLabel: string,
  sentence: string,
  cr: string,
): void {
  let last = -1;
  for (let i = section.headingIdx + 1; i < section.bodyEndIdx; i += 1) {
    if (stripCr(lines[i] ?? "").trim() !== "") last = i;
  }
  if (last >= 0) {
    addSplice(
      splices,
      warnings,
      opLabel,
      last + 1,
      0,
      ["", sentence].map((l) => `${l}${cr}`),
    );
    return;
  }
  // Empty body (heading directly followed by the next heading / EOF): open a new paragraph.
  const insert = ["", sentence].map((l) => `${l}${cr}`);
  const next =
    section.headingIdx + 1 < lines.length
      ? stripCr(lines[section.headingIdx + 1] ?? "")
      : undefined;
  if (next !== undefined && next.trim() !== "") insert.push(`${cr}`);
  addSplice(splices, warnings, opLabel, section.headingIdx + 1, 0, insert);
}
