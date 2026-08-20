---
type: "Roadmap Item"
title: "Hierarchical crews — runtime-recursive crew composition"
description: "Let a saved crew contain another saved crew, running nested crews as sub-missions under their own topology with a monotone budget cascade, transitive grant intersection and a two-layer cycle and depth guard."
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Hierarchical crews — runtime-recursive crew composition

## Goal

Let a saved crew contain another saved crew, running nested crews as sub-missions under their own topology with a monotone budget cascade, transitive grant intersection and a two-layer cycle and depth guard.

## Why it matters

A crew could only be a flat list of agents, so an operator could not compose a large mission out of teams that were already proven.

## Milestones

- [ ] Phase 0 — the recursion contract.
- [ ] Phase 1 — author-time guards.
- [ ] Phase 2 — run-time recursion and budgets.
- [ ] Phase 3 — event-sourced tree replay.
- [ ] Phase 4 — the org rail and mission board.
- [ ] Phase 5 — the hierarchical run report.

## Linked research

- [RS-06](/Research/RS-06-agentic-session-sota/topic.md)

## Plan overview (from the original plan README)

> **Living state: [`STATUS.md`](./STATUS.md)** is the single source of truth for what is
> in-progress / done / owner-gated. This README is the master index (mission, locked decisions,
> WP index, dependency graph, invariants); it does **not** restate per-WP status.

Shared doctrine every WP assumes: [`conventions.md`](./conventions.md) (extends
[`../testing/conventions.md`](/Roadmap/RM-26-testing/conventions.md)). Grounding evidence (the seven subsystem
maps this plan was authored from) is summarised in [`references.md`](./references.md).

---

## 1. What we're building

Today a **crew** (`HubCrew`) is a saved *template* — `{ topology, members: HubCrewMember[] }` — and
each member references a library **role** via `agentId`. A crew never executes; it is **flattened**
into one flat `HubMissionPlan` by `instantiateCrewPlan` (`topologies.ts:430` (`../../apps/api/src/hub/missions/topologies.ts`)),
and the **mission** runs those planned agents as child sessions under the crew's *single* topology.
Decomposition depth is fixed at **1** by locked decision **D-AH9** ("agents never spawn agents").

This plan lets a crew member reference **another crew** (`crewId`). At execution a nested crew runs
as its **own sub-mission** under its **own topology**; budgets **cascade** down the tree (bounded so
they can only ever subdivide, never widen); results **flow up** (a child crew's synthesised answer is
projected into one `HubAgentReport` and consumed by the parent's synthesis exactly like an agent
report); context **flows down** as a curated brief (never the parent transcript); **circular
references are rejected** at author-time *and* run-time; and a **configurable maximum depth** plus a
new **whole-tree agent/budget ceiling** bound the fan-out.

**This reopens D-AH9 — narrowly.** See D-CN1. It is not open-ended agent-spawns-agent: agents still
cannot call `mission.propose_plan`; only the *deterministic crew-instantiation engine* recurses over
crews an operator authored ahead of time. The `kind:'chat'` propose gate and the withheld
`propose_plan` builtin are **unchanged**.

### Enterprise picture (why)

True org modelling — Chief Operating Agent → {Strategy Crew (pipeline), Intelligence Crew (parallel)
→ {Data Analyst, Business-Intelligence sub-crew (Mike, Thomas)}} — with per-level topology, budget,
and an honest per-level execution trace. The `Business-Intelligence sub-crew` keeps its own `parallel`
topology *while running inside* the `Intelligence Crew`, which is impossible under today's single-plan
flatten.

---

## 2. The D-AH9 amendment (read before touching an execution file)

| | |
|---|---|
| **Original (D-AH9, [`assistant-hub/README.md:67`](/Roadmap/RM-03-assistant-hub/item.md))** | "Decomposition depth is **1** (planner only) in v1; recursion is a flagged future option." Enforced *structurally*: `proposePlan` requires `session.kind === 'chat'` (`orchestrator.ts:330` (`../../apps/api/src/hub/missions/orchestrator.ts`)); the `mission.propose_plan` builtin is withheld from agent sessions (`tools/builtins/index.ts` (`../../apps/api/src/hub/tools/builtins/index.ts`)); `HubMissionPlan.agents` is a **flat** array. |
| **Amendment (D-CN1)** | Depth **> 1 is permitted only for saved-crew *composition*** via `crewId` members, expanded by the deterministic instantiation engine, bounded by `HUB_MISSION_MAX_DEPTH`, a whole-tree agent cap, and the whole-tree budget ceiling. Agents *still* cannot spawn: the propose gate and withheld builtin **stay**. The planner path stays depth-flat. |

