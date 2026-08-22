// RM-30 WP 7.8 — the skill-graph EDGE GRAMMAR and the reachability it makes possible.
//
// ONE frozen definition, three readers: the projector (`apps/api/src/skillflow/projector.ts`) stamps
// a kind at every edge it emits, the canvas connect handler
// (`apps/web/src/features/skills/design/UnifiedEditor.tsx`) decides what a drag may create and what a
// refusal should say, and the tests assert both against this same table. If you find yourself writing
// the rule a second time, stop: this repo has already been bitten once by two byte-identical copies of
// a rule, one of which was silently unpinned.
//
// Two axes, deliberately separated:
//
//   LEGAL      — the edge kind may exist between those two node kinds. The projector's output is
//                validated against this; a graph carrying an illegal edge is a projector bug.
//   AUTHORABLE — a canvas DRAG may create it, which stages a typed edit op. Authoring is a strict
//                SUBSET of legal: the app derives `triggers`/`then`/`contains`/`branch` from the
//                document's own structure, so drawing one by hand would be drawing a lie. (Design
//                decision 6 defers hand-drawn branches outright.)
//
// One deliberate deviation from the design doc's §2 prose, recorded rather than smoothed over: the doc
// says "a trigger cannot be the target of an arrow". That is true of AUTHORING and false of the
// projector, which has emitted a cross-flow "see /other" reference INTO a command's entry point since
// Skill IDE WP 1.2. So `uses → entry_point` is LEGAL and NOT AUTHORABLE — the author still cannot draw
// an arrow into a trigger, and the projector's own output stays inside its own grammar.

import { SKILL_EDGE_KINDS, SKILL_GRAPH_NODE_KINDS } from "./constants.js";
import type { SkillEdgeKind, SkillGraph, SkillGraphEdge, SkillGraphNodeKind } from "./types.js";

/** The three node kinds that are a SECTION of the document (one heading = one node). Mirrors the
 *  `isSectionNode` predicate both `apps/api/src/skillflow/edit-ops.ts` and the web's `use-edit-ops.ts`
 *  apply — a heading can project as a plain step, a decision point, or (when annotated) a gate. */
export const SKILL_SECTION_NODE_KINDS = [
  "subroutine",
  "gatekeeper",
  "validation_gate",
] as const satisfies readonly SkillGraphNodeKind[];

/** The accessory (leaf) kinds a step may REACH FOR while working: a bundled file, a cited tool, a
 *  script check, a repeat guard. They never carry an outgoing edge of their own. */
export const SKILL_ACCESSORY_NODE_KINDS = [
  "asset",
  "tool_ref",
  "validation_gate",
  "loop_guard",
] as const satisfies readonly SkillGraphNodeKind[];

/** One (kind, from-kind → to-kind) triple the grammar admits. */
export type SkillEdgeRule = {
  kind: SkillEdgeKind;
  from: SkillGraphNodeKind;
  to: SkillGraphNodeKind;
  /** A canvas drag may create this edge. Everything else is grammar-only (projected, never drawn). */
  authorable: boolean;
};

/** Expand a compact `(kind, froms, tos)` group into one rule per pair. */
function rules(
  kind: SkillEdgeKind,
  from: readonly SkillGraphNodeKind[],
  to: readonly SkillGraphNodeKind[],
  authorable = false,
): SkillEdgeRule[] {
  return from.flatMap((f) => to.map((t) => ({ kind, from: f, to: t, authorable })));
}

const SECTIONS = SKILL_SECTION_NODE_KINDS;
const ACCESSORIES = SKILL_ACCESSORY_NODE_KINDS;

/**
 * THE legality table. Frozen, flat, and the only place the rule is written down.
 *
 * Note that `(from, to)` alone does NOT always determine the kind — `subroutine → subroutine` is a
 * legal `then` AND a legal `contains`, because the pair says nothing about whether the second heading
 * follows the first or nests under it. The producer therefore states the kind and this table VALIDATES
 * it ({@link isLegalEdge}); only the AUTHORABLE projection is required to be unambiguous
 * ({@link authorableEdgeRule}), which a test pins.
 */
