---
type: "Work Package Spec"
title: "WP 1.1 — the EntityBrowser kit: grouped card grid, grouped table, one activation contract"
description: "Phase 1 of the overview-detail plan. Builds the generic grid/table browser used by Servers, Skills and Collections. No view is wired in this WP."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# WP 1.1 — the `EntityBrowser` kit

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Concept + locked decisions:
[`concept.md`](./concept.md). Repo rules: `.claude/rules/` (brand-ui-only, styling-and-tokens,
library-first, interaction-guidelines, loading-states, icon-affordances, quality-gates).

## What this WP is

The **generic** browser that Servers, Skills and Collections all render through: it owns grouping,
search, the grid ⇄ table switch, view-mode persistence, loading and empty states, and the card
activation contract. It owns **no entity knowledge** — the caller supplies the card composition and
the table columns.

**This WP wires no view.** `/servers`, `/skills` and `/testing/collections` are untouched. At the end
of it, the kit exists, is fully tested, and the gate is green.

## Files

New, all under `apps/web/src/components/entity-browser/`:

| File | Holds |
| --- | --- |
| `types.ts` | `EntityGroupBy<T>`, `EntityGroup<T>`, `EntityViewMode`, `EntityBrowserProps<T>` |
| `group.ts` | `buildEntityGroups()` — the **pure** grouping/search function (unit-testable without React) |
| `use-entity-browser-state.ts` | search + group-by + view mode; `localStorage` + `?view=` |
| `EntityBrowser.tsx` | the orchestrator |
| `EntityGroupSection.tsx` | group header (label · optional badge · count) + children |
| `EntityGrid.tsx` | the CSS grid + skeleton cards |
| `EntityCard.tsx` | the card shell + the D-OD7 activation contract |
| `EntityTable.tsx` | one `DataTable` per group, or one flat table |
| `ViewModeToggle.tsx` | the `ToggleGroup` grid/table switch |
| `index.ts` | the kit's public surface |

Co-locate tests as `<name>.test.tsx` / `<name>.test.ts` (repo convention).

## Contract

```ts
export type EntityViewMode = "grid" | "table";

export type EntityGroupBy<T> = {
  id: string;                    // "type" | "source" | "binding" | "none"
  label: string;                 // shown in the group-by picker
  /** null ⇒ the item lands in the trailing fallback group. */
  groupOf: (item: T) => { key: string; label: string; badge?: ReactNode } | null;
  fallbackLabel: string;         // "Untyped" · "Other"
  /** Keys in the order their groups must render. Unlisted keys sort by label; the fallback is ALWAYS last. */
  groupOrder?: string[];
};

export type EntityBrowserProps<T> = {
  items: T[];
  itemKey: (item: T) => string;
  /** The free-text haystack for the one SearchInput. */
  searchText: (item: T) => string;
  searchPlaceholder: string;     // "Search servers…"
  /** Noun for counts and empty copy: ["server", "servers"]. */
  noun: [singular: string, plural: string];
  groupBys: EntityGroupBy<T>[];  // [] ⇒ no picker, one flat view
  renderCard: (item: T) => ReactNode;
  columns: ColumnDef<T>[];
  onOpen: (item: T) => void;
  hrefFor: (item: T) => string;
  storageKey: string;            // "servers" | "skills" | "collections"
  loading?: boolean;
  /** The zero-ENTITY state (caller-owned copy + create action). Not the zero-MATCH state. */
  empty: ReactNode;
  /** Extra controls for the toolbar's left cluster (e.g. a type filter Select). */
  toolbarLeft?: ReactNode;
  /** Extra content below the groups (e.g. the skills trigger-collision report). */
  footer?: ReactNode;
};
```

`EntityBrowser` renders **only the body** — the caller mounts it inside its own `PageShell` +
`ViewToolbar`, and passes the browser's search/toggle/count controls into that one toolbar row.
Exposing them means `EntityBrowser` takes a render prop **or** the caller uses
`useEntityBrowserState()` itself and passes the state down. **Choose the second**: the hook is the
public state, `EntityBrowser` is a controlled component. That keeps the D-TB2 "exactly one toolbar
row per view" rule intact — the browser never renders a toolbar of its own.

So the real split is:

```ts
const browser = useEntityBrowserState({ storageKey: "servers", groupBys, defaultGroupBy: "type" });
// caller's ViewToolbar: left={<SearchInput {...browser.search} />} … actions={<ViewModeToggle {...browser.mode} />}
<EntityBrowser {...props} state={browser} />
```