A WP that believes a D-CN decision is wrong **STOPS and writes a STATUS blocker** — it does not
improvise (house rule; see [`assistant-hub/README.md`](/Roadmap/RM-03-assistant-hub/item.md)).

---

## 3. Locked decisions (D-CN log)

Locked at owner kickoff 2026-07-26. **Never reopened by a WP.** Bare-referenced everywhere as `D-CNn`.

| # | Decision |
|---|---|
| **D-CN1** | **Narrow D-AH9 reopening.** Nesting = *deterministic saved-crew composition* only. Depth bounded by `HUB_MISSION_MAX_DEPTH`. `proposePlan`'s `kind==='chat'` gate and the withheld `mission.propose_plan` builtin are **unchanged** — agents never spawn missions. The planner (model) path stays flat; recursion lives only on the deterministic `crewId` path. |
| **D-CN2** | **A nested crew runs as its own sub-mission.** Recursion hooks at `runSlot`/`runOneAgent` (`orchestrator.ts:725`/`:840` (`../../apps/api/src/hub/missions/orchestrator.ts`)): a planned unit carrying a `crewId` runs a nested `runTopology` under the **child crew's own topology**, then its synthesised answer is **projected into one stamped `HubAgentReport`** returned through the existing `HubAgentRunResult` channel — so every topology stays agnostic about whether a slot was a leaf agent or a whole sub-crew. `HubMissionPlan.agents` **stays flat per level**; the tree is resolved level-by-level at run time and materialised as child `hub_missions` rows, never one giant frozen nested plan. |
| **D-CN3** | **`HUB_MISSION_MAX_BUDGET_USD` is a whole-TREE ceiling; cascade is monotone non-increasing.** The root mission is clamped exactly as today (`planner.ts:492` (`../../apps/api/src/hub/missions/planner.ts`)); every descendant allocation is `min(requested, parentRemaining)` and **never re-reads env caps**. A shared cost accumulator, shared abort signal, and shared concurrency limiter are threaded through all levels via `TopologyContext`; a parent budget trip aborts in-flight descendants. The load-bearing property: `sum(child allocations) ≤ parent.maxCostUsd`, so the aggregate can never exceed the root's `min(requested, maxBudgetUsd)`. A new aggregate cap `HUB_MISSION_MAX_TOTAL_AGENTS` (transitive leaf count) backstops the per-mission `HUB_MISSION_MAX_AGENTS`. |
| **D-CN4** | **Two-layer cycle + depth guard (both required).** *Author-time* (crew create/update, in the repository — the only layer with crew-read access): reject a `crewId` member that transitively reaches the crew being saved, a non-existent `crewId`, or nesting beyond `HUB_MISSION_MAX_DEPTH` — a loud validation error, never a silent skip. *Run-time* (the instantiation/spawn engine): carry a visited-set of crewIds along the current path + a depth counter, rejecting re-entry / over-depth — belt-and-suspenders, because the graph can mutate between save and run. |
| **D-CN5** | **Contract stays additive on versionless `/api`.** `HubCrewMember.agentId` widens to **optional**; add `crewId?`; a `.superRefine` enforces **exactly one of `{agentId, crewId}`** (provably passes for every existing `{agentId}` member — the `hubSkillAttachmentInputSchema` precedent), and the member schema gains `.strict()` to stop silent stripping of `crewId`/typos. `crewId?` on `HubPlannedAgent`; optional nesting fields on `HubAgentReport` (`subMissionId?`, `topology?`, `childReports?` via `z.lazy` — the `hubGenUiNodeSchema` precedent) and `HubMission` (`parentMissionId?`, `depth?`); `memberCrewIds[]` + `memberAgentCount`/`memberCrewCount`/`totalAgentCount` on the crew summary. All new fields **optional** ⇒ **no `/api/v2`**. The one required→optional widening (`agentId`) is **wire-additive but TYPE-breaking** — every `member.agentId` deref must be guarded (WP 0.1). |
| **D-CN6** | **Migration `v54` adds mission-tree lineage; blobs need no migration.** Additive nullable columns on `hub_missions`: `parent_mission_id` (FK `ON DELETE CASCADE`), `depth` (`INTEGER NOT NULL DEFAULT 0`), and `root_mission_id` (denormalised, for O(1) tree rollup). `members_json`/`plan_json` are opaque blobs — `crewId`/nesting fields ride them with **no** migration (the `skill_ids_json` precedent). The session parent/child chain (`parent_session_id`, `mission_id`) is **reused as-is**. **Every mission in a tree keeps `session_id = the root chat session`** (for ownership + cost rollup); the mission tree is expressed *only* by `parent_mission_id`. `hub_sessions.kind` and the `kind:'chat'` propose gate are **not** relaxed (a sub-mission row is created directly by the recursion engine, never via `proposePlan`). Re-confirm `v54` is still free at claim time (check `database.ts` + sibling `STATUS.md` ledgers). |
| **D-CN7** | **Hierarchy is event-sourced (R-SES1 preserved).** Every nested spawn / report / budget-trip is an event so a nested-tree mission **replays from `hub_events` alone**. Parent-linkage is added **additively** to `agent_spawned` / `plan_proposed` (e.g. `parentMissionId` / `parentAgentKey`); the API board reducer (`missions/board.ts` (`../../apps/api/src/hub/missions/board.ts`)) **and** the web `MissionBoard` reducer both become tree-aware; cost/timing roll up per level. |
| **D-CN8** | **UI reuses routes/dialogs, brand-ui, both themes.** Org rail/chart go N-level (`@elabs-ai/components-ui` `Tree`, `@elabs-ai/components-flow` `FlowGroupNode` nesting); counts become **recursive with a cycle-safe visited set** ("N agents, M crews (T total)"); the crew editor gains a sub-crew add path + an author-time cycle warning; every member-render site branches on kind. A sub-crew *profile* drill is **route reuse** (`/assistant/agents/crew/:crewId`); a mission-board drill into a child sub-mission is a **transient nested dialog** (not a route). No new `<Route>` unless a dedicated nested canvas is added — which would require an `ASSISTANT_ROUTE_MANIFEST` entry (`assistant-operability.md` (`../../.claude/rules/assistant-operability.md`)). |
| **D-CN9** | **Frozen security boundary is untouched.** `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope` (`assistant-scope.ts` (`../../packages/shared/src/assistant-scope.ts`)) are **not** modified (D-AO3/D-AO7). The two `hub_crew_*` write tools stay in `SCOPE_EXEMPT_ACTION_TOOLS`, `write`-classified ⇒ **approval-gated**; nesting adds validation *logic*, not tool *names* or entity *kinds*. Transitive grant intersection (D-HF5) and transitive autonomy **non-escalation** hold at every level (a nested crew can only ever be *more* restrictive than its parent, never less). |
| **D-CN10** | **Default behaviour + off-switch.** Ships with `HUB_MISSION_MAX_DEPTH` default **2** (root + one nested level) and `HUB_MISSION_MAX_TOTAL_AGENTS` default **24**; **`HUB_MISSION_MAX_DEPTH=1` reproduces today's semantics exactly** (a `crewId` member is then rejected at author time as over-depth). Every phase closes with an adversarial-review WP that **refutes** the phase's invariants; findings → STATUS blockers → a `.fix` WP. |

