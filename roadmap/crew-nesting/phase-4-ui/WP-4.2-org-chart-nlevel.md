# WP 4.2 — Org rail & org chart go N-level (recursive crews)

**Phase:** 4 — UI · **Size:** L · **Depends on:** 1.1 · **Model:** Sonnet

## Objective

The workforce "Organization" surface (`OrgRail`, `CrewCard`/`CrewHeaderCard`, `DirectoryTab`, the
org-chart canvas) is built entirely on the assumption that a crew's `members[]` are all agents. WP
0.1/1.1 let a member be a saved **sub-crew** (`crewId`) instead of an agent (`agentId`); this WP
implements the D-CN8 UI consequence: the org rail becomes an N-level expandable tree, the org-chart
canvas draws nested crew-in-crew groups, and every membership/count computation becomes
**recursive and cycle-safe**, so an operator can see "Chief Agent → Strategy Crew → {Analyst,
Intelligence sub-crew}" instead of a flattened, misleading member list.

## Why / references

- **D-CN8** (the decision this WP implements) — org rail/chart go N-level; counts become
  "N agents, M crews (T total)" with a cycle-safe visited set; every member-render site branches on
  kind; depth cue = semantic tokens only; sub-crew profile drill = route reuse
  (`/assistant/agents/crew/:crewId`, already the crew profile route — no new `<Route>`, so no
  `ASSISTANT_ROUTE_MANIFEST` change).
- **D-CN4** — the two-layer author-time + run-time cycle/depth guard means the *data* should never
  contain a cycle by the time it reaches the UI, but "the graph can mutate between save and run"
  (conventions.md) — this WP's own cycle-safe rendering is a **third, defensive** layer: it must
  never hang or crash on a malformed/stale fetch, only ever a loud, contained placeholder.
- **D-CN5 / D-CN9** — `HubCrewMember.agentId` widens to optional, `crewId?` is added (WP 0.1); this
  WP is exactly the "~12 UI sites" conventions.md flags that must guard every `member.agentId`
  deref. No security/scope code is touched (`ASSISTANT_ENTITY_KINDS` etc. are untouched, per D-CN9 —
  nothing in this WP is scope-relevant).
