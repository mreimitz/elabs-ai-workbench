// Assistant Hub (roadmap/assistant-hub/, WP1.7 · D-AH8/D-AH9 · R-UX4/R-UX9) — the live MISSION BOARD,
// rendered IN-BAND in the transcript once a mission is approved/running/done. It reconstructs its whole
// state from the parent session's event log ALONE (R-SES1) — the same invariant the API's
// `hub/missions/board.ts` reducer holds; `reconstructMissionBoard` here is the web mirror.
//
// Per R-UX4: an overall status + a budget/progress meter + the waiting count + a stop-all control;
// one card per agent (role · model chip · status · confidence · findings · per-agent stop); a `Queue`
// of the agents still waiting for a slot. Per R-UX9: each agent's confidence + open questions render,
// and a budget-tripped / stopped mission's synthesis is marked PARTIAL. brand-ui only, both themes.
//
// hub-fixes WP4.2 (RC6.3): reported agents render as a responsive 2-up grid instead of a vertical
// stack, and are individually SELECTABLE — selecting a card opens a detail box below with Status
// (state/model/confidence/timestamps) and Report (the full findings/open-questions render, moved off
// the now-compact grid cards) tabs. A Live tab (streaming the agent's own child session) is WP4.3 —
// the tab strip leaves room for it but it isn't built here.
//
// hub-fixes WP2.4 (mission cost/budget integrity): the budget meter + the header's "spent" figure and
// each agent's cost badge/Status-tab row are now REAL numbers — `costUsd`/`tokensIn`/`tokensOut` ride
// the `agent_report` event itself (`orchestrator.ts` mirrors the runner's real total there), so the
// board still reconstructs purely from the event log (R-SES1). Before this WP the runner hardcoded
// `costUsd: 0`, so any spend display here would have been fiction — see `analysis.md` RC2.
//
// crew-nesting WP4.3 (D-CN7/D-CN2/D-CN5) — `reconstructMissionBoard` is now a TREE reducer: one session's
// event log can carry MULTIPLE missions (the root's own events plus every descendant sub-mission's own
// `plan_proposed`/`agent_spawned`/`agent_report`/`mission_synthesis` stream, D-CN6 — every mission in a
// tree keeps `session_id` = the root chat session). Events are partitioned by `missionId` in one pass;
// the root is still "the last `plan_proposed`" but now ROOT-SCOPED (its WP3.1 `parentMissionId` is
// absent) — a no-op on every existing flat fixture. A sub-crew slot's own sub-mission is recursively
// attached as `MissionBoardAgentView.childBoard`, resolved primarily via the live parent-linkage
// back-reference (so a still-RUNNING sub-crew shows up before it reports) with a settled
// `agent.report?.subMissionId` fallback. A `visited`-path cycle/depth guard is a DEFENSIVE, web-side-only
// backstop (D-CN4 — the server is authoritative); it never re-implements the real depth cap. The API's
// OWN independent reducer is `apps/api/src/hub/missions/board.ts` — the two are NOT the wire.

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Agent,
  AgentContent,
  ApprovalCard,
  ApprovalCardAccepted,
  ApprovalCardActions,
  ApprovalCardApprove,
  ApprovalCardDeny,
  ApprovalCardDescription,
  ApprovalCardRejected,
  ApprovalCardRequest,
  ApprovalCardTitle,
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
} from "@brand/ai";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Descriptions,
  DescriptionsItem,
  Heading,
  Input,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  cn,
} from "@brand/ui";
import type {
  HubAgentReport,
  HubApprovalOptionKind,
  HubApprovalResolution,
  HubConfidence,
  HubEvent,
  HubMissionBudgets,
  HubMissionPlan,
  HubToolAnnotations,
  HubToolSource,
  HubTopology,
} from "@mcp-token-footprint/shared";
import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Loader2,
  Maximize2,
  OctagonX,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { decideHubApproval } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { IconButton } from "../../components/IconButton";
import { AgentBriefPreview } from "./agents/AgentBriefPreview";
import { RoleAvatar } from "./agents/RoleAvatar";
import { prettyToolName } from "./hub-tool-parts";
import { missionAgentBrief, missionAgentIcon, type MissionRoleLookup } from "./lib/mission-agent-icon";
import { TopologyGraph } from "./TopologyGraph";
import type { TopoGraphInput, TopoNodeState } from "./topology-graph";
import { AgentTranscript } from "./AgentTranscript";
import { MissionExpandDialog } from "./MissionExpandDialog";
import { notifyError } from "../../lib/notify";

// ── Reconstruction from the event log (web mirror of hub/missions/board.ts — R-SES1) ────────────────

export type MissionBoardPhase = "proposed" | "approved" | "running" | "synthesizing" | "done";

export type MissionBoardAgentView = {
  agentSessionId: string;
  key: string;
  roleName: string;
  model: string;
  brief?: string;
  index: number;
  report?: HubAgentReport;
  reported: boolean;
  /** hub-fixes WP4.2 — the `agent_spawned`/`agent_report` events' own envelope timestamps (`at`),
   *  surfaced in the detail box's Status tab. Real events always carry `at` (`repository.ts`
   *  `appendEvent` stamps it); undefined only in synthetic/test logs that omit it. */
  spawnedAt?: string;
  reportedAt?: string;
  /** hub-fixes WP2.4 — the agent's REAL accumulated cost/tokens, carried on the `agent_report` event
   *  itself (`orchestrator.ts` mirrors the runner's total here, R-SES1 — no separate session fetch).
   *  Absent on a pre-fix log or a not-yet-reported agent; the UI shows no cost rather than a fabricated
   *  one (see `MissionAgentStatusTab`/`MissionAgentCard`). */
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  /** crew-nesting WP4.3 (D-CN2/D-CN5/D-CN7) — when this slot is a sub-crew (a `crewId` planned agent
   *  that expanded into its own sub-mission), its own recursively-reconstructed sub-mission board.
   *  `undefined` for an ordinary leaf agent, OR when the reducer's defensive cycle/depth guard stopped
   *  the recursion (D-CN4 web mirror) — never fabricated, never a fatal error. */
  childBoard?: MissionBoardView;
};

