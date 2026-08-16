import {
  DEFAULT_SKILL_FLOW_ID,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphAnchor,
  type SkillGraphEdge,
  type SkillGraphNode,
} from "@mcp-token-footprint/shared";
import { parse as parseYaml } from "yaml";
import { parseSkillflowAnnotations, type SkillflowAnnotation } from "./annotations.js";
import { extractToolReferences } from "./extract-tools.js";

/**
 * Project a stored skill version into a `SkillGraph` (D2 inference-first, D5 anchored projection).
 *
 * PURE and deterministic: no I/O, no model calls, no clock — the same `(skillMd, files)` always
 * yields a deep-equal graph. Never throws on weird markdown; the worst case is an empty graph plus a
 * human-readable warning.
 *
 * Inference rules (each a well-named helper below):
 * - Headings (`#`/`##`/`###`…, after frontmatter, outside code fences) → section nodes (subroutine by
 *   default); document order → edges between consecutive top-level sections; nested subsections get an
 *   edge from their parent heading and a depth-2+ `headingPath`.
 * - Relative-path references resolving against `files` → `asset` nodes (reusing the file's `kind`),
 *   edge from the referencing section.
 * - Script references near exit-code/verification language → `validation_gate` nodes
 *   (`script` = path, `expectation` = the sentence naming it).
 * - Explicit branching prose ("if …, otherwise …") → the section becomes a `gatekeeper` with
 *   condition-labelled edges (routed to the successor when branch targets aren't resolvable + warning).
 * - Repeat/retry language → a `loop_guard` attached to the section (`maxIterations` from "at most N").
 * - `<!-- skillflow:… -->` annotations refine the inference (`source: 'annotated'`, annotation ids win).
 *
 * Skill IDE WP 1.2 (I1) adds flow semantics (`SKILLFLOW_PROJECTOR_VERSION` = 3):
 * - A heading whose text starts with `/` (e.g. `## /report daily`) → an `entry_point` node with a
 *   `{ type: 'command', value }` trigger (the first `/token`); its section subtree (its content +
 *   nested subsections until the next same-or-higher-level heading) becomes that command's flow —
 *   every node/edge derived from it carries `flowId` = the entry node's id. A `skillflow:command`
 *   annotation above the heading pins the entry node's stable id.
 * - Frontmatter `keywords:` (string or list) → one `entry_point` per keyword with a
 *   `{ type: 'keyword', value }` trigger on the `'main'` flow, each edged to the first main node.
 * - Everything before/outside a command section stays on the `'main'` flow. `SkillGraph.flows` is
 *   populated (`main` first, then one per command entry). A cross-flow reference ("see /other") →
 *   an edge to the referenced command's entry node plus a "cross-flow reference" warning.
 *
 * A zero-command skill projects IDENTICALLY to the pre-plan graph modulo the additive
 * `flowId:'main'` on every node/edge and `flows:[{ id:'main', … }]` (regression-locked).
 */
