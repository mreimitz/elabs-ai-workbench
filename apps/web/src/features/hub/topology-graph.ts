// Assistant Hub (roadmap/assistant-hub/, WP2.2 · §1.9 · R-UX4) — the PURE mission-topology graph
// derivation. Given a topology + its agents (each with a live state) it lays out a directed graph
// (deterministic node positions + edges) that a `@elabs-ai/components-flow` canvas renders. Kept side-effect-free and
// framework-free so the layout is unit-tested in isolation (the React `TopologyGraph` component is a thin
// renderer over this). Used by BOTH the live mission board (real agent state on the nodes) and the crew
// builder preview (a static shape while a crew is defined).

import type { HubTopology } from "@mcp-token-footprint/shared";

/** Live-state of one node (drives its tone + eyebrow). `winner` = the best_of_n judge's pick. */
export type TopoNodeState = "idle" | "waiting" | "active" | "reported" | "missing" | "winner";

/** A `@elabs-ai/components-flow` `FlowNodeData` tone (mirrors the upstream union — no runtime import needed here). */
export type TopoTone = "default" | "accent" | "success" | "warning" | "destructive";

export type TopoGraphInputAgent = {
  id: string;
  title: string;
  subtitle?: string;
  state: TopoNodeState;
  /** Crew nesting (WP4.3 / D-CN2/D-CN5) — this slot is a sub-crew (its own nested sub-mission), not a
   *  single agent. Separate from `kind` (which stays the eyebrow TEXT — "Agent"/"Stage 1"/"Attempt 2" —
   *  unaffected by this flag). Drives the mission node's crew-glyph/member-count treatment instead of an
   *  avatar/model subtitle; the plain (crew-preview) node variant ignores it. */
  isCrew?: boolean;
  /** Crew nesting (WP4.3) — the sub-crew's member count, shown instead of the model subtitle. Absent
   *  when `isCrew` but the count isn't (yet) known (e.g. the sub-mission hasn't resolved). */
  memberCount?: number;
};

export type TopoGraphInput = {
  topology: HubTopology;
  agents: TopoGraphInputAgent[];
  /** The terminal node (synthesis / resolver; a judge is added for best_of_n). Omit for a bare shape. */
  terminal?: { state: TopoNodeState };
  /** hub-fixes WP4.4 (D-HF3) — for `debate` only: how many rounds the debate runs (openings + rebuttals).
   *  `1` = independent openings only; default {@link DEBATE_ROUNDS_DEFAULT} (openings + one rebuttal);
   *  clamped to 1..{@link DEBATE_ROUNDS_MAX}. Absent ⇒ the default — so a board that doesn't (yet) thread
   *  the plan value still draws the honest round-based default rather than a misleading sequential chain. */
  debateRounds?: number;
};

export type TopoGraphNode = {
  id: string;
  x: number;
  y: number;
  /** The eyebrow label (Agent / Stage 1 / Debater 1 / Attempt 1 / Judge / Synthesis / Resolver). */
  kind: string;
  title: string;
  subtitle?: string;
  tone: TopoTone;
  state: TopoNodeState;
  /** Crew nesting (WP4.3) — mirrors {@link TopoGraphInputAgent.isCrew}/`memberCount`, threaded through
   *  unchanged for the renderer. */
  isCrew?: boolean;
  memberCount?: number;
};

export type TopoGraphEdge = {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  /** Optional edge annotation (e.g. debate's "sees + rebuts" order chain, RC6.1). Web-local only —
   *  not part of the `packages/shared` wire contract. */
  label?: string;
};

export type TopoGraph = { nodes: TopoGraphNode[]; edges: TopoGraphEdge[] };

/** The synthetic terminal (synthesis/resolver) + judge node ids — the two non-agent nodes. Exported so
 *  the renderer can tell an AGENT node from these (e.g. to give agents the rich mission node), instead
 *  of the id strings being re-hardcoded at every consumer. Every OTHER node id is an agent session. */
export const TERMINAL_NODE_ID = "__terminal__";
export const JUDGE_NODE_ID = "__judge__";

/** True for an agent node (not the synthesis/judge node). A debate rebuttal id (`<agentId>::r{n}`) is
 *  still an agent node — only the two synthetic ids above are not. */
export function isAgentNodeId(id: string): boolean {
  return id !== TERMINAL_NODE_ID && id !== JUDGE_NODE_ID;
}

// Layout metrics (px) — a compact, readable grid; positions are deterministic for replay + tests.
const NODE_W = 210;
const COL_GAP = 44;
const ROW_GAP = 104;
const COL_STRIDE = NODE_W + COL_GAP;

// hub-fixes WP4.4 (D-HF3) — debate round count bounds, mirroring the API's `clampDebateRounds`
// (`apps/api/src/hub/missions/shared.ts`; web can't import API source). Kept in sync manually.
export const DEBATE_ROUNDS_DEFAULT = 2;
export const DEBATE_ROUNDS_MAX = 3;