/** hub-fixes WP2.5 (D-HF6) — one pending mission-agent approval, reconstructed from the parent log's
 *  `agent_approval_requested`/`agent_approval_responded` board-mirror events (R-SES1). Only ever present
 *  for an `always_ask` mission; the decision routes to the CHILD session's own `/approvals` endpoint. */
export type MissionBoardPendingApproval = {
  agentSessionId: string;
  roleName?: string;
  toolCallId: string;
  toolName: string;
  source: HubToolSource;
  serverId?: string;
  annotations?: HubToolAnnotations;
  options: HubApprovalOptionKind[];
};

export type MissionBoardView = {
  missionId: string;
  plan: HubMissionPlan;
  phase: MissionBoardPhase;
  approved: boolean;
  autoApproved: boolean;
  agents: MissionBoardAgentView[];
  /** hub-fixes WP2.5 (D-HF6) — the live approval queue for an `always_ask` mission: gated child tool
   *  calls awaiting a board decision (a `requested` with no matching `responded` yet). `reconstructMissionBoard`
   *  always sets it (possibly empty); optional so a pre-WP2.5 inline board fixture stays valid. */
  pendingApprovals?: MissionBoardPendingApproval[];
  synthesis?: { messageId?: string; partial: boolean; agentReportRefs: string[] };
  /** assistant-hub v1-fixes (F7) — the mission's deduped open questions (`mission_followups` event),
   *  agent-attributed: the one-click "investigate as a follow-up mission" seed. */
  followups?: Array<{ question: string; agentSessionId?: string; roleName?: string }>;
  /** crew-nesting WP4.3 (D-CN2/D-CN5) — this LEVEL's rolled-up cost/timing, computed after every
   *  sub-crew slot's `childBoard` is attached: `costUsd`/`costKnown` mirror the header's existing real-
   *  spend derivation (sum of reported agents' cost), falling back to a sub-crew's own
   *  `childBoard.rollup.costUsd` while its parent-level report hasn't landed yet (so a live sub-crew's
   *  running spend shows before it settles); `startedAt`/`endedAt` are the earliest spawn / latest
   *  report across this level + resolved children. `reconstructMissionBoard` always sets it; optional
   *  so a hand-built pre-WP4.3 board fixture elsewhere (e.g. `meta-rail/ProgressSection.test.tsx`) stays
   *  valid without updating. */
  rollup?: { costUsd: number; costKnown: boolean; startedAt?: string; endedAt?: string };
};

// ── Tree partition + parent-linkage lookup (crew-nesting WP4.3 / D-CN7) ──────────────────────────────

/** crew-nesting WP4.3 (D-CN4 web mirror) — the reducer's OWN defensive depth cap for the sub-mission
 *  recursion, well above `HUB_MISSION_MAX_DEPTH`'s realistic values. The run-time engine's depth guard is
 *  authoritative (D-CN4); this only stops a corrupt/cyclic replay log from hanging the tab. */
const MISSION_TREE_MAX_DEPTH = 8;

/** The mission-scoped event types this reducer's single-mission body reads — every `HubEvent` shape that
 *  carries a `missionId`. Kept in sync manually (mirrors the `switch` in {@link buildMissionNode}). */
function partitionEventsByMission(events: readonly HubEvent[]): Map<string, HubEvent[]> {
  const byMission = new Map<string, HubEvent[]>();
  const push = (missionId: string, event: HubEvent): void => {
    const bucket = byMission.get(missionId);
    if (bucket) bucket.push(event);
    else byMission.set(missionId, [event]);
  };
  for (const event of events) {
    switch (event.type) {
      case "plan_proposed":
      case "plan_updated":
      case "plan_approved":
      case "mission_started":
      case "agent_spawned":
      case "agent_report":
      case "agent_approval_requested":
      case "agent_approval_responded":
      case "mission_synthesis":
      case "mission_followups":
        push(event.missionId, event);
        break;
      default:
        break;
    }
  }
  return byMission;
}

/** crew-nesting WP4.3 (D-CN7) — build the `${parentMissionId}::${parentAgentKey} -> childMissionId`
 *  lookup ONCE (not re-scanned per agent). Primary source is `plan_proposed` (load-bearing); an
 *  `agent_spawned` mirror is used ONLY as a fallback for a mission `plan_proposed` hasn't (yet) linked —
 *  the same event-ordering robustness the API's `board.ts` reducer relies on — so a still-RUNNING
 *  sub-crew resolves before it reports even if its spawn events arrive first. */
function buildChildMissionLookup(events: readonly HubEvent[]): Map<string, string> {
  const bySlot = new Map<string, string>();
  const linkedFromPlan = new Set<string>();
  for (const event of events) {
    if (
      event.type === "plan_proposed" &&
      event.parentMissionId !== undefined &&
      event.parentAgentKey !== undefined
    ) {
      bySlot.set(`${event.parentMissionId}::${event.parentAgentKey}`, event.missionId);
      linkedFromPlan.add(event.missionId);
    }
  }
  for (const event of events) {
    if (
      event.type === "agent_spawned" &&
      event.parentMissionId !== undefined &&
      event.parentAgentKey !== undefined &&
      !linkedFromPlan.has(event.missionId)
    ) {
      bySlot.set(`${event.parentMissionId}::${event.parentAgentKey}`, event.missionId);
    }
  }
  return bySlot;
}

/**
 * Build ONE mission node's board — the exact pre-WP4.3 single-mission reduction, reading only this
 * node's own partitioned events — then recursively attach every sub-crew slot's own sub-mission as
 * `childBoard` (D-CN2/D-CN5/D-CN7) and compute this level's rolled cost/timing (`rollup`). `visited` is
 * the set of mission ids already on the CURRENT recursion path — a defensive cycle/depth guard (D-CN4
 * web mirror; the server is the authoritative guard, this only stops a malformed/adversarial log from
 * hanging the tab): a `childMissionId` already on the path, or a path deeper than
 * {@link MISSION_TREE_MAX_DEPTH}, leaves `childBoard` undefined rather than recursing.
 */
