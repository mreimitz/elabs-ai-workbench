---
type: "Work Package Spec"
title: "WP 4.1 \u2014 Crew editor sub-crew add path + author-time cycle/depth warning"
description: "Phase: 4 \u2014 UI \u00b7 Size: M \u00b7 Depends on: 1.2 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 4.1 — Crew editor sub-crew add path + author-time cycle/depth warning

**Phase:** 4 — UI · **Size:** M · **Depends on:** 1.2 · **Model:** Sonnet

## Objective

Let an operator nest a saved crew inside another crew from the crew editor itself: `MembersSection`
gains a second add path that appends a `{ crewId }` member (D-CN1's deterministic crew-composition
path, authored ahead of time), every member-render branches on kind instead of assuming
`member.agentId`, and a client-side reachability/depth check warns/blocks a cycle or an over-depth
nest *before* the operator hits Save — the UI half of D-CN4's two-layer guard (the repository,
WP 1.1, remains the authoritative author-time reject).

## Why / references

- **D-CN1** — a `crewId` member is deterministic saved-crew composition, not a model spawning an
  agent; this WP is purely an authoring surface over that.
- **D-CN4** — two-layer cycle + depth guard, *author-time* half, *client side*: warn/disable before
  submit, cycle-safe via a visited set, never trusting a stale snapshot (the server, WP 1.1, is the
  loud, authoritative reject).
- **D-CN5** — `HubCrewMember.agentId` widens to optional, gains `crewId?`, `.superRefine` enforces
  exactly one of `{agentId, crewId}` (landed by WP 0.1/1.1/1.2, upstream of this WP). Every
  `member.agentId` deref in this file must be guarded — the ui map names
  `MembersSection.tsx:131`/`:153` explicitly as known sites.
- **D-CN8** — "the crew editor gains a sub-crew add path and an author-time cycle warning… a
  sub-crew *profile* drill is route reuse (`/assistant/agents/crew/:crewId`)."
- Ground truth read for this WP: `apps/web/src/features/hub/workforce/crew-profile/MembersSection.tsx`
  (`addMember:60`, role-only `SelectField`, accordion `role?.name ?? "(deleted role · …)"` at `:153`,
  key `${member.agentId}-${index}` at `:134`), `crew-profile-form.ts` (`validateCrewProfileForm:43`,
  `moveMember:75`), `CrewProfileModal.tsx` (roles `useLoadable` pattern `:85-91`, `MembersSection`
  mount `:269-277`), `App.tsx:1294` (`/assistant/agents/crew/:crewId`), `apps/web/src/lib/api.ts:2455`
  (`listHubCrews`, already exported — no new endpoint needed), `BudgetsSection.tsx` (the existing
  `BudgetsFields`/`budgetsFromWire`/`budgetsToWire` reuse target for the crew member's own
  budget-cascade field), ui map §3/§4#5.

## Design

**1. `CrewProfileModal.tsx` hands `MembersSection` the whole crew graph.** Add a third `useLoadable`
call mirroring the existing `rolesState` one: `useLoadable<HubCrew[]>(() => listHubCrews(), [])` →
`crews = loadableData(crewsState) ?? []`, `crewsLoading = crewsState.status === "loading"`. Thread
`crews`, `crewsLoading`, and the already-narrowed `crewId` (the route param — non-null by the time
`sections` is built, since the function already early-returns on `!crewId`) into `MembersSection`'s
props, and into `validateCrewProfileForm(form, { crewId, crews })` in `handleSubmit`.

**2. `crew-profile-form.ts` gains the graph helpers + the validation rule.** Build a small,
self-contained (no server import — this is the client-side mirror, not the source of truth) set of
pure functions over `HubCrew[]`, every recursive one guarded with a `visited: Set<string>` so a
pre-existing cycle elsewhere in the fetched graph can't infinite-loop an *advisory* calculation:

- `memberKind(member: HubCrewMember): "agent" | "crew"` — `member.crewId ? "crew" : "agent"`.
- `crewReachable(crews, fromCrewId, toCrewId, visited?): boolean` — DFS over each crew's
  `members[].crewId` edges; `true` when `fromCrewId === toCrewId` (a node reaches itself — this
  subsumes the direct self-reference case, no separate check needed).
- `crewSubtreeDepth(crews, crewId, visited?): number` — longest chain of nested `crewId` members
  reachable **below** `crewId` (0 = a leaf crew with no sub-crew members).
