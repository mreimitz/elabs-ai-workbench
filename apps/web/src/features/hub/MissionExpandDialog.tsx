// Assistant Hub · hub-fixes WP4.3 (RC6.2/RC6.4) — the mission graph's EXPAND MODAL. Owner ask
// verbatim: "i need an expand button in the right top corner which opens up the flow in a large
// modal, in there i want to be able to click on a agent node and in a right panel i want to see the
// live session running." Repo pattern: `features/testing/TraceLeafDetail.tsx` (Maximize2 →
// `DialogContent size="full"`, payload left / detail right).
//
// Left ~55% = the SELECTABLE topology (the same `TopologyGraph`, now with node selection turned on;
// the inline board graph stays read-only). Right = the selected node's panel:
//   • an agent node   → its live child-session transcript (`AgentTranscript`) + Report + Status,
//   • the terminal    → the synthesis step (state + what it draws on),
//   • the best_of_n judge → its step info (winner) — a step, not an agent, so no session.
//
// The modal reconstructs nothing itself — it renders the already-reconstructed `MissionBoardView`.
// Closing it (or leaving a node) unmounts `AgentTranscript`, which tears its SSE subscription down.

import { type ReactNode, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Heading,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@brand/ui";
import { Gavel, Maximize2, Sparkles, Users } from "lucide-react";
import { AgentTranscript } from "./AgentTranscript";
import { RoleAvatar } from "./agents/RoleAvatar";
import {
  missionAgentBrief,
  missionAgentIcon,
  type MissionRoleLookup,
} from "./lib/mission-agent-icon";
import {
  fmtUsd,
  MissionAgentReportTab,
  MissionAgentStatusTab,
  TOPOLOGY_LABEL,
  missionBoardToTopoInput,
  type MissionBoardAgentView,
  type MissionBoardView,
} from "./MissionBoard";
import { TopologyGraph } from "./TopologyGraph";

// The synthetic terminal/judge node ids `deriveTopologyGraph` (topology-graph.ts) hardcodes. Kept in
// sync by test — a selection carrying one of these is a non-agent node, not a child session.
const TERMINAL_NODE_ID = "__terminal__";
const JUDGE_NODE_ID = "__judge__";

export type MissionExpandDialogProps = {
  board: MissionBoardView;
  /** The role library (by id + name), for resolving each agent's avatar icon. Absent ⇒ model-logo/glyph. */
  roleLookup?: MissionRoleLookup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** A short phase label for the modal header (the board owns the rich phase vocabulary). */
function phaseLabel(board: MissionBoardView): string {
  if (board.phase === "done") return "Complete";
  if (board.phase === "running" || board.phase === "synthesizing") return "Running";
  if (board.phase === "approved") return "Approved";
  return "Proposed";
}

export function MissionExpandDialog({
  board,
  roleLookup,
  open,
  onOpenChange,
}: MissionExpandDialogProps) {
  // The default selection is the FIRST agent (owner intent: land on a running session), falling back
  // to the terminal for an agentless plan. `selectedNodeId` only overrides once the operator clicks/
  // keys a node; if that id later vanishes from the board it falls back to the default.
  const defaultNodeId = board.agents[0]?.agentSessionId ?? TERMINAL_NODE_ID;
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  // ui-wave U1 (owner feedback) — the agent panel's tab, once EXPLICITLY chosen, persists across node
  // switches (undefined until then ⇒ each node opens on its smart default: running → Live,
  // finished → Report).
  const [agentTab, setAgentTab] = useState<AgentPanelTab | undefined>(undefined);
  const nodeIds = new Set<string>([
    ...board.agents.map((a) => a.agentSessionId),
    TERMINAL_NODE_ID,
    JUDGE_NODE_ID,
  ]);
  const selected =
    selectedNodeId && nodeIds.has(selectedNodeId) ? selectedNodeId : defaultNodeId;

  const topoInput = missionBoardToTopoInput(board);
  const graphIconById = useMemo(() => {
    const map = new Map<string, ReactNode>();
    for (const agent of board.agents) {
      map.set(
        agent.agentSessionId,
        <RoleAvatar
          id={agent.agentSessionId}
          icon={missionAgentIcon(board.plan, roleLookup, agent.key)}
          model={agent.model}
          className="size-9 shrink-0 ring-2 ring-card"
        />,
      );
    }
    return map;
  }, [board.agents, board.plan, roleLookup]);
  const graphBriefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of board.agents) {
      const brief = missionAgentBrief(board.plan, agent.key, agent.brief);
      if (brief) map.set(agent.agentSessionId, brief);
    }
    return map;
  }, [board.agents, board.plan]);
  const reported = board.agents.filter((a) => a.reported).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="flex min-h-0 flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 text-left">
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-primary" />
            <span className="min-w-0 truncate">Mission</span>
            <Badge variant="outline">{TOPOLOGY_LABEL[board.plan.topology]}</Badge>
            <Badge variant={board.phase === "done" ? "default" : "secondary"}>
              {phaseLabel(board)}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Select a node to inspect its live session, report, or step — {reported} of{" "}
            {board.agents.length} agents reported.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left ~55% — the interactive topology. A definite (viewport-relative) height avoids the
              flex-height chain and fills the modal at both 1280×800 and 1920×1080. */}
          <div className="flex min-w-0 shrink-0 flex-col border-b border-border p-4 lg:w-[55%] lg:border-b-0 lg:border-r">
            <TopologyGraph
              input={topoInput}
              variant="mission"
              iconById={graphIconById}
              briefById={graphBriefById}
              ariaLabel={`${TOPOLOGY_LABEL[board.plan.topology]} topology — select a node`}
              className="h-[42vh] min-h-64 lg:h-[calc(100vh-13rem)]"
              selectable
              selectedNodeId={selected}
              onSelectNode={setSelectedNodeId}
            />
          </div>

          {/* Right — the selected node's panel (a labelled region landmark for SR). */}
          <section
            className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4"
            aria-label="Selected node detail"
            data-testid="mission-expand-panel"
          >
            <NodePanel
              board={board}
              nodeId={selected}
              {...(roleLookup ? { roleLookup } : {})}
              {...(agentTab ? { agentTab } : {})}
              onAgentTabChange={setAgentTab}
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Route the selected node id to the right panel: agent session, synthesis step, or judge step. */
function NodePanel({
  board,
  nodeId,
  roleLookup,
  agentTab,
  onAgentTabChange,
}: {
  board: MissionBoardView;
  nodeId: string;
  roleLookup?: MissionRoleLookup;
  /** ui-wave U1 — the EXPLICITLY chosen agent tab (undefined until the operator picks one); once
   *  chosen it persists across node switches. */
  agentTab?: AgentPanelTab;
  onAgentTabChange: (tab: AgentPanelTab) => void;
}) {
  const agent = board.agents.find((a) => a.agentSessionId === nodeId);
  // crew-nesting WP4.3 (D-CN2/D-CN5/D-CN8) — a RESOLVED sub-crew slot renders its own sub-mission
  // summary + drill-in instead of the leaf agent panel (a still-unresolved crew slot — the reducer's
  // defensive guard stopped short, or the child hasn't appeared in the log yet — falls through to the
  // ordinary agent panel, which is still correct: it has its own session/report like any agent).
  if (agent?.childBoard) {
    return <SubCrewNodePanel childBoard={agent.childBoard} {...(roleLookup ? { roleLookup } : {})} />;
  }
  if (agent) {
    return (
      <AgentNodePanel
        agent={agent}
        icon={missionAgentIcon(board.plan, roleLookup, agent.key)}
        tab={agentTab ?? (agent.reported ? "report" : "live")}
        onTabChange={onAgentTabChange}
      />
    );
  }
  if (nodeId === JUDGE_NODE_ID) return <JudgeNodePanel board={board} />;
  if (nodeId === TERMINAL_NODE_ID) return <SynthesisNodePanel board={board} />;
  return (
    <Text tone="muted" className="text-caption">
      Select a node to inspect it.
    </Text>
  );
}