function buildMissionNode(
  missionId: string,
  eventsByMission: Map<string, HubEvent[]>,
  childMissionLookup: Map<string, string>,
  visited: ReadonlySet<string>,
): MissionBoardView | undefined {
  const events = eventsByMission.get(missionId) ?? [];

  let plan: HubMissionPlan | undefined;
  let phase: MissionBoardPhase = "proposed";
  let approved = false;
  let autoApproved = false;
  const agents = new Map<string, MissionBoardAgentView>();
  // hub-fixes WP2.5 (D-HF6) — keyed by `${agentSessionId}::${toolCallId}`; a `requested` adds, a
  // `responded` (operator decision OR timeout) removes, so the queue reflects only OPEN approvals.
  const pendingApprovals = new Map<string, MissionBoardPendingApproval>();
  let synthesis: MissionBoardView["synthesis"];
  let followups: MissionBoardView["followups"];

  for (const event of events) {
    if (event.type === "plan_proposed") {
      plan = event.plan;
      phase = "proposed";
    } else if (event.type === "plan_updated") {
      plan = event.plan;
    } else if (event.type === "plan_approved") {
      approved = true;
      autoApproved = event.auto === true;
      if (phase === "proposed") phase = "approved";
    } else if (event.type === "mission_started") {
      phase = "running";
    } else if (event.type === "agent_spawned") {
      agents.set(event.agentSessionId, {
        agentSessionId: event.agentSessionId,
        key: event.key,
        roleName: event.roleName,
        model: event.model,
        ...(event.brief ? { brief: event.brief } : {}),
        index: event.index ?? agents.size,
        reported: false,
        ...(event.at ? { spawnedAt: event.at } : {}),
      });
    } else if (event.type === "agent_report") {
      const agent = agents.get(event.agentSessionId);
      if (agent) {
        agent.report = event.report;
        agent.reported = true;
        if (event.at) agent.reportedAt = event.at;
        // hub-fixes WP2.4 — real per-agent spend, carried on the event itself.
        if (event.costUsd !== undefined) agent.costUsd = event.costUsd;
        if (event.tokensIn !== undefined) agent.tokensIn = event.tokensIn;
        if (event.tokensOut !== undefined) agent.tokensOut = event.tokensOut;
      }
    } else if (event.type === "agent_approval_requested") {
      pendingApprovals.set(`${event.agentSessionId}::${event.toolCallId}`, {
        agentSessionId: event.agentSessionId,
        ...(event.roleName ? { roleName: event.roleName } : {}),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        source: event.source,
        ...(event.serverId ? { serverId: event.serverId } : {}),
        ...(event.annotations ? { annotations: event.annotations } : {}),
        options: event.options,
      });
    } else if (event.type === "agent_approval_responded") {
      pendingApprovals.delete(`${event.agentSessionId}::${event.toolCallId}`);
    } else if (event.type === "mission_synthesis") {
      phase = "done";
      synthesis = {
        ...(event.messageId ? { messageId: event.messageId } : {}),
        partial: event.partial === true,
        agentReportRefs: event.agentReportRefs ?? [],
      };
    } else if (event.type === "mission_followups") {
      // v1-fixes (F7) — the reports' deduped open questions (latest event wins; replay-stable).
      followups = event.followups;
    }
  }

  if (!plan) return undefined;
  const orderedAgents = [...agents.values()].sort((a, b) => a.index - b.index);

  // crew-nesting WP4.3 (D-CN2/D-CN5/D-CN7) — attach each sub-crew slot's own sub-mission, recursively.
  // Resolved PRIMARILY via the live parent-linkage back-reference (so a still-RUNNING sub-crew shows up
  // before it reports), falling back to the settled `agent.report?.subMissionId`. `pathWithSelf` is this
  // node's own recursion path (including itself) — a cycle guard AND the depth cap below.
  const pathWithSelf = new Set(visited);
  pathWithSelf.add(missionId);
  if (pathWithSelf.size <= MISSION_TREE_MAX_DEPTH) {
    for (const agentView of orderedAgents) {
      const childMissionId =
        childMissionLookup.get(`${missionId}::${agentView.key}`) ?? agentView.report?.subMissionId;
      if (!childMissionId || pathWithSelf.has(childMissionId)) continue;
      const childBoard = buildMissionNode(childMissionId, eventsByMission, childMissionLookup, pathWithSelf);
      if (childBoard) agentView.childBoard = childBoard;
    }
  }

  // Per-level cost/timing roll-up (D-CN2/D-CN5), computed AFTER child recursion so a sub-crew's own
  // rolled figures are available. A settled slot's real cost (mirrored onto its `agent_report`, WP2.4)
  // wins once available; a still-running sub-crew's LIVE rolled spend shows before it settles.
  let rollupCostUsd = 0;
  let rollupCostKnown = false;
  let rollupStartedAt: string | undefined;
  let rollupEndedAt: string | undefined;
  for (const agentView of orderedAgents) {
    const childRollup = agentView.childBoard?.rollup;
    if (agentView.costUsd !== undefined) {
      rollupCostUsd += agentView.costUsd;
      rollupCostKnown = true;
    } else if (childRollup) {
      rollupCostUsd += childRollup.costUsd;
      if (childRollup.costKnown) rollupCostKnown = true;
    }
    for (const start of [agentView.spawnedAt, childRollup?.startedAt]) {
      if (start !== undefined && (rollupStartedAt === undefined || start < rollupStartedAt)) {
        rollupStartedAt = start;
      }
    }
    for (const end of [agentView.reportedAt, childRollup?.endedAt]) {
      if (end !== undefined && (rollupEndedAt === undefined || end > rollupEndedAt)) {
        rollupEndedAt = end;
      }
    }
  }

  return {
    missionId,
    plan,
    phase,
    approved,
    autoApproved,
    agents: orderedAgents,
    pendingApprovals: [...pendingApprovals.values()],
    synthesis,
    ...(followups && followups.length > 0 ? { followups } : {}),
    rollup: {
      costUsd: rollupCostUsd,
      costKnown: rollupCostKnown,
      ...(rollupStartedAt !== undefined ? { startedAt: rollupStartedAt } : {}),
      ...(rollupEndedAt !== undefined ? { endedAt: rollupEndedAt } : {}),
    },
  };
}

