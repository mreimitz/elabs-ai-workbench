import type { ReactNode } from "react";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Text, cn } from "@elabs-ai/components-ui";
import { Users } from "lucide-react";
import type { TopoNodeState } from "./topology-graph";

/**
 * Assistant Hub — the MISSION topology graph's AGENT node (owner request), modeled on a social-profile
 * card: a circular AVATAR overlapping the node's TOP edge, a STATUS indicator in the top-right corner
 * (where a profile card's "Follow" button sits), the agent's real NAME, a muted TECHNICAL/model line,
 * and a 2-line PROMPT (brief) preview — no "AGENT" eyebrow. Registered as the `missionAgent` node type
 * ONLY for the mission graphs (`TopologyGraph variant="mission"`); the synthesis/judge/terminal nodes
 * and every crew-preview node keep the plain `@elabs-ai/components-flow` `FlowNode`. The brief preview is a plain
 * 2-line clamp (NOT a HoverCard) — a non-portalled popover would be clipped/zoom-scaled by the RF
 * canvas; the full prompt lives on the report card's hover instead.
 *
 * The avatar rides in as `data.icon` (a `RoleAvatar` element the mission callers put in `iconById`);
 * `data.state` drives the status colour. The `.react-flow__node[data-id]` focus/keyboard contract is
 * preserved automatically by React Flow, so selection + keyboard nav keep working.
 */
export type MissionAgentNodeData = {
  /** The agent's display name (the role name). */
  title: string;
  /** The technical line — the model id. */
  subtitle?: string;
  /** A 2-line preview of the prompt (brief) the agent received. */
  brief?: string;
  /** Live state → status colour + label. */
  state: TopoNodeState;
  /** The `RoleAvatar` element (from `iconById`) overlapping the node's top edge. */
  icon?: ReactNode;
  /** Crew nesting (WP4.3 / D-CN2/D-CN5) — this node is a sub-crew slot (its own nested sub-mission), not
   *  a single agent. Swaps the avatar for a crew glyph and the model subtitle for a member-count line;
   *  the status ring/dot (driven by `state`) is unchanged — a sub-crew reads waiting/active/reported/
   *  missing exactly like a leaf agent. */
  isCrew?: boolean;
  /** Crew nesting (WP4.3) — the sub-crew's member count, shown under the title when `isCrew`. */
  memberCount?: number;
} & Record<string, unknown>;

export type MissionAgentRFNode = Node<MissionAgentNodeData, "missionAgent">;

/** Border/ring tint per state (mirrors `@elabs-ai/components-flow` `FlowNode`'s tone→ring idea, token-driven). */
const STATUS_RING: Record<TopoNodeState, string> = {
  idle: "border-border",
  waiting: "border-border",
  active: "border-primary",
  reported: "border-success",
  winner: "border-success",
  missing: "border-destructive",
};

/** The status dot's fill per state. */
const STATUS_DOT: Record<TopoNodeState, string> = {
  idle: "bg-muted-foreground",
  waiting: "bg-muted-foreground",
  active: "bg-primary",
  reported: "bg-success",
  winner: "bg-success",
  missing: "bg-destructive",
};

/** The status pill's short label per state. */
const STATUS_LABEL: Record<TopoNodeState, string> = {
  idle: "idle",
  waiting: "waiting",
  active: "working",
  reported: "reported",
  winner: "winner",
  missing: "no report",
};

export function MissionAgentNode({ data, selected }: NodeProps<MissionAgentRFNode>) {
  const status = data.state ?? "idle";
  const isCrew = data.isCrew === true;
  return (
    // Outer wrapper stays overflow-VISIBLE so the avatar can overhang the top edge; the card child
    // owns the rounded border. Width matches the layout's NODE_W (210) so truncation + stride agree.
    <div className="relative w-[210px]">
      {/* Edge anchors — kept so edges still connect (top target = incoming, bottom source = outgoing). */}
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border-2 !border-flow-edge !bg-flow-node"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border-2 !border-flow-edge !bg-flow-node"
      />

      {/* Avatar overhangs the top edge (~50% out), top-LEFT so it never covers the top-center target
          handle / an incoming pipeline·debate edge. Carries its own ring via the passed RoleAvatar.
          Crew nesting (WP4.3) — a sub-crew slot swaps the avatar for a crew glyph badge (same overhang
          position/size); every non-crew node's render stays byte-for-byte unchanged. */}
      {isCrew ? (
        <div
          aria-hidden
          className="absolute -top-4 left-3 z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground ring-2 ring-card"
        >
          <Users aria-hidden className="size-4" />
        </div>
      ) : data.icon ? (
        <div className="absolute -top-4 left-3 z-10">{data.icon}</div>
      ) : null}

      {/* Status pill, top-right (the profile card's "Follow" slot). */}
      <div
        className={cn(
          "absolute -top-2 right-2 z-10 flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5",
          STATUS_RING[status],
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            STATUS_DOT[status],
            status === "active" && "animate-pulse",
          )}
        />
        <span className="text-meta font-medium leading-none text-muted-foreground">
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* The card. Top padding clears the overhanging avatar; no eyebrow. */}
      <div
        className={cn(
          "rounded-lg border bg-flow-node px-3 pb-2.5 pt-7 text-flow-node-foreground shadow-sm",
          STATUS_RING[status],
          selected && "ring-2 ring-ring",
        )}
      >
        <Text className="min-w-0 truncate font-semibold" title={data.title}>
          {data.title}
        </Text>
        {/* Crew nesting (WP4.3) — a sub-crew slot shows its member count instead of the model subtitle;
            every non-crew node keeps the exact prior subtitle render. */}
        {isCrew ? (
          <Text variant="caption" tone="muted" className="min-w-0 truncate">
            {data.memberCount !== undefined
              ? `${data.memberCount} agent${data.memberCount === 1 ? "" : "s"}`
              : "Sub-crew"}
          </Text>
        ) : data.subtitle ? (
          <Text variant="caption" tone="muted" className="min-w-0 truncate" title={data.subtitle}>
            {data.subtitle}
          </Text>
        ) : null}
        {data.brief ? (
          <Text
            variant="caption"
            tone="muted"
            className="mt-1.5 line-clamp-2 break-words leading-snug"
          >
            {data.brief}
          </Text>
        ) : null}
      </div>
    </div>
  );
}