> **Owner: please confirm before kickoff** — the three defaults most worth a second look are in
> D-CN10 (`MAX_DEPTH=2`, `MAX_TOTAL_AGENTS=24`) and D-CN6 (`session_id` stays the root chat session
> rather than relaxing the `kind:'chat'` gate). They are engineering recommendations, not owner
> mandates; the rest of D-CN1–D-CN9 follow from "runtime recursion, minimally invasive, security
> envelope intact".

---

## 4. Work-package index

Effort: **S** ≤ half-day · **M** ≈ 1 day · **L** > 1 day (agent-time, incl. tests). Model tiers per
D-AH19/D-US13: **Opus** for the contract, execution engine, budget/security, and all reviews;
**Sonnet** for standard implementation; **Haiku** for docs/status upkeep.

### Phase 0 — Contract & foundation
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 0.1 | Shared contract: `crewId` member (`agentId`→optional + `superRefine` + `.strict()`), `crewId?` on `HubPlannedAgent`, nesting fields on `HubAgentReport`/`HubMission`, crew-summary counts, `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS` constants; guard every `member.agentId` deref | — | M | Opus |
| 0.2 | Migration **v54** (`hub_missions.parent_mission_id`/`depth`/`root_mission_id`) + repository create/get/list + row mappers + `listChildMissions`/`getMissionTree`; both migration paths + version-literal locks | 0.1 | M | Opus |
| 0.3 | Env caps (`HUB_MISSION_MAX_DEPTH`, `HUB_MISSION_MAX_TOTAL_AGENTS`) + `HubMissionCaps` fields + `index.ts` wiring | 0.1 | S | Sonnet |

