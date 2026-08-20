---
type: "Work Package Spec"
title: "WP 1.2 — BreadcrumbEntitySwitcher: the generic breadcrumb-leaf entity popover"
description: "Phase 1 of the overview-detail plan. Generalises the shipping SessionBreadcrumbSwitcher into a reusable, grouped, searchable entity switcher mounted through the existing breadcrumb slot."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# WP 1.2 — `BreadcrumbEntitySwitcher`

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Concept: [`concept.md`](./concept.md),
decision **D-OD5**.

## What this WP is

The breadcrumb leaf on a detail page becomes the entity switcher: `Home › MCP Servers › [barc-benchmark ▾]`.
Clicking it opens a popover that leads with **this** entity, then a search field, then the **grouped**
list of every entity, then a footer with "New …" and "View all →".

The mechanism already exists and is shipping — `apps/web/src/components/breadcrumb-slot.tsx`
(`useSetBreadcrumbSlot`) and `apps/web/src/features/hub/SessionBreadcrumbSwitcher.tsx`. This WP
**generalises the second one**; it does not invent a mechanism.

**This WP mounts nothing.** No route or view changes. At the end of it the component exists, is
tested, and the gate is green.

## Files

- New: `apps/web/src/components/BreadcrumbEntitySwitcher.tsx` + `BreadcrumbEntitySwitcher.test.tsx`.
- **Do not touch** `SessionBreadcrumbSwitcher.tsx` — it is shipped and tested; folding it onto this
  component is a recorded follow-up on the ledger, not this WP.

## Contract

```ts
export type BreadcrumbSwitcherItem = {
  id: string;
  label: string;
  /** Right-aligned chip on the row (a StatusBadge, a source Badge, …). */
  badge?: ReactNode;
  /** A muted second line (relative time, endpoint, repo). Truncates. */
  meta?: ReactNode;
};

export type BreadcrumbSwitcherGroup = {
  key: string;
  label: string;
  badge?: ReactNode;
  items: BreadcrumbSwitcherItem[];
};

export type BreadcrumbEntitySwitcherProps = {
  /** Same groups, same order as the overview page (D-OD3 consistency). */
  groups: BreadcrumbSwitcherGroup[];
  activeId: string | null;
  /** The trigger's text; falls back to the loading/none copy when absent. */
  triggerLabel?: string;
  /** A chip rendered in the trigger beside the label (e.g. the server's health StatusBadge). */
  triggerBadge?: ReactNode;
  /** Accessible name for the trigger, e.g. "Switch server". */
  switchLabel: string;
  /** Noun for the search placeholder + empty copy: ["server", "servers"]. */
  noun: [singular: string, plural: string];
  loading?: boolean;
  onSelect: (id: string) => void;
  /** Footer "New …" action. Omit to hide it. */
  onCreate?: () => void;
  createLabel?: string;          // "New server"
  /** Footer "View all →" — navigates back to the overview. */
  onViewAll: () => void;
};
```

## Behaviour

1. **Trigger** — a ghost `Button` sized to sit flush in the breadcrumb row. Copy the shipping classes
   verbatim from `SessionBreadcrumbSwitcher`: `-my-1 h-7 max-w-[16rem] gap-1.5 px-2 font-medium`,
   truncating label, optional badge, `ChevronDown` at `size-3.5 opacity-60`, `aria-label={switchLabel}`.
2. **Popover** — `PopoverContent align="start" className="w-[22rem] p-0"`, laid out as: a bordered
   "This <singular>" head showing the active entity + its badge (or "No <singular> selected"), a
   `SearchInput`, a scrolling `max-h-[18rem]` grouped list, and a bordered footer row.
3. **Grouped list** — each group renders its label (muted, uppercase, tracking-wide) with its optional
   badge and count, then its rows. **A group whose members are all filtered out is dropped**; if the
   whole list filters to nothing, show the "No <plural> match “<query>”" line plus a Clear control.
   With exactly one group and no group label, render the rows flat (no lone header).
4. **Rows** — a full-width ghost `Button`, `aria-current="true"` on the active row, `bg-accent
   text-accent-foreground` when active, label truncating with the badge pinned right and `meta` on a
   second muted line.
5. **Selection** — `onSelect(id)` then close.
6. **Footer** — "New …" (only when `onCreate` is given) on the left, "View all →" on the right; both
   close the popover.
7. **Loading** — the trigger reads "Loading <plural>…"; the list shows the same loading copy rather
   than an empty state (an empty list during a fetch reads as "there are none", which is false).

## Rules that bind this WP

- **brand-ui only**: `Popover`/`PopoverTrigger`/`PopoverContent`, `Button`, `Text`, `Badge`, `cn` from
  `@elabs-ai/components-ui`; `SearchInput` from `@elabs-ai/components-data`; `ChevronDown`/`Plus` from
  `lucide-react`.
- Tokens only; `className` layout-only.
- Keyboard: the trigger is a real button (Radix handles Escape/focus return); every row is a real
  button; visible focus in both themes.

## Tests

- Trigger renders the label + badge and carries `aria-label={switchLabel}`.
- Opening shows the active entity in the "This <singular>" head.
- Searching filters rows, drops emptied groups, and shows the zero-match line + Clear.
- Selecting a row calls `onSelect` with its id and closes the popover.
- "View all →" calls `onViewAll` and closes; "New …" is absent when `onCreate` is omitted.
- `loading` shows the loading copy, not an empty state.
- A single unlabelled group renders flat (no bare header).

## Acceptance

- The component + test exist; `SessionBreadcrumbSwitcher.tsx` is byte-unchanged.
- `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green.
- `git diff --stat` touches only the two new files.
