import type { AlignedColumn, FlowLane, FlowNode } from "./flow-types";

/**
 * The heart of Flow mode (audit §H4): align N run lanes into a single column table like a code diff.
 *
 * Two-level alignment, exactly as the audit specifies — **anchor on turn boundaries, THEN LCS-align
 * the step sequence inside each turn** (match by tool name + normalized args, carried on
 * {@link FlowNode.alignKey}):
 *
 *   1. one `preamble` column (all lanes' session-start block sit level);
 *   2. for every turn ordinal in the union of lanes: a `turn-header` separator column (marking which
 *      lanes reached that turn) followed by the LCS-aligned inner `node` columns for that turn;
 *   3. the terminal guardrail/error columns, aligned by kind.
 *
 * Multi-lane alignment is progressive: lane 0 seeds the columns, then each further lane is LCS-merged
 * into the growing column spine by `alignKey`. Equivalent steps land in one column; a step in only some
 * lanes leaves the others as a `null` gap (rendered with add/remove tinting by the diff layer).
 *
 * Pure + deterministic → unit-tested in `align.test.ts`.
 */
export function alignLanes(lanes: FlowLane[]): AlignedColumn[] {
  if (lanes.length === 0) return [];
  const laneCount = lanes.length;
  const columns: AlignedColumn[] = [];

  // 1 · preamble — every lane has exactly one, so it is a single fully-populated column.
  columns.push({
    id: "pre",
    kind: "preamble",
    turnIndex: -1,
    cells: lanes.map((lane) => lane.preamble),
  });

  // 2 · turns — the union of turn ordinals across all lanes, in order.
  const turnOrdinals = [
    ...new Set(lanes.flatMap((lane) => lane.turns.map((t) => t.turnIndex))),
  ].sort((a, b) => a - b);

  for (const t of turnOrdinals) {
    const present = lanes.map((lane) => lane.turns.some((turn) => turn.turnIndex === t));
    columns.push({ id: `t${t}h`, kind: "turn-header", turnIndex: t, present });

    const perLaneNodes = lanes.map(
      (lane) => lane.turns.find((turn) => turn.turnIndex === t)?.nodes ?? [],
    );
    const inner = alignNodeLists(perLaneNodes, laneCount, `t${t}c`, t);
    columns.push(...inner);
  }

  // 3 · terminal blocks — aligned by kind so a shared guardrail stop sits level.
  const terminalLists = lanes.map((lane) => (lane.terminal ? [lane.terminal] : []));
  if (terminalLists.some((list) => list.length > 0)) {
    const terminalTurn = Math.max(...lanes.map((lane) => laneTurnCount(lane))) + 1;
    columns.push(...alignNodeLists(terminalLists, laneCount, "term", terminalTurn));
  }

  return columns;
}

function laneTurnCount(lane: FlowLane): number {
  return lane.turns.reduce((max, turn) => Math.max(max, turn.turnIndex), -1) + 1;
}

/**
 * Progressive multi-sequence alignment of one node list per lane, keyed by {@link FlowNode.alignKey}.
 * Lane 0 seeds the columns; each subsequent lane is LCS-merged in. Returns the ordered `node` columns.
 */
export function alignNodeLists(
  perLaneNodes: FlowNode[][],
  laneCount: number,
  idPrefix: string,
  turnIndex: number,
): AlignedColumn[] {
  let cols: WorkingColumn[] = [];
  for (let lane = 0; lane < perLaneNodes.length; lane++) {
    cols = mergeLane(cols, perLaneNodes[lane] ?? [], lane, laneCount);
  }
  return cols.map((col, i) => ({
    id: `${idPrefix}${i}`,
    kind: "node" as const,
    turnIndex,
    cells: col.cells,
  }));
}

type WorkingColumn = {
  /** The column's alignment key (the key of whichever lane first created it). */
  key: string;
  cells: (FlowNode | null)[];
};

/** Merge one lane's nodes into the existing column spine, inserting new columns for unmatched nodes. */
function mergeLane(
  columns: WorkingColumn[],
  nodes: FlowNode[],
  laneIndex: number,
  laneCount: number,
): WorkingColumn[] {
  const colKeys = columns.map((c) => c.key);
  const nodeKeys = nodes.map((n) => n.alignKey);
  const matches = lcsMatches(colKeys, nodeKeys);

  const out: WorkingColumn[] = [];
  let ci = 0;
  let nj = 0;
  // Walk both sequences, emitting unmatched columns + unmatched (new) nodes in order, and folding each
  // matched node into its existing column. A sentinel match flushes both tails.
  for (const [mc, mn] of [...matches, [columns.length, nodes.length] as [number, number]]) {
    while (ci < mc) {
      out.push(columns[ci]!);
      ci++;
    }
    while (nj < mn) {
      out.push(newColumn(nodes[nj]!, laneIndex, laneCount));
      nj++;
    }
    if (mc < columns.length && mn < nodes.length) {
      const col = columns[mc]!;
      col.cells[laneIndex] = nodes[mn]!;
      out.push(col);
      ci = mc + 1;
      nj = mn + 1;
    }
  }
  return out;
}

function newColumn(node: FlowNode, laneIndex: number, laneCount: number): WorkingColumn {
  const cells: (FlowNode | null)[] = new Array(laneCount).fill(null);
  cells[laneIndex] = node;
  return { key: node.alignKey, cells };
}

/**
 * Longest-common-subsequence match pairs between two key sequences, as increasing `[aIndex, bIndex]`
 * pairs. Standard DP; repeated keys align by position (first-occurrence to first-occurrence), which is
 * exactly what a trace diff wants when a tool is called twice with the same args.
 */
export function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
