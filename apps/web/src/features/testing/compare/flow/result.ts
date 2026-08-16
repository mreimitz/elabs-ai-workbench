import type { WorkspaceRun } from "../compare-runs";
import type { FlowLane, FlowNode, FlowTurn } from "./flow-types";

/**
 * The per-lane FINAL RESULT (compare-redesign §3.2·7, WP-7). The final answer is what the runs were
 * *for*, so it must not stay buried as the last `answer` cell of whichever turn it happened to land
 * in. This pure, React-free module reduces a {@link FlowLane} to the one thing the Result section +
 * the side-by-side output modal render: the run's final answer (or its terminal error / nothing).
 *
 * Resolution (per lane):
 *   1. the LAST `kind: "answer"` node across every turn — its full text is `node.resultText`
 *      (`build-flow.ts`), token weight `node.tokens`;
 *   2. else the lane's `terminal` guardrail/error block, rendered as the run's error state;
 *   3. else `none` — the run produced no final answer and ended without a recorded terminal block.
 */

export type LaneResultKind = "answer" | "error" | "none";

/** One lane's final result — the input to `ResultSection` + `ResultCompareDialog`. */
export type LaneResult = {
  letter: string;
  /** The run's series colour token (`var(--chart-N)`) — for the RunLetterBadge. */
  color: string;
  run: WorkspaceRun;
  kind: LaneResultKind;
  /** The full output text (answer prose, or the terminal error message); "" when `none`. */
  text: string;
  /** The answer's output-token weight, when the run recorded it. */
  tokens?: number;
};

/** The last `kind: "answer"` node across a lane's turns (turns arrive turn-ascending), or null. */
function lastAnswerNode(turns: FlowTurn[]): FlowNode | null {
  let found: FlowNode | null = null;
  for (const turn of turns) {
    for (const node of turn.nodes) {
      if (node.kind === "answer") found = node;
    }
  }
  return found;
}

/** Reduce one lane to its final {@link LaneResult}. */
export function laneResult(lane: FlowLane): LaneResult {
  const base = { letter: lane.letter, color: lane.color, run: lane.run };

  const answer = lastAnswerNode(lane.turns);
  if (answer) {
    return {
      ...base,
      kind: "answer",
      text: answer.resultText ?? answer.subtitle ?? "",
      ...(typeof answer.tokens === "number" ? { tokens: answer.tokens } : {}),
    };
  }

  const terminal = lane.terminal;
  if (terminal) {
    return {
      ...base,
      kind: "error",
      text: terminal.resultText ?? terminal.subtitle ?? "",
      ...(typeof terminal.tokens === "number" ? { tokens: terminal.tokens } : {}),
    };
  }

  return { ...base, kind: "none", text: "" };
}

/** The final result for every lane, in letter order (Ⓐ first). */
export function laneResults(lanes: FlowLane[]): LaneResult[] {
  return lanes.map(laneResult);
}
