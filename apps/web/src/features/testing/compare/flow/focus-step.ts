import type { RunDetail, RunStep } from "@mcp-token-footprint/shared";
import { toolCallIdOfStep } from "../../console-anchors";
import { parseFocusToken, type AlignedColumn, type FlowLane, type FlowNode } from "./flow-types";

/**
 * The step-drawer resolver (audit §H5 — the lossless drill loop). Turns the URL's opaque `?focus=`
 * token (`<letter>@<columnId>`, set by a flow cell) back into the concrete run + node + backing
 * `RunStep`s the drawer inspects. Pure + React-free so it is unit-testable and can't drift from the
 * alignment model the {@link FlowLanes} render from.
 *
 * A focus token only ever addresses a flow CELL (a lane's node in one aligned column), so the drawer
 * is a strict function of `{ focus, lanes, columns, details }` — the exact inputs Flow mode already
 * holds. A stale token (a run that left the set, a column that realigned away, a gap cell) resolves
 * to `null` and the drawer simply stays closed.
 */

export type FocusedStep = {
  /** The lane (run) the focused cell belongs to. */
  lane: FlowLane;
  /** The event block in that lane at the focused column. */
  node: FlowNode;
  /** The backing `tool_call` step (its args = the request), when this node is a persisted tool call. */
  callStep: RunStep | null;
  /** The paired `tool_result` step (its payload = the response), when one exists. */
  resultStep: RunStep | null;
};

/**
 * Resolve a `?focus=` token to the drawer's {@link FocusedStep}, or `null` when it doesn't address a
 * live cell. Tool nodes additionally resolve their persisted `tool_call` step (by `node.stepId`) and,
 * via that step's `toolCallId`, the paired `tool_result` step — so the drawer can show both the exact
 * request and the response through the reused console inspector (`PacketTabs`).
 */
export function resolveFocusedStep(
  focus: string | null,
  lanes: FlowLane[],
  columns: AlignedColumn[],
  details: Map<string, RunDetail>,
): FocusedStep | null {
  const parsed = parseFocusToken(focus);
  if (!parsed) return null;

  const laneIndex = lanes.findIndex((lane) => lane.letter === parsed.letter);
  if (laneIndex < 0) return null;
  const lane = lanes[laneIndex];
  if (!lane) return null;

  const column = columns.find((col) => col.id === parsed.columnId);
  if (!column) return null;

  // `preamble`/`node` columns carry per-lane cells; a `turn-header` has none (nothing to inspect).
  const node = column.cells?.[laneIndex] ?? null;
  if (!node) return null;

  const detail = details.get(lane.run.id) ?? null;
  let callStep: RunStep | null = null;
  let resultStep: RunStep | null = null;
  if (detail && node.stepId) {
    callStep = detail.steps.find((step) => step.id === node.stepId) ?? null;
    const toolCallId = callStep ? toolCallIdOfStep(callStep) : undefined;
    if (toolCallId) {
      resultStep =
        detail.steps.find(
          (step) => step.type === "tool_result" && toolCallIdOfStep(step) === toolCallId,
        ) ?? null;
    }
  }

  return { lane, node, callStep, resultStep };
}
