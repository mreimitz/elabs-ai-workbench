---
type: "Work Package Spec"
title: "Conventions every crew-nesting WP assumes"
description: "Shared rules and repo patterns so each WP spec stays focused on its own work. If a WP contradicts"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Conventions every crew-nesting WP assumes

Shared rules and repo patterns so each WP spec stays focused on its own work. If a WP contradicts
this file, the WP is wrong — fix the WP. The generic repo doctrine (stack ground truth, package
boundaries, persistence, web conventions, naming) lives in
[`../testing/conventions.md`](../RM-26-testing/conventions.md) and applies verbatim; this file adds the
**crew-nesting-specific** doctrine that the D-CN decisions impose.

## The quality gate (definition of done)

A WP is done only when, from the repo root:

    pnpm typecheck && pnpm test && pnpm build && pnpm lint

is green (linting is **Biome**, `biome.json`; the root `.github/workflows/ci.yml` runs the same set
on push + PR). Report completion honestly: "done" means you ran the gate. Lead with anything you did
**not** verify (especially visual/UX claims, which must be checked against the running app at
`http://localhost:8080` in **both** themes — `light` + `dark` — never a mock).

## Contract-first, additive-only (D-CN5)

1. Change `packages/shared` (`types.ts` + `schemas.ts` + `constants.ts`) **first**, then `apps/api`,
   then `apps/web`. Both ends type-check against one definition.
2. Every new wire field is **optional**. The only required→optional widening is `HubCrewMember.agentId`
   — permitted because every existing member still validates, but it is **type-breaking**: guard
   every `member.agentId` deref (known sites: `topologies.ts:441` (`../../apps/api/src/hub/missions/topologies.ts`),
   `roleToPlannedAgent:519`, plus ~12 UI sites listed in the ui map). A breaking request-shape change
   would force `/api/v2` — this plan must never need it.
3. **`hubCrewMemberSchema` strips unknown keys today** — so `crewId` must be an *explicit* schema key
   or it is silently dropped on write-then-read. Add `.strict()` to the member and the
   `.superRefine` "exactly one of `{agentId, crewId}`" (the `hubSkillAttachmentInputSchema` precedent).

## Migrations (D-CN6)

- If a WP needs a migration, **claim the next free `PRAGMA user_version` at claim time** — check
  `apps/api/src/db/database.ts` *and* every sibling
  `roadmap/*/STATUS.md` (several plans may be mid-flight). At authoring time the head is **v53**, so
  crew-nesting's migration is **v54**; re-confirm before writing it.
- `LATEST_SCHEMA_VERSION` is auto-derived from the **last** `MIGRATIONS` entry — append, highest
  last. Follow the **v50/v52/v53 additive pattern**: guard on table presence (`hasTable`) for minimal
  fixtures, then `ensureColumn(db, "hub_missions", "<col>", "<type>")`. An `ADD COLUMN` **cannot carry
  a CHECK** — use the **CHECK-in-baseline-only** pattern (CHECK lives in `schema.ts` fresh DDL;
  validation is zod). A new *status value* would instead need a v51-style 12-step rebuild — this plan
  needs **no** new status value.
- `members_json` / `plan_json` are opaque blobs: `crewId` and the nesting fields ride them with **no**
  migration (the `skill_ids_json` precedent). Touch the migration-version-literal test locks
  (referenced at `database.ts:438`) when you add v54.

## Runtime & security boundary (hard — the whole point of this plan)

- **No propose-gate relaxation (D-CN1).** `proposePlan`'s `session.kind === 'chat'` guard
  (`orchestrator.ts:330` (`../../apps/api/src/hub/missions/orchestrator.ts`)) and the withheld
  `mission.propose_plan` builtin stay exactly as they are. A sub-mission row is created **directly by
  the recursion engine**, never by an agent calling a tool. If a WP finds itself relaxing either, it
  is doing the wrong thing — STOP and write a blocker.
- **Budget monotonicity (D-CN3).** Never re-read `caps.maxBudgetUsd`/`defaultBudgetUsd` from env below
  the root. A child allocation is `min(requested, parentRemaining)`. Thread a **shared** cost
  accumulator + abort signal + concurrency limiter through `TopologyContext`; do not mint fresh ones
  per level. A test must prove aggregate ≤ root ceiling for a branchy tree.
- **Two-layer cycle/depth guard (D-CN4).** Author-time (repository) *and* run-time (engine). Never
  trust that the author-time check still holds at execution — the graph can mutate between save and
  run (mirrors the WP3.R workspace realpath-before-act posture).
- **Transitive non-escalation (D-CN9).** `effectiveAgentGrants` intersection composes transitively
  (level-2 ∩ level-1 ∩ level-0), never re-widens from a nested crew's own Access. Autonomy is
  `min` down the path (a nested `auto` can never raise a parent `always_ask`). Context down = a
  curated brief, never the parent transcript, at every level.
- **Frozen scope vocabulary (D-CN9).** Do **not** touch `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS`
  / `deriveAssistantScope`. The `hub_crew_*` write tools stay in `SCOPE_EXEMPT_ACTION_TOOLS` and stay
  approval-gated; the set-equality test in `assistant-scope.test.ts` must stay green with no name
  changes.
- Secrets never reach the browser or a model context (repo-wide rule); nested missions write only hub
  tables (domain isolation — 0 foreign-table rows).

## Event-sourcing & replay (D-CN7)

Every nested spawn / report / budget-trip is an event. A nested-tree mission must reconstruct from
`hub_events` alone (R-SES1). Parent-linkage on `agent_spawned`/`plan_proposed` is **additive**. Both
reducers change: the API `missions/board.ts` and the web `MissionBoard` (they are independent — the
web one is not the wire).

## UI (D-CN8)

brand-ui only, both themes, semantic tokens (no raw color for a depth cue — reuse `crewAccentClasses`
`--chart-1…5` and the token→token redirect pattern). Nested tree → `@elabs-ai/components-ui` `Tree`; nested graph →
`@elabs-ai/components-flow` `FlowGroupNode` (parentId nesting). Icon-only controls → `components/IconButton.tsx`
(label→tooltip==aria-label; no `title`). Sub-crew *profile* drill = route reuse
(`/assistant/agents/crew/:crewId`); mission-board sub-mission drill = transient nested dialog. A new
`<Route>` (only if a dedicated nested canvas is added) needs an `ASSISTANT_ROUTE_MANIFEST` entry.

## Working a WP — checklist

- [ ] Read this file + the WP's **Objective/Files/Acceptance** + the D-CN decisions it cites.
- [ ] Shared-first for any wire change; guard every widened deref so typecheck stays green.
- [ ] If it touches `packages/shared/src/*`, `apps/api/src/db/*`, `orchestrator.ts`, `topologies.ts`,
      `App.tsx`, `index.ts`, or `e2e/smoke.spec.ts` → run **solo** (contested hot files).
- [ ] Gate green (`typecheck && test && build && lint`); every Acceptance box literally true.
- [ ] Report honestly; list what you did not verify (owner-acceptance items).