- `crewAncestorDepth(crews, crewId, visited?): number` — longest chain of crews that already
  (transitively) nest `crewId` as a member (0 = `crewId` isn't nested inside anything today).
- `evaluateCrewNesting(crews, hostCrewId, candidateCrewId, maxDepth): { cycle: boolean; overDepth: boolean }`
  — `cycle = crewReachable(crews, candidateCrewId, hostCrewId)`; when not a cycle,
  `overDepth = crewAncestorDepth(crews, hostCrewId) + 2 + crewSubtreeDepth(crews, candidateCrewId) > maxDepth`
  (the `+2` counts `hostCrewId` and `candidateCrewId` themselves). Import `HUB_MISSION_MAX_DEPTH`
  from `@mcp-token-footprint/shared` (added by WP 0.1) as the default `maxDepth` — **re-verify the
  exact exported name/shape against what WP 0.1 actually shipped before wiring** (see Notes).
- `validateCrewProfileForm(value, context?: { crewId: string; crews: HubCrew[]; maxDepth?: number })`
  — unchanged name/behavior checks, **plus**, only when `context` is given: for every member with a
  `crewId`, run `evaluateCrewNesting`; the first `cycle` or `overDepth` hit sets a specific
  `errors.members` message naming the offending crew (e.g. `"“Research Team” would create a
  circular crew reference — remove it."` / `"…exceeds the maximum crew nesting depth (2)."`) and
  stops the modal from saving. `context` stays optional so every existing single-argument call in
  `crew-profile-form.test.ts` keeps compiling; only `CrewProfileModal.tsx` passes it.

**3. `MembersSection.tsx` gets a second add path.** A `ToggleGroup type="single"` ("Role" /
"Sub-crew", default `"role"`) swaps the existing role `SelectField` + Add button row for a crew one.
The crew `SelectField`'s options are `crews` filtered to exclude: `candidate.id === crewId` (no
self-nesting), `members.some(m => m.crewId === candidate.id)` (already a member), and any candidate
where `evaluateCrewNesting(crews, crewId, candidate.id, HUB_MISSION_MAX_DEPTH)` reports `cycle` or
`overDepth` — i.e. the picker **hides** cycle/over-depth candidates rather than showing them
disabled (`SelectField` has no per-item disabled slot); an inline `Text variant="caption"
tone="muted"` beneath the row explains the omission whenever `availableCrews.length <
crews.length` (the "warn" half — the filtering itself is the "disable" half). Choosing a crew and
pressing Add appends `{ crewId: addCrewId }` (an otherwise-empty member — no `agentId`, matching the
widened schema) and resets the picker.

**4. The accordion branches on `memberKind(member)`.** Fix the key first (`${member.agentId ??
member.crewId}-${index}`, since `member.agentId` is now optional). For a `crewId` member: resolve
`crewById.get(member.crewId)`, render its name/`RoleAvatar` (id = `member.crewId`, icon =
`subCrew?.icon`, no `model`) and a `Badge variant="secondary"` reading "Sub-crew" — an unresolved
crew renders a crew-specific fallback (`(missing crew · <id-prefix>)`), **never** the role fallback
text. The move/remove `IconButton`s stay unchanged (index-based, kind-agnostic). The accordion
content shows exactly two things instead of the agent overrides: (a) a `Button variant="outline"
size="sm"` "Open sub-crew" that calls `useNavigate()` → `/assistant/agents/crew/${member.crewId}`
(route reuse, D-CN8 — a visible-text button, not icon-only, so it does not need `IconButton`), and
(b) the budget-cascade override — the *same* `Switch` + `BudgetsFields`/`budgetsFromWire`/
`budgetsToWire` pattern `BudgetsSection.tsx` already uses for agent members, but reading/writing
`member.budgets` inline here instead. It renders **none** of model/system-prompt/target/
expected-outcome/tool-grants/skills — those stay agent-only. An `agentId` member keeps today's exact
render (guarded: only reached in the `else` arm of the kind branch, so `member.agentId` is safe to
use unguarded there).

## Files