export function projectSkillGraph(skillMd: string, files: SkillFileNode[]): SkillGraph {
  const warnings: string[] = [];
  const mainFlow = { id: DEFAULT_SKILL_FLOW_ID, label: "Main flow" };

  if (typeof skillMd !== "string" || skillMd.trim() === "") {
    return {
      nodes: [],
      edges: [],
      warnings: ["SKILL.md is empty or missing; nothing to project."],
      flows: [mainFlow],
    };
  }

  const lines = skillMd.split(/\r?\n/);
  const { byTargetLine, warnings: annotationWarnings } = parseSkillflowAnnotations(lines);
  warnings.push(...annotationWarnings);

  const headings = findHeadings(lines);
  if (headings.length === 0) {
    warnings.push("No markdown headings found after frontmatter; nothing to project.");
    return { nodes: [], edges: [], warnings, flows: [mainFlow] };
  }

  const sections = buildSections(headings, lines);
  const referenceFiles = files.filter((file) => !file.isSkillMd);
  const keywordInfo = parseFrontmatterKeywords(lines);

  const ids = new IdGenerator();
  // Reserve annotation-provided ids first (in document order) so generated slugs dedupe around them
  // and annotation ids win over generated ones (D2). The reserved final id per heading line is reused
  // when the section node is built (never re-reserved, which would spuriously append `-2`).
  const reservedIds = new Map<number, string>();
  for (const annotation of byTargetLine.values()) {
    if (annotation.id) reservedIds.set(annotation.targetLine, ids.reserve(annotation.id));
  }

  const nodes: SkillGraphNode[] = [];
  const edges: SkillGraphEdge[] = [];
  const edgeIds = new IdGenerator();
  const addEdge = (
    from: string,
    to: string,
    flowId: string,
    extra?: { condition?: string; anchor?: SkillGraphAnchor },
  ) => {
    edges.push({ id: edgeIds.make(`e-${from}-${to}`), from, to, flowId, ...extra });
  };

  // Per section index: its node id, the flow it belongs to, and whether it's a gatekeeper.
  const sectionNodeIds: string[] = [];
  const sectionFlowIds: string[] = [];
  const isGatekeeper: boolean[] = [];
  // Command entry points keyed by trigger value (e.g. `/analyze` → node id) for cross-flow refs.
  const commandEntryByValue = new Map<string, string>();
  // Ordered command flows for `SkillGraph.flows` (document order).
  const commandFlows: Array<{ id: string; label: string; entryNodeId: string }> = [];
  // The command flows currently "open" at this point in document order (nesting by heading level):
  // a `/command` heading opens a flow that its deeper subsections inherit until a same-or-higher
  // level heading closes it.
  const flowStack: Array<{ level: number; flowId: string }> = [];
  // The most recent script referenced so far in document order — lets a `skillflow:gate` annotation
  // whose own section names no script fall back to the check it refers to ("the check above").
  let lastScriptRef: string | undefined;

  for (const section of sections) {
    // A same-or-higher-level heading closes any command subtree(s) it follows.
    while (flowStack.length > 0 && section.level <= flowStack[flowStack.length - 1]!.level) {
      flowStack.pop();
    }

    const annotation = byTargetLine.get(section.startLine);
    const annotationId = annotation ? reservedIds.get(annotation.targetLine) : undefined;
    const refs = referenceFiles.filter((file) => section.body.includes(file.path));
    const ownScript = refs.find((file) => isScript(file))?.path;
    const command = parseCommandHeading(section.title);

    let flowId: string;
    let sectionNodeId: string;
    let gateScript: string | undefined;
    let gatekeeper = false;

    if (command) {
      // A `/command` heading → an entry_point node heading its own flow (`flowId` = its id).
      const entryId = annotationId ?? ids.make(slugify(section.title));
      flowId = entryId;
      const entryNode: SkillGraphNode = {
        id: entryId,
        kind: "entry_point",
        label: section.title,
        anchor: section.anchor,
        source: annotation?.keyword === "command" ? "annotated" : "inferred",
        flowId: entryId,
        trigger: { type: "command", value: command.value },
      };
      nodes.push(entryNode);
      sectionNodeId = entryId;
      commandEntryByValue.set(command.value, entryId);
      commandFlows.push({ id: entryId, label: command.value, entryNodeId: entryId });
      flowStack.push({ level: section.level, flowId: entryId });
    } else {
      flowId =
        flowStack.length > 0 ? flowStack[flowStack.length - 1]!.flowId : DEFAULT_SKILL_FLOW_ID;
      const built = buildSectionNode(
        section,
        annotation,
        annotationId,
        ids,
        ownScript ?? lastScriptRef,
        warnings,
      );
      built.node.flowId = flowId;
      nodes.push(built.node);
      sectionNodeId = built.node.id;
      gateScript = built.gateScript;
      gatekeeper = built.node.kind === "gatekeeper";
    }

    sectionNodeIds.push(sectionNodeId);
    sectionFlowIds.push(flowId);
    isGatekeeper.push(gatekeeper);

    // Reference nodes (assets + inferred validation gates), in a stable path order — all on `flowId`.
    for (const file of refs) {
      if (isScript(file)) {
        // Skip a script the section's own annotated gate already consumed (no duplicate node).
        if (gateScript === file.path) continue;
        if (hasVerifyLanguage(section.body)) {
          const gateNode: SkillGraphNode = {
            id: ids.make(`gate-${basename(file.path)}`),
            kind: "validation_gate",
            label: basename(file.path),
            anchor: section.anchor,
            source: "inferred",
            flowId,
            script: file.path,
            expectation: sentenceMentioning(section.body, file.path),
          };
          nodes.push(gateNode);
          addEdge(sectionNodeId, gateNode.id, flowId);
        } else {
          // A referenced script with no verification language is just a bundled asset.
          nodes.push(makeAssetNode(file, section.anchor, ids, flowId));
          addEdge(sectionNodeId, nodes[nodes.length - 1]!.id, flowId);
        }
      } else {
        nodes.push(makeAssetNode(file, section.anchor, ids, flowId));
        addEdge(sectionNodeId, nodes[nodes.length - 1]!.id, flowId);
      }
    }

    // Loop-guard hint attached to the section.
    const loop = detectLoop(section.body);
    if (loop.isLoop) {
      const loopNode: SkillGraphNode = {
        id: ids.make(`${slugify(section.title)}-loop`),
        kind: "loop_guard",
        label: `Loop: ${section.title}`,
        anchor: section.anchor,
        source: "inferred",
        flowId,
        ...(loop.maxIterations !== undefined ? { maxIterations: loop.maxIterations } : {}),
      };
      nodes.push(loopNode);
      addEdge(sectionNodeId, loopNode.id, flowId);
    }

    if (ownScript) lastScriptRef = ownScript;
  }

  // Sequential flow between consecutive top-level (level ≤ 2) sections ON THE MAIN FLOW — command
  // entry points head their own disjoint flows and never chain into the body flow.
  const mainTopLevel = sections
    .map((section, index) => ({ section, index }))
    .filter(
      (entry) => entry.section.level <= 2 && sectionFlowIds[entry.index] === DEFAULT_SKILL_FLOW_ID,
    );

  for (let i = 0; i < mainTopLevel.length - 1; i += 1) {
    const from = mainTopLevel[i]!;
    const to = mainTopLevel[i + 1]!;
    const fromId = sectionNodeIds[from.index]!;
    const toId = sectionNodeIds[to.index]!;
    if (isGatekeeper[from.index]) {
      const conditions = extractConditions(from.section.body);
      if (conditions.length > 0) {
        for (const condition of conditions) {
          addEdge(fromId, toId, DEFAULT_SKILL_FLOW_ID, { condition, anchor: from.section.anchor });
        }
        warnings.push(
          `gatekeeper "${from.section.title}" branch targets are not resolvable to sections; routed to the next section with condition labels.`,
        );
      } else {
        addEdge(fromId, toId, DEFAULT_SKILL_FLOW_ID);
      }
    } else {
      addEdge(fromId, toId, DEFAULT_SKILL_FLOW_ID);
    }
  }

  // Parent → subsection edges (the entry_point → first content node fall out of this for commands).
  for (const section of sections) {
    if (section.level >= 3 && section.parentIndex >= 0) {
      addEdge(
        sectionNodeIds[section.parentIndex]!,
        sectionNodeIds[section.index]!,
        sectionFlowIds[section.index]!,
      );
    }
  }

  // Keyword entry points (I1): one per frontmatter keyword, on the main flow, edged to the first
  // main-flow node (the skill's body head).
  const firstMainNodeId = sectionFlowIds.findIndex((id) => id === DEFAULT_SKILL_FLOW_ID);
  for (const keyword of keywordInfo.keywords) {
    const entryId = ids.make(`keyword-${slugify(keyword)}`);
    nodes.push({
      id: entryId,
      kind: "entry_point",
      label: keyword,
      anchor: keywordInfo.anchor,
      source: "inferred",
      flowId: DEFAULT_SKILL_FLOW_ID,
      trigger: { type: "keyword", value: keyword },
    });
    if (firstMainNodeId >= 0)
      addEdge(entryId, sectionNodeIds[firstMainNodeId]!, DEFAULT_SKILL_FLOW_ID);
  }

  // Cross-flow references: a section that mentions ANOTHER command's `/value` (e.g. "see /analyze")
  // → an edge to that command's entry node + a warning (I1). Deduped per (from, target).
  const commandValues = [...commandEntryByValue.keys()];
  const crossFlowSeen = new Set<string>();
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]!;
    const fromId = sectionNodeIds[i]!;
    const fromFlow = sectionFlowIds[i]!;
    for (const value of commandValues) {
      const targetEntry = commandEntryByValue.get(value)!;
      // A mention inside the target command's OWN flow is not a cross-flow reference.
      if (fromFlow === targetEntry) continue;
      if (!mentionsCommand(section.body, value)) continue;
      const key = `${fromId}->${targetEntry}`;
      if (crossFlowSeen.has(key)) continue;
      crossFlowSeen.add(key);
      addEdge(fromId, targetEntry, fromFlow);
      warnings.push(
        `cross-flow reference: "${section.title}" (flow ${fromFlow}) references command ${value} (flow ${targetEntry}).`,
      );
    }
  }

  // Tool references (Skill IDE WP 8.1 / I9.2): each backticked tool citation the SHARED extraction
  // heuristic finds (shape + context signal, over FILE BYTES ONLY — no scan read) becomes an accessory
  // `tool_ref` leaf node + a `calls` edge FROM the section that owns its line. Existence / staleness /
  // candidate resolution arrive later as a SEPARATE validation overlay — the projector stays pure text
  // evidence. A skill with zero references touches nothing here (the loop body never runs), so its
  // graph is byte-identical to v3 (regression-locked). `toolName` is the citation verbatim; the id is
  // pinned by (line + name) so it is stable across re-projection and document reorders.
  for (const reference of extractToolReferences(skillMd)) {
    const ownerIndex = sections.findIndex(
      (section) => reference.line >= section.startLine && reference.line <= section.endLine,
    );
    if (ownerIndex < 0) continue; // a reference before the first heading has no owning section to cite from
    const ownerId = sectionNodeIds[ownerIndex]!;
    const flowId = sectionFlowIds[ownerIndex]!;
    const toolNode: SkillGraphNode = {
      id: ids.make(`tool-ref-${reference.name}-l${reference.line}`),
      kind: "tool_ref",
      label: reference.name,
      anchor: reference.anchor,
      source: "inferred",
      flowId,
      toolName: reference.name,
    };
    nodes.push(toolNode);
    addEdge(ownerId, toolNode.id, flowId);
  }

  return { nodes, edges, warnings, flows: [mainFlow, ...commandFlows] };
}