/** Rebuild the latest mission TREE from a session's event log alone (deterministic, side-effect-free —
 *  R-SES1); returns the ROOT board, every sub-crew slot's own sub-mission recursively attached as
 *  `childBoard` (crew-nesting WP4.3). The root is still "the last `plan_proposed`", now ROOT-SCOPED (its
 *  WP3.1 `parentMissionId` is absent) — a no-op on every existing flat fixture (no field ⇒ every
 *  `plan_proposed` already qualifies), so a non-nested mission reconstructs byte-for-byte as before.
 *  Mirrors the API's OWN independent `reconstructMission` (`hub/missions/board.ts`) — the two reducers
 *  are kept separate per the layer boundary, not the wire (D-CN7). */
export function reconstructMissionBoard(events: readonly HubEvent[]): MissionBoardView | undefined {
  let rootMissionId: string | undefined;
  for (const event of events) {
    if (event.type === "plan_proposed" && event.parentMissionId === undefined) rootMissionId = event.missionId;
  }
  if (!rootMissionId) return undefined;

  const eventsByMission = partitionEventsByMission(events);
  const childMissionLookup = buildChildMissionLookup(events);
  return buildMissionNode(rootMissionId, eventsByMission, childMissionLookup, new Set());
}

// ── Presentation helpers ──────────────────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<MissionBoardPhase, string> = {
  proposed: "Proposed",
  approved: "Approved",
  running: "Running…",
  synthesizing: "Synthesizing…",
  done: "Complete",
};

const CONFIDENCE_VARIANT: Record<HubConfidence, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

export const TOPOLOGY_LABEL: Record<HubTopology, string> = {
  parallel: "Parallel",
  pipeline: "Pipeline",
  debate: "Debate",
  best_of_n: "Best of N",
};

// Exported (crew-nesting WP4.3) — `MissionExpandDialog.tsx`'s `SubCrewNodePanel` reuses this SAME
// formatter for the cascading budget line, matching the top-level meter's own money formatting exactly.
export function fmtUsd(value: number | undefined): string {
  if (value === undefined) return "—";
  return `$${value.toFixed(2)}`;
}

/** crew-nesting WP4.3 (D-CN2/D-CN5) — a compact "N of M agents reported [· spent / budget]" line for a
 *  sub-crew slot's own sub-mission, shown on the still-waiting QUEUE row and the Status tab. */
function subCrewSummaryLine(childBoard: MissionBoardView): string {
  const reported = childBoard.agents.filter((a) => a.reported).length;
  const maxCostUsd = childBoard.plan.budgets?.maxCostUsd;
  const budgetBit =
    maxCostUsd !== undefined
      ? ` · ${childBoard.rollup?.costKnown ? fmtUsd(childBoard.rollup.costUsd) : "—"} / ${fmtUsd(maxCostUsd)}`
      : "";
  return `${reported} of ${childBoard.agents.length} agents reported${budgetBit}`;
}

// ── Live topology-graph input (R-UX4 — real agent state on the nodes) ────────────────────────────────

/** Map one board agent to its live graph state. The best_of_n WINNER = the agent the synthesis drew on
 *  (its id is the sole `agentReportRefs` entry the orchestrator records for a best_of_n mission). */
function agentGraphState(
  agent: MissionBoardAgentView,
  phase: MissionBoardPhase,
  isWinner: boolean,
): TopoNodeState {
  if (agent.reported) return isWinner ? "winner" : "reported";
  if (phase === "running" || phase === "synthesizing") return "active";
  if (phase === "done") return "missing"; // the mission ended but this agent never reported
  return "waiting";
}

/** The terminal (synthesis / resolver / judge-fed) node's live state. */
function terminalGraphState(phase: MissionBoardPhase): TopoNodeState {
  if (phase === "done") return "reported";
  if (phase === "synthesizing") return "active";
  if (phase === "proposed") return "idle";
  return "waiting";
}

/** Build the live topology-graph input from the reconstructed board (R-SES1 — derived, not stored). */
export function missionBoardToTopoInput(board: MissionBoardView): TopoGraphInput {
  const topology = board.plan.topology;
  const winners = new Set(topology === "best_of_n" ? (board.synthesis?.agentReportRefs ?? []) : []);
  return {
    topology,
    agents: board.agents.map((agent) => {
      // crew-nesting WP4.3 (D-CN2/D-CN5) — a sub-crew slot: a RESOLVED `childBoard` (live, before the
      // slot's own settled report lands) OR a settled `report.subMissionId` (once reported, even if the
      // reducer's defensive guard stopped short of resolving `childBoard`).
      const isCrew = agent.childBoard !== undefined || agent.report?.subMissionId !== undefined;
      return {
        id: agent.agentSessionId,
        title: agent.roleName,
        subtitle: agent.model,
        state: agentGraphState(agent, board.phase, winners.has(agent.agentSessionId)),
        ...(isCrew ? { isCrew: true as const } : {}),
        ...(agent.childBoard ? { memberCount: agent.childBoard.agents.length } : {}),
      };
    }),
    // hub-fixes WP4.4 — thread the plan's debate round count so the LIVE board/expand graph renders the
    // actual number of rounds (openings + rebuttals), not just the default 2. Absent ⇒ the graph's default.
    ...(board.plan.debateRounds !== undefined ? { debateRounds: board.plan.debateRounds } : {}),
    terminal: { state: terminalGraphState(board.phase) },
  };
}

// ── The board ─────────────────────────────────────────────────────────────────────────────────────

export type MissionBoardProps = {
  board: MissionBoardView;
  /** The role library (by id + name), for resolving each agent's avatar icon. Absent ⇒ model-logo/glyph. */
  roleLookup?: MissionRoleLookup;
  budgets?: HubMissionBudgets;
  onStopMission?: (missionId: string) => void;
  onStopAgent?: (missionId: string, agentSessionId: string) => void;
  /** WP2.3 (R-SES3/R-UX4) — steer a running agent: inject a durable message into its child session. */
  onSteerAgent?: (missionId: string, agentSessionId: string, text: string) => void;
  /** v1-fixes (F7) — propose a FOLLOW-UP mission seeded with one of the reports' open questions. */
  onProposeFollowup?: (question: string) => void;
  busy?: boolean;
};