export const SKILL_EDGE_RULES: readonly SkillEdgeRule[] = Object.freeze([
  // Triggers — an entry point starts the thing it heads. A `/command` entry heads its own sections;
  // a keyword entry edges into the skill body's first node.
  ...rules("triggers", ["entry_point"], SECTIONS),

  // Then — one step to the next at the same level.
  ...rules("then", SECTIONS, SECTIONS),

  // Contains — a step to a sub-step.
  ...rules("contains", SECTIONS, SECTIONS),

  // Branch — a decision point to ONE of several steps. Defined so branches can be read, drawn by the
  // projector and counted; deliberately NOT authorable (design decision 6).
  ...rules("branch", ["gatekeeper"], SECTIONS),

  // Uses — a step (or an entry point, which IS a section when it is a `/command` heading) reaching for
  // an accessory. `section → asset` is the ONE authorable edge: a drag stages `connect_asset`.
  ...rules("uses", SECTIONS, ["asset"], true),
  ...rules(
    "uses",
    SECTIONS,
    ACCESSORIES.filter((kind) => kind !== "asset"),
  ),
  ...rules("uses", ["entry_point"], ACCESSORIES),
  // …and the cross-flow "see /other" pointer, which lands ON another command's entry point. Legal
  // because the projector emits it; never authorable (see the module header).
  ...rules("uses", [...SECTIONS, "entry_point"], ["entry_point"]),
]);

/** Fast lookup key for a rule triple. */
function ruleKey(kind: SkillEdgeKind, from: SkillGraphNodeKind, to: SkillGraphNodeKind): string {
  return `${kind} ${from} ${to}`;
}

const LEGAL_KEYS: ReadonlySet<string> = new Set(
  SKILL_EDGE_RULES.map((rule) => ruleKey(rule.kind, rule.from, rule.to)),
);

const AUTHORABLE_BY_PAIR: ReadonlyMap<string, SkillEdgeRule> = new Map(
  SKILL_EDGE_RULES.filter((rule) => rule.authorable).map(
    (rule) => [`${rule.from} ${rule.to}`, rule] as const,
  ),
);

/** Is `kind` a legal edge between those two node kinds? The projector's output is held to this. */
export function isLegalEdge(
  kind: SkillEdgeKind,
  from: SkillGraphNodeKind,
  to: SkillGraphNodeKind,
): boolean {
  return LEGAL_KEYS.has(ruleKey(kind, from, to));
}

/** Every edge kind the grammar admits between two node kinds (empty ⇒ the pair is illegal entirely). */
export function legalEdgeKinds(
  from: SkillGraphNodeKind,
  to: SkillGraphNodeKind,
): readonly SkillEdgeKind[] {
  return SKILL_EDGE_KINDS.filter((kind) => isLegalEdge(kind, from, to));
}

/** The single rule a canvas DRAG from `from` onto `to` would create, or `undefined` when a drag may
 *  not create anything between them (which is most pairs — authoring is a strict subset of legal). */
export function authorableEdgeRule(
  from: SkillGraphNodeKind,
  to: SkillGraphNodeKind,
): SkillEdgeRule | undefined {
  return AUTHORABLE_BY_PAIR.get(`${from} ${to}`);
}

/** The node kinds a drag STARTING at `from` may legally land on — drives live drag highlighting, so an
 *  impossible target simply never snaps instead of being refused after the fact. */
export function authorableTargetKinds(from: SkillGraphNodeKind): readonly SkillGraphNodeKind[] {
  return SKILL_GRAPH_NODE_KINDS.filter((to) => authorableEdgeRule(from, to) !== undefined);
}

/** Is a drag allowed to START from a node of this kind at all? (A file or a tool may point nowhere.) */
export function canAuthorEdgeFrom(from: SkillGraphNodeKind): boolean {
  return authorableTargetKinds(from).length > 0;
}

/** Is this node kind one of the document's own sections? */
export function isSectionKind(kind: SkillGraphNodeKind): boolean {
  return (SKILL_SECTION_NODE_KINDS as readonly SkillGraphNodeKind[]).includes(kind);
}