## Behaviour

1. **Grouping** (`buildEntityGroups`, pure): apply search first, then group. Groups render in
   `groupOrder`, then remaining keys by label, then the fallback group **last**. A group with zero
   visible members is **dropped**, never rendered as a bare header. Group-by `none` (always available
   when `groupBys.length > 0`) yields exactly one unlabelled group.
2. **Grid mode** — `EntityGrid` renders
   `grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4` (the `DirectoryTab` precedent), each
   group inside its own labelled `<section aria-label>`. Cards get
   `style={{ contentVisibility: "auto", containIntrinsicSize: "0 200px" }}` when the group exceeds
   ~24 items (the `AgentCard` `virtualizeHint` precedent — **no new virtualizer dependency**, D-OD8).
3. **Table mode** — one `DataTable` per group under the same `EntityGroupSection` header, each with a
   `caption` naming its group. With group-by `none`, one flat `DataTable`. Reuse
   `clickableRowTableProps` / `navCol` / `shouldPaginate` from `apps/web/src/lib/table.tsx`; wire
   `onRowClick` to `onOpen` and `rowActionLabel` to the entity's name.
4. **View mode** (D-OD2) — precedence `?view=` → `localStorage[entity-browser.<storageKey>.view]` →
   `"grid"`. Selecting a mode writes both. An unknown `?view=` value is ignored, not an error.
   Use `useSearchParams` (already a dependency) and `replace: true` so the toggle does not stack
   history entries.
5. **Card activation** (D-OD7) — port the guard from
   `apps/web/src/features/hub/workforce/AgentCard.tsx` (`event.target.closest('[role="menu"]')` for
   Radix portals, plus a `closest("a, button, input, select, textarea, [role=menuitem]")` guard for
   in-card controls). The card **title is a real `<Link to={hrefFor(item)}>`** — the tab stop, the
   accessible name, a genuine `href`. A pointer click elsewhere on the card calls `onOpen`. A
   text-selection drag must not navigate (compare `window.getSelection()?.isCollapsed`).
6. **Loading** — `loading` renders 6 skeleton cards on the same grid (no CLS) or `DataTable loading`.
7. **Empty** — zero items ⇒ the caller's `empty` node. Zero *matches* ⇒ a muted line naming the query
   plus a Clear control (the `ServerRail` copy pattern), rendered by the kit, not the caller.

## Rules that bind this WP

- **brand-ui only.** `Card`, `Badge`, `Text`, `Heading`, `ToggleGroup`, `Skeleton`, `EmptyState` from
  `@elabs-ai/components-ui`; `DataTable`, `SearchInput` from `@elabs-ai/components-data`; icons from
  `lucide-react`. **Read the real props first** — `pnpm exec brand-ui docs ToggleGroup` prints
  "read the source for the full API", so read
  `node_modules/@elabs-ai/components-ui/dist/**/toggle-group*` or its `.d.ts`. Never guess a prop.
- **Tokens only** — no raw hex/rgb, no palette colors, `className` is layout-only.
- **Icon-only controls** use `apps/web/src/components/IconButton.tsx` (tooltip == `aria-label`, no
  `title`).
- **No new runtime dependency** (D-OD8).

## Tests (co-located, vitest)

- `group.test.ts` — group order incl. explicit `groupOrder`; fallback group always last; empty groups
  dropped; search applied before grouping; `none` yields one group; case-insensitive search.
- `use-entity-browser-state.test.ts` — `?view=` beats storage; storage beats the default; an unknown
  param is ignored; selecting a mode writes both; group-by persists; a `groupBys` change that removes
  the active group-by falls back cleanly (the `effectiveFilter` pattern `ServerRail` uses).
- `EntityCard.test.tsx` — the title link carries the right `href`; a card-body click calls `onOpen`;
  a click on the ⋯ trigger and on a portaled menu item does **not**; Enter on the title link
  navigates and does not double-fire.
- `EntityBrowser.test.tsx` — grid renders one labelled section per group with correct counts; the
  table mode renders one table per group and a flat table under `none`; loading renders skeletons;
  zero items renders `empty`; zero matches renders the Clear affordance.

## Acceptance

- Every file above exists with the documented contract; `index.ts` is the only import surface.
- `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green.
- **No view changed** — `git diff --stat` touches only `apps/web/src/components/entity-browser/`.
- No new dependency in any `package.json`.
