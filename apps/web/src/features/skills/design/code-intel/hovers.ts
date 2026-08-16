import type { BoundTool, SkillGraph } from "@mcp-token-footprint/shared";
import {
  EXPLAINERS,
  explainerFor,
  explainerHoverMarkdown,
  type ExplainerEntry,
} from "./explainers";
import type { Disposable, MonacoApi, MonacoEditor, MonacoModel } from "./monaco-types";
import { matchToolReferences } from "./tool-references";

// Skill IDE WP 9.3 (I10.5), reworked by Skill Studio WP 7.5 (SI7) — the construct-hover provider:
// hover ANY SKILL.md construct and get its explainer-registry entry + a guide anchor. Scoped to ONE
// editor's model (like WP 8.2's providers).
//
// TOOL-REF RESOLUTION (WP 7.5) now runs through the same pure `matchToolReferences` matcher the
// decorations use, so hover and underline can never disagree:
//   • a BACKTICKED KNOWN token is DEFERRED to WP 8.2's provider (`registerBoundToolProviders`,
//     registered on the SAME editor) — this hover returns null for it, so exactly one hover fires;
//   • a BARE known token (or a known name inside a longer code span / fenced example — contexts
//     WP 8.2 never fires on) gets the full bound-tool card HERE: name · owning server · description ·
//     parameters · definition token cost · a scan-derived note;
//   • a BACKTICKED unknown-toollike span gets a warning note + the `ref:tool` explainer when the
//     skill has scanned bound tools, and the plain explainer when it is unbound (honest degradation —
//     with no scan there is no basis to call it unknown, but the token still teaches).

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ANNOTATION_LINE_RE = /^\s*<!--\s*skillflow:(\w+)\b[^>]*-->\s*$/;
const BREADCRUMB_RE = /\[\s*skillflow:[^\]]*\]/g;
const FRONTMATTER_KEY_RE = /^(\s*)([A-Za-z_][\w-]*):/;

/** The frontmatter keys with a dedicated explainer (everything else is tolerated metadata). */
const FRONTMATTER_KEYS = new Set(["name", "description", "keywords", "servers"]);

export type ConstructHoverContext = {
  /** The current LIVE projection (draft graph) — read lazily so the hover always sees the latest. */
  getGraph: () => SkillGraph | null;
  /** The bound tools (WP 8.2's list) — read lazily so an async-arriving list is seen immediately. */
  getBoundTools: () => readonly BoundTool[];
};

/**
 * Register the construct-hover provider on `editor`'s model and return a disposer. Registered ONCE per
 * mount, disposed on unmount (the dispose invariant) — Monaco keeps hover providers on the shared
 * language registry, so leaking one would double every hover on the next mount.
 */
export function registerConstructHovers(
  monacoApi: MonacoApi,
  editor: MonacoEditor,
  ctx: ConstructHoverContext,
): Disposable {
  const provider = monacoApi.languages.registerHoverProvider("markdown", {
    provideHover(model, position) {
      if (model !== editor.getModel()) return null;
      const resolved = resolveConstruct(model, position.lineNumber, position.column, ctx);
      if (!resolved) return null;
      const { contents, range } = resolved;
      return {
        range: {
          startLineNumber: range.line,
          startColumn: range.startColumn,
          endLineNumber: range.line,
          endColumn: range.endColumn,
        },
        contents: contents.map((value) => ({ value })),
      };
    },
  });
  return { dispose: () => provider.dispose() };
}

type HoverRange = { line: number; startColumn: number; endColumn: number };
type ResolvedHover = { contents: string[]; range: HoverRange };

/** Wrap one explainer entry as a resolved hover (the shape every non-tool construct returns). */
function explainerHover(entry: ExplainerEntry, range: HoverRange): ResolvedHover {
  return { contents: [explainerHoverMarkdown(entry)], range };
}

