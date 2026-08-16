import type { AlignedColumn, CellDiff, ColumnDiff, FlowLane, FlowNode } from "./flow-types";

/**
 * The diff + lens derivations layered over the aligned columns (audit §H4). All pure — the renderer
 * asks these functions "what colour is this cell", "where do the runs diverge", "how hot is this step".
 */

/** The lane index every Δ is measured against (the baseline chip; falls back to the first lane). */
export function baselineIndex(lanes: FlowLane[]): number {
  const found = lanes.findIndex((lane) => lane.isBaseline);
  return found >= 0 ? found : 0;
}

/**
 * Per-lane diff verdict for a `preamble`/`node` column (D-UX9 colours):
 * - `gap` — this lane has no step here (renders an empty, tinted gap).
 * - `changed` — every lane has the step but their OUTCOMES differ (amber, both/all sides).
 * - `added` — present in a non-baseline lane the baseline lacks (green).
 * - `removed` — baseline-exclusive step no other lane ran (red, on the baseline cell).
 * - `unchanged` — shared with the baseline, same outcome (neutral).
 */
export function columnCellDiffs(cells: (FlowNode | null)[], baselineIdx: number): CellDiff[] {
  const baselinePresent = cells[baselineIdx] != null;
  const changed = isChangedOutcome(cells);
  const baselineExclusive =
    baselinePresent && cells.every((c, i) => i === baselineIdx || c == null);

  return cells.map((cell, i) => {
    if (cell == null) return "gap";
    if (changed) return "changed";
    if (i === baselineIdx) return baselineExclusive ? "removed" : "unchanged";
    return baselinePresent ? "unchanged" : "added";
  });
}

/** The column-level roll-up (drives the divergence marker + the turn-header tint). */
export function columnDiff(cells: (FlowNode | null)[]): ColumnDiff {
  if (isChangedOutcome(cells)) return "changed";
  const present = cells.some((c) => c != null);
  const absent = cells.some((c) => c == null);
  return present && absent ? "gap" : "unchanged";
}

/** True when every lane has a cell here but the tool/answer OUTCOME status differs across them. */
function isChangedOutcome(cells: (FlowNode | null)[]): boolean {
  const present = cells.filter((c): c is FlowNode => c != null);
  if (present.length !== cells.length || present.length < 2) return false;
  const statuses = new Set(present.map((c) => c.status ?? "ok"));
  return statuses.size > 1;
}

/**
 * The id of the first `node` column where the runs diverge — the first column that isn't `unchanged`
 * across every lane (a gap or a changed outcome). Null when the flows are identical. The gutter flags
 * this column and the verdict band's reasons jump here.
 */
export function divergenceColumnId(columns: AlignedColumn[]): string | null {
  for (const col of columns) {
    if (col.kind !== "node" || !col.cells) continue;
    if (columnDiff(col.cells) !== "unchanged") return col.id;
  }
  return null;
}

// ── Cost lens ───────────────────────────────────────────────────────────────────────────────────────

/** The largest single-step token weight across every lane — the cost-heat denominator. */
export function maxStepTokens(columns: AlignedColumn[]): number {
  let max = 0;
  for (const col of columns) {
    if (!col.cells) continue;
    for (const cell of col.cells) {
      if (cell?.tokens && cell.tokens > max) max = cell.tokens;
    }
  }
  return max;
}

/** Bucket a step's token weight into a 0–4 heat level (0 = none) against the run set's hottest step. */
export function heatLevel(tokens: number | undefined, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!tokens || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  if (ratio > 0) return 1;
  return 0;
}

// ── Tools lens ────────────────────────────────────────────────────────────────────────────────────────

/** One chip in a lane's tool ribbon. */
export type ToolRibbonItem = { id: string; toolName: string; failed: boolean; isSkill: boolean };

/** Reduce a lane to its ordered tool-call ribbon (audit §H4 Tools lens). */
export function toolRibbon(lane: FlowLane): ToolRibbonItem[] {
  const items: ToolRibbonItem[] = [];
  for (const turn of lane.turns) {
    for (const node of turn.nodes) {
      if (node.kind !== "tool") continue;
      items.push({
        id: node.id,
        toolName: node.toolName ?? node.title,
        failed: node.status === "error",
        isSkill: node.isSkillDisclosure === true,
      });
    }
  }
  return items;
}

// ── Skills lens ───────────────────────────────────────────────────────────────────────────────────────

/** A lane's per-skill mini-summary — "was the skill worth its tokens" (audit §H4 Skills lens). */
export type SkillSummaryItem = {
  skillId: string;
  name: string;
  versionLabel: string;
  eager: boolean;
  footprintTokens: number;
  disclosureReads: number;
  disclosureTokens: number;
  /** Loaded but never opened AND not eagerly inlined → its tokens bought nothing this run. */
  unused: boolean;
};

export function skillSummary(lane: FlowLane): SkillSummaryItem[] {
  return lane.skills.map((skill) => ({
    skillId: skill.skillId,
    name: skill.name,
    versionLabel: skill.versionLabel,
    eager: skill.eager,
    footprintTokens: skill.footprint?.totalTokens ?? 0,
    disclosureReads: skill.disclosureReads,
    disclosureTokens: skill.disclosureTokens,
    unused: !skill.eager && skill.disclosureReads === 0,
  }));
}
