import type { RunSkill } from "@mcp-token-footprint/shared";
import type { WorkspaceRun } from "../compare-runs";

/**
 * Flow-mode domain (audit §H4) — the process-flow diff. All types the aligned-lane renderer, the LCS
 * alignment, and the three lenses share live HERE so the WP-4.3 files never re-derive the flow model
 * or leak types into `compare-runs.ts` (WP 4.2 owns that file). JSX-free so the alignment + diff logic
 * is unit-testable without React.
 *
 * The model is a **code-diff for agent traces**: each run becomes a lane; lanes are aligned column by
 * column (turn boundaries are hard anchors, tool steps LCS-matched inside a turn by name + normalized
 * args) so equivalent steps sit level and only-in-one-run steps render against a tinted gap.
 */

// ── The per-lane flow model ────────────────────────────────────────────────────────────────────────

/** The kinds of event block a lane row can carry (audit §H4 "event blocks per lane"). */
export type FlowNodeKind =
  | "preamble" // session preamble: skills loaded (name·version·eager·L1/L2 cost)
  | "reasoning" // assistant reasoning, collapsed to one line
  | "tool" // a tool call (server·tool·status·duration·result tokens)
  | "answer" // assistant prose / the final answer
  | "guardrail" // a guardrail stop
  | "error"; // a terminal error

/** One alignable / renderable unit inside a lane. */
export type FlowNode = {
  /** Unique within its lane. */
  id: string;
  kind: FlowNodeKind;
  /** The assistant-turn ordinal this node belongs to; `-1` for the preamble, `Infinity`-ish for the
   * terminal node (kept as the run's turn count so it sorts last). */
  turnIndex: number;
  /**
   * The LCS alignment key — equal keys across lanes are candidates to sit in the same column. Tools key
   * on `tool:<name>:<normArgs>`; per-turn blocks (reasoning/answer) key on `<kind>@t<turn>` so they
   * align positionally; preamble/terminal on their kind.
   */
  alignKey: string;
  title: string;
  /** A muted one-liner beside the title (arg preview, reasoning summary, server id …). */
  subtitle?: string;
  status?: "ok" | "error" | "running";
  // tool specifics
  toolName?: string;
  serverId?: string;
  /** Normalized (sorted-key) args JSON — the alignment payload; also shown in the changed popover. */
  argsJson?: string;
  /** Redacted tool result / answer text for the changed-outcome popover. */
  resultText?: string;
  resultIsError?: boolean;
  /** True when this tool call is a read-only skill disclosure (`read_skill_file` / `skill://…`). */
  isSkillDisclosure?: boolean;
  // cost / heat (audit §H4 cost lens)
  /** A representative token weight for the cost lens (tool result tokens, or a turn's output tokens). */
  tokens?: number;
  durationMs?: number;
  /** The backing `RunStep` id → the drill-loop focus target (WP 4.4 drawer). */
  stepId?: string;
};

/** The inner (non-preamble, non-terminal) nodes of one assistant turn. */
export type FlowTurn = {
  turnIndex: number;
  nodes: FlowNode[];
};

/** One run resolved to its ordered flow — the input to alignment. */
export type FlowLane = {
  runIndex: number;
  letter: string;
  color: string;
  isBaseline: boolean;
  run: WorkspaceRun;
  /** The session preamble (skills loaded + their cost). Always present. */
  preamble: FlowNode;
  turns: FlowTurn[];
  /** A terminal guardrail/error block, when the run ended abnormally. */
  terminal: FlowNode | null;
  /** Loaded skills (footprint + realized disclosure) — backs the Skills lens summary. */
  skills: RunSkill[];
};

// ── The aligned columns (the diff table) ────────────────────────────────────────────────────────────

/** Per-lane, per-column diff verdict (audit D-UX9 colours: green add · red remove · amber change). */
export type CellDiff = "unchanged" | "added" | "removed" | "changed" | "gap";

/** The column-level roll-up used for the divergence marker + turn-header tint. */
export type ColumnDiff = "unchanged" | "changed" | "gap";

/** One aligned row across every lane. `cells[i]` is lane i's node here, or `null` for a gap. */
export type AlignedColumn = {
  /** Stable dom/focus id, e.g. `pre`, `t2h`, `t2c1`, `term0`. */
  id: string;
  kind: "preamble" | "turn-header" | "node";
  /** The turn this column belongs to (turn-header + node columns); `-1` for the preamble. */
  turnIndex: number;
  /** For a `turn-header`: which lanes actually have this turn. */
  present?: boolean[];
  /** For `preamble` / `node`: lane i's node, or null (gap). */
  cells?: (FlowNode | null)[];
};

// ── Lenses (audit §H4) ──────────────────────────────────────────────────────────────────────────────

/** The reduce-to-signal lenses; `none` is the full aligned diff. */
export const FLOW_LENSES = ["none", "tools", "skills", "cost"] as const;
export type FlowLens = (typeof FLOW_LENSES)[number];

export const FLOW_LENS_LABEL: Record<FlowLens, string> = {
  none: "Full diff",
  tools: "Tools",
  skills: "Skills",
  cost: "Cost heat",
};

// ── Collapsed display rows (audit §H4/F3, WP-4 "changes first") ───────────────────────────────────────

/**
 * One renderable Flow row after {@link collapseColumns} (`flow/collapse.ts`) groups consecutive
 * all-unchanged `node` columns: either an ordinary aligned `column`, or a collapsed `group` of
 * columns rendered as one `── N identical steps ──` row until expanded.
 */
export type DisplayRow =
  | { type: "column"; column: AlignedColumn }
  | { type: "group"; id: string; columns: AlignedColumn[]; count: number };

// ── Focus token (drill loop seam, H5 — the drawer itself lands in WP 4.4) ────────────────────────────

/** A focus token: `<letter>@<columnId>` (e.g. `B@t2c1`). Kept opaque to the URL layer. */
export function makeFocusToken(letter: string, columnId: string): string {
  return `${letter}@${columnId}`;
}

/** Parse a focus token back to its `{ letter, columnId }`, or null when it isn't a flow token. */
export function parseFocusToken(token: string | null): { letter: string; columnId: string } | null {
  if (!token) return null;
  const at = token.indexOf("@");
  if (at <= 0 || at === token.length - 1) return null;
  return { letter: token.slice(0, at), columnId: token.slice(at + 1) };
}
