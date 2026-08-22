// Skill IDE WP 9.3 → 9.4 (I10.5) — the ONE explainer registry the IDE teaches itself from, in BOTH
// modes. This module is the SINGLE SOURCE the whole education layer resolves through:
//   • WP 9.3 code-mode construct hovers (`hovers.ts` → `explainerFor` / `explainerHoverMarkdown`),
//   • WP 9.3 snippet completion docs (`snippets.ts` → each `SNIPPET_SPEC.explainerId`),
//   • WP 9.3 gutter-glyph hover titles (`decorations.ts` → `EXPLAINERS[kind]`),
//   • WP 9.4 `NodeDetailPanel` "What is this?" (per node kind → `explainerFor(kind)`),
//   • WP 9.4 canvas legend popover (`SkillGraphCanvas` → every node/edge kind → `explainerFor`),
//   • WP 9.4 unified problems panel (`ProblemsPanel` → each problem's guide anchor comes from here).
// `apps/api/test/skill-ide-explainers.test.ts` asserts that single source (every consumer id resolves)
// AND that every entry's `guideAnchor` is a real heading in `docs/skill-authoring.md`.
//
// One entry per SKILL.md element: `{ id, title, short, guideAnchor }`, each `guideAnchor` a real
// heading in `docs/skill-authoring.md` (the same `docs/skill-authoring.md#…` reference convention the
// quality engine + `quality-meta.ts` already use — there is no in-app docs route yet, so it surfaces as
// the repo file path/anchor). WP 9.4 EXPANDED the WP 9.3 set to the full element vocabulary — the 6
// node kinds + `tool_ref`, the edge kinds, frontmatter keys, annotation keywords, the breadcrumb
// marker, and the asset/tool references — without changing any 9.3 consumer's lookup. Every anchor here
// is one of the guide's stable top-level section anchors, so each resolves to a real heading.

import { SKILL_EDGE_KINDS, SKILL_GRAPH_NODE_KINDS } from "@mcp-token-footprint/shared";
import type {
  QualityReport,
  SkillGraph,
  SkillGraphNode,
  SkillGraphNodeKind,
  ToolDiagnostic,
} from "@mcp-token-footprint/shared";
import { parseUnknownToolWarning } from "./tool-references";

/** The authoring guide these anchors point into (kept next to the anchors so 9.4 can lift both). */
export const SKILL_AUTHORING_GUIDE = "docs/skill-authoring.md";

/** One explainer entry: a plain-language teaching card + its guide anchor. */
export type ExplainerEntry = {
  /** Stable id (a node kind, a `frontmatter:*`/`annotation:*`/`trigger:*`/`ref:*`/`breadcrumb:*` key). */
  id: string;
  /** Short human title, e.g. "Gatekeeper". */
  title: string;
  /** One or two sentences: what it is + why it matters. */
  short: string;
  /** A `docs/skill-authoring.md#<anchor>` reference (the guide section that explains it). */
  guideAnchor: string;
};

// The guide's stable top-level section anchors (GitHub-slugged), reused across many entries.
const G_IDENTITY = `${SKILL_AUTHORING_GUIDE}#1-identity--triggering-l1`;
const G_BODY = `${SKILL_AUTHORING_GUIDE}#2-body-structure--flows-l2`;
const G_REFS = `${SKILL_AUTHORING_GUIDE}#3-referenced-files-l3`;
const G_SCRIPTS = `${SKILL_AUTHORING_GUIDE}#4-scripts`;
const G_TOOLS = `${SKILL_AUTHORING_GUIDE}#5-tool--mcp-server-references`;

/**
 * The registry. Keyed by explainer id — hovers look up an entry, never hand-write teaching copy. Node
 * kinds are keyed by their `SkillGraphNodeKind`; everything else is namespaced (`frontmatter:` /
 * `annotation:` / `trigger:` / `ref:` / `breadcrumb:`).
 */
