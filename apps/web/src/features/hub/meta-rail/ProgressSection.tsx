import { useState } from "react";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@elabs-ai/components-ai";
import { Badge, Button, Card, EmptyState, Input, Progress, Text } from "@elabs-ai/components-ui";
import type { HubMissionBudgets, HubTaskItem } from "@mcp-token-footprint/shared";
import { ListTodo, OctagonX, Send } from "lucide-react";
import { StatusBadge } from "../../../components/StatusBadge";
import { IconButton } from "../../../components/IconButton";
import { RoleAvatar } from "../agents/RoleAvatar";
import { taskStatusToStatus } from "../hub-tool-parts";
import { missionAgentIcon, type MissionRoleLookup } from "../lib/mission-agent-icon";
import type { MissionBoardAgentView, MissionBoardPhase, MissionBoardView } from "../MissionBoard";
import { missionAgentStatusRaw, missionStatusRaw } from "./mission-status";

/**
 * Assistant Hub UX (WP1.2, D-HUX3) — the meta rail's PROGRESS section: the existing per-turn
 * `TaskWidget` composition, plus — during a mission — the agent list with per-agent `StatusBadge`
 * and stop/steer actions. The concept (§7.1) is explicit that the full mission board (topology
 * graph, per-agent finding cards, the waiting `Queue`) STAYS in-stream; this section is its
 * "always-visible summary", so it intentionally reproduces only the task list + a compact roster —
 * not `MissionBoard.tsx`'s full card grid.
 *
 * `TaskProgressList` below is a refactor-only copy of `ConversationPane.tsx`'s exported `TaskWidget`
 * body (≤5 visible + "Show N more", reconciled by id) MINUS its `mx-4 mt-2` outer margin, which was
 * sized for the transcript gutter, not this section's own padding. `ConversationPane.tsx` is frozen
 * this wave (WP1.3 owns it) — copying avoids touching a file this WP doesn't own, per the workstream
 * README's "prefer copying, leave source exports intact" guidance.
 */

const TASK_VISIBLE_CAP = 5;

export type MetaRailProgressProps = {
  tasks: HubTaskItem[];
  /** The session's live mission board, if one is proposed/running/done. `undefined`/`null` ⇒ no
   *  mission has ever been proposed this session (mirrors `reconstructMissionBoard`'s own return). */
  missionBoard?: MissionBoardView | null;
  /** The role library (by id + name), for resolving each agent's avatar icon. Absent ⇒ model-logo/glyph. */
  roleLookup?: MissionRoleLookup;
  missionBudgets?: HubMissionBudgets;
  /** Disables mission mutating actions while a stop/steer request is in flight. */
  busy?: boolean;
  onStopMission?: (missionId: string) => void;
  onStopAgent?: (missionId: string, agentSessionId: string) => void;
  onSteerAgent?: (missionId: string, agentSessionId: string, text: string) => void;
};

