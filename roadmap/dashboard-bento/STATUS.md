# Dashboard bento — work-package status ledger · **PRIORITY: MEDIUM**

Living state for the **dashboard-bento** plan, read and updated by `/next-wp dashboard-bento`. A
box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/dashboard-bento/<id>`.

> Plan + locked decisions D-DB1–D-DB3 in [`README.md`](./README.md); shared rules in
> [`conventions.md`](./conventions.md). Origin: the `/dashboard` review of 2026-08-19 (findings
> F1–F9) and its published wireframes. No migration and no new endpoint is expected anywhere in
> this plan — claim via the decision log if that changes.

## Phase 0 — Turn on what is already there

- [ ] WP 0.1 — series ramp cycles all 12 chart tokens (F5) — spec [`WP-0.1-series-ramp.md`](./WP-0.1-series-ramp.md)
- [ ] WP 0.2 — enable `onDatapointClick`, retire the stale workaround (F4) — spec [`WP-0.2-datapoint-clicks.md`](./WP-0.2-datapoint-clicks.md) · **depends on 0.1** (five shared panel files)
- [ ] WP 0.3 — metric tiles carry trend + sparkline + a featured tile (F3, F8) — spec [`WP-0.3-metric-tile-deltas.md`](./WP-0.3-metric-tile-deltas.md)

## Phase 1 — The Overview tab

Not yet specced. Gated on Phase 0 landing **and** the owner judging the wireframe direction. Will
cover: composing `BentoGrid` (F1), the `use-overview-data` hook over four existing endpoints,
promoting the footprint chart off the Testing tab (F2), and making Overview the default tab.

## Decision log

_Entries: date · decision · rationale._

- **2026-08-19 · plan scaffolded from the `/dashboard` review.** The review and wireframes lived
  only in a session plan file and a published artifact; this folder is the in-repo executable half
  in the `/next-wp` layout. No scope change from the review.
- **2026-08-19 · WP 0.1 and 0.2 are sequential, not parallel.** They overlap on five panel files
  (`CostPanel`, `GuardrailStopsPanel`, `RunsErrorRatePanel`, `ScansStripPanel`, `TokensPanel`).
  0.2 rebases onto 0.1. WP 0.3 is disjoint (`ScansTab.tsx` only) and runs alongside 0.1.
- **2026-08-19 · Phase 0 is deliberately separable from the redesign.** All three WPs fix defects
  that exist independently of whether the Overview tab is ever built, so they ship first and the
  bento direction stays reversible.