export const EXPLAINERS: Record<string, ExplainerEntry> = {
  // ── Graph node kinds (headings → kind) ──────────────────────────────────────────────────────────
  entry_point: {
    id: "entry_point",
    title: "Entry point",
    short:
      "A `/command` or keyword heading that heads its own flow — the “start here” for that invocation. Give every entry point a distinct trigger.",
    guideAnchor: G_IDENTITY,
  },
  subroutine: {
    id: "subroutine",
    title: "Sub-routine",
    short:
      "A plain section (one `##` heading) = one step the flow projector turns into a graph node. Keep it a short briefing, not a manual.",
    guideAnchor: G_BODY,
  },
  gatekeeper: {
    id: "gatekeeper",
    title: "Gatekeeper",
    short:
      "A decision point (“if X … otherwise …”). Branch points are where skills silently derail — word branches exclusively and leave a breadcrumb marker.",
    guideAnchor: G_BODY,
  },
  validation_gate: {
    id: "validation_gate",
    title: "Validation gate",
    short:
      "A section that runs a script and checks its exit code before continuing. State the expected exit code and a manual fallback.",
    guideAnchor: G_SCRIPTS,
  },
  loop_guard: {
    id: "loop_guard",
    title: "Loop guard",
    short:
      "A retry/repeat step. Always bound it (“retry at most twice, then report”) — an unbounded loop is a weak-model failure mode.",
    guideAnchor: G_BODY,
  },
  asset: {
    id: "asset",
    title: "Asset reference",
    short:
      "A bundled file (L3) a section references by relative path. Every relative reference must resolve; delete files nothing references.",
    guideAnchor: G_REFS,
  },
  tool_ref: {
    id: "tool_ref",
    title: "Tool reference",
    short:
      "A backticked MCP tool name a section cites. Name tools exactly as the bound server’s scan exposes them; every referenced tool rides its definition into context.",
    guideAnchor: G_TOOLS,
  },

  // ── Graph edge kinds (RM-30 WP 7.8 — the five-kind reading-order grammar) ─────────────────────────
  // These replace WP 9.4's three (`edge:sequence` / `edge:branch` / `edge:reference`), which named a
  // vocabulary the DATA did not carry: an arrow was anonymous, so the help text described a
  // distinction the canvas could not draw. There is now one entry per `SKILL_EDGE_KINDS` member, and
  // `EDGE_KIND_EXPLAINER_IDS` is derived from that tuple so the two can never drift.
  "edge:triggers": {
    id: "edge:triggers",
    title: "Triggers edge",
    short:
      "From a trigger — a keyword or a `/command` — to what it starts. This input is what causes the model to read the target at all.",
    guideAnchor: G_IDENTITY,
  },
  "edge:then": {
    id: "edge:then",
    title: "Then edge",
    short:
      "One step to the next at the same level. Having finished the source, the model reads the target — always. Keep the body ordered so the projected sequence matches how you want the skill run.",
    guideAnchor: G_BODY,
  },
  "edge:contains": {
    id: "edge:contains",
    title: "Contains edge",
    short:
      "A step to a sub-step. The target is part of the source, so reading the parent means reading this — and a contained step moves with its parent rather than reordering freely.",
    guideAnchor: G_BODY,
  },
  "edge:branch": {
    id: "edge:branch",
    title: "Branch edge",
    short:
      "A conditional edge out of a gatekeeper, labelled with its branch condition — the model reads exactly one of them. Keep branches mutually exclusive and pair each decision with a breadcrumb marker so a test run can verify the route.",
    guideAnchor: G_BODY,
  },
  "edge:uses": {
    id: "edge:uses",
    title: "Uses edge",
    short:
      "A step reaching for something while it works — a bundled file, a tool, a check, or another `/command`. It costs tokens only if it is actually opened, so it is a maybe, never a certainty.",
    guideAnchor: G_REFS,
  },

  // ── Triggers ─────────────────────────────────────────────────────────────────────────────────────
  "trigger:command": {
    id: "trigger:command",
    title: "/command trigger",
    short:
      "A `## /name` heading becomes a command entry point. Each command must own a distinct trigger token — a duplicate is an ambiguous collision.",
    guideAnchor: G_IDENTITY,
  },
  "trigger:keyword": {
    id: "trigger:keyword",
    title: "Keyword trigger",
    short:
      "A frontmatter `keywords:` phrase the router matches to invoke the skill. Use phrases users actually type; don’t repeat the description.",
    guideAnchor: G_IDENTITY,
  },

  // ── Frontmatter keys ─────────────────────────────────────────────────────────────────────────────
  "frontmatter:name": {
    id: "frontmatter:name",
    title: "name",
    short: "The skill’s identifier — one of the only two universally-portable frontmatter fields.",
    guideAnchor: G_IDENTITY,
  },
  "frontmatter:description": {
    id: "frontmatter:description",
    title: "description",
    short:
      "The single highest-leverage line: how the model decides to use the skill at all. State when to use it and name concrete triggers (≥ 20 meaningful chars).",
    guideAnchor: G_IDENTITY,
  },
  "frontmatter:keywords": {
    id: "frontmatter:keywords",
    title: "keywords",
    short:
      "Trigger phrases (tolerated metadata) that project to keyword entry points. Distinct phrases users type — not description spam or sibling-skill collisions.",
    guideAnchor: G_IDENTITY,
  },
  "frontmatter:servers": {
    id: "frontmatter:servers",
    title: "servers",
    short:
      "Portable MCP-server names this skill is authored for (tolerated metadata). The IDE binds each to an exact registered server so tool references validate.",
    guideAnchor: G_TOOLS,
  },

  // ── skillflow:* annotations ────────────────────────────────────────────────────────────────────
  "annotation:gatekeeper": {
    id: "annotation:gatekeeper",
    title: "skillflow:gatekeeper",
    short:
      "Forces the following heading’s node to a gatekeeper and pins its stable id. Invisible to the agent; it refines the projection, never the rendered skill.",
    guideAnchor: G_BODY,
  },
  "annotation:gate": {
    id: "annotation:gate",
    title: "skillflow:gate",
    short:
      "Forces the following heading to a validation gate (resolving the script it names) and pins its id. Inert to the agent; a refinement of the inference.",
    guideAnchor: G_SCRIPTS,
  },
  "annotation:command": {
    id: "annotation:command",
    title: "skillflow:command",
    short:
      "Pins the stable id of the entry point projected from the following `/command` heading. Above a non-command heading it is inert.",
    guideAnchor: G_IDENTITY,
  },
  "annotation:servers": {
    id: "annotation:servers",
    title: "skillflow:servers",
    short:
      "A document-scope annotation that narrows MCP tool-reference validation to the named registered servers. Refines validation, not the graph.",
    guideAnchor: G_TOOLS,
  },

  // ── Breadcrumb marker ─────────────────────────────────────────────────────────────────────────────
  "breadcrumb:marker": {
    id: "breadcrumb:marker",
    title: "Breadcrumb marker",
    short:
      "A bracketed line — `[skillflow:gate=<node> route=<edge>]` — you instruct the agent to emit at a decision. It turns “probably branch A” into a claim your test runs verify.",
    guideAnchor: G_BODY,
  },

  // ── Inline references ─────────────────────────────────────────────────────────────────────────────
  "ref:asset": {
    id: "ref:asset",
    title: "Relative file reference",
    short:
      "A bundled file cited by relative path (L3). It must resolve to a real file; keep names stable and delete dead references.",
    guideAnchor: G_REFS,
  },
  "ref:tool": {
    id: "ref:tool",
    title: "Tool reference",
    short:
      "A backticked MCP tool name. Name it exactly as the bound server exposes it; a paraphrase or a tool the scan lacks is an unknown/stale reference.",
    guideAnchor: G_TOOLS,
  },
};

