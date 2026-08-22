import {
  authorableEdgeRule,
  type BoundTool,
  type SkillEditOp,
  type SkillGraph,
  type SkillGraphNode,
} from "@mcp-token-footprint/shared";
import { explainerFor } from "./code-intel/explainers";
import { edgeKindMeta } from "./edge-kind-meta";
import { isPreviewOnlyNodeId, isSectionNode } from "./use-edit-ops";

// ── RM-30 WP 7.8, design decision 4 — what a connection gesture DOES ─────────────────────────────
//
// Before this, exactly one connection was legal (a step to a bundled file) and every other drag was
// allowed to complete and then met with one red toast:
//
//     "Couldn't create that connection — A connection runs from a section to an asset file"
//
// It named one legal move and did not say which part of what you just did was wrong. This module
// replaces it with three behaviours, in the design doc's order:
//
//   1. PREVENT THE IMPOSSIBLE SILENTLY. While dragging, only targets that could legally receive the
//      arrow are offerable. An arrow into a file simply does not snap — and there is NO error,
//      because nothing went wrong: you were shown the rule instead of told it afterwards.
//   2. WHEN THE INTENT IS OBVIOUS, OFFER THE LEGAL MOVE. Dropping a tool onto another tool almost
//      always means "have this step call it too". The answer is an offer with a button, one click to
//      apply — not a dead stop.
//   3. WHEN IT IS GENUINELY WRONG, EXPLAIN IN THE VOCABULARY THE APP ALREADY TEACHES. The message
//      names the kind of arrow that was attempted and links the guide section for it, resolved
//      through the ONE `explainers.ts` registry — the same source the code hovers, the node panel's
//      "What is this?" and the legend read. No new copy is written for a refusal.
//
// THE RULE THE BUILD IS HELD TO, verbatim from the design doc: **no message that only says an action
// failed.** Every refusal either offers the correct move or names the rule that was broken.
// `connect-grammar.test.ts` asserts that over the WHOLE message set, not by spot check.
//
// Nothing here mutates anything. Every outcome that changes the skill is a typed `SkillEditOp` handed
// back to the caller, which appends it to the same one edit buffer every other gesture writes to —
// the one-draft, staged-edit architecture, unchanged. Three hidden save paths were deleted from this
// surface in WPs 7.3 and 7.4; this adds no fourth.

/** What a completed drag resolves to. */
export type ConnectResolution =
  /** A legal, authorable connection: stage the op and confirm it. */
  | {
      outcome: "connect";
      op: SkillEditOp;
      title: string;
      description: string;
    }
  /** A recognised near-miss: say what is wrong AND offer the move that was almost certainly meant. */
  | {
      outcome: "offer";
      title: string;
      description: string;
      /** The button's text, e.g. "Call it from Summarise". */
      actionLabel: string;
      op: SkillEditOp;
      /** Confirmation once the offer is taken. */
      appliedTitle: string;
      appliedDescription: string;
    }
  /** Genuinely wrong: name the rule that was broken and point at the guide. */
  | {
      outcome: "refuse";
      title: string;
      description: string;
      /** The `explainers.ts` id whose guide anchor the message cites. */
      explainerId: string;
      guideAnchor: string;
    };

/** Everything the resolver needs beyond the graph: bound tools resolve a tool name to its server. */
export type ConnectContext = {
  boundTools: readonly BoundTool[];
};

/**
 * Is this box a SECTION the author may stage an op against?
 *
 * `validation_gate` is deliberately ambiguous in the graph: an ANNOTATED HEADING projects as one (a
 * real section), and so does an inferred SCRIPT BOX hanging off a section (an accessory). The kind
 * alone cannot tell them apart, so this uses the same heading-anchored test `edit-ops.ts` applies
 * server-side — otherwise a drag out of a script box would be offered and then 400 on save.
 *
 * An `entry_point` is heading-anchored too but is excluded on purpose: `connect_asset` is validated
 * against exactly this predicate on the server, so offering it from a `/command` heading would be
 * offering a move that cannot be saved.
 */
function isStageableSection(node: SkillGraphNode): boolean {
  return isSectionNode(node);
}

