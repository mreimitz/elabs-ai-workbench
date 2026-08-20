---
type: "Work Package Spec"
title: "References \u2014 where the plan's facts come from"
description: "This plan was authored from seven read-only subsystem maps of the live code (2026-07-26). The"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# References — where the plan's facts come from

This plan was authored from seven read-only subsystem maps of the live code (2026-07-26). The
load-bearing file/line anchors, so a WP can jump straight to ground truth:

## Execution engine
- `apps/api/src/hub/missions/orchestrator.ts` — `approve:519`, `runMission:645`, spawn loop `659–674`,
  budget block + `runSlot` `707–758`, `tripBudget:715`, `runOneAgent:840`, `shouldAutoApprove:1246`,
  `synthesize:1137`, `projectTranscriptToReport:1498`, `stampReport:1128`, the `kind==='chat'` propose
  gate `330`, `missionUnreadyServers:563`.
- `apps/api/src/hub/missions/topologies.ts` — `runTopology:127`, `runSlotPool:148`, `runParallel:172`
  / `runPipeline:190` / `runDebate:232` / `runBestOfN:312`, `TopologyOutcome:114`,
  `instantiateCrewPlan:430` (**the flatten seam**), `roleToPlannedAgent:509`, depth-1 comment `22–24`.
- `apps/api/src/hub/missions/synthesis.ts` — `synthesizeMission:291`, `mergeAgentCitations:81`,
  `PARTIAL_PREFIX:275`.
- `apps/api/src/hub/missions/board.ts` — `reconstructMission:52`, `MissionBoardAgent:21`.
- `HubAgentRunResult` — `orchestrator.ts:134`.

## Data model / persistence
- `apps/api/src/db/schema.ts` — `hub_crews:1050`, `hub_sessions:1067` (`kind` CHECK `1070`,
  `parent_session_id:1071`, `mission_id:1072`, `crew_id:1078`), `hub_missions:1136` (**no
  `parent_mission_id`, no `depth` today**).
- `apps/api/src/db/database.ts` — `MIGRATIONS:83`, `LATEST_SCHEMA_VERSION` auto-derive `1597`,
  `applyMigrations:1611`, `ensureColumn:1976`, `rebuildHubSessionsForAutoMode` (v51, 12-step
  precedent) `1559`, version-literal test locks `438`. **Head = v53; next free = v54.**
- `apps/api/src/hub/repository.ts` — crews `405–464`, `toCrew:1569`, missions `900–979`,
  `toMission:1666`, session tree helpers `548`/`571`/`717`/`738`.
- `apps/api/src/db/rows.ts` — `skill_ids_json` no-migration precedent `763–766`.

## Wire contract (`packages/shared`)
- `types.ts` — `HubBudgets:5259`, `HubMissionBudgets:5268`, `HubAgentReport:5479`,
  `HubCrewMember:5673`, `HubCrew:5686`, `HubPlannedAgent:5729`, `HubMissionPlan:5746`,
  `HubMission:5763`, `HubSessionRoster:5811`.
- `schemas.ts` — `hubCrewMemberSchema:3432` (**plain stripping `z.object`, `agentId` required**),
  `hubCrewInputSchema:3457`/`hubCrewPatchSchema:3468` (`.strict()`), `hubAgentReportSchema:3343`,
  `hubSkillAttachmentInputSchema:3360` (the `.superRefine` "exactly one" precedent),
  `hubGenUiNodeSchema:3260` (the `z.lazy` recursive-schema precedent), `agent_report` event `3983`.
- `constants.ts` — `HUB_TOPOLOGIES:1453`, `HUB_AUTONOMY_LEVELS:1458`, name caps `1747–1784`; **no
  depth constant exists**.
- `assistant-scope.ts` — `SCOPE_EXEMPT_ACTION_TOOLS:119` (the four `hub_*` tools `123–126`).

## Budgets / autonomy / HITL / security
- `apps/api/src/hub/missions/planner.ts` — `HubMissionCaps:46`, `clampPlanToBudgets:459` (**ceiling
  line `492`**), `estimatePlanCostUsd:305`, roster catalog `135`/`162`/`184`.
- `apps/api/src/config/env.ts` — `hubMissionMaxAgents:349`, `MaxParallel:353`, `DefaultBudgetUsd`,
  `MaxBudgetUsd:363` ($10 ceiling), autonomy thresholds `342–399`.
- `apps/api/src/hub/hitl.ts` — approval gate `65–79`, per-turn teardown `318–342`.
- `apps/api/src/hub/tools/grants.ts` — `effectiveAgentGrants:69`, `intersectServerGrant`.
- `apps/api/src/hub/tools/builtins/index.ts` — withheld `mission.propose_plan` `32–63`.
- `roadmap/assistant-hub/README.md:67` (D-AH9), `:120` (recursion deferred);
  `roadmap/assistant-hub/STATUS.md:56,65,73,80` (the four `x.R` reviews), `:386–390` (BUG-4/INV4).

## Planner / authoring / dock tools
- `apps/api/src/assistant/tools/hub-write-tools.ts` — `hub_crew_create:110`, `hub_crew_update:126`,
  `summarizeCrew` echo, scope-exempt note `15–21`.
- `apps/api/src/assistant/tools/hub-read-tools.ts` — `summarizeCrew:94` (`memberAgentIds:103`),
  `hub_crews_list:144`.
- `apps/api/src/hub/routes.ts` — crew CRUD `2677`/`2688`.
- `apps/api/src/index.ts` — `resolveCrew`/`resolveRoster`/`resolveAgents` DI `791–840`.

## Web UI
- `apps/web/src/features/hub/workforce/` — `OrgRail.tsx` (bespoke 2-level tree, `assignedRoleIds:182`,
  drag payload `119`), `CrewCard.tsx` (`m.agentId` strip `27`), `DirectoryTab.tsx` (`145–165`),
  `org-chart/org-model.ts` (`buildOrgChartModel:140`, `OrgNodeMeta:41`, `packLanes:281`),
  `org-chart/crew-layout.ts`, `crew-profile/MembersSection.tsx` (`addMember:60`, role-only picker),
  `crew-profile-form.ts` (`validateCrewProfileForm:43`).
- `apps/web/src/features/hub/` — `MissionBoard.tsx` (`reconstructMissionBoard:157`),
  `topology-graph.ts` (`deriveTopologyGraph:225`), `TopologyGraph.tsx`, `MissionAgentNode.tsx`,
  `MissionPlanCard.tsx` (`plan.agents.map:283`), `MissionExpandDialog.tsx` (`nodeIds:85`),
  `AgentTranscript.tsx`, `App.tsx:1294` (`/assistant/agents/crew/:crewId`).

## House-style templates (for the plan itself)
- `.claude/skills/next-wp/{SKILL.md,references/plan-layout.md,references/status-ledger.md,assets/STATUS.template.md}`.
- `roadmap/assistant-operability/` (small-plan shape), `roadmap/assistant-hub/` (decision table +
  execution plan), `roadmap/observability/phase-5-issues/WP-5.1-issue-aggregation.md` (WP-file shape),
  `roadmap/testing/conventions.md`.
