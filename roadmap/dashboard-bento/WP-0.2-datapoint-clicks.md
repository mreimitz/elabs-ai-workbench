# WP 0.2 — Enable `onDatapointClick`, retire the stale workaround

**Finding F4.** `RunsErrorRatePanel.tsx:18-20` and `ScansStripPanel.tsx` assert that
"`@elabs-ai/components-charts` v1.6.0 exposes no per-bar/point `onClick`", so every panel bolts a
`DrillList` underneath as its only click surface. **The app is on v4.0.0.** In v4,
`onDatapointClick` is a first-class prop on every interactive chart container, its handler
receives `React.MouseEvent | React.KeyboardEvent` (so it is keyboard-operable), and
`ChartDatapointLayer` renders the hit targets **outside** the `<svg>` for accessibility.

## Depends on

**WP 0.1** — overlaps on five panel files. Rebase onto 0.1 before starting.

## Goal

Charts become directly clickable, and the comments that justified the workaround are removed.

## Files

- `apps/web/src/features/dashboard/testing/{RunsErrorRatePanel,ScansStripPanel,GuardrailStopsPanel,DurationPanel,ScoreTrendPanel,TokensPanel,CostPanel}.tsx`
- `apps/web/src/features/issues-fleet/IssueOccurrencesPanel.tsx`
- their co-located `.test.tsx` files

## Notes

- **`DrillList` is not automatically deleted.** Keep it where it carries information a click
  cannot — per-bucket labels and counts are a legible list in their own right, and it is also the
  keyboard path users already know. Remove it only where it is pure workaround duplication. State
  your reasoning per panel in the report; this is a judgement call, not a mechanical sweep.
- The drill target for a datapoint must match the existing `DrillList` row's target for the same
  bucket, so a click and a list row cannot disagree. Reuse `drillDownFilter` /
  `bucketRangeIso` / `drillDownHref` from `dashboard-url-state.ts` — do not build a second path.
- `ScansStripPanel`'s natural target is `/servers/:id`, **not** the runs feed (it is footprint
  data, not run data). Preserve that.
- Delete the stale v1.6.0 comments; do not leave them saying something untrue.

## Acceptance

- [ ] Every panel listed passes `onDatapointClick` and navigates to the same target its
      `DrillList` row would for that datapoint.
- [ ] Keyboard activation works (the handler accepts a `KeyboardEvent`) and is covered by a test.
- [ ] A **faithful-stub** chart test (per `time-axis-charts.test.tsx`) asserts the handler is
      actually passed to the chart component — a no-op mock must not be able to hide a regression.
- [ ] Every stale "v1.6.0 / no per-point onClick" comment is gone.
- [ ] Each retained-or-removed `DrillList` decision is justified in the report.
- [ ] Gate green from the repo root.

## Not in scope

The series ramp (WP 0.1). Metric tile props (WP 0.3). Replacing `ChartPanel` with `ChartCard`
(finding F7 — a deliberate follow-up, not this WP).
