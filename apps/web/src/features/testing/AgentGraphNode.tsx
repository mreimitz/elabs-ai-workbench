import type { ComponentType } from "react";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { LucideProps } from "lucide-react";
import { AlertTriangle, BrainCog, ClipboardCheck, Gavel, MessageSquare, Wrench } from "lucide-react";
import { Badge, Text, cn } from "@elabs-ai/components-ui";
import { formatCostUsd, formatDuration, formatNumber } from "../../lib/format";
import type { AgentGraphNodeKind } from "./agent-graph";

/**
 * Observability WP 3.5 — one node of the run's agent graph. A `@xyflow/react` custom node composed
 * entirely of `@elabs-ai/components-ui` parts (the `MissionAgentNode` precedent): the brand `FlowNode`
 * carries only title/subtitle/kind/icon/tone, and this node needs a chip row (count · tokens · cost ·
 * duration · errors), so it is a composition rather than a hand-rolled widget.
 *
 * Accessibility: state is NEVER carried by colour alone (`brand-ui` Badge's own anti-pattern list).
 * A failing node gets the destructive border AND a badge that spells out "1 error" behind an
 * `AlertTriangle` glyph; the ×N counter is a text badge; every figure is `tabular-nums` so columns of
 * digits line up. React Flow's own `.react-flow__node` wrapper supplies the focus/keyboard contract,
 * so the card itself adds no tab stop of its own.
 */

/** The rendered card width — `agent-graph.ts`'s `AGENT_NODE_WIDTH`, so columns and stride agree. */
const NODE_WIDTH_CLASS = "w-[220px]";

const KIND_META: Record<
  AgentGraphNodeKind,
  { eyebrow: string; Icon: ComponentType<LucideProps> }
> = {
  user: { eyebrow: "Prompt", Icon: MessageSquare },
  turn: { eyebrow: "Turn", Icon: BrainCog },
  tool: { eyebrow: "Tool", Icon: Wrench },
  rating: { eyebrow: "Rating", Icon: ClipboardCheck },
  judge: { eyebrow: "Judge", Icon: Gavel },
};

export type AgentGraphNodeData = {
  kind: AgentGraphNodeKind;
  title: string;
  /** How many occurrences merged into this node — rendered as `×N` when greater than 1. */
  count: number;
  tokensIn: number;
  tokensOut: number;
  /** `null` = the run cannot answer the cost question (no cumulative snapshots) — chip suppressed. */
  costUsd: number | null;
  /** `null` = untimed — chip suppressed rather than rendered as `0ms`. */
  durationMs: number | null;
  errors: number;
  /** Suppresses the cost chip entirely for a basis with no honest per-node dollar figure. */
  costSuppressed: boolean;
  /** Marks the cost chip as an estimate (a subscription run's shadow price). */
  costEstimated: boolean;
} & Record<string, unknown>;

export type AgentGraphRFNode = Node<AgentGraphNodeData, "agentGraph">;

/** Every side carries a source AND a target handle (id === side), so an edge can pick the anchor that
 *  reads best: forward edges go bottom→top / right→left, a loop-back leaves and re-enters on the left,
 *  and a self-loop exits right and re-enters at the bottom (otherwise it would be a zero-length path). */
const HANDLE_SIDES = [
  { side: "top", position: Position.Top },
  { side: "right", position: Position.Right },
  { side: "bottom", position: Position.Bottom },
  { side: "left", position: Position.Left },
] as const;

const HANDLE_CLASS = "!size-2 !border-2 !border-flow-edge !bg-flow-node";

export function AgentGraphNode({ data, selected }: NodeProps<AgentGraphRFNode>) {
  const meta = KIND_META[data.kind];
  const Icon = meta.Icon;
  const failed = data.errors > 0;
  const tokens = data.tokensIn + data.tokensOut;
  const showCost = !data.costSuppressed && data.costUsd !== null;

  return (
    <div
      className={cn(
        NODE_WIDTH_CLASS,
        "rounded-lg border bg-flow-node px-3 py-2 text-flow-node-foreground shadow-sm",
        failed ? "border-destructive" : "border-border",
        selected && "ring-2 ring-ring",
      )}
    >
      {HANDLE_SIDES.map(({ side, position }) => (
        <Handle
          key={`target-${side}`}
          id={side}
          type="target"
          position={position}
          className={HANDLE_CLASS}
        />
      ))}
      {HANDLE_SIDES.map(({ side, position }) => (
        <Handle
          key={`source-${side}`}
          id={side}
          type="source"
          position={position}
          className={HANDLE_CLASS}
        />
      ))}

      <div className="flex items-center gap-1.5">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Text variant="meta" tone="muted" as="span" className="uppercase tracking-wide">
          {meta.eyebrow}
        </Text>
        {data.count > 1 ? (
          <Badge variant="secondary" className="ml-auto tabular-nums">
            ×{formatNumber(data.count)}
          </Badge>
        ) : null}
      </div>

      <Text as="div" className="mt-0.5 truncate font-medium" title={data.title}>
        {data.title}
      </Text>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {tokens > 0 ? (
          <Text variant="meta" tone="muted" as="span" className="tabular-nums">
            ↑{formatNumber(data.tokensIn)} ↓{formatNumber(data.tokensOut)}
          </Text>
        ) : null}
        {showCost ? (
          <Text variant="meta" tone="muted" as="span" className="tabular-nums">
            {data.costEstimated ? "est. " : ""}
            {formatCostUsd(data.costUsd ?? 0)}
          </Text>
        ) : null}
        {data.durationMs !== null ? (
          <Text variant="meta" tone="muted" as="span" className="tabular-nums">
            {formatDuration(data.durationMs)}
          </Text>
        ) : null}
      </div>

      {failed ? (
        <Badge variant="destructive" className="mt-1.5 gap-1">
          <AlertTriangle aria-hidden className="size-3" />
          <span className="tabular-nums">
            {formatNumber(data.errors)} {data.errors === 1 ? "error" : "errors"}
          </span>
        </Badge>
      ) : null}
    </div>
  );
}