// --- Heading + section parsing ------------------------------------------------------------------

type Heading = { level: number; title: string; line: number };

type Section = {
  index: number;
  level: number;
  title: string;
  startLine: number; // 1-based heading line
  endLine: number; // 1-based last line of the section span
  body: string; // text between the heading and the next heading
  headingPath: string[];
  anchor: SkillGraphAnchor;
  parentIndex: number; // index of the nearest ancestor heading (lower level), or -1
};

/** Collect ATX headings after any YAML frontmatter, skipping fenced code blocks. */
function findHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let start = 0;

  // Skip a leading `---` … `---` YAML frontmatter block (its lines still count for anchors).
  if ((lines[0] ?? "").trim() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      if ((lines[i] ?? "").trim() === "---") {
        start = i + 1;
        break;
      }
    }
  }

  let inFence = false;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match && (match[2] ?? "").trim() !== "") {
      headings.push({ level: match[1]!.length, title: match[2]!.trim(), line: i + 1 });
    }
  }
  return headings;
}

/** Turn headings into anchored sections (span, body, heading path, parent index). */
function buildSections(headings: Heading[], lines: string[]): Section[] {
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string; index: number }> = [];

  for (let h = 0; h < headings.length; h += 1) {
    const heading = headings[h]!;
    const next = headings[h + 1];
    const endLine = next ? next.line - 1 : lines.length;
    const body = lines.slice(heading.line, endLine).join("\n");

    // Maintain a heading stack to compute the parent + the H2-and-deeper heading path.
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) stack.pop();
    const parentIndex = stack.length > 0 ? stack[stack.length - 1]!.index : -1;
    stack.push({ level: heading.level, title: heading.title, index: h });

    // headingPath: the chain of ancestor headings at level ≥ 2 down to this one. An H1 (a skill
    // title) has no H2 ancestor, so it anchors to its own title.
    const headingPath =
      heading.level === 1
        ? [heading.title]
        : stack.filter((entry) => entry.level >= 2).map((entry) => entry.title);

    sections.push({
      index: h,
      level: heading.level,
      title: heading.title,
      startLine: heading.line,
      endLine,
      body,
      headingPath,
      anchor: { headingPath, startLine: heading.line, endLine },
      parentIndex,
    });
  }
  return sections;
}

