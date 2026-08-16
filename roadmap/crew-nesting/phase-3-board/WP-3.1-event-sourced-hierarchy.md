# WP 3.1 — Event-sourced hierarchy (API side): parent-linkage events + tree-aware board reducer

**Phase:** 3 — Board, replay & reporting · **Size:** L · **Depends on:** 2.1 · **Model:** Opus

## Objective
Make a nested-tree mission **reconstructible from `hub_events` alone** (R-SES1 / D-CN7). Add **additive optional** parent-linkage fields (`parentMissionId` / `parentAgentKey`) to the `plan_proposed` and `agent_spawned` events in `packages/shared`, emit them at the nested sub-mission spawn sites WP 2.1 introduced in `orchestrator.ts`, and rewrite the API board reducer `reconstructMission` ([`board.ts:52`](../../apps/api/src/hub/missions/board.ts)) to be **tree-aware**: `MissionBoardAgent` gains `children`, and cost/completion roll up per level (a crew node's cost = the sum of its sub-mission's leaf agents). A test proves a 2-level tree reconstructs purely from the persisted event log with no service and no DB writes. This is the API half only — the web `MissionBoard` reducer stays untouched here (that is WP 4.3).

## Why / references
- **D-CN7** — hierarchy is event-sourced; parent-linkage is added *additively* to `agent_spawned` / `plan_proposed`; the API `board.ts` reducer becomes tree-aware; cost/timing roll up per level. R-SES1 (replay from events alone) is preserved.
- **D-CN6** — every mission in a tree keeps `session_id = the root chat session`, so **all** nested sub-missions' events land in the **one** root chat session log; the mission tree is expressed only by `parent_mission_id` / the new event linkage. A sub-mission row is born inside the recursion engine, **never** via `proposePlan` — the `kind:'chat'` propose gate stays as-is (D-CN1).
- **D-CN5** — contract stays additive on versionless `/api`; the two new event fields are `.optional()` ⇒ no `/api/v2`, every existing event still validates.
- Wire types: `HubPlanProposedEvent` ([`types.ts:6286`](../../packages/shared/src/types.ts)), `HubAgentSpawnedEvent` ([`types.ts:6310`](../../packages/shared/src/types.ts)), `HubAgentReportEvent` (already carries `costUsd`/`tokensIn`/`tokensOut` — WP2.4, [`types.ts:6320`](../../packages/shared/src/types.ts)).
- Wire schemas: the `plan_proposed` branch ([`schemas.ts:3950`](../../packages/shared/src/schemas.ts)) and `agent_spawned` branch ([`schemas.ts:3973`](../../packages/shared/src/schemas.ts)) of `hubEventSchema`'s `discriminatedUnion`.
- Reducer: `reconstructMission` + `MissionBoardAgent` + `MissionBoardState` ([`board.ts:21`/`:34`/`:52`](../../apps/api/src/hub/missions/board.ts)); re-exported from [`missions/index.ts:68`](../../apps/api/src/hub/missions/index.ts). The board reducer is **not** a wire response type (the web board reconstructs independently — board.ts:5); adding `children` is safe internal-additive.
- Emission sites: root `plan_proposed` at [`orchestrator.ts:405`](../../apps/api/src/hub/missions/orchestrator.ts); root `agent_spawned` at [`orchestrator.ts:688`](../../apps/api/src/hub/missions/orchestrator.ts). WP 2.1's **nested** spawn sites (the sub-mission's `plan_proposed` + per-member `agent_spawned`, emitted into `mission.sessionId` = the root chat session) are the ones this WP stamps with parent-linkage.
- Existing replay lock to keep green: `hub-missions.test.ts:807` ("the whole mission replays INERT from hub_events alone").

## Design

### 1. Shared — two additive optional fields on each event (contract-first)
Add to **both** `HubPlanProposedEvent` and `HubAgentSpawnedEvent`:
- `parentMissionId?: string` — the mission id of the **parent** mission this event's mission descends from. Absent on the root mission's events; present on every sub-mission's events.
- `parentAgentKey?: string` — the `key` of the parent mission's **crew-node** planned agent (the slot carrying `crewId`) that expanded into this sub-mission. Present iff `parentMissionId` is present.

Mirror the fields into the matching `hubEventSchema` branches as `z.string().optional()`. Because both are optional, every pre-existing event (and the whole existing test corpus) still validates — no `/api/v2`, no migration (events ride the append-only log; `plan`/`report` blobs are unchanged).