- `apps/web/src/features/hub/workforce/crew-profile/MembersSection.tsx` *(modify)* — second add
  path (Role/Sub-crew `ToggleGroup` + crew `SelectField`), cycle/depth-filtered crew options +
  explanatory caption, kind-branched accordion (sub-crew name/avatar/badge/"Open sub-crew"/budget
  cascade vs. today's agent overrides), fixed kind-safe key, `crews`/`crewsLoading`/`crewId` props.
- `apps/web/src/features/hub/workforce/crew-profile/crew-profile-form.ts` *(modify)* — `memberKind`,
  `crewReachable`, `crewSubtreeDepth`, `crewAncestorDepth`, `evaluateCrewNesting`; `validateCrewProfileForm`
  gains the optional `{ crewId, crews, maxDepth }` context + the cycle/depth-cap rule.
- `apps/web/src/features/hub/workforce/crew-profile/CrewProfileModal.tsx` *(modify)* — `listHubCrews`
  `useLoadable`, threads `crews`/`crewsLoading`/`crewId` into `MembersSection` and into
  `validateCrewProfileForm` at submit.
- `apps/web/src/features/hub/workforce/crew-profile/crew-profile-form.test.ts` *(modify)* — new
  tests for `crewReachable`/`evaluateCrewNesting` (direct self-reference, multi-hop `A→B→C→A` cycle,
  a depth-cap breach, cycle-safety against a pre-existing unrelated cycle in the fixture graph) +
  `validateCrewProfileForm` with/without `context`.
- `apps/web/src/features/hub/workforce/crew-profile/MembersSection.test.tsx` *(create)* — adding a
  sub-crew member; a cycle-creating crew is absent from the picker with the explanatory caption
  shown; a sub-crew member renders its name/avatar/"Open sub-crew"/budget field and never the agent
  overrides or "(deleted role · …)".
- `apps/web/src/features/hub/workforce/crew-profile/CrewProfileModal.test.tsx` *(modify)* — mock
  `listHubCrews` (currently absent from this file's `vi.mock`), default a crew list including a
  nestable crew, assert Save is blocked (no `updateHubCrew` call) when the form holds a
  cycle-creating member.

## Acceptance

- [ ] `MembersSection` renders a second, visibly distinct add path that appends `{ crewId }` (no
      `agentId`) to `members` once a sub-crew is chosen and Add is pressed.
- [ ] The crew picker's options exclude the crew being edited, crews already a member, and any crew
      for which `evaluateCrewNesting` reports `cycle` or `overDepth`; an inline caption explains the
      omission whenever candidates were filtered out.
- [ ] The accordion branches on `memberKind(member)`: a `crewId` member shows the sub-crew's real
      name/avatar, a "Sub-crew" badge, an "Open sub-crew" action to `/assistant/agents/crew/:crewId`,
      and a budget-cascade override — and renders none of the model/system-prompt/target/
      expected-outcome/tool-grant/skill overrides.
- [ ] A resolvable `crewId` member never renders `(deleted role · …)`; an unresolved one renders a
      crew-specific fallback instead.
- [ ] `CrewProfileModal` fetches the full crew set and threads it (+ `crewId`) into both
      `MembersSection` and `validateCrewProfileForm`.
- [ ] `validateCrewProfileForm` rejects a form whose members would create a crew-nesting cycle or
      breach the max depth, with a specific `members` error naming the offending crew, and passes a
      form with none.
- [ ] `crew-profile-form.test.ts` proves `crewReachable`/`evaluateCrewNesting` catch a direct
      self-reference and a multi-hop cycle, detect a depth-cap breach, and don't loop/stack-overflow
      against a pre-existing unrelated cycle in the fixture graph.
- [ ] `MembersSection.test.tsx` (new) covers: add-a-sub-crew, cycle-candidate exclusion, and correct
      sub-crew rendering (not "(deleted role)").
- [ ] `CrewProfileModal.test.tsx` mocks `listHubCrews` and proves Save is blocked on a cycle-creating
      member.
- [ ] Every new element is `@elabs-ai/components-ui`/`lucide-react` only (no raw interactive HTML); reads correctly
      in both `light` and `dark` (visual check — not automatable).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes

- **Solo-safe on the web side:** `MembersSection.tsx` / `crew-profile-form.ts` / `CrewProfileModal.tsx`
  are disjoint from 4.2 (`OrgRail`/org-chart) and 4.3 (`MissionBoard`/topology) — no shared-file
  contention.
- **Dependency risk to re-check at claim time:** this WP imports `HUB_MISSION_MAX_DEPTH` from
  `packages/shared`, added by WP 0.1 (transitively upstream via 1.1 → 1.2). Confirm the exact
  exported name/shape before wiring; if WP 0.1 shipped it only as a server-side env default with no
  shared numeric constant, fall back to a locally-defined `DEFAULT_MAX_CREW_DEPTH = 2` in
  `crew-profile-form.ts` (matching D-CN10's locked default) and flag the divergence in `STATUS.md`.
- **Known gap, deliberately out of scope:** `BudgetsSection.tsx` (the separate top-level Budgets rail
  tab) also does `roleById.get(member.agentId)` and will render its own "(deleted role · …)" for a
  sub-crew member the moment one exists, since it isn't in this WP's pinned file list. Flag this for
  the next WP/owner to fold in (likely a fast-follow filtering `members` to agent-only there, since a
  sub-crew's budget-cascade override now lives inline in `MembersSection` instead) — do not silently
  expand this WP's scope to fix it.
- **"Open sub-crew" bypasses the unsaved-changes guard** (`useNavigate()` unmounts the modal directly,
  same as this file's existing `handleInstantiate`/`closeToList`-on-save pattern) — consistent with
  existing precedent in `CrewProfileModal.tsx`, not a new regression introduced here.
- **Advisory, not authoritative:** the cycle/depth check here is client-side UX sugar over a
  point-in-time `listHubCrews()` snapshot; WP 1.1's repository validation is the real author-time
  reject (D-CN4), so a stale snapshot just means the save round-trips a server error instead of
  pre-empting it — never the reverse.
- **Owner-acceptance (not verifiable here):** a two-theme + keyboard walk of the new toggle/picker/
  badge/budget-field/"Open sub-crew" affordances against the running app.
