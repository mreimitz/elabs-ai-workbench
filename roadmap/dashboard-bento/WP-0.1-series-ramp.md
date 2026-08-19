# WP 0.1 — Series ramp cycles all 12 chart tokens

**Finding F5.** 18 call sites use `var(--chart-${(i % 5) + 1})` and 2 use `% 4`, against a token
ramp of 12. `.claude/rules/styling-and-tokens.md` states charts "cycle all twelve before
repeating". Past five series, colours silently repeat and a legend stops being trustworthy.

## Goal

One shared helper, used everywhere, cycling `--chart-1` … `--chart-12`.

## Files

Add:
- `apps/web/src/lib/chart-colors.ts` (+ `chart-colors.test.ts`)

Change (every dynamic `--chart-N` site):
- `apps/web/src/features/dashboard/testing/{CostPanel,CustomChartCanvas,GuardrailStopsPanel,RunsErrorRatePanel,ScansStripPanel,TokensPanel}.tsx`
- `apps/web/src/features/testing/{AnalyticsPanel,ContextChart}.tsx`
- `apps/web/src/features/testing/compare/compare-runs.ts`
- `apps/web/src/features/testing/suites/{SuiteBreakdowns,SuiteScatter}.tsx`

Test files that hardcode a colour expectation may need updating: `compare/flow/align.test.ts`,
`compare/flow/focus-step.test.ts`, `compare/suite/suite-data.test.ts`.

**Do not touch** `apps/web/src/features/dashboard/ScansTab.tsx` (WP 0.3 owns it).

## Notes

- `SuiteScatter.tsx:271` builds a **dynamic Tailwind class** — `` `bg-chart-${n}` ``. Tailwind
  extracts class names statically, so these may never be generated. Fix this properly (inline
  `style` with `var(--chart-N)`, or a map of literal class strings); do not just change the modulus.
- Export the ramp length as a named constant rather than a bare `12` at each call site.
- Keep the helper pure and framework-free so it is trivially testable.

## Acceptance

- [ ] `chartSeriesColor(index)` (or equivalent) exists in `apps/web/src/lib/`, is pure, cycles
      1→12 then wraps, and is unit-tested including the wrap boundary (index 0, 11, 12, 25).
- [ ] Every **index-driven** series colour in `apps/web/src` routes through the helper. The grep
      `grep -rn 'chart-\${' apps/web/src` returning only the helper is **necessary but NOT
      sufficient** — it cannot see a private array/record of `var(--chart-N)` literals indexed by a
      series index (the shape that hid `features/hub/workforce/usage/UsageCharts.tsx`). Check that
      shape too. Fixed *semantic* mappings (named segments, node kinds) are correctly left alone.
- [ ] The `SuiteScatter` dynamic-Tailwind-class problem is fixed, not merely re-moduloed, and the
      swatch colour is asserted by a test.
- [ ] No raw hex/rgb colour is introduced anywhere.
- [ ] Gate green from the repo root.

## Not in scope

Datapoint clicks (WP 0.2). Metric tile props (WP 0.3). Any change to which charts exist.
