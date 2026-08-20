---
type: "Work Package Spec"
title: "Overview → Detail restructure — concept and locked decisions D-OD1–D-OD8"
description: "Why the 288px master-detail rail is replaced by a grouped overview grid/table plus a full-width detail page with a breadcrumb entity switcher, and the generic EntityBrowser kit that makes it one component used three times."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# Overview → Detail restructure — concept

## 1. The problem

Three sections are built as **master-detail with a fixed 288px left rail**: MCP Servers, Skills and
(differently) Collections. The rail is `AppShell`'s `secondaryContent` aside, fed by
`apps/web/src/features/servers/ServerRail.tsx` and `apps/web/src/features/skills/SkillRail.tsx` from
`apps/web/src/App.tsx`.

The rail does not have the room for what it is asked to carry. One server row squeezes name, health
dot, health chip, token total, posture band, transport, auth and endpoint into 288px — names truncate
to `barc…`, `qlik-…`, `m…` — while group headers compete with rows for the same narrow column. There
is no fleet-level read anywhere in the section, and the rail costs the detail pane 288px on every
page for a list an operator looks at once.

## 2. The shape

```
/servers                    OVERVIEW    grouped card grid  ⇄  grouped table
   │  click a card / row
   ▼
/servers/:serverId          DETAIL      full width, no rail
   breadcrumb:  Home › MCP Servers › [barc-benchmark ▾]
                       │                      │
                       │                      └─ popover: searchable, grouped list of every
                       │                         server + "New server" + "View all →"
                       └─ back to the overview
```

Identical for `/skills` ⇄ `/skills/:skillId` and `/testing/collections` ⇄
`/testing/collections/:collectionId`.

## 3. Locked decisions

### D-OD1 — the overview is a route that renders itself
Landing on `/servers` shows the overview. The current "redirect to the first server / first skill"
effects in `App.tsx` are **deleted**. This satisfies `.claude/rules/routes-vs-dialogs.md`: every route
renders something useful with zero query params.

### D-OD2 — grid is the default; the mode is remembered and shareable
The choice persists per section in `localStorage`, and is mirrored to an **optional** `?view=table`
param so a view is shareable. Precedence: URL param → stored preference → grid. The param is never
*required* (D-OD1).

### D-OD3 — grouping belongs to the view, not the mode
The same groups, order and headers appear in grid and table. Table mode renders **one `DataTable` per
group** under the shared group header; with group-by `None` it renders **one flat table** with full
cross-row sorting. Sorting is therefore within-group when grouped — that is the stated trade, and the
reason `None` exists. `@elabs-ai/components-data`'s `DataTable` has no row-grouping feature, so the
alternative would be a second table implementation.

### D-OD4 — the rails are removed, not hidden
`ServerRail.tsx`, `SkillRail.tsx`, the `App.tsx` wiring, and `AppShell`'s then-consumerless
`secondaryContent` / `secondaryTitle` props (including the mobile `Sheet` branch) all go. `fullBleed`
alone covers every remaining route. No test asserts those props today.

### D-OD5 — entity switching lives in the breadcrumb leaf
Via the existing `useSetBreadcrumbSlot` channel (`apps/web/src/components/breadcrumb-slot.tsx`) — the
same mechanism the Assistant workspace already ships as `Home › Assistant › [Session ▾]`. The parent
crumb navigates back to the overview, which it already does.

### D-OD6 — grouping dimensions use only data that exists today
- **Servers** → `ServerType` (+ an `Untyped` tail) — the exact model `ServerRail` already implements.
- **Skills** → `sourceType` (`upload` | `github`) — the only real dimension a `Skill` carries.
- **Collections** → binding (`Local` | `Git-bound`), with the reserved undeletable **Local**
  collection pinned first in its group.

No schema change, no migration, no wire change. A user-managed "skill type" mirroring `ServerType`
would be a richer grouping; it is deliberately **not** in scope here.

### D-OD7 — card/row activation is one click
Unlike the workforce grid (click = select, double-click = open — there is a selection concept there),
an overview card has nothing to select, so a single click opens the detail, matching `DataTable`'s
`onRowClick` in the other mode: both modes behave identically.

Accessibility follows the `DataTable` row model: the card **title is a real `<Link>`** (the tab stop,
the accessible name, a genuine `href` so middle-click / open-in-new-tab work); a pointer click
anywhere else on the card resolves to the same navigation; clicks originating in a nested control
(the ⋯ menu, an icon button, a Radix portal) are guarded out. That guard is already written and
reviewed in `apps/web/src/features/hub/workforce/AgentCard.tsx` — reuse it, do not re-derive it.