// --- Section-node construction (inference + annotation merge) ------------------------------------

/**
 * Build the node for a section, applying any `<!-- skillflow:… -->` annotation over the inferred
 * kind. Returns the node plus (for an annotated gate) the script it consumed, so the caller doesn't
 * also emit a duplicate inferred gate for the same script.
 */
function buildSectionNode(
  section: Section,
  annotation: SkillflowAnnotation | undefined,
  annotationId: string | undefined,
  ids: IdGenerator,
  resolvableScript: string | undefined,
  warnings: string[],
): { node: SkillGraphNode; gateScript?: string } {
  const common = {
    label: section.title,
    anchor: section.anchor,
  };

  if (annotation?.keyword === "gatekeeper") {
    const id = annotationId ?? ids.make(slugify(section.title));
    return { node: { id, kind: "gatekeeper", source: "annotated", ...common } };
  }

  if (annotation?.keyword === "gate") {
    const id = annotationId ?? ids.make(slugify(section.title));
    if (resolvableScript) {
      return {
        node: {
          id,
          kind: "validation_gate",
          source: "annotated",
          ...common,
          script: resolvableScript,
          expectation: gateExpectation(section.body),
        },
        gateScript: resolvableScript,
      };
    }
    // No script to point at — keep the inferred kind but honor the annotation's id + source, and warn.
    warnings.push(
      `skillflow:gate on "${section.title}" references no resolvable script; kept as ${
        hasBranching(section.body) ? "gatekeeper" : "subroutine"
      }.`,
    );
    return {
      node: hasBranching(section.body)
        ? { id, kind: "gatekeeper", source: "annotated", ...common }
        : { id, kind: "subroutine", source: "annotated", ...common },
    };
  }

  // No annotation — pure inference.
  const id = ids.make(slugify(section.title));
  if (hasBranching(section.body)) {
    return { node: { id, kind: "gatekeeper", source: "inferred", ...common } };
  }
  return { node: { id, kind: "subroutine", source: "inferred", ...common } };
}