/** The explainer for an id, or `undefined` when unknown (the hover then renders nothing for it). */
export function explainerFor(id: string): ExplainerEntry | undefined {
  return EXPLAINERS[id];
}

/**
 * The Monaco hover markdown for an explainer entry: a bold title, the short teaching line, and a guide
 * anchor link. The link points at the repo guide path/anchor (`docs/skill-authoring.md#…`) — there is
 * no in-app docs route yet, so it surfaces the reference exactly like the quality panel does.
 */
export function explainerHoverMarkdown(entry: ExplainerEntry): string {
  return [
    `**${entry.title}**`,
    "",
    entry.short,
    "",
    `[Authoring guide ↗](${entry.guideAnchor})`,
  ].join("\n");
}

// ── WP 9.4 — the canvas legend vocabulary (every kind that has an explainer) ─────────────────────────
// The node kinds (the 6 kinds + `tool_ref`, in the shared canonical order) and the edge kinds — the
// canvas legend popover (`SkillGraphCanvas`) iterates these and resolves each through {@link explainerFor}
// so the legend can never list a kind the registry doesn't teach (or vice versa).

/** The graph node kinds, in the shared canonical order — each has a registry entry keyed by the kind. */
export const NODE_KIND_EXPLAINER_IDS: readonly SkillGraphNodeKind[] = SKILL_GRAPH_NODE_KINDS;

