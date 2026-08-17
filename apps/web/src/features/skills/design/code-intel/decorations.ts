import {
  DEFAULT_SKILL_FLOW_ID,
  type SkillGraph,
  type SkillGraphNodeKind,
} from "@mcp-token-footprint/shared";
import { EXPLAINERS } from "./explainers";
import type { DeltaDecoration, MonacoApi, MonacoModel } from "./monaco-types";
import { matchToolReferences } from "./tool-references";

// Skill IDE WP 9.3 (I10.5), reworked by Skill Studio WP 7.5 (SI7) — the code-mode decoration set,
// split into TWO independent passes so each recomputes exactly when its inputs change:
//
//   • `computeGraphDecorations` — driven by the draft's LIVE projection (the `project-preview` graph
//     the UnifiedEditor pushes in): the KIND gutter glyph per heading, the FLOW-EXTENT rail per
//     /command flow, and the ASSET reference underlines (which need `node.path` + anchors).
//     Recomputed on every projection push; Monaco shifts the ranges through interim edits until the
//     next (debounced) projection replaces them.
//
//   • `computeTextDecorations` — driven by the editor's OWN model text + the bound-tool name list:
//     ANNOTATION + BREADCRUMB markers, and the TOOL reference decorations via the pure
//     `matchToolReferences` matcher. Recomputed on EVERY content change and whenever the bound-tool
//     list arrives/changes — this is the SI7 fix: tool decorations no longer depend on the stale,
//     debounced projection or on a `tool_ref` node's single anchor line, so bare occurrences, repeat
//     occurrences, and heading/bold occurrences all decorate, immediately.
//
// No fetch in either pass. Every colour is a semantic `@elabs-ai/components-tokens` var driven through the CSS
// classes below (`decorations.css`) — never a raw literal.

// ── CSS class names (styled in `decorations.css`, token-backed) ─────────────────────────────────────
const GUTTER = "skill-ci-gutter";
const FLOW = "skill-ci-flow";
const ANNOTATION_GLYPH = "skill-ci-annotation";
const ANNOTATION_TEXT = "skill-ci-annotation-text";
const BREADCRUMB_GLYPH = "skill-ci-breadcrumb";
const BREADCRUMB_TEXT = "skill-ci-breadcrumb-text";
const ASSET_REF = "skill-ci-asset-ref";
const TOOL_REF = "skill-ci-tool-ref";
const TOOL_REF_KNOWN = "skill-ci-tool-ref--known";
const TOOL_REF_UNKNOWN = "skill-ci-tool-ref--unknown";

/** How many distinct flow-lane colours the CSS provides (`--chart-1..5`) before cycling. */
const FLOW_COLOR_COUNT = 5;

/** The kinds that OWN a heading line (the first such node at a line drives that line's gutter glyph). */
const SECTION_KINDS: ReadonlySet<SkillGraphNodeKind> = new Set([
  "entry_point",
  "subroutine",
  "gatekeeper",
  "validation_gate",
]);

/** An ATX heading line — a kind gutter only lands on a real heading (not a frontmatter-anchored node). */
const HEADING_LINE_RE = /^#{1,6}\s/;
/** A heading-adjacent `<!-- skillflow:KEYWORD … -->` annotation line (the whole line is the comment). */
const ANNOTATION_LINE_RE = /^\s*<!--\s*skillflow:(\w+)\b[^>]*-->\s*$/;
/** A breadcrumb marker `[skillflow:…]` anywhere on a line (D7b — mirrors `SKILLFLOW_MARKER_PATTERN`). */
const BREADCRUMB_RE = /\[\s*skillflow:[^\]]*\]/;

function clamp(line: number, max: number): number {
  return Math.min(Math.max(line, 1), Math.max(max, 1));
}

/**
 * Build the GRAPH-driven decorations for `model` from the projected `graph`: kind gutters, flow
 * rails, and asset-reference underlines. Deterministic and pure (no I/O).
 */