/** Resolve the construct under `(line, column)` to hover markdown + the range to underline. */
function resolveConstruct(
  model: MonacoModel,
  line: number,
  column: number,
  ctx: ConstructHoverContext,
): ResolvedHover | null {
  const text = model.getLineContent(line);
  const fullRange: HoverRange = { line, startColumn: 1, endColumn: text.length + 1 };

  // 1) A `<!-- skillflow:KEYWORD … -->` annotation line.
  const annotation = ANNOTATION_LINE_RE.exec(text);
  if (annotation) {
    const entry = explainerFor(`annotation:${annotation[1]}`);
    return entry ? explainerHover(entry, fullRange) : null;
  }

  // 2) A breadcrumb marker `[skillflow:…]` under the cursor (may sit inside body prose).
  for (const marker of text.matchAll(BREADCRUMB_RE)) {
    const startColumn = (marker.index ?? 0) + 1;
    const endColumn = startColumn + marker[0].length;
    if (column >= startColumn && column <= endColumn) {
      const entry = explainerFor("breadcrumb:marker");
      return entry ? explainerHover(entry, { line, startColumn, endColumn }) : null;
    }
  }

  // 3) A frontmatter key (inside the leading `---`…`---` block, key at line start).
  if (inFrontmatter(model, line)) {
    const key = FRONTMATTER_KEY_RE.exec(text);
    if (key) {
      const startColumn = (key[1]?.length ?? 0) + 1;
      const endColumn = startColumn + (key[2]?.length ?? 0);
      if (column >= startColumn && column <= endColumn && FRONTMATTER_KEYS.has(key[2] ?? "")) {
        const entry = explainerFor(`frontmatter:${key[2]}`);
        return entry ? explainerHover(entry, { line, startColumn, endColumn }) : null;
      }
    }
    return null; // inside frontmatter but not on a known key — nothing to teach
  }

  // 4) A tool reference under the cursor — resolved through the SAME matcher as the decorations
  //    (WP 7.5), so a decorated token always answers a hover and vice versa.
  const boundTools = ctx.getBoundTools();
  const toolHover = resolveToolHover(model, line, column, boundTools);
  if (toolHover !== "none") return toolHover;

  // 5) A relative-path asset reference (a path an `asset` node cites on this line).
  const graph = ctx.getGraph();
  if (graph) {
    for (const node of graph.nodes) {
      if (node.kind !== "asset") continue;
      if (line < node.anchor.startLine || line > node.anchor.endLine) continue;
      const idx = text.indexOf(node.path);
      if (idx < 0) continue;
      const startColumn = idx + 1;
      const endColumn = startColumn + node.path.length;
      if (column >= startColumn && column <= endColumn) {
        const entry = explainerFor("ref:asset");
        return entry ? explainerHover(entry, { line, startColumn, endColumn }) : null;
      }
    }
  }

  // 6) A heading → its section node's kind (falling back to /command trigger when unprojected).
  const heading = HEADING_RE.exec(text);
  if (heading && (heading[2] ?? "").trim() !== "") {
    const kind = sectionKindAtLine(graph, line);
    const isCommand = (heading[2] ?? "").trim().startsWith("/");
    const id = kind ?? (isCommand ? "trigger:command" : "subroutine");
    const entry = EXPLAINERS[id];
    const startColumn = (heading[1]?.length ?? 0) + 2;
    const endColumn = text.length + 1;
    return entry ? explainerHover(entry, { line, startColumn, endColumn }) : null;
  }

  return null;
}

/**
 * Resolve a tool-reference hover at `(line, column)` via the pure matcher. Returns:
 *   • `"none"` — no tool reference here (the caller continues to the next construct);
 *   • `null`  — a BACKTICKED KNOWN token: WP 8.2's hover owns it (exactly one hover fires);
 *   • a hover — a bare/embedded known reference (full bound-tool card) or an unknown-toollike span
 *     (warning note when validated, plain explainer when unbound).
 */
