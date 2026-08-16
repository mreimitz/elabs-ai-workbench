import type { TraceVerdict } from "@mcp-token-footprint/shared";
import { NODE_HEIGHT_ESTIMATE, NODE_WIDTH } from "../design/graph-layout";

// ── WP 7.6 — evidence → canvas linking (pure helpers) ───────────────────────────────────────────
// The Trace tab is a LENS on the shared canvas: the Evidence panel's event rows deep-link back onto
// the graph (clicking an event centers the node whose verdict cites it). These helpers are pure so
// the mapping and the focus geometry are unit-testable without React Flow.

/**
 * Map each cited evidence event `idx` to the node whose verdict cites it. The FIRST verdict citing
 * an idx wins (the aligner emits verdicts in design order, so ties resolve to the earliest design
 * element — deterministic). Verdicts without a `nodeId` (edge-only verdicts) are skipped: an event
 * row can only focus a node.
 */
export function buildEventNodeIndex(verdicts: TraceVerdict[]): Map<number, string> {
  const index = new Map<number, string>();
  for (const verdict of verdicts) {
    if (!verdict.nodeId) continue;
    for (const idx of verdict.evidence) {
      if (!index.has(idx)) index.set(idx, verdict.nodeId);
    }
  }
  return index;
}

/** The subset of a React Flow node the focus-point math needs (kept structural for testability). */
export type FocusableNode = {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
};

/**
 * The point (flow coordinates) to center the viewport on for a node: its box center, using the
 * measured dimensions when React Flow has them and the layout's `NODE_WIDTH` /
 * `NODE_HEIGHT_ESTIMATE` before measurement — so an early click still lands close.
 */
export function resolveFocusPoint(node: FocusableNode): { x: number; y: number } {
  const width = node.measured?.width ?? NODE_WIDTH;
  const height = node.measured?.height ?? NODE_HEIGHT_ESTIMATE;
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
}