function makeAssetNode(
  file: SkillFileNode,
  anchor: SkillGraphAnchor,
  ids: IdGenerator,
  flowId: string,
): SkillGraphNode {
  return {
    id: ids.make(`asset-${basename(file.path)}`),
    kind: "asset",
    label: basename(file.path),
    anchor,
    source: "inferred",
    flowId,
    path: file.path,
    fileKind: file.kind,
  };
}

// --- Command + keyword detection (Skill IDE WP 1.2 / I1) -----------------------------------------

/** A `/command` heading → its trigger value (the first `/token`); non-command headings → undefined. */
function parseCommandHeading(title: string): { value: string } | undefined {
  const trimmed = title.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const value = trimmed.split(/\s+/)[0] ?? "";
  // Reject a bare "/" (no command name) — nothing to trigger on.
  if (value.length < 2) return undefined;
  return { value };
}

/** Does `body` mention the command token `value` (e.g. `/analyze`) as a standalone reference? */
function mentionsCommand(body: string, value: string): boolean {
  return new RegExp(`(?<![\\w/])${escapeRegExp(value)}(?![\\w/])`).test(body);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse frontmatter `keywords:` (tolerating a scalar string or a list) into a deduped, trimmed list
 * of trigger phrases, plus an anchor at the frontmatter block. Uses the same `yaml` parser as
 * `manifest.ts`; never throws — malformed frontmatter yields no keywords.
 */
function parseFrontmatterKeywords(lines: string[]): {
  keywords: string[];
  anchor: SkillGraphAnchor;
} {
  const emptyAnchor: SkillGraphAnchor = { headingPath: [], startLine: 1, endLine: 1 };
  if ((lines[0] ?? "").trim() !== "---") return { keywords: [], anchor: emptyAnchor };

  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return { keywords: [], anchor: emptyAnchor };

  const anchor: SkillGraphAnchor = { headingPath: [], startLine: 1, endLine: close + 1 };
  const frontmatter = lines.slice(1, close).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch {
    return { keywords: [], anchor };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { keywords: [], anchor };
  }

  const rawKeywords = (parsed as Record<string, unknown>).keywords;
  const collected: unknown[] =
    typeof rawKeywords === "string" ? [rawKeywords] : Array.isArray(rawKeywords) ? rawKeywords : [];

  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const entry of collected) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    keywords.push(value);
  }
  return { keywords, anchor };
}

