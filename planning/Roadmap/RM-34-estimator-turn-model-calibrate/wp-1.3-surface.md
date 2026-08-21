---
type: "Work Package Spec"
title: "WP 1.3 — launcher and suite preview show the turn basis and sample size"
description: "Phase 3 of item.md. Ledger: STATUS.md. Makes the advisory band say where its turn model came from, so a measured estimate is distinguishable from a guessed one."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T13:25:00Z"
status: "final"
---
# WP 1.3 — launcher and suite preview show the turn basis and sample size

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.1 (the wire type). Runs in parallel with WP 1.2 — the files are disjoint, and
the type this WP renders is landed by 1.1, not 1.2. Until 1.2 merges, `turnProfile` is simply absent
at runtime, which is a state this WP must handle anyway.

## The defect

The launcher renders the band with nothing to judge it by
(`apps/web/src/features/testing/run-launcher/RunLauncher.tsx`, the estimate block):

```tsx
≈ {formatRange(estimate.tokens.low, estimate.tokens.high)} tokens
 · {formatCostUsd(estimate.costUsd.low)}–{formatCostUsd(estimate.costUsd.high)} (estimate)
```

A band built from 51 of this exact environment-and-test's own runs and a band built from three
frozen constants render **identically**. D-ET5 exists because an advisory number whose provenance is
invisible cannot be judged — which is exactly what made the 8-turn ceiling survive unnoticed until a
live call was made against a 19-turn run.

## Scope

Three surfaces read `RunPlanEstimate` and should read consistently:

- `apps/web/src/features/testing/run-launcher/RunLauncher.tsx` — the primary one. Add a meta line
  beneath the existing band, in the same register as the neighbouring unpriced / uncapped notes.
- `apps/web/src/features/testing/suites/SuiteDetail.tsx` — the one-line `≈ … tokens · $x–$y
  (estimate)` in the run-confirm dialog.
- `apps/web/src/features/testing/ForkDialog.tsx` — check what it renders and keep it consistent;
  if it shows no band, leave it alone and say so.

### What the copy must say

Say the basis in operator language, not in the enum's words, and always give the sample size:

- `pair` — "Turn count from **N** past runs of this test on this environment."
- `environment` — "Turn count from **N** past runs on this environment."
- `global` — "Turn count from **N** past runs across all environments."
- `default` — "Turn count is an assumption — no past runs to measure." **This one matters most**: it
  is the honest label on the number the app has been showing all along.

A plan spans several environments with possibly different bases. Report the **weakest** basis
present (`default` beats `global` beats `environment` beats `pair`), because the plan's band is a sum
and one unmeasured environment makes the total partly assumed. That is the same "one unknown makes
the total unknown" rule RM-33 applied to suite cache rollups — follow it, do not invent a second
convention.

### Rules that apply

- `brand-ui` only, semantic tokens only, `className` layout-only
  (`.claude/rules/brand-ui-only.md`, `.claude/rules/styling-and-tokens.md`).
- Reads correctly in **both** themes (`light`, `dark`) — verified by looking at the running app, not
  asserted.
- `tabular-nums` on the sample count, per `.claude/rules/interaction-guidelines.md`.
- No new tab stop for a static meta line. If the copy needs a tooltip, it goes through `IconButton`
  per `.claude/rules/icon-affordances.md` — tooltip text equals `aria-label`, never `title`.

## Out of scope

- Any API or shared file (WP 1.1 / 1.2).
- A chart, a distribution plot, or a per-environment breakdown table. One honest line per surface.
- Re-designing the launcher's estimate block.

## Acceptance

- [ ] Each of the three surfaces renders the basis and sample size when `turnProfile` is present, in
      the operator wording above.
- [ ] With `turnProfile` **absent** (the pre-WP-1.2 wire, and any older cached response) nothing
      breaks and nothing is claimed — the surface renders exactly as it does today.
- [ ] A plan mixing a `pair` environment and a `default` environment reports **`default`** — the
      weakest basis wins. A test pins it.
- [ ] Web tests cover all four bases plus the absent case.
- [ ] Verified against the **running app** in both themes, with a screenshot-free but specific
      description of what was seen at what URL. Not a mock, not a storybook.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Verification the orchestrator will do

- Flip the weakest-basis rule to strongest-wins → the mixed-plan test must go red.
- Delete the absent-`turnProfile` guard → the today's-behaviour test must go red.
- The two-theme claim is checked by the orchestrator against the running app, not accepted from the
  agent's report.
