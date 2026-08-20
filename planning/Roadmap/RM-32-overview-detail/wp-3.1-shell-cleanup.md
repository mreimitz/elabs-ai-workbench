---
type: "Work Package Spec"
title: "WP 3.1 — remove AppShell.secondaryContent, then update the front page"
description: "Phase 3 of the overview-detail plan. Deletes the now-consumerless shell rail props and the mobile Sheet branch, then updates README and CHANGELOG in the same commit as the last ticked box."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# WP 3.1 — shell cleanup + the front page

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Concept: [`concept.md`](./concept.md),
decision **D-OD4**. **Depends on WP 2.1, 2.2 and 2.3 all being done** — this WP only runs once no
caller passes `secondaryContent`.

## Part 1 — delete the rail capability

`apps/web/src/components/AppShell.tsx`:

- Remove the `secondaryContent` and `secondaryTitle` props from `AppShellProps`.
- Collapse `mainRegion` from four branches to two: `fullBleed` (edge-to-edge) and the default padded
  scrolling region. The two `<aside className="… w-72 …">` branches go.
- Remove the mobile `Sheet` rail branch in the TopNav `start` cluster (the `SecondaryIcon` trigger,
  the `SheetContent` and its header) and the `railOpen` state + any now-unused imports
  (`Sheet*`, the `SecondaryIcon`, `useIsMobile` **only if** nothing else uses it — check first).

`apps/web/src/App.tsx`:

- Remove the `secondaryContent` variable and the `secondaryTitle` prop pass-through.
- Remove `isServersSection` / `isSkillsSection` if no other code reads them.

**Verify first, then delete:** run `rg "secondaryContent|secondaryTitle|railOpen"` and confirm the
only hits are the ones being removed. No test asserts these props today — confirm that rather than
assuming it.

**Sanity check the loss:** the shell's `fullBleed` path already serves every route. On a phone the
rails were the only thing behind that Sheet trigger; the overview pages replace them and are
reachable from the sidebar, so nothing becomes unreachable. State that in the ledger note.

## Part 2 — the front page follows the work (CLAUDE.md §11, HARD RULE)

**In the same commit as the last ticked box:**

- `README.md` — update the capability table so the Servers / Skills / Collections rows describe what
  the app does today (grouped overview → full-width detail with a breadcrumb switcher), and correct
  anything this workstream made false (any text describing the 288px rail or master-detail rails).
- `CHANGELOG.md` — add an entry for the restructure.

**Verify every claim against the running app or a passing test — never from a work-package
description.** A ledger box does not tick while the front page still describes software that does not
match.

## Part 3 — the delivery record

- `/new-docu` into the documentation subject(s) that cover these surfaces; `doc.md` records **what
  shipped versus what was planned** — the delivery, how it differed, where the code lives, and what
  was deliberately left out (`/scans`, `/testing/suites`, the Assistant switcher fold-in, skill types).
- Then `/complete-roadmap` for RM-32 — it refuses while any box in the ledger is still open, so this
  is genuinely last.

## Acceptance

- `rg "secondaryContent|secondaryTitle"` returns nothing in `apps/web/src`.
- Every route still renders; the shell's `fullBleed` and default paths both still work.
- `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green.
- `README.md` + `CHANGELOG.md` updated in the same commit, each claim verified.
- `pnpm okf:validate` green after the docu + completion steps.