/** Clamp a debate round count into 1..{@link DEBATE_ROUNDS_MAX} (default when absent/NaN). */
export function clampDebateRounds(rounds: number | undefined): number {
  if (rounds === undefined || !Number.isFinite(rounds)) return DEBATE_ROUNDS_DEFAULT;
  return Math.min(DEBATE_ROUNDS_MAX, Math.max(1, Math.trunc(rounds)));
}

const TONE_BY_STATE: Record<TopoNodeState, TopoTone> = {
  idle: "default",
  waiting: "default",
  active: "accent",
  reported: "success",
  winner: "success",
  missing: "destructive",
};

/** The synthesis/resolver terminal-node label per topology (best_of_n's terminal is the final answer,
 *  fed by the judge). Debate's terminal is explicitly named "Synthesis (resolver)" (RC6.1) — it is
 *  the same synthesis step every topology has, just doing double duty as the debate's resolver, not a
 *  separate agent. */
function terminalKind(topology: HubTopology): string {
  return topology === "debate" ? "Synthesis (resolver)" : "Synthesis";
}

function centerX(count: number): number {
  return count > 0 ? ((count - 1) * COL_STRIDE) / 2 : 0;
}

/** One-line "how this topology runs" legend, rendered inside {@link TopologyGraph} (RC6.1) so every
 *  consumer — the live mission board, the crew-profile preview, the crew-editor preview — states the
 *  same honest execution semantics without each owning its own copy. */
export const TOPOLOGY_LEGEND: Record<HubTopology, string> = {
  pipeline: "Stages run in order; each stage hands its output to the next, then synthesis summarizes.",
  parallel: "Agents work at the same time on the same task; synthesis combines every report.",
  // hub-fixes WP4.4 (D-HF3) — round-based debate: parallel openings, then each debater rebuts the others.
  debate: "Debaters open in parallel, then each rebuts the others' arguments in the next round; synthesis resolves.",
  best_of_n: "Attempts run independently; a blind judge picks the best, then synthesis finalizes.",
};

function toNode(
  agent: TopoGraphInputAgent,
  x: number,
  y: number,
  kind: string,
): TopoGraphNode {
  const kindLabel = agent.state === "winner" ? `${kind} · winner` : kind;
  return {
    id: agent.id,
    x,
    y,
    kind: kindLabel,
    title: agent.title,
    ...(agent.subtitle ? { subtitle: agent.subtitle } : {}),
    tone: TONE_BY_STATE[agent.state],
    state: agent.state,
    ...(agent.isCrew ? { isCrew: true as const } : {}),
    ...(agent.memberCount !== undefined ? { memberCount: agent.memberCount } : {}),
  };
}

/** The node id of debater `agent` in debate round `round` (1-based). Round 1 (the opening) keeps the bare
 *  `agent.id` — so it stays the board's addressable node (the default selection + the expand modal's
 *  node→agent map key resolve as before); later rounds suffix `::r{round}` (a rebuttal node). */
function debateNodeId(agent: TopoGraphInputAgent, round: number): string {
  return round <= 1 ? agent.id : `${agent.id}::r${round}`;
}

/** The eyebrow label for a debater's node in a given round (only round 1 needs a plain "Debater N" when
 *  there is no rebuttal round; otherwise openings + rebuttals are named so the row is legible). */
function debateNodeKind(index: number, round: number, rounds: number): string {
  if (rounds <= 1) return `Debater ${index + 1}`;
  if (round <= 1) return `Debater ${index + 1} · opening`;
  return rounds > 2 ? `Debater ${index + 1} · rebuttal ${round - 1}` : `Debater ${index + 1} · rebuttal`;
}

/**
 * Debate layout (RC6.1 · hub-fixes WP4.4 / D-HF3). Debate is ROUND-BASED: round 1 is a row of parallel
 * OPENINGS (independent — no cross-edges); each further round is a ROW of REBUTTALS where every debater
 * sees every OTHER debater's prior-round node, drawn as directed "rebuts" edges (opening_j → rebuttal_i
 * for j ≠ i, then rebuttal_j → next-rebuttal_i for deeper rounds). The FINAL round's nodes all feed the
 * terminal — labeled `Synthesis (resolver)` — because the mission synthesis resolves over every debater's
 * final position. `rounds` (from `input.debateRounds`) parameterizes the number of stacked rows: `1` draws
 * openings → synthesis with no rebuttal row; `2` (default) adds one rebuttal row; up to `3`.
 *
 * Builds on WP4.1's seam: this stayed a standalone function precisely so the single-row shape could become
 * the `rounds`-parameterized stacked rows here without touching {@link deriveTopologyGraph} or the callers.
 */
