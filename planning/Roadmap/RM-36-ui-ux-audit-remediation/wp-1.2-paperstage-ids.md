---
type: "Work Package Spec"
title: "WP 1.2 — PaperStage: instance-unique SVG pattern ids"
description: "Phase 1 of item.md. Ledger: STATUS.md. Ends a live rendering defect: 36 PaperStage instances in the illustration detail dialog emit only 2 distinct pattern ids, so every stage draws one stage's grid phase and most render out of registration."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:41:00Z"
status: "final"
---
# WP 1.2 — `PaperStage`: instance-unique SVG pattern ids

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Finding **P1-3** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. **Touches:** `packages/illustrations/src/primitives/PaperStage.tsx`
and its test.

## The finding

`PaperStage` derives its `<pattern>` id from geometry constants alone
(`packages/illustrations/src/primitives/PaperStage.tsx:51`):

```ts
const patternId = `illus-paper-grid-c${fmt(cell)}-m${majorEvery}`.replace(/\./g, "p");
```

Every stage sharing a `cell` / `majorEvery` therefore emits the **same id**. Measured in the running
app's `/illustrations` detail dialog:

- **36 `<pattern>` elements → 2 distinct ids** (`illus-paper-grid-c16-m4`, `…-major`), i.e. 18
  duplicates each, with **48 `url(#…)` consumers**.
- Those 36 patterns carry **3 distinct `patternTransform` values** — `translate(0 -7.8)`,
  `translate(0 3.8)`, `translate(0 4.6)` — across **3 distinct stage sizes**, because the transform
  is computed per stage from its own centre (`cx % cell`, `cy % cell`).

`url(#id)` resolves to the **first** matching element in document order. So **all 36 stages render
with one stage's grid phase**, and the majority draw their blueprint grid out of registration with
their own crosshair and registration marks.

This is a **live rendering defect**, not merely invalid HTML. On the gallery grid it is invisible —
24 duplicates, but every card is the same size, so the phases coincide. It only shows where sizes
differ on one page, which is precisely what the detail dialog exists to show.

## Scope

Make the id **instance-unique** while keeping it readable and keeping the package's no-colour-literal
guard satisfied (the current comment notes the id must not look hexadecimal — preserve that
property):

- Compose `React.useId()` with the existing geometry suffix.
- Apply it to **both** ids the component emits (`…-c16-m4` and `…-c16-m4-major`) and to every
  `url(#…)` consumer inside the component.

## Out of scope

The illustration entities, the registry, `REGISTRY_VERSION`, the gallery route, and the scene spec.
Nothing about this changes a component's scene-visible contract, so the checked-in
`registry-contract.snapshot.json` must not move.

## Acceptance

- [ ] Two `PaperStage`s of **different sizes** rendered on one page emit **two distinct** pattern
      ids — asserted by a new contract test, and the test is proved to bite by reverting the fix and
      watching it go red.
- [ ] In the running app's `/illustrations` detail dialog, the count of distinct pattern ids equals
      the count of `<pattern>` elements (36 = 36, was 2 = 36).
- [ ] Every stage in the detail dialog's size matrix draws its grid registered against its own
      crosshair and registration marks, in **both** themes, verified by looking.
- [ ] `registry-contract.snapshot.json` is unchanged and `REGISTRY_VERSION` stays `0.1.0`.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