> These are **derived-linkage** fields, not a new event type. `agent_spawned` already carries its own `missionId` (the node it belongs to); `parentMissionId`/`parentAgentKey` additionally record that node's position in the tree so the reducer is robust to event ordering. The load-bearing linkage lives on `plan_proposed` (it names the sub-mission's parent + the crew-node slot); the same pair on `agent_spawned` is the belt-and-suspenders mirror.

### 2. Orchestrator — stamp the nested spawn sites (WP 2.1's sites)
Root-level emissions (`orchestrator.ts:405`, `:688`) stay **exactly as they are** — no `parentMissionId` ⇒ they read as the root. At the **nested** sub-mission spawn path WP 2.1 added (where a crew-ref slot expands into its own `runTopology` and materialises a child `hub_missions` row + per-member child sessions, all logged into `mission.sessionId`), pass:
- on the sub-mission's `plan_proposed`: `parentMissionId = <parent mission id>`, `parentAgentKey = <the parent crew-node planned agent's key>`;
- on each member's `agent_spawned`: the same `parentMissionId` / `parentAgentKey`.

Also emit an `agent_spawned` for the **crew-node slot itself** in the parent mission (roleName = the crew's label), keyed by the crew-node planned agent's `key`, so the reducer has a top-level agent node to graft the sub-mission's members under. (If WP 2.1 already emits this crew-node spawn, only add the linkage on the *sub-mission* events; do not duplicate it.) Do **not** touch `proposePlan`'s `kind==='chat'` gate ([`orchestrator.ts:330`](../../apps/api/src/hub/missions/orchestrator.ts)) — sub-missions are still born only inside the recursion engine (D-CN1/D-CN6).

### 3. `board.ts` — tree-aware reducer
Rewrite `reconstructMission` to reconstruct the whole tree from the root session's event log:

1. **Root identity (correctness fix).** Today the reducer picks the *latest* `plan_proposed`'s `missionId`. With sub-missions now emitting `plan_proposed` into the same log, that would pick a nested mission. Change it to: the root is the **latest `plan_proposed` whose `parentMissionId` is undefined** (preserves the "re-propose after a terminal mission" semantics for the root chat session). Return `undefined` if there is none.
2. **Collect mission nodes.** First pass over events building `Map<missionId, { plan, parentMissionId?, parentAgentKey? }>` from every `plan_proposed`/`plan_updated`. Compute the **tree membership set** = the root plus every mission whose `parentMissionId` chain transitively reaches the root (excludes a stale earlier root's sub-missions from a prior re-propose).
3. **Per-node state.** Second pass: apply each event to its own `event.missionId` node using the *existing* single-mission logic (phase proposed→approved→running→synthesizing/done, `approved`, `autoApproved`, `autonomy`, an `agents` map keyed by `agentSessionId`, `synthesis`). Only events whose `missionId` is in the tree membership set are applied.
4. **Assemble the tree.** For each non-root node `M` (deepest-first, so grandchildren attach before `M` is grafted): find `parent = nodes.get(M.parentMissionId)`; find the crew-node agent `pa = parent.agents` entry whose `key === M.parentAgentKey`; set `pa.children = orderedAgents(M)` and `pa.subMissionId = M.missionId`. A crew node is marked `reported: true` once `M` reaches its own `mission_synthesis` (mirroring how a leaf agent is `reported` on its `agent_report`); its own projected `report` (from the parent-log `agent_report` WP 2.1 stamps) still populates `pa.report`. Guard the deref: a missing `pa` is a replay defect the test catches, not a silent drop or crash.
5. **`MissionBoardAgent` additive fields:** `children?: MissionBoardAgent[]`, `subMissionId?: string`, and `costUsd?: number` (sourced from the agent's `agent_report.costUsd`, already in the log per WP2.4).
6. **Per-level roll-up.** Cost rolls up bottom-up: a **leaf** agent's rolled cost = its own `agent_report.costUsd ?? 0`; a **crew node**'s rolled cost = `sum(children rolled costs)` — deliberately **ignoring** the crew-node's own projected `agent_report.costUsd` (WP 2.1 stamps that with the full sub-mission total, so summing both would double-count). Store the rolled value on the node so the tree total = the sum of all leaf costs, consistent and entirely event-derived. Completion/phase "timing" is per-node: each sub-mission node keeps its own phase from its own events, grafted onto the crew node's `reported` flag.
7. Return the **root** node's `MissionBoardState` (`missionId` = root id, `plan` = root plan, `agents` = the root agents with crew nodes now carrying `children`). A **flat** legacy mission (no parent-linkage anywhere) reconstructs to exactly today's shape — every agent a leaf, no `children`, no behavioural change.

Keep the function **pure / side-effect-free / deterministic** (R-SES1); `isMissionBoardTerminal` is unchanged.

## Files
- `packages/shared/src/types.ts` *(modify)* — add `parentMissionId?`/`parentAgentKey?` to `HubPlanProposedEvent` and `HubAgentSpawnedEvent` (with doc comments).
- `packages/shared/src/schemas.ts` *(modify)* — add the two `.optional()` fields to the `plan_proposed` and `agent_spawned` branches of `hubEventSchema`.
- `apps/api/src/hub/missions/board.ts` *(modify)* — tree-aware `reconstructMission`; `MissionBoardAgent` gains `children?`/`subMissionId?`/`costUsd?`; parent-aware root detection; per-node grouping; per-level cost/completion roll-up.
- `apps/api/src/hub/missions/orchestrator.ts` *(modify)* — pass `parentMissionId`/`parentAgentKey` at WP 2.1's nested sub-mission `plan_proposed` + per-member `agent_spawned` emissions; ensure the parent crew-node slot emits its own `agent_spawned`. Root emissions unchanged; propose gate untouched.
- `apps/api/test/hub-crew-nesting-board-replay.test.ts` *(create)* — build a **2-level** tree of events by hand (root `plan_proposed` + root `agent_spawned`s incl. a crew node + sub-mission `plan_proposed` with `parentMissionId`/`parentAgentKey` + sub-mission `agent_spawned`s + both `agent_report`s + sub `mission_synthesis` + root `mission_synthesis`), feed the raw array to `reconstructMission`, and assert the reconstructed tree, `children`, per-level cost roll-up, crew-node completion, determinism, and inertness — **no service, no DB writes**.

## Acceptance
- [ ] `HubPlanProposedEvent` and `HubAgentSpawnedEvent` each carry optional `parentMissionId` + `parentAgentKey`; the matching `hubEventSchema` branches accept and preserve them; an event object with neither field still parses (existing events unaffected).
- [ ] `reconstructMission` selects the root as the **latest `plan_proposed` with no `parentMissionId`** — a log where sub-missions emit later `plan_proposed`s does **not** cause a nested mission to be returned as the board.
- [ ] `MissionBoardAgent` exposes `children?`, `subMissionId?`, `costUsd?`; a crew-node agent's `children` are the sub-mission's member agents (recursively), grafted by matching `parentAgentKey === crewNode.key`.
- [ ] Per-level cost roll-up holds: a crew node's rolled cost equals the **sum of its subtree leaf agents' `agent_report.costUsd`**, and the crew node's own projected report cost is **not** double-counted; the whole-tree total equals the sum of all leaf costs.
- [ ] A 2-level tree reconstructs **purely from the `hub_events` array** (the new test) — deterministic (`deepEqual` across two calls) and inert (event count unchanged).
- [ ] A **flat** legacy mission (no parent-linkage) reconstructs to today's exact shape — the existing `hub-missions.test.ts:807` replay test stays green with no edit.
- [ ] `orchestrator.ts` stamps `parentMissionId`/`parentAgentKey` only at the nested sub-mission spawn sites; root `plan_proposed`/`agent_spawned` emissions and the `proposePlan` `kind==='chat'` gate are unchanged.
- [ ] The web `MissionBoard` reducer and any `apps/web` file are **not** modified (deferred to WP 4.3).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **Parallel-safety:** touches `packages/shared` (a mild additive shared touch — coordinate; the high-blast-radius shared WP 0.1 is long done) plus `orchestrator.ts` and `board.ts`. `board.ts` is disjoint from the read-only review WP **2.R**, so per the README build-order step 7 this WP **may batch with 2.R**. It must **not** run concurrently with any other `orchestrator.ts` writer (2.2/2.3 are sequenced before it via the 2.1 dependency); its `orchestrator.ts` edits are confined to the nested emission calls WP 2.1 created.
- **Sequencing:** depends on **2.1** — the nested sub-mission spawn path (child `hub_missions` rows + per-member sessions logged into the root chat session) must already exist; this WP only *adds parent-linkage to those emissions* and makes the reducer read them. If 2.1's nested crew-node does not yet emit its own `agent_spawned`, add it here (the reducer needs a top-level node to graft under).
- **Frozen boundaries:** additive-only wire (no `/api/v2`), no DB migration, no new dependency; every widened deref (crew-node lookup by `parentAgentKey`) is guarded; `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope` and the propose gate are untouched (D-CN9/D-CN1).
- **Stub-tested, no live run:** the replay test constructs the event array directly, so it needs no provider key and contacts no model — the reducer's tree fidelity is provable in isolation.