/** The section an accessory box hangs off — its first incoming edge's source. */
function owningSection(graph: SkillGraph, nodeId: string): SkillGraphNode | undefined {
  for (const edge of graph.edges) {
    if (edge.to !== nodeId) continue;
    const source = graph.nodes.find((node) => node.id === edge.from);
    if (source && isStageableSection(source)) return source;
  }
  return undefined;
}

/** A refusal that cites the grammar entry for the arrow that was ATTEMPTED. */
function refuse(
  title: string,
  description: string,
  explainerId: string,
): Extract<ConnectResolution, { outcome: "refuse" }> {
  const entry = explainerFor(explainerId);
  return {
    outcome: "refuse",
    title,
    description,
    explainerId,
    guideAnchor: entry?.guideAnchor ?? "docs/skill-authoring.md",
  };
}

/**
 * Is this pair worth letting the drag COMPLETE at all?
 *
 * `false` ⇒ behaviour 1: React Flow refuses the connection mid-drag, the handle never snaps, and no
 * message is ever shown. This is deliberately the default for anything the app has neither an op nor
 * a lesson for — silence is the correct response to "nothing went wrong, that just is not a thing".
 */
export function isConnectionOfferable(
  graph: SkillGraph,
  sourceId: string | null | undefined,
  targetId: string | null | undefined,
): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (!source || !target) return false;

  // The one authorable relationship: a step onto a bundled file.
  if (authorableEdgeRule(source.kind, target.kind) && isStageableSection(source)) return true;

  // The recognised near-misses (behaviour 2) — an obvious intent with an obvious legal move.
  const nearMiss =
    (source.kind === "tool_ref" && (target.kind === "tool_ref" || isStageableSection(target))) ||
    (source.kind === "asset" && (target.kind === "asset" || isStageableSection(target)));
  if (nearMiss) return true;

  // The teachable mistakes (behaviour 3) — a real edge kind the author may not draw by hand.
  return (
    (isStageableSection(source) && isStageableSection(target)) || target.kind === "entry_point"
  );
}

/**
 * Resolve a completed drag.
 *
 * Pure and total: it never throws, never mutates, and always returns something to SAY. A pair the
 * caller should not have let through at all still gets a named refusal rather than silence, because a
 * gesture that visibly completed and then did nothing is the exact failure this replaces.
 */
