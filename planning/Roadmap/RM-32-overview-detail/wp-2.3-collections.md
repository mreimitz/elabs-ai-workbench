---
type: "Work Package Spec"
title: "WP 2.3 — Collections: overview through the kit grouped by binding, detail breadcrumb switcher"
description: "Phase 2 of the overview-detail plan. The collections list renders through EntityBrowser grouped Local | Git-bound, and the collection detail gains the breadcrumb entity switcher."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# WP 2.3 — Collections

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Concept: [`concept.md`](./concept.md)
(D-OD1–D-OD8). **Depends on WP 1.1 + WP 1.2.**

Collections differ from Servers and Skills: there is **no rail** to delete and `/testing/collections`
is already a real list route that drills into `/testing/collections/:collectionId`. This WP brings it
onto the same grammar — grouped cards, a table mode, and a breadcrumb switcher on the detail.

## Files

| File | Change |
| --- | --- |
| `apps/web/src/features/testing/collections/CollectionsView.tsx` | edit — render through `EntityBrowser` |
| `apps/web/src/features/testing/collections/CollectionsView.test.tsx` | edit — cover both modes + grouping |
| `apps/web/src/features/testing/collections/collection-groups.ts` | **new** — the `EntityGroupBy<Collection>` (+ test) |
| `apps/web/src/features/testing/collections/CollectionBreadcrumbSwitcher.tsx` | **new** |
| `apps/web/src/features/testing/collections/CollectionDetail.tsx` | edit — mount the switcher |
| `apps/web/src/App.tsx` | edit — reduce the collection-detail breadcrumb to its parent crumb |

## Grouping (D-OD6)

Two groups: **Local** (unbound — `repoUrl === null`) first, then **Git-bound**. Inside the Local
group the reserved default collection (`isDefault`) is pinned first, exactly as today. Empty groups
are dropped. Group-by `None` remains available.

## The collection card

- Title = the collection name, a real `<Link to={/testing/collections/:id}>`.
- A `Local` `Badge` on the reserved default (with the existing `Lock` affordance signalling it cannot
  be deleted).
- For a bound collection: repo URL + branch + path, mono and truncating, plus the `KeyRound` hint when
  `hasPat`.
- The live sync-state chips from the existing `syncChips(...)` plus `lastSyncedLabel(...)` in
  `collection-status.ts` — **unchanged behaviour**: bound collections load `GET /:id/status`
  per row as they do today; local collections skip it (they have no remote). Keep the per-row
  loading/error handling; do not turn it into one blocking fetch.
- Actions: a ⋯ menu with Delete, **absent for the reserved default**.

## The collection table columns

Name (nav) · Kind (Local / Git-bound) · Repo · Branch · Sync state · Last synced · Updated · actions.

## The detail (`CollectionDetail.tsx`)

Mount `CollectionBreadcrumbSwitcher` through `useSetBreadcrumbSlot` (memoized): groups from
`collection-groups.ts`, `onSelect` navigates to `/testing/collections/:id`, `onCreate` opens the same
"New collection" dialog the list uses (lift the dialog or navigate to the list with the create intent
— pick the smaller change and say which in the ledger note), `onViewAll` → `/testing/collections`.
The detail fetches the collection list it needs for the switcher itself (`listCollections`), matching
its existing self-contained posture; a failed fetch degrades to a switcher showing only this
collection, never a crash.

Reduce the collection-detail breadcrumb in `App.tsx` to
`[{ label: "Collections", to: "/testing/collections" }]` — the switcher is the leaf.

## Preserve these existing behaviours

- The zero-collection `EmptyState` with its Import + New actions and its onboarding copy.
- The C-7 toolbar rule: with at least one collection, the toolbar carries the ⓘ tooltip, the search
  field, and the `ResultCount`; at zero it does not (the copy lives on the empty state instead).
- The reserved **Local** collection is undeletable and always present.
- The InsightBench import dialog and its post-import navigation to the created suite.

## Tests

Extend `CollectionsView.test.tsx`: grouping Local-first with the default pinned; the table mode
renders one table per group; search filters both modes; Delete is absent on the default; the zero
state is unchanged; a bound collection shows its sync chips and a failed status fetch degrades to an
error chip rather than removing the row.

## Acceptance

- `/testing/collections` renders the grouped grid by default with a working table toggle.
- The detail's breadcrumb leaf switches collections; "View all →" and the parent crumb return.
- Every behaviour above still holds.
- `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green.
- No API, wire, schema or dependency change.