// ── Reachability — what an entry point actually puts in front of the model ──────────────────────────
//
// Design decision 2: an entry-point flow is FORWARD REACHABILITY from the entry point, not lane
// membership (which only ever said where text sits in the file). Everything reached is then labelled:
//
//   ALWAYS READ — every edge on the path is `triggers`, `then` or `contains`;
//   MAYBE READ  — at least one `branch` or `uses` edge lies on the path.
//
// Two accepted consequences: a step reachable from two entry points appears in BOTH flows (today it
// belongs to exactly one lane), and a keyword's flow is the WHOLE SKILL — a keyword loads the entire
// document, so any finer per-keyword subset would be invented.

/** Whether a node is certainly read, or only possibly read, when an entry point fires. */
export type SkillFlowCertainty = "always" | "maybe";

/** One entry point's effective reading list. `always` and `maybe` are disjoint and sorted. */
export type SkillFlowReach = {
  entryNodeId: string;
  always: string[];
  maybe: string[];
  /** True for a KEYWORD entry: its flow is the whole skill by definition, not a computed subset. */
  wholeSkill: boolean;
};

/** An edge kind that keeps certainty. An edge with NO kind (a pre-WP-7.8 graph, or an unstamped
 *  client-side preview edge) is treated as `maybe`: we would rather understate what is certainly read
 *  than promise a floor we cannot prove. */
function keepsCertainty(edge: SkillGraphEdge): boolean {
  return edge.kind === "triggers" || edge.kind === "then" || edge.kind === "contains";
}

/**
 * Forward reachability from one entry point.
 *
 * Pure and deterministic: no clock, no I/O, stable output order (node ids sorted), and repeated calls
 * on the same graph are deep-equal. `entryNodeId` naming no node — or naming a node that is not an
 * `entry_point` — yields an empty reach rather than throwing (the canvas may hold a stale selection).
 */
export function reachFromEntry(graph: SkillGraph, entryNodeId: string): SkillFlowReach {
  const entry = graph.nodes.find((node) => node.id === entryNodeId);
  if (!entry || entry.kind !== "entry_point") {
    return { entryNodeId, always: [], maybe: [], wholeSkill: false };
  }

  // A keyword loads the whole document (design decision 2). Every section IS read; every accessory
  // MAY be. No walk — there is no subset to compute, and pretending otherwise would be fiction.
  if (entry.trigger.type === "keyword") {
    const always: string[] = [];
    const maybe: string[] = [];
    for (const node of graph.nodes) {
      if (node.id === entryNodeId || node.kind === "entry_point" || isSectionKind(node.kind)) {
        always.push(node.id);
      } else {
        maybe.push(node.id);
      }
    }
    return { entryNodeId, always: always.sort(), maybe: maybe.sort(), wholeSkill: true };
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map<string, SkillGraphEdge[]>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue; // never crash on a dangling edge
    const list = outgoing.get(edge.from);
    if (list) list.push(edge);
    else outgoing.set(edge.from, [edge]);
  }

  // Breadth-first with an upgrade pass: a node first reached over a `uses` edge is `maybe`, but if a
  // certain path to it exists too it is `always`, so a `maybe` later reached certainly is re-queued
  // rather than left understated.
  const certainty = new Map<string, SkillFlowCertainty>([[entryNodeId, "always"]]);
  const queue: string[] = [entryNodeId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentCertainty = certainty.get(current) as SkillFlowCertainty;
    for (const edge of outgoing.get(current) ?? []) {
      const next: SkillFlowCertainty =
        currentCertainty === "always" && keepsCertainty(edge) ? "always" : "maybe";
      const seen = certainty.get(edge.to);
      if (seen === "always") continue;
      if (seen === "maybe" && next === "maybe") continue;
      certainty.set(edge.to, next);
      queue.push(edge.to);
    }
  }

  const always: string[] = [];
  const maybe: string[] = [];
  for (const [id, value] of certainty) (value === "always" ? always : maybe).push(id);
  return { entryNodeId, always: always.sort(), maybe: maybe.sort(), wholeSkill: false };
}

/** Every `entry_point` node id in the graph, in document order — the flow picker's option list. */
export function entryPointIds(graph: SkillGraph): string[] {
  return graph.nodes
    .filter((node) => node.kind === "entry_point")
    .sort((a, b) => a.anchor.startLine - b.anchor.startLine || a.id.localeCompare(b.id))
    .map((node) => node.id);
}
