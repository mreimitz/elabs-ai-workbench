---
type: "Work Package Spec"
title: "WP 2.1 — keep primary actions reachable at 768px"
description: "Phase 2 of item.md. Ledger: STATUS.md. At 768px the action clusters on /testing/runs and the run console are clipped and unreachable — no ancestor scrolls horizontally — taking '+ New run' and 'Re-run with changes' off the page."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:44:00Z"
status: "final"
---
# WP 2.1 — keep primary actions reachable at 768px

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Finding **P1-6** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. **Touches:** the toolbar of `/testing/runs` and the RunBar of the run
console.

## The finding

Measured at 768×900 on the running app. Page `scrollWidth` **equals** `clientWidth` and no ancestor
has a horizontal scroller, so the overflowing content is **clipped and unreachable** — not
off-screen-but-scrollable.

| Route | Unreachable at 768px | Measured right edge (viewport 768) |
| --- | --- | --- |
| `/testing/runs` | **Compare runs**, **+ New run** | 849px, 958px |
| `/testing/runs/:runId` | **Export session log**, **Re-run with changes**, the `automated` chip | 806px, 975px |

**1280px and 1024px are clean** — the only element past the viewport there is the closed assistant
dock, which is present identically on every route including Settings. This is a 768-and-below failure
only.

`+ New run` is the primary call to action of the runs feed, and RM-32 already carries "the layout
below 768px" as an open owner-acceptance box, so this is a live concern rather than a hypothetical.

## Scope

Let the action cluster degrade instead of clipping. Either is acceptable:

- Let the cluster **wrap** onto a second row below a breakpoint (the toolbar already wraps its left
  cluster — extend the same behaviour to the right one), **or**
- Collapse the **secondary** actions into the existing overflow `⋯` menu below a breakpoint, keeping
  the primary CTA visible at all widths.

Whichever is chosen, the rule is: **the primary action never leaves the page.** On `/testing/runs`
that is `+ New run`; on the run console it is `Re-run with changes`.

## Out of scope

A mobile layout. This is an operator desktop tool; the target is "does not lose its primary action
on a half-screen window", not a phone experience. Do not add a mobile navigation pattern.

Also out of scope: the `div.flex.h-full` at right=1680 seen at 1280px — that is the closed assistant
dock and is **not** a defect.

## Acceptance

- [ ] At 768×900, `/testing/runs` renders **+ New run** and **Compare runs** within the viewport, or
      reachable from a visible overflow control.
- [ ] At 768×900, the run console renders **Re-run with changes** and **Export session log** within
      the viewport, or reachable from a visible overflow control.
- [ ] An automated check asserts that at 768px no element with a non-empty accessible name extends
      past the viewport on those two routes without a horizontally-scrollable ancestor — proved to
      bite by reverting the fix.
- [ ] 1280px and 1024px are unchanged — no new wrapping or collapsing at those widths.
- [ ] Both routes read correctly at 768px in **both** themes, verified by looking.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
