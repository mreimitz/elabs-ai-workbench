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

- [ ] WP 0.1 — series ramp cycles all 12 chart tokens (F5) · **status: in review (refine 1 — 1 missed cycling site returned 2026-08-19)** — spec [`WP-0.1-series-ramp.md`](./WP-0.1-series-ramp.md)
- [ ] WP 0.2 — enable `onDatapointClick`, retire the stale workaround (F4) — spec [`WP-0.2-datapoint-clicks.md`](./WP-0.2-datapoint-clicks.md) · **depends on 0.1** (five shared panel files)
- [ ] WP 0.3 — metric tiles carry trend + sparkline + a featured tile (F3, F8) · **status: in review (refine 1 — 2 major defects returned 2026-08-19)** — spec [`WP-0.3-metric-tile-deltas.md`](./WP-0.3-metric-tile-deltas.md)

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
- **2026-08-19 · both Phase 0 agents branched from a stale base.** Worktree isolation cut branches
  from `5835a90`, before the plan scaffold and before the `wp/ci/M.1` merge, so neither agent could
  read its own spec file and both gated against stale main. The orchestrator re-merged each branch
  onto real main in a validation worktree and re-ran the full gate there; both were green. Nothing
  was ticked on the agents' own gate runs.
- **2026-08-19 · WP 0.1 acceptance was weaker than the WP's goal (orchestrator's error).** The
  criterion was a `grep 'chart-${'`, which structurally cannot see a private array of
  `var(--chart-N)` literals indexed by a series index — the shape in
  `features/hub/workforce/usage/UsageCharts.tsx`, which cycles 5 slots and was therefore missed.
  Spec tightened; WP returned for that one site. Fixed *semantic* token mappings (`node-kind-meta`,
  `ContextChart`, `TokenViz`) are deliberately out of scope — they are not cycling ramps.
- **2026-08-19 · WP 0.3 returned: the tile delta and the tile value count different servers.** The
  value totals every server with a successful scan; the delta sums only servers that have a prior
  scan. Adding and scanning a server — the product's core workflow — renders a fleet growth of
  100k→590k as a green "down -10,000, favorable" delta, while the same code path suppresses the
  sparkline that would contradict it. Reproduced against the real `MetricCard`. Also returned: the
  sparkline is handed absolute fleet totals but `Sparkline` is zero-baselined
  (`Math.max(...values, 0)`, no `min`), so a realistic series draws as a flat line.
- **2026-08-19 · red-vs-amber delta tone is an owner question, not a WP defect.** `MetricCard` maps
  an unfavorable delta to `text-destructive-text` (red) with no tone prop, which conflicts with
  D-IC3's amber-worse rule in `lib/delta.ts` (red reserved for structural removal). `KpiRail.tsx`
  already ships the same thing, so this is a pre-existing upstream gap. WP 0.3 makes it newly
  visible by putting amber and red deltas on one page. Raise upstream or accept.