// --- Prose heuristics ---------------------------------------------------------------------------

function isScript(file: SkillFileNode): boolean {
  return file.kind === "script" || file.path.startsWith("scripts/");
}

/** Explicit branching prose: an `if` paired with an `otherwise`/`else`, or a routing table. */
function hasBranching(body: string): boolean {
  const text = body.toLowerCase();
  if (/\bif\b/.test(text) && /\b(otherwise|else)\b/.test(text)) return true;
  if (/\|[^\n]*\b(if|when|condition|route)\b[^\n]*\|/.test(text)) return true;
  return false;
}

/** Extract the condition clauses from branching prose (`if X`, `otherwise if Y`). */
function extractConditions(body: string): string[] {
  const conditions: string[] = [];
  const re = /\b(?:otherwise if|else if|if)\b\s+([^,.;:]+)/gi;
  let match: RegExpExecArray | null = re.exec(body);
  while (match !== null) {
    const clause = (match[1] ?? "").trim();
    if (clause) conditions.push(clause);
    if (conditions.length >= 6) break;
    match = re.exec(body);
  }
  return conditions;
}

/** Exit-code / verification language that promotes a script reference to a validation gate. */
function hasVerifyLanguage(text: string): boolean {
  return /(exit|verif|check|passe?s?\b|validate|succeed|non-zero|status code)/i.test(text);
}

/** Repeat/retry language → a loop guard; `maxIterations` parsed from "at most N" (or N times/once). */
function detectLoop(body: string): { isLoop: boolean; maxIterations?: number } {
  const text = body.toLowerCase();
  const isLoop =
    /\brepeat\b/.test(text) ||
    /\bretr(y|ies)\b/.test(text) ||
    /at most \d+/.test(text) ||
    /\bloop\b/.test(text);
  if (!isLoop) return { isLoop: false };

  let maxIterations: number | undefined;
  const atMost = /at most (\d+)/.exec(text);
  const nTimes = /(\d+) times/.exec(text);
  const retryN = /retry (\d+)/.exec(text);
  const retryWord = /retry (once|twice)/.exec(text);
  if (atMost) maxIterations = Number.parseInt(atMost[1]!, 10);
  else if (nTimes) maxIterations = Number.parseInt(nTimes[1]!, 10);
  else if (retryN) maxIterations = Number.parseInt(retryN[1]!, 10);
  else if (retryWord) maxIterations = retryWord[1] === "once" ? 1 : 2;
  if (maxIterations !== undefined && (!Number.isFinite(maxIterations) || maxIterations <= 0)) {
    maxIterations = undefined;
  }
  return { isLoop: true, maxIterations };
}

/** The (trimmed) sentence that mentions `needle`, else the first non-empty sentence, else "". */
function sentenceMentioning(body: string, needle: string): string {
  const sentences = body.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const hit = sentences.find((sentence) => sentence.includes(needle));
  if (hit) return hit.trim();
  return sentences.find((sentence) => sentence.trim() !== "")?.trim() ?? "";
}

/** The expectation for an annotated gate: the first sentence carrying verification language. */
function gateExpectation(body: string): string {
  const sentences = body.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const hit = sentences.find((sentence) => hasVerifyLanguage(sentence));
  if (hit) return hit.trim();
  return sentences.find((sentence) => sentence.trim() !== "")?.trim() ?? "";
}

// --- Small pure utilities -----------------------------------------------------------------------

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

/** Kebab-case slug from arbitrary heading text (stable → the same doc always projects the same ids). */
function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "node"
  );
}

/**
 * Deterministic id allocator: a base slug is used as-is the first time, then deduped with `-2`, `-3`
 * suffixes. `reserve` claims an explicit id (annotation-provided) so later generated slugs avoid it.
 */
class IdGenerator {
  private readonly used = new Set<string>();

  reserve(id: string): string {
    if (!this.used.has(id)) {
      this.used.add(id);
      return id;
    }
    return this.make(id);
  }

  make(base: string): string {
    const slug = slugify(base);
    if (!this.used.has(slug)) {
      this.used.add(slug);
      return slug;
    }
    let suffix = 2;
    let candidate = `${slug}-${suffix}`;
    while (this.used.has(candidate)) {
      suffix += 1;
      candidate = `${slug}-${suffix}`;
    }
    this.used.add(candidate);
    return candidate;
  }
}