function resolveToolHover(
  model: MonacoModel,
  line: number,
  column: number,
  boundTools: readonly BoundTool[],
): ResolvedHover | null | "none" {
  const knownNames = boundTools.map((tool) => tool.toolName);
  const matches = matchToolReferences(model.getValue(), knownNames);
  const at = matches.find(
    (match) => match.line === line && column >= match.startColumn && column <= match.endColumn,
  );

  if (at) {
    const range: HoverRange = { line, startColumn: at.startColumn, endColumn: at.endColumn };
    if (at.kind === "known") {
      if (at.backticked) return null; // WP 8.2's hover owns backticked bound tools — no double hover
      const cards = boundTools
        .filter((tool) => tool.toolName === at.name)
        .map((tool) => boundToolHoverMarkdown(tool));
      return cards.length > 0 ? { contents: cards, range } : "none";
    }
    // unknown-toollike (always backticked, by construction).
    const entry = explainerFor("ref:tool");
    if (knownNames.length === 0) {
      // Unbound / no completed scan: no basis to call it unknown — teach the construct, plainly.
      return entry ? explainerHover(entry, range) : "none";
    }
    const warning = `**Unknown tool reference** — \`${at.name}\` isn’t in the bound servers’ latest scans. Check the spelling against the Tools palette, or re-scan the server.`;
    return { contents: entry ? [warning, explainerHoverMarkdown(entry)] : [warning], range };
  }

  return "none"; // no tool reference under the cursor — fall through to asset/heading resolution
}

/** The node kind of the section whose heading is on `line` (the first section-kind node there). */
function sectionKindAtLine(graph: SkillGraph | null, line: number): string | null {
  if (!graph) return null;
  for (const node of graph.nodes) {
    if (node.anchor.startLine !== line) continue;
    if (
      node.kind === "entry_point" ||
      node.kind === "subroutine" ||
      node.kind === "gatekeeper" ||
      node.kind === "validation_gate"
    ) {
      return node.kind;
    }
  }
  return null;
}

/** Is `line` inside the leading `---`…`---` YAML frontmatter block? */
function inFrontmatter(model: MonacoModel, line: number): boolean {
  if (model.getLineContent(1).trim() !== "---") return false;
  const lineCount = model.getLineCount();
  for (let i = 2; i <= lineCount; i += 1) {
    if (model.getLineContent(i).trim() === "---") return line > 1 && line < i;
  }
  return false;
}

// ── The bound-tool hover card (WP 7.5) ──────────────────────────────────────────────────────────────
// Rendered for the contexts WP 8.2's hover never fires on (bare tokens, names inside longer code
// spans, fenced examples). Mirrors WP 8.2's card — name · owning server · description excerpt ·
// parameters · definition token cost — and adds the scan-derived note. (The card builder in
// `use-bound-tools.ts` is private to that module and also carries the editor-bound "Test this tool…"
// command id, which only exists inside WP 8.2's registration — so this stays a sibling, not a reuse.)

/** The hover markdown for one bound tool, with the scan-derived provenance note. */
export function boundToolHoverMarkdown(tool: BoundTool): string {
  const lines: string[] = [`**\`${tool.toolName}\`** · ${tool.serverName}`];
  if (tool.description) lines.push("", excerpt(tool.description, 240));
  if (tool.schemaParams.length > 0) {
    lines.push("", "**Parameters**", "");
    for (const param of tool.schemaParams) {
      lines.push(`- \`${param.name}\`: ${param.type}${param.required ? " _(required)_" : ""}`);
    }
  } else {
    lines.push("", "_No parameters._");
  }
  lines.push("", `Definition cost: **${tool.definitionTokens.toLocaleString()}** tokens`);
  lines.push("", `_From ${tool.serverName}’s latest completed scan._`);
  return lines.join("\n");
}

/** Trim to `max` chars on a word boundary with an ellipsis (single-spaced, newlines collapsed). */
function excerpt(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const clipped = collapsed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