/** The graph edge kinds, in reading order — DERIVED from the shared `SKILL_EDGE_KINDS` tuple (RM-30
 *  WP 7.8) so the legend lists exactly the kinds the grammar admits, and adding a sixth kind fails
 *  the coverage test until it is taught here rather than shipping untaught. */
export const EDGE_KIND_EXPLAINER_IDS: readonly string[] = SKILL_EDGE_KINDS.map(
  (kind) => `edge:${kind}`,
);

// ── WP 9.4 — the unified problems model (aggregated live projector + persisted quality + tool findings) ─
// A pure, testable classifier: every problem is attributed to a registry element (→ its guide anchor +
// teaching, the SINGLE source), and — when it can be pinned — to a graph node (flow deep link) and a
// SKILL.md line (code deep link). This keeps the React `ProblemsPanel` thin: it fetches + formats, then
// hands the raw findings here and renders whatever this returns.

/** Which of the three surfaces a problem came from — drives the badge + the live-vs-persisted note. */
export type SkillProblemSource = "projector" | "quality" | "tool";

/** A problem's severity band (mirrors `QualitySeverity`; projector/tool findings are warnings). */
export type SkillProblemSeverity = "error" | "warning" | "info";

/** One aggregated problem, with its registry element + best-effort node/line deep-link targets. */
export type SkillProblem = {
  /** Stable-per-render key. */
  id: string;
  source: SkillProblemSource;
  severity: SkillProblemSeverity;
  message: string;
  /** The registry element this problem is about — resolves to the guide anchor + "what is this" copy. */
  elementId: string;
  /** The owning graph node id (flow deep link), when the problem can be pinned to one. */
  nodeId?: string;
  /** The 1-based SKILL.md line (code deep link), when known. */
  line?: number;
};

export type CollectProblemsInput = {
  /** The LIVE draft projection — used to attribute warnings/findings to a node + line. */
  graph: SkillGraph | null;
  /** Live warnings: the draft projection's projector warnings, plus (WP 7.5) any live unknown-tool
   *  warnings the editor formats via `formatUnknownToolWarning` — recognized + re-classified here. */
  warnings: readonly string[];
  /** The persisted version's quality report (WP 4.3), or null when absent/failed. */
  quality: QualityReport | null;
  /** The persisted version's tool-reference diagnostics (WP 5.1). */
  diagnostics: readonly ToolDiagnostic[];
  /** The shared one-line tool-diagnostic formatter, injected so this module stays pure/testable. */
  formatDiagnostic: (diagnostic: ToolDiagnostic) => string;
};

/** A tolerated-metadata fallback: a quality ruleId with no anchor → a coarse guide section element. */
const RULE_ELEMENT: Record<string, string> = {
  "manifest-incomplete": "frontmatter:description",
  "trigger-hygiene": "frontmatter:keywords",
  "command-collision-internal": "trigger:command",
  "l1-budget": "frontmatter:description",
  "l2-budget": "subroutine",
  "orphan-section": "subroutine",
  "gatekeeper-no-breadcrumb": "gatekeeper",
  "broken-ref": "ref:asset",
  "unused-asset": "asset",
  "script-undocumented": "validation_gate",
};

/** The innermost graph node whose 1-based inclusive anchor span contains `line`, or undefined. */
function owningNodeAt(graph: SkillGraph | null, line: number): SkillGraphNode | undefined {
  if (!graph) return undefined;
  let best: { node: SkillGraphNode; span: number; start: number } | undefined;
  for (const node of graph.nodes) {
    const { startLine, endLine } = node.anchor;
    if (line < startLine || line > endLine) continue;
    const span = endLine - startLine;
    if (!best || span < best.span || (span === best.span && startLine > best.start)) {
      best = { node, span, start: startLine };
    }
  }
  return best?.node;
}

