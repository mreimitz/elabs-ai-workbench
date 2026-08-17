# WP 4.3 — Mission board & topology hierarchical trace

**Phase:** 4 — UI · **Size:** L · **Depends on:** 3.1 · **Model:** Sonnet

## Objective

Make the web mission board genuinely hierarchical. `reconstructMissionBoard`
(`MissionBoard.tsx:157`) stops assuming one flat mission per event log and instead reconstructs a
**tree** of `MissionBoardView`s from the additive parent-linkage fields WP 3.1 lands on the board
events (D-CN7), so a crew-ref slot's own sub-mission renders as a nested board with its own
topology, agents, and rolled-up cost/timing (D-CN2/D-CN5). The topology graph, the mission-board
detail surfaces, the expand modal, and the pre-run plan card each grow a distinct sub-crew case —
drill-in via a recursively-nested `MissionExpandDialog`, never a route (D-CN8) — so an operator can
see and navigate a whole org tree (Chief Agent → Strategy Crew → Business-Intelligence sub-crew)
exactly as deep as it actually ran.

## Why / references

- **D-CN2** — a nested crew runs as its own sub-mission; its synthesised answer is projected into
  ONE stamped `HubAgentReport` returned through the existing `HubAgentRunResult` channel, so every
  topology (and this WP's board) stays agnostic about whether a slot was a leaf agent or a whole
  sub-crew (`orchestrator.ts` `runSlot:707-758`/`runOneAgent:840`/`projectTranscriptToReport:1498`).
- **D-CN5** — the wire fields this WP reads/renders: `HubAgentReport.subMissionId?`/`topology?`/
  `childReports?` (`types.ts:5479`, the `hubGenUiNodeSchema` `z.lazy` precedent) and
  `HubPlannedAgent.crewId?` (`types.ts:5729`) on the pre-run plan.
- **D-CN7** — event-sourced hierarchy: parent-linkage is added additively to `agent_spawned`/
  `plan_proposed` (`types.ts:6286-6319`); **both** the API `missions/board.ts` reducer (WP 3.1) and
  this WP's **web** `MissionBoard` reducer become tree-aware — they are independent, the web one is
  not the wire (ui map §2).
- **D-CN8** — brand-ui only, both themes; a sub-crew *profile* drill is route reuse (out of this
  WP's scope — WP 4.1/4.2); a mission-board drill into a child sub-mission is a **transient nested
  dialog, not a route**.
- **ui-surfaces map §2 ("heaviest lifts" #2)** — `MissionBoard.tsx` (`reconstructMissionBoard:157`,
  `missionBoardToTopoInput:300-316`), `topology-graph.ts` (`deriveTopologyGraph:225-299`,
  `TopoGraphInputAgent`/`TopoGraphNode`), `TopologyGraph.tsx` (`toReactFlow`), `MissionAgentNode.tsx`
  (the rich mission-variant agent card), `MissionPlanCard.tsx` (`plan.agents.map:283-296`),
  `MissionExpandDialog.tsx` (`nodeIds:85-89`, `NodePanel:175`), `AgentTranscript.tsx` (reused
  unchanged per leaf — loading-states rule: "do not hand-roll a second streaming path").

## Design

### 1. `reconstructMissionBoard` becomes a tree reducer (`MissionBoard.tsx`)

Today's function scans the whole event array for the LAST `plan_proposed` to pick `missionId`, then
filters the SAME flat array by `event.missionId === missionId` (L157-246). For a nested tree, one
session's event log carries **multiple** `missionId`s — the root's own events plus every descendant
sub-mission's own `plan_proposed`/`agent_spawned`/`agent_report`/`mission_synthesis` stream
(D-CN6: every mission in a tree keeps `session_id` = the root chat session, so they all land in one
log). Refactor:

1. Partition `events` into `eventsByMission: Map<string, HubEvent[]>` in one pass (stable log
   order preserved per mission).
2. Root selection stays "the last `plan_proposed`" but now **root-scoped**: only consider a
   `plan_proposed` whose WP-3.1 parent-linkage field is **absent** (confirm the exact field name —
   e.g. `parentMissionId`/`parentAgentKey` — against the real `HubPlanProposedEvent`/
   `HubAgentSpawnedEvent` shape in `packages/shared/src/types.ts` once WP 3.1 has landed; do not
   guess it here). This is a no-op on every existing flat fixture (no field ⇒ every `plan_proposed`
   already qualifies), so today's selection behavior is unchanged byte-for-byte.
3. Hoist the existing single-mission body (phase/approved/agents/pendingApprovals/synthesis/
   followups derivation, today's L173-246) into a pure helper
   `buildMissionNode(missionId, eventsByMission, visited): MissionBoardView`, reading
   `eventsByMission.get(missionId) ?? []` instead of the whole array — otherwise unchanged.
4. After building a mission node's flat `agents[]`, for each `MissionBoardAgentView` that is a
   sub-crew slot — resolve it primarily via the parent-linkage back-reference (some other
   `missionId`'s `plan_proposed`/`agent_spawned` naming this agent as its parent, so a **running**
   sub-crew shows up before it reports), falling back to the settled `agent.report?.subMissionId`
   once reported — recurse `buildMissionNode(childMissionId, eventsByMission, visited)` and attach
   the result as a new `MissionBoardAgentView.childBoard?: MissionBoardView` field (a plain
   recursive TS type; `MissionBoardView` is web-local, not `packages/shared`, so this is a type
   widening, not a wire change).
5. **Cycle guard (defensive, mirrors D-CN4's belt-and-suspenders posture web-side):** `visited` is a
   `Set<string>` of mission ids on the current recursion path. If `childMissionId` is already in
   `visited`, or the recursion depth exceeds a small constant (e.g. 8 — well above
   `HUB_MISSION_MAX_DEPTH`'s realistic values), stop and leave `childBoard` undefined rather than
   looping — a malformed/adversarial event log must never hang or crash the tab. The authoritative
   cycle/depth guard stays server-side (D-CN4); this is a client-side backstop only.
6. `reconstructMissionBoard(events)` returns `buildMissionNode(rootMissionId, eventsByMission, new Set())`.

**Per-level cost/timing roll-up.** `MissionBoardView` gains
`rollup: { costUsd: number; costKnown: boolean; startedAt?: string; endedAt?: string }`, computed in
`buildMissionNode` *after* child recursion: start from today's `spentSoFar`/`spentKnown` derivation
(sum of `agent.costUsd` over reported agents at this level) and for a sub-crew agent whose own
`agent.costUsd` is still undefined (its parent `agent_report` hasn't landed yet) but has a resolved
`childBoard`, fall back to `childBoard.rollup.costUsd` — so a live sub-crew's running spend shows up
before it settles, and the settled per-slot number (mirrored onto the parent event, the WP2.4
precedent) wins once available. Timing follows the same shape (earliest `spawnedAt` /
latest `reportedAt` across this level + resolved children).

### 2. Topology graph + node — a sub-crew case (`topology-graph.ts`, `TopologyGraph.tsx`, `MissionAgentNode.tsx`)

Chose **drill-in over nested `FlowGroupNode`**: D-CN8 mandates a transient dialog for the
mission-board sub-mission drill (not a route, not an inline nested canvas), and the heavier
box-in-box nested-group layout is WP 4.2's exclusive job over `org-model.ts` (a different,
disjoint file/surface — the org CHART, not the mission RUN trace).

- `TopoGraphInputAgent` / `TopoGraphNode` gain an additive `isCrew?: boolean` (+ optional
  `memberCount?: number`) — a separate flag from `kind` (which stays the existing eyebrow TEXT,
  e.g. "Agent"/"Stage 1"/"Attempt 2"; do not conflate the two). `toNode()` threads it through
  unchanged for every topology shape (`deriveTopologyGraph`'s parallel/pipeline/best_of_n paths and
  `deriveDebateGraph`).
- `MissionBoard.tsx`'s `missionBoardToTopoInput` (the sole place that turns `board.agents` into
  `TopoGraphInput`) sets `isCrew: agent.childBoard !== undefined || agent.report?.subMissionId !== undefined`
  and `memberCount: agent.childBoard?.agents.length`. `MissionExpandDialog.tsx` already calls this
  same function, so it gets the flag for free — no duplicate derivation.
- `TopologyGraph.tsx`'s `toReactFlow` passes `isCrew`/`memberCount` into the `missionAgent` node's
  `data` (additive fields on `MissionAgentNodeData`).
- `MissionAgentNode.tsx`: when `data.isCrew`, swap the avatar slot for a small crew glyph badge
  (`Users`/`Network` from `lucide-react`, matching `MissionPlanCard`'s existing `Users` import) and
  show the member count under the title (e.g. "4 agents") instead of the model subtitle; status
  ring/dot logic (driven by `state`) is unchanged — a sub-crew node still reads waiting/active/
  reported/missing exactly like a leaf agent.

### 3. `MissionExpandDialog.tsx` recurses (dialog-within-dialog)

`NodePanel`'s routing (agent → synthesis → judge) gains a fourth branch: when the selected agent's
`childBoard` is resolved, render a new `SubCrewNodePanel` instead of `AgentNodePanel`:

- A summary: topology badge (`TOPOLOGY_LABEL`), "N of M agents reported", and the cascading budget
  line (`childBoard.rollup` against `childBoard.plan.budgets?.maxCostUsd`, same `fmtUsd`/`Progress`
  pattern `MissionBoard.tsx` already uses for the top-level meter).
- A labeled `Button` ("Open sub-crew board", not icon-only — D-TB5's `IconButton` rule governs
  icon-only controls, this one carries text) that opens local state (`nestedOpen`), rendering:

  ```tsx
  <MissionExpandDialog
    board={agent.childBoard}
    {...(roleLookup ? { roleLookup } : {})}
    open={nestedOpen}
    onOpenChange={setNestedOpen}
  />
  ```

  — the component renders **itself**, so a grandchild sub-crew (depth 3+) recurses again for free,
  bounded by however deep the actual tree is (the server's `HUB_MISSION_MAX_DEPTH` already caps it;
  this WP adds no separate client-side depth cap beyond the reducer's defensive cycle guard above).
- Radix `Dialog` supports a stacked/nested open dialog (each portals independently; ESC closes the
  innermost first) — this is the first place in the app that nests one `Dialog` inside another's
  content, so give it a specific manual check in both themes (focus trap ordering, ESC/close
  behavior) rather than assuming it "just works" from other single-dialog call sites.

### 4. `MissionPlanCard.tsx` — nested plan rows (pre-run preview)

`HubMissionPlan.agents` **stays flat per level** (D-CN2) — nesting here means each `<li>` in the
existing flat `plan.agents.map` (L283-296) renders one of two row shapes depending on
`agent.crewId`, interleaved in original order (no DOM tree needed):

- `agent.crewId` absent → today's `PlannedAgentCard`, unchanged.
- `agent.crewId` present → a new `PlannedCrewCard`: crew name/icon (resolved via a new `crewLookup`
  prop, see below), a nested `TopologyGraph variant="plain"` preview sized smaller (e.g. `h-40`)
  built by a small local helper `crewPreviewTopoInput(crew, roleLookup)` (idle-state placeholder
  nodes from `crew.members`, mirroring `CrewEditor.tsx`'s existing `crewFormToTopoInput` pattern —
  read it for the shape, do not import it; that file is WP 4.1's exclusive scope), member count
  badge, and `summarizeBudgets(agent.budgets)` (the existing helper — a crew-ref slot's allocated
  budget rides the SAME `HubPlannedAgent.budgets` field every slot already has, no new field). The
  "Edit access" grant editor (`AgentGrantsDialog`) stays **agent-only** — do not offer it for a
  crew-ref slot; nested-grant editing isn't designed yet and is out of this WP's scope. Cap the
  preview at **one level**: a nested crew's own `crewId` members render as a generic "Sub-crew"
  placeholder chip rather than recursing the static preview further (full recursive drill only
  happens at RUN time, via `MissionExpandDialog`).

**`crewLookup` plumbing** (mirrors the existing `roleLookup` wiring exactly):
- `lib/mission-agent-icon.ts` gains `MissionCrewLookup = Map<string, HubCrew>` and
  `buildMissionCrewLookup(crews: readonly HubCrew[]): MissionCrewLookup` (a plain id-keyed map —
  simpler than `MissionRoleLookup`'s two-map shape since a crew slot is always addressed by id,
  never resolved by name).
- `AssistantView.tsx` adds `useLoadable<HubCrew[]>(() => listHubCrews(), [])` (the existing,
  unchanged `GET /api/hub/crews` — `listHubCrews` in `lib/api.ts:2455` already exists; no wire
  change) alongside the existing `rolesState` fetch, builds `crewLookup` via
  `buildMissionCrewLookup`, and threads it into `ConversationPane`.
- `ConversationPane.tsx` gains an optional `crewLookup?: MissionCrewLookup` prop (same
  `{...(x ? {x} : {})}` optional-spread convention the file already uses for `roleLookup`) and
  passes it to `MissionPlanCard` only (`MissionBoard`/`MissionExpandDialog` need no saved-crew
  lookup — at run time the live `childBoard` already carries the real topology/agents/rollup, no
  library lookup needed).

## Files

- `apps/web/src/features/hub/MissionBoard.tsx` *(modify)* — tree-aware `reconstructMissionBoard`
  (event partition, root selection, recursive `buildMissionNode`, cycle guard), new
  `MissionBoardAgentView.childBoard?`/`MissionBoardView.rollup` fields, `missionBoardToTopoInput`
  sets `isCrew`/`memberCount`, `WaitingAgentRow`/`MissionAgentStatusTab` show a compact
  sub-crew/cascading-budget line when `childBoard` is present.
- `apps/web/src/features/hub/topology-graph.ts` *(modify)* — `TopoGraphInputAgent`/`TopoGraphNode`
  gain `isCrew?`/`memberCount?`, threaded through `toNode`/`deriveTopologyGraph`/`deriveDebateGraph`.
- `apps/web/src/features/hub/TopologyGraph.tsx` *(modify)* — `toReactFlow` passes `isCrew`/
  `memberCount` into the `missionAgent` node's `data`.
- `apps/web/src/features/hub/MissionAgentNode.tsx` *(modify)* — sub-crew card variant (badge +
  member count) on `data.isCrew`; status ring/dot logic unchanged.
- `apps/web/src/features/hub/MissionExpandDialog.tsx` *(modify)* — `NodePanel` gains a
  `SubCrewNodePanel` branch that recursively renders a nested `MissionExpandDialog`.
- `apps/web/src/features/hub/MissionPlanCard.tsx` *(modify)* — flat `plan.agents.map` branches per
  row on `agent.crewId`; new `PlannedCrewCard` + local `crewPreviewTopoInput` helper; new
  `crewLookup?: MissionCrewLookup` prop.
- `apps/web/src/features/hub/lib/mission-agent-icon.ts` *(modify)* — add `MissionCrewLookup` /
  `buildMissionCrewLookup`, mirroring `MissionRoleLookup`/`buildMissionRoleLookup`.
- `apps/web/src/features/hub/ConversationPane.tsx` *(modify)* — new optional `crewLookup` prop,
  threaded to `MissionPlanCard` only.
- `apps/web/src/features/hub/AssistantView.tsx` *(modify)* — fetch crews (`listHubCrews` via
  `useLoadable`), build `crewLookup`, pass to `ConversationPane`.
- `apps/web/src/features/hub/Mission.test.tsx` *(modify)* — new `reconstructMissionBoard` nested-tree
  tests (2+ levels, cycle-guard, rollup roll-up).
- `apps/web/src/features/hub/MissionExpandDialog.test.tsx` *(modify)* — nested drill-in test.
- `apps/web/src/features/hub/MissionPlanCard.test.tsx` *(modify)* — nested `PlannedCrewCard` row test.
- `apps/web/src/features/hub/topology-graph.test.ts` *(modify)* — `isCrew` flag unit test.

## Acceptance

- [ ] `reconstructMissionBoard` partitions the event log by `missionId` and recursively attaches a
      sub-crew slot's own sub-mission as `MissionBoardAgentView.childBoard`; every existing
      (flat, non-nested) fixture in `Mission.test.tsx` reconstructs unchanged.
- [ ] A synthetic 2-level fixture (root plan + one `crewId`-bearing slot whose own sub-mission
      events are appended to the same log) reconstructs a board whose matching agent's
      `childBoard` has the sub-mission's own phase/agents/synthesis.
- [ ] A synthetic cyclic/over-deep fixture does not hang, crash, or stack-overflow the reducer — it
      renders with `childBoard` left undefined past the guard.
- [ ] `MissionBoardView.rollup` sums a 2-level fixture's spend correctly (root's own reported agents'
      cost + the nested sub-mission's own rolled-up cost).
- [ ] `missionBoardToTopoInput` marks a sub-crew slot's node `isCrew: true`; `MissionAgentNode`
      renders the member-count badge instead of `RoleAvatar` for that node, and every plain
      (non-crew) node's render is byte-for-byte unchanged.
- [ ] `MissionExpandDialog`'s `NodePanel` shows a `SubCrewNodePanel` for a `childBoard`-bearing node
      with an "Open sub-crew board" control; clicking it renders a second, nested
      `MissionExpandDialog` scoped to `childBoard`, and that nested dialog shows the child's own
      topology graph/agents (test-covered).
- [ ] `MissionPlanCard` renders a `crewId`-bearing planned unit as `PlannedCrewCard` (nested
      topology preview + member count + budget), interleaved in the existing flat list; a plan with
      no `crewId` members renders byte-for-byte unchanged; the "Edit access" control is never shown
      for a crew-ref row.
- [ ] `AssistantView`/`ConversationPane` thread the new `crewLookup` through to `MissionPlanCard`
      only, mirroring the existing `roleLookup` wiring; `MissionBoard`/`MissionExpandDialog` need no
      new lookup prop.
- [ ] Every LEAF agent node, at any nesting depth, still streams through the single existing
      `AgentTranscript` component — no second streaming implementation introduced.
- [ ] brand-ui only; both themes (`light`/`dark`) checked by inspection for the new
      sub-crew badge/card, the cascading budget line, and the nested dialog; the new "Open sub-crew
      board" button is a labeled `Button` (not an icon-only control, so D-TB5's `IconButton` rule
      doesn't newly apply here — verify no icon-only control was added without it).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes

- **Depends on 3.1**: this WP reads the WP-3.1 parent-linkage field name off the real
  `HubPlanProposedEvent`/`HubAgentSpawnedEvent` shape in `packages/shared/src/types.ts` at claim
  time — do not start until 3.1 has landed and do not guess the field name from this spec.
- **Parallel-safety**: this WP's files (`MissionBoard.tsx`, `topology-graph.ts`,
  `TopologyGraph.tsx`, `MissionAgentNode.tsx`, `MissionExpandDialog.tsx`, `MissionPlanCard.tsx`,
  `lib/mission-agent-icon.ts`, `ConversationPane.tsx`, `AssistantView.tsx`) are disjoint from WP
  4.1's (`workforce/crew-profile/MembersSection.tsx`, `crew-profile-form.ts`,
  `agents/CrewEditor.tsx`) and WP 4.2's (`workforce/OrgRail.tsx`, `workforce/CrewCard.tsx`,
  `workforce/DirectoryTab.tsx`, `workforce/org-chart/*`) — per `STATUS.md`'s parallel-safety table,
  `{3.2, 4.1, 4.2, 4.3}` may batch together. Double-check `ConversationPane.tsx`/`AssistantView.tsx`
  against the sibling WPs' actual diffs at batch time regardless (both are large, frequently-touched
  files) before assuming zero overlap.
- **No client-side depth cap**: the reducer's cycle guard is a defensive backstop only
  (D-CN4's belt-and-suspenders posture applied web-side); the authoritative
  `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS` enforcement is server-side (WP 0.1-2.2) and
  this WP does not re-implement or re-check it.
- **`AssistantView.test.tsx`**: the new unmocked `listHubCrews()` call mirrors the existing unmocked
  `listHubAgentRoles()` fetch (already exercised in that test file via `useLoadable` without an
  explicit mock) — expected to need no test changes, but confirm at implementation time; add a
  `vi.mocked(api.listHubCrews).mockResolvedValue([])` only if a test actually flakes.
- **Not in scope**: the org rail/chart's nested `FlowGroupNode` rewrite (WP 4.2), the crew editor's
  sub-crew add path + author-time cycle warning (WP 4.1), and any change to
  `packages/shared`/API — this WP is web-local plumbing over WP 3.1's event contract plus a
  `MissionBoardView` (web-only type) shape change.
