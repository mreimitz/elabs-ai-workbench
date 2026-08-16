// Assistant Hub — v1-fixes F3 (roadmap/assistant-hub/mission-session-analysis-2026-07-20.md) — the
// mission READ builtins: the model-readable window onto this session's missions.
//
// Root cause they close: agent reports existed in the event log, on the board UI, and in the child
// session logs — and in ZERO places the model could reach. `mission_digest` (F2) gives every later
// turn a compact always-present record; these two read-only builtins are the on-demand DEEP path:
// `mission.list` enumerates the session's missions (status, agents, follow-up questions), and
// `mission.report` returns the full structured report(s). Both reconstruct purely from the parent
// session's own `hub_events` (R-SES1) + the `hub_missions` row — no new tables, no cross-session reads.
import type { HubAgentReport, HubEvent } from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { HubBuiltinTool } from "../types.js";

const listInput = z.object({}).strict();

const reportInput = z
  .object({
    missionId: z.string().min(1).optional(),
    agentSessionId: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
  })
  .strict();

type SpawnInfo = { key: string; roleName: string; agentSessionId: string };

/** Reconstruct each mission's spawned-agent roster (key → child session) from `agent_spawned` events. */
function spawnedByMission(events: readonly HubEvent[]): Map<string, SpawnInfo[]> {
  const byMission = new Map<string, SpawnInfo[]>();
  for (const event of events) {
    if (event.type !== "agent_spawned") continue;
    const list = byMission.get(event.missionId) ?? [];
    list.push({ key: event.key, roleName: event.roleName, agentSessionId: event.agentSessionId });
    byMission.set(event.missionId, list);
  }
  return byMission;
}

/** The latest `mission_followups` payload per mission (later events win — replay-stable). */
function followupsByMission(
  events: readonly HubEvent[],
): Map<string, Array<{ question: string; agentSessionId?: string; roleName?: string }>> {
  const byMission = new Map<string, Array<{ question: string; agentSessionId?: string; roleName?: string }>>();
  for (const event of events) {
    if (event.type === "mission_followups") byMission.set(event.missionId, event.followups);
  }
  return byMission;
}

export const missionList: HubBuiltinTool = {
  name: "mission.list",
  source: "builtin",
  description:
    "List this session's missions: status, topology, spawned agents, and any open follow-up questions " +
    "their reports raised. Read-only. Use mission.report to read a full agent report.",
  inputSchema: listInput,
  annotations: { readOnlyHint: true },
  async execute(input, ctx) {
    listInput.parse(input ?? {});
    const events = ctx.repository.listEvents(ctx.sessionId);
    const spawned = spawnedByMission(events);
    const followups = followupsByMission(events);
    const missions = ctx.repository
      .listMissions()
      .filter((m) => m.sessionId === ctx.sessionId)
      .map((m) => ({
        missionId: m.id,
        status: m.status,
        topology: m.topology,
        createdAt: m.createdAt,
        agents: (spawned.get(m.id) ?? []).map((s) => ({
          key: s.key,
          roleName: s.roleName,
          agentSessionId: s.agentSessionId,
        })),
        followups: followups.get(m.id) ?? [],
      }));
    return { modelContent: missions };
  },
};

export const missionReport: HubBuiltinTool = {
  name: "mission.report",
  source: "builtin",
  description:
    "Read the full structured report(s) — findings, citations, confidence, open questions — of this " +
    "session's mission agents. Without arguments: every report of the latest reported mission. Narrow " +
    "with missionId, agentSessionId, or the agent's plan key. Read-only.",
  inputSchema: reportInput,
  annotations: { readOnlyHint: true },
  async execute(input, ctx) {
    const { missionId, agentSessionId, key } = reportInput.parse(input ?? {});
    const events = ctx.repository.listEvents(ctx.sessionId);
    const reportEvents = events.filter(
      (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
    );
    const resolvedMissionId = missionId ?? reportEvents.at(-1)?.missionId;
    if (!resolvedMissionId) {
      return {
        modelContent: null,
        isError: true,
        errorText: "No mission reports exist in this session yet (run a mission first).",
      };
    }
    const roster = spawnedByMission(events).get(resolvedMissionId) ?? [];
    let wantedAgentSession = agentSessionId;
    if (!wantedAgentSession && key) {
      wantedAgentSession = roster.find((s) => s.key === key)?.agentSessionId;
      if (!wantedAgentSession) {
        return {
          modelContent: null,
          isError: true,
          errorText: `No agent with key "${key}" in mission ${resolvedMissionId}. Known keys: ${
            roster.map((s) => s.key).join(", ") || "(none)"
          }.`,
        };
      }
    }
    const matching = reportEvents.filter(
      (e) =>
        e.missionId === resolvedMissionId &&
        (!wantedAgentSession || e.agentSessionId === wantedAgentSession),
    );
    if (matching.length === 0) {
      return {
        modelContent: null,
        isError: true,
        errorText: `No report found for mission ${resolvedMissionId}${
          wantedAgentSession ? ` and agent ${wantedAgentSession}` : ""
        }.`,
      };
    }
    const reports: Array<{
      missionId: string;
      agentSessionId: string;
      key?: string;
      roleName?: string;
      report: HubAgentReport;
    }> = matching.map((e) => {
      const info = roster.find((s) => s.agentSessionId === e.agentSessionId);
      return {
        missionId: e.missionId,
        agentSessionId: e.agentSessionId,
        ...(info ? { key: info.key, roleName: info.roleName } : {}),
        report: e.report,
      };
    });
    return { modelContent: reports };
  },
};

export const MISSION_READ_BUILTINS: HubBuiltinTool[] = [missionList, missionReport];