export function computeGraphDecorations(
  monacoApi: MonacoApi,
  model: MonacoModel,
  graph: SkillGraph,
): DeltaDecoration[] {
  const decorations: DeltaDecoration[] = [];
  const lineCount = model.getLineCount();
  const Range = monacoApi.Range;
  const wholeLine = (line: number, className: string): DeltaDecoration => ({
    range: new Range(line, 1, line, 1),
    options: { isWholeLine: true, className },
  });

  // 1) KIND gutter per heading — the FIRST section-kind node at each heading line wins (the projector
  //    pushes the section node before any accessory node for that section, so first-in-document-order
  //    is the section's own node). A colour + shape per kind (see CSS); the glyph hover names the kind.
  //    Only ACTUAL heading lines get a gutter — a keyword `entry_point` is anchored to the frontmatter
  //    (not a heading), so it is skipped here (it reads as a trigger, not a section).
  const gutterSeen = new Set<number>();
  for (const node of graph.nodes) {
    if (!SECTION_KINDS.has(node.kind)) continue;
    const line = clamp(node.anchor.startLine, lineCount);
    if (gutterSeen.has(line) || !HEADING_LINE_RE.test(model.getLineContent(line))) continue;
    gutterSeen.add(line);
    const explainer = EXPLAINERS[node.kind];
    decorations.push({
      range: new Range(line, 1, line, 1),
      options: {
        glyphMarginClassName: `${GUTTER} ${GUTTER}--${node.kind}`,
        glyphMarginHoverMessage: { value: `**${explainer?.title ?? node.kind}** — ${node.label}` },
      },
    });
  }

  // 2) FLOW-EXTENT rail per /command flow. The `main` body flow is left untinted so command lanes read
  //    as distinct; each command flow tints its whole line-extent (min heading → max section end) with a
  //    stable colour by its order among command flows.
  const commandFlowIds = graph.flows
    ?.filter((flow) => flow.id !== DEFAULT_SKILL_FLOW_ID)
    .map((flow) => flow.id) ?? [
    ...new Set(
      graph.nodes
        .map((n) => n.flowId)
        .filter((id): id is string => !!id && id !== DEFAULT_SKILL_FLOW_ID),
    ),
  ];
  commandFlowIds.forEach((flowId, index) => {
    const inFlow = graph.nodes.filter((n) => (n.flowId ?? DEFAULT_SKILL_FLOW_ID) === flowId);
    if (inFlow.length === 0) return;
    const start = clamp(Math.min(...inFlow.map((n) => n.anchor.startLine)), lineCount);
    const end = clamp(Math.max(...inFlow.map((n) => n.anchor.endLine)), lineCount);
    const colorClass = `${FLOW}--${index % FLOW_COLOR_COUNT}`;
    for (let line = start; line <= end; line += 1) {
      decorations.push(wholeLine(line, `${FLOW} ${colorClass}`));
    }
  });

  // 3) ASSET reference underlines — the exact path token, located in the referencing node's line span.
  //    (TOOL references moved to `computeTextDecorations` — WP 7.5.)
  for (const node of graph.nodes) {
    if (node.kind !== "asset") continue;
    const hit = locateToken(
      model,
      node.anchor.startLine,
      node.anchor.endLine,
      lineCount,
      node.path,
    );
    if (hit) {
      decorations.push({
        range: new Range(hit.line, hit.startColumn, hit.line, hit.endColumn),
        options: { inlineClassName: ASSET_REF },
      });
    }
  }

  return decorations;
}

/**
 * Build the TEXT-driven decorations for `model`: annotation + breadcrumb markers, and tool-reference
 * decorations from the pure matcher. Pure over `(model text, knownToolNames)` — no graph, no fetch —
 * so the caller can recompute it on every keystroke and on every bound-tool push.
 *
 * Tool-reference styling: with a non-empty `knownToolNames`, KNOWN occurrences (bare + backticked)
 * get the known-reference underline and BACKTICKED unknown-toollike spans get the warning underline.
 * With an EMPTY list (unbound skill / no completed scan) there is no basis to validate, so backticked
 * toollike spans keep the NEUTRAL underline (the pre-7.5 look) and nothing is warned.
 */
export function computeTextDecorations(
  monacoApi: MonacoApi,
  model: MonacoModel,
  knownToolNames: readonly string[],
): DeltaDecoration[] {
  const decorations: DeltaDecoration[] = [];
  const lineCount = model.getLineCount();
  const Range = monacoApi.Range;

  // 1) ANNOTATION + BREADCRUMB markers — scanned from the model text (these constructs are not graph
  //    nodes: an annotation refines a node, a breadcrumb is a runtime instruction). Glyph + inline
  //    dotted underline; the rich explainer arrives via the hover provider.
  for (let line = 1; line <= lineCount; line += 1) {
    const text = model.getLineContent(line);
    if (ANNOTATION_LINE_RE.test(text)) {
      const from = text.indexOf("<!--") + 1;
      const to = text.lastIndexOf("-->") + 3 + 1; // 1-based end column, inclusive of `-->`
      decorations.push({
        range: new Range(line, from, line, to),
        options: { glyphMarginClassName: ANNOTATION_GLYPH, inlineClassName: ANNOTATION_TEXT },
      });
      continue;
    }
    const marker = BREADCRUMB_RE.exec(text);
    if (marker) {
      const from = marker.index + 1;
      const to = from + marker[0].length;
      decorations.push({
        range: new Range(line, from, line, to),
        options: { glyphMarginClassName: BREADCRUMB_GLYPH, inlineClassName: BREADCRUMB_TEXT },
      });
    }
  }

  // 2) TOOL reference decorations — every occurrence the matcher finds, classified.
  const validated = knownToolNames.length > 0;
  for (const match of matchToolReferences(model.getValue(), knownToolNames)) {
    const className =
      match.kind === "known"
        ? `${TOOL_REF} ${TOOL_REF_KNOWN}`
        : validated
          ? `${TOOL_REF} ${TOOL_REF_UNKNOWN}`
          : TOOL_REF;
    decorations.push({
      range: new Range(match.line, match.startColumn, match.line, match.endColumn),
      options: { inlineClassName: className },
    });
  }

  return decorations;
}

/** Find the first occurrence of `needle` in lines `[from, to]` (clamped), returning 1-based columns. */
function locateToken(
  model: MonacoModel,
  from: number,
  to: number,
  lineCount: number,
  needle: string,
): { line: number; startColumn: number; endColumn: number } | null {
  const start = clamp(from, lineCount);
  const end = clamp(to, lineCount);
  for (let line = start; line <= end; line += 1) {
    const idx = model.getLineContent(line).indexOf(needle);
    if (idx >= 0) return { line, startColumn: idx + 1, endColumn: idx + 1 + needle.length };
  }
  return null;
}