/** The first `"quoted"` title in a projector warning (all projector warnings name their section). */
function quotedTitle(warning: string): string | undefined {
  const match = /"([^"]+)"/.exec(warning);
  return match?.[1];
}

/** A projector warning's element when no node matched: a keyword heuristic over the warning text. */
function warningElement(warning: string): string {
  if (/script/i.test(warning)) return "validation_gate";
  if (/cross-flow|references command/i.test(warning)) return "edge:uses";
  if (/branch|gatekeeper/i.test(warning)) return "gatekeeper";
  if (/reference|file|path|resolve|missing/i.test(warning)) return "ref:asset";
  return "subroutine";
}

/**
 * Aggregate the three sources into ONE ordered problem list — projector warnings first (they are the
 * only LIVE source, so they head the list), then quality findings, then tool diagnostics. Each problem
 * is attributed to a registry element (guide anchor via {@link explainerFor}) and, when pinnable, to a
 * node + line. Pure — the same inputs always yield the same list (the panel + the test both call it).
 */
export function collectSkillProblems(input: CollectProblemsInput): SkillProblem[] {
  const { graph, warnings, quality, diagnostics, formatDiagnostic } = input;
  const problems: SkillProblem[] = [];

  // (1) Live warnings. A LIVE unknown-tool-reference warning (WP 7.5 — formatted by
  //     `formatUnknownToolWarning`, carried on the same `warnings` channel the projector uses) is
  //     re-classified to the `tool` source with a line pin, and DROPPED when the persisted tool
  //     diagnostics already report the same name (one row per issue — the persisted row carries the
  //     richer close-match candidates). Everything else is a projector warning — attributed to the
  //     section it names (→ node + line), else a keyword heuristic.
  warnings.forEach((warning, index) => {
    const unknownTool = parseUnknownToolWarning(warning);
    if (unknownTool) {
      if (diagnostics.some((diagnostic) => diagnostic.name === unknownTool.name)) return;
      const node =
        owningNodeAt(graph, unknownTool.line) ??
        graph?.nodes.find((n) => n.kind === "tool_ref" && n.toolName === unknownTool.name);
      problems.push({
        id: `live-tool:${unknownTool.name}:${index}`,
        source: "tool",
        severity: "warning",
        message: warning,
        elementId: "ref:tool",
        ...(node ? { nodeId: node.id } : {}),
        line: unknownTool.line,
      });
      return;
    }
    const title = quotedTitle(warning);
    const node = title
      ? graph?.nodes.find((n) => n.label.trim().toLowerCase() === title.trim().toLowerCase())
      : undefined;
    problems.push({
      id: `projector:${index}`,
      source: "projector",
      severity: "warning",
      message: warning,
      elementId: node ? node.kind : warningElement(warning),
      ...(node ? { nodeId: node.id, line: node.anchor.startLine } : {}),
    });
  });

  // (2) Persisted quality findings — anchored ones pin to their owning node + line.
  (quality?.findings ?? []).forEach((finding, index) => {
    const line = finding.anchor?.startLine;
    const node = line !== undefined ? owningNodeAt(graph, line) : undefined;
    const elementId = node ? node.kind : (RULE_ELEMENT[finding.ruleId] ?? "subroutine");
    problems.push({
      id: `quality:${finding.ruleId}:${index}`,
      source: "quality",
      severity: finding.severity,
      message: finding.message,
      elementId,
      ...(node ? { nodeId: node.id } : {}),
      ...(line !== undefined ? { line } : {}),
    });
  });

  // (3) Persisted tool-reference diagnostics — always about a tool reference; pin by anchor, else by
  //     the `tool_ref` node that cites the same name.
  diagnostics.forEach((diagnostic, index) => {
    const line = diagnostic.anchor?.startLine;
    const node =
      (line !== undefined ? owningNodeAt(graph, line) : undefined) ??
      graph?.nodes.find((n) => n.kind === "tool_ref" && n.toolName === diagnostic.name);
    problems.push({
      id: `tool:${diagnostic.name}:${index}`,
      source: "tool",
      severity: "warning",
      message: formatDiagnostic(diagnostic),
      elementId: "ref:tool",
      ...(node ? { nodeId: node.id } : {}),
      ...(line !== undefined ? { line } : {}),
    });
  });

  return problems;
}