export function resolveConnection(
  graph: SkillGraph,
  sourceId: string | null | undefined,
  targetId: string | null | undefined,
  context: ConnectContext,
): ConnectResolution {
  const source = sourceId ? graph.nodes.find((node) => node.id === sourceId) : undefined;
  const target = targetId ? graph.nodes.find((node) => node.id === targetId) : undefined;

  if (!source || !target) {
    return refuse(
      "That connection has nothing to join",
      "One end of the arrow is no longer on the canvas — the diagram was rebuilt while you were dragging. Try the drag again.",
      "edge:uses",
    );
  }

  if (isPreviewOnlyNodeId(source.id) || isPreviewOnlyNodeId(target.id)) {
    return refuse(
      "Save this version first",
      "One of these boxes is a change you have staged but not saved yet, so there is nothing to connect it to on disk. Save, then draw the connection.",
      "edge:uses",
    );
  }

  // ── Behaviour 1's residue: an authorable pair ────────────────────────────────────────────────
  if (
    authorableEdgeRule(source.kind, target.kind) &&
    target.kind === "asset" &&
    isStageableSection(source)
  ) {
    const already = graph.edges.some((edge) => edge.from === source.id && edge.to === target.id);
    if (already) {
      return refuse(
        `“${source.label}” already reads “${target.label}”`,
        `A ${edgeKindMeta("uses").label.toLowerCase()} connection between these two already exists — one is all it takes, however many times the step mentions the file.`,
        "edge:uses",
      );
    }
    return {
      outcome: "connect",
      op: { op: "connect_asset", nodeId: source.id, path: target.path },
      title: "Connection staged",
      description: `“${target.label}” will be referenced from “${source.label}” when you save.`,
    };
  }

  // ── Behaviour 2: the recognised near-misses ──────────────────────────────────────────────────
  if (source.kind === "tool_ref") {
    const section = isStageableSection(target) ? target : owningSection(graph, target.id);
    const bound = context.boundTools.find((tool) => tool.toolName === source.toolName);
    if (section && bound) {
      return {
        outcome: "offer",
        title:
          target.kind === "tool_ref"
            ? "A tool can’t be called by another tool"
            : "A tool is called BY a step, not joined to one",
        description: `Call “${source.toolName}” from “${section.label}” instead?`,
        actionLabel: `Call it from ${section.label}`,
        op: {
          op: "add_tool_ref",
          nodeId: section.id,
          server: bound.serverName,
          tool: source.toolName,
        },
        appliedTitle: "Tool reference staged",
        appliedDescription: `“${source.toolName}” will be referenced from “${section.label}” when you save.`,
      };
    }
    if (section && !bound) {
      return refuse(
        `“${source.toolName}” isn’t on a bound server`,
        `This skill cites the tool by name, but no bound server’s scan exposes it, so there is no server to record the call against. Bind the server that provides it, then drag it from the palette onto “${section.label}”.`,
        "ref:tool",
      );
    }
    return refuse(
      "A tool reference points nowhere",
      "A tool is something a step reaches for while it works, so the arrow always runs from the step to the tool — never out of the tool. Drag the tool from the palette onto the step that should call it.",
      "edge:uses",
    );
  }

  if (source.kind === "asset") {
    const section = isStageableSection(target) ? target : owningSection(graph, target.id);
    if (section) {
      const already = graph.edges.some((edge) => edge.from === section.id && edge.to === source.id);
      if (already) {
        return refuse(
          `“${section.label}” already reads “${source.label}”`,
          "A file is referenced by a step, not by another file — and this step already references it, so there is nothing to add.",
          "edge:uses",
        );
      }
      return {
        outcome: "offer",
        title:
          target.kind === "asset"
            ? "A file can’t reference another file"
            : "Connections run from a step to a file",
        description: `Reference “${source.label}” from “${section.label}” instead?`,
        actionLabel: `Reference it from ${section.label}`,
        op: { op: "connect_asset", nodeId: section.id, path: source.path },
        appliedTitle: "Connection staged",
        appliedDescription: `“${source.label}” will be referenced from “${section.label}” when you save.`,
      };
    }
    return refuse(
      "A file points nowhere",
      "A bundled file is something a step opens, so the arrow always runs from the step to the file — never out of it. Drag from the step onto the file instead.",
      "edge:uses",
    );
  }

  // ── Behaviour 3: teachable mistakes — a real edge kind you may not draw ──────────────────────
  if (target.kind === "entry_point") {
    return refuse(
      "A trigger is where a flow starts, so nothing points at it",
      `A ${edgeKindMeta("triggers").label.toLowerCase()} connection runs OUT of a keyword or a /command, never into one. To make “${target.label}” run after this step, mention it in the step's text — the projector draws the reference for you.`,
      "edge:triggers",
    );
  }

  if (isStageableSection(source) && isStageableSection(target)) {
    if (source.kind === "gatekeeper") {
      return refuse(
        "Branches are written, not drawn",
        `A ${edgeKindMeta("branch").label.toLowerCase()} connection out of a decision point comes from the condition prose in its body — “if …, go to …”. Write the branch in the section's text and the diagram follows; drawing a fourth arm onto a decision would make the picture less true, not more.`,
        "edge:branch",
      );
    }
    return refuse(
      "The order of steps comes from the document",
      `A ${edgeKindMeta("then").label.toLowerCase()} connection between two steps is the reading order of SKILL.md itself, so it is changed by moving the section, not by drawing an arrow. Reorder it in the code view or with the section's move controls.`,
      "edge:then",
    );
  }

  // Anything else got here despite `isConnectionOfferable` — still say WHY, never just "failed".
  return refuse(
    `A ${source.kind.replace(/_/g, " ")} can’t connect to a ${target.kind.replace(/_/g, " ")}`,
    "Only a step may reach for something: the arrow runs from a step to a file, a tool, a check or a loop guard. Everything else in the diagram is drawn from the document's own structure.",
    "edge:uses",
  );
}