function deriveDebateGraph(
  agents: TopoGraphInputAgent[],
  terminal: TopoGraphInput["terminal"],
  rounds: number,
): TopoGraph {
  const nodes: TopoGraphNode[] = [];
  const edges: TopoGraphEdge[] = [];
  const pushEdge = (source: string, target: string, animated: boolean, label?: string): void => {
    edges.push({ id: `${source}->${target}`, source, target, animated, ...(label ? { label } : {}) });
  };

  // One row per round; each row is the debaters fanned left-to-right (parallel-reading — they are people,
  // not pipeline stages). Every round after the first draws "rebuts" edges from each OTHER debater's
  // prior-round node into this debater's node (cross-visibility — each rebuts the others, not itself).
  for (let round = 1; round <= rounds; round++) {
    const y = (round - 1) * ROW_GAP;
    agents.forEach((agent, i) => {
      const node = toNode(
        {
          id: debateNodeId(agent, round),
          title: agent.title,
          ...(agent.subtitle ? { subtitle: agent.subtitle } : {}),
          state: agent.state,
          ...(agent.isCrew ? { isCrew: true as const } : {}),
          ...(agent.memberCount !== undefined ? { memberCount: agent.memberCount } : {}),
        },
        i * COL_STRIDE,
        y,
        debateNodeKind(i, round, rounds),
      );
      nodes.push(node);
      if (round > 1) {
        for (let j = 0; j < agents.length; j++) {
          if (j === i) continue; // a debater rebuts the OTHERS, never re-reads itself
          pushEdge(debateNodeId(agents[j]!, round - 1), node.id, agent.state === "active", "rebuts");
        }
      }
    });
  }

  if (terminal) {
    const kind = terminalKind("debate");
    const termNode = toNode(
      { id: TERMINAL_NODE_ID, title: kind, state: terminal.state },
      centerX(agents.length),
      rounds * ROW_GAP,
      kind,
    );
    nodes.push(termNode);
    // Only the FINAL round's nodes feed the resolver — it composes over each debater's final position.
    for (const agent of agents) pushEdge(debateNodeId(agent, rounds), termNode.id, terminal.state === "active");
  }

  return { nodes, edges };
}

/**
 * Derive the directed topology graph (R-UX4). The four shapes:
 *   • parallel  — agents fan across one row → a synthesis node fans them back in.
 *   • pipeline  — a top-to-bottom chain (stage → stage → synthesis).
 *   • debate    — ROUND-BASED rows: parallel openings, then rebuttal round(s) with cross-visibility
 *                 ("rebuts" edges), the final round feeding the terminal labeled `Synthesis (resolver)`
 *                 (RC6.1 · WP4.4; `input.debateRounds` sets the round count — see {@link deriveDebateGraph}).
 *   • best_of_n — attempts fan across one row → a single Judge → the final synthesis.
 * Empty agent lists yield an empty graph (the caller renders an empty state instead).
 */
export function deriveTopologyGraph(input: TopoGraphInput): TopoGraph {
  const { topology, agents, terminal } = input;
  if (agents.length === 0) return { nodes: [], edges: [] };
  if (topology === "debate") return deriveDebateGraph(agents, terminal, clampDebateRounds(input.debateRounds));

  const nodes: TopoGraphNode[] = [];
  const edges: TopoGraphEdge[] = [];
  const edge = (source: string, target: string, animated: boolean): void => {
    edges.push({ id: `${source}->${target}`, source, target, animated });
  };
  const anyActive = agents.some((a) => a.state === "active");

  if (topology === "pipeline") {
    agents.forEach((agent, i) => {
      const y = i * ROW_GAP;
      nodes.push(toNode(agent, 0, y, `Stage ${i + 1}`));
      if (i > 0) edge(agents[i - 1]!.id, agent.id, agents[i]!.state === "active");
    });
    if (terminal) {
      const last = agents[agents.length - 1]!;
      const termNode = toNode(
        { id: TERMINAL_NODE_ID, title: terminalKind(topology), state: terminal.state },
        0,
        agents.length * ROW_GAP,
        terminalKind(topology),
      );
      nodes.push(termNode);
      edge(last.id, termNode.id, terminal.state === "active");
    }
    return { nodes, edges };
  }

  // parallel + best_of_n share the fan-out row; best_of_n inserts a Judge between the row and the answer.
  const isBestOfN = topology === "best_of_n";
  const kindFor = (i: number): string => (isBestOfN ? `Attempt ${i + 1}` : "Agent");
  agents.forEach((agent, i) => {
    nodes.push(toNode(agent, i * COL_STRIDE, 0, kindFor(i)));
  });
  const rowCenter = centerX(agents.length);

  if (isBestOfN) {
    const judgeState: TopoNodeState = terminal ? terminal.state : "idle";
    const judge = toNode(
      { id: JUDGE_NODE_ID, title: "Blind judge", state: judgeState },
      rowCenter,
      ROW_GAP,
      "Judge",
    );
    nodes.push(judge);
    for (const agent of agents) edge(agent.id, judge.id, anyActive);
    if (terminal) {
      const synth = toNode(
        { id: TERMINAL_NODE_ID, title: "Synthesis", state: terminal.state },
        rowCenter,
        ROW_GAP * 2,
        "Synthesis",
      );
      nodes.push(synth);
      edge(judge.id, synth.id, terminal.state === "active");
    }
    return { nodes, edges };
  }

  if (terminal) {
    const synth = toNode(
      { id: TERMINAL_NODE_ID, title: "Synthesis", state: terminal.state },
      rowCenter,
      ROW_GAP,
      "Synthesis",
    );
    nodes.push(synth);
    for (const agent of agents) edge(agent.id, synth.id, agent.state === "active");
  }
  return { nodes, edges };
}
