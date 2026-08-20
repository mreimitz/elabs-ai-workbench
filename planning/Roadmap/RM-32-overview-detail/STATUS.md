---
type: "Status Ledger"
title: "Overview → Detail restructure — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the overview-detail plan, read and updated by /next-wp overview-detail."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T22:15:00Z"
status: "active"
---
# Overview → Detail restructure — work-package status ledger · **PRIORITY: HIGH**

Living state for the **overview-detail** plan, read and updated by `/next-wp overview-detail`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[~]` in-flight (agent spawned; note worktree) · `[x]` done. Done lines:
`… — done <YYYY-MM-DD> · wp/overview-detail/<id>`.

> Concept + locked decisions **D-OD1–D-OD8**: [`concept.md`](./concept.md). Goal + milestones:
> [`item.md`](./item.md). **No API, no wire shape, no zod schema, no migration, no new dependency**
> — this is a web-only restructure over data that already exists.

## Phase 1 — The kit (no view wired)
- [x] WP 1.1 — `EntityBrowser` kit: grouping, search, grid ⇄ table, view-mode persistence, the card
      activation contract — done 2026-08-20 · spec: [`wp-1.1-entity-browser.md`](./wp-1.1-entity-browser.md).
      Ten files under `apps/web/src/components/entity-browser/` + 4 test files (32 tests). **No view
      wired** — the diff touches only that folder. Two deliberate deviations from the spec, both
      recorded here rather than silently taken:
      (a) **row activation uses `DataTable`'s own `onRowClick`/`rowActionLabel`, not the app's older
      `navCol` + `clickableRowTableProps` recipe** — v4's `onRowClick` already adds exactly ONE
      activation target per row (a visually-hidden button that is the row's keyboard tab stop) and
      guards nested controls and selection drags; combining the two would give every row two
      activation paths and fire both;
      (b) **the view toggle is `SegmentedField`, not a bare `ToggleGroup`** — Radix's `type="single"`
      group emits `""` when the active segment is re-clicked, silently clearing a control that must
      always hold one value; `SegmentedField` swallows that and adds arrow-key
      selection-follows-focus. Guards verified by breaking them: disabling the three `EntityCard`
      click guards turns 4 of its 6 tests red, restored green. Gate: typecheck · test (api + web
      3647) · build · lint all green.
- [x] WP 1.2 — `BreadcrumbEntitySwitcher`: the generic breadcrumb-leaf entity popover — done
      2026-08-20 · spec: [`wp-1.2-breadcrumb-switcher.md`](./wp-1.2-breadcrumb-switcher.md).
      `apps/web/src/components/BreadcrumbEntitySwitcher.tsx` + its test (10 tests); **mounted
      nowhere yet** and `SessionBreadcrumbSwitcher.tsx` is byte-unchanged. Grouped, searchable,
      drops emptied groups, renders a single unlabelled group flat, and shows loading copy rather
      than an empty state mid-fetch. Guard verified by breaking it: removing the emptied-group filter
      turns 2 tests red, restored green. Gate green.

## Phase 2 — The three sections (each depends on 1.1 + 1.2)
- [x] WP 2.1 — Servers: overview route, de-railed detail, breadcrumb switcher, `ServerRail` deleted —
      done 2026-08-20 · spec: [`wp-2.1-servers.md`](./wp-2.1-servers.md). New
      `ServersOverview.tsx` (+ 12 tests), `ServerBreadcrumbSwitcher.tsx`, `server-groups.ts`,
      `server-status.ts`; `ServersView` mounts the switcher through the breadcrumb slot and its
      no-server branch became a real **"Server not found"** state (with the redirect gone, that
      branch now means exactly one thing); `App.tsx` splits the two routes, drops the first-server
      redirect and the servers rail branch, and reduces the server crumb to its parent.
      `ServerRail.tsx` + `ServerRail.test.tsx` deleted; `features/security/ServerRailPosture.test.tsx`
      **renamed and ported** to `ServersOverviewPosture.test.tsx` (all 5 D-SP22 claims intact — one
      fleet request for the whole grid, the score in the badge's accessible name, no fabricated score
      for an unscanned server, the em dash, and a failed summary never costing the operator the
      fleet). Health/auth vocabulary moved to `server-status.ts` as `deriveServerHealth` — NOT
      `serverHealth`, which `lib/optimize.ts` already exports meaning something else entirely.
      Gate: typecheck · test (api 3564 · web 3664) · build · lint all green.
- [x] WP 2.2 — Skills: same shape, grouped by source, `SkillRail` deleted, collision report rehomed —
      done 2026-08-20 · spec: [`wp-2.2-skills.md`](./wp-2.2-skills.md). New `SkillsOverview.tsx`
      (+ 9 tests), `SkillBreadcrumbSwitcher.tsx`, `skill-groups.ts`, and `TriggerCollisionReport.tsx`
      — the registry-wide collision report lifted out of the rail's footer with its behaviour
      unchanged (all four states + the re-check + the per-collision deep links are covered by the new
      tests). `SkillsView` is now the detail-only host and mounts the switcher; its "select a skill"
      panel became a **"Skill not found"** state. `SkillRail.tsx` deleted. Two adjacent corrections
      the restructure exposed: deleting the server/skill you are LOOKING AT now returns to that
      section's overview instead of teleporting to whichever entity sorted next (which, now that the
      overview is a real place, silently swapped the page's subject); and `App.tsx`'s
      `isServersSection`/`isSkillsSection`/`sortedServers`/`sortedSkills`, dead once both rails were
      gone, are removed. `App.tsx` no longer passes `secondaryContent`/`secondaryTitle` at all —
      **WP 3.1 removes the props from `AppShell` itself.** Gate: typecheck · test (api 3564 · web
      3673) · build · lint all green.
- [x] WP 2.3 — Collections: overview through the kit, grouped by binding, detail breadcrumb switcher —
      done 2026-08-20 · spec: [`wp-2.3-collections.md`](./wp-2.3-collections.md).
      `CollectionsView` renders through `EntityBrowser` (new `collection-groups.ts`,
      `CollectionOverviewCard`, a `SyncCell` shared by card and table, six table columns);
      `CollectionDetail` mounts the new `CollectionBreadcrumbSwitcher`, which fetches its own list and
      degrades to "just this collection" if that fetch fails. Every prior behaviour kept: the reserved
      **Local** collection pinned first and undeletable, the PAT badge, per-bound-collection sync
      chips (still one status request per bound collection — only a bound one has a remote to ask),
      the D-IC10 `title` recovery on the composed repo line, the C-7 toolbar rules, the Review
      section, and the InsightBench import. Two naming corrections the change forced:
      (a) the unbound GROUP is labelled **"Unbound"**, not "Local" — the reserved collection is itself
      named "Local", and a header reading "Local" above a card reading "Local" makes two different
      things look like one;
      (b) the kit's zero-match control is **"Clear filter"**, not "Clear search" — `SearchInput`
      already renders a clear control named "Clear search", and two buttons with one accessible name
      is a real ambiguity for name-based navigation.
      The per-card **"Open" button is gone** (the title link + card activation is the single
      affordance), so the old C-7 "ragged action alignment" test — which pinned an invisible
      placeholder keeping every Open button at the same x — is replaced by tests for what actually
      holds now. Gate: typecheck · test (shared/illustrations 14 · api 3564 · web 3675) · build ·
      lint all green.

## Phase 3 — Cleanup + the front page (depends on all of Phase 2)
- [x] WP 3.1 — remove `AppShell.secondaryContent` / `secondaryTitle` + the mobile Sheet branch;
      README + CHANGELOG — done 2026-08-20 · spec: [`wp-3.1-shell-cleanup.md`](./wp-3.1-shell-cleanup.md).
      `AppShell`'s `mainRegion` collapsed from four branches to two (`fullBleed` and the default
      padded scroller); the two 288px `<aside>` branches, the mobile rail `Sheet` + its `railOpen`
      state, and the now-unused `useIsMobile` import are gone. `rg "secondaryContent|secondaryTitle"`
      returns nothing in `apps/web/src`; no test asserted those props (verified before deleting), and
      the three AppShell test files stay green (23 tests). Stale comments in `PageShell` (the
      `master-detail` width mode), `ServersView` and `WorkforceView` corrected rather than left
      describing a structure that no longer exists. Nothing became unreachable on a phone: the rails
      were the only thing behind that Sheet trigger, and the overview pages that replaced them are
      sidebar-reachable. Front page updated in the same change: a README paragraph on the new
      overview → detail → breadcrumb-switcher flow, and a CHANGELOG entry. **The README screenshots
      still show the previous side-list layout — both documents say so.** Gate: typecheck · test
      (illustrations 14 · api 3564 · web 3675) · build · lint all green; the built API boots and
      serves `/servers` and `/skills`.

## Owner-acceptance (pending — owner-run; **this is what blocks retirement**)

All six work packages are done and the quality gate is green, but `/complete-roadmap` refuses while
any box below is open — correctly, because the gate cannot see pixels. These are the running-app
walks the owner runs, in **both** themes:

- [ ] `/servers` cold-load shows the overview grid grouped by type — **no redirect to a server**.
- [ ] Grid ⇄ table toggle keeps the same groups and order; the mode survives a reload; `?view=grid`
      beats the stored preference.
- [ ] Search filters both modes; empty groups vanish; a zero-match state offers Clear.
- [ ] A card opens the detail — **no left rail**, the detail spans the window.
- [ ] The breadcrumb leaf popover lists every entity grouped + searchable; picking one navigates;
      "View all →" and the parent crumb both return to the overview.
- [ ] Keyboard only: one tab stop per card plus its actions; Enter opens; focus ring visible in both
      themes.
- [ ] The same walk on `/skills` (grouped by source) and `/testing/collections` (Local pinned first,
      Local has no Delete).
- [ ] Below 768px the removed mobile rail Sheet is gone and the overview still reads.

## Retiring this item (after the walk above)

The delivery record + retirement is one transaction. The command below is already reconciled against
what actually shipped — run it once every box above is ticked:

```bash
cd planning && python3 .claude/scripts/okf.py complete-roadmap \
  --tag "RM-32" \
  --docu "DC-20" --docu "DC-02" --docu "DC-07" --docu "DC-09" \
  --shipped "MCP Servers, Skills and Collections each open as an overview of everything registered — a card grid grouped by type / source / git binding, switchable to a grouped table and remembered per section — and selecting one opens a full-width detail page whose last breadcrumb is a searchable switcher over every sibling. The fixed 288px list rail is gone." \
  --deviation "Row activation in table mode uses DataTable's own onRowClick/rowActionLabel rather than the app's older navCol + clickableRowTableProps recipe (the two together would give each row two activation paths); the view switch is brand-ui's SegmentedField rather than a bare ToggleGroup (Radix clears a single-select group when the active segment is re-clicked); the unbound collection group is labelled 'Unbound', not 'Local', because the reserved collection is itself named Local; the kit's zero-match control is 'Clear filter', because SearchInput already renders a 'Clear search' control." \
  --gap "Scans and Suites keep their existing shape and are not converted. The Assistant's own session breadcrumb switcher is left on its bespoke implementation rather than folded onto the new generic one. Skills group by source only — a user-managed skill type entity, mirroring server types, is an owner decision that was not assumed. The README screenshots still show the previous side-list layout." \
  --code-path "apps/web/src/components/entity-browser/" \
  --code-path "apps/web/src/components/BreadcrumbEntitySwitcher.tsx" \
  --code-path "apps/web/src/features/servers/" \
  --code-path "apps/web/src/features/skills/" \
  --code-path "apps/web/src/features/testing/collections/" \
  --docu-status current
```

## Follow-ups (recorded, not scheduled)

- `/scans` and `/testing/suites` are candidates for the same kit — deliberately out of scope (D-OD9
  would be needed to take them on).
- `SessionBreadcrumbSwitcher` could fold onto `BreadcrumbEntitySwitcher`; left alone here because it
  is shipped and tested.
- A user-managed skill "type" entity (mirroring `ServerType`) would give Skills a richer grouping
  than `sourceType`; owner decision, not assumed.
