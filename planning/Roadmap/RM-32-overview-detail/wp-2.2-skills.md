---
type: "Work Package Spec"
title: "WP 2.2 — Skills: overview route grouped by source, de-railed inspector, SkillRail deleted"
description: "Phase 2 of the overview-detail plan. /skills becomes a grouped overview through the EntityBrowser kit; /skills/:skillId keeps the inspector without the rail and gains a breadcrumb switcher; the trigger-collision report is rehomed to the overview."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# WP 2.2 — Skills

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Concept: [`concept.md`](./concept.md)
(D-OD1–D-OD8). **Depends on WP 1.1 + WP 1.2.** Mirrors WP 2.1 — read that spec first; only the
differences are written out here.

## Files

| File | Change |
| --- | --- |
| `apps/web/src/features/skills/SkillsOverview.tsx` | **new** — the overview page |
| `apps/web/src/features/skills/SkillsOverview.test.tsx` | **new** |
| `apps/web/src/features/skills/SkillBreadcrumbSwitcher.tsx` | **new** |
| `apps/web/src/features/skills/skill-groups.ts` | **new** — the `EntityGroupBy<Skill>` for `sourceType` (+ test) |
| `apps/web/src/features/skills/TriggerCollisionReport.tsx` | **new** — the collision report, lifted out of the rail unchanged in behaviour |
| `apps/web/src/features/skills/SkillsView.tsx` | edit — becomes the detail-only host; mounts the breadcrumb switcher |
| `apps/web/src/App.tsx` | edit — route split, delete the first-skill redirect + the rail branch |
| `apps/web/src/features/skills/SkillRail.tsx` | **delete** |

## Grouping (D-OD6)

`sourceType` — **GitHub** and **Upload**, in that order, each group dropped when empty. Group-by
`None` is available as always. There is no user-managed skill "type" today; introducing one is a
recorded follow-up, not this WP.

## The skill card

- Title = `displayName`, a real `<Link to={/skills/:id}>`.
- Source `Badge` (`Github` / `Upload` icon + label), matching the rail's existing treatment.
- `description` clamped to 2 lines (`line-clamp-2`, `min-w-0`).
- Version count (`tabular-nums`) and the updated-at relative time.
- For a GitHub skill: repo + ref, mono and truncating, plus a lock/auth hint when `github.hasAuth`.
- Actions: "Pull latest" `IconButton` (GitHub only, disabled + `disabledReason` while busy) and a ⋯
  menu with Delete (destructive).
- **No token footprint on the card.** `Skill` does not carry one and fetching per card is an N+1; the
  L1/L2/L3 breakdown stays in the inspector. Do not invent a number.

## The skill table columns

Name (nav) · Source · Versions (numeric) · Description · Repo/ref · Updated · actions.

## The trigger-collision report (D-UX2 / K7)

Lift `TriggerCollisionsFooter` out of `SkillRail.tsx` into its own
`TriggerCollisionReport.tsx` **with its behaviour unchanged**: the `Collapsible` card, the four
states (checking / error / no collisions / N collisions), the re-check `IconButton`, the per-collision
`Card` with command-vs-keyword `Badge` and deep-links into each involved skill, and the
`getRegistryTriggerCollisions` fetch keyed on the skill-id list.

It is a **registry-wide** concern, so its home is the overview page — pass it as `EntityBrowser`'s
`footer`. It must not move into the single-skill inspector (that is the exact regression D-UX2 fixed).

## The detail (`SkillsView.tsx`)

- Keep it a thin host: `<SkillInspector key={skill.id} skillId={skill.id} />`.
- The "no skills registered" `StatePanel` moves to the overview; the "select a skill" panel becomes a
  **not-found** state — with the redirect gone, `/skills/:unknownId` is now reachable and must say so
  and offer a way back, mirroring `NotFoundRoute`'s posture rather than a silent teleport.
- Mount `SkillBreadcrumbSwitcher` through `useSetBreadcrumbSlot` (memoized), groups from
  `skill-groups.ts`, `triggerBadge` = the source badge, `onCreate` = the add-skill wizard,
  `onViewAll` → `/skills`.
- `SkillsView` already receives `skills` and `onAddSkill`; nothing new is needed from `App.tsx`
  besides the route split.
- Reduce the skill-detail breadcrumb in `App.tsx` to `[{ label: "Skills", to: "/skills" }]` — the
  switcher is the leaf now.

## `App.tsx` edits

1. `/skills` → `<SkillsOverview …/>`; `/skills/:skillId` → `<SkillsView …/>`.
2. **Delete** the first-skill redirect effect (D-OD1).
3. **Delete** the `isSkillsSection` branch of `secondaryContent`; with WP 2.1 done this leaves
   `secondaryContent` permanently `null` — WP 3.1 removes the prop itself.
4. Adjust the skill-detail breadcrumb.

## Tests

`SkillsOverview.test.tsx`: grouping by source with empty groups dropped; search across name +
description + repo; a card and a row both link to `/skills/:id`; "Pull latest" appears only on GitHub
skills and is disabled while busy; the zero-registry `EmptyState` offers "Add skill"; the collision
report renders in the footer and its four states behave (mock `getRegistryTriggerCollisions`).

## Acceptance

- `/skills` renders the overview cold with no redirect; `/skills/:unknownId` renders a real
  not-found state.
- The detail has no rail; its breadcrumb leaf switches skills.
- `SkillRail.tsx` is gone; `rg "SkillRail"` returns nothing; the collision report still works.
- `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green.
- No API, wire, schema or dependency change.