export function MissionBoard({
  board,
  roleLookup,
  budgets,
  onStopMission,
  onStopAgent,
  onSteerAgent,
  onProposeFollowup,
  busy,
}: MissionBoardProps) {
  /** Each agent's avatar icon, joined `key → roleId → role.icon` (undefined ⇒ model-logo/Persona). */
  const iconFor = (key: string): string | undefined => missionAgentIcon(board.plan, roleLookup, key);
  /** The prompt (brief) an agent received — its board-view value, else the frozen plan's. */
  const briefFor = (agent: MissionBoardAgentView): string | undefined =>
    missionAgentBrief(board.plan, agent.key, agent.brief);
  // The graph node's overlapping avatar (node id → `RoleAvatar`); memoized so the canvas isn't
  // re-derived every render (a fresh `Map` would invalidate `TopologyGraph`'s own `toReactFlow` memo).
  // Sized `size-9` with a card-colored ring for the `mission` variant's overhanging avatar slot.
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
  // Each graph node's 2-line brief preview (node id → the prompt the agent received).
  const graphBriefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of board.agents) {
      const brief = missionAgentBrief(board.plan, agent.key, agent.brief);
      if (brief) map.set(agent.agentSessionId, brief);
    }
    return map;
  }, [board.agents, board.plan]);
  const reportedAgents = board.agents.filter((a) => a.reported);
  const waitingAgents = board.agents.filter((a) => !a.reported);
  const pendingApprovals = board.pendingApprovals ?? [];
  const total = board.agents.length;
  const done = reportedAgents.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const active = board.phase === "running" || board.phase === "synthesizing";
  const missionBudget = budgets?.maxCostUsd ?? board.plan.budgets?.maxCostUsd;
  // hub-fixes WP2.4 — real spend so far: the sum of every REPORTED agent's real cost (the same figure
  // the server's own hard-budget trip accumulates against, `orchestrator.ts` `runSlot`'s
  // `cumulativeCost`) — derived purely from the event log (R-SES1), never a separate fetch. A
  // not-yet-reported agent contributes nothing yet (its cost isn't known until it settles).
  const spentSoFar = reportedAgents.reduce((sum, a) => sum + (a.costUsd ?? 0), 0);
  const spentKnown = reportedAgents.some((a) => a.costUsd !== undefined);
  const budgetProgress =
    missionBudget !== undefined && missionBudget > 0
      ? Math.min(100, Math.round((spentSoFar / missionBudget) * 100))
      : 0;

  // hub-fixes WP4.2 (RC6.3), reworked by ui-wave U1 (owner feedback): selection lives on the TOPOLOGY
  // GRAPH itself — the old 2-up agent-card grid duplicated the graph nodes and is gone. Any SPAWNED
  // agent is selectable (a not-yet-reported one shows Status/Live); the zero-selection default is the
  // first reported agent, else the first spawned. Derived (not an effect): `selectedAgentId` only
  // overrides once the operator clicks a node, and falls back when unset or stale.
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const selectedAgent =
    board.agents.find((a) => a.agentSessionId === selectedAgentId) ??
    reportedAgents[0] ??
    board.agents[0];
  // ui-wave U1 (owner feedback): the detail tab PERSISTS across node switches — an explicit tab
  // choice is a viewing mode, not per-agent state. It only ever changes when the operator changes it.
  const [detailTab, setDetailTab] = useState<MissionAgentDetailTab>("status");

  // Collapsible (owner feedback): expanded while the mission runs, AUTO-collapsed the moment it
  // completes — the synthesized answer is in the transcript below, so the full board (topology graph +
  // every agent's findings) no longer needs to dominate the scroll. Manual toggle wins afterward: the
  // effect only fires on the running→done EDGE, so re-expanding a finished mission sticks.
  const [collapsed, setCollapsed] = useState(board.phase === "done");
  // hub-fixes WP4.3 (RC6.2/RC6.4) — the expand-to-full-modal state (topology left, live agent panel
  // right). Independent of the collapse toggle: the modal is reachable whether the inline board is
  // collapsed or not, as long as there is a graph to expand.
  const [expandOpen, setExpandOpen] = useState(false);
  const wasDoneRef = useRef(board.phase === "done");
  useEffect(() => {
    const isDone = board.phase === "done";
    if (isDone && !wasDoneRef.current) setCollapsed(true);
    wasDoneRef.current = isDone;
  }, [board.phase]);
  const contentId = `mission-board-content-${board.missionId}`;

  return (
    <Card data-testid="mission-board" className="border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-primary" />
            <Heading level={4} size="subtitle" className="min-w-0 truncate">
              Mission
            </Heading>
            <Badge variant={board.phase === "done" ? "default" : "secondary"}>
              {PHASE_LABEL[board.phase]}
            </Badge>
            <Badge variant="outline">{TOPOLOGY_LABEL[board.plan.topology]}</Badge>
            {board.autoApproved ? <Badge variant="outline">auto-approved</Badge> : null}
            {board.synthesis?.partial ? <Badge variant="outline">partial</Badge> : null}
          </div>
          <Text tone="muted" className="text-caption tabular-nums">
            {done} of {total} agents reported
            {waitingAgents.length > 0 ? ` · ${waitingAgents.length} waiting` : ""}
            {missionBudget !== undefined
              ? ` · spent ${spentKnown ? fmtUsd(spentSoFar) : "—"} / ${fmtUsd(missionBudget)}`
              : ""}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {active && onStopMission ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onStopMission(board.missionId)}
            >
              <OctagonX aria-hidden className="size-4" />
              Stop mission
            </Button>
          ) : null}
          {/* hub-fixes WP4.3 — open the flow in a full-size modal (topology + per-agent live panel).
              Shown whenever there's a graph to expand, regardless of the collapse state. */}
          {board.agents.length > 0 ? (
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Expand mission graph"
              onClick={() => setExpandOpen(true)}
            >
              <Maximize2 aria-hidden className="size-4" />
            </IconButton>
          ) : null}
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            label={collapsed ? "Expand mission details" : "Collapse mission details"}
            onClick={() => setCollapsed((current) => !current)}
          >
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform", collapsed && "-rotate-90")}
            />
          </IconButton>
        </div>
      </CardHeader>
      {/* The expand modal (WP4.3). Radix portals it, so its placement here is inert until opened. */}
      {board.agents.length > 0 ? (
        <MissionExpandDialog
          board={board}
          {...(roleLookup ? { roleLookup } : {})}
          open={expandOpen}
          onOpenChange={setExpandOpen}
        />
      ) : null}
      {/* hub-fixes WP2.5 (D-HF6) — the always_ask approval queue. Rendered OUTSIDE the collapse so an
          urgent, mission-blocking decision is never hidden (a pending approval pauses that agent's
          slot; deny → the agent proceeds without the call, never a fabricated result). */}
      {pendingApprovals.length > 0 ? (
        <CardContent className="border-t border-border pt-4">
          <MissionApprovalQueue approvals={pendingApprovals} />
        </CardContent>
      ) : null}
      {collapsed ? null : (
      <CardContent id={contentId} className="flex flex-col gap-4">
        {/* Progress + budget meter (R-UX4). hub-fixes WP2.4 — the budget bar is now REAL spend/max
            (previously the runner hardcoded `costUsd: 0`, so a meter here would have been fiction). */}
        <div className="flex flex-col gap-1">
          <Progress value={progress} aria-label="Agents reported" />
          {missionBudget !== undefined ? (
            <Progress
              value={budgetProgress}
              aria-label="Budget spent"
              aria-valuetext={`${spentKnown ? fmtUsd(spentSoFar) : "unknown"} of ${fmtUsd(missionBudget)} spent`}
            />
          ) : null}
        </div>

        {/* Live topology graph — the team shape with real agent state on the nodes (R-UX4). */}
        {board.agents.length > 0 ? (
          <TopologyGraph
            input={missionBoardToTopoInput(board)}
            variant="mission"
            iconById={graphIconById}
            briefById={graphBriefById}
            ariaLabel={`${TOPOLOGY_LABEL[board.plan.topology]} topology — ${done} of ${total} agents reported`}
            className="h-72"
            selectable
            selectedNodeId={selectedAgent?.agentSessionId}
            onSelectNode={(id) => {
              // Only agent nodes drive the inline detail box; synthetic nodes (synthesis/judge) have
              // their panels in the expand modal.
              if (board.agents.some((a) => a.agentSessionId === id)) setSelectedAgentId(id);
            }}
          />
        ) : null}

        {/* Detail box — the selected NODE's Status / Report / Live tabs (ui-wave U1: the graph is the
            selector; the tab choice persists across node switches). */}
        {selectedAgent ? (
          <MissionAgentDetail
            agent={selectedAgent}
            icon={iconFor(selectedAgent.key)}
            tab={detailTab}
            onTabChange={setDetailTab}
          />
        ) : null}

        {/* The queue — agents still waiting for a slot / to report (Queue*, R-UX4). */}
        {waitingAgents.length > 0 ? (
          <Queue>
            <QueueList>
              {waitingAgents.map((agent) => (
                <WaitingAgentRow
                  key={agent.agentSessionId}
                  agent={agent}
                  icon={iconFor(agent.key)}
                  active={active}
                  missionId={board.missionId}
                  busy={busy}
                  {...(onStopAgent ? { onStopAgent } : {})}
                  {...(onSteerAgent ? { onSteerAgent } : {})}
                />
              ))}
            </QueueList>
          </Queue>
        ) : null}

        {/* Synthesis marker — the actual answer renders as a normal assistant message in the transcript. */}
        {board.synthesis ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <CircleCheck aria-hidden className="size-4 text-primary" />
            <Text className="text-caption">
              {board.synthesis.partial
                ? "Partial synthesis — some agents did not complete. The answer draws only on those that reported."
                : "Synthesis complete — the answer below cites each agent's findings."}
            </Text>
          </div>
        ) : null}
      </CardContent>
      )}
      {/* v1-fixes (F7) — the mission → results → open questions → NEXT mission loop. Rendered OUTSIDE
          the collapse (like the approval queue) so the follow-up affordance survives the done-board's
          auto-collapse. One click proposes a follow-up mission seeded with the question; the planner
          also receives the previous mission's digest as context, so the team builds on the results. */}
      {board.synthesis && onProposeFollowup && board.followups && board.followups.length > 0 ? (
        <CardContent className="border-t border-border pt-4">
          <div className="flex flex-col gap-2">
            <Text className="text-caption text-muted-foreground">
              Open questions from the reports — start a follow-up mission:
            </Text>
            <div className="flex flex-wrap gap-2">
              {board.followups.slice(0, 8).map((followup) => (
                <Button
                  key={followup.question}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onProposeFollowup(followup.question)}
                  title={followup.roleName ? `Raised by ${followup.roleName}` : followup.question}
                  className="max-w-full"
                >
                  <span className="max-w-[42ch] truncate">{followup.question}</span>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * hub-fixes WP2.5 (D-HF6) — the `always_ask` mission approval queue. Each pending child-agent tool call
 * (mirrored onto the parent log as an `agent_approval_requested`) renders a `@brand/ai` `ApprovalCard`;
 * Approve/Deny route to the CHILD session's own `/approvals` endpoint via {@link decideHubApproval}
 * (the SAME mechanism the main console uses — the shared HITL coordinator resolves the paused child
 * turn). The card clears when the mirrored `agent_approval_responded` arrives over the parent SSE (the
 * board reconstructs purely from the event log — R-SES1); a per-call `deciding` guard prevents a
 * double-submit while the decision is in flight. Deny → the agent proceeds without the call (never a
 * fabricated result). brand-ui only; reads correctly in both themes (semantic tokens only).
 */
export function MissionApprovalQueue({ approvals }: { approvals: MissionBoardPendingApproval[] }) {
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});

  const decide = (approval: MissionBoardPendingApproval, resolution: HubApprovalResolution): void => {
    const key = `${approval.agentSessionId}::${approval.toolCallId}`;
    setDeciding((current) => ({ ...current, [key]: true }));
    void decideHubApproval(approval.agentSessionId, approval.toolCallId, resolution).catch(
      (error: unknown) => {
        // Re-enable the buttons + surface the failure honestly (never a silent dead click). A 409
        // (already resolved — e.g. the timeout beat the operator) is expected once the card is stale.
        setDeciding((current) => ({ ...current, [key]: false }));
        notifyError("Couldn’t submit the decision", {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
  };

  return (
    <div data-testid="mission-approval-queue" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldAlert aria-hidden className="size-4 text-primary" />
        <Heading level={5} size="subtitle" className="min-w-0 truncate">
          Waiting on approval
        </Heading>
        <Badge variant="secondary" className="tabular-nums">
          {approvals.length}
        </Badge>
      </div>
      <Text tone="muted" className="text-caption">
        {approvals.length === 1 ? "An agent is" : `${approvals.length} agents are`} paused for a
        tool-call decision — approve to resume, or deny and the agent continues without it.
      </Text>
      <ul className="flex min-w-0 flex-col gap-2">
        {approvals.map((approval) => {
          const key = `${approval.agentSessionId}::${approval.toolCallId}`;
          const busy = deciding[key] === true;
          const name = prettyToolName(approval.toolName);
          const destructive = approval.annotations?.destructiveHint === true;
          return (
            <li key={key} className="min-w-0">
              <ApprovalCard state="approval-requested" approval={{ id: approval.toolCallId }}>
                <ApprovalCardTitle>
                  {approval.roleName ? `${approval.roleName}: ` : ""}Approve &ldquo;{name}&rdquo;?
                </ApprovalCardTitle>
                <ApprovalCardDescription>
                  {destructive
                    ? "This tool is annotated destructive — it may make changes that are hard to undo."
                    : "This agent paused for your decision — approve to run the tool, or deny to skip it."}
                </ApprovalCardDescription>
                <ApprovalCardRequest>
                  {approval.annotations?.destructiveHint || approval.annotations?.readOnlyHint ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {approval.annotations?.destructiveHint ? (
                        <Badge variant="outline">destructive</Badge>
                      ) : null}
                      {approval.annotations?.readOnlyHint ? (
                        <Badge variant="outline">read-only</Badge>
                      ) : null}
                    </div>
                  ) : null}
                  <ApprovalCardActions>
                    <ApprovalCardDeny disabled={busy} onClick={() => decide(approval, "deny")}>
                      Deny
                    </ApprovalCardDeny>
                    <ApprovalCardApprove
                      disabled={busy}
                      onClick={() => decide(approval, "allow-once")}
                    >
                      Approve
                    </ApprovalCardApprove>
                  </ApprovalCardActions>
                </ApprovalCardRequest>
                <ApprovalCardAccepted>Approved.</ApprovalCardAccepted>
                <ApprovalCardRejected>Denied.</ApprovalCardRejected>
              </ApprovalCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One still-running / waiting agent in the queue, with a per-agent Stop and (R-SES3/R-UX4) an inline
 *  steer composer that injects a durable message into the agent's child session. */
function WaitingAgentRow({
  agent,
  icon,
  active,
  missionId,
  busy,
  onStopAgent,
  onSteerAgent,
}: {
  agent: MissionBoardAgentView;
  icon?: string;
  active: boolean;
  missionId: string;
  busy?: boolean;
  onStopAgent?: (missionId: string, agentSessionId: string) => void;
  onSteerAgent?: (missionId: string, agentSessionId: string, text: string) => void;
}) {
  const [steer, setSteer] = useState("");
  const canSteer = active && !!onSteerAgent;
  const submitSteer = (): void => {
    const text = steer.trim();
    if (!text || !onSteerAgent) return;
    onSteerAgent(missionId, agent.agentSessionId, text);
    setSteer("");
  };

  return (
    <QueueItem>
      <QueueItemIndicator />
      <QueueItemContent>
        <span className="inline-flex items-center gap-2">
          <RoleAvatar
            id={agent.agentSessionId}
            icon={icon}
            model={agent.model}
            className="size-5 shrink-0 rounded-full"
          />
          {active ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <CircleDashed aria-hidden className="size-3.5 text-muted-foreground" />
          )}
          {agent.roleName}
          <Badge variant="outline">{agent.model}</Badge>
        </span>
      </QueueItemContent>
      <QueueItemDescription>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Text tone="muted" className="min-w-0 truncate text-caption">
              {active ? "Working…" : "Did not report"}
            </Text>
            {active && onStopAgent ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onStopAgent(missionId, agent.agentSessionId)}
              >
                Stop
              </Button>
            ) : null}
          </div>
          {/* crew-nesting WP4.3 (D-CN2/D-CN5) — a still-waiting sub-crew slot's own sub-mission progress
              + cascading budget, so a running sub-crew reads as MORE than a spinner while it works. */}
          {agent.childBoard ? (
            <Text tone="muted" className="min-w-0 truncate text-caption tabular-nums">
              Sub-crew: {subCrewSummaryLine(agent.childBoard)}
            </Text>
          ) : null}
          {canSteer ? (
            <form
              className="flex items-center gap-1.5"
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
                className="h-8 min-w-0 flex-1 text-caption"
              />
              <IconButton
                type="submit"
                variant="outline"
                size="sm"
                disabled={busy || steer.trim().length === 0}
                label="Send steering message"
              >
                <Send aria-hidden className="size-3.5" />
              </IconButton>
            </form>
          ) : null}
        </div>
      </QueueItemDescription>
    </QueueItem>
  );
}

// ── The detail box — Status / Report tabs for the selected agent (hub-fixes WP4.2 / RC6.3;
//    ui-wave U1: selection moved onto the topology graph — the duplicate agent-card grid is gone) ────

/** Cap on visible findings / open-question list items before a "Show N more" affordance — truncate
 *  with expand, never an unbounded list (matches `meta-rail/ProgressSection.tsx`'s task list). */
const AGENT_REPORT_VISIBLE_CAP = 5;

export type MissionAgentDetailTab = "status" | "report" | "live";

function MissionAgentDetail({
  agent,
  icon,
  tab,
  onTabChange,
}: {
  agent: MissionBoardAgentView;
  icon?: string;
  /** ui-wave U1 (owner feedback) — CONTROLLED tab that PERSISTS across node switches. */
  tab: MissionAgentDetailTab;
  onTabChange: (tab: MissionAgentDetailTab) => void;
}) {
  return (
    <Card data-testid="mission-agent-detail" className="min-w-0 border-border bg-muted/20">
      {/* Controlled Tabs (ui-wave U1): switching the selected node keeps the current tab — an
          explicit tab choice is a viewing mode, not per-agent state (pre-fix, a `key` remount reset
          every switch back to Status, the exact behavior the owner flagged). */}
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as MissionAgentDetailTab)}>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <RoleAvatar
              id={agent.agentSessionId}
              icon={icon}
              model={agent.model}
              className="size-7 shrink-0 rounded-full"
            />
            <Heading level={5} size="subtitle" className="min-w-0 truncate">
              {agent.roleName}
            </Heading>
          </div>
          <TabsList>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
            {/* hub-fixes WP4.3 — the agent's own child session, streamed read-only. */}
            <TabsTrigger value="live">Live</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent className="min-w-0">
          <TabsContent value="status" className="min-w-0">
            <MissionAgentStatusTab agent={agent} />
          </TabsContent>
          <TabsContent value="report" className="min-w-0">
            <MissionAgentReportTab report={agent.report} />
          </TabsContent>
          <TabsContent value="live" className="min-w-0">
            {/* Radix only mounts the ACTIVE tab, so the SSE subscription opens on demand (and unmounts
                — unsubscribes — when the operator leaves Live or the detail box closes). */}
            <AgentTranscript
              sessionId={agent.agentSessionId}
              ariaLabel={`Live session — ${agent.roleName}`}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

export function MissionAgentStatusTab({ agent }: { agent: MissionBoardAgentView }) {
  const report = agent.report;
  return (
    <Descriptions columns={2} layout="horizontal">
      <DescriptionsItem label="State">
        <Badge variant={agent.reported ? "secondary" : "outline"}>
          {agent.reported ? "Reported" : "Waiting"}
        </Badge>
      </DescriptionsItem>
      <DescriptionsItem label="Model">{agent.model}</DescriptionsItem>
      {report ? (
        <DescriptionsItem label="Confidence">
          <Badge variant={CONFIDENCE_VARIANT[report.confidence]}>{report.confidence}</Badge>
        </DescriptionsItem>
      ) : null}
      <DescriptionsItem label="Spawned">{formatDateTime(agent.spawnedAt)}</DescriptionsItem>
      {agent.reportedAt ? (
        <DescriptionsItem label="Reported at">{formatDateTime(agent.reportedAt)}</DescriptionsItem>
      ) : null}
      {/* hub-fixes WP2.4 — real per-agent cost/tokens (the runner's own accumulated total, carried on
          the `agent_report` event); absent on a pre-fix log or a not-yet-reported agent, never
          fabricated. */}
      {agent.costUsd !== undefined ? (
        <DescriptionsItem label="Cost">
          <span className="tabular-nums">{fmtUsd(agent.costUsd)}</span>
        </DescriptionsItem>
      ) : null}
      {agent.tokensIn !== undefined || agent.tokensOut !== undefined ? (
        <DescriptionsItem label="Tokens">
          <span className="tabular-nums">
            {(agent.tokensIn ?? 0).toLocaleString()} in / {(agent.tokensOut ?? 0).toLocaleString()} out
          </span>
        </DescriptionsItem>
      ) : null}
      {/* crew-nesting WP4.3 (D-CN2/D-CN5) — this slot's own sub-mission progress + cascading budget. */}
      {agent.childBoard ? (
        <DescriptionsItem label="Sub-crew">
          <span className="tabular-nums">{subCrewSummaryLine(agent.childBoard)}</span>
        </DescriptionsItem>
      ) : null}
    </Descriptions>
  );
}

export function MissionAgentReportTab({ report }: { report: HubAgentReport | undefined }) {
  const [findingsExpanded, setFindingsExpanded] = useState(false);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);

  if (!report) {
    return (
      <Text tone="muted" className="text-caption">
        This agent hasn't reported yet.
      </Text>
    );
  }

  const findings = findingsExpanded
    ? report.findings
    : report.findings.slice(0, AGENT_REPORT_VISIBLE_CAP);
  const hiddenFindings = report.findings.length - findings.length;
  const questions = questionsExpanded
    ? report.openQuestions
    : report.openQuestions.slice(0, AGENT_REPORT_VISIBLE_CAP);
  const hiddenQuestions = report.openQuestions.length - questions.length;
  const isEmpty = !report.summary && report.findings.length === 0 && report.openQuestions.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {report.summary ? (
        <Text className="min-w-0 break-words text-caption">{report.summary}</Text>
      ) : null}

      {report.findings.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Text tone="muted" className="text-caption font-medium">
            Findings
          </Text>
          <ul className="ml-4 flex min-w-0 flex-col gap-1.5 list-disc">
            {findings.map((finding, i) => (
              <li key={i} className="min-w-0">
                <Text className="min-w-0 break-words text-caption">{finding.summary}</Text>
                {finding.detail ? (
                  <Text tone="muted" className="min-w-0 break-words text-caption">
                    {finding.detail}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
          {hiddenFindings > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setFindingsExpanded(true)}
            >
              Show {hiddenFindings} more finding{hiddenFindings === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {report.openQuestions.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Text tone="muted" className="text-caption font-medium">
            Open questions
          </Text>
          <ul className="ml-4 flex min-w-0 flex-col gap-1 list-disc">
            {questions.map((q, i) => (
              <li key={i} className="min-w-0">
                <Text tone="muted" className="min-w-0 break-words text-caption">
                  {q}
                </Text>
              </li>
            ))}
          </ul>
          {hiddenQuestions > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setQuestionsExpanded(true)}
            >
              Show {hiddenQuestions} more
            </Button>
          ) : null}
        </div>
      ) : null}

      {isEmpty ? (
        <Text tone="muted" className="text-caption">
          No findings recorded.
        </Text>
      ) : null}
    </div>
  );
}