- File anchors (this WP's own files, verified against the live code):
  `apps/web/src/features/hub/workforce/OrgRail.tsx` (`assignedRoleIds` L182–188, `DragAgent` L119,
  crew branch count/label L407–408, member resolution L449–463, `BranchRow` L599, `AgentRow` L701,
  `TreeChildren` L580–590), `CrewCard.tsx` (member resolution L27–29, count badge L51–53, avatar
  strip L73–96), `DirectoryTab.tsx` (`assignedRoleIds` L145–153, `crewsByRoleId` L154–165,
  `scopedCrewMembers` L167–173), `CrewHeaderCard.tsx` (its only call site, L59), `org-chart/org-model.ts`
  (`OrgNodeMeta` L41–65, `crewLane` L140–201, `packLanes` L281–299, `buildOrgChartModel` L312–388),
  `org-chart/crew-layout.ts` (`crewMemberNodeId` L48–50, `buildCrewMemberLayout` L65–149),
  `org-chart/OrgChartTab.tsx` (`nodeNavigationTarget` L46–51, `OrgInspectorBody` L286–357,
  `OrgLegend` L369–402).
- Rules: `.claude/rules/brand-ui-only.md`, `styling-and-tokens.md` (reuse `crewAccentClasses` /
  `--chart-1…5`, no raw color for a nesting-depth cue), `icon-affordances.md` (`IconButton` for any
  new icon-only control), `routes-vs-dialogs.md` (sub-crew drill = existing crew-profile route).

## Design

### 1. New shared helper — `crew-membership.ts` (cycle-safe recursive closure)

`apps/api/src/hub/repository.ts`'s WP 1.1 resolution helper cannot be imported into `apps/web`
(architecture.md: no web→api source imports), so build an **independent, pure, client-side**
equivalent used by every surface below:

```ts
export type CrewClosure = { agentIds: Set<string>; crewIds: Set<string>; cyclic: boolean };
export function resolveCrewClosure(
  crewId: string,
  crewsById: Map<string, HubCrew>,
  memo = new Map<string, CrewClosure>(),
  visiting = new Set<string>(),
): CrewClosure
```

Algorithm: memoize per `crewId` (computed once, reused — mirrors 1.1's "memoised" helper); track a
`visiting` path-set; a member with `crewId` already in `visiting` is **not** recursed into again
(cycle) — it still counts as one crew reference and marks the closure `cyclic: true`, it just never
re-enters. A member with `crewId` pointing at nothing in `crewsById` (dangling/deleted crew) is
skipped from the count (mirrors today's `if (!role) return null` skip for a deleted role) but the
caller can still detect "unresolved" separately if needed for a placeholder row. Also export:

- `formatCrewMembershipCount(closure): string` → `"N agents"` when `crewIds.size === 0` (byte-for-byte
  today's plain count, **zero visible change for the common flat-crew case**), else
  `"N agents, M crews (T total)"`.
- `resolveCrewAgents(crewId, crewsById, rolesById)` → the closure's `agentIds` mapped to roles,
  unresolved ids dropped (feeds `scopedCrewMembers`/CrewCard's disambiguation, below).

This file has no React/`@elabs-ai/components-*` dependency — unit-testable in isolation, same posture as
`org-model.ts`/`crew-layout.ts`.

### 2. `OrgRail.tsx` — generalize the bespoke tree to N levels (extend, not migrate to `@elabs-ai/components-ui` `Tree`)

**Decision: extend the existing bespoke `BranchRow`/`AgentRow` recursively, adopting `@elabs-ai/components-ui`'s
exported `useTreeKeyboard` hook for keyboard parity, rather than migrating onto the `Tree`
component wholesale.** Reason (verified against `Tree`'s source,
`@elabs-ai/components-ui/src/components/tree/tree.tsx`): `Tree`'s row `onClick` **always** both selects *and*
toggles expand together (`handleRowClick`: `setActiveId → handleSelect → if (expandable)
toggleExpanded()`) — only the chevron sub-span calls `stopPropagation`. Today's rail deliberately
keeps select (scope change) and expand independent (a crew row can be scoped without expanding, and
vice versa — driven by the `?scope=` URL, not click position), plus a hover "+", a drag payload, and
a "⋯ move to crew" menu embedded in each row. Re-hosting all of that onto `Tree`'s row model would
be a rewrite with a real UX regression risk on the one behavior the plan says to **re-host, not
change**. `useTreeKeyboard` is exported standalone precisely for a custom tree UI that wants `Tree`'s
accessible roving-tabindex/type-ahead keyboard model without its row markup — use it here.

Changes:
- Add `crewsById = new Map(crews.map(c => [c.id, c]))` and a shared `closureMemo` (built once per
  render via `useMemo`, keyed off `data`), so every crew's `resolveCrewClosure` call reuses the memo.
- `assignedRoleIds` (L182–188): replace the direct `crew.members[].agentId` loop with, for every
  top-level crew, `resolveCrewClosure(crew.id, crewsById, closureMemo).agentIds` unioned in — an
  agent reachable only via a nested sub-crew is now "assigned" (D-CN8).
- Crew branch count (L407–408): replace `crew.members.length` with
  `formatCrewMembershipCount(resolveCrewClosure(crew.id, crewsById, closureMemo))`.
- Member render (L449–463): branch on kind. `member.agentId` → today's `AgentRow` unchanged (guard:
  `if (!member.agentId) …`). `member.crewId` → a **nested branch row**: if `member.crewId` is
  missing from `crewsById` → a disabled "(deleted crew)" leaf, same treatment as an unresolved role
  today; else recurse into a generalized `renderCrewBranch(childCrew, ancestorCrewIds)` — the SAME
  function used for top-level crews, called with `ancestorCrewIds` = the path of crewIds already
  rendered above it. If `ancestorCrewIds.includes(childCrew.id)` (cycle reached while walking down
  the render tree) → render a non-recursing placeholder row (`Badge variant="warning"` +
  `AlertTriangle`, "Circular reference — hidden to avoid a loop", non-interactive, self-describing
  so no extra `IconButton`/tooltip machinery is needed) instead of calling `renderCrewBranch` again.
  Add a defensive absolute cap (`ORG_RAIL_MAX_RENDER_DEPTH`, e.g. 8 — comfortably above
  `HUB_MISSION_MAX_DEPTH`'s default 2, never fires in normal operation) that renders the same
  placeholder if exceeded, so a non-cyclic but pathological chain still can't blow the tree.
- Expansion state: key nested branches by `crew:${crewId}` **exactly like today's top-level key**
  (not path-scoped) — the same crew expands/collapses consistently wherever it's rendered; simplest
  correct choice, and matches the `?scope=` codec already keying by bare crewId.
- Drag-reassign / inline "+" / "⋯ move to crew" (`DragAgent`, L119, `moveAgentToCrew`,
  `renderAgentRow`): **unchanged**, now simply reachable at any depth — `fromCrewId` is always the
  *immediate* containing crew (top-level or nested), and moving an *agent* can never create a crew
  cycle, so no new guard is needed on the move path itself.
- Wire `useTreeKeyboard({ nodes: <derived TreeNode<never>[] just for keyboard order>, expandedIds,
  onExpandedChange, selectionMode: "none", selectedIds: new Set(), onSelectionChange: () => {} })` on
  the rail's root `<div>` (`onKeyDown`, roving `activeId`/`registerNodeRef`) so arrow-key
  navigation/type-ahead works across arbitrary depth; existing per-row click semantics
  (select vs. expand) are untouched — the hook only adds keyboard traversal, it does not own click
  handling.

### 3. `CrewCard.tsx` / `CrewHeaderCard.tsx` / `DirectoryTab.tsx` — recursive counts + kind disambiguation

- **`CrewCard`**: widen props to `{ crew, roles, crews, className }` (`crews: HubCrew[]`, the full
  list — needed to resolve `crewId` members). Member resolution (L27–29): guard `member.agentId`
  before `roles.find`; the avatar strip stays **agent-only / direct-members** (a deliberate scope
  line — see Notes). Count badge (L51–53): replace `crew.members.length` with
  `formatCrewMembershipCount(resolveCrewClosure(crew.id, crewsById, memo))` so a crew with nested
  sub-crews shows an honest "8 agents, 1 crew (9 total)" instead of a misleading flat "4". Add a
  compact `Badge variant="outline"` row (below the avatar strip) listing each **direct** `crewId`
  member by name (e.g. "+ Business-Intelligence sub-crew") so the sub-crew relationship is visible
  without conflating a crew's identity into the agent avatar strip.
- **`CrewHeaderCard`**: widen props to also accept `crews: HubCrew[]` and thread it to `<CrewCard>`.
- **`DirectoryTab`**: build `crewsById`/closure memo once; `assignedRoleIds` (L145–153) and
  `scopedCrewMembers` (L167–173) both become recursive via `resolveCrewAgents` — the scoped crew's
  member grid now shows every agent reachable through the whole subtree, not just direct members
  (the natural complement of "D-CN8 recursive assignment"). Pass `crews={crews}` into
  `<CrewHeaderCard>` (its only call site, L255). **`crewsByRoleId`** (L154–165, feeds `AgentCard`'s
  cross-crew "stacked dots" in non-crew scopes) is **intentionally left as direct-membership** —
  see Notes.

### 4. Org-chart canvas — recursive box-in-box (`org-model.ts`, `crew-layout.ts`, `OrgChartTab.tsx`)

- **`crew-layout.ts`**: leave `buildCrewMemberLayout`'s existing signature and behavior **byte-for-byte
  unchanged** — it is also consumed by `CrewTopologyGraph.tsx` (crew-profile Topology section, out of
  this WP's scope; do not touch that file). Add a **new**, separate exported helper (e.g.
  `buildMixedMemberLayout(boxes: { nodeId, width, height, data, topologyRole }[], topology,
  direction)`) that does the same `layoutFlow` dagre pass `buildCrewMemberLayout` does, but over
  caller-supplied box sizes instead of assuming every member is `MEMBER_NODE_W × MEMBER_NODE_H`.
  Reuse `buildCrewTopologyEdges`/`memberTopologyRole` from `./topology-edges` unchanged — topology
  edges connect by **member position**, not member kind, so a `pipeline`/`parallel`/`debate`/
  `best_of_n` edge from an agent to a whole nested crew group (or group-to-group) needs no special
  casing there.
- **`org-model.ts`**: generalize `crewLane` (L140–201) into a recursive box builder taking
  `crewsById: Map<string, HubCrew>` and `ancestorCrewIds: readonly string[]`. For each member:
  `agentId` → today's leaf box (unchanged). `crewId` → resolve `crewsById.get(member.crewId)`;
  missing → a "(deleted crew)" placeholder box; `ancestorCrewIds.includes(member.crewId)` → a
  cyclic-reference placeholder box (same `ORG_CHART_MAX_RENDER_DEPTH` safety cap as OrgRail); else
  **recurse**: `crewLane(childCrew, rolesById, crewsById, [...ancestorCrewIds, crew.id])`, which
  returns its own `{ groupNode, children, edges, meta, width, height }` — feed `{width, height}` as
  this member's box size into `buildMixedMemberLayout`, then at the laid-out position: (a) place the
  child's `groupNode` with `parentId = <this crew's groupId>` and `position` = the dagre-assigned
  `{x, y}` (same `GROUP_PAD_X`/`GROUP_HEADER_H` offset convention `crewLane` already uses for agent
  children, L164–170); (b) pass through the child's own `children`/`edges`/`meta` **untouched** —
  `@xyflow`'s `parentId` chain composes nested-group positioning automatically across arbitrary
  depth, so no manual cross-level coordinate flattening is needed (the one load-bearing insight this
  WP relies on). Sizes compound naturally too: a nested crew's returned `width`/`height` already bake
  in *its own* header/padding, so it is simply "another box" in the parent's dagre pass — `packLanes`
  (L281–299, the TOP-level sibling-lane row-wrapper) needs **no code change at all**, it already only
  reads `Lane.width/height`.
  - Node ids: reuse `crewMemberNodeId(pathKey, index)` unmodified (it is pure string interpolation),
    just pass a **path-scoped** key (e.g. `` `${parentGroupId}>${crew.id}` ``) instead of a bare
    `crew.id` for a nested occurrence, so the same crew/agent appearing via two different nesting
    paths never collides on node id (each occurrence renders as its own node — no cross-path
    dedup/merge in this WP).
  - `OrgNodeMeta` (L41–65): add a `"sub-crew"` variant — same shape as `"crew"` plus
    `parentCrewId: string` — for a nested crew's group meta (top-level crew lanes keep `"crew"`
    unchanged). Add a `"cycle-warning"` / `"missing-crew"` meta variant (or fold both into one
    `{ kind: "placeholder"; reason: "cycle" | "missing"; label: string }`) for the non-recursing
    placeholder boxes.
  - `assignedIds` (L317, feeds the Unassigned lane): recursive via `resolveCrewClosure`, same as
    OrgRail/DirectoryTab.
  - Legend (`legendCrews`/`topologies` in `buildOrgChartModel`): collect from the **full** merged
    `meta` map (which now includes nested crew metas), not just `sortedCrews`, so a nested crew's
    color/topology shows in the legend even when only visible nested.
- **`OrgChartTab.tsx`**: `nodeNavigationTarget` (L46–51) — `"sub-crew"` navigates exactly like
  `"crew"` (`{ kind: "crew", id: meta.crewId }`, same `/assistant/agents/crew/:crewId` route reuse
  per D-CN8); the placeholder kind returns `null` (nothing to open). `OrgInspectorBody` (L286–357) /
  `inspectorTitle`: add a `"sub-crew"` body (identical to `"crew"`'s, plus a "Nested in
  `<parentCrewName>`" line) and a `"placeholder"` body explaining the cyclic/missing reference (no
  "Open profile" action). No route change (D-CN8 — no new `<Route>`, so no manifest touch).

### 5. Tokens / icons / themes

No raw color anywhere. Nesting depth cue and every crew tint reuse `crewAccentClasses`
(`../lib/hub-ux.ts`, `--chart-1…5`) exactly as today. The cyclic/missing placeholders use
`Badge variant="warning"`/`"outline"` (token-backed) + `AlertTriangle` (`lucide-react`), not a new
color. Any new icon-only control uses `IconButton` (label → tooltip == `aria-label`, no `title`).
Verify both `light` and `dark` for the new nested-group borders and placeholder badges.

## Files

- `apps/web/src/features/hub/workforce/crew-membership.ts` *(create)* — `resolveCrewClosure`,
  `formatCrewMembershipCount`, `resolveCrewAgents` (cycle-safe, memoised, pure).
- `apps/web/src/features/hub/workforce/crew-membership.test.ts` *(create)* — flat/2-level/cycle/
  diamond fixtures.
- `apps/web/src/features/hub/workforce/OrgRail.tsx` *(modify)* — N-level recursive branch rendering,
  recursive `assignedRoleIds`, recursive count label, `useTreeKeyboard` wiring, cycle/depth
  placeholder.
- `apps/web/src/features/hub/workforce/OrgRail.test.tsx` *(modify)* — nested-branch expansion,
  recursive count string, cycle placeholder, flat-crew regression (unchanged plain count).
- `apps/web/src/features/hub/workforce/CrewCard.tsx` *(modify)* — `crews` prop, recursive count
  badge, direct sub-crew chip row.
- `apps/web/src/features/hub/workforce/CrewCard.test.tsx` *(modify)* — pass `crews`; mixed
  agent+sub-crew fixture assertions.
- `apps/web/src/features/hub/workforce/CrewHeaderCard.tsx` *(modify)* — thread `crews` through.
- `apps/web/src/features/hub/workforce/CrewHeaderCard.test.tsx` *(modify)* — pass `crews`.
- `apps/web/src/features/hub/workforce/DirectoryTab.tsx` *(modify)* — recursive
  `assignedRoleIds`/`scopedCrewMembers`; pass `crews` to `CrewHeaderCard`.
- `apps/web/src/features/hub/workforce/DirectoryTab.test.tsx` *(modify)* — nested-membership
  assigned/unassigned test; recursive scoped-members grid test.
- `apps/web/src/features/hub/workforce/org-chart/crew-layout.ts` *(modify)* — add
  `buildMixedMemberLayout`; `buildCrewMemberLayout` untouched.
- `apps/web/src/features/hub/workforce/org-chart/crew-layout.test.ts` *(modify)* — new helper's
  mixed-size layout test; existing tests unchanged/still green.
- `apps/web/src/features/hub/workforce/org-chart/org-model.ts` *(modify)* — recursive `crewLane`,
  new `OrgNodeMeta` variants, recursive `assignedIds`, legend collection over full meta.
- `apps/web/src/features/hub/workforce/org-chart/org-model.test.ts` *(modify)* — nested
  `FlowGroupNode`/`parentId`, cycle/missing placeholder termination + bounded node count, diamond
  node-id uniqueness, legend includes a nested crew's color.
- `apps/web/src/features/hub/workforce/org-chart/OrgChartTab.tsx` *(modify)* — `nodeNavigationTarget`
  + `OrgInspectorBody` + `inspectorTitle` gain the `"sub-crew"`/placeholder cases.
- `apps/web/src/features/hub/workforce/org-chart/OrgChartTab.test.tsx` *(modify)* — sub-crew
  navigation target, placeholder inspector body.

## Acceptance

- [ ] `crew-membership.test.ts`: a flat crew (no `crewId` members) returns identical counts to
      today's `members.length`; a 2-level crew (2 agents + 1 sub-crew of 3 agents) closes to 5
      agents/1 crew/6 total; a genuine cycle (A↔B) terminates, returns a finite result, and marks
      `cyclic: true`; a diamond (two crews both reference crew C) counts C's agents once in each
      parent's closure.
- [ ] `OrgRail.test.tsx`: expanding a crew with a nested sub-crew member reveals an expandable
      sub-branch; expanding that reveals its own agent leaves; the crew's count badge reads
      "N agents, M crews (T total)"; a flat crew (no nesting) still shows a plain agent count
      (no visible regression); a synthetic cyclic fixture renders a non-interactive warning
      placeholder instead of hanging or crashing.
- [ ] `OrgRail`/`DirectoryTab`: an agent that is a member only of a sub-crew nested inside a
      top-level crew does **not** appear under "Unassigned".
- [ ] `CrewCard.test.tsx`/`DirectoryTab.test.tsx`: a crew with mixed agent + sub-crew membership
      renders a count string that visibly distinguishes "M crews" from "N agents" (not one
      ambiguous number), and lists its direct sub-crew member(s) by name.
- [ ] `org-model.test.ts`: a crew with a `crewId` member produces a `FlowGroupNode` whose `parentId`
      is the outer crew's group id, tagged with the new `"sub-crew"` `OrgNodeMeta` (carrying
      `parentCrewId`); a cyclic or dangling `crewId` reference produces a distinct placeholder node
      and the builder completes with a bounded node count on a synthetic self-referencing fixture.
- [ ] `OrgChartTab.test.tsx`: `nodeNavigationTarget` returns the crew's own profile target for a
      `"sub-crew"` node and `null` for a placeholder node; the inspector renders the new bodies.
- [ ] `buildCrewMemberLayout`'s existing behavior/signature is unchanged; `CrewTopologyGraph.tsx`
      and its existing test remain untouched and green (regression guard for the out-of-scope
      neighbor that shares `crew-layout.ts`).
- [ ] No raw color introduced; nesting/placeholder treatments read correctly in both `light`
      and `dark` (verified by looking); every new icon-only control uses `IconButton`.
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes

- **Parallel-safety:** this WP's file set is entirely under
  `apps/web/src/features/hub/workforce/{OrgRail,CrewCard,CrewHeaderCard,DirectoryTab,org-chart/*}` —
  disjoint from WP 4.1 (`workforce/crew-profile/*`) and WP 4.3
  (`apps/web/src/features/hub/{MissionBoard,topology-graph,TopologyGraph,MissionAgentNode,
  MissionPlanCard,MissionExpandDialog,AgentTranscript}.*`). Safe to batch with `{3.2, 4.1, 4.3}` per
  `STATUS.md`'s parallel window.
- **Rejected alternative:** a full migration onto `@elabs-ai/components-ui` `Tree` was considered and rejected —
  `Tree`'s row click conflates select+expand (verified in its source), which would regress today's
  independent select/expand UX and would require re-hosting drag/drop + the inline "+" + "⋯ move"
  menu into `Tree`'s `label: ReactNode` slot with manual `stopPropagation` on every inner control.
  Extending the bespoke rows + adopting `useTreeKeyboard` gets the same accessible keyboard model
  with none of that risk.
- **Deliberate scope lines** (not omissions): `CrewCard`'s avatar strip stays agent-only/direct
  (a sub-crew member is surfaced as a separate name chip, not blended into the avatar strip).
  `DirectoryTab`'s `crewsByRoleId` (feeds `AgentCard`'s cross-crew dot accent) stays
  direct-membership — recursing it would change what "belongs to this crew" means for a different,
  unrelated affordance; a future WP can revisit if wanted.
- **May split if too large** (per the plan): the natural fault line is OrgRail's tree (§2) vs. the
  org-chart canvas (§4) — split into two PRs along that line if needed, but ship as one WP if it
  fits.
- **Owner-acceptance, not verifiable here:** the both-theme + keyboard walk of the nested org
  chart/rail is tracked in `roadmap/crew-nesting/STATUS.md`'s Owner-acceptance section — this WP
  cannot self-certify a visual/keyboard walk.