export type AgentPanelTab = "live" | "report" | "status";

/**
 * An agent node → its live child session. Until the operator picks a tab, each node opens on its
 * smart default (running → Live, finished → Report). ui-wave U1 (owner feedback): once a tab IS
 * explicitly chosen it persists across node switches — controlled from the dialog, no more `key`
 * remount resetting the strip on every selection change.
 */
function AgentNodePanel({
  agent,
  icon,
  tab,
  onTabChange,
}: {
  agent: MissionBoardAgentView;
  icon?: string;
  tab: AgentPanelTab;
  onTabChange: (tab: AgentPanelTab) => void;
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as AgentPanelTab)}
      className="flex min-h-0 flex-col gap-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <RoleAvatar
            id={agent.agentSessionId}
            icon={icon}
            model={agent.model}
            className="size-7 shrink-0 rounded-full"
          />
          <Heading level={4} size="subtitle" className="min-w-0 truncate">
            {agent.roleName}
          </Heading>
        </div>
        <TabsList>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="live" className="min-w-0">
        <AgentTranscript
          sessionId={agent.agentSessionId}
          ariaLabel={`Live session — ${agent.roleName}`}
        />
      </TabsContent>
      <TabsContent value="report" className="min-w-0">
        <MissionAgentReportTab report={agent.report} />
      </TabsContent>
      <TabsContent value="status" className="min-w-0">
        <MissionAgentStatusTab agent={agent} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * crew-nesting WP4.3 (D-CN2/D-CN5/D-CN8) — a RESOLVED sub-crew slot's panel: a summary (topology,
 * "N of M agents reported", the cascading budget line) and a labeled "Open sub-crew board" control that
 * drills into the sub-mission's OWN `MissionExpandDialog` — the component renders itself, so a
 * grandchild sub-crew (depth 3+) recurses again for free, bounded by however deep the tree actually ran
 * (the server's `HUB_MISSION_MAX_DEPTH` already caps it — this WP adds no separate client depth cap
 * beyond the reducer's own defensive cycle guard). This is the app's first `Dialog`-in-`Dialog` nesting
 * (D-CN8) — flagged for a manual both-theme focus-trap/ESC check (owner-acceptance).
 */
function SubCrewNodePanel({
  childBoard,
  roleLookup,
}: {
  childBoard: MissionBoardView;
  roleLookup?: MissionRoleLookup;
}) {
  const [nestedOpen, setNestedOpen] = useState(false);
  const reported = childBoard.agents.filter((a) => a.reported).length;
  const maxCostUsd = childBoard.plan.budgets?.maxCostUsd;
  const spentUsd = childBoard.rollup?.costUsd;
  const spentKnown = childBoard.rollup?.costKnown === true;
  const budgetProgress =
    maxCostUsd !== undefined && maxCostUsd > 0
      ? Math.min(100, Math.round(((spentUsd ?? 0) / maxCostUsd) * 100))
      : 0;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="mission-expand-subcrew">
      <div className="flex items-center gap-2">
        <Users aria-hidden className="size-4 text-primary" />
        <Heading level={4} size="subtitle">
          Sub-crew
        </Heading>
        <Badge variant="outline">{TOPOLOGY_LABEL[childBoard.plan.topology]}</Badge>
      </div>
      <Text tone="muted" className="text-caption tabular-nums">
        {reported} of {childBoard.agents.length} agents reported
      </Text>
      {maxCostUsd !== undefined ? (
        <div className="flex flex-col gap-1">
          <Progress
            value={budgetProgress}
            aria-label="Sub-crew budget spent"
            aria-valuetext={`${spentKnown ? fmtUsd(spentUsd) : "unknown"} of ${fmtUsd(maxCostUsd)} spent`}
          />
          <Text tone="muted" className="text-caption tabular-nums">
            {spentKnown ? fmtUsd(spentUsd) : "—"} / {fmtUsd(maxCostUsd)}
          </Text>
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setNestedOpen(true)}
      >
        <Maximize2 aria-hidden className="size-4" />
        Open sub-crew board
      </Button>
      <MissionExpandDialog
        board={childBoard}
        {...(roleLookup ? { roleLookup } : {})}
        open={nestedOpen}
        onOpenChange={setNestedOpen}
      />
    </div>
  );
}

/** The terminal synthesis node — the step that writes the final answer from the agent reports. */
function SynthesisNodePanel({ board }: { board: MissionBoardView }) {
  const synthesis = board.synthesis;
  const refNames = (synthesis?.agentReportRefs ?? []).map(
    (id) => board.agents.find((a) => a.agentSessionId === id)?.roleName ?? id,
  );
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="mission-expand-synthesis">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="size-4 text-primary" />
        <Heading level={4} size="subtitle">
          Synthesis
        </Heading>
        {synthesis?.partial ? <Badge variant="outline">partial</Badge> : null}
      </div>
      <Text tone="muted" className="text-caption">
        {board.plan.topology === "debate"
          ? "The resolver reads every debater's report and writes the final answer."
          : "The synthesis step combines the agent reports into the final answer."}
      </Text>
      <Text className="min-w-0 break-words text-caption">
        {synthesis
          ? synthesis.partial
            ? "Partial synthesis — some agents did not complete; the answer draws only on those that reported."
            : "Synthesis complete — the final answer renders in the main conversation, citing each agent's findings."
          : "Synthesis pending — waiting for the agents to report."}
      </Text>
      {refNames.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <Text tone="muted" className="text-caption font-medium">
            Draws on
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {refNames.map((name, i) => (
              <Badge key={i} variant="secondary">
                {name}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The best_of_n judge node — a STEP (no session): it picks the strongest attempt for synthesis. */
function JudgeNodePanel({ board }: { board: MissionBoardView }) {
  const winnerId = board.synthesis?.agentReportRefs?.[0];
  const winner = winnerId ? board.agents.find((a) => a.agentSessionId === winnerId) : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="mission-expand-judge">
      <div className="flex items-center gap-2">
        <Gavel aria-hidden className="size-4 text-primary" />
        <Heading level={4} size="subtitle">
          Blind judge
        </Heading>
      </div>
      <Text tone="muted" className="min-w-0 break-words text-caption">
        A blind judge compares the attempts and picks the strongest; the winner feeds synthesis. The
        judge is a step, not an agent — it has no child session of its own.
      </Text>
      {winner ? (
        <Text className="text-caption">
          Winner: <span className="font-medium text-foreground">{winner.roleName}</span>
        </Text>
      ) : (
        <Text tone="muted" className="text-caption">
          No winner selected yet.
        </Text>
      )}
    </div>
  );
}