### Phase 1 — Author-time integrity
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 1.1 | Repository author-time cycle/exists/depth validation on `createCrew`/`updateCrew` + a memoised **cycle-safe recursive crew-resolution helper** (reused by read + instantiate) + `summarizeCrew` nested counts (`memberCrewIds`, `memberAgentCount`/`memberCrewCount`/`totalAgentCount`) | 0.1, 0.2, 0.3 | L | Opus |
| 1.2 | Dock write tools + HTTP CRUD accept `crewId` members (reuse shared schema + repo validation), echo `memberCrewIds`; `hub_crews_list` exposes nested counts; **assert `SCOPE_EXEMPT_ACTION_TOOLS` set-equality unchanged** | 1.1 | M | Sonnet |

### Phase 2 — Recursive execution engine
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 2.1 | Sub-mission spawn + recursion at `runSlot`/`runOneAgent`: crew-ref unit → nested `runTopology` under child topology → project to one stamped `HubAgentReport`; threaded shared abort/cost/concurrency via `TopologyContext`; run-time visited-set + depth guard; sub-mission `hub_missions` rows | 1.1, 0.2 | L | Opus |
| 2.2 | Whole-tree budget cascade: transitive-tree clamp + auto-approve/estimate/total-agent/depth computed over the tree at propose; monotone `min(requested, parentRemaining)`; cascading trip aborts descendants; honest-partial propagation up | 2.1, 0.3 | L | Opus |
| 2.3 | Transitive grant intersection (D-HF5 across N levels) + `missionUnreadyServers` recursion + nested settle/abort/steer reachable from top-level `stop()`/`stopAgent()` | 2.1 | M | Opus |
| 2.R | **Adversarial review of the execution heart** — refute budget monotonicity, cycle/depth enforcement, HITL deny-propagation, autonomy non-escalation, brief-only isolation, cascading abort. Findings → blockers → `2.fix` | 2.1, 2.2, 2.3 | M | Opus |

### Phase 3 — Board, replay & reporting
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 3.1 | Event-sourced hierarchy: additive parent-linkage on board events; API `board.ts` reducer tree-aware; per-level cost/timing roll-up; **nested-tree replay-from-events test** | 2.1 | L | Opus |
| 3.2 | Run report (JSON + Markdown) hierarchical trace + per-level attribution; a legacy flat mission still renders unchanged | 3.1 | M | Sonnet |

### Phase 4 — UI
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 4.1 | Crew editor sub-crew add path (`MembersSection` gains the crew set + a kind branch) + author-time cycle/depth warning + nested-member render | 1.2 | M | Sonnet |
| 4.2 | Org rail/chart N-level (`Tree` + nested `FlowGroupNode`) + recursive cycle-safe counts ("N agents, M crews (T total)") + `CrewCard`/`DirectoryTab` kind disambiguation | 1.1 | L | Sonnet |
| 4.3 | Mission board/topology hierarchical trace: web reducer tree-aware, `MissionExpandDialog` nested drill, `MissionPlanCard` nested rows, per-level cost meter | 3.1 | L | Sonnet |