### D-OD8 — no new dependency
No `brand-ui` card-grid component exists: `BentoGrid` is a marketing spotlight grid, `Gallery` is
image-only, `DataTable` has no row grouping. The sanctioned pattern is a CSS grid of `Card`, already
shipping in `apps/web/src/features/hub/workforce/DirectoryTab.tsx`. Virtualization stays
`content-visibility: auto` per the `AgentCard` precedent, not a new virtualizer.

## 4. The generic kit — `EntityBrowser`

`apps/web/src/components/entity-browser/`. It owns **layout, grouping, search, view mode and empty
states**; the caller owns **what a card looks like** and **what the columns are**.

```
EntityBrowser<T>          orchestrator — groups, filters, switches modes, renders empty states
├── EntityGroupSection    group header: label · optional badge · count — identical in both modes
├── EntityGrid            grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4
│   └── EntityCard        the card shell + the D-OD7 activation contract
├── EntityTable           one DataTable per group (or one flat table when group-by = None)
└── ViewModeToggle        brand-ui ToggleGroup: Grid / Table
useEntityBrowserState()   search + group-by + view mode, localStorage-backed, ?view= aware
```

`EntityCard` is a shell, not a template: `title`, `href`, `badges`, `status`, `meta` (a truncating
line), `metrics` (`tabular-nums` figures), `description` (clamped), `actions` (the ⋯ menu).
Everything inside comes from existing app parts — `StatusBadge`, `IconButton`, `Card`, `Badge`,
`Text`, `PostureScore`, `formatNumber` / `formatRelativeTime`.

## 5. The generic breadcrumb switcher

`apps/web/src/components/BreadcrumbEntitySwitcher.tsx`, generalised from the shipping
`SessionBreadcrumbSwitcher`: a `Popover` whose trigger is the ghost crumb button, leading with **this
entity**, then a `SearchInput`, then the **grouped** list (same groups as the overview), then a footer
of "New …" and "View all →". The Assistant's own switcher is left untouched in this workstream (it is
shipped and tested); folding it onto the generic one is a follow-up.

## 6. What each card carries — only measured data

| | Card face |
| --- | --- |
| **Server** | name (link) · type badge · health dot + chip (`serverHealth`, reused) · endpoint (mono, truncating) · transport · auth · startup tokens (`tabular-nums`, `—` when never/failed-scanned) · tool count · posture band chip (`PostureScore`, from the ONE fleet request, D-SP22) · last-scan relative time · actions: Scan now, ⋯ (Edit / Test connection / Delete) |
| **Skill** | displayName (link) · source badge · description clamped to 2 lines · version count · updated-at · GitHub repo + ref when bound · actions: Pull latest (github only), ⋯ (Delete). **No token footprint on the card** — `Skill` does not carry one and fetching per card is an N+1; it stays on the inspector |
| **Collection** | name (link) · `Local` badge for the reserved default · repo + branch chip when bound · the existing `syncChips` sync state · actions: ⋯ (Delete — never for `Local`) |

## 7. States, accessibility, themes

- **Loading** — skeleton cards on the same grid (no CLS); `DataTable loading` in table mode.
- **Zero entities** — the section's `EmptyState` with its create action (copy already exists).
- **No matches** — a "no matches" line with a Clear control; a group with no visible member is
  dropped, never left as a bare header (the rule `ServerRail` already follows).
- **Long content** — `min-w-0` + `truncate` / `line-clamp-2` on every card text container.
- **Keyboard** — one tab stop per card (the title link) plus its explicit actions; visible focus from
  the token ring; each group is a labelled `<section>`.
- **Both themes** — semantic tokens only, verified by looking.

## 8. What does not change

No API, no `packages/shared` wire shape, no zod schema, no DB migration, no new dependency, no new
route pattern (all six routes already exist), no `ASSISTANT_ROUTE_MANIFEST` change — the three list
routes keep `surface: "global"` with their existing exemption ("the operable surface is the drill-in
detail"), which stays true. `PAGESHELL_EXACT_ROUTES` and its prefixes already contain all six paths.

## 9. Deliberately out of scope

`/scans` and `/testing/suites` keep their current shape. Both are candidates for the same kit later;
they are follow-ups on this ledger, not silent conversions.