export function ProgressSection({
  tasks,
  missionBoard,
  roleLookup,
  missionBudgets,
  busy,
  onStopMission,
  onStopAgent,
  onSteerAgent,
}: MetaRailProgressProps) {
  const hasTasks = tasks.length > 0;
  const hasMission = !!missionBoard;

  if (!hasTasks && !hasMission) {
    return (
      <EmptyState
        icon={<ListTodo aria-hidden />}
        title="No active work"
        description="Turn tasks and mission agents appear here while the assistant is working."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {hasTasks ? <TaskProgressList tasks={tasks} /> : null}
      {missionBoard ? (
        <MissionSummary
          board={missionBoard}
          {...(roleLookup ? { roleLookup } : {})}
          budgets={missionBudgets}
          busy={busy}
          {...(onStopMission ? { onStopMission } : {})}
          {...(onStopAgent ? { onStopAgent } : {})}
          {...(onSteerAgent ? { onSteerAgent } : {})}
        />
      ) : null}
    </div>
  );
}

// ── Turn tasks (R-SES4 content, copied minus the transcript-sized outer margin) ────────────────────

function TaskProgressList({ tasks }: { tasks: HubTaskItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tasks : tasks.slice(0, TASK_VISIBLE_CAP);
  const hiddenCount = tasks.length - visible.length;

  return (
    <Task defaultOpen className="min-w-0">
      <TaskTrigger title={`Tasks (${tasks.length})`} />
      <TaskContent>
        {visible.map((task) => (
          <TaskItem key={task.id} status={taskStatusToStatus(task.status)}>
            {task.title}
            {task.status === "blocked" ? " — blocked" : ""}
            {task.status === "cancelled" ? " — cancelled" : ""}
          </TaskItem>
        ))}
      </TaskContent>
      {hiddenCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more
        </Button>
      ) : null}
    </Task>
  );
}

// ── Mission summary (the rail's always-visible counterpart to the in-stream MissionBoard) ──────────

const TOPOLOGY_LABEL: Record<MissionBoardView["plan"]["topology"], string> = {
  parallel: "Parallel",
  pipeline: "Pipeline",
  debate: "Debate",
  best_of_n: "Best of N",
};

function fmtUsd(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `$${value.toFixed(2)}`;
}

function MissionSummary({
  board,
  roleLookup,
  budgets,
  busy,
  onStopMission,
  onStopAgent,
  onSteerAgent,
}: {
  board: MissionBoardView;
  roleLookup?: MissionRoleLookup;
  budgets?: HubMissionBudgets;
  busy?: boolean;
  onStopMission?: (missionId: string) => void;
  onStopAgent?: (missionId: string, agentSessionId: string) => void;
  onSteerAgent?: (missionId: string, agentSessionId: string, text: string) => void;
}) {
  const total = board.agents.length;
  const done = board.agents.filter((agent) => agent.reported).length;
  const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;
  const active = board.phase === "running" || board.phase === "synthesizing";
  const missionBudget = fmtUsd(budgets?.maxCostUsd ?? board.plan.budgets?.maxCostUsd);

  return (
    <Card className="flex min-w-0 flex-col gap-2 p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Text variant="meta" className="min-w-0 shrink-0 font-medium">
              Mission
            </Text>
            <Badge variant="outline" className="shrink-0">
              {TOPOLOGY_LABEL[board.plan.topology]}
            </Badge>
            {board.synthesis?.partial ? (
              <Badge variant="outline" className="shrink-0">
                partial
              </Badge>
            ) : null}
          </div>
          <Text variant="meta" tone="muted" className="min-w-0 truncate tabular-nums">
            {done} of {total} agents reported
            {missionBudget !== undefined ? ` · budget ${missionBudget}` : ""}
          </Text>
        </div>
        <StatusBadge status={missionStatusRaw(board)} className="shrink-0" />
      </div>

      {total > 0 ? <Progress value={progressPercent} aria-label="Agents reported" /> : null}

      {active && onStopMission ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          className="w-fit"
          onClick={() => onStopMission(board.missionId)}
        >
          <OctagonX aria-hidden className="size-3.5" />
          <span>Stop mission</span>
        </Button>
      ) : null}

      {total > 0 ? (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {board.agents.map((agent) => (
            <li key={agent.agentSessionId} className="min-w-0">
              <AgentRow
                agent={agent}
                icon={missionAgentIcon(board.plan, roleLookup, agent.key)}
                phase={board.phase}
                missionId={board.missionId}
                active={active}
                busy={busy}
                {...(onStopAgent ? { onStopAgent } : {})}
                {...(onSteerAgent ? { onSteerAgent } : {})}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function AgentRow({
  agent,
  icon,
  phase,
  missionId,
  active,
  busy,
  onStopAgent,
  onSteerAgent,
}: {
  agent: MissionBoardAgentView;
  icon?: string;
  phase: MissionBoardPhase;
  missionId: string;
  active: boolean;
  busy?: boolean;
  onStopAgent?: (missionId: string, agentSessionId: string) => void;
  onSteerAgent?: (missionId: string, agentSessionId: string, text: string) => void;
}) {
  const [steer, setSteer] = useState("");
  const canSteer = active && !agent.reported && !!onSteerAgent;
  const canStop = active && !agent.reported && !!onStopAgent;

  const submitSteer = () => {
    const text = steer.trim();
    if (!text || !onSteerAgent) return;
    onSteerAgent(missionId, agent.agentSessionId, text);
    setSteer("");
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md bg-background px-2 py-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <RoleAvatar
            id={agent.agentSessionId}
            icon={icon}
            model={agent.model}
            className="size-6 shrink-0 rounded-full"
          />
          <div className="flex min-w-0 flex-col">
            <Text className="min-w-0 truncate" title={agent.roleName}>
              {agent.roleName}
            </Text>
            <Badge variant="outline" className="w-fit shrink-0">
              {agent.model}
            </Badge>
          </div>
        </div>
        <StatusBadge status={missionAgentStatusRaw(agent, phase)} className="shrink-0" />
      </div>

      {canStop ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={busy}
          onClick={() => onStopAgent?.(missionId, agent.agentSessionId)}
        >
          Stop
        </Button>
      ) : null}

      {canSteer ? (
        <form
          className="flex min-w-0 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitSteer();
          }}
        >
          <Input
            value={steer}
            onChange={(event) => setSteer(event.target.value)}
            placeholder={`Steer ${agent.roleName}…`}
            aria-label={`Steer ${agent.roleName}`}
            spellCheck={false}
            autoComplete="off"
            className="h-8 min-w-0 flex-1 text-caption"
          />
          <IconButton
            type="submit"
            variant="outline"
            size="icon-sm"
            disabled={busy || steer.trim().length === 0}
            label="Send steering message"
          >
            <Send aria-hidden className="size-3.5" />
          </IconButton>
        </form>
      ) : null}
    </div>
  );
}