### Phase 5 — Hardening & close
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 5.R | **Final full-tree adversarial security review** — the complete probe set (cycle author+run, depth cap, whole-tree budget aggregation + cascade-trip abort, nested `shouldAutoApprove`, nested HITL deny, transitive grants, transitive autonomy, replay). Findings → blockers → `5.fix` | 2.R, 3.1, 3.2, 4.1, 4.2, 4.3 | M | Opus |
| 5.1 | `CLAUDE.md` registration (SoT ledger list + north-star capability row) + `user-guide/` doc + owner-acceptance walk seeding + gate-green close | 5.R | S | Haiku |

---

## 5. Dependency graph & recommended build order

```
0.1 ─┬─► 0.2 ─┬─────────────────────────► 2.1 ─┬─► 2.2 ─┐
     ├─► 0.3 ─┘        1.1 ──► 1.2 ──► 4.1      ├─► 2.3 ─┼─► 2.R ─┐
     └────────────────► 1.1 ──► 4.2             └─► 3.1 ─┼─► 3.2  │
                                                         └─► 4.3  ├─► 5.R ─► 5.1
```

- **Vertical slice first:** 0.1 (contract) is the highest-blast-radius WP — **solo**, gates all.
- **Parallel batches the orchestrator can run** (≤ 4 agents, no shared-file overlap):
  1. `{0.1}` solo (`packages/shared`).
  2. `{0.2, 0.3}` — 0.2 owns `apps/api/src/db/*`, 0.3 owns `config/env.ts` + `index.ts` caps wiring (disjoint).
  3. `{1.1}` — owns `hub/repository.ts` + the resolution helper in `missions/topologies.ts` (contested by 2.1 → do 1.1 first, solo).
  4. `{1.2}`.
  5. `{2.1}` solo (`orchestrator.ts` + `topologies.ts`).
  6. `{2.2}` then `{2.3}` — **both touch `orchestrator.ts` → sequential, not parallel.**
  7. `{2.R, 3.1}` — 2.R is read-only; 3.1 owns `board.ts` (disjoint from the review).
  8. `{3.2, 4.1, 4.2, 4.3}` — web WPs on disjoint files (`MembersSection`, org-chart, mission-board) + the report (api) run in parallel.
  9. `{5.R}` then `{5.1}`.

---

## 6. Invariants (inherited by every WP)

See [`conventions.md`](./conventions.md) for the full doctrine. The load-bearing ones:

1. **Contract-first, additive:** `packages/shared` types + zod **first**, then api, then web; additive
   wire + DB only. The sole required→optional widening (`agentId`) must keep every existing member
   valid and must guard every deref.
2. **Budget monotonicity (D-CN3):** the aggregate spend across a whole tree can **never** exceed the
   root's `min(requested, HUB_MISSION_MAX_BUDGET_USD)`. Prove it with a test.
3. **Two-layer cycle/depth guard (D-CN4):** author-time *and* run-time, both required. A cycle or an
   over-depth crew is a loud reject, never an infinite loop or a silent skip.
4. **No propose-gate relaxation (D-CN1/D-CN6):** agents never gain `propose_plan`; sub-missions are
   born only inside the deterministic recursion engine.
5. **Transitive non-escalation (D-CN9):** grants intersect down the path; autonomy can only tighten
   down the path; brief-only context isolation holds at every level (never the parent transcript).
6. **Event-sourced replay (D-CN7):** a nested-tree mission reconstructs from `hub_events` alone.
7. **brand-ui only + two themes:** all UI from `@elabs-ai/components-*`, correct in `light` **and** `dark`.
8. **Reviews refute, not summarise:** `2.R` and `5.R` try to *break* the invariants.

---

## 7. Definition of done & owner acceptance

Every WP: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green, and its **Acceptance**
checklist met, before its STATUS box is ticked. Provider-key- and running-app-dependent checks (a
live nested mission ≥ 2 levels, both-theme + keyboard walks of the nested org chart / mission board,
a real budget-exhaustion mid-tree, the cycle-reject UX) are **owner-acceptance** — tracked in
[`STATUS.md`](./STATUS.md)'s *Owner acceptance* section, never faked. The orchestrator (see
[`kickoff-prompt.md`](./kickoff-prompt.md)) runs the plan with parallel worktree sub-agents.
