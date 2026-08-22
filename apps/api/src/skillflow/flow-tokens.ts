import type {
  SkillFileNode,
  SkillFlowNodeCost,
  SkillGraph,
  SkillGraphNode,
  TokenProfileId,
} from "@mcp-token-footprint/shared";
import { getTokenCounter } from "../token-counting/profiles.js";

// RM-30 WP 7.8 — what each graph node costs the model to READ.
//
// This is the measurement behind the entry-point flow's headline sentence ("always reads 4 sections,
// 1,240 tokens. May additionally read 1 file and call 1 tool, up to 3,900 tokens."), and the whole
// reason this work package is worth its size: without a number, the diagram is a picture.
//
// IT INTRODUCES NO SECOND COUNTER, which is a hard constraint of the work package:
//
//   • a SECTION's cost is the tokens of its own `SKILL.md` line span, counted with the VERSION'S OWN
//     token profile through `getTokenCounter` — the same `TokenCounter` interface `countLevels` uses
//     for L1/L2/L3, not a parallel implementation;
//   • a bundled FILE's cost is the `tokenTotal` the footprint accounting ALREADY persisted on
//     `skill_files` when the version was created. It is read, never recomputed;
//   • a LOOP GUARD is a construct, not prose — it has no text of its own, so it costs 0;
//   • a TOOL REFERENCE is deliberately absent. A tool's definition tokens come from the bound
//     server's SCAN, not from the skill, and the caller already holds them (`BoundTool.definitionTokens`).
//     Emitting a 0 here would read as "this tool is free", which is the opposite of true.
//
// Section spans are DISJOINT by construction — the projector ends a section's anchor at the line
// before the next heading — so summing a set of sections never double-counts a nested one.

/** A section node is heading-anchored: its label is the last element of its own heading path. This
 *  mirrors `edit-ops.ts`'s `isSectionNode` exactly (an annotated heading can project as a gate). */
function isHeadingAnchored(node: SkillGraphNode): boolean {
  const headingTitle = node.anchor.headingPath[node.anchor.headingPath.length - 1];
  return headingTitle !== undefined && headingTitle === node.label;
}

/** The 1-based inclusive `[startLine, endLine]` slice of `lines`, clamped to the document. */
function spanText(lines: string[], startLine: number, endLine: number): string {
  const from = Math.max(0, Math.floor(startLine) - 1);
  const to = Math.min(lines.length, Math.floor(endLine));
  if (to <= from) return "";
  return lines.slice(from, to).join("\n");
}

/**
 * Per-node read cost for a projected graph.
 *
 * Pure apart from the token counter's own (cached, offline) BPE tables: same `(graph, skillMd, files,
 * profile)` always yields the same list, in graph order. A node the rules cannot measure is OMITTED
 * rather than reported as 0 — absent means UNKNOWN, and the caller says "not measured" instead of
 * quietly understating a flow's cost.
 */
export async function computeFlowNodeCosts(
  graph: SkillGraph,
  skillMd: string,
  files: SkillFileNode[],
  profile: TokenProfileId,
): Promise<SkillFlowNodeCost[]> {
  const counter = getTokenCounter(profile);
  const lines = skillMd.split(/\r?\n/);
  const tokensByPath = new Map(files.map((file) => [file.path, file.tokenTotal] as const));
  const costs: SkillFlowNodeCost[] = [];

  for (const node of graph.nodes) {
    if (node.kind === "tool_ref") continue; // scan-owned, not skill-owned — see the header
    if (node.kind === "loop_guard") {
      costs.push({ nodeId: node.id, tokens: 0 });
      continue;
    }
    if (!isHeadingAnchored(node)) {
      // An accessory box: a bundled file, or an inferred validation gate over a script file.
      const path =
        node.kind === "asset"
          ? node.path
          : node.kind === "validation_gate"
            ? node.script
            : undefined;
      const tokens = path === undefined ? undefined : tokensByPath.get(path);
      if (tokens !== undefined) costs.push({ nodeId: node.id, tokens });
      continue;
    }
    const text = spanText(lines, node.anchor.startLine, node.anchor.endLine);
    costs.push({ nodeId: node.id, tokens: await counter.countText(text) });
  }

  return costs;
}
